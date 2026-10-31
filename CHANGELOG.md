# Changelog

All notable changes to the Yomo API. Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`. A MAJOR bump means a breaking change to `/api/v1` that the app has to be updated for.

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

[1.2.0]: https://github.com/yomoapp/api/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/yomoapp/api/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/yomoapp/api/tree/v1.0.0
