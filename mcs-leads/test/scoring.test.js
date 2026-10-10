import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, extractHandles, extractEmail, detectMarket, tier } from '../lib/scoring.js';

test('vendor in an MCS market scores hot', () => {
  const r = scoreLead({ bio: 'Graded Pokémon & sports cards | Seattle WA | Dealer, tables at every show | a@b.com', followers: 3200, website: 'https://x.example', captions: ['Table 14 this weekend at the card show'] });
  assert.equal(r.type, 'vendor');
  assert.equal(r.market, 'Pacific Northwest');
  assert.equal(r.email, 'a@b.com');
  assert.equal(tier(r.score), 'hot');
});

test('casual collector is not a vendor and scores lower', () => {
  const r = scoreLead({ bio: 'just a guy chasing Jordan rookies. PC collector.', followers: 240 });
  assert.equal(r.type, 'attendee');
  assert.ok(r.score < 35);
});

test('sponsor detection', () => {
  assert.equal(scoreLead({ bio: 'Toploaders, sleeves, storage wholesale for card shops', followers: 8800 }).type, 'sponsor');
});

test('unrelated account scores ~0', () => {
  assert.ok(scoreLead({ bio: 'yoga and smoothies', followers: 50 }).score < 10);
});

test('extractHandles ignores email domains and dedupes', () => {
  assert.deepEqual(extractHandles('DM @Shop_One or mail me@gmail.com, thanks @shop_one @b.c'), ['shop_one', 'b.c']);
});

test('extractEmail', () => assert.equal(extractEmail('x foo.bar@baz.co y'), 'foo.bar@baz.co'));
test('detectMarket', () => assert.equal(detectMarket('based in San Jose, CA'), 'Bay Area'));
