# Stamper Directive — Session-Controlled BYOD Evidence Extension

## Intent

This directive extends the existing Stamper CA App Control evidence collection (`stamper-ca-app-control-evidence-prompt.md`) with the additional evidence types required when Planner declares the `session_controlled_byod` architecture. Under this architecture, personal (BYOD) endpoints access CUI via browser only, with enforcement provided entirely by the M365 service layer — no Intune, no MDM, no VDI.

Four mechanisms together constitute the enforcement stack. Each must be independently verified. A gap in any one degrades the architecture from "enforced" to "partially enforced," which affects control classifications downstream.

1. **CA App Control session policies** — block download, copy, print, upload from unmanaged sessions (covered by the existing prompt; summarized here for completeness)
2. **CA policies blocking non-browser clients on unmanaged devices** — prevent Outlook desktop, Teams desktop, and mobile Office apps from bypassing session controls
3. **DLP policies across M365 workloads** — catch CUI egress through any channel session controls don't cover
4. **Sensitivity labels with encryption** — protect any CUI that escapes the M365 service boundary regardless of transport

This prompt covers mechanisms 2, 3, and 4 in detail, and references mechanism 1. All four evidence bundles must land in the evidence file for the `session_controlled_byod` architecture to be verified.

## Controls this evidence supports

Primary:
- AC.L2-3.1.18 — Control connection of mobile devices (mobile client app blocking)
- AC.L2-3.1.19 — Encrypt CUI on mobile devices (via labels + session controls preventing persistence)
- SC.L2-3.13.16 — Protect CUI at rest (rests only in the tenant, not on endpoints)
- CM.L2-3.4.6 — Least functionality (endpoints restricted to browser-only)

Secondary (egress protection):
- AC.L1-3.1.22 — Control information on publicly accessible systems
- MP.L2-3.8.8, MP.L2-3.8.9 — Media controls, backup CUI protection
- SC.L2-3.13.8 — Cryptographic transmission protection

## GET — Mechanism 2: CA policies blocking non-browser clients on unmanaged devices

Session controls only protect browser sessions. If a user can connect Outlook desktop, Teams desktop, or OneDrive sync client from a personal unmanaged laptop, the session controls don't apply and files sync locally to an untrusted endpoint. The CA policy that prevents this must exist.

### Query

```
GET https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies
```

Filter for policies where:
- `state = enabled`
- `conditions.clientAppTypes` includes combinations indicating non-browser clients (`mobileAppsAndDesktopClients`, `exchangeActiveSync`)
- `grantControls.builtInControls` includes `compliantDevice` or `domainJoinedDevice` or `block`
- `conditions.applications.includeApplications` includes CUI-bearing apps (Office 365, SharePoint Online, Exchange Online, Teams)

### What adequate looks like

At least one enabled policy that:

1. Scopes to CUI users (not just admins)
2. Includes cloud apps SharePoint Online, Exchange Online, Teams (Office 365 suite app is acceptable)
3. Targets non-browser client app types — mobile apps and desktop clients, Exchange ActiveSync
4. Either blocks the session outright, or requires `compliantDevice` / `hybridAzureADJoinedDevice` (which an unmanaged personal device will fail, producing an effective block)
5. Has no exclusions that defeat the policy (excluded users/groups that include CUI users, excluded locations that cover home networks)

### Sign-in verification

Check sign-in logs for evidence that unmanaged-device attempts at non-browser access have been blocked:

```
GET https://graph.microsoft.com/v1.0/auditLogs/signIns?$filter=...
```

Filter for:
- `appId` = SPO, Exchange, or Teams client
- `clientAppUsed` != `browser`
- `conditionalAccessStatus = failure` OR `status.errorCode` indicating device compliance failure
- Last 30 days

A handful of these in the log indicates the block is working. Zero could mean no one tried, or could mean the block isn't attaching — follow up if zero.

### Failure modes

- **No such policy exists.** Users on personal laptops can configure Outlook desktop and sync all mail locally. CUI persists on the unmanaged endpoint. `enforcement_verified=false`.
- **Policy exists but scopes only to admins.** CUI users can use non-browser clients freely. Partial enforcement. `enforcement_verified=false` unless a parallel policy covers CUI users.
- **Policy exists and blocks, but mobile Office apps are excluded.** Someone added Outlook mobile, Teams mobile to the exclusion list. Common mistake. `enforcement_verified=false`.
- **Policy exists, blocks desktop, but sign-in log shows successful Outlook desktop sessions from personal laptops.** The block isn't attaching. Escalate to tenant admin; `enforcement_verified=false`.

## GET — Mechanism 3: DLP policies across M365 workloads

DLP policies catch CUI content attempting to leave M365 through channels session controls don't govern (email body, Teams chat messages, link shares, guest access). For the session-controlled BYOD architecture, DLP is the egress backstop — it ensures that even if a user finds a creative way around session controls, CUI content itself is flagged and blocked or alerted.

