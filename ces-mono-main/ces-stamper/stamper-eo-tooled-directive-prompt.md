# Stamper — Add `eo-tooled` Directive for Personnel Card-Managed Controls

## ⚠️ Preservation Clause

This prompt extends Stamper's directive vocabulary to recognize controls whose execution and evidence collection happen within EO's Personnel card. It does not replace or degrade anything that exists.

- **Existing Stamper directives remain authoritative.** `implement`, `validate`, `document-prohibition`, `document-absence`, `inherit-fedramp`, `document-renderable` continue to function unchanged. This prompt adds one new directive class for a specific, narrow case.
- **Existing Personnel card sub-features are authoritative.** Stamper queries the Personnel card via the existing query interface; this prompt does not alter how the Personnel card stores or surfaces evidence.
- **Existing EO SSP generator is authoritative.** SSP narrative for these controls flows through the existing assembly path; this prompt extends the directive metadata that EO consumes, not the generator itself.
- **Existing Planner classification is authoritative.** This prompt defines a new directive that Planner can emit when SI baseline + tenant signal indicates the control is managed within EO's Personnel card. Planner classification logic is updated separately to know when to emit this directive (covered briefly here for context, but the Planner-side change is its own prompt).

If conflict arises between this prompt and existing directive handling, evidence storage, or SSP narrative generation, the existing systems win. Read the existing directive handlers, evidence file shapes, and SSP narrative templates first. Report findings before extending.

---

## Context

Five controls in the current plan are being managed operationally through the EO Personnel card's sub-features (screening, training, offboarding):

| Control | Topic | Personnel card sub-feature |
|---|---|---|
| PS.L2-3.9.1 | Personnel screening | Screening (with seven evidence elements) |
| PS.L2-3.9.2 | Termination procedures | Offboarding wizard |
| AT.L2-3.2.1 | Security awareness | Training |
| AT.L2-3.2.2 | Role-appropriate training | Training |
| AT.L2-3.2.3 | Insider threat awareness | Training |

Each of these has documented procedures, embedded templates, evidence collection workflows, and per-person ledgers — all native to the Personnel card. The card produces structured control-plane evidence artifacts that EO already reads at SSP-gen time.

Today, Stamper's evidence handling for these controls treats them as normal `implement` or `nonstack` directives. That works but it doesn't communicate the **operational reality**: the procedure for closing the control is documented within EO, the evidence is captured by the Personnel card, and the assessor's verification path runs through the EO interface rather than through external documentation.

This prompt adds a new directive — `eo-tooled` — that explicitly signals "this control's procedure, evidence collection, and assessor verification all live within EO's Personnel card." Stamper produces evidence files that point the reader to EO's relevant sub-feature for the full procedural narrative and live evidence; EO's SSP-gen consumes the directive and produces narrative that stands on its own and clearly references the operational location.

The intent is to give an assessor reading the SSP a clear, accurate, and verifiable path: "This control is managed through the Personnel card's [Screening / Training / Offboarding] sub-feature. The procedure is documented at [location]. Live evidence for each authorized individual is available at [location]. As of this SSP generation, the following persons have current evidence for this control: [list]."

---

## Directive vocabulary addition

### Current enumeration

```
'implement' | 'validate' | 'manual' | 'document-absence' | 'document-prohibition' | 'inherit-fedramp' | 'document-renderable' | 'skip'
```

### New enumeration

```
'implement' | 'validate' | 'manual' | 'document-absence' | 'document-prohibition' | 'inherit-fedramp' | 'document-renderable' | 'eo-tooled' | 'skip'
```

### Semantics of `eo-tooled`

The control's procedure is documented as a feature within EO. Per-subject evidence is captured by EO's Personnel card sub-features. The control is satisfied when the relevant Personnel card sub-feature shows current, complete evidence for all in-scope subjects. Stamper verifies sub-feature state and emits evidence pointing to EO; EO renders the SSP narrative that describes the procedure and references the live evidence.

Distinct from:
- `document-renderable` — that directive renders a static artifact (a policy PDF, a SIA, a risk report) from observed signal. `eo-tooled` references a *live* sub-feature with per-subject evidence that can be drilled into; it does not render a single static artifact.
- `implement` — that directive verifies tenant configuration. `eo-tooled` verifies Personnel card state, which is operational compliance state, not tenant configuration state.
- `manual` — that directive expects external human-process artifacts (training certificates in SharePoint, IR after-action reports). `eo-tooled` expects those same artifacts to be inside EO's Personnel card, captured through structured workflows rather than ad-hoc uploads.

---

## Stamper changes required

