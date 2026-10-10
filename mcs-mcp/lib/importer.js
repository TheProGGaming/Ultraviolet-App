import { parseCsv } from './csv.js';
import { mapHeaders, normalizeVendor, normalizeOrder, slug } from './normalize.js';
import * as store from './store.js';

export function ensureEvent(name, patch = {}) {
  const db = store.get();
  const id = slug(name);
  if (!id) throw new Error('Event name required');
  const ev = db.events[id] || { id, name, date: null, city: '', venue: '', tableCapacity: null, ticketCapacity: null, costs: [] };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null && v !== '') ev[k] = v;
  db.events[id] = ev;
  return ev;
}

export function importCsv({ platform, kind, event, csv, columnMap = {} }) {
  const { headers, records } = parseCsv(csv);
  if (!headers.length) throw new Error('CSV is empty or has no header row');
  const { mapping, unmapped } = mapHeaders(kind === 'vendors' ? 'vendors' : 'orders', headers, columnMap);
  const required = kind === 'vendors' ? ['name'] : ['amount'];
  const missing = required.filter((f) => !mapping[f] && !(f === 'name' && mapping.contact));
  if (missing.length) {
    throw new Error(`Could not find a column for: ${missing.join(', ')}. Headers seen: ${headers.join(' | ')}. Retry with column_map, e.g. {"${missing[0]}": "<exact header>"}.`);
  }
  const ev = ensureEvent(event);
  const db = store.get();
  const bucket = kind === 'vendors' ? db.vendors : db.orders;
  let added = 0, updated = 0, skipped = 0;
  records.forEach((rec, i) => {
    const n = (kind === 'vendors' ? normalizeVendor : normalizeOrder)(rec, mapping, { platform, event: ev.id, rowIndex: i });
    if (!n) { skipped++; return; }
    bucket[n.id] ? updated++ : added++;
    bucket[n.id] = n;
  });
  const report = { platform, kind, event: ev.id, rows: records.length, added, updated, skipped, mapped: mapping, unmapped, at: new Date().toISOString() };
  db.imports.push(report);
  store.save();
  return report;
}
