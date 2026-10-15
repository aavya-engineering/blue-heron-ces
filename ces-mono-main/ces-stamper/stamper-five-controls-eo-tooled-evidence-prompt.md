# Stamper — Emit MET Evidence for Five EO-Managed Controls

## ⚠️ Preservation Clause

This prompt directs Stamper to generate evidence files for five specific controls. It does not replace or degrade anything that exists.

- **Existing Stamper directive handlers remain authoritative.** This prompt adds handling for the five named controls under the `eo-tooled` directive (added in `stamper-eo-tooled-directive-prompt.md`). It does not alter how Stamper handles other directives or other controls.
- **Existing Personnel card sub-features and risk assessment tooling are authoritative.** Stamper's evidence files reference these as the operational location; Stamper does not duplicate their data.
- **Existing evidence file shape conventions are authoritative.** The evidence files this prompt produces conform to the shape established in `stamper-eo-tooled-directive-prompt.md`.
- **Existing SSP narrative pipeline is authoritative.** EO consumes these evidence files at SSP-gen time using the existing dispatch on directive value.

If conflict arises between this prompt and the prior `eo-tooled` directive specification, the prior specification wins. This prompt fills in the per-control evidence content; it does not redefine the directive.

Read the existing `eo-tooled` handler implementation first. Confirm the evidence file shape, the SSP narrative dispatch, and the Personnel card / risk assessment query interfaces. Report findings before generating evidence files.

---

## Context

Five controls in the current Valor Forge plan currently show NOT MET. All five are at point values that disqualify them from POA&M (3 or 5 points per 32 CFR 170.21), meaning each must be MET before AO affirmation. The operational closure for each runs through tooling within EO:

| Control | Points | Title | EO location |
|---|---|---|---|
| AT.L2-3.2.1 | 5 | Security awareness training | Personnel card → Training sub-feature |
| AT.L2-3.2.2 | 5 | Role-appropriate training | Personnel card → Training sub-feature |
| PS.L2-3.9.1 | 5 | Personnel screening | Personnel card → Screening sub-feature |
| PS.L2-3.9.2 | 3 | Termination procedures | Personnel card → Offboarding workflow |
| RA.L2-3.11.1 | 3 | Risk assessment | Risk Assessment feature |

Each of these is closed operationally through documented procedures and structured evidence collection within EO. The tooling captures the per-subject evidence (training certificates, screening records, offboarding runs) or organizational artifacts (risk register, risk assessment report) that make the control MET. The evidence is included in the SSP and the evidence package generated at SSP-gen time.

This prompt directs Stamper to emit evidence files for each of these five controls with `directive: eo-tooled`, `readiness: met`, and per-control narrative that:

1. Names the control's purpose in plain language
2. Identifies where in EO the operational closure happens
3. References the policy artifact(s) that document the procedure
4. States that the evidence is collected within EO and automatically included in the SSP and evidence package
5. Provides the assessor verification path

The intent is that an assessor reading the SSP encounters consistent, clear language for these controls: the procedure is real, it lives in EO, and evidence is verifiable through EO's interface — not scavenged from external systems.

---

## Conditions for emitting MET

Stamper emits `readiness: met` for these controls **only when the underlying operational state in EO actually shows the control as satisfied**. The evidence files described below assume that state. If the underlying state shows gaps (training not delivered, screening incomplete, no offboarding runs, no risk assessment report), Stamper emits the same evidence file shape with `readiness: not-met` and specific gap identification per the patterns in `stamper-eo-tooled-directive-prompt.md`.

This prompt focuses on the MET case — what the evidence file looks like when the control is actually closed in EO. The not-met behavior is already specified in the directive prompt.

---

## Evidence file content per control

### AT.L2-3.2.1 — Security awareness training

**Control plain-language summary:** Personnel must be made aware of cybersecurity risks and the policies, standards, and procedures relevant to their work with organizational systems.

**Evidence file:**

