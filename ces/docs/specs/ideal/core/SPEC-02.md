# SPEC-02 — Architecture & Design (v1.0)

## Intent

Architecture is the set of decisions that are expensive to reverse, so this dimension exists to make
those decisions *explicit, bounded, and enforced* rather than emergent. It draws on three recognized
practices: the **C4 model** (Brown) for describing structure at context/container/component levels,
the **dependency rule / Clean-and-Hexagonal architecture** (Martin, Cockburn) for keeping domain
logic independent of frameworks and IO, and **Architecture Decision Records** (Nygard / MADR) for
capturing *why* a structure is the way it is. The core assertion is that module boundaries and the
dependency edges between them are declared and machine-checked, and that every cross-module seam is
governed by a contract under change control — because a seam that drifts silently is how a monorepo
turns into a big ball of mud. Maturity levels follow the L0–L3 model in SPEC-00.

## Requirements

- **SPEC-02.R1 — Architecture of record.** A written architecture overview exists (C4 context +
  container level at minimum) showing the modules and how they relate. *(Level: L1)* — **Verify:** an
  architecture doc/diagram is present in `docs/` and enumerates the modules; reviewer confirms it
  matches the actual workspace layout.

- **SPEC-02.R2 — Module boundaries defined.** Each module has a single written responsibility and a
  declared public surface (entrypoint/exports); no module's purpose is "misc". *(Level: L2)* —
  **Verify:** a module map lists each module's responsibility and public entrypoint; reviewer confirms
  one-responsibility-per-module.

