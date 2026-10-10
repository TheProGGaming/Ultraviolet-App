# mcs-mcp: Treasure + Eventeny context for Claude and ChatGPT

An MCP server that gives an AI assistant structured, queryable context on Maximum Card Show: tables and tickets
sold vs capacity, sales pace, vendor pipeline, breakeven math, and notes. It works from CSV exports you pull out of
Treasure and Eventeny.

## What it is not

- **Not a live connector.** Treasure has no public API I could find. Eventeny issues API keys to event admins, but its endpoint
  docs are admin-only, so I did not guess at them. Until you confirm real endpoints, data = exports you import. Every answer
  carries a "snapshot, last imported N days ago" warning so the model doesn't treat it as current.
- **Not a scraper.** It never logs into either platform, and it makes no outbound network calls at all.
  Data lives in `~/.mcs-mcp/db.json` (mode 600; override with `MCS_MCP_DATA`).
- Never writes anything back to Treasure or Eventeny.

If Eventeny's admin docs expose vendor-application or order endpoints, a live adapter is a small addition: it only needs to
produce the same normalized rows `lib/importer.js` writes. Send me the endpoint list and I'll add it.

## Run

```
cd mcs-mcp && npm install
npm test
```

### Claude Desktop / Claude Code (stdio, local)

```json
{ "mcpServers": { "mcs": { "command": "node", "args": ["/abs/path/to/mcs-mcp/server.js"] } } }
```
Claude Code: `claude mcp add mcs -- node /abs/path/to/mcs-mcp/server.js`

### ChatGPT or any remote client (HTTP)

```
MCS_MCP_TOKEN=$(openssl rand -hex 24) npm run http      # 127.0.0.1:3200
```
ChatGPT can only reach a **public HTTPS** URL, so put a tunnel in front (Cloudflare Tunnel, ngrok), then add a custom
MCP connector pointing at `https://<tunnel>/mcp/<token>`. The secret-path form exists for clients that can't send an
`Authorization: Bearer <token>` header; treat that URL like a password. The server refuses to start without a token,
and disables `file_path` imports over HTTP. This data includes vendor emails and phone numbers, so don't expose it
without the token. Check your ChatGPT plan supports custom MCP connectors; that varies by plan and changes often.

## Workflow

1. In each platform's organizer dashboard, export orders/sales and vendor applications as CSV.
2. Tell the assistant: *"Import this Treasure orders export for Santa Clara"* (paste the CSV, or give a local path over stdio).
   The result lists mapped and **unmapped columns**; if one was missed, the assistant retries with `column_map`.
3. `upsert_event` once per show (date, city, table/ticket capacity) and `set_costs` (venue, insurance, etc.).
   Exports usually lack these, and they unlock sell-through %, days-out pacing and breakeven.
4. Ask: *"Run the MCS audit"* (a built-in prompt) or any question. Re-import fresh exports before each audit; imports are idempotent.

## Tools

| Tool | Purpose |
|---|---|
| `context_brief` | One-shot markdown of all events + warnings + notes. Load first. |
| `list_events`, `event_summary` | Tables/tickets vs capacity, revenue, fees, refunds, vendor statuses, profit |
| `sales_timeline` | Cumulative sales by day/week with days-before-show |
| `compare_events` | Side by side; `days_out` gives like-for-like pace (new show vs mature show) |
| `unit_economics` | Breakeven tables and tables for a target profit, from costs, avg price and observed fee rate |
| `vendor_insights`, `search_vendors` | Approval rate, category mix, cross-event repeat rate; contact info withheld unless `include_contact` |
| `import_csv`, `upsert_event`, `set_costs`, `add_note` | Local writes only |

`samples/` has synthetic exports to try it with. They are made up, so delete `~/.mcs-mcp/db.json` before loading real data.

## Limits worth knowing

- Column matching is alias-based, since neither platform documents its export layout. Verify the first import of each file type.
- Table vs ticket classification is by item name (`table|booth|vendor…` vs `ticket|admission|vip…`). Odd product names land in "other" and are flagged.
- Vendor identity across events = email, else name. Repeat rate needs 2+ events imported to mean anything.
- Fee rate in `unit_economics` is the observed rate from imported orders; it excludes ad spend, labor and anything not entered via `set_costs`.
