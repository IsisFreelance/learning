# learning

An "app ladder" — a sequence of small learning apps, each in its own
subfolder, each self-contained. See `CLAUDE.md` for how this repo is worked
on and the tech-choice philosophy behind it.

## Apps

### 1st-app — personal freelance portfolio (Isis Akueran)
- Stack: plain HTML/CSS, hosted on GitHub Pages.
- Live: https://isisfreelance.github.io/learning/1st-app/
- Pages: `index.html` (Services section listing real developer abilities
  demonstrated across the app ladder), `projects.html` (project cards,
  including Bright Harbor Dental with an explicit "fictional client" label
  linking to `bright-harbor-dental.html`, a detail page with a Loom-video
  placeholder).

### 2nd-app — to-do list
- Stack: React (Vite) + Supabase + Vercel — first app on the default stack.
- Live: https://2ndapp-nu.vercel.app/
- Supabase project ref: `ghihzrcikbivifefmbmt`.
- Table `todos`: `id`, `task`, `is_completed` (not `is_complete`), `created_at`,
  `user_id`.
- Auth: Supabase Auth, email + password, email confirmation disabled for
  faster testing. RLS policies scoped to `auth.uid() = user_id` — the database
  itself enforces that each user only sees/edits their own rows. Auth UI in
  `2nd-app/src/Auth.jsx`; session state and route-gating in `2nd-app/src/App.jsx`.

### first-demo — Bright Harbor Dental (fictional dental practice website)
- Stack: React (Vite) + Firebase (Firestore) + Vercel — deliberately chosen as
  a NoSQL comparison to `2nd-app`'s Supabase/Postgres approach (see the tech
  choices table in `CLAUDE.md`). Also integrates Stripe (deposit payments),
  SendGrid (email), the Google Calendar API, Sentry, and hCaptcha.
- Live: https://learning-ten-alpha.vercel.app/
- Phase 1 (landing page): Hero, Services, About, Contact/footer sections,
  each its own component under `first-demo/src/components/`. Brand system
  (teal `#2BB3A3` / coral `#FF6B5E` / slate `#33414A`, Poppins font) lives in
  `first-demo/src/index.css`.
- Phase 2 (booking flow): "Book an appointment" opens `BookingModal.jsx` —
  multi-select services (durations in `src/data/services.js`: Cleanings
  30 min, Whitening 60 min, Invisalign 45 min, Implants 60 min, summed for
  the total appointment length), a custom calendar date picker
  (`DateField.jsx`, disables past/closed days and same-day booking) with a
  start-time dropdown that only shows truly available times, contact
  fields, hCaptcha, and a confirmation screen with a sequential reference
  number (`BHD-000001`, ...).
- Firebase project: `bright-harbor-dental`. Firestore collections:
  `bookings` (full appointment details, not publicly readable), `bookingSlots`
  (15-minute slot locks used for availability + conflict checks, no PII),
  `counters/bookings` (sequential reference number generator).
- Double-booking prevention (`src/lib/bookings.js`): a Firestore transaction
  atomically checks all needed 15-minute slots are free and claims them
  together with the booking record. Known limitation: this transaction runs
  client-side, so Firestore Security Rules can't distinguish "part of a
  legitimate booking transaction" from any other write shaped the same way —
  a fully tamper-proof version would need a server-side Cloud Function (not
  implemented for the initial booking-creation step).
- Phase 3 (private staff dashboard, `/owner` route, `OwnerDashboard.jsx`):
  lists every booking live, grouped by day, with per-booking Confirm/Cancel/
  Delete (delete only enabled once a booking is cancelled or past) and
  deposit-status labels. Auth is **Firebase Auth** (email/password), not
  Supabase — deliberately chosen over the initial ask, because Firestore
  Security Rules can't verify a Supabase session. Access requires a `staff`
  custom claim on the Firebase Auth token, checked both in Firestore Security
  Rules and server-side in every staff-only API route (`api/_lib/staffAuth.js`)
  — being logged in isn't enough by itself, closing an earlier gap where any
  authenticated account could reach the dashboard. No public sign-up: the
  claim is granted manually via a local script (`scripts/set-staff-claim.js`).
  No router library — `App.jsx` branches on `window.location.pathname`
  directly (`/`, `/owner`, `/manage-booking`, `/booking-confirmed`), each
  non-public route `React.lazy`-loaded so visitors never download staff or
  payment-return code; a `vercel.json` SPA rewrite makes deep links work
  once deployed.
