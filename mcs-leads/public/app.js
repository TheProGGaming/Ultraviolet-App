const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '#');
let status = {}, leads = [];

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const busy = async (btn, fn) => { btn.disabled = true; try { return await fn(); } finally { btn.disabled = false; } };
const results = $('#results');
const showErr = (e) => { results.innerHTML = `<div class="err">${esc(e.message)}</div>`; };

// ---------- tabs ----------
function tab(name) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== name;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  if (name === 'pipeline') loadLeads();
  if (name === 'settings') renderSettings();
}
$('#tabs').onclick = (e) => e.target.dataset.tab && (location.hash = e.target.dataset.tab);
window.onhashchange = () => tab(location.hash.slice(1) || 'discover');

// ---------- status ----------
async function loadStatus() {
  status = await api('/api/status');
  const m = $('#mode');
  m.textContent = status.mode === 'live' ? `Live · @${status.username}` : 'Demo data';
  m.className = `pill ${status.mode}`;
  const b = $('#banner');
  b.hidden = status.mode === 'live';
  b.textContent = 'Demo mode: sample data only. Connect an Instagram Business/Creator account (Instagram tab) to search for real.';
  $('#quota').textContent = status.mode === 'live' ? `Hashtag quota: ${status.hashtags.remaining}/${status.hashtags.limit} new hashtags left this week (re-searching one you've used is free).` : '';
  const st = $('#f-status');
  if (st.options.length === 1) status.statuses.forEach((s) => st.add(new Option(s, s)));
}

// ---------- discover ----------
const tierTag = (t, s) => `<span class="tag ${t}">${t} · ${s}</span>`;

function postCard(p) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `<header><h4>${esc(p.username ? '@' + p.username : p.source)}</h4>${p.tier ? tierTag(p.tier, p.score) : ''}${p.market ? `<span class="tag">${esc(p.market)}</span>` : ''}<span class="sp"></span><a href="${esc(safeUrl(p.permalink))}" target="_blank" rel="noopener noreferrer">open post ↗</a></header>
  <div class="cap">${esc((p.caption || '').slice(0, 400))}</div>
  <div class="actions"></div>`;
  const acts = $('.actions', el);
  const handles = p.username ? [p.username] : p.handles || [];
  if (!handles.length) acts.innerHTML = '<span class="why">No @handle in caption. Open the post to find the author.</span>';
  handles.slice(0, 4).forEach((h) => {
    const b = document.createElement('button');
    b.className = 'alt sm'; b.textContent = `Look up @${h}`;
    b.onclick = () => lookup(h);
    acts.append(b);
  });
  return el;
}

