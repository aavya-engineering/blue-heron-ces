# Enclave Stamper — Technical Overview

**Date:** 2026-03-08
**Author:** Blue Heron Defense / Claude Opus 4.6
**Classification:** CUI — Internal Engineering Reference

---

## What This Is

Enclave Stamper is a CMMC Level 2 compliance orchestration engine that automates the configuration and evidence collection for Microsoft 365 GCC High and Azure Government tenants. It consumes structured Mission Plans from the CES (Compliance Engineering System) platform, translates them into executable task graphs, and runs deterministic PowerShell commands against sovereign cloud endpoints — collecting cryptographically hashed evidence at every step.

The engine was built for Valor Forge, LLC (operating as ValorForge Solutions) to support their CMMC 2.0 Level 2 assessment against NIST SP 800-171 Rev 2's 110 controls across 14 families.

---

## Architecture

### Three-Layer IP Separation

| Layer | Owner | Contents |
|-------|-------|----------|
| **BHD Engine** | Blue Heron Defense | Translation pipeline, execution engine, adapters, evidence collection, state management |
| **Client Config** | ValorForge Solutions | Tenant IDs, certificates, subscription details, resource names — stored at `~/.stamper/tenants/<slug>.json` |
| **Evidence Outputs** | Assessment Record | SHA-256 hashed artifacts, execution reports, compliance snapshots — stored in WORM-locked Azure Blob Storage |

### Data Flow

```
CES Mission Plan (JSON) + Tenant Manifest (JSON)
  → PlanTranslator.translate()
    → LayerClassifier assigns execution layers (L0-L8)
    → CommandRegistry resolves control IDs → deterministic commands
    → Variable resolution: manifest (translate-time) + captures (runtime)
  → ExecutablePlan (execution_graph: ExeTask[])
    → StamperEngine.execute()
      → SessionManager establishes PowerShell sessions (cert-based auth)
      → TaskRunner dispatches to engine adapters
      → PowerShellAdapter executes sub-commands with capture chaining
      → EvidenceCollector hashes and stores artifacts
    → ExecutionReport (JSON + Markdown)
```

### Execution Layers

Tasks are classified into 9 ordered layers. Cross-layer dependencies are injected automatically — a Conditional Access policy (L3) cannot target a security group that hasn't been created yet (L1).

| Layer | Name | Examples |
|-------|------|----------|
| L0 | Foundation | Tenant settings, org-wide policies, compliance docs |
| L1 | Identity Objects | Users, security groups, service principals |
| L2 | Role Assignments | PIM roles, RBAC, admin unit scoping |
| L3 | Identity Policies | Conditional Access, MFA, auth methods |
| L4 | Device Policies | Intune enrollment, compliance profiles, BitLocker |
| L5 | Data Protection | Sensitivity labels, DLP, retention |
| L6 | Infrastructure | VNets, NSGs, Key Vault, Firewall, Bastion |
| L7 | Monitoring | Sentinel, audit logging, alert rules |
| L8 | Evidence | Evidence collection, postchecks |

---

## Command Registries

### M365 Registry — 119 entries

Covers M365 GCC High configuration across 6 PowerShell session types:

| Session | Module | Connect Command | GCC High Key Param |
|---------|--------|-----------------|-------------------|
| `graph` | Microsoft.Graph | `Connect-MgGraph` | `-Environment USGov` |
| `exchange` | ExchangeOnlineManagement | `Connect-ExchangeOnline` | `-ExchangeEnvironmentName O365USGovGCCHigh` |
| `purview` | ExchangeOnlineManagement | `Connect-IPPSSession` | `-ConnectionUri https://ps.compliance.protection.office365.us/powershell-liveid/` |
| `azure` | Az.Accounts | `Connect-AzAccount` | `-Environment AzureUSGovernment` |
| `sharepoint` | PnP.PowerShell | `Connect-PnPOnline` | `-AzureEnvironment USGovernmentHigh` |
| `teams` | MicrosoftTeams | `Connect-MicrosoftTeams` | (env auto-resolved from TenantId) |