- **SPEC-02.R3 — Dependency rules declared.** The allowed direction of inter-module dependencies is
  written down (e.g., "shared has no upward dependents; app modules may depend on shared, never on
  each other's internals"). *(Level: L2)* — **Verify:** a dependency-rules statement exists and names
  the permitted and forbidden edges.

- **SPEC-02.R4 — Dependency rules enforced by tooling.** No import cycles and no forbidden cross-module
  edges, enforced by a machine check (e.g., `madge --circular`, `dependency-cruiser`, or ESLint
  `import/no-restricted-paths`). *(Level: L3)* — **Verify:** a CI gate runs the dependency check and
  fails on a cycle or a forbidden edge; adding a violating import turns the gate red.

- **SPEC-02.R5 — Domain independent of framework/IO.** Core/domain logic does not import HTTP,
  filesystem, or cloud-SDK modules directly; IO is reached through an interface/adapter seam.
  *(Level: L2)* — **Verify:** a scan of domain files shows no direct framework/SDK imports; IO flows
  through a named seam (e.g., the stack-provider seam / repository interface).

- **SPEC-02.R6 — Shared cross-cutting code centralized.** Cross-cutting logic (crypto, config, stack
  resolution, persistence contracts) lives in one shared package, not copy-pasted across modules.
  *(Level: L1)* — **Verify:** shared concerns resolve to a single package (`ces-shared`); duplicate-code
  scan finds no forked copies of a shared utility.

- **SPEC-02.R7 — ADRs for significant decisions.** Significant/irreversible decisions are recorded as
  numbered ADRs (Nygard/MADR shape: context, decision, consequences); accepted ADRs are immutable and
  superseded rather than deleted. *(Level: L2)* — **Verify:** an `adr/` (or `docs/adr/`) directory
  holds numbered records; superseded ADRs carry a "Superseded by ADR-NNN" line, not a deletion.

- **SPEC-02.R8 — Every cross-module seam has a contract (contracts-first).** Each seam between modules
  references a declared contract artifact (schema/interface) rather than an implicit shape.
  *(Level: L3)* — **Verify:** each inter-module call site resolves to a named contract (e.g., the
  stamper↔EO schema, the DexieContract, the DirectiveMetadata schema); a check lists seams and their
  contracts with no "implicit" entries. (See SPEC-03 for the contract's own requirements.)

- **SPEC-02.R9 — Change control on cross-module seams.** A change to a cross-module seam requires an
  ADR (or ADR update) plus a contract version bump plus a both-sides update in the same change set.
  *(Level: L2)* — **Verify:** PR/commit for a seam change shows the contract version changed and both
  producer and consumer updated; a seam change with only one side updated is rejected in review.

- **SPEC-02.R10 — No god-files.** Route registration, module composition, and similar aggregation files
  are bounded by an explicit size/complexity budget (e.g., a per-file LOC or route-count ceiling).
  *(Level: L3)* — **Verify:** a lint/CI check enforces a max-LOC (or max-route-registrations) budget on
  designated aggregation files and fails when a file exceeds it. (Grounding: `EoServer.ts` ≈ 3,896
  lines / ~98 route registrations is the canonical violation.)

- **SPEC-02.R11 — Public API surface is explicit; internals unreachable.** Each module declares its
  public entrypoint (package `exports`/`main`); consumers cannot deep-import internal paths.
  *(Level: L2)* — **Verify:** `package.json` exports map (or index barrel) defines the surface; a scan
  finds no deep-import of another module's `src/**` internals.

- **SPEC-02.R12 — Architecture doc kept in sync.** Structural changes (new module, moved boundary,
  changed dependency edge) update the architecture doc in the same change set; a freshness policy
  makes staleness detectable. *(Level: L2)* — **Verify:** reviewer confirms the arch doc changed
  alongside the structural change; doc carries a "last-reviewed" date checked against structural git
  churn.

## Anti-patterns

- **Big ball of mud** — modules import each other's internals freely; no declared dependency
  direction; every change ripples unpredictably.
- **God-file route registration** — a single multi-thousand-line server file registering scores of
  routes (the EO monolith), impossible to review or test in isolation.
- **Framework-bound domain** — business logic that imports Express/Graph-SDK/`fs` directly, so it
  cannot be unit-tested or ported and every IO change touches domain code.
- **Implicit seam** — two modules exchanging an object whose shape lives only in the caller's head; it
  drifts and breaks silently (the pre-contract state of stamper↔EO).
- **ADR theatre / decision amnesia** — either no ADRs at all, or ADRs written once and never consulted;
  decisions get silently reversed with no record of why.
- **Shotgun shared logic** — the same crypto/config helper copy-pasted into three modules, so a fix
  lands in one and not the others.
- **Deep-import coupling** — consumers reaching into `otherModule/src/internal/...`, defeating the
  module's declared public surface.

## Conformance checklist

- [ ] An architecture-of-record doc/diagram exists and matches the workspace. *(R1)*
- [ ] Every module has one written responsibility and a declared entrypoint. *(R2)*
- [ ] Inter-module dependency direction is written down (allowed/forbidden edges). *(R3)*
- [ ] A CI gate enforces no-cycles / no-forbidden-edges. *(R4)*
- [ ] Domain/core files import no framework/IO directly. *(R5)*
- [ ] Cross-cutting logic lives in one shared package (no forked copies). *(R6)*
- [ ] Significant decisions are numbered, immutable-once-accepted ADRs. *(R7)*
- [ ] Every cross-module seam resolves to a named contract artifact. *(R8)*
- [ ] Seam changes carry ADR + contract version bump + both-sides update. *(R9)*
- [ ] Aggregation/route files pass an enforced size/complexity budget. *(R10)*
- [ ] Module public surfaces are declared; no deep-imports of internals. *(R11)*
- [ ] Architecture doc updated alongside structural changes (freshness policy). *(R12)*

## CES profile hooks

- **Tighten R8/R9 on the stamper↔EO seam.** The profile requires the `stamper-eo-schema-contract.md`
  to be ratified (out of DRAFT) and both sides validated against it — cross-linked to SPEC-03.R7.
- **Anchor R5 on the stack-provider seam (ADR-003).** GCC High vs commercial endpoint resolution must
  flow through the stack seam; the profile names it as the mandated IO boundary (cross-refs SPEC-08).
- **Set R10's budget to bite the EO monolith.** The profile fixes a concrete route-registration/LOC
  ceiling that `EoServer.ts` currently violates, making decomposition a tracked gap rather than a
  vibe.
- **Waive R4 tooling choice, not the gate.** The profile leaves the specific tool (madge vs
  dependency-cruiser) to the module but does not waive the requirement to have an enforced check.
- SPEC-02 dimension **target = L2**, tightening to **L3 on R4, R8, and R10** given the monorepo's
  cross-module seam density.
