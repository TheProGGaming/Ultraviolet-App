import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.MCS_MCP_DATA = join(mkdtempSync(join(tmpdir(), 'mcsmcp-')), 'db.json');
const sample = (f) => readFileSync(join(here, '..', 'samples', f), 'utf8');

const { parseCsv } = await import('../lib/csv.js');
const { importCsv, ensureEvent } = await import('../lib/importer.js');
const A = await import('../lib/analytics.js');
const storeMod = await import('../lib/store.js');

before(() => {
  ensureEvent('Tacoma Card Show', { date: '2026-09-12T00:00:00Z', tableCapacity: 10, ticketCapacity: 200, city: 'Tacoma' });
  ensureEvent('Santa Clara Show', { date: '2026-11-14T00:00:00Z', tableCapacity: 20, ticketCapacity: 500, city: 'Santa Clara' });
  importCsv({ platform: 'treasure', kind: 'orders', event: 'Tacoma Card Show', csv: sample('treasure-orders-tacoma.csv') });
  importCsv({ platform: 'treasure', kind: 'orders', event: 'Santa Clara Show', csv: sample('treasure-orders-santaclara.csv') });
  importCsv({ platform: 'eventeny', kind: 'vendors', event: 'Santa Clara Show', csv: sample('eventeny-vendors-santaclara.csv') });
});

test('csv parser handles quotes, embedded newlines, BOM', () => {
  const r = parseCsv('﻿a,b\r\n"x, y","line1\nline2"\r\n"he said ""hi""",z\r\n');
  assert.deepEqual(r.records, [{ a: 'x, y', b: 'line1\nline2' }, { a: 'he said "hi"', b: 'z' }]);
});

test('summary excludes refunds and classifies table vs ticket', () => {
  const s = A.summary(A.getEvent('tacoma'));
  assert.equal(s.tables.sold, 6);            // 2+1+3, refunded 1 excluded
  assert.equal(s.tables.revenue, 900);
  assert.equal(s.tables.sellThroughPct, 60);
  assert.equal(s.tickets.sold, 16);
  assert.equal(s.money.refundedOrVoidLines, 1);
  assert.ok(s.warnings.some((w) => /snapshot/.test(w)));
});

test('reimport is idempotent', () => {
  const before = Object.keys(storeMod.get().orders).length;
  const r = importCsv({ platform: 'treasure', kind: 'orders', event: 'Tacoma Card Show', csv: sample('treasure-orders-tacoma.csv') });
  assert.equal(r.added, 0);
  assert.equal(Object.keys(storeMod.get().orders).length, before);
});

test('vendor statuses and insights', () => {
  const v = A.vendorInsights(A.getEvent('santa clara'));
  assert.equal(v.applications, 5);
  assert.equal(v.approved, 3);
  assert.equal(v.pending, 1);
  assert.equal(v.approvalRatePct, 75); // 3 approved / (3 approved + 1 declined)
});

test('repeat vendor across events needs vendor data from both', () => {
  importCsv({ platform: 'eventeny', kind: 'vendors', event: 'Tacoma Card Show', csv: 'Business Name,Email,Application Status\nPNW Slabs,pnwslabs@example.com,Approved\nOther,o@example.com,Approved' });
  const v = A.vendorInsights(null);
  assert.equal(v.vendorsApprovedAtMoreThanOneEvent, 1);
});

test('days-out pace comparison is like-for-like', () => {
  const rows = A.compare([A.getEvent('tacoma'), A.getEvent('santa clara')], 60);
  // 60 days before Tacoma (Sep 12) = Jul 14 -> only T-1001 + T-1002 = 3 tables
  assert.equal(rows[0].tablesSoldAt60DaysOut, 3);
});

test('economics: breakeven and refusal without costs', () => {
  const ev = A.getEvent('tacoma');
  assert.throws(() => A.economics(ev), /set_costs/);
  ev.costs = [{ label: 'Venue', amount: 1000 }, { label: 'Insurance', amount: 200 }, { label: 'Power', amount: 10, perUnit: 'table' }];
  const e = A.economics(ev, { targetProfit: 500 });
  assert.ok(e.breakevenTables > 0 && e.tablesForTargetProfit > e.breakevenTables);
  assert.equal(e.contributionPerTable > 0, true);
});

test('column mismatch gives actionable error and column_map fixes it', () => {
  const csv = 'Zed,Foo\nTable,$100';
  assert.throws(() => importCsv({ platform: 'treasure', kind: 'orders', event: 'X', csv }), /column_map/);
  const r = importCsv({ platform: 'treasure', kind: 'orders', event: 'X', csv, columnMap: { amount: 'Foo', item: 'Zed' } });
  assert.equal(r.added, 1);
});