### 1. Recognize `eo-tooled` directive on incoming evidence file requests

When Stamper processes a control with `directive: eo-tooled` from Planner output, it routes to the new `eo-tooled` evidence handler instead of one of the existing handlers.

The handler dispatches based on the control ID to the appropriate Personnel card sub-feature query:

| Control | Personnel card query |
|---|---|
| PS.L2-3.9.1 | screening_state for all non-offboarded persons |
| PS.L2-3.9.2 | offboarding_runs for any person currently or recently in `offboarding-in-progress` or `offboarded` state, plus a check that VFS-POL-010 termination procedure is rendered |
| AT.L2-3.2.1 | training_state for all non-offboarded persons; verify Cyber Awareness Challenge completion is current |
| AT.L2-3.2.2 | training_state for all non-offboarded persons; verify role-appropriate training (Cyber Awareness or admin-track) is current |
| AT.L2-3.2.3 | training_state for all non-offboarded persons; verify Insider Threat Awareness completion is current |

The query interface to the Personnel card is the same one used by other Stamper directives that consume Personnel card data — do not introduce a new query path. If the query interface needs minor extension to support `eo-tooled` queries (e.g., a "list all subjects with current evidence" pattern), make that extension minimally and align with existing patterns.

### 2. Adequacy criteria per control

For each of the five controls, define what "adequate" means in terms of Personnel card sub-feature state.

#### PS.L2-3.9.1 — Personnel screening
Adequate when:
- Every non-offboarded person in the Personnel ledger has screening status `cleared`
- Each cleared screening has all seven evidence elements complete (or marked not-applicable with documented justification)
- No screening is past its 5-year refresh cycle (state should not be `expired` for any person)
- VFS-POL-009 Personnel Screening Procedure is registered with the policy system and renders successfully

#### PS.L2-3.9.2 — Termination procedures
Adequate when:
- VFS-POL-010 Termination Procedure is registered with the policy system and renders successfully
- The Personnel card supports the offboarding workflow (wizard or AdminOps-driven equivalent)
- At least one offboarding run exists with status `complete` to demonstrate the procedure has been executed (the sample execution requirement)
- If no real terminations have occurred, a documented test offboarding (e.g., deprovisioning a stale service account) counts

#### AT.L2-3.2.1 — Security awareness
Adequate when:
- VFS-POL-012 Security Awareness and Training Program is registered and renders successfully
- Every non-offboarded person has a training_completion artifact for DoD Cyber Awareness Challenge with completion date within the refresh cycle (annual)
- The training catalog correctly identifies Cyber Awareness Challenge as required for the `all_users` role

#### AT.L2-3.2.2 — Role-appropriate training
Adequate when:
- Every non-offboarded person has at least one training_completion artifact satisfying their role's training requirements
- For administrators specifically, an admin-track course completion within the past year exists in addition to baseline training
- Course catalog correctly maps roles to required courses

#### AT.L2-3.2.3 — Insider threat awareness
Adequate when:
- Every non-offboarded person has a training_completion artifact for CDSE Insider Threat Awareness (INT101.16) with completion date within the refresh cycle (annual)
- Training catalog correctly identifies INT101.16 as required for the `all_users` role

### 3. Evidence file shape for `eo-tooled` directive

Stamper produces an evidence file per control with a structure that points the reader to EO and includes the verified state at the time of evaluation:

