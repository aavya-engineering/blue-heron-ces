# SCRE — Overall-Approach Decision Summary

**Date:** 2026-06-14 · **Classification:** Internal — product/strategy
**Companion to:** `SCRE-Goal-and-Three-Approaches.md`, `SCRE-DIB-Stack-Research.md`, `SCRE-Weighting-Dashboard.html`, `SCRE-Approaches-Dashboard.html`

---

## The question, and how to read this

**Which overall approach best serves the SCRE goal** — high-accuracy, self-service, low-cost-to-deliver CMMC L2 assessment across the stacks the Defense Industrial Base actually runs? Four candidates are in play: three truth-sources for stack-config data (**A**, **B**, **C**) and the **Router** that composes them. The decision crux is stack-config-data acquisition, weighted **Customer UX to gather (50%) · Data quality (30%) · Company LOE (20%)**.

The scores in this document are **illustrative and directional** — uncalibrated reads on each lever, re-derived within this session from the dashboard's stated base scores and still pending independent (browser) verification before they drive any sequencing decision. The recommendation does **not** rest on weighted-average precision; it rests on a structural argument — *no single approach covers the full stack matrix, because the on-prem/OT layer that defines the small-manufacturer beachhead is not API-harvestable.* Treat the numbers as supporting color and the structure as the load-bearing case.

## The four candidates at a glance

- **A · Connected Posture Harvest** — read-only API connectors harvest live config directly (machine truth).
- **B · Adaptive Intent Interview** — an AI-native, computed question graph asks only what still matters (conversation truth).
- **C · Guided Evidence Capture** — capture recipes + artifact ingestion turn exports/scripts/screenshots into facts (artifact truth).
- **Router (composes all three)** — per objective, picks the highest-truth source available at acceptable effort; the composite the findings name as the actual product. Not a peer of A/B/C — it is the meta-architecture they assemble into.

Scores below are illustrative and directional — confirm from `SCRE-Weighting-Dashboard.html` and `SCRE-Approaches-Dashboard.html` before using for sequencing decisions.

| Approach | UX to gather | Data quality | BHD LOE | Weighted score (50/30/20) | On-prem/OT score † | HIL position |
|---|---|---|---|---|---|---|
| A — Connected Posture Harvest | High (85) | Max (97) | Max (94) | **90.4** | ~37 (real override — collapses) | Self-serve; exceptions only |
| B — Adaptive Intent Interview | Max (95) | Med (60) | High (85) | **82.5** | ~83 (base score, no override) | Tunable middle (HIL knob) |
| C — Guided Evidence Capture | Med-High (70) | High (88) | High (80) | **77.4** | ~80 (base score, no override) | Validation sampling |
| Router (composes all three) | Per-objective best | Per-objective best | Per-objective best | *no standalone score — inherits best-available per objective* | Full coverage | Configurable per layer |

> **† The on-prem/OT column is not an apples-to-apples per-stack re-score.** Only **Approach A** has a genuine per-stack override in the dashboard: on on-prem its levers are re-scored (ux 30 / quality 35 / loe 60 → **~37**) because no cloud APIs exist and A goes blind. **B (~83) and C (~80) are simply their BASE weighted scores carried into this row — no on-prem-specific override was applied to them.** The column shows their *general adequacy* on a stack where A fails, not a measured on-prem re-score. The directional point holds — A collapses while B and C do not — but read the B/C cells as "no reason to expect collapse," not as rigor-matched per-stack numbers. The Router carries no single score by design; its claim is coverage dominance across stacks, not a weighted average.
>
> **Provenance of the numbers:** the base scores (A 85/97/94 · B 95/60/85 · C 70/88/80) and weighted totals (A 90.4 · B 82.5 · C 77.4) were **arithmetically re-derived within this session from the dashboard's stated base scores** (weighted = UX×.5 + Quality×.3 + LOE×.2); A's ~37 on-prem figure follows from its override levers. Both dashboards agree on the base scores, and the Weighting dashboard is the source of record where a figure is cited — but the dashboard and this document were produced in the same session, so this is internal-consistency checking, not independent confirmation. **Independent (browser) verification of the dashboard is still pending.**

## A — Connected Posture Harvest

