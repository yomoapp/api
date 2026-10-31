# Yomo API

Backend for Yomo, a single-user personal life tracker (money + religion). Express 4, MongoDB (Mongoose), zod, JWT auth. Plain JavaScript (CommonJS), Node >= 20.19.

## Setup

```bash
npm install
cp .env.example .env     # then fill in the values
npm run dev              # or: npm start
```

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB connection string. Must be a replica set (debt writes use transactions); Atlas, including the free M0 tier, always is. A local standalone `mongod` will not work: start it with `--replSet` and run `rs.initiate()` |
| `JWT_ACCESS_SECRET` | yes | random string, >= 16 chars (use 32+), must differ from the refresh secret |
| `JWT_REFRESH_SECRET` | yes | random string, >= 16 chars |
| `PORT` | no | default `3000` (Railway sets it) |
| `CORS_ORIGIN` | no | comma separated allowed browser origins; empty = no CORS headers |
| `ALLOWED_EMAILS` | no | comma separated emails (case-insensitive). When set, `POST /auth/register` only accepts these (403 `REGISTRATION_CLOSED` otherwise). **Recommended on Railway**: this is a personal app, so set it to your own email(s) once you have registered. Empty = open registration |
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
| `npm run build:exercises` | regenerate `src/data/exercises.json` from `scripts/data/free-exercise-db.json` + `scripts/data/exercises-ar.json` (see Data sources) |
| `node scripts/build-adhkar.js <hisn_almuslim.json> <azkar.json>` | regenerate `src/data/adhkar.json` (see Data sources) |
| `npm run seed:adhkar` | optional: sync `adhkar.json` into the `adhkar` collection (replaces documents, deletes ones no longer in the JSON; needs only `MONGODB_URI`) |

## Versioning