```json
{
  "control_id": "PS.L2-3.9.1",
  "directive": "eo-tooled",
  "readiness": "met",
  "managed_within": {
    "tool": "EO",
    "feature": "Personnel Card",
    "sub_feature": "Screening",
    "feature_path": "personnel/{personId}/screening",
    "policy_artifact": "VFS-POL-009 Personnel Screening Procedure"
  },
  "operational_summary": {
    "total_in_scope_persons": 3,
    "persons_with_current_evidence": 3,
    "persons_pending": 0,
    "persons_overdue": 0,
    "next_refresh_due_overall": "2031-04-23"
  },
  "evidence_pointer": {
    "primary_location": "EO Personnel card → Ledger → filter by control: PS.L2-3.9.1",
    "per_person_drill_down": "Click any person to view their screening sub-section; each of the seven evidence elements is individually stored with artifact references",
    "policy_pointer": "EO Policy Library → VFS-POL-009"
  },
  "verification_method": "Stamper queried Personnel card screening_state for all non-offboarded persons. Each person was verified to have screening status 'cleared' with all seven evidence elements complete and within refresh cycle.",
  "narrative_for_assessor": "This control is managed operationally through the Personnel card's Screening sub-feature within EO. The procedure (VFS-POL-009) is documented and rendered automatically as part of the SSP. Live, per-person evidence is captured for each authorized individual through a structured seven-element workflow. As of this SSP generation: 3 of 3 in-scope persons have current screening evidence; 0 are pending; 0 are overdue. The assessor may verify by accessing the EO Personnel card, opening the ledger, and reviewing each person's screening sub-section.",
  "verified_subjects": [
    {
      "person_id": "vfs-person-abc",
      "display_name": "[Person 1]",
      "evidence_status": "current",
      "last_completion_date": "2026-04-23",
      "next_refresh_due": "2031-04-23"
    },
    {
      "person_id": "vfs-person-def",
      "display_name": "[Person 2]",
      "evidence_status": "current",
      "last_completion_date": "2026-04-23",
      "next_refresh_due": "2031-04-23"
    }
  ],
  "evidence_artifacts": [
    "EO Personnel card screening sub-feature (live)",
    "compliance_repository/policies/VFS-POL-009-personnel-screening.pdf (rendered policy)",
    "compliance_repository/personnel-files/{personId}/screening/* (per-person evidence)"
  ],
  "stamper_run_metadata": {
    "verified_at": "2026-04-23T18:00:00Z",
    "stamper_version": "current"
  }
}
```

### 4. Failure mode handling

When the adequacy criteria fail for any of the five controls, Stamper emits the evidence file with `readiness: not-met` and a specific failure reason. The same EO-tooled framing applies — the reader is still pointed to EO for verification — but the narrative explicitly identifies the gap.

```json
{
  "control_id": "AT.L2-3.2.1",
  "directive": "eo-tooled",
  "readiness": "not-met",
  "managed_within": { ... same as above ... },
  "operational_summary": {
    "total_in_scope_persons": 3,
    "persons_with_current_evidence": 1,
    "persons_pending": 2,
    "persons_overdue": 0,
    "specific_gaps": [
      {
        "person_id": "vfs-person-def",
        "display_name": "[Person 2]",
        "missing_course": "DoD Cyber Awareness Challenge 2026",
        "status": "not_yet_assigned"
      },
      {
        "person_id": "vfs-person-ghi",
        "display_name": "[Person 3]",
        "missing_course": "DoD Cyber Awareness Challenge 2026",
        "status": "assigned_not_completed",
        "assigned_date": "2026-04-15"
      }
    ]
  },
  "evidence_pointer": "EO Personnel card → Ledger → filter by training status: 'overdue' or 'pending'",
  "verification_method": "Stamper queried Personnel card training_state for all non-offboarded persons. 2 of 3 persons lack current training_completion artifacts for DoD Cyber Awareness Challenge.",
  "narrative_for_assessor": "This control is managed operationally through the Personnel card's Training sub-feature within EO. The Training Program (VFS-POL-012) is documented and rendered automatically as part of the SSP. As of this SSP generation, 2 of 3 in-scope persons lack current evidence: [Person 2] has not yet been assigned the required course; [Person 3] was assigned on 2026-04-15 but has not yet returned a completion certificate. Remediation: complete training assignment and certificate collection through the Personnel card. POA&M target closure: [date].",
  "remediation_pointer": "EO Personnel card → Ledger → identify persons with pending or overdue training → click person to access training sub-section → use Assign action to send training assignment email → upload completion certificates as they are returned"
}
```

### 5. SSP narrative implications

When EO's SSP generator consumes evidence files with `directive: eo-tooled`, it renders narrative that:

1. States that the control is managed within EO and identifies the specific Personnel card sub-feature
2. References the rendered policy artifact for the procedure documentation
3. Includes the operational summary at SSP-gen time
4. Provides the assessor verification path (where to look in EO to verify)
5. Lists per-person evidence status (with PII appropriately redacted to display names + last completion dates)
6. For not-met cases, identifies specific gaps and POA&M references

The narrative for `eo-tooled` controls should follow this structure:

```
Implementation status: [Implemented via tooling | Not yet fully implemented]

This control is managed operationally through the [Personnel Card sub-feature]
within EO. Procedure documentation is provided by [policy artifact, rendered
automatically and included in SSP appendix]. Per-subject evidence is captured
through [description of sub-feature workflow] and stored in EO's compliance
repository under [path pattern].

Operational state at this SSP generation:
[Operational summary metrics]

Procedure summary:
[Brief restatement of the procedure - 2-3 sentences referencing the policy artifact]

Evidence verification:
The assessor may verify this control by accessing the EO Personnel card. From
the ledger view, [specific verification instructions]. Each subject's evidence
is individually accessible and includes [list of evidence types per subject].

Per-subject evidence status:
[Table or list of subjects with display names and current evidence status]

[For not-met cases:]
Identified gaps:
[Specific list of which subjects are missing what evidence, with remediation
plan reference]
```