```json
{
  "control_id": "AT.L2-3.2.1",
  "directive": "eo-tooled",
  "readiness": "met",
  "control_summary": "Ensures personnel are aware of cybersecurity risks and applicable policies, standards, and procedures for the systems they use.",
  "managed_within": {
    "tool": "EO",
    "feature": "Personnel Card",
    "sub_feature": "Training",
    "feature_path": "personnel/{personId}/training",
    "policy_artifact": "VFS-POL-012 Security Awareness and Training Program"
  },
  "operational_summary": {
    "total_in_scope_persons": 0,
    "persons_with_current_evidence": 0,
    "persons_pending": 0,
    "persons_overdue": 0,
    "next_refresh_due_overall": null,
    "_note": "Populated at runtime from Personnel card training_state query"
  },
  "evidence_pointer": {
    "primary_location": "EO Personnel card → Ledger → Training column shows per-person status",
    "per_person_drill_down": "Each person's detail drawer contains the Training sub-section with course-by-course completion status and certificate artifacts",
    "policy_pointer": "VFS-POL-012 Security Awareness and Training Program (rendered automatically into SSP appendix)"
  },
  "verification_method": "Stamper queried the Personnel card training_state for all non-offboarded persons. Each person verified to have a training_completion artifact for DoD Cyber Awareness Challenge dated within the annual refresh cycle.",
  "narrative_for_assessor": "This control is managed operationally through the Training sub-feature of the Personnel card within EO. The Security Awareness and Training Program (VFS-POL-012) is documented and rendered automatically as part of the SSP. Per-person training completion is captured through structured evidence collection — each person completes the DoD Cyber Awareness Challenge (the DoD baseline standard for end-user awareness), saves their completion certificate, and uploads the certificate as evidence. Stamper verifies completion status at SSP generation time. Evidence (policy document, per-person completion records, certificate artifacts) is automatically included in the SSP and the assessment evidence package.",
  "evidence_artifacts_in_ssp_package": [
    "VFS-POL-012 Security Awareness and Training Program (rendered policy)",
    "Training completion matrix (per-person × course × completion date)",
    "Per-person training certificate PDFs (linked from completion records)"
  ],
  "stamper_run_metadata": {
    "verified_at": "{runtime_iso_timestamp}",
    "stamper_version": "{current}"
  }
}
```

---

### AT.L2-3.2.2 — Role-appropriate training

**Control plain-language summary:** Personnel must be trained to carry out the security responsibilities that come with their specific role — what an administrator must know is different from what a general user must know.

**Evidence file:**

```json
{
  "control_id": "AT.L2-3.2.2",
  "directive": "eo-tooled",
  "readiness": "met",
  "control_summary": "Ensures personnel are trained to carry out their assigned information security duties and responsibilities — with role-appropriate depth (e.g., administrators receive admin-track training in addition to general awareness).",
  "managed_within": {
    "tool": "EO",
    "feature": "Personnel Card",
    "sub_feature": "Training",
    "feature_path": "personnel/{personId}/training",
    "policy_artifact": "VFS-POL-012 Security Awareness and Training Program"
  },
  "operational_summary": {
    "total_in_scope_persons": 0,
    "persons_with_current_evidence": 0,
    "persons_with_admin_track_training": 0,
    "persons_pending": 0,
    "persons_overdue": 0,
    "_note": "Populated at runtime from Personnel card training_state query, with role-based course requirements"
  },
  "evidence_pointer": {
    "primary_location": "EO Personnel card → Ledger → Training column shows per-person status across all required courses",
    "per_person_drill_down": "Each person's detail drawer Training sub-section shows required courses derived from role: baseline courses for all users; additional admin-track courses for administrators",
    "policy_pointer": "VFS-POL-012 Security Awareness and Training Program (rendered automatically into SSP appendix)"
  },
  "verification_method": "Stamper queried the Personnel card training_state for all non-offboarded persons. Each person verified to have role-appropriate training completions: general users complete DoD Cyber Awareness Challenge; administrators additionally complete an admin-track course (CDSE Cybersecurity Fundamentals or CISA Learning admin-track). All completions verified within annual refresh cycle.",
  "narrative_for_assessor": "This control is managed operationally through the Training sub-feature of the Personnel card within EO. The training program (VFS-POL-012) defines required courses per role: general users receive baseline cyber awareness training; administrators additionally receive admin-track technical training. The Personnel card derives required courses for each person from their role designation, tracks completion status, and surfaces gaps. Stamper verifies role-appropriate completion status at SSP generation. Evidence (policy document, role-mapped course requirements, per-person completion records) is automatically included in the SSP and assessment evidence package.",
  "evidence_artifacts_in_ssp_package": [
    "VFS-POL-012 Security Awareness and Training Program (rendered policy)",
    "Role-to-course requirement mapping (from training catalog)",
    "Per-person completion matrix showing baseline + role-specific training",
    "Certificate artifacts for each completion"
  ],
  "stamper_run_metadata": {
    "verified_at": "{runtime_iso_timestamp}",
    "stamper_version": "{current}"
  }
}
```

