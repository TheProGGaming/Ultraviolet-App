import * as store from './store.js';

const DAY = 86400000;
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

export function getEvent(idOrName) {
  const { events } = store.get();
  const key = String(idOrName).toLowerCase();
  const hit = events[key] || Object.values(events).find((e) => e.name.toLowerCase() === key) ||
    Object.values(events).find((e) => e.id.includes(key.replace(/[^a-z0-9]+/g, '-')));
  if (!hit) throw new Error(`Unknown event "${idOrName}". Known: ${Object.values(events).map((e) => e.id).join(', ') || '(none; import data first)'}`);
  return hit;
}

const ordersOf = (ev) => Object.values(store.get().orders).filter((o) => o.event === ev.id);
const vendorsOf = (ev) => Object.values(store.get().vendors).filter((v) => v.event === ev.id);

function dataQuality(ev, orders, vendors) {
  const w = [];
  const imps = store.get().imports.filter((i) => i.event === ev.id);
  const platforms = [...new Set([...orders, ...vendors].map((x) => x.platform))];
  if (!imps.length) w.push('No imports recorded for this event.');
  else {
    const last = Math.max(...imps.map((i) => Date.parse(i.at)));
    const age = Math.floor((Date.now() - last) / DAY);
    w.push(`Data is a snapshot from CSV exports (last import ${age}d ago), not a live feed. Anything sold since then is missing.`);
  }
  if (!ev.date) w.push('Event date not set: days-out pacing unavailable (use upsert_event).');
  if (!ev.tableCapacity) w.push('Table capacity not set: sell-through % unavailable.');
  if (!ev.ticketCapacity) w.push('Ticket capacity not set.');
  if (orders.some((o) => o.kind === 'other')) w.push(`${orders.filter((o) => o.kind === 'other').length} order lines couldn't be classified as table/ticket and are excluded from those totals.`);
  if (orders.some((o) => !o.date)) w.push('Some orders have no parseable date, so they are missing from timelines.');
  if (platforms.length < 2 && platforms.length) w.push(`Only ${platforms[0]} data loaded for this event.`);
  return w;
}

export function summary(ev) {
  const orders = ordersOf(ev), vendors = vendorsOf(ev);
  const live = orders.filter((o) => !o.void);
  const voided = orders.filter((o) => o.void);
  const tables = live.filter((o) => o.kind === 'table');
  const tickets = live.filter((o) => o.kind === 'ticket');
  const tablesSold = sum(tables, (o) => o.qty), ticketsSold = sum(tickets, (o) => o.qty);
  const tableRev = sum(tables, (o) => o.amount), ticketRev = sum(tickets, (o) => o.amount);
  const gross = sum(live, (o) => o.amount), fees = sum(live, (o) => o.fees);
  const byStatus = {};
  for (const v of vendors) byStatus[v.status] = (byStatus[v.status] || 0) + 1;
  const approvedTables = sum(vendors.filter((v) => v.status === 'approved'), (v) => v.tables);
  const costs = ev.costs || [];
  const fixed = sum(costs.filter((c) => !c.perUnit), (c) => c.amount);
  const variable = sum(costs.filter((c) => c.perUnit), (c) => c.amount * (c.perUnit === 'table' ? tablesSold : ticketsSold));
  return {
    event: { id: ev.id, name: ev.name, date: ev.date, city: ev.city, venue: ev.venue, daysOut: ev.date ? Math.ceil((Date.parse(ev.date) - Date.now()) / DAY) : null },
    tables: {
      sold: tablesSold, capacity: ev.tableCapacity, sellThroughPct: ev.tableCapacity ? r2((tablesSold / ev.tableCapacity) * 100) : null,
      revenue: r2(tableRev), avgPrice: tablesSold ? r2(tableRev / tablesSold) : null,
    },
    tickets: {
      sold: ticketsSold, capacity: ev.ticketCapacity, sellThroughPct: ev.ticketCapacity ? r2((ticketsSold / ev.ticketCapacity) * 100) : null,
      revenue: r2(ticketRev), avgPrice: ticketsSold ? r2(ticketRev / ticketsSold) : null,
    },
    vendorApplications: { total: vendors.length, byStatus, approvedTablesPerApplications: approvedTables },
    money: { gross: r2(gross), platformFees: r2(fees), netOfFees: r2(gross - fees), refundedOrVoidLines: voided.length, refundedOrVoidAmount: r2(sum(voided, (o) => o.amount)) },
    costs: { fixed: r2(fixed), variable: r2(variable), total: r2(fixed + variable) },
    profit: costs.length ? r2(gross - fees - fixed - variable) : null,
    tableRevenueShare: gross ? r2((tableRev / gross) * 100) : null,
    warnings: dataQuality(ev, orders, vendors),
  };
}

