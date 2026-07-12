# second-demo roadmap — inventory intake & catalog prep tool

A portfolio-grade build of an internal operations tool: turn photos of
physical products into structured, reviewed, export-ready product
records. Built in phases — each phase ends in something real to run and
test before the next one starts. See the plan this was built from for
full context: `C:\Users\Usuario\.claude\plans\snoopy-juggling-hejlsberg.md`
(local to the machine this was planned on, not part of the repo).

## Status

**Phase 0 and Phase 1 done. Current phase: 2 — OCR preflight & extraction (not started).**

Live: https://second-demo-pi.vercel.app/ (frontend) talks to
https://second-demo-w5t7.onrender.com (backend, Render free tier — spins
down after ~15 min idle, first load after that can take 30-60s) which
talks to Neon Postgres and Supabase Storage (private bucket, signed
URLs). Full upload → thumbnail → queue → status-transition → restore →
delete flow confirmed working end to end against the live deployment,
not just locally.

## Tech stack

- Backend: Python + FastAPI, SQLAlchemy, Alembic migrations
- Database: PostgreSQL (native local install; Neon for hosting)
- Frontend: React + TypeScript + Vite
- OCR: Tesseract first (free), behind a swappable provider interface
- Hosting: Render (backend) + Neon (database) + Vercel (frontend), all
  free tiers, no paid OCR/AI provider yet

## Phases

- [x] **Phase 0 — Foundations.** FastAPI + SQLAlchemy + Alembic skeleton,
      health endpoint; Vite/React/TS skeleton hitting it; deployed live
      on Render + Neon + Vercel from day one.
- [x] **Phase 1 — Photo intake & queue.** Upload (desktop + mobile camera),
      server-side validation, controlled storage, thumbnails,
      `intake_items` with statuses, queue UI with filter/select/archive/
      reject/restore/delete.
- [ ] **Phase 2 — OCR preflight & extraction (Tesseract).** Hash-based
      cache, preflight endpoint (cached/available/blocked + reason),
      Tesseract extraction with per-field confidence/source.
- [ ] **Phase 3 — Manual review & confirmation.** Review UI (photo +
      editable fields, source tags), required-field validation with
      override-reason escape hatch, `confirmed_products` with full audit
      data. *First fully demoable end-to-end slice.*
- [ ] **Phase 4 — Approved products table.** Search/filter/sort/export
      (XLSX/CSV), edit/delete, thumbnail + full preview, admin login.
- [ ] **Phase 5 — Grouping & normalization** *(stretch)*. Deterministic
      same-product/variant detection, canonical naming, grouped preview
      with conflicts/warnings/ready-or-blocked.
- [ ] **Phase 6 — Persisted normalization audit** *(stretch)*. Saved run
      snapshots, filterable review UI, CSV export of a run.
- [ ] **Phase 7 — Catalog/export preparation** *(stretch)*. Preflight
      validation, dry-run preview export — no real external write.

## Known issues / follow-ups

- **Rate limiting trusts the last `X-Forwarded-For` entry as the real client
  IP**, which only holds if Render (or whatever's in front of the app) is
  truly the sole path in — if the origin were ever reachable directly, an
  attacker could forge the trusted-looking entry and bypass rate limiting
  entirely. Accepted for now since there's no auth yet either and Render's
  standard web-service routing doesn't expose the origin directly; revisit
  properly once Phase 4 adds real authentication and this stops being the
  only abuse control in the app.
- **Lesson for future phases**: any blocking/synchronous call (an external
  HTTP SDK, `Image.open()`, etc.) inside an `async def` route handler runs
  *on the event loop itself* and freezes every other in-flight request —
  found and fixed this in Phase 1's Supabase Storage calls
  (`app/routers/intake.py` now wraps them in `run_in_threadpool`). Phase 2's
  OCR calls and any future external API calls need the same treatment.
- **Local Postgres is listening on all network interfaces** (`listen_addresses = '*'` in `postgresql.conf`, confirmed via `netstat` showing `0.0.0.0:5432`), not just `localhost`. Low real-world risk right now — `pg_hba.conf` separately restricts actual logins to `127.0.0.1`/`::1`, so LAN connections get rejected at auth — but the tighter, correct setup is `listen_addresses = 'localhost'`. Fixing it needs a real Postgres service restart, which hit the same Windows-service permission wall documented below — fold this fix into the next time the Postgres setup itself is being touched, rather than a one-off reinstall just for this.
- **Windows can't stop/start/reload the `postgresql-x64-17` service directly** (PowerShell's `Stop-Service`/`pg_ctl reload` both fail with permission errors in this environment) — only winget's own install/uninstall/reinstall flow has enough elevation to touch it. Keep this in mind for any future Postgres config change that needs a restart.

## How to resume this project in a new conversation

Tell Claude: "Check second-demo/ROADMAP.md, we're continuing the catalog
intake tool." The checkboxes above show what's done; the plan file path
above (if still present on this machine) has the full original reasoning
for every tech choice.
