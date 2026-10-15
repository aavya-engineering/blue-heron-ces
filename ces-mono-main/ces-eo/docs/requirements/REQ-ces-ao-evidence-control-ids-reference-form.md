# REQ — ces-ao: AdminOps evidence rows should name controls in the shared reference form

- **Filed by:** ces-eo (W4-EO2, 2026-09-27)
- **Target:** ces-ao (evidence emission; golden `test/fixtures/contract/adminops-evidence-rows.golden.json`)
- **Status:** OPEN

## Problem
AO's registry (`src/registry/ao-commands.registry.json`) and ces-shared's `cmmc-l2-controls.reference.json` spell
level-1 practices as `AC.L1-3.1.1`, `IA.L1-3.5.1`, … AO's evidence rows spell the same practice `AC.L2-3.1.1`
(all 9 golden rows use L2 spellings; `AC.L2-3.1.1` is not a reference control id).

EO copes: the assessor view (W4-EO1) and the knowledge-bank lookup / "designed procedure" label (W4-EO2) join by
practice number. But `adminOpsCrmCreditedControls` (ces-eo `src/eo/adminops/adminopsViews.ts`) matches ids exactly, so a
live SAT row for an L1 practice cannot earn CRM credit for the reference control `AC.L1-3.1.1`.

## Ask
Emit `controlIds` exactly as they appear in `cmmc-l2-controls.reference.json` (the registry's `cmmcPractices` already do),
and regenerate the golden. Optionally add a contract refine in ces-shared that rejects non-reference ids.

## Acceptance
Every `controlIds` value in AO's golden rows is a reference control id; EO's golden-based tests still pass.
