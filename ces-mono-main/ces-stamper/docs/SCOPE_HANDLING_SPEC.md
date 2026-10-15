# Control Scope Exclusion Handling Specification

**Author:** CES Engineering
**Status:** Draft
**Date:** 2026-03-23
**Affects:** Stamper (`src/translators/PlanTranslator.ts`, `src/core/CmmcComplianceAnalyzer.ts`), EO (`src/eo/sprs/SprsCalculator.ts`, `src/eo/poam/PoamGenerator.ts`)

---

## 1. Background

CES-FE (the Planner) captures Strategic Intent (SI) decisions about a customer's CMMC L2 enclave. Some SI decisions determine that specific NIST SP 800-171 controls are not applicable to the customer's environment. These decisions are verifiable facts about the tenant's architecture, not subjective risk acceptances.

**Current state:** Stamper already handles one form of scope exclusion -- the `infrastructure_model` enclave filter (`m365_only`, `m365_sentinel`, `m365_azure`). This uses `excludedEntryIds` in `CmmcComplianceAnalyzer` and `filterByEnclave()` in `CommandRegistry` to remove infrastructure-tier registry entries that do not apply to an M365-only tenant. The existing `out_of_scope` category in `ControlStatus` and `FamilyStatus` already exists in the analyzer output.

**Gap:** The current approach operates at the registry-entry level (which entries to skip) rather than at the control level (which NIST requirements are not applicable). CES-FE has explicit SI-driven scope decisions that make entire controls not applicable. These need to flow through Stamper's translation, compliance analysis, SPRS scoring, and evidence reporting pipelines.

### SI Decisions That Drive Scope Exclusions

| SI Decision | Effect | Controls Excluded |
|---|---|---|
| No mobile devices in CUI enclave | Mobile device controls are N/A | AC.L2-3.1.18, AC.L2-3.1.19 |
| No wireless networks | Wireless controls are N/A | AC.L2-3.1.14, AC.L2-3.1.16 (partial) |
| Removable media blocked by policy | Media protection transport controls are N/A | MP.L2-3.8.5, MP.L2-3.8.6 |
| No remote access to CUI | Remote access controls are N/A | AC.L2-3.1.12, PE.L2-3.10.6 |
| No nonlocal maintenance | Nonlocal maintenance controls are N/A | MA.L2-3.7.4 |
| M365-only infrastructure | Azure infra controls get manual alternatives | 9 controls (already implemented via `infrastructure_model`) |

Note: AC.L2-3.1.16 is excluded only by the "no wireless" rule (`wireless_posture`). CES-FE does not exclude it via the mobile rule alone. AC.L2-3.1.15 is not excluded by any single rule -- it would only be excludable when both no mobile AND no wireless, but CES-FE does not implement that combined exclusion.

---

## 2. CES-FE Contract: `scope_exclusions` Array

CES-FE will add a `scope_exclusions` array to the Manual Mission Plan artifact at `outputs.human_readable_mission_plan.scope_exclusions`. Each entry represents a single control excluded by a verifiable SI decision.

### Schema

CES-FE emits exactly 4 fields per scope exclusion. It does **not** emit `nist_ref` or `sprs_weight`.

```typescript
// CES-FE's actual ScopeExclusion shape (from src/features/mpt/types.ts)
export interface ScopeExclusion {
  requirement_id: string;   // e.g., "AC.L2-3.1.18"
  justification: string;    // e.g., "No mobile devices in CUI enclave per Strategic Intent baseline"
  si_field: string;          // e.g., "mobile_device_presence"
  si_value: string;          // e.g., "no_mobile_devices"
}
```

**Stamper must derive the two missing fields:**

- **`nist_ref`**: Strip the family prefix before the hyphen from `requirement_id`. Example: `"AC.L2-3.1.18"` -> `"3.1.18"`.
- **`sprs_weight`**: Look up the NIST ref in the canonical ces-shared `sprs-weights.json` (FX2-ST1).

Zod schema for Stamper's ingestion (to be added to `ces-artifacts.types.ts`):

