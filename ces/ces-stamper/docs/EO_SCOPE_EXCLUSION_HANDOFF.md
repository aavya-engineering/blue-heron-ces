# EO Phase 2: Scope Exclusion Integration Spec

**Author:** Stamper Engineering
**Status:** Ready for EO Implementation
**Date:** 2026-03-23
**Depends on:** Stamper commit `8e73485` (Phase 1 — scope exclusion types, validation, PlanTranslator, CmmcComplianceAnalyzer)

---

## What Phase 1 Already Provides

Stamper Phase 1 (already merged) delivers:

1. **`CESScopeExclusion` type** and **`EnrichedScopeExclusion` interface** in `src/types/ces-artifacts.types.ts`
2. **`sprs-weights.json`** at `ces-shared/src/data/sprs-weights.json` (canonical, `sprs-weights/2.0.0`; Stamper's local copy was removed in FX2-ST1) — all 110 NIST controls with `nist_ref`, `weight` (1|3|5), and `poam_allowed` (boolean)
3. **`ScopeExclusionValidator`** at `src/core/ScopeExclusionValidator.ts` — exports `loadSprsWeights()`, `validateScopeExclusions()`, `enrichScopeExclusions()`, `NEVER_EXCLUDABLE_NIST_REFS`, `SCOPE_EXCLUSION_RULES`
4. **PlanTranslator** stores enriched exclusions in `plan.variables._scope_exclusions` (array of `EnrichedScopeExclusion`)
5. **CmmcComplianceAnalyzer** classifies excluded controls as `category: 'out_of_scope'` with `reason: "SI scope exclusion: <justification>"`

### Data Available to EO

The executable plan's `variables._scope_exclusions` array contains:

```typescript
interface EnrichedScopeExclusion {
  requirement_id: string;   // "AC.L2-3.1.18"
  justification: string;    // "No mobile devices in CUI enclave per Strategic Intent baseline"
  si_field: string;         // "mobile_device_presence"
  si_value: string;         // "no_mobile_devices"
  nist_ref: string;         // "3.1.18" (derived)
  sprs_weight: 1 | 3 | 5;  // 3 (derived from sprs-weights.json)
}
```

CmmcComplianceAnalyzer output includes `outOfScope[]` array with `ControlStatus` entries where:
- `category === 'out_of_scope'`
- `reason` starts with `"SI scope exclusion: "` (prefix distinguishes from infrastructure-model exclusions which use `"Infrastructure tier excluded by tenant enclave model"`)

---

## What EO Must Implement (Items 4-8)

### Item 4: `not_applicable` ControlStatus + StatusTranslator Mapping

**File to create/modify:** `src/shared/types/controls.types.ts` (or wherever EO defines its ControlStatus)

Add `'not_applicable'` to the ControlStatus union:

```typescript
export type ControlStatus = 'met' | 'not_met' | 'partial' | 'not_assessed' | 'not_applicable';
```

**Breaking change:** All exhaustive switch statements on `ControlStatus` must add `case 'not_applicable':`. Search for `switch.*status` in all EO files.

**File to create/modify:** `src/eo/mapping/StatusTranslator.ts`

Map Stamper's CmmcComplianceAnalyzer `ControlStatus.category` to EO's `ControlAssessment`:

| Analyzer category | EO ControlStatus | Notes |
|---|---|---|
| `satisfied` | `met` | Already implemented |
| `will_be_satisfied` | `partial` | Already implemented |
| `wont_be_satisfied` | `not_met` | Already implemented |
| `not_verified` | `not_met` | **FX2-ST2 (2026-09-27)** — planned by a directive but not proven by a tenant read or a recorded real post-state; never `met`. Earlier Stamper builds reported these as `satisfied` (overclaim). |
| `out_of_scope` | `not_applicable` | **NEW** — map when reason starts with "SI scope exclusion:" |

When mapping `out_of_scope` → `not_applicable`:
- Set `ControlAssessment.status = 'not_applicable'`
- Set `ControlAssessment.implementation_narrative = controlStatus.reason` (preserves the full "SI scope exclusion: ..." justification)
- The justification string must flow all the way to the SPRS report for assessor transparency

### Item 5: SprsCalculator Zero Deduction

**File:** `src/eo/sprs/SprsCalculator.ts`

In the scoring loop where each control's status is evaluated:

```typescript
switch (status) {
  case 'not_applicable':
    // N/A controls contribute zero deduction per DoD Assessment Methodology v1.2.1
    notApplicable++;
    notApplicableControls.push({
      nist_ref: weightEntry.nist_ref,
      control_id: /* derive from nist_ref */,
      weight: weightEntry.weight,         // original weight (1, 3, or 5) — NOT the deduction
      justification: assessment.implementation_narrative || '',
      si_field: /* extract from _scope_exclusions if available */,
      si_value: /* extract from _scope_exclusions if available */,
    });
    break;  // No subtraction from score

  case 'met':
    met++;
    break;

  // ... existing cases unchanged ...
}
```

**Key rule:** N/A controls do NOT subtract from the score. They do NOT count toward `controlsNotMet`. They appear in a separate `notApplicableControls[]` array for assessor transparency.

**Updated SprsResult interface:**

```typescript
export interface SprsResult {
  score: number;
  maxScore: 110;
  controlsMet: number;
  controlsNotMet: number;
  controlsPartial: number;
  controlsNotAssessed: number;
  controlsNotApplicable: number;              // NEW
  deductions: SprsDeduction[];
  notApplicableControls: SprsNotApplicable[];  // NEW
  partialCredits: SprsPartialCredit[];
  poamEligible: boolean;
  poamBlockers: string[];
  poamCandidates: PoamCandidate[];
  certificationPath: 'full' | 'conditional' | 'blocked';
}

// NEW type
export interface SprsNotApplicable {
  nist_ref: string;
  control_id: string;
  weight: number;          // original weight — deduction is always 0
  justification: string;   // from scope_exclusion.justification
  si_field: string;
  si_value: string;
}
```

**SPRS math verification:** If all 9 CES-FE-excludable controls are N/A, 27 points of weight are removed from the effective denominator (5+5+1+3+3+3+3+3+1 = 27). The score is still calculated against 110 max, but the maximum possible deduction drops to 83.

### Item 6: PoamGenerator N/A Exclusion

**File:** `src/eo/poam/PoamGenerator.ts`

Filter out `not_applicable` controls before generating POA&M items:

```typescript
// At the top of the POA&M generation function:
const actionableControls = assessments.filter(a => a.status !== 'not_applicable');
// Use actionableControls instead of assessments for all POA&M logic below
```

**Key rule:** N/A controls are not deficient — they are irrelevant to the system boundary. They must never appear as POA&M items. An assessor seeing an N/A control in a POA&M would flag it as a finding.

### Item 7: Compliance Report "Scoped Out Controls" Section

**File:** Wherever the compliance report is generated (HTML/JSON/PDF)

Add a dedicated section titled **"Scoped Out Controls"** that lists all scope-excluded controls. This section is critical for assessor review.

Each entry must display:

| Field | Source | Example |
|---|---|---|
| Control ID | `enrichedExclusion.requirement_id` | AC.L2-3.1.18 |
| NIST Ref | `enrichedExclusion.nist_ref` | 3.1.18 |
| Requirement Text | CMMC reference `practice` field | "Control connection of mobile devices." |
| SI Justification | `enrichedExclusion.justification` | "No mobile devices in CUI enclave per Strategic Intent baseline" |
| SI Decision | `enrichedExclusion.si_field` / `si_value` | mobile_device_presence = no_mobile_devices |
| SPRS Weight | `enrichedExclusion.sprs_weight` | 3 |
| SPRS Deduction | Always `0` | 0 |

**Data source:** `plan.variables._scope_exclusions` (array of `EnrichedScopeExclusion`)

**JSON output format:**

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

### Item 8: Discovery Informational Mode (Optional)

**File:** Execution engine / TaskRunner

For controls marked as out_of_scope via scope exclusions, Stamper should optionally run `get_command` (discovery) but must NOT run `set_command` (configuration).

Detection: check `task.action.args._scope_excluded_controls` on executable plan tasks. If present and all controls for a sub-command are excluded:
- Run `get_command` only (informational)
- Log result as `[INFORMATIONAL] Excluded control discovery: {sub.id} — status: {result}`
- Do NOT run `set_command`
- Do NOT count toward pass/fail/skip tallies
- If the excluded control IS configured (exists), log positively but don't change its `out_of_scope` classification

---

## Validation Rules Reference

The following constants are exported from `src/core/ScopeExclusionValidator.ts` and can be imported by EO:

```typescript
import {
  NEVER_EXCLUDABLE_NIST_REFS,    // Set<string> — 14 controls
  SCOPE_EXCLUSION_RULES,          // Array — 5 SI rules
  loadSprsWeights,                // () => Map<string, {weight, poam_allowed}>
  validateScopeExclusions,        // (exclusions, weights, strict) => {valid, errors, warnings}
  enrichScopeExclusions,          // (exclusions, weights) => EnrichedScopeExclusion[]
} from '../../core/ScopeExclusionValidator';

import {
  CESScopeExclusion,
  EnrichedScopeExclusion,
} from '../../types/ces-artifacts.types';
```

---

## Testing Requirements

| Test | File | Description |
|---|---|---|
| StatusTranslator maps out_of_scope → not_applicable | `StatusTranslator.test.ts` | ControlStatus with category='out_of_scope' and reason="SI scope exclusion: ..." maps to not_applicable with justification in narrative |
| SprsCalculator N/A = zero deduction | `SprsCalculator.test.ts` | 3 controls N/A (3.1.18, 3.1.19, 3.8.5) → score = 110 minus only non-N/A deductions, controlsNotApplicable=3 |
| SprsCalculator N/A tracking | `SprsCalculator.test.ts` | notApplicableControls[] has 3 entries with correct weight, justification, si_field |
| POA&M excludes N/A | `PoamGenerator.test.ts` | Control with not_applicable status never appears in POA&M items |
| POA&M includes not_met alongside N/A | `PoamGenerator.test.ts` | Mix of not_met and not_applicable — only not_met appear in POA&M |
| Report section renders all excluded | `ComplianceReport.test.ts` | 3 excluded controls → "Scoped Out Controls" section has 3 entries with all fields |
| End-to-end scoring | `integration.test.ts` | Full pipeline: 3 N/A + 2 not_met (weight 3 each) → SPRS score = 110 - 6 = 104, not 110 - 6 - 9 = 95 |

---

## Appendix: Excludable Controls Quick Reference

| nist_ref | control_id | weight | poam_allowed | SI rule |
|---|---|---|---|---|
| 3.1.12 | AC.L2-3.1.12 | 5 | false | remote_access_posture=no_remote |
| 3.1.14 | AC.L2-3.1.14 | 5 | false | wireless_posture=no_wireless |
| 3.1.16 | AC.L2-3.1.16 | 1 | true | wireless_posture=no_wireless |
| 3.1.18 | AC.L2-3.1.18 | 3 | false | mobile_device_presence=no_mobile_devices |
| 3.1.19 | AC.L2-3.1.19 | 3 | false | mobile_device_presence=no_mobile_devices |
| 3.7.4 | MA.L2-3.7.4 | 3 | false | maintenance_posture=no_nonlocal |
| 3.8.5 | MP.L2-3.8.5 | 3 | false | removable_media_posture=blocked |
| 3.8.6 | MP.L2-3.8.6 | 3 | false | removable_media_posture=blocked |
| 3.10.6 | PE.L2-3.10.6 | 1 | true | remote_access_posture=no_remote |

**Max SPRS impact if all 9 excluded:** 27 points removed from effective denominator (5+5+1+3+3+3+3+3+1).