The API uses [Semantic Versioning](https://semver.org). The version in `package.json` is the API version. `GET /health` returns it, and every response carries it in the `X-Api-Version` header. Changes are listed in `CHANGELOG.md`.
- **PATCH:** bug fixes.
- **MINOR:** new endpoints or fields, nothing removed.
- **MAJOR:** breaking changes. Those go under a new `/api/v2` prefix, so app versions already installed keep working on `/api/v1`.

**To release:** bump `version` in `package.json` (`npm version minor --no-git-tag-version`), add a `CHANGELOG.md` section, merge to `main`, then tag the merge commit `v<version>`.

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
| POST | `/auth/refresh` | `{ refreshToken }` -> new token pair; 401 if the token was revoked by a logout |
| POST | `/auth/logout` | (authenticated) revokes all refresh tokens of the account by bumping its `tokenVersion`; 204 |
| GET, PATCH | `/me` | profile + settings (`name`, `currency`, `timezone` (IANA), `wirdDailyPages`, `location` (or `null`), `calcMethod`, `reminders`, `privacy`, `health`; partial updates are deep-merged) |
| GET | `/today` | balance, today's expense, today's religion day, wird status + next start, suggested adhkar (morning before 15:00 local, evening after), `health` (today's protein vs target, today's gym template, gym done, weight logged) |
| GET, POST | `/categories` | list (`?includeArchived=true`, `?type=`; the system category `ديون` is hidden unless `?includeSystem=true`) / add |
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
| GET | `/exercises?q&muscle&equipment&page&limit` | exercise library (876) plus your custom ones first; `q` matches English or Arabic names (Arabic-normalised); popular exercises first |
| GET | `/exercises/:id` | one exercise; library ones include `instructions` and `instructionsAr` (Arabic translation, same step order) |
| POST | `/exercises` | custom exercise `{ nameAr, name?, equipment, primaryMuscles[1..3] }` |
| DELETE | `/exercises/:id` | custom exercises only (404 for library ones) |
| GET, POST | `/gym/templates` | workout templates `{ name, exerciseIds[<=30] }` |
| PATCH, DELETE | `/gym/templates/:id` | edit / delete (also clears it from `settings.health.gymDays`) |
| GET, POST | `/gym/sessions` | list (`?from&to`, summaries) / start `{ date, templateId?, name? }` (409 `SESSION_OPEN` while another session is open) |
| GET | `/gym/sessions/current` | the open session or 404 |
| GET, PATCH, DELETE | `/gym/sessions/:id` | PATCH `{ name?, exercises?, endedAt? }` replaces the exercises and recomputes `volumeKg` and `prs`; `endedAt` finishes the session |
| GET | `/gym/exercises/:exerciseId/history?limit` | `{ last, best, points[{ date, topWeightKg, topReps, e1rmKg }] }` |
| GET | `/gym/attendance?month=YYYY-MM` | training days of the month, `count`, `streakWeeks` (weeks run Saturday to Friday) |
| GET | `/nutrition/foods?q` | built-in Egyptian foods with protein per unit (`nameAr`/`nameEn`, `unitAr`/`unitEn`) |
| GET, POST | `/nutrition/meals` | saved meals `{ nameAr, proteinG, emoji? }`, most used first |
| PATCH, DELETE | `/nutrition/meals/:id` | edit / delete |
| POST | `/nutrition/logs` | log protein `{ date, nameAr, proteinG, qty?, mealId?, foodId? }`; `mealId` bumps the meal's `useCount` |
| DELETE | `/nutrition/logs/:id` | remove a log entry |
| GET | `/nutrition/days/:date` | entries, `totalG` and the effective `targetG` of a day |
| GET | `/nutrition/summary?from&to` | per-day totals (default last 7 days, max 92) and `avgG` over days with entries |
| GET | `/body/weights?from&to` | entries with `avg7`, plus `latestAvg7`, `changeWeek`, `goalWeightKg` (default last 90 days, max 400) |
| PUT, DELETE | `/body/weights/:date` | upsert `{ kg }` (30-300) / delete |

### Debts and transactions

Creating a `lent` debt records an expense (money left your wallet); `borrowed` records an income. A payment on a `lent` debt is an income, on a `borrowed` debt an expense. All of these are ordinary transactions in the system category `ديون`, linked by `debtId`, so the balance stays consistent. They cannot be edited or deleted through `/transactions`; use the debt endpoints. The system category cannot be chosen for ordinary transactions (400 `SYSTEM_CATEGORY`) and is hidden from `GET /categories` by default, but debt amounts still appear under it in `/money/summary`. A debt stores its start `date` and returns it. Changing a debt's `amount` keeps `remaining = amount - sum(payments)` and updates the opening transaction; changing `person` rewrites the auto-generated notes of its transactions. Every debt write (create, payment, delete payment, edit, delete) runs in one MongoDB transaction (`session.withTransaction`), so a debt and its transactions never get out of sync. This requires a replica set (Atlas always is).

### Wird

Positions are `{ surah, ayah }`. A session's `ayahs` is the inclusive ayah count across surahs and `pages` the number of distinct mushaf pages from the page of `from` to the page of `to`. `from` defaults to the ayah after the previous session's `to`; after 114:6 it wraps to 1:1 and `khatmaNo` increments. `khatmasCompleted` is the number of distinct khatmas that reached 114:6.

### Health

Lift weights are kg rounded to 0.25, protein grams and body weight kg to 0.1. The estimated one-rep max is `weight x (1 + reps / 30)` (rounded to 0.5 in history points). A session's `prs` lists, per exercise, the done set with the best e1RM when it beats the best e1RM of every earlier session with that exercise (by date, then start time); an exercise with no earlier lift has no PR. `volumeKg` is the sum of `weight x reps` over done sets. `GET /gym/exercises/:id/history` only looks at finished sessions and done sets with a weight.

`avg7` is the mean of the entries in the 7 days ending on that date. `changeWeek` is the latest `avg7` minus the `avg7` seven days before it (`null` without data in that earlier window). The effective protein target is `settings.health.proteinTargetG`, else `round(proteinPerKg x latestAvg7)`, else 120 g.

### Religion stats definitions

`onTimePercent` = on_time / prayers with a status (missed counts as recorded). `mosquePercent`, `jamaahPercent`, `congregationPercent` are shares of prayers that have a place set. `sunnahPercent` = done / existing rawatib slots over prayers that were prayed (on_time, late or qada). Week = last 7 days, month = last 30 days, including today.

## Data sources

The Quran and adhkar datasets were not typed by hand; the Arabic exercise names and the foods list were written for this project.

- **Quran metadata** (`src/data/quran-meta.json`): generated by `scripts/build-quran-meta.js` from the npm package [`quran-meta`](https://www.npmjs.com/package/quran-meta) (Hafs, 604-page Madani mushaf). 114 surahs, 6236 ayahs, the page of every ayah (pages 1..604), Arabic and transliterated names.
- **Adhkar** (`src/data/adhkar.json`): generated by `scripts/build-adhkar.js` from two public Hisn al-Muslim transcriptions (fetched from raw.githubusercontent.com and only ever parsed as JSON). Every item carries a `source` field naming its dataset.
  - `morning` (23 items) and `evening` (21 items): the chapter "أذكار الصباح والمساء" of [rn0x/hisn_almuslim_json](https://github.com/rn0x/hisn_almuslim_json) (`hisn_almuslim.json`), a direct transcription of Hisn al-Muslim. The chapter's preface line is skipped. Items the source restricts by time of day are placed accordingly: "إذا أصبح" items (the x100 tahlil, the x3 "سبحان الله وبحمده عدد خلقه", "علماً نافعاً") are morning only; "إذا أمسى" ("أعوذ بكلمات الله التامات" x3) is evening only. Item 4 is split at the source's own "وإذا أمسى" into its morning and evening wording; items whose source text is in morning wording only (3, 6, 7, 15, 16: "أصبحنا", "أصبحت", "هذا اليوم") take their evening wording from the matching "أذكار المساء" rows of osamayy/azkar-db (matched by the build script, never typed by hand), as their `source` says. A narrator lead-in ("من قال:") is dropped, and the count note "أو مرة واحدة عند الكسل" is moved to a `note` field. Repeat counts are read from the parenthetical counts in the source text (x3, x4, x7, x10, x100); the parenthetical is dropped from `text` and stored as `repeat`. The previous morning/evening lists, taken from osamayy/azkar-db, contained items that are not in Hisn al-Muslim and were removed.
  - `after_prayer` (8 items), `travel` (11), `istikhara` (1): from [osamayy/azkar-db](https://github.com/osamayy/azkar-db) `azkar.json` (fully vowelled text), and every item is cross-checked by the build script against the matching chapter of rn0x/hisn_almuslim_json (the build fails if an item does not match). Item 7 of `after_prayer` ("لا إله إلا الله وحده لا شريك له ... يحيي ويميت" x10, "بعد صلاة المغرب والصبح") is marked `onlyAfter: ["fajr","maghrib"]` and `repeat: 10`; item 8 ("علماً نافعاً ... بعد السلام من صلاة الفجر") is marked `onlyAfter: ["fajr"]`. Both markers are stated in the source text; the rest apply to every prayer.
  - `GET /adhkar` serves the bundled JSON directly. `npm run seed:adhkar` is optional and only mirrors it into MongoDB.
  - Other counts written inside the text (e.g. "x33" in the post-prayer tasbih) stay in the text with `repeat: 1`.
  - Rebuild: `node scripts/build-adhkar.js <hisn_almuslim.json> <azkar.json>`.
- **Exercise library** (`src/data/exercises.json`): generated by `scripts/build-exercises.js` from [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db) (`dist/exercises.json`, released under the Unlicense / public domain, kept as `scripts/data/free-exercise-db.json`: 876 exercises with English names, muscles, equipment, instructions and images hosted on raw.githubusercontent.com). `scripts/data/exercises-ar.json` maps every exercise id to an Arabic name in Egyptian gym vocabulary (written for this project; a test fails if any exercise lacks one), and the script holds the curated list of popular gym exercises. Missing equipment becomes `other`. Rebuild: `npm run build:exercises`.
- **Egyptian foods** (`src/data/foods-eg.json`): about 50 common foods with approximate protein per stated unit, curated by hand for this app.

## Testing

`npm test` runs `node:test` suites. Pure-logic and HTTP-layer tests always run. Integration tests need a MongoDB **replica set** (the API uses transactions): by default they start a single-node in-memory replica set via `mongodb-memory-server` (which downloads a MongoDB binary on first use). Alternatives:

```bash
TEST_MONGODB_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0' npm test   # use an existing replica set
MONGOMS_SYSTEM_BINARY=/usr/bin/mongod npm test          # use a local mongod binary
```

If MongoDB cannot be started, the integration tests are skipped with a clear message rather than failing, unless `REQUIRE_DB=1` is set (CI sets it, so the database tests can never be skipped silently there).

## Deploy: Vercel + MongoDB Atlas

`api/index.js` wraps the Express app as a single Vercel function and `vercel.json` rewrites every path to it, so the URLs are the same as on a normal server (`/health`, `/api/v1/...`). The Mongo connection is cached between warm invocations.

1. Atlas: same as below. Vercel has no fixed outbound IPs, so allow `0.0.0.0/0` and use a strong database password. Put a database name in the URI, e.g. `mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/yomo`.
2. Vercel: Add New -> Project -> import `yomoapp/api`. Framework preset "Other"; leave build and output settings empty.
3. Environment Variables: `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (two different random strings, at least 16 characters; e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` twice), `ALLOWED_EMAILS`. Then deploy.
4. Check `https://<project>.vercel.app/health`.

## Deploy: Railway + MongoDB Atlas

1. Atlas: create a free M0 cluster, a database user, and allow network access (Railway uses dynamic IPs, so `0.0.0.0/0` with a strong password, or Railway's static outbound IPs if you have them). Copy the `mongodb+srv://...` connection string and include a database name, e.g. `/yomo`.
2. Railway: New Project -> Deploy from GitHub repo. `railway.json` sets the start command and the `/health` healthcheck.
3. In the service Variables, set `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (and optionally `CORS_ORIGIN`). Also set `ALLOWED_EMAILS` to your own email address(es) after registering, so nobody else can create an account on your public URL. Do not commit secrets. Railway provides `PORT`.
4. Deploy, then check `https://<your-app>/health`.
