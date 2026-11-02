# SPEC-06 — Packaging & Release (v1.0)

## Intent

Packaging & Release is the dimension that makes a build *identifiable, reproducible, and trustworthy*
once it leaves the developer's machine. This spec anchors to **Semantic Versioning (SemVer)** — the
`MAJOR.MINOR.PATCH` contract where a breaking change forces a major bump — and to **SLSA** (Supply-chain
Levels for Software Artifacts), which defines build provenance and artifact integrity so a consumer can
verify *what was built, from which source, by which pipeline*. It exists because agent-built software
iterates rapidly and can ship a "new" build that is byte-different, unversioned, unlogged, and
unattributable. The requirements below make every release answer three questions mechanically: what
version is this, what changed since the last one, and can I prove where it came from — never "we should
probably tag releases."

## Requirements

- **SPEC-06.R1 — SemVer discipline, versions actually move.** *(L2)*
  Each published module carries a SemVer version that increments on release; versions are not frozen at
  their scaffold value across substantive change.
  *Verify:* compare `package.json` version against release history/tags; a module with real feature
  history still sitting at `0.1.0`/`1.0.0` (never bumped) fails. Confirm each release corresponds to a
  distinct version.

- **SPEC-06.R2 — Breaking change forces a major bump.** *(L3)*
  Any breaking change to a module's public surface (API, CLI, exported contract) is released only with
  a major version increment; no breaking change ships under a patch/minor.
  *Verify:* cross-check each breaking change (removed field/route/flag) against the version delta; a
  removed contract field under a non-major bump fails (cross-refs SPEC-03 deprecation policy). Ideally
  enforced by an API-diff check in CI.

- **SPEC-06.R3 — Changelog per module, updated every release.** *(L2)*
  Each module maintains a human-readable changelog (Keep-a-Changelog style) with an entry per released
  version describing added/changed/removed/fixed.
  *Verify:* a `CHANGELOG.md` exists per module and its top entry matches the current version; a module
  with releases but no changelog, or a changelog stale behind the version, fails.

- **SPEC-06.R4 — Reproducible builds from a pinned tree.** *(L3)*
  Building the same source at the same commit produces the same artifact; builds install from a
  committed lockfile and pin toolchain versions.
  *Verify:* CI builds with `npm ci` against a committed lockfile and a pinned Node version; two builds
  of the same commit produce equivalent artifacts (no floating deps, no build-time resolution).
  Cross-refs SPEC-04.R12.

- **SPEC-06.R5 — Artifact signing / provenance.** *(L3)*
  Each released artifact carries verifiable provenance (SLSA-style attestation: source commit, builder
  identity, build inputs) and, where distributed externally, a signature.
  *Verify:* the release emits a provenance attestation and/or signature per artifact; a consumer can
  verify commit + builder. No provenance/signature is an L3 fail.

- **SPEC-06.R6 — SBOM accompanies each release.** *(L3)*
  Every release artifact ships with a Software Bill of Materials enumerating dependency versions.
  *Verify:* an SBOM (CycloneDX/SPDX) is produced and retained per release (shared with SPEC-04.R13).

- **SPEC-06.R7 — Declared distribution channel per module.** *(L2)*
  Each module states *how* it is delivered and consumed (npm registry, internal workspace linkage,
  container image, signed tarball) — the channel is explicit, not implicit in `dist/`.
  *Verify:* each module documents its distribution channel; confirm the stated channel matches how
  consumers actually obtain it. "Whatever is in `dist/`" with no declared channel fails.

- **SPEC-06.R8 — Release checklist is codified and followed.** *(L2)*
  A written release checklist exists (bump version, update changelog, run full suite, build artifact,
  generate SBOM/provenance, tag, publish) and each release records that it was followed.
  *Verify:* a release checklist/runbook exists in-repo and releases reference it (tag message, release
  notes, or CI release job encodes the steps). No checklist is L1.