---

### PS.L2-3.9.1 — Personnel screening

**Control plain-language summary:** Individuals must be screened — their conduct, integrity, judgment, reliability, and stability evaluated — before being granted access to systems containing CUI.

**Evidence file:**

```json
{
  "control_id": "PS.L2-3.9.1",
  "directive": "eo-tooled",
  "readiness": "met",
  "control_summary": "Ensures individuals are vetted for trustworthiness before being authorized to access systems containing CUI. Screening evaluates conduct, integrity, judgment, reliability, and stability through documented evidence elements.",
  "managed_within": {
    "tool": "EO",
    "feature": "Personnel Card",
    "sub_feature": "Screening",
    "feature_path": "personnel/{personId}/screening",
    "policy_artifact": "VFS-POL-009 Personnel Screening Procedure"
  },
  "operational_summary": {
    "total_in_scope_persons": 0,
    "persons_with_complete_screening": 0,
    "persons_with_seven_elements_complete": 0,
    "persons_pending": 0,
    "persons_overdue": 0,
    "next_refresh_due_overall": null,
    "_note": "Populated at runtime from Personnel card screening_state query"
  },
  "evidence_pointer": {
    "primary_location": "EO Personnel card → Ledger → Screening status column shows per-person state",
    "per_person_drill_down": "Each person's detail drawer Screening sub-section shows the seven evidence elements (identity verification, citizenship documentation, verifiable history, direct-knowledge attestation, self-attestation regarding adverse history, CUI handling acknowledgment, AO sign-off) with individual artifact references for each element",
    "policy_pointer": "VFS-POL-009 Personnel Screening Procedure (rendered automatically into SSP appendix)"
  },
  "verification_method": "Stamper queried the Personnel card screening_state for all non-offboarded persons. Each person verified to have screening status 'cleared' with all seven evidence elements complete (or marked not-applicable with documented justification). Sequence integrity verified — AO sign-off element completed after the prior six elements. Segregation enforced — AO sign-off attestor is not the subject. All screenings within 5-year refresh cycle.",
  "narrative_for_assessor": "This control is managed operationally through the Screening sub-feature of the Personnel card within EO. The Personnel Screening Procedure (VFS-POL-009) is documented and rendered automatically as part of the SSP. The screening process captures seven distinct evidence elements per person, each individually evidenced and stored: identity verification, citizenship documentation, verifiable history, direct-knowledge attestation from another principal, self-attestation regarding adverse history, signed CUI handling acknowledgment, and Authorizing Official sign-off. The Personnel card provides embedded templates for each element to ensure consistent and complete evidence capture. Stamper verifies all elements present and current at SSP generation. Evidence (policy document, per-person screening records, individual element artifacts) is automatically included in the SSP and assessment evidence package.",
  "evidence_artifacts_in_ssp_package": [
    "VFS-POL-009 Personnel Screening Procedure (rendered policy)",
    "Per-person screening records with seven-element completion status",
    "Individual evidence artifacts per element (ID scans, citizenship docs, attestations, acknowledgments, sign-offs)",
    "Authorization audit trail (AO sign-off with timestamp and scope)"
  ],
  "stamper_run_metadata": {
    "verified_at": "{runtime_iso_timestamp}",
    "stamper_version": "{current}"
  }
}
```