- Payments (Stripe, test mode): booking a deposit redirects to Stripe
  Checkout (`api/create-checkout-session.js` — deposit amount always
  recomputed server-side from the booking's real services, never trusted
  from the client); `api/stripe-webhook.js` verifies Stripe's signature and
  marks the deposit paid exactly once (transactional, duplicate-delivery
  safe) before triggering calendar sync + confirmation email
  (`api/_lib/finalizeBooking.js`); a daily cron (`api/expire-unpaid-holds.js`)
  releases slot holds and deletes bookings left unpaid for 2+ hours.
- Reschedule & cancellation: patients can reschedule themselves via a
  token-gated link (`ManageBooking.jsx` / `api/reschedule-booking.js`, no
  login needed) or accept a staff-proposed new time
  (`api/propose-reschedule.js`); cancelling (`api/cancel-booking.js`,
  staff-only) refunds the Stripe deposit if cancelled ≥24h ahead, otherwise
  keeps it per policy, and removes the Google Calendar event.
- Notifications: SendGrid (`api/_lib/sendEmail.js`) sends confirmation,
  reschedule, proposal, and cancellation emails (all patient-supplied text
  HTML-escaped first); a daily cron (`api/send-reminders.js`) emails a
  day-before reminder with a one-click confirm link
  (`api/confirm-appointment.js`); every paid booking gets a Google Calendar
  event (`api/_lib/googleCalendar.js`), kept in sync through reschedules and
  cancellations.
- Security hardening, from two "hacker-style review" passes
  (`4323231`, `40015bb`, `f7bfdbc` in git history): hCaptcha on the booking
  form, Firebase App Check on Firestore, per-IP rate limiting
  (`api/_lib/rateLimit.js`) on every public API route, constant-time token
  comparison (`api/_lib/tokens.js`) for manage/confirm links, strict
  Firestore Security Rules shape validation on every collection, and CSP/
  HSTS/`Permissions-Policy` headers (`vercel.json`). `api/notify-booking.js`
  additionally refuses to notify for an unpaid deposit, closing an
  open-relay-style hole where knowing a booking ID alone (discoverable via
  the public `bookingSlots` collection) was enough to trigger a fake
  "confirmed" email.
- Testing & CI: Vitest unit/component tests, Firestore Security Rules
  tests against a real emulator (`firestore.rules.test.js`), Playwright
  end-to-end tests (`e2e/booking.spec.js`), all run in GitHub Actions on
  every push/PR touching `first-demo/**`
  (`.github/workflows/first-demo-ci.yml`). Sentry error tracking on both
  frontend and every serverless function. `api/health.js` checks a real
  Firestore read plus whether SendGrid/Google Calendar env vars are
  configured, without spending their quota.

### second-demo — inventory intake & catalog prep tool
- Stack: Python (FastAPI) + PostgreSQL + React (Vite/TS) — first non-JS
  backend and first persistent server (not serverless functions) in the
  ladder (see the tech choices table in `CLAUDE.md`). Hosting: Render
  (backend) + Neon (database) + Vercel (frontend), all free tiers.
- A portfolio build of a real operations tool: turn photos of physical
  products into structured, reviewed, export-ready product records
  (photo intake → OCR/AI extraction → manual review → confirmation →
  grouping → audit trail → export prep). Built in phases — see
  `second-demo/ROADMAP.md` for current status and what each phase covers.
- OCR: Tesseract (free, self-hosted) behind a swappable provider
  interface, so a paid provider could be added later without touching
  the rest of the system — deliberately zero ongoing API cost for now.
