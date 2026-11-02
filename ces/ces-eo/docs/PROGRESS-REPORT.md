# Evidence Ops — Progress Report

**Date:** 2026-04-15
**Branch:** `fabrica-unified` (26 commits ahead of `master`, merged to `master`)
**Orchestration:** Fabrica artifact-driven pipeline

---

## 1. What We Have Accomplished

### SSP (System Security Plan) Generator
- **SspGenerator** (399 lines) — Generates structured SSP from assessment snapshots, manifests, variables, mission plans, and registries. 3-level system name fallback, 8 front matter fields from variables, practice-text narrative fallback for 100% coverage.
- **SspDocxExporter** (613 lines) — Full 15-section CMMC Level 2 SSP document with CUI markings, signature pages, revision history, TOC, and all 110 controls grouped by 14 families. Color-coded status badges, evidence tables, and classification labels (automated/manual/nonstack).
- **SnippetDataResolver** (277 lines) — Resolves SSP narrative data from tenant manifests, infrastructure manifests, and mission plans. Handles 28 manual gate controls, ODP value extraction, and evidence artifact tracking. Manifest unwrapping for real Planner file structures.
- **111 Handlebars snippet templates** — One per CMMC control across all 14 families (AC, SC, IA, CM, AU, MP, SI, MA, IR, RA, PE, AT, CA, PS). Conditional narratives using `{{#if}}` / `{{#unless}}` patterns with signal-driven data.
- **14 family fixture files + 14 JSON schemas** — Validation infrastructure for template testing.

### POA&M (Plan of Action & Milestones) Generator
- **PoamGenerator** (231 lines) — Full NIST SP 800-171 eligibility logic: 5pt/3pt weight rules, prohibited controls, partial credit for SC.L2-3.13.11, automation flags from Stamper registries.
- **PoamDocxExporter** (513 lines) — CUI-marked DOCX with cover page, eligibility section (color-coded certification path), blockers table, 8-column POA&M items table, and summary section.

### Evidence Package Builder
- **EvidencePackager** (232 lines) — Bundles SSP DOCX + POA&M DOCX + JSON artifacts + evidence files into a single .zip with SHA-256 integrity manifest. Graceful degradation when DOCX generation fails.

### API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ssp/export/:sspId` | GET | Download SSP as DOCX |
| `/api/poam/export/:poamId` | GET | Download POA&M as DOCX |
| `/api/poam/generate` | POST | Generate POA&M JSON |
| `/api/poam/latest` | GET | Get latest POA&M JSON |
| `/api/package/build` | POST | Build evidence .zip (SSP + POA&M + artifacts) |

### SSP Section 14 Cross-Reference
- SSP Section 14 renders actual POA&M summary (item count, projected SPRS, certification path) instead of placeholder when POA&M data is available.

### Quality Improvements
- System name resolves from manifest `display_name` (not tenant GUID)
- 110/110 control narratives populated (0 placeholders)
- 8 front matter fields wired from variables with manifest fallback
- Classification field (automated/manual/nonstack) in DOCX output

### Integration Tests
- `scripts/integration-test-ssp.ts` — SSP DOCX generation (110 controls, 24.9 KB)
- `scripts/integration-test-poam.ts` — POA&M DOCX generation (16 items, 11.0 KB)
- `scripts/integration-test-package.ts` — End-to-end .zip build (7 files, 51.1 KB)

### Template Engine Integration
- **ControlAssessor.buildSignalsForControl()** — 29-entry `ENTRY_TO_SIGNAL_ID` map converting discovery results to `SignalResult[]`, replacing hardcoded `signals: []`
- **SspGenerator narrative priority reorder** — Template engine (signal-driven Handlebars) > manifest resolver > mission plan > practice-text fallback
- **SnippetTemplateEngine.buildContext()** — Fixed `evidenceArtifactUrl` to use first URL instead of comma-joined array

### Assessment Objective Mapping
- **320 assessment objectives** — canonical count, `ces-shared/src/data/assessment-objectives.reference.json` (320 entries, direct count 2026-08-07; pinned by `tests/ssp/ssp-objective-mapping.test.ts:55`). The **324** this line previously carried is the *templated* count generated out of `domain CES CMMC Fundamental Requirements Store.yaml`, where objectives derive from two text templates per control — it is not an assessment-objective count and must not be quoted as one. (A third figure, **318**, appears in Microsoft's CMMC L2 Technical Reference Guide; cite by source, never interchangeably.)
- **`scripts/convert-objectives-yaml-to-json.cjs`** — Conversion script producing `assessment-objectives.reference.json`
- **Status inheritance** — Control verdict maps to objective status (met → satisfied, not_met → other_than_satisfied, not_assessed → not_assessed)
- **SspDocxExporter Section 8** — Per-control objectives table with color-coded status rendering

### Key Metrics
- **2,265+ lines** of new SSP/POA&M/Package code
- **111 Handlebars templates** across 14 CMMC families
- **324 assessment objectives** mapped from NIST SP 800-171A
- **3 integration tests** all passing
- **12 Fabrica commits** on branch (f77ce78..222f7bc)

---

## 2. What Remains To Be Done

### Production Hardening
- **SHA-256 evidence hash resolution** — Evidence tables in SSP currently show artifact reference IDs. Need to resolve actual SHA-256 hashes from Azure Blob Storage for tamper-evident audit trails.
- **Error handling audit** — API endpoints need consistent error responses, rate limiting, and input validation for production deployment.
- **Storage cleanup** — Old SSP/POA&M JSON versions accumulate without TTL policy or cleanup mechanism.

### Advanced Document Features
- **Revision history from git** — Auto-populate SSP revision history from git commit log instead of manual entry.
- **PDF export** — Some assessors prefer PDF. Could add a DOCX-to-PDF conversion step.
- **Custom DOCX templates** — Allow organizations to provide their own DOCX template with branding/letterhead.

### Assessor Workflow
- **Interactive POA&M editing** — Allow assessors to update corrective actions, target dates, and responsible parties through the EO UI.
- **Assessment objective drill-down** — Per-objective evidence mapping with pass/fail status visible in the UI.
- **Diff between assessment runs** — Show what changed between consecutive assessments (new findings, resolved controls, score delta).

### Cross-Project Integration
- **Stamper automation sync** — POA&M `automationAvailable` flag is currently static. Could dynamically check Stamper registry for available set_commands per control.
- **Planner feedback loop** — When POA&M identifies blocked controls, feed back to Planner to auto-generate remediation steps in the next mission plan.
- **Multi-tenant dashboard** — Aggregate SSP/POA&M/SPRS data across multiple tenants for MSP-level reporting.
