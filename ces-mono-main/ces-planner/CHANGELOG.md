# Changelog — ces-planner

Format: [Keep a Changelog](https://keepachangelog.com/); [SemVer](https://semver.org/). Dates UTC.

## [1.1.0] — 2026-07-04

Establishes changelog + SemVer discipline (G-ENG-5) for the Planner (offline-first React/Vite SPA;
version was already at 1.0.0).

### Baseline capabilities
- The CMMC planning pipeline SIT → RRT → MPT; artifacts validated against CES JSON schemas (AJV)
  and stored in IndexedDB (Dexie) with 7 versioned migrations + tuple-ownership isolation.
- Offline by design — no runtime backend; Vite dev-server-only artifact routes.

### Known / tracked
- AJV validation runs in permissive mode (`strict:false`) and legacy no-tuple Dexie reads can leak
  cross-customer artifacts — both tracked as integrity fixes under G-ENG-4.

### Changed
- Coverage measurable via `npm run test:coverage`; no threshold gate yet.