Do not produce generic "we have a process" narrative. Every `eo-tooled` narrative must point to specific subjects, specific evidence locations within EO, and specific verification paths.

---

## Planner-side changes (referenced for context, separate prompt covers fully)

For Stamper to receive `eo-tooled` directives, Planner must emit them. The Planner classification logic for the five controls should select `eo-tooled` when:

1. The Personnel card is configured and operational in the tenant
2. The relevant sub-feature for the control is enabled
3. Required policy artifacts (VFS-POL-009 for screening, VFS-POL-010 for offboarding, VFS-POL-012 for training) are registered with the policy rendering system
4. SI baseline confirms the operational pattern (small-org direct-knowledge screening for PS.9.1, training-via-DoD-resources for AT family, AdminOps or wizard for offboarding)

If any of these is false, Planner falls back to whichever existing directive previously classified the control (`document-renderable`, `nonstack`, `implement`, etc.).

The Planner-side migration is covered by a separate prompt. This Stamper prompt assumes Planner is updated; if Stamper receives `eo-tooled` directives before Planner is updated, it returns a clean error indicating the directive is recognized but not yet wired upstream.

---

## Required Pre-Implementation Discovery

Before writing code:

1. **What's the existing Stamper directive handler dispatch pattern?**
   - How does Stamper select the right handler based on directive value?
   - The `eo-tooled` handler should slot into this pattern, not introduce a new dispatch mechanism

2. **What's the Personnel card's existing query interface for Stamper?**
   - How does Stamper query screening state today (since the screening sub-feature exists per the base Personnel card spec)?
   - The training and offboarding sub-features may not yet have established query patterns since they're being built — confirm whether to extend existing patterns or wait for those features to land first

3. **What's the existing evidence file shape Stamper produces?**
   - Field naming conventions
   - Standard metadata blocks (control_id, directive, readiness, evidence_artifacts, etc.)
   - The `eo-tooled` evidence file should match these conventions and add only the new fields specified

4. **How does EO's SSP generator currently dispatch on directive value?**
   - For Stamper's `eo-tooled` evidence to flow into the right narrative template, EO must dispatch correctly
   - Confirm whether EO's directive-aware narrative selection is already extensible

Report findings before proceeding.

---

## Implementation Plan

### Phase 0 — Discovery (1 day)

Answer the four discovery questions. Confirm Personnel card sub-feature query interfaces (or where they will land if still under development). Propose minimal extensions to existing patterns if needed.

### Phase 1 — Add directive to enumeration (0.5 day)

- Add `eo-tooled` to the directive type union
- Update validation logic to accept the new value
- Update any directive enumeration tests

### Phase 2 — `eo-tooled` evidence handler (3-4 days)

- Implement the handler dispatching by control ID to the right Personnel card query
- Per-control adequacy logic for the five controls
- Evidence file generation matching the shape specified
- Failure mode handling with specific gap identification
- Unit tests for met / not-met / partial scenarios

### Phase 3 — Narrative-stub generation for EO consumption (2 days)

- Stamper produces narrative_stub field in evidence file consumable by EO's narrative renderer
- Stub references specific subjects, sub-feature paths, policy artifacts
- For not-met cases, includes specific gap descriptions

### Phase 4 — Integration with Personnel card sub-features (2-3 days)

- Wire screening query (already implemented per base Personnel card spec)
- Wire training query (depends on Training sub-feature being built per `claude-code-prompt-personnel-training-feature.md`)
- Wire offboarding query (depends on Offboarding wizard being built per `personnel-card-offboarding-wizard-integration-plan.md`)
- For sub-features not yet built, the handler returns `not-met` with `verification_incomplete` failure reason and a clear "feature not yet operational" message

### Phase 5 — End-to-end testing (1-2 days)

- Test each of the five controls through Planner emit → Stamper handle → EO consume cycle
- Verify SSP narrative renders correctly for met and not-met cases
- Verify failure modes produce clear, actionable messages
- Verify the assessor verification path described in the narrative actually works (i.e., navigating to EO Personnel card from the SSP narrative reaches the right view)

**Total estimated effort: 8-11 developer days**

---

## What Stamper Does Not Do

