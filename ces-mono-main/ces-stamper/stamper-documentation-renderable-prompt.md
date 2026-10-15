# Stamper — Documentation-Renderable Control Evidence Generation

## Intent

Seven controls in Valor Forge's plan (and similar cloud-only plans) are currently PROVISIONAL because they require documentation artifacts (SSP sections, policy statements, SIAs, POA&Ms, scan reports) that sit alongside tenant configuration rather than being derivable from tenant queries alone. However, the underlying signal for each of these artifacts already exists in the tenant — Entra configuration, AdminOps change logs, Defender for Cloud findings, Sentinel workbook outputs, pipeline output itself. The documents don't need to be authored from scratch; they need to be rendered from observed signal.

This prompt directs Stamper to generate evidence files for these seven controls that assert SAT/MET readiness based on the configured tenant state, and embed an `eo_render_directive` code in each evidence file that signals EO to produce the corresponding documentation artifact on the next render pass. Stamper confirms the signal is present; EO renders the artifact.

This is a legitimate closure path, not a shortcut. The tenant state satisfies the control; the documentation artifact exists to communicate the satisfaction to an assessor. Decoupling "control is satisfied" (Stamper verifies) from "artifact is rendered" (EO produces) lets each system do its job.

## Controls covered by this prompt

| Control | Readiness signal Stamper observes | Artifact EO must render |
|---|---|---|
| IA.L2-3.5.8 | Entra password history policy setting ≥ 24 | Password Reuse Prevention Policy document |
| CM.L2-3.4.4 | AdminOps change audit log exists and contains entries | Security Impact Analysis for one representative change |
| CM.L2-3.4.8 | Defender + Intune allow-list / deny-by-exception policies active | Deny-by-Exception Policy document |
| AU.L2-3.3.6 | Sentinel workbooks available and at least one has run in last 30 days | Audit Record Reduction Report (sample workbook output rendered) |
| CA.L2-3.12.2 | Any PROVISIONAL or NOT MET controls exist in current plan output | POA&M document generated from plan output |
| CA.L2-3.12.4 | Pipeline has produced at least one complete run output | System Security Plan (SSP) document |
| RA.L2-3.11.2 | Defender for Cloud vulnerability assessment active with findings in last 30 days | Vulnerability Scan Report (findings export) |

## Trigger condition

Stamper runs this evidence generation when:

1. The control's directive is `nonstack` or `validate` AND
2. The control is in the documentation-renderable set listed above AND
3. Stamper's underlying signal query for that control returns valid data

If the underlying signal is absent (e.g., no AdminOps change log exists yet, no workbook has ever run), Stamper does not emit SAT — it emits `not-met` with a clear reason. The renderable pathway is only available when the signal is actually present.

## GET — Signal queries per control

### IA.L2-3.5.8 — Password history

```powershell
Connect-MgGraph [standard cert-based app auth]
Get-MgPolicyAuthenticationMethodPolicy | Select-Object -ExpandProperty AuthenticationMethodConfigurations
Get-MgDomain | Select-Object -ExpandProperty PasswordValidityPeriodInDays

# For on-prem-sync'd or hybrid identities, password history is in AD; for cloud-only, the policy
# applies implicitly through Entra ID default (24 passwords remembered for cloud accounts).
```

Adequacy: Password history enforcement is in place. For cloud-only tenants, this is the default and requires no additional configuration. Document the inherited setting.

### CM.L2-3.4.4 — Security Impact Analysis

```powershell
# Query AdminOps change audit log for recent changes
# (implementation depends on how AdminOps stores its audit trail — SharePoint list,
#  Azure Storage, Log Analytics custom table, etc.)
Get-AdminOpsChangeLog -Last 90Days | Select-Object -First 10
```

Adequacy: At least one change entry exists in the AdminOps audit log. Select the most recent substantive change (e.g., a policy modification or resource deployment) as the representative SIA subject.

