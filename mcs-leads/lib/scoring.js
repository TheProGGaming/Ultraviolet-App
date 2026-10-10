// Heuristic lead scoring for a trading-card show. Pure functions, easy to tune.

export const MARKETS = {
  'Pacific Northwest': ['seattle', 'tacoma', 'portland', 'spokane', 'tukwila', 'everett', 'bellevue', 'vancouver wa', 'oregon', 'washington', 'pnw', 'beaverton', 'salem or'],
  'Bay Area': ['bay area', 'san jose', 'santa clara', 'oakland', 'san francisco', 'sf', 'fremont', 'sacramento', 'norcal', 'sunnyvale', 'milpitas', 'concord'],
  'Mountain West': ['denver', 'colorado', 'utah', 'salt lake', 'boise', 'idaho', 'las vegas', 'reno', 'phoenix', 'arizona', 'mountain west', 'slc', 'aurora co'],
  'Southern California': ['los angeles', 'la ', 'socal', 'san diego', 'anaheim', 'irvine', 'long beach', 'orange county', 'riverside', 'pasadena', 'southern california', 'inland empire'],
};

const VENDOR_WORDS = ['dealer', 'vendor', 'for sale', 'wtb', 'wts', 'selling', 'shop', 'store', 'cards', 'breaks', 'breaker', 'case break', 'inventory', 'consign', 'table', 'booth', 'lcs', 'collectibles', 'graded', 'slabs', 'dm to buy', 'paypal', 'whatnot', 'ebay'];
const CATEGORY_WORDS = ['pokemon', 'pokémon', 'sports cards', 'baseball', 'basketball', 'football', 'hockey', 'topps', 'panini', 'prizm', 'bowman', 'tcg', 'mtg', 'magic the gathering', 'yugioh', 'yu-gi-oh', 'one piece', 'lorcana', 'psa', 'bgs', 'sgc', 'cgc', 'rookie', 'auto', 'rc '];
const ATTENDEE_WORDS = ['collector', 'pc ', 'player collection', 'grail', 'pickups', 'pick up', 'hobby', 'binder', 'chasing', 'set builder', 'pulled', 'pack rip', 'hit'];
const SHOW_WORDS = ['card show', 'cardshow', 'convention', 'expo', 'swap meet', 'trade night', 'show this weekend', 'see you at'];
const SPONSOR_WORDS = ['grading', 'supplies', 'sleeves', 'toploader', 'storage', 'insurance', 'distributor', 'wholesale', 'media', 'podcast', 'youtube', 'streamer'];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const HANDLE_RE = /(?<![\w.])@([a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?)/gi;

export const extractEmail = (text = '') => (text.match(EMAIL_RE) || [])[0] || '';

export function extractHandles(text = '') {
  const out = new Set();
  for (const m of text.matchAll(HANDLE_RE)) {
    // skip the domain part of emails (user@gmail.com leaves "gmail.com" after @)
    const before = text[m.index - 1];
    if (before && /[\w.]/.test(before)) continue;
    out.add(m[1].toLowerCase());
  }
  return [...out];
}

const hits = (text, words) => words.filter((w) => text.includes(w));

export function detectMarket(text = '') {
  const t = ` ${text.toLowerCase()} `;
  for (const [market, words] of Object.entries(MARKETS)) {
    if (words.some((w) => t.includes(w.endsWith(' ') ? w : ` ${w}`) || t.includes(`${w},`) || t.includes(`${w}.`))) return market;
  }
  return '';
}

/**
 * @param {{bio?:string, captions?:string[], followers?:number, website?:string, mediaCount?:number}} p
 * @returns {{score:number, type:string, market:string, email:string, reasons:string[]}}
 */
export function scoreLead(p) {
  const bio = (p.bio || '').toLowerCase();
  const caps = (p.captions || []).join(' \n ').toLowerCase();
  const all = `${bio} \n ${caps}`;
  const reasons = [];
  let score = 0;

  const add = (pts, why) => {
    score += pts;
    reasons.push(`+${pts} ${why}`);
  };

  const cat = hits(all, CATEGORY_WORDS);
  if (cat.length) add(Math.min(20, 8 + cat.length * 3), `card category: ${cat.slice(0, 3).join(', ')}`);

  const vendor = hits(all, VENDOR_WORDS);
  const attendee = hits(all, ATTENDEE_WORDS);
  const sponsor = hits(bio, SPONSOR_WORDS);
  if (vendor.length) add(Math.min(25, 10 + vendor.length * 4), `vendor signals: ${vendor.slice(0, 3).join(', ')}`);
  if (attendee.length && !vendor.length) add(Math.min(12, 5 + attendee.length * 2), `collector signals: ${attendee.slice(0, 2).join(', ')}`);
  if (sponsor.length) add(10, `sponsor/partner signals: ${sponsor.slice(0, 2).join(', ')}`);

  const show = hits(all, SHOW_WORDS);
  if (show.length) add(15, 'actively talks about card shows');

  const market = detectMarket(`${bio} ${caps}`);
  if (market) add(15, `in MCS market: ${market}`);

  const email = extractEmail(p.bio);
  if (email) add(8, 'email in bio');
  if (p.website) add(4, 'website in bio');

  const f = Number(p.followers) || 0;
  if (f >= 500 && f < 5000) add(7, `${f} followers (active local seller range)`);
  else if (f >= 5000 && f < 50000) add(10, `${f} followers (strong reach)`);
  else if (f >= 50000) add(6, `${f} followers (reach, but harder to land)`);
  else if (f > 0 && f < 100) add(-5, 'under 100 followers');

  let type = 'unknown';
  if (sponsor.length && sponsor.length >= vendor.length) type = 'sponsor';
  else if (vendor.length >= 2 || (vendor.length && cat.length)) type = 'vendor';
  else if (attendee.length || cat.length) type = 'attendee';

  return { score: Math.max(0, Math.min(100, score)), type, market, email, reasons };
}

export const tier = (s) => (s >= 60 ? 'hot' : s >= 35 ? 'warm' : 'cold');
