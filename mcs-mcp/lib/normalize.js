// Maps arbitrary Treasure / Eventeny export columns onto a stable internal schema.
// Export layouts aren't publicly documented, so matching is alias-based and every import
// reports exactly which columns it did and didn't understand. Override with column_map.
import { createHash } from 'node:crypto';

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const ALIASES = {
  vendors: {
    name: ['businessname', 'business', 'company', 'vendorname', 'vendor', 'boothname', 'shopname', 'name', 'applicant'],
    contact: ['contactname', 'contact', 'fullname', 'firstandlastname', 'owner'],
    email: ['email', 'emailaddress', 'contactemail'],
    phone: ['phone', 'phonenumber', 'mobile'],
    status: ['status', 'applicationstatus', 'state', 'decision'],
    category: ['category', 'vendorcategory', 'type', 'producttype', 'whatdoyousell', 'productsold', 'description'],
    tables: ['tables', 'numberoftables', 'tablecount', 'qty', 'quantity', 'booths', 'spaces'],
    price: ['price', 'total', 'amount', 'boothfee', 'tablefee', 'fee', 'totalpaid', 'paid'],
    appliedAt: ['appliedat', 'applicationdate', 'submitted', 'submittedat', 'dateapplied', 'createdat', 'date'],
    instagram: ['instagram', 'ig', 'instagramhandle', 'social'],
    website: ['website', 'url', 'site'],
  },
  orders: {
    orderId: ['orderid', 'order', 'ordernumber', 'transactionid', 'confirmation', 'id', 'ticketid'],
    item: ['item', 'itemname', 'ticket', 'tickettype', 'product', 'productname', 'description', 'name', 'booth', 'tabletype', 'type'],
    kind: ['category', 'ordertype', 'kind'],
    qty: ['qty', 'quantity', 'tickets', 'count', 'tables'],
    amount: ['total', 'amount', 'gross', 'price', 'ordertotal', 'subtotal', 'grossamount', 'totalpaid'],
    fees: ['fees', 'fee', 'servicefee', 'processingfee', 'platformfee'],
    status: ['status', 'orderstatus', 'paymentstatus'],
    buyer: ['buyer', 'buyername', 'customer', 'customername', 'purchaser', 'attendee', 'vendor', 'vendorname', 'businessname'],
    email: ['email', 'buyeremail', 'customeremail', 'emailaddress'],
    date: ['date', 'orderdate', 'purchasedate', 'createdat', 'purchasedat', 'paidat', 'datepurchased'],
  },
};

/** @returns {{mapping:Record<string,string>, unmapped:string[]}} field -> original header */
export function mapHeaders(kind, headers, override = {}) {
  const aliases = ALIASES[kind];
  const mapping = {};
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  for (const [field, header] of Object.entries(override)) if (headers.includes(header)) mapping[field] = header;
  for (const [field, list] of Object.entries(aliases)) {
    if (mapping[field]) continue;
    const hit = list.find((a) => byNorm.has(a));
    if (hit) mapping[field] = byNorm.get(hit);
  }
  // an exact-alias header should only feed one field; first (more specific) field wins
  const used = new Set();
  for (const f of Object.keys(aliases)) {
    if (!mapping[f]) continue;
    if (used.has(mapping[f]) && !override[f]) delete mapping[f];
    else used.add(mapping[f]);
  }
  return { mapping, unmapped: headers.filter((h) => !used.has(h)) };
}

export function parseMoney(v) {
  if (v === undefined || v === null || v === '') return 0;
  const s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

export function parseDate(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function vendorStatus(v = '') {
  const s = v.toLowerCase();
  if (/wait/.test(s)) return 'waitlist';
  if (/reject|declin|denied|not approved/.test(s)) return 'rejected';
  if (/cancel|withdr|refund/.test(s)) return 'cancelled';
  if (/approv|accept|confirm|paid|complete|active/.test(s)) return 'approved';
  if (/pend|submit|review|appl|new|invit/.test(s) || !s) return 'pending';
  return 'pending';
}

export function orderKind(item = '', explicit = '') {
  const s = `${explicit} ${item}`.toLowerCase();
  if (/table|booth|vendor|dealer|space|exhibitor/.test(s)) return 'table';
  if (/ticket|admission|entry|general|\bga\b|vip|early|attendee|pass|door/.test(s)) return 'ticket';
  return 'other';
}

export const isVoid = (status = '') => /refund|cancel|void|fail|declin/.test(status.toLowerCase());

export const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const digest = (...parts) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

export function normalizeVendor(rec, m, ctx) {
  const g = (f) => (m[f] ? rec[m[f]] : '');
  const name = g('name') || g('contact');
  if (!name) return null;
  const email = g('email').toLowerCase();
  const out = {
    name, contact: g('contact'), email, phone: g('phone'),
    status: vendorStatus(g('status')), category: g('category'),
    tables: Math.max(1, parseInt(g('tables'), 10) || 1), price: parseMoney(g('price')),
    appliedAt: parseDate(g('appliedAt')), instagram: g('instagram').replace(/^@|https?:\/\/(www\.)?instagram\.com\//g, '').replace(/\/$/, ''),
    website: g('website'),
    event: ctx.event, platform: ctx.platform,
  };
  out.id = `${ctx.platform}:${ctx.event}:${digest(email || name.toLowerCase())}`;
  return out;
}

export function normalizeOrder(rec, m, ctx) {
  const g = (f) => (m[f] ? rec[m[f]] : '');
  const amount = parseMoney(g('amount'));
  const item = g('item');
  if (!item && !amount && !g('orderId')) return null;
  const out = {
    orderId: g('orderId'), item, kind: orderKind(item, g('kind')),
    qty: Math.max(1, parseInt(g('qty'), 10) || 1), amount, fees: parseMoney(g('fees')),
    status: g('status'), void: isVoid(g('status')),
    buyer: g('buyer'), email: g('email').toLowerCase(), date: parseDate(g('date')),
    event: ctx.event, platform: ctx.platform,
  };
  out.id = `${ctx.platform}:${ctx.event}:${out.orderId || digest(item, out.buyer, out.date, amount, ctx.rowIndex)}:${out.orderId ? digest(item) : ''}`;
  return out;
}