**Pros**
- Machine truth: reads live configuration directly via read-only API connectors — maximal data quality (97).
- Near-zero BHD LOE once the connector exists; build-once, reuse across every client.
- UX is a single scoped read-only OAuth consent click — no human data-gathering effort.
- Continuous re-harvest *is* the Tier-3 assurance annuity, at no additional delivery cost.

**Cons**
- Blind to on-prem/OT, process, physical, and BYOD controls — precisely the layer that defines the small-manufacturer beachhead (Stack-Research §3 Layer 2). On on-prem the score **collapses (~37)**.
- Consent friction and a buyer-trust barrier ("why does it need access?") gate A's real reach.
- Per-vendor API maintenance burden: each new stack needs new probes.
- Scope shrinks on stacks with limited API surface (PreVeil: partial; on-prem: none).

**When it wins:** GCC High / GCC stacks where the buyer grants read-only API consent — the highest-value single starting point for the DIB beachhead (Goal §6, Stack-Research §4 rank #1).

## B — Adaptive Intent Interview

**Pros**
- Maximal customer UX (95): fewest, clearest, conversational questions, selected by information gain — maximizes the 50% lever.
- Universal coverage — every stack, every objective, no API or artifact required. Holds up on on-prem (~83) where A collapses.
- The only approach that is **day-one-complete** before any connector or extractor exists.
- Tunable HIL knob: pure self-serve at one end, auto-route low-confidence answers to an advisor at the other.

**Cons**
- Self-attestation bias: data quality is medium (60), not high — the weakest of the three on the 30% quality lever.
- Confidence calibration is the make-or-break engineering problem and is hard to get right.
- Hard guardrails required so the LLM never invents compliance findings.
- Lower evidentiary weight for C3PAO / assessor review than A or C.

**When it wins:** Universal fallback for any stack or objective not yet covered by an A connector or C recipe — the guaranteed day-one assessable path for any client (Goal §6 item 3).

## C — Guided Evidence Capture

**Pros**
- Artifact-backed quality — high (88), not medium — without granting live API access; lower trust barrier than A.
- Reaches on-prem/OT, physical, and BYOD controls where A is completely blind (Stack-Research §3 Layer 2). Holds up on on-prem (~80).
- Collection + audit-prep are one step: the signed artifacts that prove the score become the C3PAO evidence package.
- Read-only config-dump scripts deliver near-API-quality data and are a genuine competitive moat on the manufacturing layer (Stack-Research §7).

**Cons**
- Higher customer capture effort than A or B — dropout risk if recipes are too burdensome.
- Extraction accuracy depends on artifact quality; messy exports, screenshots, or OCR failures degrade results.
- Script trust: owners may ask "what does this script do?" — requires open, signed, read-only scripts to mitigate.
- BHD validation sampling adds some LOE (small but non-zero).

**When it wins:** On-prem/OT controls (stack rank #2), PreVeil enclaves (rank #3), and any objective where API probes don't exist and evidence capture beats self-attestation (Goal §6 item 4, Stack-Research §4).

## Router — compose all three

**Pros**
- Per objective, always picks the highest-truth source available at acceptable effort (machine > artifact > interview).
- The only design that covers the full stack matrix — GCC High through on-prem/OT through PreVeil — with no blind spots.
- High accuracy + self-service + low BHD LOE are simultaneously achievable; no single-approach candidate clears all three.
- Build-once connectors and extractors are reused across every future client assessment; marginal cost approaches zero at scale.

**Cons — Derived — not in source findings (inferred from the architecture):**
- Build cost = **A + B + C plus a merge/confidence/routing layer** on top — the most complex build path of the four.
- Only **B is day-one-complete**; A needs per-stack connectors and C needs extractors and capture recipes, so the Router delivers its full coverage value only progressively (a sequencing dependency, not a flip-the-switch).
- **Routing logic and confidence calibration are net-new engineering surface** that must be designed, tested, and maintained — they are not free by virtue of combining A, B, and C.
- **Per-fact provenance merging across three truth sources must be consistent**; inconsistent merge logic feeds contradictory inputs to the derivation engine and corrupts the score.

**When it wins:** As the **endgame architecture** — it is not a peer option competing against A/B/C but the composite they resolve into. The question is never "Router *or* A?" but "in what order do we build toward the Router, and how much of it belongs in v1?" Evaluate it as a build-sequence decision, not a binary alternative (Goal §5). Crucially, "endgame" does **not** mean "build it all in v1" — see *Is the full Router overkill for v1?* for the cheaper A+B-first path and the data trigger that earns C and full routing.

## What the findings favor

**Thesis: Router as the endgame, but most likely A + B as the v1 build — A / Microsoft GCC High as the best single starting point, B as the universal day-one fallback, with C (the non-API moat) and full routing earned by the data, not assumed (see *Is the full Router overkill for v1?*).**

1. **No single approach wins across all five stack ranks — so the Router is the complete answer.** A scores highest at default weights (90.4) but **collapses on on-prem/OT (~37)** — the layer universal to manufacturers and the heart of the beachhead (Stack-Research §3 Layer 2). B covers everything but at medium quality (60). C reaches where A cannot (~80 on-prem) but costs more customer effort. Only the Router routes per objective to the highest-truth source, simultaneously satisfying high accuracy + self-service + low LOE across the whole stack matrix (Goal §5). This is the structural case; the weighted averages are supporting color.

   **The missing premise — read it before treating "Router" as "build it all now."** "No single approach covers the matrix → Router" justifies building the **full** Router *simultaneously* **only if** A's on-prem collapse and C's dropout/cost actually bite *frequently* in the real customer base. If most of the first cohort is GCC High (which the sources call the de facto standard), then A+B already covers the bulk of cases and C's on-prem moat is a smaller-than-assumed slice — so the matrix gap is real but rare, and the cheaper path wins for v1. **That frequency is unvalidated** (no measured stack distribution yet — see Caveats), and it is precisely what the "build it all now" reading depends on. The structural argument proves the Router is the right *endgame*; it does **not** by itself prove the full Router is the right *v1 build*. See the next section — *Is the full Router overkill for v1?*

2. **Build-sequence recommendation (Goal §6), ordered by the stack-coverage map (GCC High → on-prem/OT → PreVeil → Google → AWS)** *(this order is vendor-sourced and unvalidated — weight of evidence, not measured fact; confirm against the real sub roster before committing the sequence, see Caveats)***:**
   1. **Generalized Intent Object + Intent Compiler** — the shared foundation that makes all three (and every future framework) possible; CMMC L2 as the first intent pack.
   2. **Approach A connector for Microsoft GCC High** — highest 50/30/20 score (90.4) for the **#1 DIB stack**; the highest-value single starting point.
   3. **Approach B as the universal fallback** — guarantees any stack is assessable day one, even before its connector exists.
   4. **Approach C** to lift quality on non-API controls (on-prem/OT rank #2, PreVeil rank #3) and to make the C3PAO evidence package fall out for free — the non-API moat.
   5. **Per-fact confidence + source-mix telemetry** as the pricing basis and the moat instrument.

3. **The HIL spectrum is the product's adjustable trust dial (Goal §4).** A = self-serve, exceptions only; B = the tunable middle where the human-in-loop knob lives; C = validation sampling. The Router exposes that knob **per objective** rather than globally — routing only low-confidence / high-weight items to a human, which is what bounds BHD LOE to exceptions instead of the whole assessment. **The default HIL placement for the MVP is an open question, not a decided one (Goal §7 item 3) — resolve before the B fallback build begins.** *Provisional recommendation (not yet decided): ship pure self-serve and auto-route only low-confidence / high-weight answers to an advisor, rather than concierge-first-then-automate — it protects the self-service and low-LOE goals from day one, with the confidence threshold as the tunable dial. Validate against early-cohort confidence calibration before locking it.*

## Is the full Router overkill for v1? — the cheaper paths

The structural case names the Router as the **endgame**. It does **not** settle what to *build first*. Because the full Router's cost is **A + B + C + a merge/confidence/routing layer**, the honest v1 question is which subset earns its place now. Three launch options, weighed against each other:

- **B-only MVP (interview only).** *Fastest to market, any stack day one* — B is the one approach that is day-one-complete with no connector or extractor. **But:** medium quality (60) and the weakest evidentiary weight for C3PAO/assessor review. Good for a demo or a pre-Phase-2 self-affirm aid; thin as the product's accuracy promise. Lowest build cost, lowest win.
- **A + B (no C).** *Covers the #1 DIB stack at high quality + a universal fallback for everything else.* A wins GCC High (90.4), the de facto standard and the largest slice of the likely cohort; B guarantees any other stack is still assessable. **Defers** the on-prem/OT + PreVeil moat (C) and the routing layer. This is the **lowest build cost that still wins the #1 stack at machine-truth quality** — it concedes only the manufacturing on-prem layer until the data says that layer is common enough to fund.
- **Full Router (A + B + C + routing).** *Complete coverage, no blind spots* — the only design that satisfies high accuracy + self-service + low LOE across the entire matrix. **But:** highest build cost and the longest road to full value (A needs per-stack connectors, C needs extractors and recipes, plus net-new routing/calibration/provenance-merge surface). Right as the destination; expensive as a first deliverable.

**Recommendation (conditional and falsifiable):** the right **v1 is most likely A + B** — win the #1 stack at machine-truth quality, cover the rest with the interview, and ship before the connector/extractor build for C is done. **C and full routing are earned by the data, not assumed.**

> **Decision rule for promoting C into v1:** pull the actual nominated sub roster (Stack-Research §6.1) and measure the on-prem/OT share. **If >~30% of the cohort-1 subs carry CUI on on-prem/OT (AD, file servers, CAD/CAM, CNC) — the layer where A goes blind — then C moves into v1**, because the matrix gap is frequent enough to fund the moat now. **If it is below that threshold, C waits** behind A+B and the interview covers the on-prem stragglers at medium quality until the share (or a strategic moat bet) justifies the build. **Full routing follows C** — there is little to route between until a second high-truth source (C) exists alongside A.

The Router remains the **endgame architecture**; this section only refuses to treat it as the automatic **v1 build**. The question is the build *order* (Goal §5), and the cheapest order that still wins the #1 stack is A + B first.

## Caveats and what to validate

- **Vendor bias (verbatim from `SCRE-DIB-Stack-Research.md` header):** *"Almost every public source on this topic is vendor marketing… No reliable public market-share percentages exist for GCC High vs. alternatives in the DIB; claims below are directional and flagged."* The stack-coverage order is **weight of evidence, not measured fact** — treat the ranking as a hypothesis to validate.
- **Illustrative scores:** Base scores (A 85/97/94 · B 95/60/85 · C 70/88/80) and weighted totals (A 90.4 · B 82.5 · C 77.4) were **arithmetically re-derived within this session from the dashboard's stated base scores** — not externally confirmed. Both dashboards agree and the Weighting dashboard is the source of record where a figure is cited, but the dashboard and this document were produced in the same session, so this is internal-consistency checking. **Independent (browser) verification of the dashboard is still pending.** The numbers remain directional and uncalibrated — confirm before treating as settled.
- **Open questions get revisited (Goal §7):** Surface the four open questions — framework order, A's trust/consent model, default HIL placement, business-model packaging — **at the approval gate before committing the build sequence**, since each can re-order steps 2–5 above. The most decision-critical here is A's trust model (item 2 below), which gates whether step 2 holds.
- **Real stack distribution — the decision gate on C and full routing:** Pull from the actual nominated sub roster before locking the build order — the ranking is evidence-weighted, not measured (Stack-Research §6.1). **This validation must run *before* the C build, not after the Router sequence is committed.** Concrete rule: **if >~30% of cohort-1 subs carry CUI on on-prem/OT, C moves into v1; if the cohort is dominated by GCC High/GCC, A + B is sufficient for the initial cohort and C (and full routing) waits** (see *Is the full Router overkill for v1?*). This is the falsifiable trigger that re-orders the build.
- **API-access willingness:** Buyer consent to grant read-only API access is unvalidated and gates A's real reach (Stack-Research §6.2).
- **On-prem capture-recipe feasibility:** Signed, read-only AD / file-server / endpoint dump scripts that owners will actually run are not yet confirmed (Stack-Research §6.4) — this gates C's moat.
