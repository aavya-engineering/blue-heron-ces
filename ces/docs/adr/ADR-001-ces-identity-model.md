# ADR-001 — CES Identity & Tenancy Model

**Status:** accepted (G1 foundation) · **Date:** 2026-06-12 · **Context:** [G1 plan](../G1-plan.md)

## Context

Every persistent CES object must be unambiguously owned by a (customer, SI-baseline) pair so that later goals can
re-key and migrate storage without cross-customer leakage. Today the Planner already carries the pieces
(`customerId`, `baselineId`, a hashed `cesId`) but ownership is **not enforced on reads**, and the tuple **does not
propagate** past the Planner into Stamper/EO/AO (which re-key by `tenantSlug`/`tenantId`).

## Decision

1. **The canonical identity is the explicit tuple `CesTuple = { customerId, siBaselineId }`.**
   It is carried explicitly on records and in artifact envelopes. The numeric tuple is **authoritative for
   ownership**.

2. **`cesId` is a derived, stable label over the tuple — never an authorization key.**
   `cesId` (the existing `ces-{12hex}` SHA-256 value) is kept as a human-/cross-system-friendly handle and index,
   but **ownership checks must use the explicit tuple**, never the hash alone (hash equality ≠ ownership, and a
   hash cannot be safely reversed to a tuple).

3. **Propagation contract.** Every cross-boundary artifact carries and preserves, unchanged, the identity block:
   `{ cesId, customerId, siBaselineId, tenantSlug }`. Mission plan → Stamper executable plan → evidence metadata →
   EO assessment / SSP / POA&M must all echo it. `tenantSlug` is bound to `{customerId, siBaselineId}` via the CES
   config file (G1 T4).

4. **Reads are ownership-checked by default.** A read scoped to a tuple must never return another tuple's record.
   For *lookup-by-id* reads, a record that doesn't match the caller's tuple is treated as **not found**
   (return `undefined`) — it must not confirm the record's existence to a non-owner. For *write/critical* paths,
   a mismatch **throws**.

## Consequences

- A small pure module (`cse-fe-v2/src/shared/identity/cesTuple.ts`) owns the tuple type and ownership predicates;
  it is unit-tested in isolation (no IndexedDB) and is the single place the Dexie read helpers will call.
- The leaky helpers found in the inventory (`getAllBaselines()` unscoped; `getXById()` no ownership check) become
  ownership-aware in a follow-up slice, guarded by these tests.
- Stamper/EO/AO gain the identity block on their persistent records (G1 T2); the storage engine itself is
  untouched until G2.

## Not in scope here

Wiring the predicates into the Dexie helpers, the customer↔tenant config, and cross-subsystem propagation are
separate G1 slices (T2/T4/T5). This ADR + the pure tuple module are the foundation.
