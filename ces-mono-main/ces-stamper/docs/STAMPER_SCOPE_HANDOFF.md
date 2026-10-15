# Stamper Scope Exclusion Handoff

## What Changed in CES-FE

CES-FE now emits a `scope_exclusions[]` array on the Manual Mission Plan artifact at `outputs.human_readable_mission_plan.scope_exclusions`. When a customer's Strategic Intent (SI) baseline declares that certain technologies are absent from the CUI enclave (no mobile devices, no wireless, no removable media, no remote access, no nonlocal maintenance), the gap compiler skips those controls entirely -- no gaps are generated, no tasks are created, and no plan steps appear for excluded controls. The exclusion logic is deterministic: identical SI answers always produce identical exclusions.

## Data Contract

Each scope exclusion has exactly **4 fields**. CES-FE does NOT emit `nist_ref` or `sprs_weight` -- Stamper must derive those.

```typescript
interface ScopeExclusion {
  requirement_id: string;   // CMMC control ID, e.g. "AC.L2-3.1.18"
  justification: string;    // Human-readable reason tied to SI decision
  si_field: string;          // SI question field name, e.g. "mobile_device_presence"
  si_value: string;          // SI answer value, e.g. "no_mobile_devices"
}
```

### Deriving missing fields

- **`nist_ref`**: `requirement_id.split('-').slice(1).join('-')` -- e.g. `"AC.L2-3.1.18"` yields `"3.1.18"`
- **`sprs_weight`**: Look up `nist_ref` in the canonical ces-shared `sprs-weights.json`

### Realistic example payload

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
      "requirement_id": "AC.L2-3.1.14",
      "justification": "No wireless networks in CUI enclave per Strategic Intent baseline",
      "si_field": "wireless_posture",
      "si_value": "no_wireless"
    },
    {
      "requirement_id": "AC.L2-3.1.16",
      "justification": "No wireless networks in CUI enclave per Strategic Intent baseline",
      "si_field": "wireless_posture",
      "si_value": "no_wireless"
    },
    {
      "requirement_id": "MP.L2-3.8.5",
      "justification": "Removable media prohibited by policy and technical control per Strategic Intent baseline",
      "si_field": "removable_media_posture",
      "si_value": "blocked"
    },
    {
      "requirement_id": "MP.L2-3.8.6",
      "justification": "Removable media prohibited by policy and technical control per Strategic Intent baseline",
      "si_field": "removable_media_posture",
      "si_value": "blocked"
    },
    {
      "requirement_id": "AC.L2-3.1.12",
      "justification": "No remote access to CUI systems per Strategic Intent baseline",
      "si_field": "remote_access_posture",
      "si_value": "no_remote"
    },
    {
      "requirement_id": "PE.L2-3.10.6",
      "justification": "No remote access to CUI systems per Strategic Intent baseline",
      "si_field": "remote_access_posture",
      "si_value": "no_remote"
    },
    {
      "requirement_id": "MA.L2-3.7.4",
      "justification": "No nonlocal maintenance performed per Strategic Intent baseline",
      "si_field": "maintenance_posture",
      "si_value": "no_nonlocal"
    }
  ]
}
```

### Complete rule table

| `si_field` | `si_value` | Controls excluded |
|---|---|---|
| `mobile_device_presence` | `no_mobile_devices` | 3.1.18, 3.1.19 |
| `wireless_posture` | `no_wireless` | 3.1.14, 3.1.16 |
| `removable_media_posture` | `blocked` | 3.8.5, 3.8.6 |
| `remote_access_posture` | `no_remote` | 3.1.12, 3.10.6 |
| `maintenance_posture` | `no_nonlocal` | 3.7.4 |

**Note:** 3.1.15 is NOT excluded by any single rule. CES-FE does not implement a combined mobile+wireless exclusion for 3.1.15. 3.1.16 is excluded only via the wireless rule, not the mobile rule.

## What Stamper Must Implement

1. **`ces-artifacts.types.ts`** -- Add `CESScopeExclusionSchema` (4-field Zod schema) and `EnrichedScopeExclusion` (adds derived `nist_ref` + `sprs_weight`). Add optional `scope_exclusions` field to `CESHumanPlanSchema`.

2. **`src/translators/PlanTranslator.ts`** -- Read `scope_exclusions` from the mission plan. Build `excludedControlIds` set. Skip tasks whose `control_coverage[]` controls are all excluded. Annotate mixed tasks. Store enriched exclusions in `plan.variables._scope_exclusions`.

3. **`src/core/CmmcComplianceAnalyzer.ts`** -- Accept `scopeExclusions` as a constructor parameter. At the top of the control iteration in `analyze()`, check scope exclusions before evaluating registry entries. Classified excluded controls as `out_of_scope` with `reason: "SI scope exclusion: <justification>"`.

4. **`src/eo/mapping/StatusTranslator.ts`** -- Map `out_of_scope` category to `not_applicable` ControlAssessment status. Attach justification as `implementation_narrative`.

5. **`src/shared/types/controls.types.ts`** -- Add `'not_applicable'` to the `ControlStatus` union type. Update all exhaustive switch statements.

6. **`src/eo/sprs/SprsCalculator.ts`** -- Add `case 'not_applicable':` with zero deduction. Add `controlsNotApplicable` counter and `notApplicableControls[]` to `SprsResult`.

7. **`src/eo/poam/PoamGenerator.ts`** -- Filter out `not_applicable` controls before generating POA&M items.

8. **Compliance report generator** -- Add "Scoped Out Controls" section listing each excluded control with its justification, si_field, derived weight, and zero deduction.

9. **CLI** -- Add `--strict-scope` flag that promotes scope validation warnings to errors.

10. **Validation module** -- Implement `validateScopeExclusions()` with rules for non-excludable controls, known SI field/value pairs, allowed control lists per rule, and 5-point weight warnings.

## Validation Rules

Stamper must validate every scope exclusion before processing:

- **Non-excludable controls**: Reject exclusions targeting fundamental controls (3.1.1, 3.1.2, 3.1.3, 3.5.1, 3.5.2, 3.3.1, 3.3.2, 3.12.4, 3.10.3, 3.10.4, 3.10.5, etc.). Full list in spec Section 7.1.
- **Known SI pairs**: Reject unknown `si_field`/`si_value` combinations -- indicates CES-FE version mismatch.
- **Allowed control mapping**: Reject exclusions where the `nist_ref` is not in the allowed list for the given SI rule.
- **5-point weight warning**: Warn when excluding controls with SPRS weight 5 (3.1.12 and 3.1.14). Under `--strict-scope`, this becomes an error.
- **Unknown NIST ref**: Reject if derived `nist_ref` is not found in `sprs-weights.json`.

## SPRS Impact

Per the DoD Assessment Methodology v1.2.1, controls that are "Not Applicable" due to the system's operational environment receive **zero SPRS deduction**. The assessor must validate the N/A justification, but the scoring impact is zero.

- N/A controls do NOT count toward `controlsNotMet` or appear in `deductions[]`.
- N/A controls DO appear in `notApplicableControls[]` for assessor transparency.
- N/A controls are excluded from POA&M generation entirely.
- Maximum possible impact: if all 9 CES-FE-excludable controls are N/A, 27 points of weight are removed from the effective denominator (5+5+1+3+3+3+3+3+1 = 27).

## Reference

Full specification with code samples, data flow diagrams, testing strategy, and migration notes:

- [`docs/SCOPE_HANDLING_SPEC.md`](./SCOPE_HANDLING_SPEC.md)
