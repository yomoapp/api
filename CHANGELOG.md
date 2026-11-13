# Changelog

All notable changes to the Yomo API. Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`. A MAJOR bump means a breaking change to `/api/v1` that the app has to be updated for.

## [1.14.0] - 2026-11-13

### Added
- Dashboard: add, edit and delete data for every module (money, categories, debts, savings, weight, protein, gym templates and weekly plan, gym sessions, habits and routines, prayers, wird, sleep, work sessions, day close), a settings page covering every `/me` setting and SMS merchants, and a page for car, places and listening rules. No API changes.

## [1.13.1] - 2026-11-13

### Added
- Car `settings.driveMode` accepts `map` (the drive screen's map mode).

## [1.13.0] - 2026-11-10

### Added
- `settings.listen.watchAll` (boolean, default `true`): every app the user opens counts in screen time, and `watchApps` is ignored. `false` counts only `watchApps`.

### Changed
- `settings.listen.watchApps` takes up to 300 apps (was 30), so "select all" fits. `PUT /listen/screen/:date` takes up to 200 apps a day (was 100).

## [1.12.0] - 2026-11-10

### Added
- Gym session ("سيشن الجيم"): `PATCH /gym/sessions/:id` accepts `cardio` `{ warmupSec?, cooldownSec? }` (integers 0-7200; only the fields sent change) and `challenge` `{ exerciseId, kind: "weight"|"reps", weightKg (0-1000, rounded to 0.25), reps (1-100), met }` or `null` to clear. Both are stored and returned on every session: `cardio` is always `{ warmupSec, cooldownSec }` (0 when unset) and `challenge` is `null` when unset.
- `GET /gym/stats` returns `{ totalSessions, streakWeeks, totalVolumeKg, totalPrs, lastSessionDate }`: finished sessions only, except `streakWeeks`, which uses the same logic as `/gym/attendance`; `lastSessionDate` is `null` with no finished session.

## [1.11.0] - 2026-11-10

### Added
- Car trips keep their GPS route. `PUT /car/trips/:clientId` accepts an optional `path`: up to 5000 `[lat, lng]` pairs (lat -90..90, lng -180..180). Sending `path` replaces the stored route; leaving it out keeps it.
- `GET /car/trips/:clientId` returns one trip including `path` (`[]` when none), or 404.
- `GET /car/trips?withPath=true|1` includes `path` on each item. Without it, lists (and `recentTrips` in `GET /car/summary`) do not include `path`.

## [1.10.0] - 2026-11-10

### Added
- Listening and screen time ("سمعي"), under `/api/v1/listen`. The phone records what plays (media sessions, via notification access) and its watch-app usage (Usage Access); the API classifies, stores and reports. Everything is optional: nothing here blocks an app.
- `POST /listen/segments` `{ segments: [{ clientId, pkg, appLabel, title, artist, album, startAt, endAt, green, greenLabel }] }` (at most 500) upserts by `clientId` (so a retry never duplicates) and returns `{ saved }`. Seconds, local `date` and `kind` (`song|quran|podcast|lesson|video|other`, with `kindSource` `auto|rule`) are computed on the server; segments shorter than 10 seconds are dropped and not counted in `saved`. Quran is never a song: Yomo's own player, Quran and reciter keywords (Arabic and Latin, diacritics ignored) and rules all win over the music-app and artist heuristics.
- `GET /listen/classifier` returns `{ quranWords, lessonWords, podcastWords, musicPkgs, videoPkgs, podcastPkgs, rules }` (words already normalized) so the phone can mirror the classification for its live alert.
- `GET /listen/day?date` returns `{ date, totals: { song, quran, podcast, lesson, video, other }, greenSongSeconds, segments }` (newest first). `GET /listen/items?from&to` (default last 7 days, at most 92) returns `{ from, to, items: [{ title, artist, pkg, appLabel, kind, kindSource, plays, seconds }] }` grouped by title and artist, most seconds first, 100 at most.
- Rules: `GET /listen/rules` returns `{ items: [{ id, field, value, kind }] }`; `PUT /listen/rules` `{ field: "title"|"artist"|"pkg", value, kind }` upserts (the value is normalized: lowercase, no diacritics or tatweel, أإآ=ا, ى=ي, ة=ه) and returns the rule; `DELETE /listen/rules/:id` returns 204. Both re-classify all the user's segments. Priority: title, then artist, then app.
- `POST /listen/reasons` `{ reason: "bored"|"stressed"|"driving"|"working"|"habit"|"other", songSeconds, at }` (201) stores the answer to the "why?" prompt.
- `GET /listen/streak?today` returns `{ days: [{ date, status }] (last 56 days, oldest first), current, best, todayStatus }`. A day is `none` (before the first ever segment), `clean` (under a minute of songs), `ok` (songs, but under a minute in green windows and under `dailySongLimitMins` when set) or `bad`. The streak follows "never miss twice": a single bad day adds nothing and does not break it, two bad days in a row end it.
- `GET /listen/report?from&to` (default last 7 days, at most 92) returns `{ from, to, totals, daily: [{ date, song, quran, other, greenSongSeconds }], byContext: { driving, work, beforeSleep, other }, byHour (24 values), topSongs, topArtists, topReciters (5 each), reasons, prev: { song, quran }, bestDay: { date, song }|null }`. Song seconds are split by overlap with car trips (driving), work sessions (work) and the 90 minutes before a night sleep log (beforeSleep), in that priority.
- `PUT /listen/screen/:date` `{ apps: [{ pkg, label, seconds, opens }], firstPickupAt, firstApp: { pkg, label }|null, lateSeconds }` upserts a day of watch-app usage. `GET /listen/screen?from&to` (default last 7 days, at most 62) returns `{ days (one per date, empty days included), apps (totals), prevTotalSeconds, equivalents: { gymSessions, workDays, quranPages } }`: the period's total seconds divided by the user's own average finished gym session (last 60 days, 60 minutes if none), average focused work day (6 hours if none) and 2 minutes per Quran page, rounded to one decimal.
- `GET /me` and `PATCH /me`: `settings.listen` `{ dailySongLimitMins, greenAfterFajrUntil, greenAfterAdhanMins, greenBeforeBedMins, greenAlert, whyPrompt, whyAfterMins, fridayStory, watchApps, appLimits }`. Defaults: `null` (off, otherwise 0-600), `"09:00"` (or `null`), 30 (0-120, 0 = off), 60 (0-240, 0 = off), `true`, `true`, 40 (10-240), `true`, YouTube, TikTok, Instagram and Facebook, `[]`. `watchApps` is `[{ pkg, label }]` and `appLimits` `[{ pkg, label, mins }]` (1-1440); both are at most 30, unique by `pkg` and replaced as a whole.

## [Unreleased]

### Added
- Work focus ("شغلي") 1.9.0: `settings.work.dailyGoalSessions` (integer 1-20, default 6), `settings.work.startReminder` `{ enabled: false, time: "09:00", days: [0,1,2,3,4] }` (`time` is `HH:mm`; `days` are unique weekday numbers 0 = Sunday .. 6 = Saturday, default Sunday-Thursday), both on `PATCH /me` and returned in `GET /me`. The reminder itself is scheduled on the phone.
- Work sessions accept an optional `rating` on `PUT /work/sessions/:clientId`: integer 1 (distracted), 2 (good), 3 (very focused) or `null`. It is stored and returned on every session (`null` when unrated); a PUT that does not send `rating` keeps the stored one, so older apps do not erase it.
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
- Timed focus sessions (Pomodoro) in "شغلي" (1.8.0): a session may carry `plannedSec` (integer 60-14400, or `null`/absent for an open-ended session) on `PUT /work/sessions/:clientId`; it is stored and returned on every session. Sessions and `GET /work/week` gain `focusSessions` (sessions that have a `plannedSec`; 0 or 1 on a single session) and `completedSessions` (those whose `workedSec` reached `plannedSec`), also per day in the week report. Existing fields are unchanged.
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
