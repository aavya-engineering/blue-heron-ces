# Stamper Directive Migration — Consume Planner Set B

## Context

Planner is the genesis point for control directives. Planner classifies each control and emits a `StamperDirective` value that Stamper acts on. Planner has been migrated to an expanded directive system (Set B) that preserves critical distinctions previously lost at the Planner→Stamper handoff.

Stamper must now be updated to consume the new directive set, execute the correct action for each directive, and produce SPRS-ready output that the Affirming Official can attest to without risk of false statement.

This migration is downstream of the Planner migration. Planner emits the new directives; Stamper consumes and acts on them. Stamper does not reclassify — that is Planner's job. Stamper's responsibility is to execute the directive correctly and generate the evidence, narrative, and SPRS mapping that flow from it.

## The directive set Stamper now receives

Planner's updated `StamperDirective` union:

```
'implement' | 'validate' | 'manual' | 'document-absence' | 'document-prohibition' | 'skip'
```

The two changes from the prior Stamper-side vocabulary:

- `exclude` is **removed**. It was ambiguous by construction — it collapsed "capability absent" and "prohibited by design" into one value, which Stamper could not distinguish downstream.
- `document-absence` and `document-prohibition` replace it with two unambiguous values, each with a different action, different evidence model, and different SPRS mapping.

### What each directive means and what Stamper does with it

| Directive | Planner upstream state | Stamper action | SPRS value |
|---|---|---|---|
| `implement` | `Automated`, readiness not met | Execute automation to configure the control; capture evidence | MET once complete, else NOT MET |
| `validate` | `Automated` or `Met-By-Prohibition`, readiness already met | Re-verify enforcement; refresh evidence artifact | MET |
| `manual` | `Non-Stack` (procedural or inherited) | Capture or reference the manual artifact (training record, signed policy, Microsoft CRM citation, FedRAMP package ID) | MET |
| `document-absence` | `N-A-Capability-Absent` | Generate SSP narrative explaining why the capability does not exist; reference the baseline documentation establishing absence | N/A |
| `document-prohibition` | `Met-By-Prohibition`, readiness not yet captured | Capture the policy text plus the technical enforcement artifact (Intune profile, CA policy JSON, DLP rule) | MET once captured, else NOT MET |
| `skip` | (existing, unchanged) | Take no action for this control in this run | unchanged |

## The problem this migration solves

Before the Planner migration, Stamper received `exclude` for two materially different situations:

1. A wireless-access control on a tenant with no wireless infrastructure — genuinely N/A.
2. A removable-media control on a tenant where removable media is blocked via Intune — genuinely MET, because the prohibition is the implementation.

Stamper treated both identically, producing the same output regardless of which case it was. An Affirming Official reviewing Stamper's output could not tell which controls should flow to SPRS as N/A and which should flow as MET. Attesting N/A to a control that actually applies is a false statement on a federal attestation.

With the Planner migration, Stamper receives distinct directives for the two cases. Stamper must now produce distinct output.

## What to do

### 1. Update the directive consumer

Wherever Stamper dispatches on directive value, update to the new union. Remove any handler for `exclude`. If a handler receives `exclude` after migration, fail loudly — it indicates a Planner→Stamper version mismatch.

Add handlers for `document-absence` and `document-prohibition`. Each needs a distinct execution path:

**`document-absence` handler:**

- Generates an SSP narrative stub explaining why the subject capability does not exist in the environment (no wireless infrastructure, no maintenance equipment, no mobile devices).
- References the baseline documentation (SI baseline, environment inventory, boundary definition) that establishes the absence.
- Does not attempt to configure anything, does not call out to Microsoft APIs, does not produce a technical-enforcement artifact — there is nothing to enforce.
- Emits the control's SPRS value as N/A.

**`document-prohibition` handler:**

