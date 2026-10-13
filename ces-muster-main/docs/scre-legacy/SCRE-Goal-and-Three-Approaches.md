# SCRE → Business Model + Custom Tool: Goal & Three Greenfield Approaches

**Refining the SCRE concept into a productized business model supported by a custom software system.**
**Date:** June 13, 2026 · **Classification:** Internal — product/strategy
**Grounded in:** `CES-MODULE-MAP.md` (Planner = `ces-planner`; intent = `SIBaseline`; engine =
`deriveActionStatuses()`), `BHD-Planner-as-SCRE.md`, `BHD-SCRE-Engagement-Flow.md`,
`BHD-Supply-Chain-Readiness-Evaluator.md`. **Stance:** greenfield design; Planner is reference, not foundation.

---

## 1. The goal (one paragraph)

Build a custom software system that takes a **generalized intent** (target compliance posture for a
specific framework) and a **specific technology stack**, then *works through every question that
actually matters for that intent on that stack*, produces an **implementation plan**, and surfaces
the **gaps** — at a level of accuracy a small consulting + security firm can stand behind, delivered
mostly **self-service**, at a **cost-to-deliver low enough that BHD stays small while serving many
clients.** The business model this unlocks: sell the assessment as a standalone, repeatable product
(across a prime's whole sub-tier, or direct), convert the not-ready into managed remediation, and
keep a continuous-assurance annuity — without headcount scaling with volume.

## 2. The reframe that decides everything: stack-config-data acquisition

Per the chosen weighting, the differentiator is **how stack-configuration data gets collected** —
**customer UX to gather it (50%) · quality of the gathered data (30%) · BHD effort to collect it (20%).**
This is correct and load-bearing: the derivation engine is only as accurate as its inputs. Today the
inputs are self-attested through an advisor-oriented wizard (SIT scope/dependencies + RRT preamble +
TCP). Self-attestation is cheap but low-quality; advisor-collected is high-quality but high-LOE. **The
innovation is escaping that trade-off** — getting high-quality stack-config data with great self-service
UX and near-zero BHD effort. The three approaches below are three *truth sources* for that data, placed
along the human-in-the-loop spectrum.

Everything downstream of acquisition is shared (see §3), so the approaches compete only on acquisition.

## 3. Shared foundation (constant across all three approaches)

1. **Generalized Intent Object** — refactor "intent" from the CMMC-shaped `SIBaseline` into a
   framework-agnostic schema: `{ framework, target_posture, scope, data_sensitivity, stack[],
   obligations, governance }`. CMMC L2 becomes the first *intent pack*; FedRAMP / NIST 800-53 / SOC 2 /
   ISO 27001 / HIPAA are later packs — **content, not code** (the same way the vendor playbook is
   already a swappable parameter to the engine).
2. **Intent Compiler** — turns an intent pack + the detected stack into (a) the *minimum set of
   questions/probes that still change the answer* and (b) the evidence each requirement needs. This is
   what makes "every question that matters to a specific intent and stack" computable rather than
   hand-authored per framework.
3. **Capability/requirement spine** — reuse the proven *pattern* (Capability Taxonomy → Implementation
   Patterns → requirement objectives), rebuilt clean and vendor-neutral.
4. **Derivation + plan back-half** — config facts → status per objective (with **provenance +
   confidence** on every fact) → gap list → prioritized plan + score. One engine; three front-ends.

> Design rule: **every config fact carries where it came from and how sure we are.** Accuracy isn't a
> single number — it's a per-fact confidence the score, the plan, and the human-in-loop routing all read.

---

## 4. The three approaches (three sources of stack-config truth)

### Approach A — **Connected Posture Harvest** (machine truth · API connectors)
**Concept.** Instead of asking humans about config, connect read-only to the stack's own APIs
(Microsoft Graph, Google Workspace Admin SDK, AWS Config/Security Hub, Okta, Entra, Intune…) and
**harvest the live configuration directly**. Customer UX to gather = a guided, scoped **read-only OAuth
consent** per detected stack; the machine does the rest.
**What's innovative.** A generalized **Capability Probe SDK**: each connector maps a vendor's API
responses → capability-taxonomy facts → requirement objectives, with provenance. New stack = author
probes, not touch the engine. Continuous re-harvest *is* the Tier-3 assurance annuity, for free.
**50/30/20 fit.** UX-to-gather: very high (one consent flow). Quality: **maximal** (machine truth).
BHD LOE: **near-zero** after the connector exists. Best-scoring approach — for connectable stacks.
**Spectrum position.** Self-service end; humans on exceptions only.
**Limits / risks.** Consent friction and trust ("why does it need access?"); covers cloud/SaaS config
but is blind to process, physical, on-prem, and BYOD controls; per-vendor API maintenance burden.

### Approach B — **Adaptive Intent Interview** (conversation truth · AI-native question graph)
**Concept.** A generalized, **plain-language interview** that the Intent Compiler personalizes: it asks
only the questions whose answers still matter for this intent+stack, adapts as answers arrive
(progressive disclosure, branch pruning), handles "I'm not sure," and interprets free text / pasted
snippets / screenshots into structured config facts — each with a **confidence**.
**What's innovative.** The question graph is *computed* from the generalized intent + taxonomy +
objectives (framework-agnostic), not authored per framework; an LLM **config interpreter** turns
owner-language into facts, and **next-question selection by information gain** means the fewest possible
questions. This is where the 50% "customer UX to gather" lever is maximized.
**50/30/20 fit.** UX-to-gather: **maximal** (fewest, clearest, conversational). Quality: medium
(self-report) but lifted by confidence scoring + targeted follow-ups on the high-weight/uncertain
objectives. BHD LOE: low.
**Spectrum position.** **The tunable middle** — pure self-serve, or auto-route low-confidence answers
to an advisor. This is where to *explore* the human-in-loop knob.
**Limits / risks.** Self-attestation bias; needs hard guardrails so the model never invents compliance;
confidence calibration is the make-or-break.

### Approach C — **Guided Evidence Capture** (artifact truth · capture recipes + ingestion)
**Concept.** For everything APIs can't reach, hand the customer an exact **capture recipe** per
objective — "run this read-only script and paste the output," "drag your DLP export here," "upload your
access-control policy," "snap this screen" — then an **ingestion pipeline** (parse / OCR / LLM-extract)
turns artifacts into structured config facts *and keeps the signed artifact as the audit trail.*
**What's innovative.** A generalized **evidence-archetype → capture-recipe → extractor** mapping. The
same artifacts that *prove* the score become the **C3PAO/assessor evidence package** — collection and
audit-prep are one step. Read-only config-dump scripts deliver near-API-quality data **without granting
live access** (a lower trust barrier than A).
**50/30/20 fit.** UX-to-gather: medium-high (more effort than a question, but fully guided). Quality:
**high** (artifact-backed, not attested). BHD LOE: low (customer captures, machine extracts; BHD samples
to validate).
**Spectrum position.** Middle — BHD validation sampling (an assurance "rung") fits naturally here.
**Limits / risks.** Capture effort → dropout risk; extraction accuracy on messy artifacts; script trust
("what does this script do?" — mitigate with open, signed, read-only scripts).

---

## 5. They compose — and the composition is the product

The winning system is not one of these; it's a **router** (the same idea as SCRE's lane/mode routing)
that, per capability/objective, picks the **highest-truth source available at acceptable effort**:

