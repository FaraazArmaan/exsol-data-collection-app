# ADR 0001: Hosting Stack and Language

- **Status:** Accepted
- **Date:** 2026-05-19

## Context

Original brief specified "MySQL hosted on Netlify" with Python middleware. Netlify does not host databases and its Python runtime is a beta with a 10-second timeout, neither of which supports the feature set (file manager, ZIP backups, bulk imports, integration sync, multi-user concurrent writes).

The app needs: static frontend, structured DB, persistent file storage, HTTP backend logic, room to add background/analytics workers later. Budget target is near-zero monthly cost during the data-collection phase.

## Decision

| Layer | Choice |
|---|---|
| Frontend | Netlify (static HTML/JS/CSS) |
| Backend logic | Netlify Functions (TypeScript) |
| Database | Neon (serverless Postgres) |
| File storage | Google Drive (via Drive API, on the owner's existing 15 GB account) |
| Future analytics worker | Optional Python service on Railway/Render, invoked from TS backend |

Netlify Identity / Supabase Auth / Clerk / custom JWT is still to be decided (ADR-0002).

## Consequences

- Postgres replaces MySQL. All references to MySQL in the brief should be read as Postgres.
- No backend Python in v1. ML/analytics ("dead stock detection," forecasting) defers to a future Python worker.
- File-heavy operations (bulk export ZIP, image upload) stream to Google Drive directly rather than buffering in Functions, to stay under Netlify's 6 MB response and 26 s timeout limits.
- Google Drive is storage, not a CDN; image delivery may need a Cloudflare proxy or a switch to R2 if image latency becomes user-visible (revisit at >50 clients).
- Local dev uses Netlify CLI (`netlify dev`) + Neon dev branch + a test Google Drive account, keeping production pushes minimal as requested.

## Alternatives considered

- **Netlify + MySQL on PlanetScale** — PlanetScale removed the free tier; cheapest plan is $39/mo. Rejected on cost.
- **Netlify + Supabase (DB + auth + storage all-in-one)** — Strong runner-up. Rejected because the user already has 15 GB of free Google Drive and prefers Neon for the DB; revisit if vendor sprawl becomes painful.
- **Railway/Render single-host with FastAPI** — Best technical fit for "Python middleware," but the user has hard-locked Netlify for the frontend, and splitting hosts is acceptable.
- **VPS self-host (Hetzner/DO)** — Cheapest at scale, but the user wants minimal ops in this phase.
