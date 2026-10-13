# GP-MUSTER-2 — Muster delivery: operator-run engagements + the results portal

**Date:** 2026-07-25 · **Type:** goal (successor to GP-MUSTER-1 M3).
**Owning repo:** ces-muster.
**Provenance:** founder ruling FD-DELIVERY-VEHICLE (2026-07-25, closes master plan
D8): **Option C** of `docs/design/delivery-vehicle-brief.md` — operator-run with
portal delivery now, hosted SaaS (Option A) as the destination. Everything built
here must remain forward-compatible with A (the portal becomes A's delivery
surface; muster-api's Tenant/JWT/RBAC/RLS skeleton stays the auth substrate).

## Mission

Make an engagement deliverable end-to-end with what exists: a BHD operator (or a
customer admin on the script-upload rung) runs the assessment, and the contractor
receives their readiness report/result through a narrow, hardened, audited
delivery surface — "a secure and easy way for users to use Muster and get results
from it" (standing product requirement, 2026-07-25).

## Milestones

- **M1 — Result-handling policy (paper first).** Encryption at rest, who can
  pull, how long results live, secure destruction at close-out. Short doc; the
  portal implements it, so it goes first. Carries the retention open question to
  the founder.
- **M2 — The delivery portal (muster-api lane).** Per-engagement access to that
  engagement's artifacts ONLY: short-lived credentials, download-only surface,
  audit log on every pull, nothing browsable across engagements. Build on the
  existing JWT/RBAC/RLS substrate — no parallel auth. Serves readiness-result.v1
  files and the customer readiness report.
- **M3 — Collaborative-bhd session runbook (paper).** Device-code consent
  script, operator checklist, delivery handoff — the repeatable engagement
  procedure a second operator could follow.
- **M4 — Script-upload kit (independent mode, ladder rung 2).** The signed,
  human-readable, read-only collector a customer admin runs themselves; output
  lands on the existing import seam (readiness-result.v1 / results-file — no new
  format, Gate-3-proven seam).

## Constraints

- SPA never touches tenants; muster-api brokers everything (TENANT-CONNECTION.md).
- One-SPRS rule; vendor-with-drift-check; registries as data — all unchanged.
- The portal is download/delivery ONLY in this goal — no customer-facing
  assessment-running surface yet (that is Option A territory, later).
- No second result format: the portal serves the same readiness-result.v1 the
  seam consumes.
- Identity non-exposure: nothing in the portal, kit, or runbook carries the
  founder's personal identifiers.

## HIL gates (founder decisions carried open from the brief)

1. Portal hosting locus — enclave-adjacent vs commercial cloud (blocks M2
   deploy, not M2 build).
2. Offline self-serve SPA policy for independent-mode customers (policy call;
   the SPA already works offline).
3. Retention period for delivered results (lands in M1).

## Done-when

M1 policy ratified; M2 portal serving a real engagement's artifacts under
per-engagement auth with audit entries proving it; M3 runbook usable by a
non-author; M4 kit produces a file the import seam accepts (equivalence-tested);
suites green; capsule + session log updated.
