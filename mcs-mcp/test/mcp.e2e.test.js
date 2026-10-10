import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csv = readFileSync(join(root, 'samples', 'treasure-orders-tacoma.csv'), 'utf8');
const data = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'db.json');
const out = (r) => r.content[0].text;

test('stdio: tools list, import, summary, file import allowed', async () => {
  const t = new StdioClientTransport({ command: 'node', args: [join(root, 'server.js')], env: { ...process.env, MCS_MCP_DATA: data } });
  const c = new Client({ name: 't', version: '0' });
  await c.connect(t);
  const names = (await c.listTools()).tools.map((x) => x.name);
  for (const n of ['import_csv', 'event_summary', 'context_brief', 'unit_economics']) assert.ok(names.includes(n), n);
  const imp = await c.callTool({ name: 'import_csv', arguments: { platform: 'treasure', kind: 'orders', event: 'Tacoma', file_path: join(root, 'samples', 'treasure-orders-tacoma.csv') } });
  assert.equal(JSON.parse(out(imp)).added, 7);
  const sum = JSON.parse(out(await c.callTool({ name: 'event_summary', arguments: { event: 'tacoma' } })));
  assert.equal(sum.tables.sold, 6);
  const bad = await c.callTool({ name: 'event_summary', arguments: { event: 'nope' } });
  assert.equal(bad.isError, true);
  assert.match(out(await c.callTool({ name: 'context_brief', arguments: {} })), /Tacoma/);
  await c.close();
});

test('http: rejects without token, works with bearer and secret path, blocks file_path', async () => {
  const { httpServer } = await import('../server.js');
  const token = 'x'.repeat(32);
  const srv = httpServer(token);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', body: '{}' })).status, 401);

  for (const [url, headers] of [[`${base}/mcp`, { authorization: `Bearer ${token}` }], [`${base}/mcp/${token}`, {}]]) {
    const c = new Client({ name: 't', version: '0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
    assert.ok((await c.listTools()).tools.length >= 10);
    await c.close();
  }
  const c = new Client({ name: 't', version: '0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const r = await c.callTool({ name: 'import_csv', arguments: { platform: 'treasure', kind: 'orders', event: 'E', file_path: '/etc/passwd' } });
  assert.equal(r.isError, true);
  assert.match(out(r), /disabled on the HTTP/);
  const ok = await c.callTool({ name: 'import_csv', arguments: { platform: 'treasure', kind: 'orders', event: 'E', csv_text: csv } });
  assert.equal(JSON.parse(out(ok)).added, 7);
  await c.close();
});