- **SPEC-06.R9 — Immutable, retained release artifacts tied to a tag.** *(L2)*
  Released artifacts are retained and associated with an immutable version tag / commit; a released
  version is never rebuilt-in-place under the same number.
  *Verify:* each release maps to a git tag and a retained artifact; re-releasing changed bytes under an
  existing version is prohibited (forces a new version). Cross-refs SPEC-07 artifact retention.

- **SPEC-06.R10 — Build metadata embedded in the artifact.** *(L2)*
  The artifact can report its own version and source commit at runtime (e.g., `--version`, health
  endpoint, or embedded build stamp).
  *Verify:* invoke the artifact's version/health surface and confirm it returns the released version +
  commit. An artifact that cannot state its own version fails.

## Anti-patterns

- **Versions frozen at `0.1.0`** — every module stuck at its scaffold version despite months of change;
  no consumer can reason about compatibility; violates R1.
- **Breaking change under a patch bump** — a removed contract field or route shipped as `x.y.Z+1`;
  silent consumer breakage; violates R2.
- **No changelog** — releases with no record of what changed (or a changelog that stops several
  versions back); violates R3.
- **Build-time dependency resolution** — `npm install` with floating ranges in the build path, so two
  builds of one commit differ; violates R4.
- **Unsigned, unattributable artifacts** — a `dist/` folder with no provenance, no SBOM, no signature;
  nothing to verify against supply-chain tampering; violates R5/R6.
- **Distribution-by-`dist/`** — no declared channel; consumers reach into build output directly;
  violates R7.
- **Ad hoc releases** — no checklist, no tag, rebuilt-in-place under the same version; violates
  R8/R9.
- **Artifact that can't name itself** — no `--version`/build stamp; you cannot tell which build is
  deployed; violates R10.

## Conformance checklist

- [ ] Every module uses SemVer and versions actually increment across change. *(R1)*
- [ ] Breaking changes ship only under a major bump (ideally CI-checked). *(R2)*
- [ ] Each module has a changelog whose top entry matches the current version. *(R3)*
- [ ] Builds are reproducible from a committed lockfile + pinned toolchain. *(R4)*
- [ ] Each released artifact carries provenance and/or signature. *(R5)*
- [ ] An SBOM accompanies each release. *(R6)*
- [ ] Each module declares its distribution channel explicitly. *(R7)*
- [ ] A codified release checklist exists and releases follow it. *(R8)*
- [ ] Artifacts are retained and tied to immutable version tags. *(R9)*
- [ ] The artifact can report its own version + commit at runtime. *(R10)*

## CES profile hooks

- **Pre-SaaS internal-workspace distribution (CES scoping).** CES is pre-SaaS: no module publishes to
  a public registry — everything is workspace-internal (`cmmc-workspace`, versions hardcoded at
  `0.1.0`/`1.0.0`). The CES profile therefore satisfies R7 via a declared **internal npm-workspace
  linkage channel** (with a pointer to `docs/saas-readiness.md`), and sets R5/R6 provenance+SBOM as a
  *targeted uplift* rather than claiming current external signing. The channel must still be written
  down, not implicit.
- **Unfreeze versions + add changelogs (CES target).** The profile makes R1/R3 an explicit near-term
  target: Stamper/AO/EO/Planner must move off frozen `0.1.0`/`1.0.0` and each gain a `CHANGELOG.md`.
  EO is the exemplar here — it already keeps `CHANGELOG.md` (v0.2.0) plus a dated changelog — and the
  profile requires the other three modules to match that discipline.
- **Reproducible build already partly met (CES note).** CI already runs `npm ci` on a pinned Node 24
  (recon), satisfying much of R4; the profile keeps R4 at L2→L3 and pairs it with SPEC-04.R11/R13 so
  that audit + SBOM land in the same release job.
- **Version self-report via health (CES tightening).** For the server modules (Stamper GUI, EO, AO),
  the profile maps R10 onto the existing `/api/health` surface: health must return module version +
  build commit, so a deployed live-tenant build is always identifiable.
