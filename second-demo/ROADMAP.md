# second-demo roadmap — inventory intake & catalog prep tool

A portfolio-grade build of an internal operations tool: turn photos of
physical products into structured, reviewed, export-ready product
records. Built in phases — each phase ends in something real to run and
test before the next one starts. See the plan this was built from for
full context: `C:\Users\Usuario\.claude\plans\snoopy-juggling-hejlsberg.md`
(local to the machine this was planned on, not part of the repo).

## Status

**Current phase: 0 — Foundations (in progress)**

## Tech stack

- Backend: Python + FastAPI, SQLAlchemy, Alembic migrations
- Database: PostgreSQL (native local install; Neon for hosting)
- Frontend: React + TypeScript + Vite
- OCR: Tesseract first (free), behind a swappable provider interface
- Hosting: Render (backend) + Neon (database) + Vercel (frontend), all
  free tiers, no paid OCR/AI provider yet

## Phases

- [ ] **Phase 0 — Foundations.** FastAPI + SQLAlchemy + Alembic skeleton,
      health endpoint; Vite/React/TS skeleton hitting it; deployed live
      on Render + Neon + Vercel from day one.
- [ ] **Phase 1 — Photo intake & queue.** Upload (desktop + mobile camera),
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

## How to resume this project in a new conversation

Tell Claude: "Check second-demo/ROADMAP.md, we're continuing the catalog
intake tool." The checkboxes above show what's done; the plan file path
above (if still present on this machine) has the full original reasoning
for every tech choice.
