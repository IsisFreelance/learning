# second-demo roadmap — inventory intake & catalog prep tool

A portfolio-grade build of an internal operations tool: turn photos of
physical products into structured, reviewed, export-ready product
records. Built in phases — each phase ends in something real to run and
test before the next one starts. See the plan this was built from for
full context: `C:\Users\Usuario\.claude\plans\snoopy-juggling-hejlsberg.md`
(local to the machine this was planned on, not part of the repo).

## Status

**Phase 0 through Phase 5 done. Next up: Phase 6 (stretch).**

Live: https://second-demo-pi.vercel.app/ (frontend) talks to
https://docker-demo-obpu.onrender.com (backend — Docker runtime on
Render's free tier, replacing the original native-Python service so
Tesseract, a system-level program, could be installed; still spins down
after ~15 min idle, first load after that can take 30-60s) which talks
to Neon Postgres and Supabase Storage (private bucket, signed URLs).
Full upload → thumbnail → queue → review → confirm (with source tags and
the override-reason escape hatch) → `confirmed_products` → browse/search/
filter/sort/edit/delete/export → duplicate/near-duplicate review flow
confirmed working end to end, not just locally. The entire app sits
behind a single hardcoded admin login (Phase 4) — no more open,
unauthenticated access.

## Tech stack

- Backend: Python + FastAPI, SQLAlchemy, Alembic migrations, Docker
  (needed once Tesseract required a system-level install, not just a
  Python package)
- Database: PostgreSQL (native local install; Neon for hosting)
- Frontend: React + TypeScript + Vite
- OCR: Tesseract (free, self-hosted), behind a swappable provider
  interface (`backend/app/ocr.py`)
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
- [x] **Phase 2 — OCR preflight & extraction (Tesseract).** Hash-based
      cache, preflight endpoint (cached/available/blocked + reason),
      Tesseract extraction with per-field confidence/source.
- [x] **Phase 3 — Manual review & confirmation.** Review UI (photo +
      editable fields, source tags), required-field validation with
      override-reason escape hatch, `confirmed_products` with full audit
      data. *First fully demoable end-to-end slice.*
- [x] **Phase 4 — Approved products table.** Search/filter/sort/export
      (XLSX/CSV), edit/delete, thumbnail + full preview, admin login —
      a single hardcoded password (`ADMIN_PASSWORD`), a signed session
      token (`Authorization: Bearer`, not a cookie — the frontend/backend
      live on different domains, and a bearer token sidesteps cross-site
      cookie flags entirely) now gates the *whole app*, not just this
      screen.
- [x] **Phase 5 — Grouping & normalization** *(stretch)*. Deterministic
      same-product duplicate detection, canonical naming, grouped preview
      with conflicts/warnings/ready-or-blocked — read-only (no merges, no
      new tables; this is a report over existing `confirmed_products`
      rows, not a data-changing action). Products with an identical
      normalized name (whitespace/case/punctuation-insensitive) group
      automatically: same price across the group → **ready**, with a
      canonical spelling chosen from whichever row was most recently
      confirmed or edited; different price → **blocked**, needs a human
      decision. Near-but-not-identical names (e.g. a likely OCR misread)
      surface separately as **possible duplicates** via a fuzzy pass
      (`difflib.SequenceMatcher`, stdlib — no new dependency), never
      auto-grouped. New `backend/app/normalization.py` (pure functions,
      fully unit-tested) + `GET /confirmed-products/groups` + a "Review
      Duplicates" tab reusing the existing product-edit screen to resolve
      anything flagged.
- [ ] **Phase 6 — Persisted normalization audit** *(stretch)*. Saved run
      snapshots, filterable review UI, CSV export of a run.
- [ ] **Phase 7 — Catalog/export preparation** *(stretch)*. Preflight
      validation, dry-run preview export — no real external write.

## Known issues / follow-ups