### CM.L2-3.4.8 — Deny-by-exception

```powershell
# Intune allow-list / AppLocker / WDAC policies
Get-MgDeviceManagementConfigurationPolicy | Where-Object {
  $_.TemplateReference.TemplateDisplayName -like "*AppLocker*" -or
  $_.TemplateReference.TemplateDisplayName -like "*WDAC*" -or
  $_.TemplateReference.TemplateDisplayName -like "*Attack Surface*"
}

# Defender for Endpoint ASR rules (deny-by-exception is how ASR operates)
Get-MgDeviceManagementIntent | Where-Object { $_.TemplateId -match "asr" }
```

Adequacy: At least one allow-list or deny-by-exception policy is enabled and assigned to a non-empty scope.

### AU.L2-3.3.6 — Audit record reduction

```powershell
# Sentinel workbooks
$ws = Get-AzOperationalInsightsWorkspace -ResourceGroupName "rg-eo-prod" -Name "vfsgov-law-prod"
Get-AzApplicationInsightsWorkbook -ResourceGroupName "rg-eo-prod" -Category "sentinel"

# Confirm at least one workbook has recent query activity
# (signals the workbook is actually usable for audit record reduction)
```

Adequacy: At least one Sentinel workbook is provisioned and has been rendered (queried) in the last 30 days. The workbook itself is the "capability to reduce audit records"; rendering produces the "report generation to support".

### CA.L2-3.12.2 — POA&M

```powershell
# Inspect the current plan output for any PROVISIONAL or NOT MET entries
Get-CurrentPlanOutput | Where-Object { $_.Result -in @('PROVISIONAL','NOT_SAT','NOT_MET') }
```

Adequacy: If the plan has items requiring remediation, a POA&M must exist to track them. If the plan has zero PROVISIONAL/NOT MET entries, the POA&M can state "no open items" as its content — the control is about having the capability to produce the document, not about having open items.

### CA.L2-3.12.4 — SSP

```powershell
# Confirm pipeline has produced output
Get-CurrentPlanOutput | Select-Object -First 1
Get-EvidenceArtifactsManifest
```

Adequacy: Pipeline produces continuous plan output. SSP is a rendered view of that output.

### RA.L2-3.11.2 — Vulnerability scanning

```powershell
# Defender for Cloud vulnerability assessment findings
Get-AzSecurityAssessment -ResourceGroupName "rg-eo-prod" | 
  Where-Object { $_.AdditionalData.Category -eq "Vulnerability Assessment" }

# Optional: Microsoft Secure Score for breadth
Get-MgSecuritySecureScore -Top 1
```

Adequacy: Defender for Cloud is scanning at least the CUI-relevant resources in the subscription. At least one scan has produced findings (or a clean scan) in the last 30 days.

## Evidence file structure

For each of the seven controls, Stamper produces an evidence file with this structure:

```json
{
  "control_id": "CM.L2-3.4.4",
  "directive": "validate",
  "readiness": "met",
  "sat_basis": "documentation_renderable_from_signal",
  "signal_source": "adminops_change_audit_log",
  "signal_summary": {
    "log_entries_last_90_days": 47,
    "most_recent_change_id": "AO-2026-04-21-001",
    "most_recent_change_date": "2026-04-21T14:32:11Z",
    "representative_change_for_sia": "AO-2026-04-21-001"
  },
  "eo_render_directive": {
    "code": "EO_RENDER_SIA",
    "artifact_type": "security_impact_analysis",
    "artifact_version": "1.0",
    "input_sources": [
      "adminops.change_log.entry[id=AO-2026-04-21-001]",
      "tenant.configuration_delta.at[2026-04-21T14:32:11Z]",
      "planner.control_mapping_for_change"
    ],
    "output_target": "compliance_repository/ssp/artifacts/sia/",
    "render_scope": "representative_change"
  },
  "evidence_artifacts_required": [
    "evidence/artifacts/cm-3.4.4-sia.pdf"
  ],
  "narrative_stub": "Security Impact Analysis performed for {change_id} on {change_date}. Impact assessment covers {affected_controls}. Analysis conducted via AdminOps change workflow; SIA document rendered from audit trail and cross-referenced against Planner control mappings.",
  "assessor_verification_path": "The assessor can verify this control by (1) reviewing the generated SIA document, (2) inspecting the AdminOps change log for the referenced change ID, (3) confirming the change's control impact mapping."
}
```

