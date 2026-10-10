# MCS Lead Finder

Browse Instagram for Maximum Card Show leads (vendors, collectors, sponsors) and work them through a pipeline.
Zero dependencies, Node 20+.

```
cd mcs-leads
npm start        # http://localhost:3100  (starts in Demo mode with sample data)
npm test
```

## Why the official API and not a "proxy browser"

This repo's parent project is a web proxy, and the obvious move is to route a logged-in Instagram session through it
and scrape. Don't. It violates Meta's terms, trips bot detection, and the thing that gets restricted is the
**MCS account itself**, which is also your ad and community channel. This app uses the Instagram Graph API instead.

## What it can and can't see

| Feature | Source | Limit |
|---|---|---|
| Hashtag browse (`#seattlecardshow`) | `ig_hashtag_search` + `recent_media`/`top_media` | **30 unique hashtags / 7 days.** The API does **not** return the post author, so the app surfaces `@handles` in the caption and lets you look them up. |
| Profile lookup | Business Discovery | Only **Business/Creator** accounts. Private/personal accounts return an error (add them manually). |
| Inbound: tagged you / commenters | `/tags`, `/comments` on your own media | Your own account only. These are your warmest leads. |
| Outreach | Templates you copy | **No auto-DM by design.** Automation is the fastest route to an action block. |

Scoring (`lib/scoring.js`) is keyword heuristics: card category, vendor/collector/sponsor signals, mention of shows,
MCS market (PNW / Bay Area / Mountain West / SoCal), email/website in bio, follower band. Tune the word lists to taste;
reasons are shown on every lead so you can see why it scored.

## Connect Instagram

1. Instagram account → **Business** or **Creator**, linked to a Facebook Page you admin.
2. [developers.facebook.com](https://developers.facebook.com) → create an app (type *Business*), add **Instagram Graph API** + Facebook Login.
3. Permissions: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management`, `instagram_manage_comments`,
   and **Instagram Public Content Access** (needed for hashtag search; requires App Review for use outside app roles).
   While the app is in development mode and you are an admin/tester, it works for your own account without review.
4. Add `http://localhost:3100/auth/callback` as a valid OAuth redirect URI, put `META_APP_ID` / `META_APP_SECRET` in `.env`
   (see `.env.example`), restart, then **Instagram → Connect with Facebook**.
   Alternative: paste a long-lived token and numeric IG user id from Graph API Explorer.

Long-lived tokens last ~60 days; reconnect when the header pill warns.

## Notes

- Data: `data/db.json` (gitignored, mode 600; it holds your token). Back it up if the pipeline matters.
- Binds to `127.0.0.1` and rejects cross-origin writes. If you deploy it, put real auth in front first; it has none.
- CSV export neutralises spreadsheet formulas in scraped bios/notes.
- Unofficial scraper behavior (fetching other users' followers, DMing at scale) is intentionally not implemented.
