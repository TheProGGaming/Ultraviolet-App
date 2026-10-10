// Fixture data so the app is explorable before a Meta app is approved.
// Clearly labelled "demo" in the UI; never written as real leads unless the user saves them.
const P = (username, name, bio, followers, website, posts = []) => ({
  username, name, bio, website, followers, following: 400, mediaCount: 300, picture: '', posts,
});
const post = (id, caption, extra = {}) => ({ id, caption, media_type: 'IMAGE', permalink: `https://www.instagram.com/p/${id}/`, timestamp: new Date().toISOString(), like_count: 40, comments_count: 5, ...extra });

const PROFILES = {
  pnwslabs: P('pnwslabs', 'PNW Slabs', 'Graded Pokémon & sports cards | Seattle WA | Dealer — tables at every show | bookings: pnwslabs@gmail.com', 3200, 'https://pnwslabs.example', [post('D1', 'Table 14 this weekend at the Tacoma card show! WTS PSA 10 Prizm rookies')]),
  baycitybreaks: P('baycitybreaks', 'Bay City Breaks', 'Case breaks Mon/Thu | San Jose | whatnot: baycitybreaks | DM for spots', 12100, 'https://whatnot.example/baycitybreaks', [post('D2', 'Topps Chrome case break tonight 7pm. Need vendors for the Santa Clara show? DM!')]),
  junglejoescards: P('junglejoescards', 'Joe', 'just a guy chasing Jordan rookies. PC collector. Denver', 240, '', [post('D3', 'pickups from the swap meet today')]),
  slabsupplyco: P('slabsupplyco', 'Slab Supply Co', 'Toploaders, sleeves, storage & grading submissions — wholesale for card shops. sales@slabsupply.example', 8800, 'https://slabsupply.example', []),
};

export const profile = (u) => {
  if (PROFILES[u]) return PROFILES[u];
  throw Object.assign(new Error(`Demo mode only knows: ${Object.keys(PROFILES).join(', ')}. Connect Instagram for real lookups.`), { status: 404 });
};

export const hashtagPosts = (tag) => [
  { ...post('H1', `Setting up for the show tomorrow! Come find us at table 22 @pnwslabs #${tag} #cardshow`), source: `#${tag}` },
  { ...post('H2', `Looking for a table at a big Bay Area card show next year, any organizers? @baycitybreaks #${tag}`), source: `#${tag}` },
  { ...post('H3', `Nothing much, just pulled a hit from a pack rip #${tag}`), source: `#${tag}` },
];
export const tagged = () => [{ ...post('T1', 'Great turnout @maximumcardshow, see you in Santa Clara!'), username: 'baycitybreaks', source: 'tagged you' }];
export const commenters = () => [
  { username: 'junglejoescards', text: 'Is there a Denver show this year??', timestamp: new Date().toISOString(), permalink: 'https://www.instagram.com/p/D3/' },
  { username: 'slabsupplyco', text: 'Do you take sponsors? We do toploaders', timestamp: new Date().toISOString(), permalink: 'https://www.instagram.com/p/D4/' },
];