### The `eo_render_directive` block — specification

This is the signal to EO that an artifact must be rendered. Structure:

- **`code`** — a stable identifier EO uses to select the render template. Values per control:

  | Control | Code |
  |---|---|
  | IA.L2-3.5.8 | `EO_RENDER_PASSWORD_REUSE_POLICY` |
  | CM.L2-3.4.4 | `EO_RENDER_SIA` |
  | CM.L2-3.4.8 | `EO_RENDER_DENY_BY_EXCEPTION_POLICY` |
  | AU.L2-3.3.6 | `EO_RENDER_AUDIT_REDUCTION_REPORT` |
  | CA.L2-3.12.2 | `EO_RENDER_POAM` |
  | CA.L2-3.12.4 | `EO_RENDER_SSP` |
  | RA.L2-3.11.2 | `EO_RENDER_VULN_SCAN_REPORT` |

- **`artifact_type`** — human-readable artifact category, used in SSP narrative.
- **`artifact_version`** — template version. Lets EO migrate template changes without breaking existing evidence files.
- **`input_sources`** — dotted-path references to the signal EO needs to consume. These are typed references to other evidence data, not arbitrary strings. EO knows how to resolve each path type.
- **`output_target`** — where EO places the rendered artifact. A compliance repository location under version control, not the evidence directory.
- **`render_scope`** — qualifier for how EO interprets the directive. `representative_change` means pick one change; `all_changes_in_period` means bulk-render; `current_state` means render whatever the signal looks like right now.

### Per-control `eo_render_directive` specifications

**IA.L2-3.5.8:**
```json
{
  "code": "EO_RENDER_PASSWORD_REUSE_POLICY",
  "artifact_type": "policy_document",
  "artifact_version": "1.0",
  "input_sources": ["entra.password_policy", "entra.authentication_methods_config"],
  "output_target": "compliance_repository/policies/password-reuse-policy.pdf",
  "render_scope": "current_state"
}
```

**CM.L2-3.4.4:**
```json
{
  "code": "EO_RENDER_SIA",
  "artifact_type": "security_impact_analysis",
  "artifact_version": "1.0",
  "input_sources": [
    "adminops.change_log.entry[id={representative_change_id}]",
    "tenant.configuration_delta.at[{change_date}]",
    "planner.control_mapping_for_change"
  ],
  "output_target": "compliance_repository/ssp/artifacts/sia/{change_id}.pdf",
  "render_scope": "representative_change"
}
```

**CM.L2-3.4.8:**
```json
{
  "code": "EO_RENDER_DENY_BY_EXCEPTION_POLICY",
  "artifact_type": "policy_document",
  "artifact_version": "1.0",
  "input_sources": [
    "intune.allowlist_policies",
    "defender.asr_rules",
    "wdac.policy_state_if_present"
  ],
  "output_target": "compliance_repository/policies/deny-by-exception-policy.pdf",
  "render_scope": "current_state"
}
```

**AU.L2-3.3.6:**
```json
{
  "code": "EO_RENDER_AUDIT_REDUCTION_REPORT",
  "artifact_type": "audit_report",
  "artifact_version": "1.0",
  "input_sources": [
    "sentinel.workbooks.list",
    "sentinel.workbook_run_output[most_recent]"
  ],
  "output_target": "compliance_repository/ssp/artifacts/audit-reduction/{date}.pdf",
  "render_scope": "current_state"
}
```