- **Rate limiting trusts the last `X-Forwarded-For` entry as the real client
  IP**, which only holds if Render (or whatever's in front of the app) is
  truly the sole path in — if the origin were ever reachable directly, an
  attacker could forge the trusted-looking entry and bypass rate limiting
  entirely. Lower-stakes now that Phase 4 added real login on top, but
  still worth tightening if this app ever sits behind a different proxy
  setup.
- **Lesson for future phases**: any blocking/synchronous call (an external
  HTTP SDK, `Image.open()`, etc.) inside an `async def` route handler runs
  *on the event loop itself* and freezes every other in-flight request —
  found and fixed this in Phase 1's Supabase Storage calls
  (`app/routers/intake.py` now wraps them in `run_in_threadpool`). Phase 2's
  OCR calls and any future external API calls need the same treatment.
- **Local Postgres is listening on all network interfaces** (`listen_addresses = '*'` in `postgresql.conf`, confirmed via `netstat` showing `0.0.0.0:5432`), not just `localhost`. Low real-world risk right now — `pg_hba.conf` separately restricts actual logins to `127.0.0.1`/`::1`, so LAN connections get rejected at auth — but the tighter, correct setup is `listen_addresses = 'localhost'`. Fixing it needs a real Postgres service restart, which hit the same Windows-service permission wall documented below — fold this fix into the next time the Postgres setup itself is being touched, rather than a one-off reinstall just for this.
- **Windows can't stop/start/reload the `postgresql-x64-17` service directly** (PowerShell's `Stop-Service`/`pg_ctl reload` both fail with permission errors in this environment) — only winget's own install/uninstall/reinstall flow has enough elevation to touch it. Keep this in mind for any future Postgres config change that needs a restart.
- **OCR extraction is capped to 2 concurrent runs app-wide** (`_ocr_concurrency` in `app/routers/intake.py`), found during Phase 2's security review — Tesseract is CPU-heavy and shares the same worker thread pool as every other blocking call (Supabase uploads/downloads), so without a cap a burst of OCR requests could stall unrelated requests for everyone on this single-process free-tier container. Revisit if Phase 2's usage ever outgrows a single small container (a real job queue, or a dedicated OCR worker, would be the proper fix).
- **When migrating a Render service (e.g. native Python → Docker for Phase 2), env vars must be copied value-by-value, not assumed** — two real deploy failures happened this way: `DATABASE_URL` was pasted as a near-miss instead of the exact Neon string, and `FRONTEND_ORIGIN` didn't exactly match the Vercel URL (CORS is a strict string match, no trailing slash). Also: local-only settings like `TESSERACT_CMD` (only needed on Windows, where Tesseract isn't on PATH) should never be copied to a deployed environment — they override behavior that's supposed to differ between local and production. Double-check each variable individually after any service migration rather than trusting a bulk copy.
- **`confirmed_products.price` is stored as plain text, not a numeric type** — OCR hands back strings like `"$24.99"` and real currency parsing (thousands separators, other currencies, stray characters) is out of scope for Phase 3. A known, deliberate simplification, not an oversight — revisit if a later phase needs to actually do math on prices (export totals, sorting by price, etc.).
- **Lesson from Phase 3's review screen**: React's StrictMode intentionally double-invokes effects in development, which surfaced a real bug — the "mark as opened" status call ran twice, and the second call failed (`opened` → `opened` isn't a valid transition) and incorrectly showed as a blocking error. Fixed by making that specific call best-effort/non-blocking, since only the `/confirm` endpoint actually requires the item to be `opened` — this is also just generally more correct (a real double-open, e.g. two tabs on the same item, shouldn't break the screen either). Worth remembering for any future effect that calls a non-idempotent endpoint on mount.
- **The JSON-body size limit (`main.py`, added in Phase 3's security review) checks the `Content-Length` header, which a client could omit while streaming an unbounded body via chunked transfer-encoding** — every normal HTTP client (browsers, `fetch`, `curl`, `requests`) sends `Content-Length` for a JSON POST, so this closes the realistic case, but a determined attacker crafting a chunked request could still bypass the header check. A fully robust fix would cap bytes actually read off the stream (the same pattern `validation.py`'s `read_upload_within_limit` already uses for file uploads); accepted for now given the low realistic risk, revisit if this app ever handles anything more sensitive than a portfolio demo.
- **CSV/XLSX export is a formula-injection vector (CWE-1236), found and fixed in Phase 4's security review** — `product_name`/`price` can come straight from OCR reading a photographed label, and a value starting with `=`/`+`/`-`/`@` opens as a live formula (e.g. `=HYPERLINK(...)`) in Excel/Sheets instead of plain text, which could exfiltrate data silently. `app/routers/products.py`'s `_escape_for_spreadsheet` now prefixes any such value with a leading `'` before writing it to either export format. Worth remembering for any future export/report feature that writes user- or OCR-controlled text into a spreadsheet.
- **A Starlette quirk: registering an exception handler for the bare `Exception` class (or status 500) does *not* restore CORS headers on an unhandled error** — Starlette special-cases that registration onto `ServerErrorMiddleware`, which sits *outside* `CORSMiddleware` in the middleware stack, so the response it returns still skips the CORS layer entirely and the browser reports a misleading "CORS blocked" error instead of the real 500. A handler registered for a *specific* exception type (e.g. this app's new `StorageError` in `app/storage.py`/`app/main.py`) doesn't get that special-casing and works correctly. Worth remembering for any future "catch-all" error handling — target specific exception types, not the bare `Exception` class, if CORS-correct error responses matter.
- **Supabase's signed-URL API occasionally drops the connection mid-request** (`httpx.RemoteProtocolError: Server disconnected`) when several are requested at once — e.g. loading a page of 20 items signs 40 URLs (image + thumbnail each) concurrently via `asyncio.gather`. `app/storage.py`'s `create_signed_url` now retries once before giving up. Revisit if this app ever needs to load noticeably more items per page than it does today.
- **On this Windows dev machine, `uvicorn --reload` sometimes announces "Reloading..." for a changed file but silently keeps serving the old code** (confirmed via mismatched line numbers in a traceback after a reload event) — a WatchFiles quirk, not a code bug. When verifying a fix actually took effect, prefer a full manual stop/restart of the dev server over trusting `--reload`.
- **`GET /confirmed-products/groups`'s possible-duplicates pass is an O(n²) pairwise string comparison** across every distinct product name (`app/normalization.py`'s `find_possible_duplicates`) — fine at this app's current scale (low hundreds of products at most), flagged as a non-issue in Phase 5's security review for the same reason, but would need a smarter approach (blocking/indexing similar names before comparing) if the catalog ever grows by an order of magnitude or more.

## How to resume this project in a new conversation

Tell Claude: "Check second-demo/ROADMAP.md, we're continuing the catalog
intake tool." The checkboxes above show what's done; the plan file path
above (if still present on this machine) has the full original reasoning
for every tech choice.
