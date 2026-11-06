# Yomo dashboard

Read-only analytics dashboard (Arabic, RTL) for the Yomo API. Vite + React 18 + TypeScript + Recharts, `HashRouter`.

- Served by the same Vercel deployment as the API at `/dashboard/` (same origin, no CORS). `vite build` writes to `../public/dashboard/` (git-ignored); `vercel.json` runs the build.
- API base: `/api/v1` by default; override with `VITE_API_BASE` (for example `VITE_API_BASE=http://localhost:3000/api/v1 npm run dev`).
- Login with the account email and password (`POST /auth/login`). Tokens live in localStorage; a 401 triggers one `/auth/refresh` and a retry, otherwise it logs out. The API takes the timezone from the user's settings (`/me`), so no timezone header is sent.
- Only GET requests are made. `/vault` is never called. Habits come from `/habits` (the API has no private/hidden flag on habits; archived ones are skipped).
- Colors and number formatting mirror the Flutter app (`theme.dart`, `format.dart`): Arabic-Indic digits, money in piasters shown with "ج". The eye button masks amounts and is remembered.

```
npm ci
npm run dev      # http://localhost:5174/dashboard/
npm run build    # tsc + vite build
```