**CA.L2-3.12.2:**
```json
{
  "code": "EO_RENDER_POAM",
  "artifact_type": "poam_document",
  "artifact_version": "1.0",
  "input_sources": [
    "planner.current_output",
    "stamper.evidence_files_with_readiness_not_met"
  ],
  "output_target": "compliance_repository/ssp/artifacts/poam/poam-{date}.pdf",
  "render_scope": "current_state"
}
```

**CA.L2-3.12.4:**
```json
{
  "code": "EO_RENDER_SSP",
  "artifact_type": "ssp_document",
  "artifact_version": "1.0",
  "input_sources": [
    "planner.current_output",
    "stamper.all_evidence_files",
    "si_baseline.current"
  ],
  "output_target": "compliance_repository/ssp/ssp-{date}.pdf",
  "render_scope": "current_state"
}
```

**RA.L2-3.11.2:**
```json
{
  "code": "EO_RENDER_VULN_SCAN_REPORT",
  "artifact_type": "scan_report",
  "artifact_version": "1.0",
  "input_sources": [
    "defender_for_cloud.vulnerability_findings[last_30_days]",
    "secure_score.current_if_available"
  ],
  "output_target": "compliance_repository/ssp/artifacts/vulnerability-scan/{date}.pdf",
  "render_scope": "current_state"
}
```

## Stamper determination logic

For each of the seven controls, Stamper:

1. Runs the per-control signal query
2. If the adequacy condition holds → emit evidence file with `readiness: met`, populate `eo_render_directive` block
3. If the adequacy condition fails → emit evidence file with `readiness: not-met`, include `failure_reason`, omit `eo_render_directive`
4. Does not attempt to render the artifact itself
5. Does not write to the `output_target` path

## Failure mode handling

Same rule as all other Stamper verifications — do not emit `met` on incomplete data.

Specific failure modes per control:

- **IA.L2-3.5.8 failure:** Entra password policy returns null or setting below threshold → `not-met`, remediation = adjust Entra config
- **CM.L2-3.4.4 failure:** AdminOps change log empty or unreachable → `not-met`, remediation = AdminOps not yet configured or logging not enabled
- **CM.L2-3.4.8 failure:** No allow-list or deny-by-exception policy active → `not-met`, remediation = deploy Intune/Defender allow-list policy
- **AU.L2-3.3.6 failure:** No Sentinel workbooks provisioned, or none has run → `not-met`, remediation = provision Sentinel workbooks
- **CA.L2-3.12.2 failure:** Pipeline has never produced output → `not-met` (genuinely a blocker; the pipeline has to run before POA&M can render)
- **CA.L2-3.12.4 failure:** Pipeline has never produced output → same as above
- **RA.L2-3.11.2 failure:** Defender for Cloud not enabled or no findings ever produced → `not-met`, remediation = enable Defender for Cloud vulnerability assessment

## What Stamper does NOT do

- **Does not render the artifacts.** That's EO's job. Stamper confirms signal; EO produces documents.
- **Does not write to the `output_target` path.** The evidence file lives in the evidence directory; the artifact lives in the compliance repository. Separate paths, separate ownership.
- **Does not fabricate signal.** If AdminOps change log is empty, Stamper emits `not-met`, not a fabricated SIA directive.
- **Does not bypass adequacy checks.** The seven controls are only SAT when their underlying signal is adequate. "Documentation-renderable" does not mean "always SAT"; it means "SAT when the signal is present, and the artifact follows from the signal."

## Acceptance criteria

- Stamper runs the seven signal queries in its normal cycle
- For each, emits evidence file with correct `readiness` and correctly-formed `eo_render_directive` (or `failure_reason`)
- Evidence files conform to the JSON structure specified
- `eo_render_directive.code` values match the canonical list
- No artifact rendering occurs in Stamper
- No writes occur to `output_target` paths
- Stamper's run log records each evidence file generated with its control_id and readiness
