# Planner → SCRE: Repackaging, UX, Stack Coverage & Per-Sub Engagement

**Can CES Planner become the assess-subs engine, and what has to change?**
**Date:** June 10, 2026 · **Classification:** Internal — product/strategy
**Basis:** `analysis/product-analysis-planner.md` (Planner is browser-only, offline, single-advisor, 8-module artifact chain, 22 knowledge banks). Companion to `BHD-Assess-Subs-Capability.md`, `BHD-Assess-Subs-Build-Spec.md`.

---

## 0. What Planner is today (the starting point)

A single-advisor, offline, browser desktop tool that takes **one** client from strategic intent → readiness assessment → a full M365/GCC-High implementation plan, ready to hand to Stamper. Artifact chain: **SIT → CUI Boundary → BTC → TCP → Policy Inputs → RRT (assessment) → MPT (mission plan) → 18 policies.** No auth, no multi-tenancy, no production persistence (disk save is dev-mode only; each browser profile has its own IndexedDB).

It was built to *prepare and build one tenant*. SCRE needs to *assess many subs and report to a prime*. Those are different jobs that share one spine — the readiness assessment.

---

## 1. How to repackage it as SCRE — split the assessment spine from the build spine

Planner has two halves. SCRE Tier 1 needs only the first.

**Assessment spine — keep, front-and-center (this IS the assess-subs product):**
- **SIT (lite)** — scope: target L2, CUI presence, stack. Trim to the essentials.
- **CUI Boundary** — who/what touches CUI → defines scope and the CUI-user count (the coefficient).
- **RRT** — the readiness assessment: Preamble → Bulk Answer Derivation → Deep Dive + evidence → **Readiness Posture** (per-requirement met/partial/not_met/unknown, key findings). This is the score.
- **Policy Inputs** — light org metadata.
- **Evidence collection, Traceability, Exclusions** — the audit trail behind the score.

**Build spine — defer / make optional (Tier 2 only, when a sub converts):**
- **TCP** (tenant config profiling — M365-tenant-shaped), **MPT Mission Plan / Tenant Manifest / Infrastructure Manifest**, **Stamper handoff**, **18 policy docs**. These are *remediation and build* outputs — relevant only when a sub becomes a BHD GCC-High enclave. They are not needed to tell a prime where a sub stands.

**What's net-new for SCRE (the wrapper, per the build spec):**
- **Cohort mode** — Planner is single-customer today; SCRE assesses dozens. Need multi-sub orchestration.
- **Prime roll-up** — aggregate each sub's Readiness Posture into a RAG board (Planner has no cross-customer view; its "file manager" is per-customer).
- **SPRS scoring** — the Posture gives statuses; add the NIST 800-171 DoD score (weights 1/3/5) on top for the standard number primes expect.
- **Machine-readable Posture export** — for the normalizer/roll-up (today exports are HTML/DOCX/CSV/JSON artifacts; confirm a clean Posture JSON export exists).
- **Persistence + multi-user backend** — see §5; the single biggest lift.

**Net:** SCRE = "Planner, assessment-only, multi-sub, prime-reported." The Readiness Posture artifact already *is* the per-sub readiness record from the build spec — we're wrapping it, not rebuilding it.

---

## 2. Does it handle non-MS stacks? — yes by design; only Microsoft is built out

Correcting the obvious first read: Planner is **not** an M365 tool with a stack-agnostic veneer. Its early architecture is **deliberately vendor-pluggable / multi-stack** — the abstraction, the routing inputs, and the binding layer are all laid out to support many stacks. **It has simply been built out for one (Microsoft 365 / GCC High).** Extending to other stacks is *content authoring*, not re-architecture. Three layers make this concrete:

**(a) Vendor-neutral abstraction — the spine is already stack-independent.**
- CMMC Requirements Store (110 reqs + objectives), Assessor KB, Evidence Archetype Catalog — framework-level.
- **Implementation Patterns** — what each practice requires, organized by **capability domain** and action type (configure/customize/manual) — keyed to *capability*, not vendor.
- **Capability Taxonomy** — a *hierarchical vendor capability classification*, designed to classify any vendor's capabilities.
- **Tech Stack Compliance Mapping** — *capability → requirement* mappings, multi-vendor by construction.

**(b) Stack-routing inputs — the questions already ask which stack.**
- SIT captures target level, CUI presence, boundary strategy, and **deployment posture**; the problem statement itself frames everything around "implementation nuances that vary based on the organization's **technology stack, deployment model, cloud environment**."
- TCP carries `infrastructure_model` (`m365_only` | `m365_sentinel` | `m365_azure` …) and `cloud_environment` (`gcc` | `gcc_high` | `dod`). The gap classifier already reasons about controls "not available in the **current technology stack configuration**," and classes controls `automated` / `manual` / `nonstack`.

**(c) Pluggable vendor binding — only Microsoft authored.**
- The **Vendor Playbook is vendor-namespaced** (`vendor playbook Microsoft 365.yaml`) with a generic schema (`action_id`, `signal: configure|customize|manual`, `<vendor>_service`, `implementation`).
- The Bulk Answer Derivation engine (`deriveActionStatuses()`) takes implementation patterns **and the vendor playbook as parameters** — swap the playbook and it derives for another stack. The engine is not hard-wired to Microsoft; the *content* is.
- The business model already prices this: **"custom vendor playbooks for non-Microsoft stacks — $10–50K"** is a planned line item. Multi-stack was always the intent.

