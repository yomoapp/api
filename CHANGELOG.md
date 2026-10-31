# Changelog

All notable changes to the Yomo API. Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`. A MAJOR bump means a breaking change to `/api/v1` that the app has to be updated for.

## [Unreleased]

### Added
- `GET /exercises/:id`: library exercises gain `instructionsAr`, an Arabic translation of every instruction step (same count and order as `instructions`). Translations live in `scripts/data/exercises-instructions-ar.json`; the build checks every exercise has one Arabic step per English step.

- `GET /nutrition/foods`: every food gains `nameEn` and `unitEn`; search also matches the English name.

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