```typescript
import { z } from 'zod';

// Matches what CES-FE actually emits
export const CESScopeExclusionSchema = z.object({
  requirement_id: z.string().min(1),        // e.g., "AC.L2-3.1.18"
  justification: z.string().min(1),         // e.g., "No mobile devices in CUI enclave..."
  si_field: z.string().min(1),              // e.g., "mobile_device_presence"
  si_value: z.string().min(1),              // e.g., "no_mobile_devices"
});

export type CESScopeExclusion = z.infer<typeof CESScopeExclusionSchema>;

// Stamper-enriched version after derivation
export interface EnrichedScopeExclusion extends CESScopeExclusion {
  nist_ref: string;                         // derived: requirement_id split on '-', take suffix
  sprs_weight: 1 | 3 | 5;                  // derived: looked up from sprs-weights.json
}
```

### Example Payload

```json
{
  "scope_exclusions": [
    {
      "requirement_id": "AC.L2-3.1.18",
      "justification": "No mobile devices in CUI enclave per Strategic Intent baseline",
      "si_field": "mobile_device_presence",
      "si_value": "no_mobile_devices"
    },
    {
      "requirement_id": "AC.L2-3.1.19",
      "justification": "No mobile devices in CUI enclave per Strategic Intent baseline",
      "si_field": "mobile_device_presence",
      "si_value": "no_mobile_devices"
    },
    {
      "requirement_id": "MP.L2-3.8.5",
      "justification": "Removable media prohibited by policy and technical control per Strategic Intent baseline",
      "si_field": "removable_media_posture",
      "si_value": "blocked"
    }
  ]
}
```

---

## 3. PlanTranslator Changes

**File:** `src/translators/PlanTranslator.ts`

### 3.1 Read Scope Exclusions During Translation

The `translate()` method must extract scope exclusions from the parsed mission plan and build a lookup set of excluded `requirement_id` values.

```typescript
// In translate(), after parsing the mission plan:
const scopeExclusions = missionPlan.outputs.human_readable_mission_plan.scope_exclusions ?? [];
const excludedControlIds = new Set<string>(scopeExclusions.map(se => se.requirement_id));

// Log for operator visibility
if (scopeExclusions.length > 0) {
  console.log(`[PlanTranslator] ${scopeExclusions.length} scope exclusion(s) from SI decisions:`);
  for (const se of scopeExclusions) {
    const nistRef = se.requirement_id.split('-').slice(1).join('-'); // derive nist_ref
    console.log(`  - ${se.requirement_id} (${nistRef}): ${se.justification}`);
  }
}
```

### 3.2 Task Filtering Logic

During task compilation in `translateStep()`, apply these rules:

1. **Skip tasks whose controls are ALL excluded.** If every `control_id` in a step's `control_coverage[]` array is in `excludedControlIds`, the task is omitted from the executable plan entirely.

2. **Keep tasks with mixed in-scope and excluded controls.** If a task covers both excluded and in-scope controls (shared registry entries), keep the task but annotate the excluded controls in the task's `args`.

3. **Log excluded tasks.** Skipped tasks should be recorded in the translation warnings array for operator review.

```typescript
// New interface for the annotation (nist_ref derived by Stamper, not from CES-FE)
interface ScopeExclusionAnnotation {
  requirement_id: string;
  nist_ref: string;         // derived: requirement_id.split('-').slice(1).join('-')
  justification: string;
  si_field: string;
}

// In the task compilation loop:
const stepControlIds = step.control_coverage.map(cc => cc.control_id);
const excludedOnThisStep = stepControlIds.filter(cid => excludedControlIds.has(cid));
const inScopeOnThisStep = stepControlIds.filter(cid => !excludedControlIds.has(cid));

if (excludedOnThisStep.length === stepControlIds.length) {
  // ALL controls on this task are excluded — skip the task entirely
  warnings.push(
    `SCOPE_EXCLUSION: Task "${step.id}" (${step.title}) skipped — ` +
    `all ${stepControlIds.length} control(s) are out of scope: ${excludedOnThisStep.join(', ')}`
  );
  continue; // Do not call translateStep for this task
}

if (excludedOnThisStep.length > 0) {
  // SOME controls excluded — annotate the task after building it
  const annotations: ScopeExclusionAnnotation[] = excludedOnThisStep.map(cid => {
    const se = scopeExclusions.find(s => s.requirement_id === cid)!;
    return {
      requirement_id: se.requirement_id,
      nist_ref: se.requirement_id.split('-').slice(1).join('-'), // derived
      justification: se.justification,
      si_field: se.si_field,
    };
  });
  // After translateStep returns, add to args:
  // task.action.args._scope_excluded_controls = annotations;
}
```

### 3.3 Pass Exclusions to Executable Plan Variables

