import { createServer } from 'node:http';
import { readFile } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from './lib/store.js';
import * as ig from './lib/instagram.js';
import { scoreLead, tier, extractHandles } from './lib/scoring.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUB = join(ROOT, 'public');

// minimal .env loader (no dependency)
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '127.0.0.1';
process.env.BASE_URL ||= `http://localhost:${PORT}`;

const STATUSES = ['new', 'contacted', 'replied', 'booked', 'passed'];
const pendingStates = new Set();

// ---------- helpers ----------
const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
  });

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

function publicStatus() {
  const s = store.get().settings;
  return {
    mode: ig.mode(),
    username: s.username || null,
    tokenExpires: s.tokenExpires || null,
    oauthConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    hashtags: ig.hashtagUsage(),
    statuses: STATUSES,
  };
}

function upsertLead(profile, source) {
  const db = store.get();
  const id = `ig:${profile.username.toLowerCase()}`;
  const sc = scoreLead({
    bio: profile.bio,
    captions: (profile.posts || []).map((p) => p.caption || ''),
    followers: profile.followers,
    website: profile.website,
  });
  const prev = db.leads[id];
  const now = new Date().toISOString();
  const lead = {
    status: 'new', notes: '', created: now,
    ...prev,
    id,
    username: profile.username,
    name: profile.name || '',
    bio: profile.bio || '',
    website: profile.website || '',
    followers: profile.followers || 0,
    email: sc.email || prev?.email || '',
    score: sc.score, tier: tier(sc.score), type: sc.type, market: sc.market, reasons: sc.reasons,
    source: prev?.source || source,
    url: `https://www.instagram.com/${profile.username}/`,
    updated: now,
  };
  db.leads[id] = lead;
  store.save();
  return lead;
}

// ---------- API ----------
async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const q = url.searchParams;

  if (route === 'GET /api/status') return send(res, 200, publicStatus());

  if (route === 'POST /api/connect') {
    const b = await readBody(req);
    if (!b.token || !/^\d+$/.test(String(b.igUserId || ''))) return send(res, 400, { error: 'Token and numeric Instagram user id required' });
    return send(res, 200, await ig.connectManual(String(b.token).trim(), String(b.igUserId).trim()));
  }
  if (route === 'POST /api/disconnect') { ig.disconnect(); return send(res, 200, { ok: true }); }

  if (route === 'GET /api/discover/hashtag') {
    const posts = await ig.hashtagPosts(q.get('tag') || '', q.get('kind') === 'top' ? 'top' : 'recent');
    const out = posts.map((p) => {
      const sc = scoreLead({ captions: [p.caption || ''] });
      return { ...p, score: sc.score, tier: tier(sc.score), market: sc.market, handles: extractHandles(p.caption), reasons: sc.reasons };
    });
    return send(res, 200, { posts: out.sort((a, b) => b.score - a.score), usage: ig.hashtagUsage() });
  }
  if (route === 'GET /api/discover/profile') {
    const p = await ig.lookupProfile(q.get('username') || '');
    const sc = scoreLead({ bio: p.bio, captions: p.posts.map((x) => x.caption || ''), followers: p.followers, website: p.website });
    return send(res, 200, { ...p, ...sc, tier: tier(sc.score), saved: Boolean(store.get().leads[`ig:${p.username.toLowerCase()}`]) });
  }
  if (route === 'GET /api/discover/tagged') {
    const posts = await ig.taggedPosts();
    return send(res, 200, { items: posts.map((p) => ({ ...p, handles: extractHandles(p.caption) })) });
  }
  if (route === 'GET /api/discover/commenters') return send(res, 200, { items: await ig.recentCommenters() });

  if (route === 'GET /api/leads') {
    return send(res, 200, { leads: Object.values(store.get().leads).sort((a, b) => b.score - a.score) });
  }
  if (route === 'POST /api/leads') {
    const b = await readBody(req);
    const p = await ig.lookupProfile(String(b.username || ''));
    return send(res, 200, upsertLead(p, String(b.source || 'lookup').slice(0, 80)));
  }
  if (route === 'POST /api/leads/manual') {
    const b = await readBody(req);
    const u = String(b.username || '').replace(/^@/, '').trim().toLowerCase();
    if (!/^[a-z0-9_.]{1,30}$/.test(u)) return send(res, 400, { error: 'Invalid username' });
    const lead = upsertLead({ username: u, bio: String(b.bio || '').slice(0, 2000), posts: [] }, 'manual');
    if (b.notes) { lead.notes = String(b.notes).slice(0, 2000); store.save(); }
    return send(res, 200, lead);
  }
  const m = decodeURIComponent(url.pathname).match(/^\/api\/leads\/(ig:[a-z0-9_.]+)$/);
  if (m) {
    const db = store.get();
    const lead = db.leads[m[1]];
    if (!lead) return send(res, 404, { error: 'Lead not found' });
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      if (b.status !== undefined) {
        if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'Bad status' });
        lead.status = b.status;
      }
      if (b.notes !== undefined) lead.notes = String(b.notes).slice(0, 2000);
      lead.updated = new Date().toISOString();
      store.save();
      return send(res, 200, lead);
    }
    if (req.method === 'DELETE') { delete db.leads[m[1]]; store.save(); return send(res, 200, { ok: true }); }
  }
  if (route === 'GET /api/leads.csv') {
    const cols = ['username', 'name', 'type', 'market', 'score', 'status', 'followers', 'email', 'website', 'url', 'source', 'notes', 'bio'];
    const rows = Object.values(store.get().leads).sort((a, b) => b.score - a.score);
    const csv = [cols.join(','), ...rows.map((l) => cols.map((c) => csvCell(l[c])).join(','))].join('\r\n');
    res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="mcs-leads.csv"' });
    return res.end(csv);
  }
  return send(res, 404, { error: 'Not found' });
}

// ---------- static + OAuth ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function serveStatic(res, pathname) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUB, rel);
  if (!file.startsWith(PUB)) return send(res, 403, 'Forbidden', 'text/plain');
  readFile(file, (err, data) => (err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, data, TYPES[extname(file)] || 'application/octet-stream')));
}

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CSRF guard: state-changing requests must come from this app's own origin.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (!origin || new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Cross-origin request blocked' });
    }

    if (url.pathname === '/auth/login') {
      const state = randomBytes(16).toString('hex');
      pendingStates.add(state);
      setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000).unref();
      res.writeHead(302, { location: ig.loginUrl(state) });
      return res.end();
    }
    if (url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state');
      if (!state || !pendingStates.delete(state)) return send(res, 400, 'Invalid or expired state', 'text/plain');
      const code = url.searchParams.get('code');
      if (!code) return send(res, 400, 'Login cancelled', 'text/plain');
      await ig.completeLogin(code);
      res.writeHead(302, { location: '/#settings' });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(res, url.pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && !(e instanceof ig.IgError)) console.error(e);
    send(res, status, { error: status >= 500 && !(e instanceof ig.IgError) ? 'Server error' : e.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => console.log(`MCS Leads running at http://${HOST}:${PORT}  (mode: ${ig.mode()})`));
}
