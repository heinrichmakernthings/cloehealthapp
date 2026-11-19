# Cloe's Cozy Club

A local-first health tracking web app with cute rewards, Biscuits interactions, cloud backup and a smart insights dashboard.

## Pages
- `/` — the app (Cloe). No password.
- `/insights` — charts, correlations, food triggers, cycle patterns and a printable doctor summary.
- `/admin` — Sam's controls (PIN): countdowns, streak rewards, XP coupons, cloud backup, pairing link, backups.

## How it fits together
- `public/` — static files served by the Worker (`index.html`, `admin.html`, `insights.html`, `vendor/`).
- `src/worker.js` — the `/api/*` backend.
- Cloudflare D1 database `cloehealthapp-db` holds settings, the synced copy of Cloe's data, and rolling snapshots.

## Data safety
- Cloe's data lives in her browser's `localStorage` (`cloeHealthQuestV1`) and, once her phone is paired, is backed up to D1.
- Deploying new code never touches her data, as long as the domain and the storage key stay the same.
- A snapshot of the previous cloud copy is kept every 6 hours and whenever entries are removed (120 kept).
- Settings from `/admin` are cached on her phone (`cloeAppConfigV1`) so the app works offline.

## Deploy
The Worker `cloehealthapp` is connected to this repo with Workers Builds: every push to `main` runs `npx wrangler deploy`.

## Local dev
```
npm install
npx wrangler d1 execute cloehealthapp-db --local --file=schema.sql
npx wrangler dev
```
