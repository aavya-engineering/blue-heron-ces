# The Rail-State Boundary Model — how M2 should define the CUI boundary

**Date:** 2026-09-08 · **Status:** design proposal for G-MUSTER-PLAN-3 M2 (founder review)
**Companion to:** `docs/design/residual-elicitation-ladder.md` (the Answer Engine — this note is
rung 1's *schema* for the boundary, not a new rung), `docs/goals/G-MUSTER-PLAN-3.md` §M2,
`docs/context/CUI-RAILS-GCC-ASSESSMENT-2026-09-08.md` (why rails), and
`docs/context/domain CUI Rail Catalog - Microsoft Government Cloud.yaml` (the 37 rails).
**Grounding (code):** `src/features/interview/boundaryInference.ts`,
`src/features/discovery/boundaryConfirm.ts`, `src/features/interview/questionGraph.ts`
(`QuestionNode.plan_input`, `bnd-001..003`), `src/features/plan/siDerivation.ts`,
`recipes/*/manifest.json` (`output_maps_to`), `public/schemas/planner/CES CUI Boundary Output
Contract.yaml`, `public/knowledge/primed CUI Boundary Question Bank.yaml` (24 questions),
`public/knowledge/primed BTC Question Bank.yaml` (29 checks).

---

## 1. The claim, in one paragraph

A CUI boundary is best defined not as a list of assets but as a **state table over rails**: for
every channel on which CUI *can* be processed, stored, or transmitted, record whether it is in
use for CUI, closed by a technical switch, closed by policy only, or unaddressed. Every boundary
artifact CMMC wants — the CUI-asset inventory, the Contractor Risk Managed Asset list, the
Security Protection Asset inventory, the out-of-scope list with its required justification, the
SSP data-flow narrative, and Planner's 9-field CUI Boundary Output Contract — is a **derivation**
from that table. The customer never enumerates: the platform rails are the same for every
Microsoft tenant (the catalog owns them), most switch states are readable from the tenant
(recipes read them), and the customer only confirms drafts and lists the handful of rails they
chose themselves. This is rung 1 of the Answer Engine done properly for the boundary, and it
slots in front of the existing M2 adapter without changing the contract it emits.

## 2. What we do today, stated fairly

Three things exist, and the model has to complement all three.

**The Answer Engine (design).** Every fact carries the resolver chain *discover → infer-and-confirm
→ document → archetype → ask*, worked biggies-first, all landing in one fact store with one
provenance model and a named-human attestation guardrail. Rung 1's own words for the boundary:
"Your tenant suggests controlled information lives in these 3 sites, handled by these 12 people…
Correct anything that's wrong." That is the right idea and this note does not change it.

**Rung 1 as built (`boundaryInference.ts`, GO-2 M1).** Three yes/no boundary nodes (`bnd-001..003`:
does CUI exist, are the stores identified, are the users identified) are drafted from
control-ID-prefix footprints (`MP.`, `SC.`, `AC.`…) with confidence = weakest evidence row, and
confirmed through `processBoundaryDecisions` (leave/confirm/correct). This is correct as far as it
goes, but it drafts *whether a boundary exists*, not *what the boundary is*. The `DiscoveryResult`
row shape (`control_id`, `objective_ids`, `confidence`) cannot carry "these 3 sites"; the design's
sentence was never buildable on that shape.

**M2 as specified (PLAN-3).** `cuiBoundaryAdapter.ts` takes confirmed boundary drafts plus the CUI
facts and emits `CES CUI Boundary Output Contract.yaml` — nine posture fields
(`devops_in_scope`, `tenant_separation`, `shared_identity`, `guest_access_policy`, `byod_model`,
`managed_device_required`, `email_forwarding_posture`, `backup_model`, `external_integrations`)
whose only consumer is BTC activation. The CUI facts come from Planner's 24-question CUI Boundary
bank, which is **additive**: "How is CUI received?", "Where is CUI stored?", "Which tools process
CUI?" — the customer declares what they use. `btcAdapter.ts` maps the 29 BTC checks to discovery
observations.

The additive bank has a structural limit that no amount of drafting fixes: it can only capture
rails the customer knows about. The 15 rails in the catalog with no covering question (Power
Automate connectors, Copilot web grounding, optional connected experiences, eDiscovery export,
Defender sample submission, mixed-account Outlook, meeting transcripts, clipboard/browser sync to a
personal account, print…) are open by default in a fresh tenant and are exactly the ones a customer
would never think to declare. The bank also produces nothing 32 CFR 170.19 asks for beyond the CUI
assets themselves — no CRMA list, no SPA inventory, no out-of-scope justification — because those
are properties of rails that are *not* in use, and an additive interview never visits those.

## 3. The model

### 3.1 A rail is a triple, and its switch is part of it

`rail = (source, destination, switch)`. The switch is the mechanism that decides whether the rail
is open: a Conditional Access policy, a SharePoint sharing setting, a Power Platform DLP policy, a
transport rule, an Intune device restriction, a Cloud Policy toggle. Yesterday's assessment said
the assessment boundary is "rails plus the things that close them"; the cleaner statement is that a
rail is not understood until its switch is known, and once the switch is a field on the rail, the
SPAs are no longer a category to remember — they are the switch column.

### 3.2 Rail state — four values, one fact per rail

| State | Meaning | Destination becomes | Switch becomes |
|---|---|---|---|
| `in_use` | CUI moves on this rail by design | **CUI Asset** (170.19 — assessed against all 110) | SPA (assessed for relevant requirements) |
| `closed_technical` | A configured control prevents CUI on this rail | **Out of scope**, with the switch as the required justification (`CUI.OOS.002`) | SPA |
| `closed_policy` | Only policy/procedure prevents it; capability remains | **Contractor Risk Managed Asset** (documented; assessor may spot-check) | policy reference (no SPA) |
| `unaddressed` | Unknown / never considered | Treated as `in_use` for scoping (conservative; "unknown never passes") | — |

One rail = one fact in the existing fact store, `question_id` = rail id (`R2.01`…), answer = the
state, provenance per the Answer Engine (`discovery-inferred` draft → confirmed; or
`operator_interview`; or `derived:cui:<source>` outside `DRAFT_PROVENANCES`, mirroring
`siDerivation`'s `derived:si:*` convention so `scorableFacts` never drops it). The switch, when
technical, is a second fact on the same rail (`R2.01.switch` = the observed control identifier),
because the switch is *evidence*, and evidence has its own provenance.

Three invariants carry over untouched from `draftSemantics` / `boundaryConfirm`: a drafted state
prunes but never passes until a named human confirms; `correct` replaces the draft with an ordinary
human answer; confidence of a draft is never higher than its weakest evidence.

### 3.3 Derivation rules — everything downstream is computed

**Asset categories (new; nothing produces these today).** Walk the confirmed rail table and emit
four sets by the table in 3.2. Specialized Assets (OT, GFE, test equipment) enter through the
existing `on_prem_ot` stack dimension as a catalog section, not a special case.

**Planner's 9-field CUI Boundary Output Contract (existing target, unchanged).** Each field is a
function of one or two rail states plus the shape facts (§4.1):

| Contract field | Derived from |
|---|---|
| `email_forwarding_posture` | `R1.02` state: `closed_technical` → "No"; `in_use` with allowlist switch → "Yes – restricted"; `unaddressed`/`closed_policy` → "Yes – unrestricted" |
| `guest_access_policy` | `R2.03` + `R3.03` states |
| `byod_model` | `R8.05` state (+ `R8.06` `in_use` → "VDI/Cloud PC only") |
| `managed_device_required` | `R8.05` `closed_technical` with CA-compliant-device switch → "Yes – managed only" |
| `backup_model` | `R9.03` state + vendor FedRAMP shape fact |
| `external_integrations` | union of `in_use` destinations across `R3.01`, `R4.01`, `R9.03`, `R1.05` |
| `devops_in_scope` | `R9.02` state ≠ `closed_technical` |
| `tenant_separation`, `shared_identity` | shape facts (`tenant_variant`, second-tenant presence), not rails |

This keeps M2's gates intact: gate (a) still validates the same contract; gate (d) ("an unconfirmed
draft provably does NOT appear in the contract") holds by construction because derivations read
only confirmed rail facts. The adapter's signature does not change; what changes is that its inputs
are derived instead of asked.

**The existing `bnd-001..003` readiness nodes** become derivable from the rail table: a confirmed
table with ≥1 `in_use` rail answers `bnd-001` yes and `bnd-002` yes with
`derived:cui:rail-table` provenance (higher-quality evidence than today's control-prefix
footprint). `bnd-003` (users identified) stays on its current rule until user-scope rails carry
membership evidence.

**BTC (existing 29 checks).** Most BTC rows already verify a switch state (forwarding enforced,
guests aligned, unmanaged devices blocked, SPNs inventoried, backup location, CA blocks
noncompliant devices). Under this model, BTC *is* "verify every rail whose confirmed state is
`closed_technical` still has its switch in the observed position." The 15 gap rails become new BTC
rows by the same pattern; the activation logic keyed on the 9 contract fields stays as is.

**SSP (M5).** `system-security-plan.md` gets its data-flow narrative and its asset-category
tables from the same rail table, which is the first time those two parts of an SSP will agree
with each other by construction.

## 4. The interview — three layers, biggies first

This is the Answer Engine's loop with the rail table as the thing being filled.

### 4.1 Layer 1 — shape facts (ask ~7, prune ~40%)

`tenant_variant` (commercial / GCC / GCC High / DoD), license tier, Azure attached?, development
in scope?, on-prem/OT?, external collaboration?, mobile/BYOD?. Several already exist as declared
stacks or SIT answers (`m365_e5_gcc`, `on_prem_ad`, `on_prem_ot`, G-08 deployment posture) and
derive for free through `siDerivation`'s `DerivationContext`; the rest are the highest-VOI
questions in the whole bank because each one removes whole rail classes. `tenant_variant` also
fixes which cloud each SPA lives in (MDE/Intune/Sentinel differ between GCC and GCC High) for the
inheritance table.

### 4.2 Layer 2 — read the switches (ask 0, discover ~20)

For every surviving rail whose switch is a tenant setting, a read-only recipe answers the rail's
state directly, using the `output_maps_to: [{question_id, when}]` mechanism the recipes already
have — the `question_id` is now a rail id. Readable today with Graph/PowerShell reads:

| Rail | Read |
|---|---|
| R1.02 auto-forward | `Get-HostedOutboundSpamFilterPolicy` AutoForwardingMode; transport rules |
| R1.03 legacy protocols | CAS mailbox plan; CA policy blocking legacy auth |
| R2.01 sharing links | `Get-SPOTenant` SharingCapability, domain allow/deny lists |
| R2.02 sync client | `Get-SPOTenantSyncClientRestriction` |
| R2.03 guest/federation | Teams federation config; Entra cross-tenant access settings; guest count |
| R2.04 meetings/recording | `Get-CsTeamsMeetingPolicy` (anonymous join, recording, transcription) |
| R3.01 user consent | Entra `authorizationPolicy.defaultUserRolePermissions` |
| R3.02 SPNs | service principals with application permissions (Files/Mail.Read*) |
| R4.01 Power Platform | DLP policies present? default-environment maker restrictions? |
| R5.01 Copilot | license assignment count; web-grounding setting |
| R5.02 connected experiences | Cloud Policy / ADMX `L_ControlOptionalConnectedExperiences` |
| R6.01 eDiscovery | role-group membership for eDiscovery Manager/Administrator |
| R7.01 Defender sample submission | MDE advanced features; Safe Attachments policy |
| R8.05 mobile/BYOD | CA policies requiring compliant device / approved app; MAM policies |
| R8.02/03 removable media, print | Endpoint DLP policies; Intune device restriction profiles |

Rails whose switch is not a tenant setting (physical, paper, mixed-account Outlook on an unmanaged
PC) fall down the chain to layer 3. The `DiscoveryResult` shape needs a value-carrying variant for
this (§6, seam 1); the recipe manifests already express it.

### 4.3 Layer 3 — confirm drafts, add your own rails (ask ~5–10)

The existing confirm/correct panel, one card per drafted rail: "This door is **open** (we found no
control closing it). Do you use it for CUI, or should it be closed?" The customer's decision writes
the same `BoundaryDecision` the panel writes today. Unreadable rails are asked with the four-state
options. Finally one free-list question — "what else touches CUI that isn't a Microsoft service?"
(prime portals, CAD tools, SFTP, backup vendor) — which is the rung-4 conversational capture the
ladder already plans; those become customer-specific rails appended to the table with
`operator_interview` provenance. `unaddressed` is the default for anything left, so silence never
narrows the boundary.

The customer-facing metaphor is doors: every door in the building is known; you tell us which ones
you use, we check which are locked, what's left is your boundary. Nobody has to learn what a CRMA
is.

## 5. Is this better than what we do now? Yes — here is exactly how, and what it costs

**Completeness the current approach cannot reach.** An additive interview's ceiling is the
customer's own knowledge. The catalog-first, subtractive interview surfaces the unknown-unknowns —
the 15 default-open rails — because they are in the catalog before the customer arrives. This is
the difference between "we wrote down what they told us" and "we can show why nothing was missed,"
which is the question an assessor (or, in the self-affirmation regime, an FCA investigator) asks.

**Artifacts the current approach does not produce at all.** CRMA list, SPA inventory, out-of-scope
list with technical justification, and an SSP data-flow narrative consistent with the asset tables.
Today M2 produces nine posture fields for BTC and nothing else boundary-shaped. Under the rail
model those four artifacts cost zero additional questions.

**Fewer questions to the human, not more.** Planner's bank asks 24 boundary questions. The rail
model asks ~7 shape facts (several already derived), reads ~20 switches from the tenant, confirms
drafts, and asks the customer to *list* only what they uniquely know. The nine contract fields are
derived rather than asked. This is the Answer Engine's promise — "humans are being asked what
machines know" — applied to the one module where it was still true.

**Consistency by construction.** One state table feeds the contract, BTC, the asset categories,
and the SSP. Hand-authored boundaries drift between their own diagram, inventory, and narrative;
derived ones cannot.

**Defensibility per element.** Every scope claim carries its rail, its switch, its provenance, and
its confirmer. "Why is the finance file server out of scope?" answers itself: rail R9.04, closed by
segmentation rule X, observed on date Y, confirmed by Z. That is the evidence shape `CUI.OOS.002`
already demands and nothing currently generates.

**It fits the Answer Engine rather than competing with it.** Same resolver chain, same fact store,
same provenance classes, same confirm/correct semantics, same biggies-first VOI ordering (shape
facts prune rail classes). Rung 1 finally gets the schema its design sentence needed.

**What it costs, honestly.**

- *Catalog maintenance.* Microsoft ships new rails (Copilot agents, connectors, Loop). The catalog
  needs a version line and a review cadence like the tech-ref index. That cost lands on CES once
  instead of on every customer, but it is real and it is ours.
- *A discovery-shape seam.* `DiscoveryResult` is control-keyed; switch reads are question-keyed
  with a value. The recipe manifest already speaks the latter; the join (`discoveryFactJoin.ts`)
  needs to accept it. One seam, not a second lane.
- *Recipes.* ~20 read-only recipes to write and hash. Each is a handful of read cmdlets; the
  pattern (`entra-mfa-report`) exists.
- *Non-Microsoft stacks.* The catalog is Microsoft-specific by design. On-prem/OT and other clouds
  need their own catalog sections, gated by `applicable_stacks` exactly like today's graph nodes.
  Until then, those rails arrive through the layer-3 free list, which is no worse than today.
- *It is not fewer cards on screen.* ~20 rail confirmations can look like more UI than 24
  questions. The difference is that confirmations are error-spotting on a drawn picture, not
  recall; the ladder's own argument for rung 1 applies.

**What does not change.** Planner untouched; the contract and its schema untouched; M2's four gates
untouched (the derivation strengthens gate (d)); the vendored generators consumed, not re-implemented;
one graph, one pruner, one fact store; zero network in the SPA (the catalog is a static asset under
`public/knowledge/` once promoted).

## 6. Migration into M2 — slices, each independently shippable

1. **Catalog as a bank.** Promote the rail catalog to `public/knowledge/` with a schema under
   `public/schemas/planner/` and a `check:drift` row. Generate rail nodes into the question graph
   (`cluster: 'boundary'`, `plan_input: { contract: 'cui_boundary', field: '<rail id>' }`,
   `mapped_requirements: []` — score-leak safe like the SIT residue nodes), gated by
   `applicable_stacks` from the catalog's `tenant_variant`/class metadata.
2. **`cuiBoundaryAdapter.ts` as a derivation.** Implement the §3.3 field table over rail facts
   (a `CUI_DERIVATIONS` list in the `siDerivation` shape). Gate (a)–(d) as specified in PLAN-3.
   Asset-category emission is a second output of the same adapter.
3. **Switch recipes + the discovery seam.** Extend `DiscoveryResult` with an optional
   question-keyed `answers` payload (or a sibling `DiscoveryAnswer` row) produced from recipe
   `output_maps_to`; `discoveryFactJoin` writes rail-state drafts with `discovery-inferred`
   provenance. Ship the ten highest-VOI recipes first (R1.02, R2.01, R2.03, R3.01, R4.01, R5.01,
   R5.02, R6.01, R8.05, R2.04).
4. **Confirm panel over rails.** `BoundaryConfirmPanel` renders rail cards; `processBoundaryDecisions`
   unchanged. Add the free-list capture for customer rails.
5. **BTC rows for the 15 gap rails**, same `btcAdapter` mapping pattern.
6. **`bnd-001..003` derivation** from the rail table (replaces prefix footprints where a table
   exists; keeps them as fallback).

Slices 1–2 are enough for M2's gates and the `muster-show-mp` demo; 3–4 are where the "ask 0"
promise is kept; 5–6 are cleanup.

## 7. Open decisions for the founder

1. **Rail id as `question_id`** (recommended: one namespace, prunes for free) vs a separate
   boundary store. The engineering note forbids the second unless a reason is recorded.
2. **Switch as a second fact** (`R2.01.switch`, recommended — evidence keeps its own provenance)
   vs a structured answer on the rail fact.
3. **`unaddressed` = `in_use` for scoping** (recommended; conservative and consistent with
   "unknown never passes") vs a distinct "unresolved" bucket that blocks the boundary confirm.
4. **Catalog scope for v1:** Microsoft-only (recommended; matches CMP-2xx's addressable market and
   the GCC/GCC High assessment) vs adding on-prem/OT sections now.
5. **Discovery seam shape:** extend `DiscoveryResult` vs add a sibling row type. The
   GO-1 open-decision-3 note ("output format decided once") argues for a deliberate extension,
   versioned, rather than a second type.
