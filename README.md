# Yomo API

Backend for Yomo, a single-user personal life tracker (money + religion). Express 4, MongoDB (Mongoose), zod, JWT auth. Plain JavaScript (CommonJS), Node >= 20.

## Setup

```bash
npm install
cp .env.example .env     # then fill in the values
npm run dev              # or: npm start
```

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB connection string (Atlas or local) |
| `JWT_ACCESS_SECRET` | yes | random string, >= 16 chars (use 32+), must differ from the refresh secret |
| `JWT_REFRESH_SECRET` | yes | random string, >= 16 chars |
| `PORT` | no | default `3000` (Railway sets it) |
| `CORS_ORIGIN` | no | comma separated allowed browser origins; empty = no CORS headers |
| `RATE_LIMIT_MAX` | no | max auth requests per IP per 15 min (default 30) |

Generate secrets with `openssl rand -hex 32`.

### Scripts

| Script | Does |
|---|---|
| `npm start` | `node src/server.js` |
| `npm run dev` | start with `--watch` |
| `npm test` | run all tests (see Testing) |
| `npm run lint` | eslint (flat config) |
| `npm run build:quran` | regenerate `src/data/quran-meta.json` from the `quran-meta` devDependency |
| `node scripts/build-adhkar.js <azkar.json>` | regenerate `src/data/adhkar.json` from the azkar-db dataset |
| `npm run seed:adhkar` | optional: idempotently upsert adhkar into the `adhkar` collection |

## Conventions