export function timeline(ev, { bucket = 'day', kind = 'all' } = {}) {
  const live = ordersOf(ev).filter((o) => !o.void && o.date && (kind === 'all' || o.kind === kind));
  const eventT = ev.date ? Date.parse(ev.date) : null;
  const m = new Map();
  for (const o of live.sort((a, b) => a.date.localeCompare(b.date))) {
    const d = new Date(o.date);
    if (bucket === 'week') d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const key = d.toISOString().slice(0, 10);
    const row = m.get(key) || { period: key, units: 0, revenue: 0 };
    row.units += o.qty; row.revenue += o.amount;
    m.set(key, row);
  }
  let cu = 0, cr = 0;
  return [...m.values()].map((r) => {
    cu += r.units; cr += r.revenue;
    return { ...r, revenue: r2(r.revenue), cumulativeUnits: cu, cumulativeRevenue: r2(cr), daysOut: eventT ? Math.round((eventT - Date.parse(r.period)) / DAY) : null };
  });
}

/** Units sold on/before N days before the show: apples-to-apples pace across events. */
export function soldAtDaysOut(ev, daysOut, kind = 'table') {
  if (!ev.date) return null;
  const cutoff = Date.parse(ev.date) - daysOut * DAY;
  return sum(ordersOf(ev).filter((o) => !o.void && o.kind === kind && o.date && Date.parse(o.date) <= cutoff), (o) => o.qty);
}

export function compare(evs, daysOut) {
  return evs.map((ev) => {
    const s = summary(ev);
    return {
      event: s.event.name, date: s.event.date, city: s.event.city,
      tablesSold: s.tables.sold, tableSellThroughPct: s.tables.sellThroughPct, avgTablePrice: s.tables.avgPrice,
      ticketsSold: s.tickets.sold, gross: s.money.gross, profit: s.profit,
      ...(daysOut !== undefined ? { [`tablesSoldAt${daysOut}DaysOut`]: soldAtDaysOut(ev, daysOut) } : {}),
    };
  });
}

export function economics(ev, { targetProfit = 0 } = {}) {
  const s = summary(ev);
  const costs = ev.costs || [];
  if (!costs.length) throw new Error(`No costs recorded for ${ev.name}. Use set_costs first (venue, insurance, staffing, marketing…).`);
  const fixed = s.costs.fixed;
  const perTable = sum(costs.filter((c) => c.perUnit === 'table'), (c) => c.amount);
  const perTicket = sum(costs.filter((c) => c.perUnit === 'ticket'), (c) => c.amount);
  const avgTicketNet = (s.tickets.avgPrice || 0) - perTicket;
  const feeRate = s.money.gross ? s.money.platformFees / s.money.gross : 0;
  const tableMargin = s.tables.avgPrice ? s.tables.avgPrice * (1 - feeRate) - perTable : null;
  const ticketContribution = s.tickets.sold * avgTicketNet * (1 - feeRate);
  const out = { assumptions: { feeRatePct: r2(feeRate * 100), perTableCost: perTable, perTicketCost: perTicket, ticketsHeldAtCurrentSales: s.tickets.sold }, fixedCosts: fixed, currentProfit: s.profit, tablesSold: s.tables.sold, avgTablePrice: s.tables.avgPrice, contributionPerTable: tableMargin === null ? null : r2(tableMargin) };
  if (tableMargin > 0) {
    out.breakevenTables = Math.ceil(Math.max(0, fixed - ticketContribution) / tableMargin);
    out.tablesForTargetProfit = Math.ceil(Math.max(0, fixed + targetProfit - ticketContribution) / tableMargin);
    out.capacity = ev.tableCapacity;
    out.breakevenPctOfCapacity = ev.tableCapacity ? r2((out.breakevenTables / ev.tableCapacity) * 100) : null;
    out.targetFitsInCapacity = ev.tableCapacity ? out.tablesForTargetProfit <= ev.tableCapacity : null;
  } else out.note = 'Average table price does not cover per-table cost after fees; no table-count breakeven exists. Fix pricing or cost structure.';
  out.warnings = s.warnings;
  return out;
}

