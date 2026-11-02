# Decisions log: Planner → Muster shift

Scope decisions made by BHD on 2026-10-21. They override any earlier "product decision" placeholders in the backlog.
If a decision blocks you or looks wrong for a case you've found, raise it with BHD in the usual channel, citing the MG
IDs.

| # | Decision | Rationale | Implication |
|---|---|---|---|
| D1 | **No pricing outputs in Muster:** no proposal, SOW, LOE rate card, LOE CSV or cost estimate. | Muster's outputs drive Stamper and the assessment. Pricing is a commercial concern handled outside Muster. | MG-17 and MG-26 are out of scope. The Mission Plan's inline `cost_proposal_sow` block is omitted; the parity harness (MG-04) allow-lists it and the validator (MG-15) drops its proposal checks. |
| D2 | **Render all policy documents Planner can generate** (20 policy, SSP, POA&M and IR templates). | Customers need the full document set; a partial set leaves them to fill the rest by hand. | MG-16 is P1 and covers all 20 templates plus DOCX export. Policy inputs are discovered or defaulted first; remaining questions go in the register. BHD reviews the rendered output. |
| D3 | **Discovery runs on both the simulator and live tenants**, read-only. | Most question reduction depends on real tenant facts; the simulator alone can't beat Planner on real customers. | MG-19 is in scope. Prove it on a BHD-owned test tenant before any customer tenant. The simulator path must keep working. |
| D4 | **No fixed question count. Minimise questions, but ask what must be asked.** | A hard number invites silent defaults that quietly corrupt outputs. Justification is what keeps questions honest. | Every input follows discover → infer → default → ask. New deliverable MG-28: a question register listing every question, the output field it feeds and why it can't be derived. CI fails on an unregistered question. |
| D5 | **Readiness covers all 165 activities**, filtered per scenario as Planner does. | Fewer activities means the posture and SPRS are computed over fewer requirements, which overstates or misstates readiness. | MG-07 is P1. Extra activities are settled by discovery and the bulk cascade, not by new questions. |
| D6 | **Plan modes: harden_existing + build_new (confirm if migrate/hybrid are wanted).** | These two cover the first customers. Each mode needs its own parity fixture and golden output. | MG-10 adds `build_new` (fixture (d) in MG-04). `migrate` and `hybrid` are deferred: if discovery sees their signals, flag a deferred mode and raise it with BHD. |
| D7 | **Push the SI Baseline, TCP and Readiness Posture to Stamper** with the plan. | Stamper and the evidence trail should see the inputs that shaped the plan, not only the plan. | MG-12 becomes a push. It depends on MG-27, a new Stamper intake contract in `ces-mono` (`ces-shared/` contracts and `ces-stamper/` intake). The contractor team owns it (D11). |
| D8 | **BHD supplies archetype content and the domain-marker answers, before wave 3.** | This is domain content that can't be invented from the code. | MG-21 and MG-24 depend on BHD input. Contractors build the archetype mechanism with content slots, and send the marker triage list in wave 1. |
| D9 | **Assessor reports and the tech-ref guide are downloads.** | They are cheap pure derivations; customer-portal delivery and styling can come later. | MG-11 (exclusions, traceability, control assessment) and MG-18 (tech-ref) are downloads, also placed in the evidence package. Styling is P3. |
| D10 | **Block the Stamper push on cross-artifact misalignment, with an audited override.** | Planner only warns, which lets misaligned plans reach Stamper. An override keeps a delivery from stalling on a known, accepted issue. | MG-15 blocks on structural and MP↔TM control mismatches and warns on the rest. An override needs a reason and is recorded (user, time, reason, errors) in the audit log. |
| D11 | **The contractor team owns the Stamper-side intake change (MG-27)** as well as the Muster side. | One team owning both ends of the contract avoids a hand-off stall. | Work in `ces-mono` (`ces-shared/`, `ces-stamper/`) is in scope; existing MP/TM/IM intake and its tests must keep passing. |

## Legend

| Term | Meaning |
|---|---|
| D1–D10 | Decision numbers in this log |
| MG-nn | Backlog item IDs in `01-GAP-BACKLOG.md` |
| BHD | The company that owns CES and this work |
| CES | The product suite (Planner, Muster, Stamper and others) |
| MP / TM | Manual Mission Plan / Tenant Manifest |
| SI / TCP | Strategic Intent Baseline / Tenant Config Profile |
| SOW / LOE | Statement of work / level of effort |
| SSP / POA&M / IR | System Security Plan / Plan of Action and Milestones / Incident Response |
| DOCX | Microsoft Word document format |
| SPRS | Supplier Performance Risk System score |
| Golden | Planner's output for a fixture customer, used as the expected result |
| Question register | The MG-28 list of every question Muster asks, the output field it feeds and why it can't be derived |
