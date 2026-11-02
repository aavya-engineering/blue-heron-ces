# REQ-AO-GUI-EVIDENCE-PANEL-FIELD-MISMATCH

**Filed by:** ces-tester (GP-DEMO-3, M0 drivability spike)
**Date:** 2026-08-29
**Against:** `ces-ao`
**Severity:** MEDIUM — the AdminOps GUI's evidence panel misreports on every execution. One
field reads a property that does not exist; another compares against a value the field can
never hold. Cosmetic in mechanism, but it is the panel an operator reads to decide whether
an admin action produced compliant evidence.
**Status:** OPEN — reproduced live; NOT patched (write boundary).

## Two defects

### 1. `#evidenceVerdict` reads a non-existent property

`displayExecutionResult()` sets `evidenceVerdict.textContent = result.evidence.verdict`.
The evidence object has **no** `verdict` property — the field is `complianceVerdict`. The
panel therefore always falls through to the `'No verdict available'` default, even when a
verdict was produced.

### 2. `#evidenceOutcomeBadge` compares `outcome` to `'SAT'`, which it never equals

The badge does `if (outcome === 'SAT') className = 'outcome-badge sat'; else '... not-sat'`.
But `outcome` is an execution outcome (`automated_success`), not a compliance verdict —
`SAT` is the value of `complianceVerdict`. The comparison can never be true, so a fully
successful, SAT-verdict execution is rendered with the **not-sat** styling.

## Evidence (measured, live A-18 run through the GUI)

Rendered DOM after a successful live execution:

```
#resultStatusBadge    = "SUCCESS"
#evidenceOutcomeBadge = "automated_success"     <- styled not-sat
#evidenceVerdict      = "No verdict available"  <- but a verdict exists
```

The response body the panel was handed, same execution:

```json
"evidence": {
  "outcome": "automated_success",
  "complianceVerdict": "SAT",
  "outcomeRationale": ...,
  "verdictRationale": ...,
  "metadata": { "stateChanged": true, ... }
}
```

So the verdict was `SAT` and the panel said "No verdict available"; the outcome was a
success and the badge was styled as not-satisfied.

### 3. (related, lower severity) `#resultOutput` on an empty-stdout PATCH

`resultOutput` falls back to `'No output available'` when `result.result.stdout` is empty.
For a PATCH-style command the stdout is a bare table header with no rows, so the panel shows
a truncated, meaningless fragment:

```
#resultOutput = "id  allowInvitesFrom  guestUserRoleId  defaultUserRolePermissions"
```

Consumers should not anchor on `#resultOutput`.

## Code path

| File | Line | Detail |
|---|---|---|
| `ces-ao/public/index.html` | 1278 | `evidenceVerdict.textContent = result.evidence.verdict \|\| 'No verdict available'` — `verdict` does not exist |
| `ces-ao/public/index.html` | 1269-1275 | `outcome === 'SAT'` — never true; `outcome` is `automated_success` |
| `ces-ao/public/index.html` | 1255-1262 | `#resultOutput` empty-stdout fallback |
| `ces-ao/public/index.html` | 805 | `#evidenceOutcomeBadge` |

## Suggested fix (for ces-ao to apply — NOT applied by ces-tester)

- Read `result.evidence.complianceVerdict` (with `verdictRationale` as the detail line).
- Badge the **verdict** (`complianceVerdict === 'SAT'`) for sat/not-sat styling, and render
  `outcome` separately as an execution-outcome chip, or map known success outcomes
  (`automated_success`) to the success styling.
- Render a placeholder that names the situation ("command produced no stdout") rather than
  a bare header row.

## Consequence for ces-tester (GP-DEMO-3)

The demo's AO beat asserts only on fields that render correctly — `#resultStatusBadge`
(`SUCCESS`) and `#evidenceOutcomeBadge` (`automated_success`) — and takes every structured
number from the browser's own `/api/execute/A-18` response plus the `ces.db` evidence row.
It does **not** anchor on `#evidenceVerdict` or `#resultOutput`.

## Cross-reference

- `docs/demo/E2E-GROUNDING-EVIDENCE.md` finding #8
- Evidence: `runs/m0-spike/m0-001/ao/execute-A-18-response.json`, `.../03-execute-result.png`, `.../spike-log.txt`
