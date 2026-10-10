// Thin client for the official Instagram Graph API (via Facebook Login).
// No scraping, no session cookies, no automation of the logged-in website.
import { store } from './store.js';
import * as demo from './demo.js';

const VERSION = () => process.env.GRAPH_VERSION || 'v23.0';
const BASE = () => `https://graph.facebook.com/${VERSION()}`;
const HASHTAG_WEEKLY_LIMIT = 30; // Meta limit: 30 unique hashtags / 7 days / IG account
const WEEK = 7 * 24 * 3600 * 1000;

export class IgError extends Error {
  constructor(message, status = 502, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isLive = () => Boolean(store.get().settings.token && store.get().settings.igUserId);
export const mode = () => (isLive() ? 'live' : 'demo');

async function graph(path, params = {}, { token } = {}) {
  const url = new URL(path.startsWith('http') ? path : `${BASE()}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  url.searchParams.set('access_token', token || store.get().settings.token);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error || {};
    throw new IgError(e.error_user_msg || e.message || `Graph API ${res.status}`, res.status >= 400 && res.status < 500 ? 400 : 502, e.code);
  }
  return body;
}

// ---------- connection ----------

export function loginUrl(state) {
  const { META_APP_ID, BASE_URL } = process.env;
  if (!META_APP_ID || !process.env.META_APP_SECRET) throw new IgError('META_APP_ID / META_APP_SECRET not configured', 400);
  const u = new URL(`https://www.facebook.com/${VERSION()}/dialog/oauth`);
  u.searchParams.set('client_id', META_APP_ID);
  u.searchParams.set('redirect_uri', `${BASE_URL}/auth/callback`);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', 'instagram_basic,pages_show_list,pages_read_engagement,business_management,instagram_manage_comments');
  return u.toString();
}

export async function completeLogin(code) {
  const { META_APP_ID, META_APP_SECRET, BASE_URL } = process.env;
  const short = await graph('oauth/access_token', { client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: `${BASE_URL}/auth/callback`, code }, { token: 'x' });
  const long = await graph('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: short.access_token }, { token: 'x' });
  const pages = await graph('me/accounts', { fields: 'name,instagram_business_account{id,username}' }, { token: long.access_token });
  const linked = (pages.data || []).find((p) => p.instagram_business_account);
  if (!linked) throw new IgError('No Instagram Business/Creator account is linked to a Facebook Page you manage.', 400);
  return saveConnection(long.access_token, linked.instagram_business_account.id, linked.instagram_business_account.username, long.expires_in);
}

export async function connectManual(token, igUserId) {
  const me = await graph(igUserId, { fields: 'username' }, { token });
  return saveConnection(token, igUserId, me.username);
}

function saveConnection(token, igUserId, username, expiresIn) {
  const s = store.get().settings;
  Object.assign(s, { token, igUserId, username, tokenExpires: expiresIn ? Date.now() + expiresIn * 1000 : null });
  store.save();
  return { username };
}

export function disconnect() {
  store.get().settings = {};
  store.save();
}

// ---------- discovery ----------

const MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,like_count,comments_count';

function hashtagBudget(tag) {
  const db = store.get();
  const now = Date.now();
  db.hashtagLog = db.hashtagLog.filter((h) => now - h.ts < WEEK);
  const known = db.hashtagLog.some((h) => h.tag === tag);
  const used = new Set(db.hashtagLog.map((h) => h.tag)).size;
  return { known, used, remaining: HASHTAG_WEEKLY_LIMIT - used };
}

export function hashtagUsage() {
  const { used, remaining } = hashtagBudget('');
  return { used, remaining, limit: HASHTAG_WEEKLY_LIMIT };
}

/** Posts under a hashtag. The API does NOT return the author's username for hashtag media. */
export async function hashtagPosts(rawTag, kind = 'recent') {
  const tag = rawTag.replace(/^#/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!tag) throw new IgError('Enter a hashtag', 400);
  if (!isLive()) return demo.hashtagPosts(tag);

  const db = store.get();
  const budget = hashtagBudget(tag);
  if (!budget.known && budget.remaining <= 0) {
    throw new IgError(`Instagram caps hashtag search at ${HASHTAG_WEEKLY_LIMIT} unique hashtags per 7 days; you've used them all. Reuse a hashtag you've already searched.`, 429);
  }
  let id = db.hashtagIds[tag];
  if (!id) {
    const r = await graph('ig_hashtag_search', { user_id: db.settings.igUserId, q: tag });
    id = r.data?.[0]?.id;
    if (!id) throw new IgError(`Hashtag #${tag} not found`, 404);
    db.hashtagIds[tag] = id;
  }
  if (!budget.known) db.hashtagLog.push({ tag, ts: Date.now() });
  store.save();
  const edge = kind === 'top' ? 'top_media' : 'recent_media';
  const r = await graph(`${id}/${edge}`, { user_id: db.settings.igUserId, fields: MEDIA_FIELDS, limit: 30 });
  return (r.data || []).map((m) => ({ ...m, source: `#${tag}` }));
}

/** Profile + recent posts for any Business/Creator account, by username. */
export async function lookupProfile(rawName) {
  const username = rawName.replace(/^@/, '').trim().toLowerCase();
  if (!/^[a-z0-9_.]{1,30}$/.test(username)) throw new IgError('Invalid username', 400);
  if (!isLive()) return demo.profile(username);
  const fields = `business_discovery.username(${username}){username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,media.limit(12){${MEDIA_FIELDS}}}`;
  try {
    const r = await graph(store.get().settings.igUserId, { fields });
    const b = r.business_discovery;
    return {
      username: b.username,
      name: b.name || '',
      bio: b.biography || '',
      website: b.website || '',
      followers: b.followers_count || 0,
      following: b.follows_count || 0,
      mediaCount: b.media_count || 0,
      picture: b.profile_picture_url || '',
      posts: b.media?.data || [],
    };
  } catch (e) {
    if (e instanceof IgError && /business|creator|not found|cannot be/i.test(e.message)) {
      throw new IgError(`@${username} isn't a Business/Creator account (or doesn't exist), so the API can't read it. Open their profile manually and add it as a lead by hand.`, 404);
    }
    throw e;
  }
}

/** Posts that tag/mention your own account — warm inbound. */
export async function taggedPosts() {
  if (!isLive()) return demo.tagged();
  const r = await graph(`${store.get().settings.igUserId}/tags`, { fields: `${MEDIA_FIELDS},username`, limit: 30 });
  return (r.data || []).map((m) => ({ ...m, source: 'tagged you' }));
}

/** Commenters on your recent posts — people already engaging with MCS. */
export async function recentCommenters() {
  if (!isLive()) return demo.commenters();
  const id = store.get().settings.igUserId;
  const media = await graph(`${id}/media`, { fields: 'id,permalink', limit: 10 });
  const out = [];
  for (const m of media.data || []) {
    const c = await graph(`${m.id}/comments`, { fields: 'username,text,timestamp', limit: 50 });
    for (const x of c.data || []) out.push({ ...x, permalink: m.permalink });
  }
  return out;
}