- **Does not modify Personnel card data.** Read-only query against the card's state. Personnel card owns its data; Stamper observes it.
- **Does not render policy documents.** The policy rendering pipeline (existing) renders VFS-POL-009, VFS-POL-010, VFS-POL-012. Stamper references their existence and registration but does not produce them.
- **Does not generate SSP narratives directly.** Stamper produces evidence files with narrative stubs; EO's SSP generator produces final narratives.
- **Does not classify controls.** Planner decides which controls are `eo-tooled`. Stamper executes against that classification.
- **Does not auto-remediate.** When evidence is not-met, Stamper points to the Personnel card for remediation — it does not attempt to fix the gap directly.

---

## Success Criteria

- `eo-tooled` directive is accepted as valid throughout Stamper code
- Stamper handler correctly queries Personnel card sub-features for the five target controls
- Evidence files match the shape specified, with all required fields populated
- Met / not-met determination matches the per-control adequacy criteria
- Failure mode evidence includes specific gap identification (which person, which course, which element)
- Narrative stubs are specific to operational state (no generic "we have a process" language)
- Stamper's existing evidence files for other directives continue to function unchanged
- All previously-existing directive handlers, evidence shapes, and narrative pipelines work identically before and after this change
- A full pipeline cycle (Planner → Stamper → EO) for the five target controls produces SSP narrative that explicitly points the assessor to EO for verification

---

## Dependencies and Risks

### Dependencies
- Personnel card base implementation (per `claude-code-prompt-personnel-card.md`) must be operational
- Personnel card sub-features (Screening with seven elements, Training, Offboarding wizard) must be implementable or already shipped — handler returns clear "not yet operational" messages until they land
- Policy rendering for VFS-POL-009, VFS-POL-010, VFS-POL-012 must be functional
- EO's SSP narrative pipeline must be extensible to dispatch on directive value (confirmed in discovery)
- Planner's directive classification logic must be updated separately to emit `eo-tooled` for the five controls (covered by its own prompt)

### Risks
- **Personnel card sub-features partially built when `eo-tooled` ships.** Mitigation: handler gracefully returns `not-met` with feature-not-yet-operational message; SSP narrative is honest about the gap rather than producing misleading "MET" output.
- **Personnel card query interface inconsistencies.** Mitigation: Phase 0 discovery surfaces the patterns; align before Phase 4 wiring.
- **EO narrative renderer doesn't dispatch on `eo-tooled` correctly.** Mitigation: Phase 3 produces detailed narrative stubs that work with whatever rendering EO does today; if EO needs an extension to dispatch on the new directive, that's a separate small EO change covered in the EO migration prompt for `eo-tooled`.
- **Operational state at SSP-gen time differs from what Planner assumed at classification time.** For example, Planner emits `eo-tooled` for AT.L2-3.2.1 but at SSP-gen time the Training sub-feature shows zero completions. Mitigation: Stamper's adequacy check is the source of truth; if state has degraded, the evidence file says `not-met` and the SSP narrative is accurate even if Planner's classification was based on intent. Planner reclassifies on the next cycle if needed.
- **Mixed-directive plan looks messy in the SSP.** Some controls in the AT family are `eo-tooled`; others (e.g., AT.L2-3.2.3 if not yet wired) might be `nonstack` PROVISIONAL. The SSP renders both styles; assessors see mixed presentation. Mitigation: for the five target controls, ship the wiring for all of them at once, not piecemeal. Mixed presentation is acceptable temporarily during the rollout but should be cleaned up by next plan cycle.

---

## Relationship to Other Session Artifacts

This prompt extends:
- The Stamper directive vocabulary (previously updated by `stamper-documentation-renderable-prompt.md`, `stamper-fedramp-inheritance-prompt.md`, etc.)

This prompt depends on:
- `claude-code-prompt-personnel-card.md` — base Personnel card
- `claude-code-prompt-personnel-screening-extended.md` — seven-element screening
- `claude-code-prompt-personnel-training-feature.md` — Training sub-feature
- `personnel-card-offboarding-wizard-integration-plan.md` — Offboarding wizard

This prompt complements:
- A future Planner prompt that updates classification to emit `eo-tooled` for the five target controls
- A future EO prompt that updates SSP narrative dispatch to handle `eo-tooled` evidence files

After this prompt ships:
- The five target controls (PS.L2-3.9.1, PS.L2-3.9.2, AT.L2-3.2.1, AT.L2-3.2.2, AT.L2-3.2.3) produce SSP narrative that explicitly references EO as the operational location
- Assessors verifying these controls follow a clear path through the EO Personnel card rather than scavenging SharePoint for evidence
- The compliance state for these controls is always current with operational reality, since Stamper queries the Personnel card live at each SSP-gen
