# Bannu Drive — Frontend

React 18 + Vite + Tailwind CSS v4 + Leaflet (OpenStreetMap) + Socket.IO client.

1. `npm install`
2. Copy `.env.example` to `.env` and set `VITE_API_URL` to the backend URL (e.g. `http://localhost:5005`).
3. `npm run dev` (opens on http://localhost:5173) or `npm run build`.

The backend `Frontend_URL` must match the address you open in the browser.

## Tests
`npm run test:geo` checks the location-search / routing client logic against a stand-in for Nominatim and OSRM.

## Notes
* Location search tries the Bannu area first (villages, streets, markets, schools), then widens to Pakistan.
* The public OSRM demo server (`router.project-osrm.org`) is fine for development; for production consider hosting your own OSRM or a paid routing provider.
* Driver GPS is shared only while the driver has an accepted/started booking.

`npm run test:render` renders the seat map and booking ticket on the server and checks the HTML.

## Intercity coaches (frontend)
Customer: Intercity (search, results, seat map, booking) and My Bookings. Operator portal at `/operator`
(Dashboard, Coaches, Routes, Schedules, Bookings, Passengers, Reports, Profile). Admin: Operators, Coaches,
Coach Routes, Coach Schedules, Coach Bookings. Brand name and default city live in `src/config/platform.js`;
the timetable timezone is in `src/utils/dates.js`.

---

## Authentication, Google sign-in, documents (Phase 2/3)

* **Sessions:** the browser holds two HTTP-only cookies (set by the backend): a 15-minute access cookie and a 30-day
  rotating refresh cookie. Nothing secret is stored in `localStorage`. `src/utils/api.js` silently refreshes on a 401 and
  replays the request (one refresh shared by parallel requests); if the login is really over it fires
  `bd:session-ended` and `AuthContext` sends the person to `/login` without a reload. On startup `ProtectedRoute` shows
  "Loading..." while the session is restored, so a signed-in user never sees a flash of the login page.
* **"Keep me signed in"** (Login, default on) chooses a 30-day cookie vs a browser-session cookie.
* **Continue with Google:** `src/components/GoogleSignInButton.jsx` (Google Identity Services). Set
  `VITE_GOOGLE_CLIENT_ID`; leave it empty to hide the button. Only the Google **ID token** is sent to the backend, which
  verifies it. There is no client secret in the frontend.
  In Google Cloud Console add your site (`https://your-domain`, and `http://localhost:5173` for development) under
  **Authorized JavaScript origins**. No redirect URI is needed for this flow.
* **Documents:** drivers/operators upload from their Profile page (`VerificationPanel`); admins review at
  `/admin/verification`; the audit trail is at `/admin/audit-log`. Documents are shown through the authenticated API as
  in-memory blobs, never via a public URL.

## Environment

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend base URL (also used for Socket.IO) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth **client ID** (public). Optional |

## Tests

```bash
npm test          # geo + render + auth (refresh interceptor) + pages (SSR smoke)
npm run build
```

`vercel.json` already rewrites every path to `index.html`, so direct links and refreshes on any route work.