```
detect stack → for each objective:
   API probe available?  → Approach A (machine truth)        [highest accuracy, lowest LOE]
   else capturable?      → Approach C (artifact truth)        [high accuracy, low LOE]
   else                  → Approach B (interview, confidence) [max coverage, medium accuracy]
→ merge facts (provenance + confidence) → derive status → gaps → plan + score
→ route only low-confidence / high-weight items to a human (the LOE knob)
```

This directly serves the three product criteria:
- **High accuracy** — prefer machine/artifact truth; confidence-gate the rest; humans touch only the
  items that move the score.
- **Self-service** — A is a consent click, B is a conversation, C is guided capture; an owner can
  complete any of them alone.
- **Cost-effective / stays small** — BHD LOE is bounded to exceptions and validation sampling, not the
  whole assessment; connectors/extractors are build-once, reuse-across-every-client assets.

## 6. Recommendation & what to prototype first

1. **Generalized Intent Object + Intent Compiler** — the foundation that makes all three (and every
   future framework) possible. Build CMMC L2 as the first intent pack.
2. **Approach A connector for Microsoft 365** first — it scores highest on all of 50/30/20 for the
   dominant DIB stack, and BHD already has read-only Microsoft Graph queries proven in Stamper /
   AdminOps Domain E to mine for probe logic (reference only).
3. **Approach B as the universal fallback** — guarantees *any* stack/control is assessable day one,
   even before its connector/extractors exist.
4. **Approach C** to lift quality on non-API controls and to make the evidence package fall out for free.
5. Instrument every assessment with **per-fact confidence + source mix** so you can prove accuracy and
   tune where humans are still needed — that telemetry is the moat and the pricing basis.

## 7. Open questions for the next pass

- **Target framework order** beyond CMMC L2 (which intent pack second — FedRAMP? CMMC L1? SOC 2?).
- **Trust model for Approach A** — will buyers grant read-only API access, and through whom (prime-
  sponsored consent? per-sub)? This gates A's reach.
- **Where exactly to place the human-in-loop default** per approach (the area you want to explore) —
  do we ship pure self-serve and add advisors only on low-confidence, or concierge-first then automate?
- **Business model packaging** — is the unit sold the assessment, a per-stack "connector subscription,"
  the continuous-assurance annuity, or all three tiered (mirrors SCRE Tiers 1–3)?
```
