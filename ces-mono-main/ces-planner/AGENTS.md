# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

CES-FE is a CMMC compliance tool for VFS advisors. It is an offline-first React SPA (no backend API) that guides users through three sequential workflow tools:

1. **SIT (Strategic Intent Tool)** - Capture compliance goals → generates an immutable SI Baseline
2. **RRT (Readiness Recon Tool)** - Evaluate compliance posture with evidence → generates Readiness Posture
3. **MPT (Mission Planning Tool)** - Generate compliance roadmaps → produces 4 artifacts (Manual Plan, Exec Plan, Proposal, Manifest)

All generated artifacts are validated against CES JSON schemas using AJV before saving to IndexedDB.

## Commands

```bash
npm run dev          # Start dev server (localhost:5173)
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint with zero warnings enforced
npm run format       # Prettier format src/**/*.{ts,tsx,json}
npm run test         # Vitest unit tests
npm run test:ui      # Vitest interactive UI
npm run test:e2e     # Playwright E2E tests
```

## Architecture

### Feature-Based Organization

Code is organized by domain feature, not by layer:

- `src/features/sit/` - Strategic Intent Tool (wizard, question answering, baseline generation)
- `src/features/rrt/` - Readiness Recon Tool (evidence collection, posture generation)
- `src/features/mpt/` - Mission Planning Tool (gap analysis, plan generation)
- `src/features/customer/` - Customer CRUD
- `src/features/landing/` - Dashboard and workflow orchestration
- `src/shared/` - Cross-cutting: components, db, hooks, services, stores, types, utils, validation

Each feature has `components/`, `hooks/`, `services/`, `stores/`, and `types.ts` as needed.

### Data Flow: Question → Answer → Artifact

1. YAML question banks loaded from `/public/data/` and cached in IndexedDB
2. User answers questions in wizard UI (SIT or RRT)
3. Service functions generate schema-compliant JSON artifacts
4. AJV validates against JSON schemas from `/public/schemas/`
5. Artifacts saved to IndexedDB (and to `/generated/` on disk in dev mode via Vite plugin)

### Artifact Dependency Chain

```
Customer → SI Baseline(s) → RR Question Set(s) → Readiness Posture(s) → Mission Plan(s)
```

SI Baselines are **immutable** after generation. Each downstream artifact references its parent by ID.

### State Management

- **Zustand stores** with persist middleware for global and feature state
  - `useAppStore` (persisted as `ces-app-store`) - current customer, selected artifact IDs, workflow stage
  - `useSITStore` (persisted as `ces-sit-store`) - wizard step, answers, question bank
  - `useRRTStore` (persisted as `ces-rrt-store`) - wizard step, answers, evidence
  - `useMPTStore` (not persisted) - plan mode, generated artifacts
- **Dexie** (IndexedDB) for persistent artifact/customer storage with compound indexes
  - Database name: `CMMCComplianceTool`
  - Singleton: `db` from `src/shared/db/schema.ts`, queries via `dbHelpers`

### Routing

```
/           → CustomerSelector
/dashboard  → LandingPage (workflow overview)
/sit        → SITPage (strategic intent wizard)
/rrt        → RRTPage (readiness recon wizard)
/mpt        → MPTPage (mission planning)
```

All tool routes require `currentCustomerId` in app store state.

### Runtime Data Sources (no REST API)

- `/public/data/` - YAML question banks (SI and RR)
- `/public/schemas/` - CES JSON schemas for artifact validation
- Domain data YAML files (CMMC requirements, evidence archetypes, assessor KB, evidence matrix)

All loaded via `dataLoader` service with IndexedDB caching and concurrent request deduplication.

## Code Style

- TypeScript strict mode with `noUnusedLocals` and `noUnusedParameters`
- Path aliases: `@/*`, `@/shared/*`, `@/features/*`
- Prettier: semicolons, single quotes, 100 char width, 2 spaces, LF line endings
- ESLint: zero warnings policy (build fails on warnings)
- UI: Tailwind CSS + Headless UI components, `clsx` for conditional classes

## Dev Mode Features

Accessible only when `import.meta.env.DEV` is true:
- Autofill buttons for wizard forms
- Database reset functionality
- Vite plugin saves generated artifacts to `/generated/` on disk for inspection