---

### PS.L2-3.9.2 — Termination procedures

**Control plain-language summary:** When personnel leave or change roles, the organization must have procedures that protect CUI systems — disabling accounts, revoking sessions, returning property, reviewing recent access, all within defined timeframes.

**Evidence file:**

```json
{
  "control_id": "PS.L2-3.9.2",
  "directive": "eo-tooled",
  "readiness": "met",
  "control_summary": "Ensures CUI-containing systems are protected during and after personnel transitions through documented procedures executed within defined timeframes — disabling accounts, revoking sessions, returning property, reviewing CUI access during the employment period.",
  "managed_within": {
    "tool": "EO",
    "feature": "Personnel Card",
    "sub_feature": "Offboarding (wizard scaffold; AdminOps-driven in future)",
    "feature_path": "personnel/{personId}/offboarding-runs",
    "policy_artifact": "VFS-POL-010 Personnel Termination and Transfer Procedure"
  },
  "operational_summary": {
    "termination_procedure_documented": true,
    "termination_procedure_rendered": true,
    "completed_offboarding_runs_count": 0,
    "in_progress_offboarding_runs_count": 0,
    "all_runs_within_sla": null,
    "_note": "Populated at runtime from Personnel card offboarding_runs query"
  },
  "evidence_pointer": {
    "primary_location": "EO Personnel card → Ledger → filter by 'Offboarded' or 'Offboarding-in-progress' status",
    "per_run_drill_down": "Each offboarding run shows step-by-step execution timeline with timestamps, actor, evidence captured, SLA status. Steps include: Entra account disable, session revocation, license unassignment, CUI access review, property return documentation, AO closure attestation",
    "policy_pointer": "VFS-POL-010 Personnel Termination and Transfer Procedure (rendered automatically into SSP appendix)"
  },
  "verification_method": "Stamper queried the Personnel card for offboarding runs and verified: VFS-POL-010 is registered with the policy system and renders successfully; at least one offboarding run exists with status 'complete' demonstrating the procedure has been executed; all completed steps were within their defined SLAs; data-plane events (Entra account disable, session revocation) correlate with the procedural overlay artifact for runtime integrity.",
  "narrative_for_assessor": "This control is managed operationally through the Offboarding workflow of the Personnel card within EO. The Termination and Transfer Procedure (VFS-POL-010) is documented and rendered automatically as part of the SSP. When a termination or transfer event occurs, an offboarding run is initiated within the Personnel card, which walks the responsible person through each step of VFS-POL-010 with evidence capture at each step. Each step records completion timestamp, actor, evidence (data-plane event references for technical actions; attestations and uploaded artifacts for procedural steps), and SLA status. EO correlates the procedural overlay with data-plane events from Entra audit logs at SSP generation time to verify both procedural and technical execution. Evidence (policy document, completed offboarding runs, per-step evidence) is automatically included in the SSP and assessment evidence package.",
  "evidence_artifacts_in_ssp_package": [
    "VFS-POL-010 Personnel Termination and Transfer Procedure (rendered policy)",
    "Offboarding run records (each run is a structured artifact with step-by-step timeline)",
    "Data-plane event correlation references (Entra disable events, session revocation events) verified against procedural overlay timestamps",
    "AO closure attestations per run"
  ],
  "stamper_run_metadata": {
    "verified_at": "{runtime_iso_timestamp}",
    "stamper_version": "{current}"
  }
}
```

---

### RA.L2-3.11.1 — Risk assessment

**Control plain-language summary:** The organization must periodically assess the cybersecurity risk that comes from operating systems that process, store, or transmit CUI — identifying threats, vulnerabilities, likelihoods, and impacts to operations, assets, and individuals.