const normKey = (v) => (v.email || v.name).toLowerCase().replace(/[^a-z0-9@.]/g, '');

export function vendorInsights(evFilter) {
  const all = Object.values(store.get().vendors);
  const vendors = evFilter ? all.filter((v) => v.event === evFilter.id) : all;
  const approved = vendors.filter((v) => v.status === 'approved');
  const byCat = {};
  for (const v of approved) { const c = (v.category || 'unspecified').toLowerCase().slice(0, 40); byCat[c] = (byCat[c] || 0) + 1; }
  const appearances = new Map();
  for (const v of all.filter((x) => x.status === 'approved')) {
    const k = normKey(v);
    appearances.set(k, (appearances.get(k) || new Set()).add(v.event));
  }
  const repeat = [...appearances.values()].filter((s) => s.size > 1).length;
  const decided = vendors.filter((v) => ['approved', 'rejected', 'waitlist'].includes(v.status)).length;
  return {
    scope: evFilter ? evFilter.name : 'all events',
    applications: vendors.length,
    approved: approved.length,
    approvalRatePct: decided ? r2((approved.length / decided) * 100) : null,
    pending: vendors.filter((v) => v.status === 'pending').length,
    waitlist: vendors.filter((v) => v.status === 'waitlist').length,
    approvedByCategory: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 15),
    vendorsApprovedAtMoreThanOneEvent: repeat,
    totalDistinctApprovedVendors: appearances.size,
    repeatRatePct: appearances.size ? r2((repeat / appearances.size) * 100) : null,
    caveat: 'Vendor identity is matched on email, else name. Repeat rate is only meaningful once 2+ events are imported.',
  };
}

export function searchVendors({ query = '', status, event, includeContact = false, limit = 25 }) {
  const q = query.toLowerCase();
  let rows = Object.values(store.get().vendors);
  if (event) rows = rows.filter((v) => v.event === event.id);
  if (status) rows = rows.filter((v) => v.status === status);
  if (q) rows = rows.filter((v) => `${v.name} ${v.contact} ${v.category} ${v.instagram}`.toLowerCase().includes(q));
  return rows.slice(0, limit).map((v) => ({
    name: v.name, event: v.event, status: v.status, category: v.category, tables: v.tables, price: v.price, instagram: v.instagram, website: v.website,
    ...(includeContact ? { contact: v.contact, email: v.email, phone: v.phone } : {}),
  }));
}

export function brief(evFilter) {
  const db = store.get();
  const evs = evFilter ? [evFilter] : Object.values(db.events).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const lines = ['# Maximum Card Show: Treasure/Eventeny data brief', `Generated ${new Date().toISOString().slice(0, 10)}. Source: manual CSV exports, not live.`, ''];
  for (const ev of evs) {
    const s = summary(ev);
    lines.push(`## ${s.event.name}${s.event.date ? ` (${s.event.date.slice(0, 10)}, ${s.event.daysOut}d out)` : ''}${s.event.city ? ` · ${s.event.city}` : ''}`);
    lines.push(`- Tables: ${s.tables.sold}${s.tables.capacity ? `/${s.tables.capacity} (${s.tables.sellThroughPct}%)` : ''}, $${s.tables.revenue} @ avg $${s.tables.avgPrice ?? 'n/a'}`);
    lines.push(`- Tickets: ${s.tickets.sold}${s.tickets.capacity ? `/${s.tickets.capacity}` : ''}, $${s.tickets.revenue} @ avg $${s.tickets.avgPrice ?? 'n/a'}`);
    lines.push(`- Gross $${s.money.gross}, fees $${s.money.platformFees}, refunds/voids ${s.money.refundedOrVoidLines} lines ($${s.money.refundedOrVoidAmount})`);
    lines.push(`- Vendor applications: ${s.vendorApplications.total} ${JSON.stringify(s.vendorApplications.byStatus)}`);
    if (s.profit !== null) lines.push(`- Costs $${s.costs.total} → profit $${s.profit}`);
    for (const w of s.warnings) lines.push(`- ⚠ ${w}`);
    lines.push('');
  }
  const notes = db.notes.filter((n) => !evFilter || n.event === evFilter.id).slice(-10);
  if (notes.length) { lines.push('## Operator notes'); notes.forEach((n) => lines.push(`- ${n.at.slice(0, 10)}${n.event ? ` [${n.event}]` : ''}: ${n.text}`)); }
  return lines.join('\n');
}
