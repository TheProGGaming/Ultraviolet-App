import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MCS_DATA_DIR = mkdtempSync(join(tmpdir(), 'mcs-'));
const { server } = await import('../server.js');
let base;
before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => server.close());
const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json', origin: base, ...o.headers }, body: o.body && JSON.stringify(o.body) });

test('demo mode lookup -> save -> update -> csv -> delete', async () => {
  assert.equal((await (await j('/api/status')).json()).mode, 'demo');
  const prof = await (await j('/api/discover/profile?username=@PNWSlabs')).json();
  assert.equal(prof.tier, 'hot');
  const lead = await (await j('/api/leads', { method: 'POST', body: { username: 'pnwslabs' } })).json();
  assert.equal(lead.id, 'ig:pnwslabs');
  const patched = await (await j('/api/leads/ig:pnwslabs', { method: 'PATCH', body: { status: 'contacted', notes: '=cmd()' } })).json();
  assert.equal(patched.status, 'contacted');
  const again = await (await j('/api/leads', { method: 'POST', body: { username: 'pnwslabs' } })).json();
  assert.equal(again.status, 'contacted'); // re-saving keeps pipeline state
  const csv = await (await fetch(base + '/api/leads.csv')).text();
  assert.match(csv, /"'=cmd\(\)"/); // formula neutralised
  assert.equal((await j('/api/leads/ig:pnwslabs', { method: 'DELETE' })).status, 200);
});

test('hashtag demo returns scored posts with handles', async () => {
  const r = await (await j('/api/discover/hashtag?tag=%23CardShow')).json();
  assert.ok(r.posts.length && r.posts.some((p) => p.handles.includes('pnwslabs')));
});

test('validation and CSRF', async () => {
  assert.equal((await j('/api/leads/manual', { method: 'POST', body: { username: 'bad name!' } })).status, 400);
  assert.equal((await j('/api/leads/ig:nope', { method: 'PATCH', body: {} })).status, 404);
  assert.equal((await j('/api/leads', { method: 'POST', body: { username: 'x' }, headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
});

test('lead routes accept the URL-encoded id the UI sends', async () => {
  await j('/api/leads/manual', { method: 'POST', body: { username: 'enc_test' } });
  const r = await j('/api/leads/' + encodeURIComponent('ig:enc_test'), { method: 'PATCH', body: { status: 'replied' } });
  assert.equal(r.status, 200);
});
