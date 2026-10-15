# Planner Directive Migration — Align with Stamper Set B

## Context

Planner is the genesis point for control directives. It classifies each of the 110 CMMC Level 2 controls using a two-layer system:

**Layer 1 — `stamper_action`** on `ControlDisposition`, type `StamperAction` defined at `src/features/mpt/types.ts:42`:

```
'Automated' | 'Excluded' | 'Non-Stack'
```

**Layer 2 — `StamperDirective`** produced by `buildControlDirectives()` at `src/features/mpt/manualPlanGenerator.ts:69`:

```
'implement' | 'validate' | 'manual' | 'exclude' | 'skip'
```

Current mapping logic:

| stamper_action | readiness_status | StamperDirective |
|---|---|---|
| Excluded | — | `exclude` |
| Non-Stack | — | `manual` |
| Automated | `met` | `validate` |
| Automated | anything else | `implement` |

The output directive flows downstream to Stamper, which executes the action.

## The problem

`Excluded` at Layer 1 is overloaded. It is applied to two situations that SPRS treats differently:

1. **Capability absent** — the requirement's subject does not exist in the environment (no wireless infrastructure, no maintenance equipment, no mobile devices). SPRS value: **N/A**.
2. **Prohibited by design** — the requirement applies, but implementation is a deliberately enforced prohibition that reduces the capability to zero (removable media blocked via Intune, no endpoint downloads via Conditional Access). SPRS value: **MET**.

Both collapse to `exclude` at Layer 2. Downstream, Stamper has no way to tell them apart, which means evidence generation, SSP narrative, and ultimately the SPRS attestation cannot reflect the correct posture. An Affirming Official who submits an N/A when the requirement actually applies — even if satisfied through prohibition — is making a false statement on a federal attestation.

Fixing this downstream in Stamper alone would not work. The distinction has to be preserved at Planner, because Planner is where the classification decision is made.

## The migration — two layers expand together

### Layer 1 changes — `StamperAction` type at `src/features/mpt/types.ts:42`

**From:**
```typescript
type StamperAction = 'Automated' | 'Excluded' | 'Non-Stack';
```

**To:**
```typescript
type StamperAction =
  | 'Automated'
  | 'Non-Stack'
  | 'N-A-Capability-Absent'      // was: Excluded (subset)
  | 'Met-By-Prohibition';        // was: Excluded (subset)
```

`Excluded` is removed entirely. Every existing instance must be reclassified as one of the two new values or, in rare cases, reclassified as `Automated` or `Non-Stack` if the prior `Excluded` label was itself incorrect.

### Layer 2 changes — `StamperDirective` type and `buildControlDirectives()`

**From:**
```typescript
type StamperDirective = 'implement' | 'validate' | 'manual' | 'exclude' | 'skip';
```

**To:**
```typescript
type StamperDirective =
  | 'implement'
  | 'validate'
  | 'manual'
  | 'document-absence'    // replaces 'exclude' for N-A-Capability-Absent
  | 'document-prohibition' // new, for Met-By-Prohibition
  | 'skip';
```

`exclude` is removed. It was ambiguous by construction — downstream consumers could not tell which case they were handling.

**New mapping logic in `buildControlDirectives()`:**

| stamper_action | readiness_status | StamperDirective |
|---|---|---|
| N-A-Capability-Absent | — | `document-absence` |
| Met-By-Prohibition | `met` | `validate` |
| Met-By-Prohibition | anything else | `document-prohibition` |
| Non-Stack | — | `manual` |
| Automated | `met` | `validate` |
| Automated | anything else | `implement` |

Note the change to Met-By-Prohibition: when enforcement evidence is already captured (`readiness_status === 'met'`), the directive is `validate` — same as Automated-met. The prohibition is an implementation, and an already-verified implementation validates rather than re-implements. When enforcement is not yet verified, the directive is `document-prohibition`, which triggers Stamper to capture the policy and enforcement artifact.

