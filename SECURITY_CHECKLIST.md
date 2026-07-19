# Security patterns checklist (internal — read before building)

A working reference for Claude Code, kept alongside the code rather than
in app-specific docs. Read this before starting any new app or feature
that touches a backend/database, and apply what's relevant.
Not every item applies to every stack — a static HTML app (`1st-app`) has
no server, so most of the "API" items below simply don't apply to it;
treat this as a checklist to consciously accept or reject per app, not a
mandatory list for every project.

## 1. Trust boundaries — never trust the client

- Recompute anything money- or security-critical server-side (prices,
  deposits, totals) — never accept a client-sent amount.
  (`first-demo/api/create-checkout-session.js`)
- Validate/whitelist data shape at the database layer too, not just in
  application code, so the rule holds even if app code has a bug or is
  bypassed entirely: Postgres → RLS policies + CHECK constraints;
  Firestore → Security Rules with strict field/type allow-lists
  (`hasOnly`).
- If the client's own submitted value can be checked against something
  the server already knows (e.g. "does this match what OCR read?"), have
  the server compute any derived tag/label itself — never accept a
  client-supplied tag for something the server could verify or derive on
  its own. (`second-demo/backend/app/confirm.py` — the server decides
  `source: "ocr"/"manual"/"override"` by comparing the submitted value
  against the cached OCR guess; the client never sends a source field at
  all.)
- A single request's body size is its own trust boundary, separate from
  per-IP rate limiting — a rate limiter only caps *how often* someone can
  hit an endpoint, not how large *one* request can be. Cap JSON body size
  before parsing (Starlette buffers the whole body into memory before
  Pydantic validation ever runs) and set `max_length` on individual
  string fields as a second layer.
  (`second-demo/backend/app/main.py`'s `limit_json_body_size` middleware
  + `Field(max_length=...)` in `app/schemas.py`.)

## 2. Access control

- Role-based access (staff/admin claims, RLS policies) enforced at the
  **database** level, not just hidden in the UI.
- No public self-signup for admin/staff accounts — provision manually.
- Any server-side comparison of a secret/token must be constant-time
  (`crypto.timingSafeEqual` in Node, or the language's equivalent) —
  never a plain `===`/`==` on a shared secret.

## 3. Abuse & bot prevention

- Rate-limit every write endpoint, keyed by IP + endpoint.
- CAPTCHA (hCaptcha/reCAPTCHA) on public-facing forms that create
  records.
- Firebase App Check / equivalent attestation where available — client
  config and API keys are inherently public, so this is the layer that
  proves traffic is really coming from the app.
- For any CPU-heavy operation (OCR, image processing, anything that
  blocks a worker thread for real time, not just I/O wait time), a
  per-IP request *count* limit isn't enough on its own — a client can
  still fire several expensive calls at once, all within its own quota,
  and exhaust the shared thread pool other endpoints depend on too. Add
  a separate concurrency cap (e.g. `asyncio.Semaphore`) around the
  expensive call itself, independent of the rate limiter.
  (`second-demo/backend/app/routers/intake.py`'s `_ocr_concurrency`.)
- A race between two requests that both pass a check and then both try
  to write a row protected by a unique constraint (e.g. "confirm this
  item" fired twice at once) will raise an unhandled database exception
  on the second one unless it's explicitly caught — catch
  `IntegrityError`, roll back, and return a clean 409/conflict response
  instead of letting a raw exception surface. (`ocr_extract` and
  `confirm_intake_item` in `second-demo/backend/app/routers/intake.py`.)

## 4. Webhooks & third-party callbacks

- Always verify the cryptographic signature on an incoming webhook
  before trusting its payload (Stripe, etc.).
- Guard against duplicate delivery/replay with an idempotency check
  wrapped in a database transaction.
- Re-validate business state (e.g. "is this booking still
  cancellable/payable?") *inside* the webhook handler itself — state can
  change between when a link/session was created and when the webhook
  actually arrives.

## 5. Headers & transport

- Content-Security-Policy with an explicit domain allowlist — no
  wildcard `*` sources.
- HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a
  `Permissions-Policy` blocking unused device APIs (camera/mic/geo).

## 6. Containers (when a stack uses Docker)

- Run as a non-root user (`USER` directive after install steps, not the
  default root) — especially once the container shells out to a native
  program (image/OCR/PDF processing, etc.) on bytes a user actually
  uploaded, since that's exactly the kind of native, memory-unsafe code
  a real exploit would target. (`second-demo/backend/Dockerfile`.)
- `.dockerignore` excludes `.env`, local virtualenvs/`node_modules`, and
  test directories — same reasoning as `.gitignore`, but for what ends
  up baked into a shipped image rather than a commit.
- If the app has database migrations, run them automatically on
  container startup (idempotent — a no-op when already current) rather
  than relying on a human to remember to run them against the live
  database after every deploy. Not itself a security control, but a
  schema that's silently out of sync with the code is exactly the kind
  of gap that produces confusing, unhandled errors in production.
  (`second-demo/backend/Dockerfile`'s `alembic upgrade head` before
  `uvicorn` starts — added after shipping a migration that was applied
  locally but never against Neon, which 500'd a live endpoint.)

## 7. Secrets & environment

- Real secrets never get a public-prefix env var name (`VITE_`,
  `NEXT_PUBLIC_`, etc.), are never hardcoded, and are never committed —
  `.env`/`.env.local` stays gitignored in every app.
- A feature that needs a true server-only secret needs a server layer
  (e.g. a serverless function) built first — never call a
  secret-requiring API directly from the frontend.

## 8. Observability

- Error monitoring (Sentry or equivalent) wired into every catch block
  server-side, not just the happy path. This is literally how a real
  production bug (a missing Stripe webhook secret) got caught in
  `first-demo`.

## 9. Testing security itself

- Security rules (Firestore rules, Postgres RLS policies) get their own
  automated tests against a real emulator/instance — not just eyeballed.
- CI runs the full suite (unit, security-rule, e2e) on every push/PR.

## Reference: where these live today (not exhaustive)

- `first-demo`: `firestore.rules`, `api/_lib/rateLimit.js`,
  `api/_lib/tokens.js`, `api/stripe-webhook.js`, `vercel.json`,
  `api/_lib/sentry.js`
- `2nd-app`: Supabase RLS policies scoped to `auth.uid() = user_id`
- `second-demo`: `backend/app/rate_limit.py` (Postgres-backed atomic
  rate limiter), `backend/app/validation.py` (upload size/dimension/
  real-content checks), `backend/app/main.py` (JSON body-size limit),
  `backend/app/confirm.py` (server-determined source tags), `backend/
  app/routers/intake.py` (`_ocr_concurrency`, `IntegrityError`
  handling), `backend/Dockerfile` (non-root user, auto-migrations)