The scope exclusions must be available to downstream consumers (CmmcComplianceAnalyzer, SprsCalculator). Store the full array in the plan's `variables` block:

```typescript
// In the plan assembly section of translate():
const plan: ExecutablePlan = {
  // ... existing fields ...
  variables: {
    ...variables,
    _scope_exclusions: scopeExclusions,
    // ... other existing variable fields ...
  },
};
```

### 3.4 CESHumanPlanSchema Update

The Zod schema for the human-readable plan must accept the new optional field:

```typescript
// Update CESHumanPlanSchema in ces-artifacts.types.ts:
export const CESHumanPlanSchema = z.object({
  plan_id: z.string().min(1),
  plan_mode: CESPlanModeEnum,
  target_level: CESLevelEnum,
  milestones: z.array(CESMilestoneSchema).min(1),
  steps: z.array(CESManualStepSchema).min(1),
  assessor_alignment_notes: z.array(z.string()),
  boundary_context: z.record(z.any()).optional(),
  scope_exclusions: z.array(CESScopeExclusionSchema).optional(),  // NEW
});
```

---

## 4. CmmcComplianceAnalyzer Changes

**File:** `src/core/CmmcComplianceAnalyzer.ts`

### 4.1 New Constructor Parameter

Accept `scope_exclusions` as an optional constructor parameter alongside the existing `excludedEntryIds`.

```typescript
// Stamper's enriched version — nist_ref and sprs_weight derived at ingestion time
export interface ScopeExclusion {
  requirement_id: string;
  justification: string;
  si_field: string;
  si_value: string;
  nist_ref: string;       // derived: requirement_id.split('-').slice(1).join('-')
  sprs_weight: number;    // derived: looked up from sprs-weights.json
}

export class CmmcComplianceAnalyzer {
  // ... existing fields ...
  private scopeExclusions: Map<string, ScopeExclusion>;

  constructor(
    registries: CommandRegistry[],
    planControlIds: string[] | null,
    discoveryResults: Map<string, DiscoveryResult | string>,
    excludedEntryIds?: Set<string>,
    evidenceDir?: string,
    scopeExclusions?: ScopeExclusion[]  // NEW PARAMETER
  ) {
    // ... existing initialization ...
    this.scopeExclusions = new Map();
    if (scopeExclusions) {
      for (const se of scopeExclusions) {
        this.scopeExclusions.set(se.requirement_id, se);
        // Also index by nist_ref for L1/L2 variant matching
        // e.g., both "AC.L2-3.1.18" and "AC.L1-3.1.18" should match
      }
    }
  }
}
```

### 4.2 Scope Check in analyze()

At the top of the control iteration loop in `analyze()`, check scope exclusions before evaluating registry entries. Scope exclusion takes precedence over registry-entry-level exclusion.

```typescript
// In analyze(), at the start of the for-of loop over reference.controls:
for (const control of this.reference.controls) {
  // CHECK 1: SI-driven scope exclusion (control-level, takes precedence)
  const scopeEx = this.scopeExclusions.get(control.control_id)
    || this.scopeExclusions.get(`${control.family}.L2-${control.nist_ref}`);

  if (scopeEx) {
    const status: ControlStatus = {
      control,
      category: 'out_of_scope',
      automationType: 'nonstack',
      registryEntryCount: 0,
      discoveredCount: 0,
      missingCount: 0,
      inPlan: false,
      reason: `SI scope exclusion: ${scopeEx.justification}`,
      registryEntryDetails: []
    };
    outOfScope.push(status);
    continue;
  }

  // CHECK 2: Existing registry-entry-level exclusion (infrastructure_model)
  const registryEntries = this.findRegistryEntries(control);
  // ... remainder of existing logic unchanged ...
}
```

### 4.3 Impact on Family Breakdowns

No changes needed. The existing `outOfScope` counter in `FamilyStatus` already increments correctly for controls pushed to the `outOfScope` array. The key behavioral guarantee: `out_of_scope` controls do NOT count as `wont_be_satisfied`. This is already the case in the current implementation since `outOfScope` and `wontBeSatisfied` are separate arrays that feed separate counters.

### 4.4 Updated ControlStatus Reason Format

For scope-excluded controls, the `reason` field must include the justification string so downstream consumers (compliance reports, SPRS deduction reports) can display it without needing access to the original `scope_exclusions` array.

