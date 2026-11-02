# CES Module Architecture: Muster, Stamper, AdminOps, EvidenceOps

Date: 2026-09-29. Source: the code on `main` (see SHAs below); docs were used only where the code agreed. Test counts are approximate grep counts. Paths are relative to each module folder.

## Comparison table

| Element | Muster | Stamper | AdminOps (AO) | EvidenceOps (EO) |
|---|---|---|---|---|
| **Purpose** | CMMC L2 readiness assessment for primes and subs<br>Interview, SPRS scoring, tenant discovery<br>Emits readiness record + Mission Plan for Stamper | Turns a Mission Plan into an executable plan<br>Runs it against the GCC High tenant via PowerShell<br>Records hashed evidence and per-control results | Governed runner for 95 CMMC admin commands<br>Every run is a preview unless live write is explicitly allowed<br>Every run leaves an evidence row | Continuous evidence collection and control assessment<br>Produces SSP, POA&M, SPRS score, C3PAO package |
| **Runtime and frameworks** | TypeScript; SPA: React 18, Vite 6, Zustand, Dexie<br>API: Node, Express 4, Prisma 5 on PostgreSQL, zod, JWT<br>Anthropic SDK (interview coach) | Node 18+, TypeScript, ESM<br>Express 4, commander, inquirer, listr2, zod | Node 18+, TypeScript, ESM<br>Express 4, commander<br>Depends on ces-stamper package itself | Node, TypeScript, ESM<br>Express 4, zod, handlebars, docx, pdf-lib, archiver<br>WebAuthn (passkeys) |
| **User surfaces** | Web UI: React SPA<br>CLI: mu<br>HTTP API: /auth, /api/\* (17 groups), /portal<br>MCP: none | Web UI: static pages<br>CLI: stamper (execute, resume, rollback, validate, report, gui) + TUI<br>HTTP API: 12 routers; execute streams via SSE<br>MCP: none | Web UI: single static page<br>CLI: ao (list, show, exec, approvals, approve)<br>MCP: stdio server, 5 tools<br>HTTP API: health, tenant, commands, execute, approvals | Web UI: large static page + assessor view<br>CLI: passkey enrollment only<br>HTTP API: ~119 routes in 10 routers<br>MCP: none |
| **Process model and ports** | SPA on 5173 (dev) / 4173 (preview)<br>API on 4000<br>Optional hourly scheduler (nudges, reassessment), one tenant only<br>Discovery jobs held in memory | One Express process on 3000 (mono launcher: 5002)<br>Spawns powershell.exe per run<br>Can autostart ces-ec on 4001<br>No scheduler | One Express process on 3000/3001 (mono launcher: 5003)<br>MCP server is a separate stdio process<br>No scheduler | One Express process on 4002 (mono launcher: 5004)<br>Optional in-process signal-capture timer, default tenant only<br>Persistent PowerShell hosts via ces-tenant |
| **Core engines** | SPA: adaptiveEngine, questionGraph, sprsCalc, planCompileService, exportPipeline<br>API: discoveryService, liveAccess, harvestService, deliveryService, coachService | StamperEngine, TaskRunner, DependencyResolver<br>PlanTranslator, PowerShellAdapter<br>GapAnalyzer, OutputVerificationEngine<br>IdempotencyGuard, RollbackHandler<br>Registries: 150 M365 + 73 infra commands | CommandExecutor, invokeCommand (shared by CLI/MCP)<br>GetThenSetExecutor<br>Gates: SodGate, CmmcScopeGate, SimOnlyRail, ApplyGuard<br>ApprovalStore, EvidenceEmitter, TemplateRegistry | ComplianceSignalFetcher<br>SignalToControlMapper + per-family evaluators<br>ControlAssessor, SprsCalculator<br>SspGenerator, PoamGenerator, EvidencePackager<br>ApproverTokenIssuer |
| **Data stores** | PostgreSQL via Prisma (7 migrations): tenants, users, engagements, sessions, contracts, delivery artifacts as DB blobs<br>Row-level security by tenant<br>Browser: IndexedDB (Dexie) + localStorage<br>Plan files in Stamper plan-data folder | Shared SQLite ces.db (ces-shared): assess/execution state, change log, evidence metadata<br>JSON under plan-data/&lt;slug>/ (plans, logs, state, evidence)<br>Evidence copies to Azure Blob | Shared SQLite ces.db: adminops_evidence, adminops_approvals<br>Command catalogue: JSON registry (95 entries)<br>Tenant records: ces-tenant JSON registry | Shared SQLite ces.db: 19 collections (assessments, POA&M, personnel, risk, passkeys)<br>JSON/zip files under storage root<br>Azure Blob for evidence<br>Read-only YAML knowledge bank (95 files) |
| **Microsoft integration and tenant auth** | Graph via direct REST (GCC High)<br>PowerShell: Graph, Exchange, Purview, Az, Teams (read-only discovery)<br>Auth: delegated device-code, per-area consent, token in memory only | PowerShell: Graph, Exchange, Purview (IPPS), Az, Teams, SharePoint<br>Auth: app-only certificate thumbprint via ces-tenant<br>Bicep adapter is a stub | Runs through Stamper PowerShellAdapter<br>Graph, Az (incl. ARM REST), Purview, Exchange, SharePoint; Intune/Defender via Graph<br>Auth: app-only certificate via ces-tenant | PowerShell: Graph, Exchange, Purview, Az, SharePoint, Teams<br>Auth: app-only certificate thumbprint via ces-tenant<br>No MSAL; Graph SDK declared but not used for live calls |
| **Contracts in and out** | Out: Mission Plan 1.0.0 + Tenant/Infra Manifests, written as files to Stamper<br>In: execution-results 1.1.0 via POST /api/plan/results<br>Own: readiness-result 1.1.0<br>SPA vendors a hash-pinned copy of ces-shared; API links it by file path | In: Mission Plan 1.0.0 (files)<br>Out: execution-results 1.1.0 POST to Muster (localhost only by default)<br>Out: render directive in evidence JSON for EO<br>Exports PowerShellAdapter used by AO | Out: adminops-evidence 1.3.0 rows in shared ces.db<br>In: approver tokens minted by EO<br>In: tenant records from ces-tenant<br>No Muster or ces-ec hand-off | In: AO evidence rows (reads ces.db directly)<br>In: Stamper registry and plan-data (reads disk directly)<br>In: ces-ec evidence 1.0.0 over HTTP (4001)<br>Out: approver tokens for AO |
| **Operator identity and authorization** | Email + password (bcrypt), HS256 JWT, 8-hour expiry<br>Roles: prime, sub, bhd_operator, assessor_read_only<br>Delivery grantees: hashed capability tokens | Loopback trusted; network needs bearer token<br>No user accounts or roles<br>Approvals logged as a fixed "gui-operator" | Loopback trusted; network needs bearer token<br>Approvals need a signed principal with ao-approver role and matching tenant<br>Typed approver names refused | Loopback trusted; network needs bearer token<br>Approver-token minting needs bhd-operator: passkey, Entra group, or loopback dev key<br>No per-user roles on other routes |
| **Safety rails** | Live access off by default; operator enables per engagement + tenant consent<br>Read-only scopes; write-verb denylist<br>Sim mode pinned to simulator, verified zero writes<br>Tenant isolation by row-level security | Dry-run and dev modes<br>Four execute modes: manual, incremental, batch, auto<br>Idempotency guard, scope-exclusion check, rollback<br>Simulator module shadowing | Dry-run default on every surface; explicit apply switch each<br>Sim-only default; live needs explicit flag<br>Tier 3 = two-person approval, input-hash-bound, single use<br>CMMC scope gate fails closed | Sessions bound to one tenant; scoped DB reads<br>Approver tokens: no self-mint, 30-min cap, logged before issue<br>SHA-256 evidence hash with verify endpoints<br>No hash chain or signing; no dry-run of its own |
| **Evidence and outputs** | Readiness result JSON and report<br>Mission Plan, Tenant and Infra Manifests<br>Discovery captures, collector kit<br>Delivery portal downloads (90-day retention, audit trail) | SHA-256-hashed evidence files<br>JSON and Markdown execution reports, gap plans<br>Execution-results manifest | One evidence row per terminal state (dry-run, denied, pending, rejected, executed, failed)<br>Pre/post state, verdict, SHA-256<br>Persistence failure surfaced, never silent | SSP (JSON + DOCX)<br>POA&M (JSON/DOCX + ledger)<br>SPRS score and history<br>C3PAO zip package, assessor HTML view, policy/risk DOCX |
| **Configuration and secrets** | .env: database URL, JWT secret, live client ID, Anthropic key, sibling paths<br>No key vault<br>SPA keeps JWT in localStorage | .env + ces-tenant registry<br>Storage key supports env: reference; strict mode rejects inline keys<br>Operator secrets held in memory only | Env vars (CES_AO_\*, AO_\*)<br>Tenant JSON holds only cert thumbprint and path<br>Approver HMAC secret from env | .env + zod-validated config<br>Tenant JSON holds Azure Storage key in plaintext<br>Bearer and token secrets from env |
| **Tests (approximate)** | Vitest + Playwright<br>SPA ~69 files / ~389 cases; API ~54 / ~415; e2e 10 / 11<br>6 API files use simulator; 3 need live Postgres | Jest<br>~44 files / ~403 cases<br>6 files use simulator | Vitest<br>~49 files / ~374 cases<br>Simulator integration suites opt-in only | Jest<br>~100 files / ~951 cases<br>10 files use simulated tenant |
| **Key source files** | `muster-api/src/app.ts`<br>`muster-api/src/services/liveAccess.ts`<br>`muster-api/src/services/discoveryService.ts`<br>`muster-api/src/routes/plan.ts`<br>`src/features/plan/planCompileService.ts` | `src/server/routes/execute.routes.ts`<br>`src/translators/PlanTranslator.ts`<br>`src/adapters/PowerShellAdapter.ts`<br>`src/server/GuiServer.ts`<br>`src/core/ExecutionResultsPublisher.ts` | `src/execution/CommandExecutor.ts`<br>`src/registry/TemplateRegistry.ts`<br>`src/execution/ApprovalStore.ts`<br>`src/execution/EvidenceEmitter.ts`<br>`src/server/AoServer.ts` | `src/eo/server/EoServer.ts`<br>`src/eo/ingestion/ComplianceSignalFetcher.ts`<br>`src/eo/mapping/SignalToControlMapper.ts`<br>`src/eo/ssp/SspGenerator.ts`<br>`src/eo/approver-tokens/ApproverTokenIssuer.ts` |
| **Architectural risks and debts** | Consents, tokens and discovery jobs live in process memory; restart or scale-out drops them<br>Runs its own OAuth and PowerShell, contrary to its design doc (ces-tenant path unused) | Execution logic in one ~2,800-line route file with process-global state; one run at a time, approvals not durable<br>GUI defaults to auto mode; CLI defaults to manual | Reaches into Stamper internals via unchecked casts; a Stamper change breaks AO at runtime<br>~1,400 lines of hand-written PowerShell templates; real-cmdlet tests are opt-in | Fallback adapter runs Purview cmdlets after an Exchange-only connect (likely fails)<br>Reads other modules’ DB rows and disk paths directly, not via interfaces |