### Query

```
GET https://graph.microsoft.com/v1.0/security/dlp/policies
```

(API path is Purview-flavored; current endpoint may be `/security/informationProtection/policies` depending on tenant version — confirm.)

For each DLP policy, capture:

- Policy name and scope (which workloads: Exchange, SPO, OneDrive, Teams, Endpoint DLP)
- Rule conditions (what triggers the rule — sensitive info types, keywords, sensitivity labels, custom patterns)
- Actions (block, require justification, notify, encrypt, log only)
- User scope (who the policy applies to)
- Exceptions
- State (enabled / test mode / disabled)

### What adequate looks like

For `session_controlled_byod` architecture, minimum adequate DLP coverage:

1. **Exchange Online** — policy catching CUI keywords, classification markings, or sensitivity labels on outbound email, with action of block or require-justification-and-notify
2. **SharePoint Online + OneDrive** — policy catching same CUI indicators on externally shared files, with action of block external sharing
3. **Teams** — policy catching CUI in chat messages and file shares, with action of block or notify
4. **Optional: Endpoint DLP** — N/A for pure browser-only BYOD, since endpoints are unmanaged. Skip if no Intune-enrolled endpoints exist.

Policies must be in enabled state, not test mode. Test mode logs but does not block.

### Failure modes

- **No DLP policies exist.** Egress backstop is missing. Session controls are the only barrier. If a user screenshots a document and pastes content into a personal email via a different tab (outside the protected session), there's no catch. `enforcement_verified=false` for the backstop layer.
- **Policies exist but all in test mode.** Visibility without enforcement. Recommend enabling; flag as a readiness gap.
- **Policies exist but scoped to only a subset of workloads.** Partial coverage. Document which workloads are covered and which are not; the ones that aren't need an alternative justification.
- **Policies rely only on keyword matching, not sensitivity labels or SIT (Sensitive Information Types).** Brittle — misses CUI that doesn't match the exact keywords. Not a failure, but note as a maturity gap.

## GET — Mechanism 4: Sensitivity label policies

Sensitivity labels classify CUI and optionally apply encryption, access restrictions, and watermarking. For `session_controlled_byod`, labels are the last line of defense: if CUI somehow reaches an endpoint, an encrypted labeled file cannot be opened without re-authenticating to the tenant, which unmanaged devices cannot do once the session ends.

### Query

```
GET https://graph.microsoft.com/v1.0/security/informationProtection/sensitivityLabels
```

And the label policies:

```
GET https://graph.microsoft.com/v1.0/security/informationProtection/sensitivityLabelPolicies
```

For each label, capture:

- Label name and display name
- Protection settings: encryption enabled, rights assignments, content expiration, offline access settings
- Marking settings: watermark, header, footer text
- Auto-labeling conditions (if any)
- Associated policies (which users/groups see the label)

For each policy, capture:

- Policy name
- Labels included in the policy
- Users/groups the policy applies to
- Default label (if any)
- Mandatory labeling setting

### What adequate looks like

Minimum adequate coverage for `session_controlled_byod`:

1. At least one label designated for CUI content
2. Label applies encryption with rights restricted to internal users and authorized external parties
3. Label is available to CUI users via a published label policy
4. Auto-labeling or mandatory labeling is configured to reduce reliance on user discipline

Ideal coverage adds:
- Auto-labeling based on sensitive information types matching CUI markings (e.g., "CUI//SP-...", ITAR markings, CTI classification text)
- Watermarks on labeled content displaying user identity
- Co-authoring support enabled (users can work with labeled files in the browser session without friction)

### Failure modes

- **No CUI label exists.** No classification, no encryption. CUI is indistinguishable from non-sensitive content. `enforcement_verified=false` for the labeling layer.
- **Label exists but encryption is not enabled.** The label is cosmetic — metadata only. Not a final-line-of-defense. Document as a gap.
- **Label exists and encrypts, but no auto-labeling.** Relies on users to manually label every CUI file. Common failure mode. Not a complete block but a meaningful gap.
- **Label exists but is not in any published policy.** Users cannot apply it. Equivalent to not existing.

## SET — What to configure

Same rule as the parent prompt: **do not auto-configure.** If any of mechanisms 2, 3, or 4 are missing or inadequate, record the gap in the evidence file and flag for human review. Configuring DLP policies, sensitivity labels, or CA policies blocking non-browser clients requires deliberate architectural decisions that cross team boundaries (Security, Compliance, Identity, IT Operations). Stamper reports findings; humans deploy fixes.

Record in the evidence file: "Configuration of this control requires cross-team approval and deliberate rollout. Not auto-configured by Stamper."

## EVIDENCE — What to capture

Extend the existing CA App Control evidence bundle with three additional sections.

### Section for Mechanism 2 — Non-browser client block

