# Design doc pointer

The authoritative design document for this package is:

`ces-stamper/docs/design/tenant-manager-extraction.md`

(relative to the `ces` workspace root — i.e.
`C:\Users\mhsut\DevProjects\ces\ces-stamper\docs\design\tenant-manager-extraction.md`)

That document is the single source of truth for:

- The decision record and feasibility case (§1).
- What lives in TenantManager, with file:line grounding for every claim (§2).
- What does NOT live in it — the scope fence (§3).
- Why this is a standalone sibling package, not a `ces-shared` subpath (§4).
- The extraction milestones M0–M5 (§5), including the interface-review gate
  this package's M0 deliverable sits behind.
- Per-consumer sibling requirements (§6).
- Risks (§7) and open decisions for the founder (§8).

This file is a pointer only — do not duplicate the design doc's content here.
Update this pointer if the design doc moves.