Convention: `reason` starts with `"SI scope exclusion: "` prefix, followed by the justification text. Consumers can parse this prefix to distinguish SI-driven exclusions from infrastructure-model exclusions (which use `"Infrastructure tier excluded by tenant enclave model"`).

---

## 5. SPRS Integration

**Files:** `src/eo/sprs/SprsCalculator.ts`, `src/shared/types/sprs.types.ts`, `src/shared/types/controls.types.ts`

### 5.1 New `not_applicable` ControlStatus

The EO `ControlStatus` type currently supports four values: `'met' | 'not_met' | 'partial' | 'not_assessed'`. A fifth value is required.

```typescript
// In controls.types.ts:
export type ControlStatus = 'met' | 'not_met' | 'partial' | 'not_assessed' | 'not_applicable';
```

### 5.2 SprsCalculator: N/A = Zero Deduction

Per the DoD Assessment Methodology v1.2.1, controls that are "Not Applicable" due to the system's operational environment receive no SPRS deduction. The assessor must validate the N/A justification, but the scoring impact is zero.

```typescript
// In SprsCalculator.calculate(), add case before the existing switch:
for (const weightEntry of this.weights.controls) {
  const assessment = controlMap.get(weightEntry.nist_ref);
  const status = assessment?.status ?? 'not_assessed';

  switch (status) {
    case 'not_applicable':
      // N/A controls contribute zero deduction.
      // Track for reporting but do not subtract from score.
      notApplicable++;
      break;

    case 'met':
      met++;
      break;

    // ... existing cases unchanged ...
  }
}
```

### 5.3 Updated SprsResult Interface

```typescript
export interface SprsResult {
  score: number;
  maxScore: 110;
  controlsMet: number;
  controlsNotMet: number;
  controlsPartial: number;
  controlsNotAssessed: number;
  controlsNotApplicable: number;             // NEW
  deductions: SprsDeduction[];
  notApplicableControls: SprsNotApplicable[]; // NEW — for assessor transparency
  partialCredits: SprsPartialCredit[];
  poamEligible: boolean;
  poamBlockers: string[];
  poamCandidates: PoamCandidate[];
  certificationPath: 'full' | 'conditional' | 'blocked';
}

// NEW type for N/A reporting
export interface SprsNotApplicable {
  nist_ref: string;
  control_id: string;
  weight: number;            // original weight (1, 3, or 5) from sprs-weights.json — deduction is 0
  justification: string;     // from CES-FE scope_exclusion.justification
  si_field: string;
  si_value: string;
}
```

### 5.4 Justification Flow

The justification string from CES-FE's `scope_exclusions` must reach the SPRS deductions report. The data flow:

```
CES-FE scope_exclusions[].justification
  -> ExecutablePlan variables._scope_exclusions
  -> CmmcComplianceAnalyzer ControlStatus.reason ("SI scope exclusion: ...")
  -> StatusTranslator maps out_of_scope -> not_applicable ControlAssessment
  -> SprsCalculator receives ControlAssessment with not_applicable status
  -> SprsResult.notApplicableControls[] includes justification
```

The `StatusTranslator` (in EO at `src/eo/mapping/StatusTranslator.ts`) must be updated to:
1. Accept the scope exclusions array as context.
2. When an analyzer `ControlStatus.category === 'out_of_scope'`, map to `ControlAssessment.status = 'not_applicable'`.
3. Attach the justification string as `ControlAssessment.implementation_narrative`.

### 5.5 POA&M Generator

Controls with `not_applicable` status must be excluded from POA&M generation entirely. They are not deficient -- they are irrelevant to the system boundary.

```typescript
// In PoamGenerator, filter out N/A controls before generating POA&M items:
const actionableControls = assessments.filter(a => a.status !== 'not_applicable');
```

---

## 6. Evidence and Compliance Reporting

### 6.1 Scoped Out Controls Report Section

The compliance report generator must include a dedicated section titled **"Scoped Out Controls"** that lists all controls excluded by SI decisions. This section is critical for assessor review.

Each entry must display:

| Field | Source | Purpose |
|---|---|---|
| Control ID | `scope_exclusion.requirement_id` | Identifies the NIST requirement |
| Requirement Text | CMMC reference data `practice` field | Shows what the control requires |
| SI Justification | `scope_exclusion.justification` | Explains why N/A |
| SI Decision Field | `scope_exclusion.si_field` | Traceable to SI question bank |
| SPRS Weight | Derived from `sprs-weights.json` via `nist_ref` | Shows the avoided deduction |
| SPRS Deduction | Always `0` | Confirms no scoring penalty |

