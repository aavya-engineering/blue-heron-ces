# Stamper — Functional Description

## What It Does

Stamper is a CMMC L2 compliance orchestration engine for M365 GCC High and Azure Government tenants. It takes a mission plan (what controls to satisfy), looks up the exact PowerShell commands from a registry, checks what's already configured in the tenant, and executes what's missing — collecting audit-grade evidence along the way.

---

## Workflow Rail (4 Steps)

### 1. Translate
Compiles a CES mission plan into an executable plan. Each control reference (e.g. AC.L2-3.1.1) is resolved against the command registry to produce concrete sub-commands with `set_command`, `get_command`, capture specs, and variable requirements. Tasks are sorted into execution layers L0–L8 to enforce dependency order. Manifest variables (tenant name, resource group, etc.) are validated here — missing ones fail the translate.

### 2. Discover
Runs every sub-command's `get_command` against the live tenant to determine what already exists. Each sub-command gets a status: exists, missing, or error. Captured values (resource IDs, URIs) are injected into the variable context for downstream commands. After discovery, the CMMC Compliance Analyzer cross-references the 110 L2 controls against discovery results and produces satisfied / will-be-satisfied / won't-be-satisfied counts across 14 control families.

### 3. Review
Displays discovery results, CMMC compliance metrics (3 tiles + 14-family breakdown table), and the variable state. The operator inspects what will be changed before proceeding.

### 4. Execute
Runs the plan against the tenant. The operator picks one of 5 modes (see below). For each task, sub-commands are resolved, executed via the appropriate adapter, and evidence is collected. Captures from each command feed into the next. Results stream to the GUI via SSE in real time.

---

## Major Components

### GuiServer (`src/server/GuiServer.ts`)
Express server. Hosts the GUI, exposes REST + SSE endpoints for translate, discover, assess, execute, approve, and abort. Manages approval gates (manual/incremental/batch), tenant config CRUD, and evidence directory setup.

### Command Registries (`src/registry/`)
223 entries total: 150 M365 + 73 Azure infra (re-counted directly from `cmmc-l2-commands.registry.json` + `infra-cmmc-l2-commands.registry.json`, 2026-08-07; corroborated by `docs/STACK-PLURAL-ROADMAP.md`. The former figure of 172 = 119 + 53 was stale). Each entry maps a CMMC control to a concrete `set_command` / `get_command` pair with engine tag, idempotency class, variable requirements, capture specs, and evidence commands. The registry is the single source of truth for what Stamper can configure.

Engine tags with entries: `mgraph` 94, `az` 73, `exchange` 24, `manual_gate` 20, `ipps` 11, `teams` 1. Note `spo` is a wired channel in `src/core/TaskRunner.ts` but currently carries **zero** registry entries — the seven-tag list this document previously implied overstates coverage.

### PlanTranslator (`src/translators/PlanTranslator.ts`)
Converts a CES mission plan into an executable plan by looking up registry entries for each control, generating sub-command arrays, classifying tasks into layers, and validating variable requirements.

### TaskRunner (`src/core/TaskRunner.ts`)
Dispatches tasks to the correct engine adapter. Handles drift exception routing (overrides to manual_gate), evidence collection handoff, and capture value queries for accomplished sub-commands.

### PowerShellAdapter (`src/adapters/PowerShellAdapter.ts`)
Handles ~90% of execution. Routes commands to pre-authenticated PowerShell sessions by engine tag. Implements get-then-set idempotency (run get_command first, skip set_command if resource exists for `New-*` commands). Extracts captures from command output via JSON path or regex. Runs evidence_commands after successful execution.

### ManualGateAdapter (`src/adapters/ManualGateAdapter.ts`)
Handles non-technical controls (physical security, policy, training). In GUI mode, the approval gate in the SSE flow serves as the gate — no commands are executed.

### ExecutionContext (`src/core/ExecutionContext.ts`)
Two-phase variable resolution. Phase 1 (translate-time): manifest/config variables like `{tenantDomain}`, `{resourceGroup}`. Phase 2 (runtime): captured values from prior commands like `{groupObjectId}`, `{lawResourceId}`. Resolves `{variableName}` placeholders in command templates.

### SessionManager (`src/core/SessionManager.ts`)
Pre-authenticates PowerShell sessions for each engine type (Graph, Exchange, IPPS, Azure, SPO, Teams) using tenant config credentials (cert-based auth).

### CmmcComplianceAnalyzer (`src/core/CmmcComplianceAnalyzer.ts`)
Loads the 110 CMMC L2 controls from the canonical ces-shared reference (`ces-shared/data/cmmc-l2-controls`) and weights them with the canonical SPRS table (`ces-shared/data/sprs-weights`, `sprs-weights/2.0.0`). Cross-references against both registries via `nist_ref` matching. Categorizes each control as satisfied, will-be-satisfied, won't-be-satisfied or not-verified based on discovery results and plan coverage. A plan directive alone (implement / validate) never makes a control satisfied: it needs a tenant read or a recorded real (non-dry-run) post-state, otherwise it is `not_verified` and deducts its SPRS weight (FX2-ST2, 2026-09-27).

### InfraManifestGenerator (`src/generators/infraManifestGenerator.ts`)
Generates the infrastructure manifest (5th mission plan artifact) from TCP questionnaire inputs. Produces 7 sections (identity, logging, security, storage, network, automation, diagnostics) with a `stamper_variable_map` of 14 keys and provenance tracking per derived value.

### GUI (`public/index.html`)
Single HTML file with embedded CSS/JS. 4-step workflow rail across the top. Left column: tenant selector, plan upload, infra manifest form, variable editor. Right column: real-time execution console with step/sub-command expansion, approval buttons, discovery badges, and evidence links. All server communication via fetch + SSE EventSource.

---

## Execution Modes

| Mode | Gates At | Behavior |
|------|----------|----------|
| **dryrun_log** | None | Collects commands without executing; writes log JSON |
| **manual** | Per sub-command | Operator approves/skips/accomplishes each sub-command |
| **incremental** | Per step | Operator approves each step; sub-commands auto-execute |
| **batch** | Per layer | Operator approves layer transitions; tasks auto-execute within |
| **auto** | None | Everything runs sequentially, no pausing |

---

## Key Mechanisms

**Capture Chaining**: Sub-command A creates a resource and captures its ID → Sub-command B uses that ID to configure the resource. Broken chains (skipped upstream command) trigger downstream impact warnings.

**Idempotency**: `get-then-set` runs the get_command first; if the resource exists, `New-*` commands are auto-skipped. `Set-*`/`Update-*` commands re-run (they're idempotent). `evidence-only` entries only query, never mutate.

**Evidence Collection**: After each successful task, evidence_commands run to produce audit-grade output. Artifacts are SHA-256 hashed and stored in `~/.stamper/evidence/{tenant}/{planId}/`.

**Tenant Config**: Stored at `~/.stamper/tenants/{slug}.json`. Contains auth credentials (cert-based), endpoint URLs (GCC High), subscription/resource details, and last-session state.