function profileCard(p) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `<header><h4>@${esc(p.username)} <small class="why">${esc(p.name)}</small></h4>${tierTag(p.tier, p.score)}<span class="tag">${esc(p.type)}</span>${p.market ? `<span class="tag">${esc(p.market)}</span>` : ''}<span class="sp"></span><span class="why">${Number(p.followers).toLocaleString()} followers</span></header>
  <div class="bio">${esc(p.bio)}</div>
  ${p.website ? `<div class="why">🔗 <a href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener noreferrer">${esc(p.website)}</a></div>` : ''}
  ${p.email ? `<div class="why">✉ ${esc(p.email)}</div>` : ''}
  <div class="why">${p.reasons.map(esc).join(' · ')}</div>
  ${(p.posts || []).slice(0, 3).map((x) => `<div class="cap">• ${esc((x.caption || '').slice(0, 160))}</div>`).join('')}
  <div class="actions"><button class="sm" data-save>${p.saved ? 'Update lead' : 'Save to pipeline'}</button>
  <a class="btn alt sm" href="https://www.instagram.com/${encodeURIComponent(p.username)}/" target="_blank" rel="noopener noreferrer">Open on Instagram ↗</a></div>`;
  $('[data-save]', el).onclick = (e) => busy(e.target, async () => {
    await api('/api/leads', { method: 'POST', body: { username: p.username, source: p.source || 'lookup' } });
    e.target.textContent = 'Saved ✓'; loadLeads();
  }).catch((er) => alert(er.message));
  return el;
}

function render(nodes, emptyMsg) {
  results.replaceChildren(...(nodes.length ? nodes : [Object.assign(document.createElement('div'), { className: 'empty', textContent: emptyMsg })]));
}

async function lookup(username) {
  results.innerHTML = '<div class="empty">Loading…</div>';
  try { render([profileCard(await api(`/api/discover/profile?username=${encodeURIComponent(username)}`))]); } catch (e) { showErr(e); }
}

$('#f-hashtag').onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  busy($('button', e.target), async () => {
    results.innerHTML = '<div class="empty">Searching…</div>';
    try {
      const r = await api(`/api/discover/hashtag?tag=${encodeURIComponent(f.get('tag'))}&kind=${f.get('kind')}`);
      render(r.posts.map(postCard), 'No posts returned for that hashtag.');
      await loadStatus();
    } catch (er) { showErr(er); }
  });
};
$('#f-profile').onsubmit = (e) => { e.preventDefault(); lookup(new FormData(e.target).get('username')); };
$('#b-tagged').onclick = (e) => busy(e.target, async () => { try { render((await api('/api/discover/tagged')).items.map(postCard), 'Nobody has tagged the account recently.'); } catch (er) { showErr(er); } });
$('#b-comments').onclick = (e) => busy(e.target, async () => {
  try {
    const { items } = await api('/api/discover/commenters');
    render(items.map((c) => postCard({ username: c.username, caption: c.text, permalink: c.permalink, source: 'commenter' })), 'No recent comments.');
  } catch (er) { showErr(er); }
});

// ---------- pipeline ----------
async function loadLeads() {
  leads = (await api('/api/leads')).leads;
  $('#count').textContent = leads.length || '';
  renderLeads();
}
function renderLeads() {
  const q = $('#filter').value.toLowerCase(), fs = $('#f-status').value, ft = $('#f-type').value;
  const rows = leads.filter((l) => (!fs || l.status === fs) && (!ft || l.type === ft) && (!q || `${l.username} ${l.name} ${l.bio} ${l.market} ${l.notes}`.toLowerCase().includes(q)));
  const box = $('#leads');
  box.replaceChildren(...(rows.length ? rows.map(leadCard) : [Object.assign(document.createElement('div'), { className: 'empty', textContent: leads.length ? 'No leads match the filter.' : 'No leads yet. Use Discover to find and save some.' })]));
}
function leadCard(l) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `<header><h4><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">@${esc(l.username)}</a> <small class="why">${esc(l.name)}</small></h4>${tierTag(l.tier, l.score)}<span class="tag">${esc(l.type)}</span>${l.market ? `<span class="tag">${esc(l.market)}</span>` : ''}<span class="sp"></span>
  <select data-st>${status.statuses.map((s) => `<option${s === l.status ? ' selected' : ''}>${s}</option>`).join('')}</select></header>
  <div class="bio">${esc(l.bio.slice(0, 220))}</div>
  <div class="why">${Number(l.followers).toLocaleString()} followers${l.email ? ' · ✉ ' + esc(l.email) : ''} · via ${esc(l.source)}</div>
  <textarea placeholder="Notes (who reached out, table price quoted, follow-up date…)">${esc(l.notes)}</textarea>
  <div class="actions"><button class="alt sm" data-del>Delete</button></div>`;
  $('[data-st]', el).onchange = (e) => api(`/api/leads/${encodeURIComponent(l.id)}`, { method: 'PATCH', body: { status: e.target.value } }).then((u) => (l.status = u.status));
  $('textarea', el).onchange = (e) => api(`/api/leads/${encodeURIComponent(l.id)}`, { method: 'PATCH', body: { notes: e.target.value } });
  $('[data-del]', el).onclick = async () => { if (confirm(`Delete @${l.username}?`)) { await api(`/api/leads/${encodeURIComponent(l.id)}`, { method: 'DELETE' }); loadLeads(); } };
  return el;
}
for (const id of ['#filter', '#f-status', '#f-type']) $(id).oninput = renderLeads;
$('#f-manual').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try { await api('/api/leads/manual', { method: 'POST', body: f }); e.target.reset(); loadLeads(); } catch (er) { alert(er.message); }
};

// ---------- settings ----------
const TEMPLATES = {
  'Vendor invite': "Hey {name}! Max from Maximum Card Show. Love what you're doing with {category}. We're running {show} on {date} at {venue} and have a few tables left. Want the vendor packet?",
  'Attendee / collector': "Hey {name}, saw your pickups. We've got a big show at {venue} on {date}. Free early entry if you reply with your top want. Want the details?",
  'Sponsor / partner': "Hi {name}, Max from Maximum Card Show. We're building a 5-city circuit for 2027 and looking for a couple of supply/grading partners. Open to a quick chat about a table or sponsor package?",
};
function renderSettings() {
  const c = $('#conn');
  if (status.mode === 'live') {
    c.innerHTML = `<p>Connected as <b>@${esc(status.username)}</b>${status.tokenExpires ? ` · token expires ${new Date(status.tokenExpires).toLocaleDateString()}` : ''}.</p><button class="alt" id="b-dis">Disconnect</button>`;
    $('#b-dis').onclick = async () => { await api('/api/disconnect', { method: 'POST' }); await loadStatus(); renderSettings(); };
  } else {
    c.innerHTML = `${status.oauthConfigured ? '<p><a class="btn" href="/auth/login">Connect with Facebook / Instagram</a></p>' : '<p class="hint">Facebook login is not configured (set META_APP_ID / META_APP_SECRET, see README). You can still paste a token:</p>'}
    <form id="f-conn" class="row"><input name="igUserId" placeholder="Instagram user ID (numeric)" required><input name="token" type="password" placeholder="Access token" autocomplete="off" required><button>Connect</button></form><p class="hint" id="conn-err"></p>
    <p class="hint">Requires an Instagram <b>Business or Creator</b> account linked to a Facebook Page. Step by step in README.</p>`;
    $('#f-conn').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/connect', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); await loadStatus(); renderSettings(); }
      catch (er) { $('#conn-err').textContent = er.message; }
    };
  }
  $('#templates').replaceChildren(...Object.entries(TEMPLATES).map(([k, v]) => {
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = `<b>${esc(k)}</b><div class="bio">${esc(v)}</div><button class="alt sm">Copy</button>`;
    $('button', d).onclick = (e) => navigator.clipboard.writeText(v).then(() => (e.target.textContent = 'Copied ✓'));
    return d;
  }));
}

await loadStatus();
tab(location.hash.slice(1) || 'discover');
api('/api/leads').then((r) => ($('#count').textContent = r.leads.length || ''));