### 6.2 Assessor Transparency Requirements

CMMC assessors will challenge unjustified N/A claims. The justification must meet these criteria:

1. **Specific** -- not "N/A" or "does not apply" but a concrete architectural fact.
2. **Verifiable** -- tied to a specific SI decision that can be validated during assessment.
3. **Consistent** -- the exclusion logic in CES-FE must be deterministic (same SI answers always produce the same exclusions).

CES-FE is responsible for generating justifications that meet these criteria. Stamper is responsible for preserving and surfacing them faithfully.

### 6.3 Report Output Format

```json
{
  "scoped_out_controls": [
    {
      "control_id": "AC.L2-3.1.18",
      "nist_ref": "3.1.18",
      "practice": "Control connection of mobile devices.",
      "justification": "No mobile devices in CUI enclave per Strategic Intent baseline",
      "si_decision": {
        "field": "mobile_device_presence",
        "value": "no_mobile_devices"
      },
      "sprs_impact": {
        "weight": 3,
        "deduction": 0,
        "note": "Not Applicable per DoD Assessment Methodology v1.2.1"
      }
    }
  ]
}
```

---

## 7. Validation Rules

### 7.1 Non-Excludable Controls

Certain NIST 800-171 controls are fundamental to any CUI-processing system and cannot be excluded regardless of SI decisions. Stamper must reject scope exclusions that target these controls.

```typescript
/**
 * Controls that can NEVER be excluded from scope.
 * These are foundational access control, identification, and audit controls
 * that apply to every CUI-processing system regardless of architecture.
 */
export const NEVER_EXCLUDABLE_NIST_REFS: ReadonlySet<string> = new Set([
  // Access Control fundamentals
  '3.1.1',   // Limit system access to authorized users
  '3.1.2',   // Limit system access to authorized transactions/functions
  '3.1.3',   // Control CUI flow per authorizations
  '3.1.5',   // Employ least privilege
  '3.1.20',  // Verify/control connections to external systems (POA&M-prohibited)
  '3.1.22',  // Control CUI posted on publicly accessible systems (POA&M-prohibited)

  // Identification & Authentication fundamentals
  '3.5.1',   // Identify system users
  '3.5.2',   // Authenticate users/devices/processes

  // Audit fundamentals
  '3.3.1',   // Create and retain audit logs
  '3.3.2',   // Ensure individual accountability

  // Security Assessment
  '3.12.4',  // Develop and update system security plans (POA&M-prohibited)

  // Physical protection
  '3.10.3',  // Escort visitors (POA&M-prohibited)
  '3.10.4',  // Maintain audit logs of physical access (POA&M-prohibited)
  '3.10.5',  // Control physical access to output devices (POA&M-prohibited)
]);
```

### 7.2 Known SI Field/Value Pairs

Stamper must validate that `si_field` and `si_value` come from a known set. Unknown combinations indicate either a CES-FE version mismatch or data corruption.

```typescript
/**
 * Allowed (si_field, si_value) combinations and the controls they can exclude.
 * This is the single source of truth for scope exclusion eligibility.
 */
export const SCOPE_EXCLUSION_RULES: ReadonlyArray<{
  si_field: string;
  si_value: string;
  allowed_nist_refs: string[];
  description: string;
}> = [
  {
    si_field: 'mobile_device_presence',
    si_value: 'no_mobile_devices',
    allowed_nist_refs: ['3.1.18', '3.1.19'],
    description: 'No mobile devices in CUI enclave',
  },
  {
    si_field: 'wireless_posture',
    si_value: 'no_wireless',
    allowed_nist_refs: ['3.1.14', '3.1.16'],
    description: 'No wireless networks in CUI boundary',
  },
  {
    si_field: 'removable_media_posture',
    si_value: 'blocked',
    allowed_nist_refs: ['3.8.5', '3.8.6'],
    description: 'Removable media blocked organization-wide',
  },
  {
    si_field: 'remote_access_posture',
    si_value: 'no_remote',
    allowed_nist_refs: ['3.1.12', '3.10.6'],
    description: 'No remote access to CUI systems',
  },
  {
    si_field: 'maintenance_posture',
    si_value: 'no_nonlocal',
    allowed_nist_refs: ['3.7.4'],
    description: 'No nonlocal maintenance of CUI systems',
  },
];
```

