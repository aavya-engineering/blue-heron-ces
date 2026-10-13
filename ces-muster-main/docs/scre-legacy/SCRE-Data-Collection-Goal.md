# SCRE — Data Collection Goal: Service-Inventory-First Approach

**Date:** 2026-06-21
**Classification:** Internal — product/strategy
**Companion to:** `SCRE-Goal-and-Three-Approaches.md`, `SCRE-Approach-Decision-Summary.md`

---

## 1. The Goal

Find the best way to leverage our three available data-collection approaches — A (Connected Posture Harvest), B (Adaptive Intent Interview), and C (Guided Evidence Capture) — to acquire stack-configuration truth at minimum customer UX cost (50%), maximum data quality (30%), and minimum BHD LOE (20%). The winning method is the one that collects the most accurate picture of a sub's actual security stack in the least time, with the least cognitive burden on the sub's owner.

---

## 2. Why the Linear Question March is Suboptimal

The current Muster sub experience (SCRE-Muster-Sub-Experience-Mockup.html) demonstrates a sound pattern: one question at a time, narrowing counter on the right, progressive disclosure based on answers. It is honest, un-jargony, and intelligently skips inapplicable questions. It is, however, fundamentally linear — the sub moves question by question down a pre-ordered list, with pruning applied after each answer.

**The structural problem with linearity:** the sub's mental model of their own environment is not linear. A security-aware owner thinks in terms of the tools they use, not the controls they satisfy. Asking "Is CUI encrypted at rest?" before the sub has declared which storage system they use is premature. Asking about MFA policy before establishing whether they use Entra ID, Okta, or something else makes the question harder to answer and makes the answer less specific. The linear march forces the question engine to cover every possible configuration path in sequence, even when the sub has already implicitly revealed — by naming a product — that entire branches of the tree do not apply.

**What a service/capability-inventory-first model buys:**

- **Branch pruning by the bundle, not the question.** When a sub says "we use Microsoft Defender for Endpoint," they have simultaneously answered or eliminated a dozen downstream questions (is endpoint protection deployed, is it centrally managed, is threat detection enabled, is it integrated with Entra, etc.). Naming a service prunes a cluster. Marking a service absent (e.g., "we don't have a SIEM") collapses the entire logging-and-monitoring question branch in one tap. The counter does not shrink one question at a time — it drops in chunks.

- **Intuitive mental model.** A sub owner knows their tools. "What firewall product do you use?" is a question they can answer immediately. "Do you enforce egress filtering on outbound traffic?" requires them to translate from their knowledge of their product to a control concept they may not recognize. Starting with the service inventory lets the engine do the translation.

- **Natural routing surface for A/B/C.** The service inventory is exactly the surface the router needs. For each service tile: if Approach A can auto-detect it (Microsoft Graph confirms Defender is deployed), the tile is pre-filled. If it cannot, Approach B asks the sub to name it. If the named product requires evidence to validate its configuration (e.g., a DLP policy export), Approach C kicks in. The inventory is the router's interface — not a separate step before the interview, but the primary collection surface itself.

- **Fewer total questions.** Absent services eliminate their entire question clusters. Named specific products (Sentinel vs. a third-party SIEM) swap in a product-specific question set smaller than the generic set, because product-specific facts reduce ambiguity.

---

## 3. The Service Taxonomy: CMMC-Relevant Capability Domains

The following capability domains map directly to CMMC Level 2 practices and to the products a GCC High sub would recognize. Each is a tile in the service inventory. Naming a product or marking absent prunes the downstream question set.

| # | Capability Domain | Example Products (GCC High-first) | Absent Prunes | Named Product Prunes |
|---|---|---|---|---|
| 1 | **Identity & SSO** | Entra ID (Azure AD), on-prem AD, Okta | Eliminates SSO, conditional-access, and identity-governance questions (~18 Qs) | Entra ID named: auto-fills conditional access policy facts via Graph |
| 2 | **Endpoint Protection / AV** | Microsoft Defender for Endpoint, CrowdStrike, SentinelOne, no tool | Absent: collapses endpoint detection, EDR, and device compliance questions (~14 Qs) | Defender for Endpoint: auto-fills via Intune/Graph; third-party: Approach C recipe |
| 3 | **Email & Collaboration** | Exchange Online (GCC High), Outlook/Teams, Google Workspace, no cloud email | Absent: eliminates email-borne CUI, DLP-on-email, anti-phishing questions (~10 Qs) | Exchange Online: auto-fills transport rules, safe-links, anti-phishing via Graph |
| 4 | **Firewall / Network Perimeter** | Azure Firewall, Palo Alto, Fortinet, Meraki, Windows Defender Firewall only, no dedicated firewall | Absent/WDF-only: scoped to host-based controls only (~6 Qs remain vs. ~16) | Named product: swaps in product-specific config question set |
| 5 | **SIEM / Logging & Monitoring** | Microsoft Sentinel, Splunk, Sumo Logic, no SIEM | Absent: marks AU.L2-3.3.x cluster as needs-specialist; collapses correlation questions (~12 Qs) | Sentinel: auto-fills workspace retention, alert rules via Graph; third-party: Approach C log-export recipe |
| 6 | **Multi-Factor Authentication** | Entra MFA / Conditional Access, Duo, TOTP app, no MFA | Absent: immediate high-weight flag; IA.L2-3.5.3 cluster unresolvable without specialist (~8 Qs) | Entra CA named: auto-fills via Graph; Duo: Approach B targeted Qs |
| 7 | **Data Loss Prevention (DLP)** | Microsoft Purview DLP, no DLP tool | Absent: collapses data-classification and exfiltration-detection questions (~9 Qs) | Purview: auto-fills enabled policies via Graph; absent: narrows to manual-process Qs |
| 8 | **Backup & Recovery** | Azure Backup, Veeam, Acronis, no dedicated backup | Absent: immediate flag on RE.L2-3.8.9; backup configuration questions scoped to on-prem only if applicable (~7 Qs) | Named: Approach B targeted policy Qs |
| 9 | **Mobile Device Management (MDM)** | Microsoft Intune (GCC High), Jamf, no MDM | Absent: collapses device-compliance, remote-wipe, and BYOD questions if declared cloud-only (~11 Qs) | Intune: auto-fills device policy facts via Graph |
| 10 | **On-Premises / OT Systems** | Windows Server / AD on-prem, CNC machines, PLCs, file servers, none | Absent: eliminates the entire on-prem/OT branch (Approach C recipe cluster); switches off ~40 Qs | Present: routes to Approach C capture recipes per on-prem sub-type |