**What this means for SCRE:**
- Assessing subs **on any stack is design-native**, not a stretch. The accelerator behaving as "M365-only" today is a *content gap (one playbook authored)*, not an architectural limit.
- **Even before more playbooks exist**, a non-M365 sub is assessable at the framework level via the deep-dive (a valid score, just slower).
- **The real unlock** is authoring the vendor playbooks the architecture already expects — AWS GovCloud, Google Workspace, on-prem — each a ~$10–50K content effort that restores 60–80% auto-derivation for that stack. Prioritize by the actual sub population (note: many DIB subs sit on *commercial* M365, which is distinct from GCC High — a near-neighbor playbook variant; they'll correctly score low until they remediate).
- Only the **build/remediation** outputs (TCP profiling, Mission Plan, manifests, Stamper) are intrinsically M365/GCC-High — and that's fine, because those only matter once a sub converts to a BHD GCC-High enclave (Tier 2).

---

## 3. UX — what must improve for SCRE

Planner's UX was built for *a VFS advisor sitting next to one client*, dense with expert guidance panels. SCRE changes the user, the count, and the cooperation level. Priorities:

1. **A self-serve / low-expertise mode.** Subs (often non-technical owners) may answer themselves. Needs plain-language questions, progressive disclosure, "I'm not sure" handling, and save/resume — distinct from today's advisor-interpreted wizard.
2. **A fast-assessment path.** The full SIT→CUI→BTC→TCP→RRT chain is heavy for a readiness scan. Offer a lean path: SIT-lite → RRT preamble → bulk derivation → deep-dive only on high-weight gaps. (BTC/TCP optional.)
3. **A cohort/portfolio console** for the BHD operator and the prime — Planner has no cross-customer view today. RAG board, status tracking, drill-down.
4. **Plain-language results for the sub.** "You're at 62/110; close these three high-weight gaps." Turn the Posture into something an owner understands and acts on.
5. **Evidence upload for non-technical users** — simpler than the current advisor-oriented collector.
6. **Per-prime branding + invite/reminder flow** — the assessment arrives as the prime's program.
7. **Two visible lanes by stack** — M365 (fast, auto-derived) vs. non-M365 (guided manual) so expectations and effort are clear up front.

---

## 4. The per-sub engagement process

Designed around the repackaged Planner, with two lanes (by stack) and two modes (self-serve vs. BHD-assisted):

1. **Nominate & invite** — prime names the sub; BHD sends a branded assessment link (self-serve) or schedules a concierge session (assisted).
2. **Triage pre-fill** *(optional, Cobalt Talon)* — detect cloud posture (M365 vs other) and certs → pre-populate the preamble and **route the lane**: M365 → fast/auto; non-M365 → guided manual.
3. **Scope (SIT-lite + CUI Boundary)** — target L2, who touches CUI, what stack (~10–15 min). Drives the CUI-user count.
4. **Preamble (5 questions)** — license tier, security archetype, endpoint, monitoring, policy state.
5. **Assess** — *authored-stack lane (M365/GCC-High today):* Bulk Answer Derivation auto-fills 60–80%; sub/operator accepts or overrides. *Not-yet-authored-stack lane:* guided deep-dive control-by-control — valid score, slower — until that stack's vendor playbook is authored (then it joins the fast lane).
6. **Deep-dive + evidence** on high-weight and uncertain controls.
7. **Posture → score** — generate the Readiness Posture + SPRS-style score + ranked gap list.
8. **Two outputs** — the **sub** sees its score and "what moves you up a rung"; **BHD** gets the structured Posture → feeds the **prime roll-up**.
9. *(Optional)* **Validation** — BHD reviews inputs + samples evidence (Rung 2).
10. *(Optional)* **Conversion** — not-ready subs offered a GCC-High enclave (Tier 2).
11. **Re-assessment scheduled** — periodic re-run (Tier 3 assurance).

**Rough effort:** M365 self-serve ~30–60 min; non-M365 or assisted ~2–4 hours. The whole loop produces the per-sub readiness record the build spec defines.

---

## 5. The one hard dependency to flag

Planner today has **no production persistence and no multi-user/multi-tenant backend** — by deliberate design (offline, single-advisor; disk save is dev-only). SCRE's cohort assessment + prime roll-up + continuous re-assessment **require** persistence and multi-user access. Two paths:

- **MVP (concierge, now):** run Planner per sub as-is, export each Posture, aggregate manually into the prime board. Proves the product with zero backend work.
- **Productized (Phase 2+):** add a persistence + multi-user backend and the cohort console. This is the gating engineering item — and it's currently marked "not planned" in Planner, so it's a deliberate decision, not a quick toggle.

---

## 6. Bottom line

- **Repackage = expose Planner's assessment spine (SIT-lite → CUI → RRT → Posture), hide the build spine (TCP/MPT/Stamper) behind Tier-2 conversion.** The Readiness Posture is already the per-sub record.
- **Non-MS stacks: multi-stack by design, built out only for Microsoft.** The vendor-neutral abstraction (capability taxonomy, tech-stack mapping, implementation patterns), the stack-routing inputs (deployment posture, `infrastructure_model`, `cloud_environment`), and the pluggable vendor-playbook binding all already exist. Any stack is assessable today (framework deep-dive); authoring a per-stack vendor playbook (~$10–50K each) restores the 60–80% auto-derivation. This is content, not re-architecture — and a strong SCRE differentiator.
- **UX: add self-serve, a fast path, a cohort/prime console, and plain-language results.**
- **Per-sub engagement: a two-lane (stack), two-mode (assist) flow ending in a score + a prime roll-up entry.**
- **The gating build item is persistence + multi-user — concierge MVP first, backend second.**