- Generates an SSP narrative stub explaining how the prohibition implements the requirement (e.g., "Use of portable storage devices is limited to zero on all managed endpoints via Intune device configuration profile [name]").
- Captures two evidence artifacts: the policy text (written prohibition, signed and dated) and the technical enforcement configuration (Intune policy export, Conditional Access JSON, DLP rule definition).
- Verifies that the enforcement is active at the time of capture. If enforcement is not active, the control is NOT MET — Stamper must not produce a MET output for a prohibition that exists only on paper.
- Emits the control's SPRS value as MET (if both artifacts captured and enforcement verified) or NOT MET (otherwise).

### 2. Update SPRS output mapping

Stamper's output to the SPRS submission layer maps each directive to an SPRS value. The new mapping:

| Stamper directive | SPRS value |
|---|---|
| `implement` | MET (if post-execution verification passes) or NOT MET |
| `validate` | MET |
| `manual` | MET (artifact required) |
| `document-absence` | N/A |
| `document-prohibition` | MET (both artifacts required) or NOT MET |
| `skip` | (unchanged — no SPRS output) |

Any code path that currently maps `exclude` → N/A must be replaced. The new code path reads the directive and maps accordingly. Do not fall back to `exclude` handling for legacy ControlDispositions — the migration of existing data is Planner's responsibility (see the Planner migration prompt).

### 3. Update evidence generation

Stamper's evidence generators should produce output appropriate to each new directive:

- **`document-absence`** → narrative-only evidence. No automated collector runs. The artifact is a markdown section citing the baseline.
- **`document-prohibition`** → two-part evidence. A narrative section plus a technical artifact exported from the enforcement layer (Intune Graph, CA policy JSON, DLP policy definition). Both must be present for the control to be MET.

Preserve the existing evidence generators for `implement`, `validate`, and `manual` — these directives have not changed in meaning.

### 4. Update SSP narrative generation

The SSP narrative for each control should reflect the directive accurately:

- `document-absence` narratives describe why the capability does not exist. Example language: "No wireless networks are deployed in the CUI boundary. The cloud-only tenant is accessed via user-provided internet connections that originate outside the assessment boundary."
- `document-prohibition` narratives describe the prohibition as an implementation. Example language: "Portable storage use is limited to zero on all managed endpoints. Intune device configuration profile [profile name] blocks USB mass storage class devices. Policy enforcement is continuously monitored via Intune compliance reporting."

Do not generate narratives that conflate the two cases. An assessor reading the SSP should be able to tell at a glance whether a control is satisfied by absence or by prohibition.

### 5. Update the readiness feedback loop

Stamper's readiness evaluation feeds back into Planner for the next plan. The readiness signals for the new directives:

- `document-absence` → readiness is always `met` (nothing to verify; absence is continuous unless the environment changes).
- `document-prohibition` → readiness is `met` only when both the policy artifact and the technical enforcement artifact are captured and the enforcement is verified active. Readiness is `not-met` if either artifact is missing or if enforcement check fails.

The readiness-to-directive feedback should match the Planner mapping table exactly — Planner's next plan relies on accurate readiness signals to emit the correct directive in the next cycle.

### 6. Contract tests

Add contract tests at the Planner→Stamper boundary:

- Stamper rejects the string `'exclude'` as an invalid directive.
- Stamper produces N/A output only when the directive is `document-absence`.
- Stamper produces MET output only when evidence artifacts for the directive type are captured and validated.
- A `document-prohibition` directive with missing enforcement evidence produces NOT MET, not MET.

## Worked examples

**AC.L2-3.1.14 (wireless access control)** — Planner emits `document-absence`. Stamper generates an SSP narrative citing the SI baseline's no-wireless statement. No automated collector runs. Evidence is the narrative plus the baseline reference. SPRS output: N/A.

**AC.L2-3.1.21 (portable storage)** — Planner emits `document-prohibition` because readiness is not yet captured. Stamper queries Intune Graph for the device configuration profile blocking USB mass storage, exports the profile definition, and pairs it with the written policy text. Both artifacts land in the evidence repository. Readiness is updated to `met`. SPRS output: MET.

**AC.L2-3.1.21 (next cycle)** — Planner now emits `validate` because readiness was met in the prior cycle. Stamper re-runs the Intune query to confirm the profile is still active and re-captures the artifact. If the policy has been removed or modified, readiness drops and the directive flips back to `document-prohibition` on the next plan.