### Downstream SPRS mapping

Every Layer 1 value now maps to exactly one SPRS value with no judgment at attestation time:

| stamper_action | SPRS value |
|---|---|
| Automated | MET |
| Non-Stack | MET |
| Met-By-Prohibition | MET |
| N-A-Capability-Absent | N/A |

(Controls flagged `NOT MET` in SPRS are handled at the readiness layer — an `Automated` or `Met-By-Prohibition` control without `readiness === 'met'` at submission time is a POA&M candidate.)

## What to do

### 1. Type changes

Update `src/features/mpt/types.ts:42` to the new `StamperAction` union. Update the `StamperDirective` union wherever defined (likely adjacent to `buildControlDirectives()`).

### 2. Mapping logic

Rewrite `buildControlDirectives()` at `src/features/mpt/manualPlanGenerator.ts:69` to implement the new mapping table. Remove the `Excluded` and `exclude` branches entirely — any input matching those should now be an invalid state surfaced as a compile-time error once the type union changes.

### 3. Classifier migration

Planner's upstream classifier — whatever produces the `stamper_action` value for each ControlDisposition — must be updated to apply the split test when it would have previously emitted `Excluded`:

> **Does the requirement apply to the environment, and is its implementation the deliberate prohibition of the capability it addresses?**
>
> - Yes to both → emit `Met-By-Prohibition`
> - Requirement does not apply because the underlying capability does not exist → emit `N-A-Capability-Absent`

If the classifier uses heuristics, training data, or a rules table to decide `Excluded`, update the decision logic to apply the two-part test and emit the correct new value. Preserve the reasoning trace (why the classifier chose this value) in the ControlDisposition — downstream consumers need to see the justification, not just the label.

### 4. Historical backfill

For existing ControlDispositions currently stored with `stamper_action === 'Excluded'`:

- Re-run the split test against each control.
- Emit the corrected `stamper_action` value.
- Log the migration in the ControlDisposition's audit trail: old value, new value, reasoning, timestamp, actor.
- Flag any ControlDisposition where the split test cannot be applied automatically (ambiguous baseline data, missing environment context) for human review. Do not guess.

### 5. Downstream handoff verification

After the Planner migration, verify that Stamper receives only the new directive set. Any `exclude` directive in the Planner→Stamper handoff after migration is a bug. Wire a contract test or type-level assertion to catch this: `StamperDirective` should not include `'exclude'` after migration, and if Stamper receives one, it should fail loudly rather than silently degrade.

## Worked examples

**AC.L2-3.1.14 (wireless access control)** — current `stamper_action: 'Excluded'` because no wireless networks in the environment. Apply the test: requirement applies only if wireless networks exist; they don't. → new value: `N-A-Capability-Absent`. Downstream directive (regardless of readiness): `document-absence`.

**AC.L2-3.1.21 (portable storage on external systems)** — current `stamper_action: 'Excluded'` because removable media is blocked. Apply the test: requirement applies (endpoints exist), implementation is prohibition via Intune. → new value: `Met-By-Prohibition`. If Intune policy enforcement evidence is already captured (`readiness: 'met'`), directive becomes `validate`. If not, `document-prohibition`.

**MA.L2-3.7.4 (nonlocal maintenance)** — current `stamper_action: 'Excluded'`. Apply the test: nonlocal maintenance requires customer-owned maintenance equipment; none exists in a cloud-only tenant. → new value: `N-A-Capability-Absent`. Directive: `document-absence`.

**PE.L1-3.10.1 through PE.L1-3.10.5 (physical protection)** — currently `Excluded` with notes indicating "FedRAMP High CSP inheritance." Apply the test: requirements apply (CUI is physically stored somewhere); they are not implemented by prohibition — they are implemented by Microsoft. → these should never have been `Excluded`. Correct value: `Non-Stack` with `platform_inherited: true`, directive `manual`, evidence artifact = Microsoft CRM citation + FedRAMP package ID. The migration script should flag these for upgrade out of the Excluded family entirely.

