# Enclave Stamper — Operations Guide

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | >= 18.0.0 | `node --version` |
| PowerShell | >= 7.0 | `pwsh --version` |
| Microsoft.Graph module | latest | `Get-Module Microsoft.Graph -ListAvailable` |
| ExchangeOnlineManagement module | latest | `Get-Module ExchangeOnlineManagement -ListAvailable` |
| Az.Accounts module | latest | `Get-Module Az.Accounts -ListAvailable` |
| Az.OperationalInsights module | latest | `Get-Module Az.OperationalInsights -ListAvailable` |
| Az.SecurityInsights module | latest | `Get-Module Az.SecurityInsights -ListAvailable` |
| Az.Network module | latest | `Get-Module Az.Network -ListAvailable` |
| Az.KeyVault module | latest | `Get-Module Az.KeyVault -ListAvailable` |
| PnP.PowerShell module | latest | `Get-Module PnP.PowerShell -ListAvailable` |
| MicrosoftTeams module | >= 5.9.0 | `Get-Module MicrosoftTeams -ListAvailable` |
| Global Administrator role | — | Required for bootstrap only |
| Windows | 10/11 | Primary operator platform |

### PowerShell Session Types

The Stamper uses 6 distinct PowerShell sessions, each connected to a different M365/Azure service:

| Session | Engine | Connect Command | Module |
|---|---|---|---|
| `graph` | `mgraph` | `Connect-MgGraph -Environment USGov` | Microsoft.Graph |
| `exchange` | `exchange` | `Connect-ExchangeOnline -ExchangeEnvironmentName O365USGovGCCHigh` | ExchangeOnlineManagement |
| `purview` | `ipps` | `Connect-IPPSSession -ConnectionUri https://ps.compliance.protection.office365.us/powershell-liveid/ -AzureADAuthorizationEndpointUri https://login.microsoftonline.us/organizations` | ExchangeOnlineManagement |
| `azure` | `az` | `Connect-AzAccount -Environment AzureUSGovernment` | Az.Accounts |
| `sharepoint` | `spo` | `Connect-PnPOnline -AzureEnvironment USGovernmentHigh` | PnP.PowerShell |
| `teams` | `teams` | `Connect-MicrosoftTeams` (env auto-resolved from TenantId) | MicrosoftTeams >= 5.0.1 |

Sessions connect lazily (on first command) and reconnect automatically if the token is within 5 minutes of expiry. All sessions use certificate-based app-only auth for unattended automation.

**Teams bootstrap requirement:** Before the Stamper can manage Teams policies, run `New-CsApplicationAccessPolicy` once during tenant onboarding to authorize the app registration for Teams PowerShell.

### Command Registry

The CMMC L2 Command Registry (`src/registry/cmmc-l2-commands.registry.json`) encodes **118 deterministic commands** covering all 14 CMMC L2 control families:

- **74 automatable** commands (PowerShell/Graph/CLI)
- **44 manual-gate** entries (physical/process controls, evidence collection)
- **6 runtime captures** chain output between commands (e.g., group ID → CA policy)

Engine distribution: 48 mgraph, 19 exchange, 16 az, 6 ipps, 2 spo, 1 teams, 26 manual_gate.

### Variable Contract Validation

At translate-time, the Stamper validates that all `variables_required` (from the manifest) and `variables_runtime` (from prior command captures) are satisfiable. Missing variables produce a full error report:

```
Variable "cuiGroupName" required by "AC.L2-3.1.1.group-create" in step "step-001"
is not provided by manifest config and is not produced by any prior command capture.
```

### Sub-Command Execution Model

One Mission Plan step can map to multiple registry commands (sub-commands). For example, `AC.L2-3.1.1` produces 2 sub-commands: group-create (seq 0) → member-add (seq 1). Sub-commands execute sequentially within a step, with captured variables flowing forward. Step status is derived from sub-command results:

- All pass → step passes
- Any fails with `abort_step` → step fails
- Any fails with `warn_continue` → step passes with warnings
- Any fails with `abort_plan` → entire plan aborts

---

## Execution Model and IP Ownership

### BHD Infrastructure Statement

The Stamper engine runs **entirely on Blue Heron Defense-controlled hardware**. All Microsoft 365 and Azure operations are performed via HTTPS API calls originating from BHD infrastructure. No BHD engine code is deployed to the ValorForge Solutions tenant.

> **Verbatim confirmation:** "Executing from BHD infrastructure — no engine code deployed to target tenant."

### What Lives in the VFS Tenant

Only one artifact from this engagement resides inside the ValorForge Solutions tenant:

- **Entra ID App Registration** — a service principal created during `stamper bootstrap`. This is not BHD code; it is a standard Microsoft identity object owned and controlled by ValorForge Solutions.

ValorForge Solutions retains full revocation rights. Removing the Entra app registration immediately terminates all BHD access to the tenant — no other cleanup is required.

### 3-Layer IP Separation

| Layer | Owner | What It Contains | File Reference |
|-------|-------|-----------------|----------------|
| Layer 1 — BHD Engine | Blue Heron Defense, LLC | Orchestration logic, adapters, translators, state management, dependency resolution | `src/config/StamperConfig.ts`, `src/core/StamperEngine.ts` |
| Layer 2 — Client Configuration | ValorForge Solutions | Tenant ID, app registration ID, certificate thumbprint, tenant domain | `src/config/ClientConfig.ts` |
| Layer 3 — Evidence Outputs | ValorForge Solutions | Execution reports, evidence artifacts, compliance records | `src/evidence/EvidenceStore.ts`, `src/reporting/ExecutionReporter.ts` |

### Certificate-Based Authentication and VFS Revocation Rights

The Stamper authenticates to the VFS tenant using a certificate registered against the Entra app registration:

- The certificate private key is stored on **BHD-controlled hardware** (`C:\stamper-certs\` by default).
- The Entra app registration (containing the certificate public key) lives in the VFS tenant.
- **VFS revocation:** Delete the app registration in Entra ID (`portal.azure.us` → App Registrations → CMMC-Automation → Delete). BHD loses access immediately.
- No VFS tenant data or credentials are stored in BHD systems beyond the certificate used for the registered app.

### Canonical IP Declaration File

All BHD and VFS attribution strings — including the `generatedBy`, `onBehalfOf`, and `licenseType` fields stamped on every output artifact — are defined in a single location:

```
src/config/provenance.ts
```

This file is the sole source of truth for engagement attribution. Changing the client name or engagement scope requires editing exactly one file.

---

## Step 1: Install Dependencies & Build

```powershell
cd stamper
npm install
npm run build
```

This compiles TypeScript to `dist/`. The CLI entry point is `dist/cli/index.js`.

To use the `stamper` command globally:

```powershell
npm link
```

Or run directly without linking:

```powershell
node dist/cli/index.js <command>
```

---

## Step 2: Bootstrap Tenant Connection

Bootstrap creates an Entra ID app registration, generates a certificate, grants Graph API permissions, and writes a `.env` file.

### Option A: Via Stamper CLI

```powershell
stamper bootstrap --tenant-id <GUID> --display-name "CMMC-Automation" --environment gcchigh
```

### Option B: Direct PowerShell

```powershell
cd stamper/scripts
.\New-TenantBootstrap.ps1 `
  -TenantId "12345678-1234-1234-1234-123456789012" `
  -DisplayName "CMMC-Automation" `
  -Environment GCCHigh
```

Both methods produce a `.env` file in the stamper root. The script is idempotent — safe to re-run.

### What Bootstrap Does

1. Checks prerequisites (PowerShell 7+, Microsoft.Graph module)
2. Prompts Global Admin sign-in (interactive)
3. Creates/reuses Entra ID app registration
4. Generates 2048-bit RSA self-signed certificate (2-year validity)
5. Grants 15 Microsoft Graph application permissions with admin consent
6. Writes `.env` configuration file
7. Validates connectivity via certificate-based auth

### Verify Bootstrap

```powershell
# Certificate exists
Test-Path "C:\stamper-certs\CMMC-Automation.pfx"

# .env is populated
Get-Content stamper\.env

# Manual connectivity test
Connect-MgGraph -ClientId <app-id> -TenantId <tenant-id> -CertificateThumbprint <thumbprint> -Environment USGov
Get-MgOrganization
Disconnect-MgGraph
```

---

## Step 3: Prepare Input Files

Stamper requires **two input files** from the CES platform:

| File | Description | Source |
|---|---|---|
| Manual Mission Plan (`.json`) | 128 tasks with PowerShell commands, dependencies, layer assignments | CES Platform export |
| Tenant Manifest (`.json`) | 128 controls, 135 config intents, 133 evidence monitors, drift policies | CES Platform export |

These are separate files. The Mission Plan contains the execution steps. The Tenant Manifest contains the compliance specification (what the tenant should look like).

### File Locations

Place them anywhere accessible. Example:

```
C:\stamper-data\
  mission-plan.json
  tenant-manifest.json
```

For testing, synthetic fixtures are at:

```
stamper/tests/fixtures/synthetic-mission-plan.json
stamper/tests/fixtures/synthetic-tenant-manifest.json
```

---

## Step 4: Translate

Translation converts the CES Manual Mission Plan + Tenant Manifest into an Executable Plan that the Stamper engine can run.

```powershell
stamper translate <mission-plan.json> -m <tenant-manifest.json> [-o <output.json>]
```

### Examples

```powershell
# Basic — output goes to <input-name>.executable.json
stamper translate mission-plan.json -m tenant-manifest.json

# Custom output path
stamper translate mission-plan.json -m tenant-manifest.json -o my-plan.executable.json

# Translate AND immediately dry-run execute
stamper translate mission-plan.json -m tenant-manifest.json --execute

# Using test fixtures
stamper translate tests/fixtures/synthetic-mission-plan.json `
  -m tests/fixtures/synthetic-tenant-manifest.json `
  -o tests/fixtures/test-output.executable.json
```

### What Translation Does

1. Parses and validates both JSON files against Zod schemas
2. Assigns each task to an execution layer (L0–L8) based on service type
3. Cross-references config intents from the Tenant Manifest to inject:
   - `_desired_config` — the target state for each task's control
   - `_get_command` — the PowerShell GET command to read current state
   - `_idempotency_pattern` — `get-then-patch`, `deterministic-guid-put`, or `safe-ps`
   - `_evidence_commands` — commands to collect post-execution evidence
4. Routes Purview/DLP tasks to the `ipps` engine (Connect-IPPSSession)
5. Serializes drift policies into `plan.variables._drift_policies`
6. Generates platform-level prechecks from config intent query methods
7. Sorts postchecks by severity (critical > high > medium > low)

### Expected Output

```
Translation Summary
──────────────────────────────────────────────────
  Plan ID:      translated-<name>
  Target Level: L2
  Total Tasks:  128
  Prechecks:    3
  Postchecks:   128

Tasks by Engine:
  powershell: 115
  ipps: 5
  manual_gate: 8
```

---

## Step 5: Validate

Validates the Executable Plan without executing anything.

```powershell
stamper validate <executable-plan.json>
```

### Example

```powershell
stamper validate tests/fixtures/test-output.executable.json
```

Output confirms plan ID, task count, engine breakdown, and structural validity.

---

## Step 6: Execute

### Dry Run (Recommended First)

Dry-run walks the full execution path — prechecks, task dispatch, postchecks — without touching the tenant. No PowerShell subprocesses are spawned.

```powershell
stamper execute <executable-plan.json> --dry-run
```

Or with a specific `.env` file:

```powershell
stamper execute <executable-plan.json> --dry-run -e path/to/.env
```

### What Dry Run Does

- Loads the Executable Plan
- Runs prechecks (skipped with `[dry-run]` note)
- Iterates all tasks in topological order
- Each adapter returns a stub result: `[dry-run] Would execute: <command>`
- IPPS adapter returns: `[dry-run] Would execute via Connect-IPPSSession: <command>`
- Postchecks return `{ skipped: true }` — not fabricated passes
- Writes execution report (JSON + Markdown) to `storage/`

### Live Execution

**This modifies your M365 tenant. Ensure you have:**
- A valid `.env` with real credentials
- Bootstrapped app registration with correct permissions
- Reviewed the dry-run output
- Confirmed the plan covers the intended controls

```powershell
stamper execute <executable-plan.json> -e .env
```

### What Live Execution Does

1. **Prechecks** — Tests connectivity to GCC High endpoints (Graph API, Exchange Online, ARM)
2. **Dependency Resolution** — Topological sort with semantic constraint injection:
   - MFA tasks run before legacy-auth-blocking tasks
   - Audit-log tasks run before retention/label tasks
3. **Idempotency Check** — For each task, runs `_get_command` to read current state. If already applied, skips.
4. **Drift Exception Check** — If a task targets a control covered by an approved drift policy, routes to `manual_gate` (requires human review instead of auto-applying).
5. **Task Dispatch** — Routes to the correct adapter:
   - `powershell` — Connect-MgGraph + PowerShell command
   - `ipps` — Connect-IPPSSession + Purview/DLP command
   - `manual_gate` — Logs requirement for human review
6. **Pre/Post State Capture** — Snapshots config before and after each change
7. **Evidence Collection** — Runs `_evidence_commands` after each task
8. **Change Log** — Appends to `storage/state/<plan-id>/change-log.jsonl`
9. **Postchecks** — Method-based verification:
   - `api_query` — GET to Graph API endpoint, compare expected field
   - `config_export` — Check evidence artifact exists
   - `log_query` — Check task completion in logs
   - `manual` — Returns `passed: false` (requires human review)
10. **Report** — Writes JSON + Markdown execution report

### Resume After Failure

If execution fails partway through, the state is persisted. Re-running the same plan will skip completed tasks automatically (idempotency guard).

```powershell
stamper execute <executable-plan.json> -e .env
```

The engine reads `storage/state/<plan-id>/` to determine which tasks are already complete.

---

## Directory Structure After Execution

```
stamper/
  storage/
    state/
      <plan-id>/
        state.json          # Task completion status
        change-log.jsonl    # Before/after snapshots per task
    evidence/
      <plan-id>/
        <task-id>.json      # Evidence command outputs
    logs/
      stamper.log           # Execution logs
    reports/
      <plan-id>.json        # Machine-readable report
      <plan-id>.md          # Human-readable report
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `TENANT_ID` | Live only | — | Azure AD tenant ID (GUID) |
| `APP_ID` | Live only | — | App registration client ID |
| `CERT_THUMBPRINT` | Live only | — | Certificate thumbprint |
| `CERT_PATH` | Live only | — | Path to .pfx file |
| `GCC_HIGH_ENDPOINTS` | No | `true` | Use GCC High endpoints |
| `GRAPH_ENDPOINT` | No | `https://graph.microsoft.us` | Microsoft Graph API endpoint |
| `LOGIN_ENDPOINT` | No | `https://login.microsoftonline.us` | Azure AD login endpoint |
| `EXCHANGE_ENV` | No | `O365USGovGCCHigh` | Exchange Online environment |
| `COMPLIANCE_URI` | No | `https://ps.compliance.protection.office365.us/powershell-liveid/` | IPPS connection URI |
| `AZURE_AUTH_ENDPOINT` | No | `https://login.microsoftonline.us/organizations` | Azure AD auth endpoint |
| `STORAGE_ROOT` | No | `./storage` | Root storage directory |
| `STATE_DIR` | No | `./storage/state` | Execution state directory |
| `EVIDENCE_DIR` | No | `./storage/evidence` | Evidence output directory |
| `LOG_LEVEL` | No | `info` | Logging level |
| `LOG_DIR` | No | `./storage/logs` | Log file directory |
| `DRY_RUN` | No | `false` | Force dry-run mode |
| `ENABLE_ROLLBACK` | No | `true` | Enable rollback on failure |
| `IDEMPOTENCY_CHECK` | No | `true` | Check desired state before applying |

In dry-run mode, `TENANT_ID`, `APP_ID`, `CERT_THUMBPRINT`, and `CERT_PATH` are **not required**. Config validation skips them.

---

## CLI Command Reference

```
stamper <command> [options]

Commands:
  translate <mission-plan>   Translate CES Mission Plan + Manifest → Executable Plan
  validate <plan>            Validate an Executable Plan (no execution)
  execute <plan>             Execute an Executable Plan against the tenant
  resume <plan-id>           Resume a failed execution (not yet implemented)
  report <plan-id>           Generate report from completed execution (not yet implemented)
  bootstrap                  Bootstrap tenant connection (app reg + cert + .env)

Global Options:
  -e, --env <path>           Path to .env file
  -V, --version              Output version number
  -h, --help                 Display help

translate Options:
  -m, --manifest <path>      Path to CES Tenant Manifest JSON (REQUIRED)
  -o, --output <path>        Output path for Executable Plan JSON
  --execute                  Immediately dry-run execute after translation

execute Options:
  -d, --dry-run              Dry-run mode (no tenant changes)

bootstrap Options:
  --tenant-id <id>           Azure AD tenant ID (REQUIRED)
  --display-name <name>      App registration display name (REQUIRED)
  --environment <env>        Target environment: commercial | gcchigh (REQUIRED)
  --cert-password <pw>       Certificate password (interactive prompt if omitted)
  --output <path>            .env output path
  --cert-store-path <path>   Certificate storage directory
```

---

## Execution Modes

The `execute` command supports two named execution modes controlled by `--mode`.

### Default Behavior

When no `--mode` flag is provided, the operator receives per-task confirmation prompts
before each command executes. This is the safe default — it ensures no task runs without
explicit operator acknowledgment.

---

### --mode manual (default)

Per-task confirmation loop. Before each task executes, the operator sees:

- Task ID and task type
- Applicable CMMC controls
- Engine and command that will run
- Target (configuration object or resource)

The operator answers Y to proceed or n to skip that task. A skipped task is recorded
in the execution state as `skipped` and reflected in the summary table.

**When to use:** First-time tenant configuration with a new client, any run where the
operator wants to review each change before it is applied.

**Command:**

```
node dist/cli/index.js execute plan.executable.json --mode manual
node dist/cli/index.js execute plan.executable.json          (same — manual is default)
```

**Sample terminal session (manual mode):**

```
Execute plan translated-synthetic-mission-plan in MANUAL mode? (Y/n) Y

  [>] Prechecks
       [>] PRE-001 Verify Graph API connectivity
       [ ] PRE-002 Verify Exchange Online connectivity
  [>] [T-L1-001] configuration (engine: powershell)

  -------------------------------------
  Task:    [T-L1-001] configuration
  Control: AC.1.001, AC.1.002
  Engine:  powershell
  Command: Set-MgBetaIdentityConditionalAccessPolicy
  Target:  ConditionalAccess/MFA-AllUsers
  -------------------------------------
  Proceed with this task? (Y/n) Y

  [ok] [T-L1-001] configuration (engine: powershell)
  [>] [T-L1-002] configuration (engine: powershell)
  ...

  --------------------------------------------------
    Execution Summary
  --------------------------------------------------
    PASS      10
    FAIL       0
    SKIP       2
    Total     12
    Status    completed
    Duration  4.21s
  --------------------------------------------------
```

---

### --mode auto

Fully sequential execution with no pauses between tasks. The live task tree renders
spinner states, check marks, and failure markers in real time. No operator input is
required after the pre-flight confirmation prompt.

**When to use:** Automated CI/CD pipelines, trusted operator environments where the plan
has already been reviewed and dry-run validated.

**Command:**

```
node dist/cli/index.js execute plan.executable.json --mode auto
```

**Sample terminal session (auto mode):**

```
Execute plan translated-synthetic-mission-plan in AUTO mode? (Y/n) Y

  [ok] Prechecks
       [ok] PRE-001 Verify Graph API connectivity
       [ok] PRE-002 Verify Exchange Online connectivity
  [ok] [T-L1-001] configuration (engine: powershell)
  [ok] [T-L1-002] configuration (engine: powershell)
  [ok] [T-L2-001] policy (engine: powershell)
  [ok] [T-L3-001] configuration (engine: ipps)
  [--] [T-L4-001] configuration (engine: manual_gate)  [skipped]
  [ok] [T-L5-001] monitoring (engine: powershell)
  [ok] Postchecks
       [ok] POST-001 Verify MFA enforcement active
       [--] POST-002 Manual review required             [skipped]

  --------------------------------------------------
    Execution Summary
  --------------------------------------------------
    PASS      10
    FAIL       0
    SKIP       2
    Total     12
    Status    completed
    Duration  3.87s
  --------------------------------------------------
```

---

### --dry-run --mode manual (recommended for operator training)

Combines full per-task confirmation prompts with simulated execution. The operator
sees every prompt and must respond Y or n, but no changes are made to the tenant.
Ideal for familiarizing a new operator with the task list before a live run.

```
node dist/cli/index.js execute plan.executable.json --dry-run --mode manual
```

All adapter calls return stub results. Evidence collection is skipped. Postchecks
return `[dry-run] skipped` rather than fabricated passes.

---

### --dry-run --mode auto

Walks the full execution path silently, no prompts, no tenant changes. Useful for
CI pre-flight validation.

```
node dist/cli/index.js execute plan.executable.json --dry-run --mode auto
```

---

### Pre-flight Confirmation

In both modes, a single pre-flight confirmation prompt appears before the task tree
begins. This gives the operator one last chance to abort before any state changes
are written.

```
Execute plan <plan-id> in MANUAL mode [DRY RUN]? (Y/n)
```

Answering n exits with code 0 and no execution state is written.

---

### Non-TTY / Piped Output

When stdout is not a TTY (for example, when piping to a file or running in a CI
container), listr2 automatically falls back to the VerboseRenderer. Each task
completion is written as a single line. Manual mode prompts require a TTY — running
with `--mode manual` and piped output will result in the prompt hanging unless stdin
is interactive.

```
node dist/cli/index.js execute plan.executable.json --mode auto > run.log
```

---

## Quick Start (Test with Synthetic Data)

```powershell
cd stamper

# 1. Install & build
npm install
npm run build

# 2. Translate synthetic fixtures
node dist/cli/index.js translate tests/fixtures/synthetic-mission-plan.json `
  -m tests/fixtures/synthetic-tenant-manifest.json `
  -o tests/fixtures/test-output.executable.json

# 3. Validate
node dist/cli/index.js validate tests/fixtures/test-output.executable.json

# 4. Dry-run execute
node dist/cli/index.js execute tests/fixtures/test-output.executable.json --dry-run
```

Expected: 12 tasks, 8 layers, 3 engines (powershell/ipps/manual_gate), all tasks pass dry-run.

---

## Quick Start (Live Tenant)

```powershell
cd stamper

# 1. Install & build
npm install
npm run build
npm link

# 2. Bootstrap tenant
stamper bootstrap --tenant-id <GUID> --display-name "CMMC-Automation" --environment gcchigh

# 3. Translate real plan
stamper translate real-mission-plan.json -m real-tenant-manifest.json -o plan.executable.json

# 4. Validate
stamper validate plan.executable.json

# 5. Dry-run first
stamper execute plan.executable.json --dry-run -e .env

# 6. Review dry-run report at storage/reports/<plan-id>.md

# 7. Live execute
stamper execute plan.executable.json -e .env

# 8. Review execution report at storage/reports/<plan-id>.md
```

---

## System Boundary: Stamper vs Partner Tool

This section defines the exact handoff contract between the partner's tenant onboarding tool
and the Stamper. These are two separate programs with a clean interface: a JSON file on disk.

### What the Partner's Tool Does

The partner's tool is responsible for tenant provisioning only:

1. Connects to the client's Azure AD tenant as Global Administrator (interactive or GDAP)
2. Creates the Entra ID app registration (BHD-CMMC-Automation)
3. Generates an RSA 2048-bit self-signed certificate and attaches the public key to the app
4. Grants 15 Microsoft Graph application permissions with admin consent
5. Creates the service principal (auto-created in-tenant, or explicit for cross-tenant)
6. Validates certificate-based auth (Connect-MgGraph + Get-MgOrganization)
7. Writes the tenant config file to ~/.stamper/tenants/<slug>.json
8. Writes the private key to C:\stamper-certs\<slug>.pfx on the BHD operator machine

The partner's tool does NOT: translate mission plans, validate executable plans, execute
compliance tasks, collect evidence, generate reports, or touch any M365 configuration.

### What the Stamper Does

The Stamper is responsible for compliance execution only:

1. Reads a tenant config from ~/.stamper/tenants/<slug>.json
2. Authenticates to the client tenant using the certificate in that config
3. Translates a CES Manual Mission Plan + Tenant Manifest into an Executable Plan
4. Validates the Executable Plan structure
5. Executes the plan: prechecks -> task graph -> postchecks
6. Collects evidence artifacts for each completed task
7. Generates JSON + Markdown execution reports

The Stamper does NOT: create app registrations, manage Azure AD permissions, rotate
certificates, provision tenants, handle Global Administrator authentication, or perform any
action outside the scope of a loaded Executable Plan.

### The Handoff Point

```
~/.stamper/tenants/<slug>.json
C:\stamper-certs\<slug>.pfx
```

These two files are the complete interface. The partner's tool writes them; the Stamper reads
them. Nothing else is shared between the two systems.

### Tenant Config Schema (Consumed by Stamper)

See docs/TENANT_ONBOARDING_SPEC.md for the full JSON schema. Key fields:

| Section       | Contents                                              |
|---------------|-------------------------------------------------------|
| client        | name, slug (primary key), engagement_id               |
| tenant        | tenant_id, domain, environment (gcchigh/commercial)   |
| auth          | app_id, cert_thumbprint, cert_path (local .pfx path)  |
| endpoints     | graph, login, compliance_uri, azure_auth, exchange_env, arm |
| subscription  | subscription_id, resource_group, location (if Azure)  |
| onboarding    | bootstrapped_at, bootstrapped_by, cert_expires        |

### What Does NOT Belong in the Config File

- Certificate passwords (handled at runtime; never persisted in plaintext)
- Mission Plan or Tenant Manifest paths (per-engagement inputs, not per-tenant config)
- BHD engine version or source paths (Layer 1 BHD IP, not client data)
- Any executable code or scripts

### Multi-Tenant Operation

After the partner tool onboards multiple tenants, the operator selects a tenant by slug:

```powershell
# CLI (--tenant flag reads the JSON config automatically)
stamper execute plan.json --tenant vfs
stamper execute plan.json --tenant acme-corp
```

```
# GUI
# Select from the tenant dropdown — connection info auto-fills
```

The slug field is the primary key. It must be unique across all tenants and URL-safe
(lowercase, hyphens only, no spaces).