**GCC High stack note.** The inventory is ordered for the GCC High-first sub. Services 1–3 and 6 are almost always present in GCC High; Approach A pre-fills them. Services 4, 5, 7, 8 are common but vary by product; the inventory's named-product path determines whether Approach A, B, or C handles them. Service 10 (on-prem/OT) is the critical branch-point — its presence routes to the Approach C recipe flow.

---

## 4. How the Three Approaches Compose Per Service

The service inventory is the router's surface. For each tile, the composition works as follows:

**Approach A (Connected Harvest) — pre-fills the inventory.** Before the sub interacts with a single tile, Approach A's read-only OAuth harvest populates every tile it can reach: Entra ID configuration, Defender for Endpoint enrollment, Intune device compliance, Exchange Online policies, Purview DLP policy status, Sentinel workspace presence. These tiles arrive pre-filled with a green "auto-detected" badge. The sub confirms or overrides, not discovers.

**Approach B (Adaptive Interview) — confirms and fills gaps service by service.** For tiles Approach A cannot reach (third-party products, on-prem adjacent, products not in the Graph permission set), the interview focuses its questions within the context of the named service. "You said you use Duo for MFA — does it cover all users, or only remote access logins?" is a sharper, faster question than "Do all users authenticate with a second factor?" The interview's information-gain selection still applies, but now within a named-product context that reduces ambiguity.

**Approach C (Guided Evidence Capture) — covers what neither can.** For services that require artifact-backed validation — on-prem file-server ACLs, CNC network isolation, third-party SIEM log retention exports, DLP policy screenshots from non-Graph-accessible platforms — the inventory tile routes directly to a targeted Approach C capture recipe. The recipe is pre-scoped to the named product and objective. The inventory tile status changes from "needs evidence" to "confirmed" when the artifact is received and extracted.

**The inventory as the merge surface.** At the end of the inventory pass, every tile has a provenance badge: Machine (A), You told us (B), or Needs evidence (C). The router has already done its work. The downstream fact-merge and derivation engine sees a richer, more specific input set than the linear model delivers, and it receives it faster.

---

## 5. Open Questions and Risks

**Services a sub does not recognize by name.** Some subs, particularly very small manufacturers, may not know the specific product names behind their IT setup. "I have email" is not the same as naming Exchange Online vs. Google Workspace vs. a hosted solution. Mitigation: tile options include both named products and descriptive fall-throughs ("Microsoft cloud email" → probes for GCC vs. commercial before routing). The "I'm not sure" option routes to a specialist, as in the linear model.

**One product spanning multiple capability domains.** Microsoft Defender is simultaneously endpoint protection, email filtering (Defender for Office 365), and network detection (Defender for Identity). A sub naming "Microsoft Defender" in the endpoint tile may be describing a different product than the one relevant to the email tile. Mitigation: product disambiguation at the tile level — the tile for email protection asks specifically about Defender for Office 365 vs. Exchange Online Protection vs. a third-party gateway, even if the sub named "Defender" in a prior tile. Display brief parenthetical product descriptions under each named option.

**Pruning a branch the sub wrongly thinks is absent.** The highest-risk scenario: a sub marks "We don't have a SIEM" when they do have Sentinel enabled as part of their GCC High tenant. Mitigation: Approach A's harvest runs before the inventory and can override an "absent" tile if Graph reveals the service is present. For services Approach A cannot reach, the "absent" selection generates a brief confirmation prompt ("Are you sure? Many GCC High tenants have this enabled by default in their plan") before committing the prune. A conservative fallback: tiles marked absent that carry high-weight CMMC practices are flagged for specialist confirmation rather than silently pruned.

**Cognitive load of the inventory board.** Presenting 10 tiles at once may feel heavier than one question at a time. Mitigation: group tiles into logical sections (Identity & Devices / Email & Collaboration / Network & Detection / Backup & On-Prem) presented progressively, not all simultaneously. The "questions eliminated" counter is displayed at section level — "Confirming these 3 tiles just switched off 42 questions" — making the efficiency visible and motivating.

**Order effects on confidence.** A sub who fills in the inventory before the interview may answer interview questions differently than one who was interviewed first. This is the desired effect — the inventory provides context — but it means the confidence model must account for inventory-sourced priors when calibrating interview answer confidence.