**Evidence file:**

```json
{
  "control_id": "RA.L2-3.11.1",
  "directive": "eo-tooled",
  "readiness": "met",
  "control_summary": "Ensures the organization periodically assesses cybersecurity risk from operating CUI-handling systems. Assessments identify threats, vulnerabilities, likelihoods, and impacts to operations, assets, and individuals using a documented methodology.",
  "managed_within": {
    "tool": "EO",
    "feature": "Risk Assessment",
    "sub_feature": "Annual Risk Register and Report",
    "feature_path": "risk-assessment/current",
    "policy_artifact": "VFS-POL-011 Risk Assessment Procedure"
  },
  "operational_summary": {
    "current_assessment_complete": true,
    "current_assessment_date": null,
    "next_assessment_due": null,
    "risk_register_entries_count": 0,
    "risks_by_severity": {
      "high": 0,
      "moderate": 0,
      "low": 0
    },
    "_note": "Populated at runtime from Risk Assessment feature query"
  },
  "evidence_pointer": {
    "primary_location": "EO Risk Assessment → Current Assessment view",
    "drill_down": "The current assessment view shows scope, methodology (NIST SP 800-30), threat identification, vulnerability assessment, risk register with likelihood × impact scoring per entry, and treatment recommendations. The Risk Assessment Report (VFS-DOC-001) is generated from this data and included in the SSP appendix.",
    "policy_pointer": "VFS-POL-011 Risk Assessment Procedure (rendered automatically into SSP appendix, defines annual frequency and NIST SP 800-30 methodology)"
  },
  "verification_method": "Stamper queried the Risk Assessment feature and verified: VFS-POL-011 is registered with the policy system and defines annual assessment frequency; the current Risk Assessment Report (VFS-DOC-001) exists and is dated within the past year; the risk register is populated with threat-vulnerability pairs scored using NIST SP 800-30 methodology; the assessment scope explicitly covers CUI-handling systems in the M365 GCC High + Azure Government tenant.",
  "narrative_for_assessor": "This control is managed operationally through the Risk Assessment feature within EO. The Risk Assessment Procedure (VFS-POL-011) is documented and rendered automatically as part of the SSP, defining annual frequency and NIST SP 800-30 methodology. The current Risk Assessment Report (VFS-DOC-001) is generated from the structured risk register maintained within EO — threats identified per NIST SP 800-30 Appendix D and E, vulnerabilities pulled from technical sources (Defender for Cloud findings, Microsoft Secure Score) and organizational sources, scored using NIST SP 800-30 Appendix G and H qualitative tables, with treatment recommendations per entry. Evidence (procedure, report, risk register) is automatically included in the SSP and assessment evidence package.",
  "evidence_artifacts_in_ssp_package": [
    "VFS-POL-011 Risk Assessment Procedure (rendered policy)",
    "VFS-DOC-001 Risk Assessment Report (current annual assessment)",
    "Risk register (structured threat-vulnerability-likelihood-impact entries)",
    "References to underlying technical vulnerability sources (Defender for Cloud, Secure Score) and organizational vulnerability documentation"
  ],
  "stamper_run_metadata": {
    "verified_at": "{runtime_iso_timestamp}",
    "stamper_version": "{current}"
  }
}
```

---

## Implementation guidance

### When Stamper runs

For each of the five controls, when Stamper processes the Planner output:

1. Confirm directive is `eo-tooled` (Planner emits this for these five controls when the operational tooling is in place — covered in the Planner-side migration prompt)
2. Query the relevant EO feature (Personnel card sub-feature or Risk Assessment feature) using the existing query interface
3. Apply the per-control adequacy criteria (defined in the directive prompt for `eo-tooled`)
4. If adequate → emit evidence file with `readiness: met` using the per-control templates above
5. If not adequate → emit evidence file with `readiness: not-met` and gap details (per the failure mode pattern in the directive prompt)

### Field substitution at runtime

The templates above use `{runtime_iso_timestamp}` and `{current}` placeholders. At Stamper runtime:

