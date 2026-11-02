# Requirement from ces-tester: close backlog-S1 (single-writer seed path)

> **CLOSED 2026-07-10 · `2ebd227`** — see `BACKLOG.md` § S1 for the closure record
> (mechanism: exclusive tenant lock; regression test:
> `tests/integration/backlog-s1-single-writer.test.ts`). S2's status line also flipped.

**Filed:** 2026-07-10, by the ces-tester session on founder direction. This is the one item
still blocking ces-tester's M1 (orchestrator skeleton). Full item: `BACKLOG.md` § S1.

## Heads-up: a numbering collision already happened once

Commit `e99e27f` is titled "S1+S2", but its "S1" was **this repo's own session numbering**
("S1 — scenario growth", two mfa edge-case scenarios) — not `BACKLOG.md`'s S1. Its "S2 —
collection remap" *did* close backlog-S2 (A8). To avoid a repeat: this document and
`BACKLOG.md` mean **backlog-S1** as specified below. Please reference items as
`backlog-S1`..`backlog-S5` in commit messages going forward.

## What backlog-S1 is

`seed`, `init-tenant`, and `scenario` currently construct `ObjectStore`/`Ledger` and write
`store.json`/`ledger.jsonl` **directly in the CLI process**
(`src/cli/commands/seed.ts:45-46`; `scenario` reaches the same direct path via
`ScenarioEngine`). The in-code comment at `seed.ts:31-36` already states the intended design:
only the `stacksim serve` process should ever write those files, "with `seed`/`init-tenant`
starting that server or failing if it isn't running." The serve process exists now
(`src/http/QueryServer.ts`) — the move it anticipated is what backlog-S1 asks for.

**Why it matters to ces-tester:** its run lifecycle invokes `scenario <name>` (wipe+seed)
and then reads `/resolve`//`/ledger` over HTTP, per run, repeatedly. While the CLI write path
and the server write path are independent, a seed racing a live serve process can interleave
writes and corrupt `store.json`/`ledger.jsonl` — the exact single-writer guarantee the serve
design promises. ces-tester will not work around this from its side (two-entities boundary).

## Acceptance criteria (from BACKLOG.md § S1, restated)

1. All `store.json`/`ledger.jsonl` writes from `seed`, `init-tenant`, and `scenario` go
   through the single-writer server path (or an equivalent exclusive-writer mechanism —
   e.g. the CLI refuses to write while a serve process holds the tenant, via lockfile or
   port-probe; the mechanism is this repo's choice, the guarantee is the requirement).
2. A concurrent `serve` + `seed`/`scenario` invocation against the same tenant **cannot
   interleave writes** — one of them wins, the other fails loudly or routes through the winner.
3. A regression test demonstrates (2).
4. `BACKLOG.md` S1 status line flipped: `CLOSED + date + commit hash`.

## While you're in BACKLOG.md

- Flip **S2** to `CLOSED 2026-07-10 · e99e27f` — it's genuinely done (verified by ces-tester:
  plural remap in `deriveResolversFromInventory.ts`, coverage 503/523 0-FAIL unchanged) but
  the status line still says OPEN.

## How ces-tester verifies closure

Its G-TESTER-1 Gate Ledger re-checks by (a) BACKLOG.md status line + commit hash, and
(b) direct code read of the seed path. When both show the single-writer guarantee, M1 starts.