## How they fit together

1. Muster assesses the customer and compiles a Mission Plan; Stamper executes that plan against the tenant and reports results back to Muster.
2. AdminOps runs day-to-day admin commands under dry-run, sim-only and two-person gates, and writes one evidence row per run.
3. EvidenceOps collects tenant signals, reads AO and Stamper outputs, and produces the SSP, POA&M, SPRS score and assessor package.
4. All four live in one data spine: ces-shared (contracts, shared SQLite ces.db, hashing) and ces-tenant (tenant registry, certificate PowerShell sessions); Muster is the exception, with its own Postgres and delegated auth.
5. tenant-stacksim stands in for the tenant in tests and demos; ces-ec (Evidence Collector) feeds manual evidence to EO.

```text
Muster --Mission Plan files--> Stamper --PowerShell (cert, app-only)--> tenant
Stamper --execution-results POST--> Muster
Stamper --evidence + render directive / plan-data--> EvidenceOps
AdminOps --PowerShell via Stamper adapter--> tenant
AdminOps --evidence rows (shared ces.db)--> EvidenceOps
EvidenceOps --approver tokens--> AdminOps
ces-ec --manual evidence (HTTP 4001)--> EvidenceOps
EvidenceOps --> SSP, POA&M, SPRS, C3PAO package
```

