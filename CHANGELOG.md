# Changelog

All notable changes to the Yomo API. Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`. A MAJOR bump means a breaking change to `/api/v1` that the app has to be updated for.

## [1.1.0] - 2026-10-31

### Added
- `GET /health` returns the API version (`{ "ok": true, "version": "1.1.0" }`).
- Every response carries an `X-Api-Version` header.

## [1.0.0] - 2026-10-31

### Added
- First release: auth, profile, categories, transactions, money summary, debts with payments, religion days, wird and progress, adhkar, Quran metadata, and the `/today` summary.
- Deployed on Vercel.

[1.1.0]: https://github.com/yomoapp/api/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/yomoapp/api/tree/v1.0.0
