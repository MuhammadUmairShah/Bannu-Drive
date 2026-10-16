# Bannu Drive — Backend

Node.js (ES modules) + Express 5 + MongoDB/Mongoose + Socket.IO + Cloudinary.

## Run

```bash
npm install
cp .env.example .env        # fill it in, never commit it
npm run create-admin        # once: creates the first admin from ADMIN_* values
npm run dev                 # REST + Socket.IO on PORT (default 5005)
```

| Entry point | Purpose |
|---|---|
| `server.js` | **Production/dev entry.** Express + HTTP server + Socket.IO. Host on Render / Railway / a VPS. |
| `app.js` | The Express app (no listening). Imported by `server.js` and by tests. |
| `index.js` | Vercel/serverless entry. **REST only**: sockets cannot run on serverless. `/health` reports `realtime: "off"` there. |

## Deployment shape

Frontend on Vercel, backend on a persistent host (see `render.yaml`).
Set `CLIENT_URL` to the exact frontend origin. For cookies:

* different domains (`*.vercel.app` + `*.onrender.com`): defaults work (`SameSite=None; Secure`), but browsers are
  tightening third-party cookies. **Recommended:** put both on one parent domain
  (`app.bannudrive.pk`, `api.bannudrive.pk`) and set `COOKIE_DOMAIN=.bannudrive.pk`, `COOKIE_SAMESITE=lax`.

## Upgrading an existing database (run once, safe to repeat)

```bash
npm run migrate:auth
```

Replaces the old unique `phone` index with a partial one (Google sign-ups have no phone yet) and creates indexes for the
new collections. **Existing logged-in users are signed out once** (old 7-day tokens have no session id): they simply log in again.

## Authentication

* Short-lived **access token** (15 min, HTTP-only cookie `safarx-bannu`) + rotating **refresh token** (30 days,
  HTTP-only cookie `bd-refresh`, only sent to `/user/*`). Only a SHA-256 hash of the refresh token is stored (`sessions`).
* `POST /user/refresh` rotates the refresh token. Replaying an old token (outside a 15 s grace window for parallel tabs)
  revokes the whole login family and is audit-logged.
* `POST /user/logout`, `POST /user/logout-all`; password change/reset, blocking a user and Google account-linking end sessions
  and close live sockets.
* `POST /user/google` — body `{ credential }` (Google ID token). Verified server-side with `google-auth-library`
  (signature, issuer, audience, expiry, `email_verified`). New users are always `customer`; admin accounts can never be
  reached through Google; an existing local account whose mailbox was never verified has its password wiped when linked
  (pre-hijack protection) — the owner sets a new one with "Forgot password".
* 401 responses carry `code`: `AUTH_REQUIRED`, `AUTH_EXPIRED`, `AUTH_INVALID`, `SESSION_ENDED`.
* State-changing requests from a browser Origin that is not allowed are rejected (CSRF defence in depth).

## Verification documents (drivers + operators)

`/verification/*`. Statuses `PENDING → UNDER_REVIEW → APPROVED | REJECTED`, per document and per case, with history.
Files are stored as Cloudinary `authenticated` assets and are **only** readable through
`GET /verification/documents/:id/file` (owner or admin), streamed by the backend. No URL or storage id is ever returned
by any API. Uploads: JPG/PNG/WEBP/PDF, ≤ 5 MB, signature + dimension checks.
`REQUIRE_DOCUMENTS_FOR_VERIFICATION` (default **on in production**) stops admins from verifying an account whose documents are not approved.

Required documents are configured in `modules/verification/verification.config.js`.

## Socket.IO

Auth by the same access cookie (expired/forged/logged-out tokens are refused with `AUTH_*` codes), origin-checked.
Rooms: `user:<id>` (private), `session:<sid>`, `coach:<scheduleId>` (public seat state only),
`coach:<scheduleId>:ops` (owner operator + admin only). `coach:watch` is authorised per role and acknowledges `{ok}`.

## Audit log

`audit_logs` collection, read-only API `GET /admin/audit-logs?action=document.*&entityType=&entityId=&actor=`.
Recorded: staff sign-ins, password changes/resets, Google link/registration, refresh-token reuse, document upload / view /
approve / reject / re-upload request, verification outcomes, account block/unblock, driver/operator (un)verification,
coach (de)activation, schedule created/updated/cancelled, booking cancellation.

## Rate limits

Per IP: login, register, Google, refresh, password. Per user: booking, requests (ride/delivery/complaint/rating),
payment, uploads, QR verify (ready for Phase 6), admin writes. In-memory counters: correct for one instance; add a Redis
store when you scale out. Tune with the `*_RATE_LIMIT` variables.

## Tests

```bash
npm run check          # every module imports cleanly (no DB needed)
MONGO_TEST_URI=mongodb://127.0.0.1:27017/bd_e2e  npm run test:e2e   # full flows (rides, deliveries, coaches, sockets)
MONGO_TEST_URI=mongodb://127.0.0.1:27017/bd_auth npm run test:auth  # sessions, Google (mocked), documents, sockets, audit, limits
```

Both **drop the database** they point at. They need a real MongoDB-compatible server. They were run against FerretDB,
which does not implement partial indexes, so the uniqueness guarantees that rely on partial indexes
(`activeSeatKey`, `phone`, `googleId`, one-current-document-per-type) must be re-verified on real MongoDB/Atlas.

## Environment

See `.env.example` (every variable is documented there).
