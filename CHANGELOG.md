# Changelog

All notable changes to the Yomo API. Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`. A MAJOR bump means a breaking change to `/api/v1` that the app has to be updated for.

## [Unreleased]

### Added
- Car ("عربيتي"), under `/api/v1/car`. `GET /car` returns `{ settings: { deviceName, deviceAddress, duaMode: "notif"|"page", duaVoice, prayerAlertMins, driveMode: "road"|"gauge", autoDriveMode }, parking: { lat, lng, accuracy, at }|null, odometerKm }` (defaults: `null`, `null`, `notif`, `true`, 10, `road`, `false`); `PATCH /car` `{ settings?: partial, odometerKm?: number|null }`; `PUT /car/parking` `{ lat, lng, accuracy?, at }` returns `{ parking }` (a report older than the stored one does not replace it).
- Trips: `PUT /car/trips/:clientId` upserts `{ startAt, endAt?, distanceKm?, purpose: "work"|"home"|"errand"|"travel"|null, startLoc?, endLoc?, duaPlayed?, prayerAlerts?: [{ prayer, at }] }` (only the fields sent change; a trip lasts at most 48 hours) and returns the trip with `date` (local) and `durationSec`. `GET /car/trips?from&to&limit` returns `{ items }` newest first; `DELETE /car/trips/:clientId` returns 204. `GET /car/trips/suggest-purpose?at=ISO` returns `{ purpose, count }` for the most common purpose on the same weekday within one hour in the last 60 days (`purpose: null` when unknown).
- Fuel: `POST /car/fuel` `{ clientId, amount, liters?, odometerKm?, full?, at, note? }` records an expense in "بنزين" (an ordinary transaction, so balances and undo work), a fuel log, and raises the car odometer. Returns `{ fuel, kmPerL }` (`201`, or `200` for a repeated `clientId`); `kmPerL` is the distance since the previous log with an odometer reading divided by the liters, or `null`. `GET /car/fuel?limit` returns `{ items }`.
- Maintenance: `GET`, `POST /car/maintenance` `{ title, everyKm?, everyMonths?, lastKm?, lastDate? }` (one interval is required), `PATCH`, `DELETE /car/maintenance/:id`, `POST /car/maintenance/:id/done` `{ date, km?, amount?, clientId? }` (`amount` is booked as an expense in "صيانة"). Items come back with `dueInKm`, `dueDate`, `dueInDays`, `progress` (0..1) and `overdue`, most urgent first.
- `GET /car/summary` returns `{ parking, weekDriveSec, monthCarExpenses, kmPerL, nextMaintenance, recentTrips, odometerKm }`.
- Car expense categories بنزين, صيانة, غسيل, مخالفات, جراج carry `group: "car"` (new optional field on categories). New accounts get them; existing accounts get them (idempotently) on the first `/car` call.
- Places ("أماكني"), under `/api/v1/places`: `GET`, `POST /places`, `PATCH`, `DELETE /places/:id` (`name`, `icon`, `color`, `lat`, `lng`, `radiusM` 50-1000 default 100, `kind`: `home|work|gym|mosque|other`), `PUT /places/visits/:clientId` `{ placeId, enterAt, exitAt? }`, `GET /places/visits?from&to`, and `GET /places/summary?range=day|week&date` with seconds and visit counts per place clipped to the day (or Saturday-Friday week) in the user's timezone; an open visit counts until now.

- Read-only web dashboard (`dashboard/`, React + Vite) served at `/dashboard/` by the same Vercel deployment: overview, money, health, worship, sleep and work, and habits pages in Arabic with light and dark themes. Vercel builds it into `public/dashboard` (`buildCommand` in `vercel.json`) and the Express app serves it, so it works with any Vercel framework preset; CI builds it too.
- Savings goals ("أهدافي"), under `/api/v1/savings`. A goal (`name`, `icon`, `color`, `target`, `deadline`, `note`, `status` `active|done|archived`) is money set aside inside the wallet: deposits and withdrawals are entries on the goal and never create a transaction or change the balance. `GET /savings?status` returns `{ items, totalSaved }`; goals carry `saved`, `percent`, `remaining` and, with a deadline and something left, `daysLeft`, `monthsLeft` and `perMonth`. `GET /savings/:id` adds `entries` (newest first). `POST /savings/:id/entries` `{ amount, kind: "deposit"|"withdraw", date?, note? }` (withdrawing more than saved gives 400 `WITHDRAW_EXCEEDS_SAVED`; reaching the target marks the goal `done` and returns `justCompleted: true`); `DELETE /savings/:id/entries/:entryId`.
- `GET /money/summary` gains `savings` `{ total, active }` and `available` (`balance - savings.total`).
- Work focus ("شغلي"), all under `/api/v1/work`. The app owns the running session and upserts it whole: `PUT /work/sessions/:clientId` `{ startedAt, endedAt: ISO|null, breaks: [{ start, end: ISO|null, kind: "rest"|"prayer", prayer? }], distractions: [{ at, app, appLabel?, openedAnyway, seconds }] }` (`clientId` is 8-64 characters of `A-Za-z0-9_-`). A session lasts at most 16 hours, breaks and distractions must lie inside it, an open break is only allowed while the session is open, at most 200 breaks and 500 distractions. Only one session may be open: another `endedAt: null` session gives 409 `SESSION_OPEN`. The session comes back with `date` (local date of `startedAt`), `workedSec` (span minus breaks minus seconds in distracting apps after "open anyway"; an open session counts up to now), `breakSec`, `prayerBreaks`, `distractedSec` and `wilted` (distractions opened anyway that lasted 5 minutes or more).
- `GET /work/sessions?from&to` (default last 30 days, at most 62) returns `{ sessions }`; `GET /work/current` returns `{ session }` (`null` when none is open); `DELETE /work/sessions/:clientId` returns 204 (also when it does not exist).
- `GET /work/week?start=YYYY-MM-DD` (a Saturday, default this week) returns `{ start, end, goalSec, totalSec, palms, wilted, prayerBreaks, distractions: { total, returned }, days: [{ date, workedSec, palms, wilted, sessions }] }`. A day's `palms` is its full hours of work.
- `GET /me` and `PATCH /me`: `settings.work` `{ weeklyGoalHours, autoDnd, keepScreenOn, breakReminderMin, distractingApps }`. Defaults: 25, `true`, `true`, 90 (`0` = off, otherwise 30-240), `[]`. `distractingApps` is `[{ package, label }]`, at most 30, replaced as a whole.
- Good habits ("عاداتي"), all under `/api/v1/habits`. A habit has a `kind` (`check`, `count` or `duration`), a `target` (always 1 for `check`), an optional `unit` (count only) and an optional `minTarget` ("minimum version", below the target, counts as kept), a `schedule` (`daily`, `weekdays` with `days` 0 = Saturday to 6 = Friday, or `perWeek` with `times` 1-7), a `startDate`, an optional routine and an `archived` flag. At most 60 habits and 20 routines (409 `HABIT_LIMIT` / `ROUTINE_LIMIT`).
- `GET /habits/today` returns `{ date, anchor, routines: [{ routine, habits }], other }` with a state for every active habit that has started: `value`, `done`, `minimum`, `kept`, `scheduledToday`, `week` (`{ kept, times }` for `perWeek`, else `null`), `streak` `{ current, unit, warning }`, `linked` and `establishing`. `GET /habits?archived=`, `POST /habits`, `PATCH /habits/:id` (the link cannot change: 400 `LINK_IMMUTABLE`) and `DELETE /habits/:id` (also deletes its logs).
- `PUT /habits/:id/logs/:date` `{ value }` logs a day (today back to 6 days ago; `0` removes the log) and returns the state for that date with the fresh streak. `GET /habits/:id/stats` returns the 30-day `consistency` and the 30 days before it (`previous`), the `streak` (`current`, `longest`, `unit`, `warning`, `nextMilestone`, `milestones` reached among 7, 21, 40 and 100) and a 35-day `heatmap` (`level` 0 none, 1 minimum, 2 done, 3 above target) and `days`.
- Streaks follow "never miss twice": a single missed scheduled day (or week, for `perWeek`) is forgiven and adds nothing, two in a row end the streak. Today (or this week) not being done yet is never a miss, and days before `startDate` are not misses. `warning` says the last scheduled day or week was missed. A habit is `establishing` for its first 21 days (3 weeks for `perWeek`) while its longest streak is shorter than that.
- Linked habits (`link: { source, params }`, fixed at creation) compute their value from existing data and cannot be logged by hand (409 `HABIT_LINKED`): `prayer_mosque` (`params.prayer`), `adhkar_morning`, `adhkar_evening`, `wird` (`params.pages`, a count of pages), `gym` (a finished session), `protein` (grams, target defaults to your protein target) and `sleep_before` (`params.time`, a night log that started at or before it, up to 06:00 the next morning).
- `GET /habits/suggestions` lists ready templates for the linked habits you have not created yet; each can be posted to `POST /habits` as it is.
- Routines: `GET`, `POST /habits/routines`, `PATCH`, `DELETE /habits/routines/:id` (deleting one frees its habits) and `PUT /habits/routines/:id/order` `{ habitIds }` to reorder the habits of a routine. An `anchor` is one of `after_fajr`, `morning`, `after_dhuhr`, `after_asr`, `after_maghrib`, `after_isha`, `before_sleep` or `anytime`.
- Private space storage: `GET /vault`, `PUT /vault` `{ expectedVersion, keyMeta, ciphertext }` and `DELETE /vault`. The server stores one opaque, client-encrypted blob per user (`keyMeta` up to 16 KB of JSON, `ciphertext` base64 up to 2 MB) and never reads it; writes are guarded by the version (409 `VAULT_EXISTS` when creating over an existing vault, 409 `VERSION_CONFLICT` otherwise). This route has its own 3 MB body limit; the other routes keep 100 KB. Nothing about it appears in any other response.
- Bank SMS logging (the app parses the SMS on the phone; the text is never sent). `POST /transactions` accepts `smsRef` (the dedupe key, at most 100 characters), `needsReview` and, through `smsRef`, marks the transaction `source: "sms"`. A repeat of the same `smsRef` returns the stored transaction with `200` instead of `201` and changes nothing, so retries and inbox rescans never double-record. Transactions gain `source` (`app` or `sms`), `needsReview` (an SMS transaction whose category is only a guess) and `smsRef`. `PATCH /transactions/:id` accepts `needsReview`; `GET /transactions?needsReview=true|false` filters.
- `GET /sms/merchants` and `PUT /sms/merchants` `{ key, categoryId }`: the category last used for each merchant (`key` is the merchant name normalised by the app), so the next SMS from it is filed the same way. Survives a reinstall.
- `GET /me` and `PATCH /me`: `settings.sms` `{ enabled, senders: [{ id, name, enabled }] }`. Off by default; the senders default to الأهلي (`19623,NBE`) and CIB (`19666,CIB`); an `id` may list aliases separated by commas. `senders` is replaced as a whole and ids must be unique (case-insensitive).
- Day close ("قفلة اليوم"): `PUT /days/:date/close` `{ mood?: 1-5|null, note?: <=200 chars, skipped?: boolean }` stores one close per day (today or yesterday in the user's timezone only; a later real close replaces a skip, a skip never replaces a real close) and returns it with the fresh streak. `GET /days/closes?from&to` (default last 30 days, at most 62) returns `{ from, to, today, closes, streak }`.
- Day-close streak: `streak` is `{ current, frozenDates, freezeAvailable }`. `current` counts consecutive closed days ending today, or yesterday while today is still open. A skipped or missing day is a miss; one miss per week (Saturday to Friday) is forgiven as a freeze and does not add to the count, a second miss in the same week ends the streak. Looks back 400 days.
- `GET /me` and `PATCH /me`: `settings.dayClose` `{ enabled, mode, time }` for the night alarm. Defaults: `enabled: true`, `mode: "fixed"` (or `"beforeSleep"`: 30 minutes before the planned bedtime), `time: "22:30"`. Existing accounts get the defaults.
- `GET /me` and `PATCH /me`: `settings.reminders` gains `cash` (default 18:00), `proteinLunch` (15:30) and `proteinNight` (22:00), each `{ enabled, time }` like `expenses` and `wird`. Existing accounts get the defaults.
- `POST /religion/wird` accepts `pages` (1 to 60) instead of `to`: the session continues from the last stop (or `from`) and ends on the last ayah of the mushaf page that many pages on. Send exactly one of `to` or `pages`.

- `GET /gym/my-exercises`: your personal exercise list grouped by muscle group (`chest`, `back`, `shoulders`, `legs`, `biceps`, `triceps`, `abs`). Starred exercises plus everything in your finished sessions, each with `timesDone` and `last` set. `PUT /gym/my-exercises/:exerciseId` `{ group }` stars an exercise, `DELETE` removes it (idempotent; it also stays out of the list when you have logged it). Deleting a custom exercise removes it from the list.

- `GET /exercises/:id`: library exercises gain `instructionsAr`, an Arabic translation of every instruction step (same count and order as `instructions`). Translations live in `scripts/data/exercises-instructions-ar.json`; the build checks every exercise has one Arabic step per English step.

- `GET /nutrition/foods`: every food gains `nameEn` and `unitEn`; search also matches the English name.

- Sleep ("نومي"): `GET /sleep` (open log, last 14 days, 7-day average, sleep debt, early-vs-late energy insight), `POST /sleep/start`, `POST /sleep/wake` (logs under 10 minutes are discarded), `POST /sleep`, `PATCH` and `DELETE /sleep/:id`. One open log per user.
- Sleep Quran: `GET /sleep/quran` (the sleep khatma position, seven curated picks and tonight's recommendation) and `PUT /sleep/quran/progress`.
- `GET /me` and `PATCH /me`: `settings.sleep` (`targetHours`, `wakeFor`, `wakeBeforeFajrMin`, `fallAsleepMin`, `timerMin`).
- `GET /adhkar?group=sleep` (13 items) and `group=waking` (4 items), generated by `scripts/build-adhkar.js`; existing groups are unchanged.

### Changed
- Empty instruction steps from the source data are dropped (two exercises had one).

## [1.3.0] - 2026-10-31

### Added
- Health: exercise library, gym tracking, protein tracking and body weight. All additive under `/api/v1`.
- `GET /exercises`, `GET /exercises/:id`: built-in library of 876 exercises (from [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db), Unlicense) with an English and an Arabic name for every exercise, Arabic-normalised search, muscle/equipment filters and a curated "popular" flag. `POST /exercises`, `DELETE /exercises/:id`: your own custom exercises.
- `/gym/templates` (CRUD), `/gym/sessions` (start from a template, edit, finish, history list, `current`, one open session per user), `GET /gym/exercises/:exerciseId/history` (last session, best set, e1RM points) and `GET /gym/attendance?month=` (days, count, streak of Saturday-Friday weeks). Sessions compute their volume and personal records on the server.
- `GET /nutrition/foods` (about 50 common Egyptian foods with protein per unit), `/nutrition/meals` (saved meals), `POST /nutrition/logs`, `DELETE /nutrition/logs/:id`, `GET /nutrition/days/:date`, `GET /nutrition/summary`.
- `GET /body/weights`, `PUT` and `DELETE /body/weights/:date`: daily body weight with a 7-day moving average, weekly change and goal weight.
- `GET /me` and `PATCH /me`: `settings.health` (`proteinPerKg`, `proteinTargetG`, `goalWeightKg`, `gymDays`). The effective protein target is `proteinTargetG`, else `proteinPerKg` x the latest 7-day average weight, else 120 g.
- `GET /today` gains a `health` block (`proteinG`, `proteinTargetG`, `gymToday`, `gymDone`, `weightLoggedToday`).
- `npm run build:exercises` regenerates `src/data/exercises.json` from `scripts/data`.

## [1.2.0] - 2026-10-31

### Added
- `GET /me` and `PATCH /me`: `settings` gains `location` (`null` or `{ label, lat, lng, source }`), `calcMethod`, `reminders` (per-prayer `enabled`/`offsetMin`, plus `expenses` and `wird` with `enabled`/`time`) and `privacy` (`hideOnLaunch`, `biometricLock`). Existing users get the defaults.
- `PATCH /me` deep-merges partial `reminders` and `privacy` updates; `location: null` clears the location. Unknown keys are rejected with a 400.

## [1.1.0] - 2026-10-31

### Added
- `GET /health` returns the API version (`{ "ok": true, "version": "1.1.0" }`).
- Every response carries an `X-Api-Version` header.

## [1.0.0] - 2026-10-31

### Added
- First release: auth, profile, categories, transactions, money summary, debts with payments, religion days, wird and progress, adhkar, Quran metadata, and the `/today` summary.
- Deployed on Vercel.

[1.3.0]: https://github.com/yomoapp/api/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/yomoapp/api/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/yomoapp/api/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/yomoapp/api/tree/v1.0.0
