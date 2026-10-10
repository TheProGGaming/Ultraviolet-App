import { z } from 'zod';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import * as store from './store.js';
import * as A from './analytics.js';
import { importCsv, ensureEvent } from './importer.js';

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const wrap = (fn) => async (args) => {
  try { return text(await fn(args)); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
};
const RO = { readOnlyHint: true, openWorldHint: false };
const WR = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function registerAll(server, { allowFiles }) {
  const event = z.string().describe('Event id or name (see list_events)');

  server.registerTool('list_events', {
    title: 'List events', description: 'All events with data loaded, with dates, capacity, and counts of imported orders/vendors. Start here.', annotations: RO,
  }, wrap(() => {
    const db = store.get();
    return Object.values(db.events).map((e) => ({
      ...e, orders: Object.values(db.orders).filter((o) => o.event === e.id).length, vendorApplications: Object.values(db.vendors).filter((v) => v.event === e.id).length,
    }));
  }));

  server.registerTool('event_summary', {
    title: 'Event summary', annotations: RO,
    description: 'Tables and tickets sold vs capacity, revenue, average prices, fees, refunds, vendor application statuses, costs and profit for one event, plus data-quality warnings. Read the warnings: data comes from exports and may be stale.',
    inputSchema: { event },
  }, wrap(({ event }) => A.summary(A.getEvent(event))));

  server.registerTool('sales_timeline', {
    title: 'Sales timeline', annotations: RO,
    description: 'Cumulative sales over time (day or week buckets) with days-before-show for each bucket. Use to judge sales pace and whether sales are front- or back-loaded.',
    inputSchema: { event, bucket: z.enum(['day', 'week']).default('week'), kind: z.enum(['all', 'table', 'ticket']).default('all') },
  }, wrap(({ event, bucket, kind }) => A.timeline(A.getEvent(event), { bucket, kind })));

  server.registerTool('compare_events', {
    title: 'Compare events', annotations: RO,
    description: 'Side-by-side metrics across events. Pass days_out to compare tables sold N days before each show (like-for-like pace), the right way to compare a new show against a mature one.',
    inputSchema: { events: z.array(z.string()).min(2).describe('Event ids or names'), days_out: z.number().int().min(0).max(365).optional() },
  }, wrap(({ events, days_out }) => A.compare(events.map(A.getEvent), days_out)));

  server.registerTool('unit_economics', {
    title: 'Unit economics', annotations: RO,
    description: 'Breakeven table count and tables needed for a target profit, from recorded costs, average table price, observed fee rate, and ticket contribution. Requires set_costs. Answers "how many tables must we sell for this venue to work".',
    inputSchema: { event, target_profit: z.number().min(0).default(0) },
  }, wrap(({ event, target_profit }) => A.economics(A.getEvent(event), { targetProfit: target_profit })));

  server.registerTool('vendor_insights', {
    title: 'Vendor insights', annotations: RO,
    description: 'Approval rate, pending/waitlist, category mix of approved vendors, and cross-event repeat rate (vendor retention). Omit event for all events.',
    inputSchema: { event: z.string().optional() },
  }, wrap(({ event }) => A.vendorInsights(event ? A.getEvent(event) : null)));

  server.registerTool('search_vendors', {
    title: 'Search vendors', annotations: RO,
    description: 'Find vendor applications by text, status, or event. Contact details (email/phone) are withheld unless include_contact is true. Only set that when the task needs outreach.',
    inputSchema: {
      query: z.string().default(''), status: z.enum(['pending', 'approved', 'waitlist', 'rejected', 'cancelled']).optional(),
      event: z.string().optional(), include_contact: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(25),
    },
  }, wrap(({ query, status, event, include_contact, limit }) => A.searchVendors({ query, status, event: event ? A.getEvent(event) : null, includeContact: include_contact, limit })));

  server.registerTool('context_brief', {
    title: 'Context brief', annotations: RO,
    description: 'One markdown briefing of every event (or one) with key numbers, warnings and recent operator notes. Cheapest way to load MCS context at the start of a conversation.',
    inputSchema: { event: z.string().optional() },
  }, wrap(({ event }) => A.brief(event ? A.getEvent(event) : null)));

  // ---- writes (local store only; nothing is sent to Treasure or Eventeny) ----
  server.registerTool('import_csv', {
    title: 'Import CSV export', annotations: WR,
    description: `Import a Treasure or Eventeny CSV export for one event. kind "orders" = ticket/table sales; kind "vendors" = vendor applications. Re-importing the same file updates rather than duplicates. Columns are auto-matched; the result lists mapped and unmapped headers, so check it. If a column is missed, retry with column_map {field: "Exact Header"}. Order fields: orderId,item,kind,qty,amount,fees,status,buyer,email,date. Vendor fields: name,contact,email,phone,status,category,tables,price,appliedAt,instagram,website. Pass csv_text${allowFiles ? ' or file_path' : ''}.`,
    inputSchema: {
      platform: z.enum(['treasure', 'eventeny']), kind: z.enum(['orders', 'vendors']), event: z.string().min(1).describe('Event name, created if new'),
      csv_text: z.string().max(5_000_000).optional(), file_path: z.string().optional(), column_map: z.record(z.string()).optional(),
    },
  }, wrap(({ platform, kind, event, csv_text, file_path, column_map }) => {
    let csv = csv_text;
    if (!csv && file_path) {
      if (!allowFiles) throw new Error('file_path imports are disabled on the HTTP transport; send csv_text instead.');
      if (extname(file_path).toLowerCase() !== '.csv') throw new Error('Only .csv files can be imported.');
      if (statSync(file_path).size > 10_000_000) throw new Error('File over 10MB.');
      csv = readFileSync(file_path, 'utf8');
    }
    if (!csv) throw new Error('Provide csv_text' + (allowFiles ? ' or file_path.' : '.'));
    return importCsv({ platform, kind, event, csv, columnMap: column_map });
  }));

  server.registerTool('upsert_event', {
    title: 'Create/update event', annotations: WR,
    description: 'Set event metadata the exports usually lack: date (ISO), city, venue, table and ticket capacity. Unlocks sell-through % and days-out pacing.',
    inputSchema: {
      name: z.string().min(1), date: z.string().optional().describe('ISO date, e.g. 2026-11-14'), city: z.string().optional(), venue: z.string().optional(),
      table_capacity: z.number().int().positive().optional(), ticket_capacity: z.number().int().positive().optional(),
    },
  }, wrap(({ name, date, city, venue, table_capacity, ticket_capacity }) => {
    if (date && Number.isNaN(Date.parse(date))) throw new Error('Unparseable date; use YYYY-MM-DD.');
    const ev = ensureEvent(name, { date: date && new Date(date).toISOString(), city, venue, tableCapacity: table_capacity, ticketCapacity: ticket_capacity });
    store.save();
    return ev;
  }));

  server.registerTool('set_costs', {
    title: 'Set event costs', annotations: WR,
    description: 'REPLACES the cost list for an event. Fixed costs (venue, insurance, security, marketing) have no per_unit; per-unit costs (e.g. table-side power, wristbands) set per_unit to "table" or "ticket".',
    inputSchema: { event, costs: z.array(z.object({ label: z.string(), amount: z.number().min(0), per_unit: z.enum(['table', 'ticket']).optional() })).max(50) },
  }, wrap(({ event, costs }) => {
    const ev = A.getEvent(event);
    ev.costs = costs.map((c) => ({ label: c.label, amount: c.amount, ...(c.per_unit ? { perUnit: c.per_unit } : {}) }));
    store.save();
    return { event: ev.id, costs: ev.costs };
  }));

  server.registerTool('add_note', {
    title: 'Add operator note', annotations: { ...WR, idempotentHint: false },
    description: 'Save a qualitative fact the exports cannot show (vendor complaints, venue terms, a promo that ran). Notes appear in context_brief so future conversations inherit them.',
    inputSchema: { text: z.string().min(1).max(1000), event: z.string().optional() },
  }, wrap(({ text: t, event }) => {
    const note = { at: new Date().toISOString(), text: t, event: event ? A.getEvent(event).id : null };
    store.get().notes.push(note);
    store.save();
    return note;
  }));

  server.registerPrompt('mcs_audit', {
    title: 'MCS periodic audit', description: 'Frame a deep-dive audit of MCS using Treasure/Eventeny data.',
  }, () => ({
    messages: [{ role: 'user', content: { type: 'text', text: 'Run an MCS audit. Call context_brief first and read its warnings. Then use sales_timeline and compare_events (with days_out) for pace, unit_economics for breakeven, and vendor_insights for retention. Stress-test assumptions, state what the data cannot show (exports are stale snapshots), and name tradeoffs before recommending anything.' } }],
  }));
}