- All routes are under `/api/v1`, except `GET /health` (returns `{ "ok": true }`, no auth).
- Everything except `/auth/*` requires `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes, refresh tokens 30 days.
- Amounts are integer piasters (150.50 EGP = `15050`).
- Dates are `YYYY-MM-DD` strings in the user's timezone (default `Africa/Cairo`). "Today" is computed in that timezone.
- Balance is never stored; it is `sum(income) - sum(expense)` over transactions.
- Errors: `{ "error": { "code", "message", "details?" } }`. Validation errors are 400. Anything not owned by the caller is 404.
- List endpoints return `{ items, ... }`; paginated ones also return `page, limit, total, totalPages`.

## Endpoints

| Method | Path | |
|---|---|---|
| POST | `/auth/register` | create account + default categories; returns `{ user, accessToken, refreshToken }` |
| POST | `/auth/login` | tokens + user |
| POST | `/auth/refresh` | `{ refreshToken }` -> new token pair |
| GET, PATCH | `/me` | profile + settings (`name`, `currency`, `timezone` (IANA), `wirdDailyPages`) |
| GET | `/today` | balance, today's expense, today's religion day, wird status + next start, suggested adhkar (morning before 15:00 local, evening after) |
| GET, POST | `/categories` | list (`?includeArchived=true`, `?type=`) / add |
| PATCH, DELETE | `/categories/:id` | edit / archive (system categories: 403) |
| GET | `/transactions?from&to&type&categoryId&page&limit` | newest first, with per-day totals (`dayTotals`) for the days on the page |
| POST | `/transactions` | category must be yours, not archived, and match `type` |
| PATCH, DELETE | `/transactions/:id` | 409 `DEBT_LINKED` if the transaction belongs to a debt |
| GET | `/money/summary?month=YYYY-MM` | income/expense/net, breakdown by category, balance, debts summary |
| GET, POST | `/debts?direction&status` | list / create (creates the opening transaction) |
| GET, PATCH, DELETE | `/debts/:id` | details with payments / edit / delete (also deletes its transactions) |
| POST | `/debts/:id/payments` | record payment + transaction, reduces `remaining`, settles at 0 |
| DELETE | `/debts/:id/payments/:paymentId` | reverse a payment (and its transaction) |
| GET | `/religion/days?from&to` | days in range (max 62), empty defaults for unsaved days |
| PUT | `/religion/days/:date` | partial upsert; unspecified fields are kept |
| GET, POST | `/religion/wird` | list sessions / add a session (`{ to:{surah,ayah}, from?, date? }`) |
| DELETE | `/religion/wird/:id` | latest session only (409 otherwise) |
| GET | `/religion/wird/progress` | last stop, next start, percent, pages, average, expected finish, streak, khatmas |
| GET | `/religion/stats?period=week\|month` | prayer / sunnah / witr / adhkar stats |
| GET | `/adhkar?group&prayer` | adhkar texts |
| GET | `/quran/meta` | 114 surahs with names, ayah counts, first/last page |

### Debts and transactions

Creating a `lent` debt records an expense (money left your wallet); `borrowed` records an income. A payment on a `lent` debt is an income, on a `borrowed` debt an expense. All of these are ordinary transactions in the system category `ديون`, linked by `debtId`, so the balance stays consistent. They cannot be edited or deleted through `/transactions`; use the debt endpoints. Changing a debt's `amount` keeps `remaining = amount - sum(payments)` and updates the opening transaction. No multi-document MongoDB transactions are used (they need a replica set); writes are ordered with compensation on failure.

### Wird

Positions are `{ surah, ayah }`. A session's `ayahs` is the inclusive ayah count across surahs and `pages` the number of distinct mushaf pages from the page of `from` to the page of `to`. `from` defaults to the ayah after the previous session's `to`; after 114:6 it wraps to 1:1 and `khatmaNo` increments. `khatmasCompleted` is the number of distinct khatmas that reached 114:6.

### Religion stats definitions

`onTimePercent` = on_time / prayers with a status (missed counts as recorded). `mosquePercent`, `jamaahPercent`, `congregationPercent` are shares of prayers that have a place set. `sunnahPercent` = done / existing rawatib slots over prayers that were prayed (on_time, late or qada). Week = last 7 days, month = last 30 days, including today.

## Data sources

Neither dataset was typed by hand.

- **Quran metadata** (`src/data/quran-meta.json`): generated by `scripts/build-quran-meta.js` from the npm package [`quran-meta`](https://www.npmjs.com/package/quran-meta) (Hafs, 604-page Madani mushaf). 114 surahs, 6236 ayahs, the page of every ayah (pages 1..604), Arabic and transliterated names.
- **Adhkar** (`src/data/adhkar.json`): generated by `scripts/build-adhkar.js` from `azkar.json` of [osamayy/azkar-db](https://github.com/osamayy/azkar-db) (Hisn al-Muslim, fetched from raw.githubusercontent.com). Each item carries a `source` field (dataset plus the reference when the dataset has one).
  - `morning`: 31 items, `evening`: 30 items (the dataset's "أذكار الصباح" / "أذكار المساء", with its repeat counts).
  - `after_prayer`: 8 items from "الأذكار بعد السلام من الصلاة". Item 7 ("لا إله إلا الله وحده لا شريك له ... يحيي ويميت" x10) is marked `onlyAfter: ["fajr","maghrib"]`; item 8 (the fajr supplication for beneficial knowledge) is marked `onlyAfter: ["fajr"]`. The rest apply to every prayer. These markers are derived from the item text itself.
  - `travel`: 11 items (riding, travel du'a, entering a town, traveler/resident du'as, takbir on the road, dawn, stopping, returning) from the matching dataset categories.
  - `istikhara`: 1 item (the istikhara du'a).
  - `GET /adhkar` serves the bundled JSON directly. `npm run seed:adhkar` is optional and only mirrors it into MongoDB.
  - Repeat counts come from the dataset's `count` column where present (morning/evening), plus the explicit "ten times" item. Other items default to `1`; counts written inside the text (e.g. "x33") stay in the text.

## Testing

`npm test` runs `node:test` suites. Pure-logic and HTTP-layer tests always run. Integration tests need MongoDB: by default they start `mongodb-memory-server` (which downloads a MongoDB binary on first use). Alternatives:

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test     # use an existing MongoDB
MONGOMS_SYSTEM_BINARY=/usr/bin/mongod npm test          # use a local mongod binary
```

If MongoDB cannot be started, the integration tests are skipped with a clear message rather than failing.

## Deploy: Railway + MongoDB Atlas

1. Atlas: create a free M0 cluster, a database user, and allow network access (Railway uses dynamic IPs, so `0.0.0.0/0` with a strong password, or Railway's static outbound IPs if you have them). Copy the `mongodb+srv://...` connection string and include a database name, e.g. `/yomo`.
2. Railway: New Project -> Deploy from GitHub repo. `railway.json` sets the start command and the `/health` healthcheck.
3. In the service Variables, set `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (and optionally `CORS_ORIGIN`). Do not commit secrets. Railway provides `PORT`.
4. Deploy, then check `https://<your-app>/health`.
