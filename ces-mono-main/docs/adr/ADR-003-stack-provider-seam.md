# ADR-003 — Stack-Provider Seam (multi-stack capability)

**Status:** accepted (G4) · **Date:** 2026-06-13 · **Context:** G4 goal; builds on G1/G2 config seam

## Context

CES is ~80% hard-coded to the Microsoft 365 / Azure GCC High stack (≈360 stack literals across ~30
files: Graph-US endpoints, PowerShell cmdlets, Azure resource types, M365 enclave models). G4 makes
the system multi-stack **capable** without authoring a second stack's content ("capability, not
content") and without regressing Microsoft output.

## Decision

1. **One seam, keyed by stack id** (`@bhd-vfs/shared/stack`, FE-safe). A `StackProvider` declares a
   `StackCapabilities` contract: cloud endpoints, and the **ids** of the control-signal registry,
   evaluator set, vendor playbook, tech-stack map, and SSP narrative source it uses, plus
   infra/identity conventions. Capabilities are references/metadata — not authored content.

2. **Microsoft is the reference provider**, not special-cased. `providers/microsoftGccHigh.ts` is the
   sanctioned home for Microsoft/GCC-High literals; its capability ids point at the EXISTING Microsoft
   assets, so routing through the seam changes no behavior. A `StackRegistry` resolves providers by id.

3. **Active stack id reuses the existing config seam** — `TenantConfig.stack` (alongside the existing
   `infrastructure_model`), not a parallel selector. Absent ⇒ `DEFAULT_STACK_ID` (`microsoft-gcc-high`),
   so existing Microsoft-only deployments are unchanged.

4. **A proof-stub provider** (`example-stub`, no content) proves the seam is genuinely pluggable — the
   Microsoft path is just another registered provider. Subsystems treat an unknown capability id as
   "no content" and degrade gracefully.

5. **Don't over-abstract.** The seam exposes only what the Microsoft provider AND the proof stub use.
   Microsoft-provider internals (PowerShell cmdlets, Azure resource types) legitimately keep their
   literals — they are the reference implementation. The "no stray literals" guard targets the
   stack-agnostic orchestration paths, not provider internals.

## Consequences

- Subsystems resolve the active provider via `getActiveStackProvider(config)` and pick assets by
  capability id, instead of importing Microsoft specifics directly.
- A new stack registers by supplying the capability contract (validated at registration); authoring
  its domain content (signals/evaluators/playbook/mappings) is a later goal.
- No persistence/identity-core (G1/G2) change; no G3 feature-logic change beyond routing selection.

## Not in scope

Authoring any non-Microsoft stack's real content; eliminating Microsoft literals from the reference
provider; the per-stack content KB (future). Investigations (follow-on stacks, remove-firewall) are
documented findings, not implementations.
