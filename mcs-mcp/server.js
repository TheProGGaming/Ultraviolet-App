#!/usr/bin/env node
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAll } from './lib/tools.js';

const INSTRUCTIONS = 'Maximum Card Show (multi-city trading card show circuit) data from Treasure and Eventeny. Data comes from CSV exports imported by the operator: it is a snapshot, not live, and Treasure has no API. Call context_brief first; check warnings before drawing conclusions.';

export function build({ allowFiles }) {
  const s = new McpServer({ name: 'mcs-mcp', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  registerAll(s, { allowFiles });
  return s;
}

const safeEq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function httpServer(token) {
  return createServer(async (req, res) => {
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://x');
      // Token via "Authorization: Bearer" OR secret path /mcp/<token> (for clients that cannot send headers).
      const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const pathTok = url.pathname.startsWith('/mcp/') ? decodeURIComponent(url.pathname.slice(5)) : '';
      if (url.pathname !== '/mcp' && !url.pathname.startsWith('/mcp/')) return json(404, { error: 'not found' });
      if (!safeEq(bearer, token) && !safeEq(pathTok, token)) return json(401, { error: 'unauthorized' });
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
      let size = 0; const chunks = [];
      for await (const c of req) { size += c.length; if (size > 6_000_000) return json(413, { error: 'too large' }); chunks.push(c); }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      // Stateless: one server+transport per request.
      const mcp = build({ allowFiles: false });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) json(400, { jsonrpc: '2.0', error: { code: -32700, message: 'bad request' }, id: null });
    }
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.includes('--http')) {
    const token = process.env.MCS_MCP_TOKEN || '';
    if (token.length < 24) { console.error('Refusing to start: set MCS_MCP_TOKEN to a random string of 24+ chars (this server exposes vendor data).\n  e.g. MCS_MCP_TOKEN=$(openssl rand -hex 24) npm run http'); process.exit(1); }
    const port = Number(process.env.PORT || 3200), host = process.env.HOST || '127.0.0.1';
    httpServer(token).listen(port, host, () => console.error(`mcs-mcp HTTP on http://${host}:${port}/mcp (Bearer token or /mcp/<token>)`));
  } else {
    await build({ allowFiles: true }).connect(new StdioServerTransport());
    console.error('mcs-mcp running on stdio');
  }
}