### 7.3 Validation Function

```typescript
export interface ScopeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateScopeExclusions(
  exclusions: CESScopeExclusion[],
  sprsWeights: Map<string, number>  // loaded from sprs-weights.json
): ScopeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const se of exclusions) {
    // Derive nist_ref from requirement_id (CES-FE does not emit nist_ref)
    const nistRef = se.requirement_id.split('-').slice(1).join('-');

    // Rule 1: Non-excludable control check
    if (NEVER_EXCLUDABLE_NIST_REFS.has(nistRef)) {
      errors.push(
        `INVALID_EXCLUSION: ${se.requirement_id} (${nistRef}) is a fundamental control ` +
        `and cannot be excluded from scope.`
      );
      continue;
    }

    // Rule 2: Known SI field/value pair check
    const matchingRule = SCOPE_EXCLUSION_RULES.find(
      r => r.si_field === se.si_field && r.si_value === se.si_value
    );
    if (!matchingRule) {
      errors.push(
        `UNKNOWN_SI_DECISION: ${se.requirement_id} references unknown ` +
        `si_field="${se.si_field}" / si_value="${se.si_value}". ` +
        `This may indicate a CES-FE version mismatch.`
      );
      continue;
    }

    // Rule 3: Control must be in the allowed list for this SI decision
    if (!matchingRule.allowed_nist_refs.includes(nistRef)) {
      errors.push(
        `INVALID_MAPPING: ${se.requirement_id} (${nistRef}) is not excludable by ` +
        `si_field="${se.si_field}". Allowed controls for this decision: ` +
        `${matchingRule.allowed_nist_refs.join(', ')}.`
      );
      continue;
    }

    // Rule 4: 5-point controls generate a WARNING (weight from sprs-weights.json)
    const weight = sprsWeights.get(nistRef) ?? 0;
    if (weight === 5) {
      warnings.push(
        `HIGH_WEIGHT_EXCLUSION: ${se.requirement_id} (${nistRef}) has SPRS weight 5. ` +
        `Excluding 5-point controls requires strong justification and will be ` +
        `closely scrutinized by assessors. Justification: "${se.justification}"`
      );
    }

    // Rule 5: Verify nist_ref exists in sprs-weights.json (unknown refs are suspicious)
    if (!sprsWeights.has(nistRef)) {
      errors.push(
        `UNKNOWN_NIST_REF: ${se.requirement_id} -> derived nist_ref "${nistRef}" ` +
        `not found in sprs-weights.json. Data may be corrupt.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

### 7.4 `--strict-scope` CLI Flag

A `--strict-scope` CLI flag converts scope exclusion warnings into errors. This flag is intended for assessor-mode runs where any questionable exclusion should halt execution.

```
stamper translate --plan mission-plan.json --manifest tenant-manifest.json --strict-scope
stamper assess --tenant vfsgov --strict-scope
```

When `--strict-scope` is active:
- All validation warnings become errors.
- The 5-point weight warning (Rule 4) becomes a hard error.
- Translation and assessment abort if any scope validation fails.

---

## 8. Discovery and Verification Behavior

### 8.1 Optional Discovery for Excluded Controls

For controls marked as `out_of_scope` via scope exclusions, Stamper should still optionally execute discovery commands (`get_command`) but must NOT execute configuration commands (`set_command`).

Rationale: An excluded control may still be configured on the tenant (defense in depth). Discovery reveals this for informational purposes without affecting compliance scoring.

### 8.2 Implementation in StamperEngine

```typescript
// During task execution:
if (task.action.args._scope_excluded_controls?.length > 0) {
  for (const sub of task.action.args._sub_commands) {
    const isExcludedOnly = /* all controls for this sub are excluded */;
    if (isExcludedOnly) {
      // Run get_command (discovery) only — do NOT run set_command
      if (sub.get_command) {
        const result = await engine.executeDiscovery(sub);
        logger.info(
          `[INFORMATIONAL] Excluded control discovery: ${sub.id} — ` +
          `status: ${result.status} (not scored)`
        );
      }
      continue; // Skip set_command execution
    }
  }
}
```

### 8.3 Verification Scoring Exclusion

In the compliance verification pass (postchecks), excluded controls must be excluded from pass/fail calculations:

- Discovery results for excluded controls are logged as `informational`.
- If an excluded control IS configured (status: `exists`), this is logged positively but does not change its `out_of_scope` classification.
- If an excluded control is NOT configured (status: `missing`), this is expected and not flagged as a deficiency.
- Excluded controls do not count toward the `satisfied` / `wont_be_satisfied` totals.

---

## 9. Data Flow Diagram

```
CES-FE (Planner)                              Stamper
┌───────────────────┐                         ┌─────────────────────────────────┐
│                   │                         │                                 │
│  SI Question Bank │                         │  PlanTranslator.translate()     │
│        |          │                         │    |                            │
│        v          │                         │    ├─ Validate scope_exclusions │
│  Gap Compiler     │   scope_exclusions[]    │    ├─ Build excludedControlIds  │
│        |          │──────────────────────►   │    ├─ Skip fully-excluded tasks│
│        v          │   in Mission Plan JSON  │    └─ Annotate mixed tasks     │
│  Manual Mission   │                         │                                 │
│  Plan Artifact    │                         │  CmmcComplianceAnalyzer         │
│                   │                         │    ├─ out_of_scope category     │
└───────────────────┘                         │    ├─ SI justification in reason│
                                              │    └─ Excluded from wont_be    │
                                              │                                 │
                                              │  SprsCalculator                 │
                                              │    ├─ not_applicable status     │
                                              │    ├─ Zero deduction            │
                                              │    └─ justification in report   │
                                              │                                 │
                                              │  PoamGenerator                  │
                                              │    └─ N/A controls excluded     │
                                              │                                 │
                                              │  ComplianceReport               │
                                              │    └─ "Scoped Out Controls"     │
                                              │       section with full detail  │
                                              └─────────────────────────────────┘
```

---

## 10. Migration and Backward Compatibility

### 10.1 Schema Evolution

The `scope_exclusions` field on `CESHumanPlanSchema` is optional (`z.array(...).optional()`). Mission plans generated before this feature will have no `scope_exclusions` field, and Stamper will behave identically to today -- no controls excluded, no validation performed.

### 10.2 Relationship to `excludedEntryIds`

The existing `excludedEntryIds` mechanism (infrastructure-model enclave filtering) and the new `scope_exclusions` mechanism operate at different levels and are complementary:

| Mechanism | Level | Source | Effect |
|---|---|---|---|
| `excludedEntryIds` | Registry entry | `infrastructure_model` in tenant config | Removes specific registry entries; control may still be partially covered |
| `scope_exclusions` | NIST control | SI decisions in mission plan | Removes entire controls from scope; all registry entries for that control are irrelevant |

Both can be active simultaneously. Scope exclusions take precedence -- if a control is in `scope_exclusions`, it is `out_of_scope` regardless of whether its registry entries would survive the `excludedEntryIds` filter.

### 10.3 EO Merge Considerations

When EO modules merge into Stamper as `src/assessor/`:

1. The `ControlStatus` type gains `'not_applicable'` -- a breaking change for switch statements that exhaustively match on `ControlStatus`. All consumers must add a `case 'not_applicable':` branch.

2. The `SprsResult` interface gains `controlsNotApplicable` and `notApplicableControls` -- additive, non-breaking.

3. The `StatusTranslator` must be updated to map Stamper's `out_of_scope` category to the `not_applicable` ControlStatus before passing to SprsCalculator.

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Test | File | Description |
|---|---|---|
| Validation rejects non-excludable controls | `scope-validation.test.ts` | Attempt to exclude 3.1.1, 3.5.1, etc. -- expect errors |
| Validation accepts valid exclusions | `scope-validation.test.ts` | Exclude 3.1.18 via `mobile_device_presence` -- expect valid |
| Validation warns on 5-point exclusions | `scope-validation.test.ts` | Exclude a 5-point control -- expect warning |
| `--strict-scope` promotes warnings to errors | `scope-validation.test.ts` | Same 5-point case with strict flag -- expect error |
| Unknown si_field rejected | `scope-validation.test.ts` | Unknown field/value pair -- expect error |
| PlanTranslator skips fully-excluded tasks | `PlanTranslator.test.ts` | Task with all controls excluded -- expect omitted from output |
| PlanTranslator keeps mixed tasks | `PlanTranslator.test.ts` | Task with 1 excluded + 1 in-scope control -- expect kept with annotation |
| CmmcComplianceAnalyzer classifies as out_of_scope | `CmmcComplianceAnalyzer.test.ts` | Excluded control -- expect `out_of_scope` category |
| SPRS score unaffected by N/A controls | `SprsCalculator.test.ts` | 3 controls N/A -- expect score = 110 minus only non-N/A deductions |
| POA&M excludes N/A controls | `PoamGenerator.test.ts` | N/A control not_met -- expect no POA&M item |

