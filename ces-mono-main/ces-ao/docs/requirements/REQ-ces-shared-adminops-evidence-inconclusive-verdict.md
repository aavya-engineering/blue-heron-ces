# REQ — ces-shared: an explicit "inconclusive" verdict (and apply-guard refusal) in the AdminOps evidence contract

- **Filed by:** ces-ao (W4-AO5, 2026-09-27)
- **Target:** ces-shared `src/types/adminops-evidence.contract.ts`
- **Status:** OPEN

## Context
W4-AO5 item 1 (P0, score integrity): a live read op that returned no data was persisted as verdict `SAT`.
AO now records such a row as outcome `executed`, verdict `NOT_SAT`, with the rationale
"Read returned no data — an empty or absent result cannot evidence compliance ..."
(`src/execution/EvidenceEmitter.ts`, `isEmptyReadResult` / `EMPTY_READ_RATIONALE`; test
`test/emptyRead.verdict.test.ts`).

The contract's `verdict` is a free `z.string().min(1)` with no enumerated values, so there is no
contract-sanctioned way to say "inconclusive" (neither satisfied nor shown unsatisfied). `NOT_SAT` is the safe
fallback — EvidenceOps credits only `SAT` — but it overstates: an empty read is "no evidence", not "evidence of
non-compliance".

W4-AO5 item 3 has the same gap for outcomes: a live apply refused by the web apply guard (no confirmation) is
persisted as outcome `failed` / verdict `NOT_APPLICABLE` with a rationale naming the guard, because there is no
dedicated refusal outcome (compare `denied_sim_only`, added in 1.2.0).

## Ask
1. Enumerate `verdict` (`SAT` | `NOT_SAT` | `NOT_APPLICABLE` | `INCONCLUSIVE` or similar) and add `INCONCLUSIVE`
   to the never-credit set; keep older versions parsing.
2. Optionally add an outcome `denied_apply_guard` (never SAT, allowed only on live rows).

AO will switch empty reads to the inconclusive verdict and guard refusals to the new outcome once published, and
regenerate its golden.

## Acceptance
A contract version that carries both; AO's golden and ces-eo's golden-based suites parse against it.