## Caveats

**The "no remote access" classification is suspect in a cloud-only tenant.** If users access M365 GCC High from anywhere other than a single fixed facility, remote access exists in the NIST sense. Remote-access controls currently classified as `Excluded` should be re-evaluated; most should move to `Automated` (Conditional Access policies, device compliance, MFA) not `N-A-Capability-Absent`.

**The "no mobile devices" classification is suspect if any user authenticates via phone-based MFA.** Authenticator-bearing phones are mobile devices for the purpose of 3.1.18 and 3.1.19. Verify the classifier's definition of "mobile devices" before preserving any control as `N-A-Capability-Absent` on that basis.

**`Met-By-Prohibition` requires both technical enforcement and captured evidence.** A written policy with no technical control (e.g., "USB use is prohibited" without an Intune policy blocking it) is not `Met-By-Prohibition`. It is `Automated` with `readiness !== 'met'` until enforcement is in place, which produces directive `implement`. The classifier must verify enforcement exists before emitting `Met-By-Prohibition`.

**The classifier must not use `Met-By-Prohibition` as a convenience label.** Any control where the environment could accommodate the capability but the organization chose not to is correctly `Met-By-Prohibition`. Any control where the organization lacks the capability entirely is `N-A-Capability-Absent`. Misclassifying the first as the second inflates the N/A count and creates FCA exposure. Misclassifying the second as the first is less dangerous but adds noise to the evidence pipeline.

## Required output

### 1. Code changes

- Updated `StamperAction` type union at `src/features/mpt/types.ts`.
- Updated `StamperDirective` type union at its definition location.
- Rewritten `buildControlDirectives()` at `src/features/mpt/manualPlanGenerator.ts:69`.
- Updated classifier logic wherever `stamper_action` is assigned.
- Contract test asserting `StamperDirective` never contains `'exclude'` post-migration.

### 2. Migration report

For every existing ControlDisposition, a row with:

- Control ID
- Old `stamper_action` value
- New `stamper_action` value
- Old `StamperDirective` (what buildControlDirectives would have emitted)
- New `StamperDirective`
- Test result (Capability absent / Implemented as prohibition / Already correctly classified / Flagged for human review)
- Reasoning trace (why the new classification is correct)
- Downstream SPRS value (MET / NOT MET / N/A)

### 3. Human-review queue

A list of ControlDispositions where the automated split test could not produce a confident answer. Each entry includes the control ID, the ambiguity (e.g., "environment context missing — unclear whether wireless exists"), and the data needed to resolve it.

## Out of scope

- **Do not** modify the readiness evaluation logic. The `readiness_status` field continues to mean "is implementation verified?" — that semantics is untouched.
- **Do not** change how Stamper consumes the directives downstream. The Stamper migration is a separate, parallel effort. Planner's job here is to emit the correct new directive values; Stamper's job is to act on them.
- **Do not** introduce additional `stamper_action` values beyond the four listed. If the classifier encounters a case that does not fit any of them, flag for human review — do not invent new categories.
- **Do not** invent readiness evidence. If a control is `Met-By-Prohibition` but enforcement evidence does not exist, `readiness_status` remains not-met and the directive correctly emits `document-prohibition`. Do not mark readiness as met to produce a cleaner directive.

## Acceptance criteria

- `Excluded` and `exclude` are removed from the codebase. Type checker confirms no references remain.
- Every existing ControlDisposition has been migrated or flagged for human review.
- The mapping table in `buildControlDirectives()` matches the new table in this document exactly.
- The contract test for the Planner→Stamper handoff passes.
- The migration report accounts for all 110 controls, including those where no change was needed (Automated and Non-Stack entries should be listed with "no migration required" rather than omitted).
- The human-review queue, if non-empty, has a documented plan for resolution before the migrated classifier is used to generate the next plan.
