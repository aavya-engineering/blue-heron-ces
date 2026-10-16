# Blue Heron CES — Repository Inventory

**Audit Date:** 2026-10-16
**Auditor:** Automated Engineering Audit

## Root Layout

```
heron_ces/                          (workspace root — single .git)
├── ces-mono-main/                  primary monorepo (5 npm workspaces)
│   ├── ces-shared/                 shared contracts, storage, config, crypto
│   ├── ces-stamper/                remediation execution + evidence
│   ├── ces-ao/                     AdminOps governed operations
│   ├── ces-eo/                     EvidenceOps control mapping + reporting
│   ├── ces-planner/                Mission Plan creation UI
│   ├── ces-ec/                     Evidence Collector service
│   ├── ces-muster  (junction)      -> ces-muster-main/
│   ├── ces-tenant  (junction)      -> ces-tenant-main/
│   └── tenant-stacksim (junction)  -> ces-stacksim-main/
├── ces-muster-main/                Muster SPA + muster-api backend
│   ├── src/                        React 18 SPA (Vite + TypeScript)
│   ├── muster-api/                 Express API (Node 20, PostgreSQL/Prisma)
│   ├── recipes/                    3 PowerShell evidence-collection recipes
│   ├── docker/init-db.sql          DB role initialization
│   └── docker-compose.yml          PostgreSQL 16 + optional stacksim
├── ces-stacksim-main/              Mock GCC High tenant simulator (:4390)
├── ces-tenant-main/                Tenant registry + auth daemon (:4690)
├── ces-tester-main/                Cross-module integration harness
├── ces-stamper  (junction)         -> ces-mono-main/ces-stamper/
├── start-all.ps1                   Full-platform startup orchestrator
└── stop-all.ps1                    Platform teardown
```

## npm Workspace Members (ces-mono-main)

| Package | Version | Build Tool | Test |
|---------|---------|-----------|------|
| ces-shared | 2.8.0 | tsc + copy-data.cjs | vitest 4.x |
| ces-stamper | 2.2.3 | tsc + copy-registry.cjs | jest 29.x |
| ces-ao | 2.2.3 | tsc | vitest 4.x |
| ces-eo | 2.2.3 | tsc | jest 29.x |
| ces-planner | 2.2.3 | tsc + vite build | vitest 2.x |
| ces-ec | 0.1.0 | tsc | vitest 4.x |

## muster-api Route Surface

| Route | Purpose | Auth |
|-------|---------|------|
| POST /auth/login | JWT login | none |
| GET /auth/me | Current user | bearer |
| /api/engagements | CMMC engagement CRUD | bearer |
| /api/parties | Party CRUD | bearer |
| /api/contracts | Contract CRUD | bearer |
| /api/sessions | Interview session state | bearer |
| /api/interview | Static question delivery | bearer |
| /api/coach | Claude AI chat coach | bearer |
| /api/plan/push | Mission Plan + manifests push to filesystem | bearer + role |
| /api/plan/results | Stamper execution results ingest | bearer + role |
| /api/plan/status | Directive progress poll | bearer + role |
| /api/harvest | MS Graph data harvest | bearer |
| /api/discovery | Sim/live tenant discovery | bearer |
| /api/live | Device-code consent + access flag | bearer |
| /api/recipes | PowerShell recipe list + ingest | bearer |
| /api/delivery | Artifact delivery portal | bearer |
| /api/sprs | SPRS score | bearer |
| /api/reassessment | Annuity reassessment scheduling | bearer |
| /api/hil | Human-in-the-loop items | bearer |
| /api/touch | Advisor time tracking | bearer |
| /api/nudges | Party nudge events | bearer |

## Database Models (Prisma/PostgreSQL)

| Model | Purpose |
|-------|---------|
| Tenant | Multi-tenant root |
| User | Authenticated operator/assessor |
| Engagement | CMMC engagement (prime + subs) |
| Party | Individual contractor entity |
| InterviewSession | Muster assessment session |
| Contract | DoD contract details |
| NudgeEvent | Automated party reminders |
| Disposition | Party lifecycle state transitions |
| HilItem | Human-in-the-loop review items |
| TouchEvent | Advisor time tracking |
| DeliveryArtifact | Encrypted result artifact |
| DeliveryGrant | Capability token for artifact download |
| DeliveryAuditEntry | Immutable delivery audit log |

## Cross-Repository Dependencies (actual)

| Consumer | Depends on | Path |
|----------|-----------|------|
| ces-ao, ces-ec, ces-stamper | ces-tenant | file:../ces-tenant |
| ces-eo | ces-tenant, ces-shared | file:../ces-tenant, file:../ces-shared |
| muster-api | ces-shared, ces-tenant | file:../../ces-shared, file:../../ces-tenant |
| ces-stamper tests | ces-muster fixtures | git -C ../ces-muster show main:... |
| muster-api tests | ces-stamper registry | ../ces-stamper/src/registry/ |
| ces-eo integration tests | tenant-stacksim | ../tenant-stacksim/ |

## Startup Ports

| Service | Port | Start command |
|---------|------|---------------|
| PostgreSQL | 5434 | docker compose up -d postgres |
| ces-tenant | 4690 | node dist/service/cli.js serve |
| ces-stacksim | 4390 | node bin/stacksim.mjs serve m365_azure --slug <slug> |
| muster-api | 4000 | npm run dev (from muster-api/) |
| Muster SPA | 5173 | npm run dev (from ces-muster-main/) |
| Stamper GUI | 5002 | npm run stamper (from ces-mono-main/) |
| Planner GUI | 5001 | npm run planner (from ces-mono-main/) |
| AO GUI | 5003 | npm run ao (from ces-mono-main/) |
| EO server | 5004 | npm run eo (from ces-mono-main/) |

## Runtime Requirements

- Node.js 20+ (tested on 24.16.0)
- npm 11+
- Docker Desktop (for PostgreSQL)
- PowerShell 5.1+ on Windows (for stacksim shims + recipe execution)
- Git (for stamper fixture tests)