## Commits read

| Repo | Branch | SHA | Commit date |
|---|---|---|---|
| ces-mono (Stamper, AdminOps, EvidenceOps, ces-shared) | main | `411698c` | 2026-09-28 |
| ces-muster (own repo) | main | `1b6f0f6` | 2026-09-28 |

## Legend

- **AO**: AdminOps (ces-ao)
- **EO**: EvidenceOps (ces-eo)
- **ces-ec**: Evidence Collector: manual evidence intake and integrity ledger
- **ces-shared**: Shared library: contracts, SQLite repository, hashing, stack config (v2.8.0)
- **ces-tenant**: Tenant registry and certificate-based PowerShell session factory
- **tenant-stacksim / simulator**: Local fake GCC High tenant (port 4390) used for sim runs and tests
- **ces.db**: The shared SQLite database under the CES pipeline root
- **GCC High**: Microsoft 365 Government Community Cloud High
- **CMMC L2**: Cybersecurity Maturity Model Certification, Level 2
- **SPRS**: Supplier Performance Risk System score
- **SSP**: System Security Plan
- **POA&M**: Plan of Action and Milestones
- **C3PAO**: Certified third-party assessment organization
- **IPPS**: Security & Compliance (Purview) PowerShell session
- **SSE**: Server-sent events (streamed HTTP)
- **JWT / HS256 / HMAC**: Signed login token; HS256 = HMAC-SHA256 signing with a shared secret
- **MCP**: Model Context Protocol: interface that lets AI agents call the module as tools
- **MSAL**: Microsoft Authentication Library
- **ARM**: Azure Resource Manager (Azure management API)
- **Entra**: Microsoft Entra ID, the Microsoft identity service
- **Bicep**: Azure infrastructure-as-code language
- **SPA / TUI**: Single-page web app / text (terminal) user interface
- **App-only vs delegated**: App-only: the app signs in with its own certificate. Delegated: a user signs in and grants consent
- **Tier 2 / Tier 3**: AO risk tiers; Tier 3 (destructive) needs two-person approval
- **Dry-run / sim-only**: Dry-run: preview, no change. Sim-only: allowed to run only against the simulator
- **Mono launcher**: Root-level npm scripts in the mono repo that start modules on 5002-5004