- CA policy JSON export(s) for the policy blocking non-browser clients
- Scope summary: which users, which apps, which client app types, which device conditions
- Sign-in log sample showing at least 3 blocked non-browser client attempts in the last 30 days (or a note explaining zero samples if applicable)

### Section for Mechanism 3 — DLP coverage

- List of all enabled DLP policies with scope, triggers, and actions
- Cross-reference table: CUI workload → which DLP policy covers it → action
- Sample DLP policy match events from the last 30 days (at least 3, or noted-if-zero)
- Gap report: any CUI workload without DLP coverage

### Section for Mechanism 4 — Sensitivity labels

- List of all sensitivity labels with their protection settings
- List of all label policies with their user scope
- Auto-labeling configuration summary (enabled or not, which SITs)
- Sample labeled document count over the last 30 days (shows labels are actually being applied)
- Gap report: if manual-only labeling, note the reliance on user discipline

### Narrative stub

One paragraph covering the combined enforcement architecture:

> "Session-controlled BYOD enforcement is provided by four mechanisms: (1) CA App Control session policies `[policy names]` block download/copy/print/upload for browser sessions to `[app list]`; (2) CA policy `[policy name]` blocks Outlook desktop, Teams desktop, and mobile Office apps on unmanaged devices for the CUI user population; (3) DLP policies `[policy names]` provide egress backstop across Exchange, SPO, OneDrive, and Teams; (4) sensitivity label `[label name]` applies encryption and access restrictions to CUI content with auto-labeling based on `[SIT list]`. Enforcement was verified active as of `[date]` with sign-in log and DLP match samples demonstrating runtime attachment of each policy."

### Metadata fields

Set the standard evidence-file metadata, with one addition for this architecture:

- `control_id`: applies to multiple controls (AC.L2-3.1.18, AC.L2-3.1.19, SC.L2-3.13.16, CM.L2-3.4.6) — emit one evidence file per control, but all four reference the same underlying mechanisms
- `directive`: whatever Planner emitted (typically `validate` or `document-prohibition`)
- `enforcement_verified`: `true` only if all four mechanisms pass their respective adequacy checks; `false` otherwise
- `readiness`: `met` if `enforcement_verified=true` and all evidence sections captured; `not-met` otherwise
- `evidence_artifacts`: list of artifact paths for all four mechanism sections
- `narrative_stub`: the paragraph above
- `architecture_declared`: `session_controlled_byod` (new field — signals to EO that this is the architecture being verified, and the narrative template should match)
- `mechanism_status`: an object with per-mechanism boolean status:
  ```json
  {
    "ca_app_control": true|false,
    "non_browser_client_block": true|false,
    "dlp_coverage": true|false,
    "sensitivity_labels": true|false
  }
  ```
- `reasoning_trace`: propagate from Planner; append per-mechanism adequacy check results

## Aggregate verdict logic

Per-control `enforcement_verified` depends on which mechanisms are relevant:

| Control | Required mechanisms |
|---|---|
| AC.L2-3.1.18, AC.L2-3.1.19 | 1 (session controls) AND 2 (non-browser client block) |
| SC.L2-3.13.16 | 1 AND 4 (labels provide at-rest protection if CUI escapes) |
| CM.L2-3.4.6 | 1 AND 2 |
| Backstop controls (AC.L1-3.1.22, MP.L2-3.8.8, 3.8.9) | 3 (DLP coverage) |

If the required mechanisms for a specific control all pass, that control's `enforcement_verified=true`. If any required mechanism fails, that control's `enforcement_verified=false` and `readiness=not-met` — even if other controls pass.

Do not blanket-verify based on "most mechanisms working." Each control gets its own verdict based on the mechanisms it actually depends on.

## Out of scope for this evidence operation

- **Do not** configure, modify, or deploy any CA, DLP, or label policies. Evidence only.
- **Do not** infer adequacy from artifact presence alone. A policy exists doesn't mean it's scoped correctly or actually enforcing. Every mechanism requires a scope check and a runtime verification (sign-in sample, DLP match sample, label application sample).
- **Do not** omit mechanism 4 (sensitivity labels) on the grounds that session controls prevent persistence. Labels are defense in depth for cases where session controls fail (e.g., an admin error disabling the policy). Their presence affects multiple control determinations.
- **Do not** accept "test mode" as equivalent to enabled for DLP policies. Test mode logs but does not enforce. Mark as inadequate and flag for enablement.

## Acceptance criteria

- Evidence bundle contains all four mechanism sections.
- Each mechanism has both configuration export and runtime sample evidence (or explicit note if sample is unavailable).
- `mechanism_status` object is populated with explicit true/false per mechanism.
- Per-control `enforcement_verified` values are computed using the aggregate verdict logic, not set uniformly.
- Narrative stub references specific policy names, not generic language.
- If any mechanism fails adequacy, the evidence file captures the gap and flags for human review rather than emitting a clean pass.