### 11.2 Integration Tests

| Test | Description |
|---|---|
| End-to-end translation with scope exclusions | Full translate pipeline with 3 scope exclusions -- verify task count, warnings, plan variables |
| Compliance analysis with scope exclusions | Assess pipeline with excluded controls -- verify family breakdown totals |
| SPRS scoring with mixed statuses | Combination of met, not_met, partial, not_applicable -- verify final score |

---

## 12. Implementation Order

| Phase | Component | Effort | Dependencies |
|---|---|---|---|
| **Phase 1** | CES-FE: Add `scope_exclusions` to gap compiler output | 1 day | SI question bank updates |
| **Phase 2** | Stamper: `CESScopeExclusionSchema` + validation rules | 0.5 day | None |
| **Phase 3** | Stamper: `PlanTranslator` scope filtering | 1 day | Phase 2 |
| **Phase 4** | Stamper: `CmmcComplianceAnalyzer` scope parameter | 0.5 day | Phase 2 |
| **Phase 5** | EO: `ControlStatus` + `SprsCalculator` N/A support | 1 day | Phase 2 |
| **Phase 6** | EO: `PoamGenerator` N/A exclusion | 0.5 day | Phase 5 |
| **Phase 7** | Stamper: Compliance report "Scoped Out" section | 0.5 day | Phase 4 |
| **Phase 8** | Stamper: `--strict-scope` CLI flag | 0.5 day | Phase 2 |
| **Phase 9** | Discovery informational mode for excluded controls | 1 day | Phase 3 |
| **Phase 10** | Full integration testing | 1 day | All above |

Total estimated effort: **7.5 days**

---

## Appendix A: SPRS Weight Reference for Excludable Controls

Cross-reference of controls that CES-FE may exclude, with their SPRS weights from `sprs-weights.json`:

| NIST Ref | Control ID | Weight | POA&M Allowed | Excludable By |
|---|---|---|---|---|
| 3.1.12 | AC.L2-3.1.12 | 5 | No | `remote_access_posture` |
| 3.1.14 | AC.L2-3.1.14 | 5 | No | `wireless_posture` |
| 3.1.16 | AC.L2-3.1.16 | 1 | Yes | `wireless_posture` |
| 3.1.18 | AC.L2-3.1.18 | 3 | No | `mobile_device_presence` |
| 3.1.19 | AC.L2-3.1.19 | 3 | No | `mobile_device_presence` |
| 3.7.4  | MA.L2-3.7.4  | 3 | No | `maintenance_posture` |
| 3.8.5  | MP.L2-3.8.5  | 3 | No | `removable_media_posture` |
| 3.8.6  | MP.L2-3.8.6  | 3 | No | `removable_media_posture` |
| 3.10.6 | PE.L2-3.10.6 | 1 | Yes | `remote_access_posture` |

**Note:** AC.L2-3.1.15 is NOT in this table. CES-FE does not exclude 3.1.15 via any single SI rule. It would only be excludable when both `mobile_device_presence = no_mobile_devices` AND `wireless_posture = no_wireless`, but CES-FE does not implement that combined exclusion.

**Maximum SPRS impact of full exclusion:** If all 9 controls above are excluded, the effective maximum possible deduction drops from 110 to 83 points (27 points of weight removed from the denominator). This is significant and underscores the importance of assessor-validated justifications.

---

## Appendix B: Assessor FAQ

**Q: Can an organization claim N/A for mobile device controls while using corporate phones?**
A: No. "No mobile devices" means no smartphones, tablets, or other mobile endpoints access CUI data within the enclave boundary. If corporate phones access Exchange Online or Teams with CUI, the mobile controls are in scope.

**Q: What if the organization adds mobile devices later?**
A: The SI baseline must be regenerated in CES-FE. This produces a new mission plan without the scope exclusions. Stamper will then include those controls in the next assessment run.

**Q: How does this interact with the POA&M conditional certification path?**
A: N/A controls are invisible to the POA&M system. They neither block nor enable conditional certification. A customer with 3 N/A controls and 2 unmet 1-point controls would have an SPRS score based on the remaining 107 applicable controls, with POA&M eligibility determined solely by the unmet controls.