- `{runtime_iso_timestamp}` → ISO 8601 timestamp of the verification
- `{current}` → Stamper's current version string
- All `0` values in `operational_summary` → actual counts from the live query
- All `null` values for dates → actual dates from the live query
- The `_note` fields are documentation only and should not appear in the emitted evidence file

### Per-control narrative consistency

The five narratives above intentionally share a common structure:

1. Identify what the control does in plain language
2. Identify the EO location where the control is operationalized
3. Reference the policy artifact that documents the procedure
4. Describe how evidence is captured
5. State that evidence is automatically included in the SSP and evidence package
6. Provide the assessor verification path

This consistency is intentional — assessors reading the SSP encounter the same recognizable pattern for all five controls, which reinforces that they are all managed within a deliberate, integrated operational framework rather than as ad-hoc compliance activities.

---

## What Stamper Does Not Do

- **Does not emit MET when EO state shows gaps.** The MET evidence file template above assumes the underlying EO state is actually adequate. If it isn't, Stamper emits the corresponding not-met evidence file with specific gap identification.
- **Does not duplicate evidence.** The evidence files reference live state in EO; they do not snapshot or copy the underlying artifacts. EO's SSP-gen reads the references and includes the artifacts in the final package.
- **Does not modify EO state.** Read-only queries against Personnel card, Risk Assessment, and policy systems.
- **Does not generate the policy documents or report artifacts.** Those are produced by their respective rendering systems. Stamper references their existence and registration.
- **Does not handle controls outside these five.** Other controls retain their existing directive handling (`implement`, `inherit-fedramp`, `document-renderable`, etc.).

---

## Success Criteria

- Stamper emits evidence files for the five named controls when Planner provides `directive: eo-tooled` and the underlying EO state is adequate
- Each evidence file contains the per-control narrative as specified, with runtime field substitution
- Each evidence file references the correct EO feature path, policy artifact, and verification method
- Each evidence file includes a complete `evidence_artifacts_in_ssp_package` listing
- EO's SSP generator consumes the evidence files and renders SSP narrative that explicitly points the assessor to EO for verification
- All previously-existing evidence files for other controls continue to function unchanged
- A full pipeline cycle for the five controls produces SSP narrative that consistently identifies EO as the operational location, references the relevant policy artifacts, and provides clear verification paths

---

## Dependencies

- `stamper-eo-tooled-directive-prompt.md` — defines the `eo-tooled` directive handling
- `claude-code-prompt-personnel-card.md` — base Personnel card
- `claude-code-prompt-personnel-screening-extended.md` — seven-element screening sub-feature
- `claude-code-prompt-personnel-training-feature.md` — Training sub-feature
- `personnel-card-offboarding-wizard-integration-plan.md` — Offboarding workflow
- A future Risk Assessment feature spec (not yet written) — the RA.L2-3.11.1 evidence file references this; until the feature is built, the RA.L2-3.11.1 handler returns `not-met` with feature-not-yet-operational message
- Planner-side update to emit `eo-tooled` for these five controls (covered separately)
- EO SSP narrative dispatch to handle `eo-tooled` evidence (covered separately)

---

## Relationship to Other Session Artifacts

This prompt operationalizes:
- The `eo-tooled` directive defined in `stamper-eo-tooled-directive-prompt.md`
- The closure path for the five must-close 3-point and 5-point controls in `valor-forge-closure-plan.md`

This prompt depends on the EO features designed in:
- `claude-code-prompt-personnel-card.md`
- `claude-code-prompt-personnel-screening-extended.md`
- `claude-code-prompt-personnel-training-feature.md`
- `personnel-card-offboarding-wizard-integration-plan.md`

After this prompt ships and the dependent features are operational:
- The five must-close controls produce consistent, EO-pointing SSP narrative
- Assessors verifying these controls follow a clear path through EO rather than scavenging external systems
- The compliance state for these controls is always current with operational reality, since Stamper queries the live EO state at each SSP-gen