**PE.L1-3.10.1 (physical protection)** — Planner emits `manual` with the `platform_inherited` flag. Stamper references the Microsoft FedRAMP High package ID and CRM citation. No Graph call, no technical artifact. SPRS output: MET.

**MA.L2-3.7.4 (nonlocal maintenance)** — Planner emits `document-absence`. Stamper generates a narrative citing the cloud-only architecture. SPRS output: N/A.

## Caveats

**Stamper does not second-guess Planner.** If Planner emits `document-absence` for a control, Stamper generates the absence narrative — it does not re-run a classification test to verify that the capability is really absent. That verification was Planner's responsibility. If the classification is wrong, the fix is upstream in Planner, not a runtime override in Stamper.

**`document-prohibition` with no enforcement evidence must produce NOT MET.** This is the key guardrail against FCA exposure. A written policy with no technical control is not MET. If Stamper cannot find the technical artifact (Intune export, CA policy, DLP rule), the control is NOT MET regardless of what the written policy says. The readiness signal flows back to Planner, which issues a POA&M directive on the next plan.

**Do not add new directives to the union in Stamper.** The directive set is defined by Planner. Stamper consumes it. If Stamper encounters a case that does not fit the existing directives, the fix is at Planner — either the classifier is missing a case or a ControlDisposition has bad data. Do not patch around it in Stamper.

**The SPRS affirmation layer trusts Stamper's output.** Every directive-to-SPRS mapping in Stamper must be correct, because the Affirming Official signs an attestation based on the submitted values. A bug in Stamper that maps `document-prohibition` → N/A, or maps `document-absence` → MET, is a bug that produces a false federal attestation. Treat the mapping code as security-critical.

## Required output

### 1. Code changes

- Updated directive consumer handling all six directives (`implement`, `validate`, `manual`, `document-absence`, `document-prohibition`, `skip`).
- New `document-absence` and `document-prohibition` handlers with distinct evidence generation paths.
- Updated SPRS output mapping matching the new table.
- Removed all references to `exclude`. Type checker confirms none remain.
- Contract tests at the Planner→Stamper boundary.

### 2. Migration verification report

After the migration is complete, a run against the current ControlDisposition set should produce:

- A list of every control with its directive, readiness status, evidence artifacts captured, and SPRS value.
- Zero controls with SPRS value set by fallback or default logic — every value traces to an explicit directive handler.
- A summary count: N/A controls, MET controls, NOT MET controls, skipped controls.

### 3. Downgrade/rollback path

Document the rollback: if the Planner migration is reverted (e.g., Planner regresses to emitting `exclude`), Stamper must fail rather than accept the legacy value. A temporary adapter layer is acceptable only during the handoff window, and only with an explicit expiration date in the code.

## Out of scope

- **Do not** add classification logic to Stamper. Classification is Planner's job. If Stamper encounters a case it cannot handle, the fix is at Planner.
- **Do not** change the `implement`, `validate`, `manual`, or `skip` handlers unless required by the new directive set. Their semantics are preserved across the migration.
- **Do not** introduce new SPRS values. SPRS accepts MET, NOT MET, and N/A. Stamper's mapping table must produce exactly one of these (or nothing, in the case of `skip`).
- **Do not** generate evidence that does not exist. If the artifact is missing, the control is NOT MET. Inventing an artifact — even a plausible one — is the kind of thing that surfaces during a DCMA DIBCAC Medium assessment and turns into an FCA finding.

## Acceptance criteria

- All six Stamper directives have explicit handlers.
- `exclude` appears nowhere in the Stamper codebase.
- `document-absence` produces N/A output, never MET.
- `document-prohibition` produces MET only when both policy and enforcement artifacts are captured and enforcement is verified active.
- SPRS output mapping is covered by tests for every directive value.
- Contract tests at the Planner→Stamper boundary pass.
- A run against the current registry produces a verification report with no controls falling through to default logic.