All 119 entries were audited against official Microsoft documentation on 2026-03-01. 24 corrections were applied. Full audit reports are at `docs/context/AUDIT_*.md`.

Key corrections included:
- `New-MgGroupMember` → `New-MgGroupMemberByRef` (cmdlet doesn't exist)
- `Set-AzSentinel` → `New-AzSentinelOnboardingState` (cmdlet doesn't exist)
- Attack Simulation API marked `manual_only: true` (not available in GCC High)
- Multiple beta-only Graph endpoints corrected from `/v1.0/` to `/beta/`
- DLP `-Mode Enforce` → `-Mode Enable` (invalid parameter value)

### Infra Registry — 53 entries

Covers Azure Government infrastructure provisioning for CMMC L2 enclave deployment. All entries use the `az` engine (routes to `Connect-AzAccount` session). Added after Day-1 EO deployment revealed the full provisioning sequence.

Sequence groups:

| Seq | Layer | Purpose | Entries |
|-----|-------|---------|---------|
| 0 | L0 | Provider registration, Set-AzContext, resource group, CMMC policy initiative, Defender plans | 6 |
| 1-2 | L6 | Log Analytics Workspace, storage account, CMK 4-step (MI → RBAC → encryption) | 7 |
| 3 | L6 | Key Vault (purge-protected, RBAC auth), CMK key creation (RSA-HSM 4096) | 3 |
| 4-6 | L6 | VNet, subnets, NSGs, Network Watcher, flow logs | 12 |
| 7 | L6 | Firewall, Bastion, public IPs | 4 |
| 8 | L6 | Private endpoints (Key Vault, Storage) | 2 |
| 9-10 | L7 | Sentinel onboarding (ARM REST), data connectors, alert rules | 8 |
| 11-12 | L6 | Automation Account (MI via REST PATCH), RBAC assignments | 3 |
| 13-14 | L6/L7 | VM, disk encryption, diagnostics, subscription activity log | 8 |

---

## GCC High — What We Learned the Hard Way

The Day-1 deployment of EO infrastructure against `vfsgov.us` (Azure Government, `usgovvirginia`) produced 16 documented issues. These were factored into the registry as hard constraints. Key findings:

### Sovereign Endpoint Behavior

- **Region:** Only `usgovvirginia` supports Sentinel. `usgovtexas` is DR only. We deployed there first and had to rebuild everything.
- **Sentinel CLI is broken:** `az sentinel` extension v0.1.2 is too old — `onboard` command doesn't exist. Must use `az rest --method PUT` against ARM API directly.
- **Graph API scope insufficient for CA policies:** `az rest` against Graph policy endpoints returns `AccessDenied` — the Azure CLI acquires ARM tokens, not Graph tokens. Security Defaults and Conditional Access must be done via Entra portal or `Connect-MgGraph` with explicit scopes.
- **`Microsoft.OperationsManagement` provider:** Not in the standard list, but required for Sentinel. Must register explicitly.

### Deprecated/Changed Azure APIs

- **`--enable-soft-delete` removed from `az keyvault create`:** Soft delete is now permanent and always on. Flag throws on newer CLI versions.
- **`KeyVaults` is not a valid Defender plan name:** Consolidated into `CloudPosture`.
- **Retention policy in diagnostic settings rejected:** `retentionPolicy` is removed from the API. Retention is LAW-level only.
- **`--assign-identity` not in automation extension:** Use `az rest PATCH` to assign system MI after account creation.
- **Subscription diagnostic settings need different command:** `az monitor diagnostic-settings create` fails for subscription scope. Use `az monitor diagnostic-settings subscription create`.

### PowerShell-Specific Gotchas

- **All commands must be PowerShell, not Bash.** GCC High operators run PowerShell on Windows. Every `for x in ...; do` loop, `$()` subshell, and `| tee` pipe fails.
- **JSON arguments must use single quotes:** `'{"key":"value"}'` not `"{\"key\":\"value\"}"`. PowerShell processes backslash escapes before passing to `az`.
- **`foreach` is a statement, not a cmdlet.** Cannot pipe to `Tee-Object`. Use `ForEach-Object` for pipeline operations.
- **Silent failures in loops:** `$ErrorActionPreference = "Stop"` must be set. Without it, failed `az` commands return exit codes but don't terminate the script — `Write-Host` runs regardless, making failures look like successes.

### Sequencing Constraints

- **CMK requires 4-step sequence:** Storage account → assign system MI → grant KV RBAC to MI → update encryption. Cannot set CMK at creation time (chicken-and-egg: MI doesn't exist yet).
- **Key Vault private access deadlock:** KV deployed with public access disabled → can't create keys from outside VNet → PE not deployed yet → can't reach KV. Solution: temp-enable public access, create key, re-disable.
- **Storage containers on private accounts:** Data plane calls are blocked by network rules even with `--account-key`. Must add temp IP rule or deploy PE first. Container creation can appear to succeed while silently failing.
- **WORM locks are irreversible.** Once locked, immutability policies cannot be modified or removed. Registry entries must guard against re-execution.

---

## Current Tenant State — vfsgov.us

**Phase 0 (Infrastructure): COMPLETE**

30 steps executed manually on 2026-03-08. All resources deployed in `usgovvirginia` under `rg-eo-prod`. Full state documented at `docs/EO_Deployment_State.md`.

| Resource | Name | Status |
|----------|------|--------|
| Resource Group | `rg-eo-prod` | Active, CanNotDelete locked |
| Log Analytics Workspace | `vfsgov-law-prod` | Active, 90-day retention, Sentinel enabled |
| Key Vault | `vfsgov-kv-prod` | Premium HSM, purge-protected, private access only |
| Storage Account | `vfsgoevops01` | ZRS, CMK encrypted, 3 WORM containers (7yr) |
| Virtual Network | `vfsgov-vnet-eo` | 10.0.0.0/16, PE subnet with NSG |
| Private Endpoints | KV (10.0.0.4), Storage (10.0.0.5) | Approved, DNS linked |
| Automation Account | `vfsgov-automation-eo` | System MI, 4 RBAC roles |
| Sentinel | on `vfsgov-law-prod` | CMMC 2.0 Content Hub v3.1.1 |
| Defender for Cloud | 4 plans | Standard tier |
| CMMC L2 Policy | subscription scope | Assigned, enforced |

**Remaining before M365 execution:**

| Item | Type | Status |
|------|------|--------|
| CA-01: Require MFA | Portal (manual_gate) | Pending |
| CA-02: Block legacy auth | Portal (manual_gate) | Pending |
| 15 Graph API permissions for EO SP | Portal/PowerShell | Pending |
| PFX cert conversion + thumbprint | Operator action | Pending |
| `stamper tenants validate vfsgov` | CLI validation | Blocked by above |

---

## Tenant Configuration Contract

Stamper reads tenant-specific values from `~/.stamper/tenants/<slug>.json`. The vfsgov tenant config contains:

```
Tenant ID:       bbe08772-8fde-4e55-961a-8a43779e7d58
Subscription ID: 668a730f-12a1-4c80-9734-89c621e98115
Resource Group:  rg-eo-prod
Region:          usgovvirginia
App ID (EO SP):  830b3c2a-4cb3-415a-a88d-ad7b203bdeb4
LAW Name:        vfsgov-law-prod
KV Name:         vfsgov-kv-prod
Storage:         vfsgoevops01
```

These values flow through `PlanTranslator` as resolved variables — `{subscriptionId}`, `{resourceGroup}`, `{location}`, `{lawWorkspaceName}`, etc. — and are substituted into registry commands at translation time.

---

## Engine Architecture

### Session Management

`SessionManager` spawns fresh `powershell.exe` processes for each command execution. Each process runs `Connect-*` (cert-based auth) followed by the registry command. The `ENGINE_SESSION_MAP` routes engine tokens to session types:

```
mgraph     → graph     → Connect-MgGraph
powershell → graph     → Connect-MgGraph
exchange   → exchange  → Connect-ExchangeOnline
ipps       → purview   → Connect-IPPSSession
az         → azure     → Connect-AzAccount
cli        → azure     → Connect-AzAccount
spo        → sharepoint → Connect-PnPOnline
teams      → teams     → Connect-MicrosoftTeams
```

All connections use certificate-based app-only authentication with no interactive prompts.

### Variable Resolution (Two-Phase)

1. **Translate-time (manifest variables):** `ManifestReader.generateVariables()` extracts tenant identity, config intent values, and flattened desired_config keys. `PlanTranslator` merges subscription and resource variables from `ClientConfig`.
2. **Runtime (capture chaining):** `PowerShellAdapter` executes sub-commands in sequence. A command's `captures` spec extracts values from stdout (e.g., `lawWorkspaceId` from `New-AzOperationalInsightsWorkspace` output) and injects them into subsequent commands' variable maps.

### Execution Modes

- **Dry-run:** Prints every command with resolved variables. Makes no API calls. Used for operator review before live execution.
- **Manual mode:** Step-by-step operator approval via TUI (listr2) or GUI (Express + SSE). Each task requires explicit confirmation.
- **Auto mode:** Executes all tasks sequentially without prompts. Used for unattended runs after dry-run review.

---

## File Map

```
stamper/
├── src/
│   ├── cli/index.ts              — Commander CLI: execute, translate, validate, bootstrap, gui, tenants
│   ├── config/
│   │   ├── ClientConfig.ts        — Tenant config loader (.env + ~/.stamper/tenants/*.json)
│   │   └── StamperConfig.ts       — Engine configuration
│   ├── core/
│   │   ├── SessionManager.ts      — 6 PS session types, cert-based auth, ENGINE_SESSION_MAP
│   │   ├── StamperEngine.ts       — Plan loading, execution orchestration
│   │   ├── TaskRunner.ts          — Task dispatch to engine adapters
│   │   └── DependencyResolver.ts  — Topological sort of execution graph
│   ├── translators/
│   │   ├── PlanTranslator.ts      — Mission Plan → Executable Plan translation
│   │   ├── ManifestReader.ts      — Tenant Manifest parsing, variable generation
│   │   └── LayerClassifier.ts     — Service → execution layer classification (L0-L8)
│   ├── registry/
│   │   ├── CommandRegistry.ts     — Registry loader, control ID → command lookup
│   │   ├── cmmc-l2-commands.registry.json    — 119 M365 entries (audited 2026-03-01)
│   │   └── infra-cmmc-l2-commands.registry.json — 53 Azure infra entries (corrected 2026-03-08)
│   ├── adapters/                  — PowerShell, IPPS, API, CLI, Manual Gate, Bicep, Terraform
│   ├── evidence/                  — SHA-256 hashing, evidence store, manifest builder
│   ├── state/                     — Execution state persistence, idempotency guard, drift exceptions
│   ├── reporting/                 — JSON + Markdown execution reports
│   ├── server/                    — Express GUI with SSE real-time updates
│   └── tui/                       — Terminal UI (listr2)
├── docs/
│   ├── EO_Deployment_State.md     — Full vfsgov Day-1 deployment record
│   ├── EO_Deployment_Issues_And_Lessons.md — 16 issues from live GCC High deployment
│   └── context/                   — Audit reports, research summaries, critique artifacts
├── tests/fixtures/                — Synthetic plans, manifests, infra fixture
└── scripts/New-TenantBootstrap.ps1 — App registration + certificate bootstrap
```

---

## What's Next

1. **Complete manual gates** — CA policies, Graph permissions, cert conversion
2. **Run `stamper tenants validate vfsgov`** — confirm auth works end-to-end
3. **M365 dry-run** — `stamper translate <plan> -m <manifest> --tenant vfsgov` then `stamper execute <output> --dry-run`
4. **Operator review** — inspect every resolved command in dry-run output
5. **Live M365 execution** — configure the tenant for CMMC L2 compliance
6. **Evidence packaging** — collect hashed artifacts for assessor review
