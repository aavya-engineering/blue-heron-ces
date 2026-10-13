# Plan: SCRE Service Inventory Mockup
**Date:** 2026-06-21
**Status:** READY FOR IMPLEMENTATION

## Objective
Build a single self-contained HTML mockup — `SCRE-Service-Inventory-Mockup.html` — that visually demonstrates the service-by-service branching hypothesis: a sub declares which security tools they use (or marks them absent), and the system instantly prunes whole clusters of downstream CMMC questions rather than asking questions one at a time. The mockup must look and feel like a direct sibling of `SCRE-Muster-Sub-Experience-Mockup.html`.

## Context Summary
- **From Review:** The existing mockup's CSS vars, component classes, and layout patterns are the design system to inherit. Key classes in play: `.card`, `.pad`, `.eyebrow`, `.pill`, `.src`, `.conf`, `.opts`/`.opt`, `.pbar`, `.narrowbox`, `.factrow`, `.pruneline`. Rail, topbar, and toast patterns are also reused.
- **CSS Source (RESOLVED — not a blocker):** The sibling CSS source file exists at `C:\Users\mhsut\DevProjects\scre\SCRE-Muster-Sub-Experience-Mockup.html`. The builder must open that exact file, locate the `<style>` block (approximately lines 8–408), and copy its entire content — CSS custom properties and all component class definitions — verbatim as the `<style>` block in the new file. Do not recreate or approximate these styles; copy them character-for-character and then append only the new inventory-specific rules below them.
- **From Research:** `SCRE-Data-Collection-Goal.md` defines 10 service domains, their named products, and their question-count deltas. 8 tiles are used; Backup & Recovery and MDM are deferred to a future iteration and are excluded from Q-count math. CMMC L2 practice IDs are realistic (AC.L2, IA.L2, AU.L2, SC.L2, etc.). GCC High stack is the primary scenario.
- **Constraints:** Single self-contained `.html` file, inline `<style>` + vanilla `<script>`, no frameworks, no external assets, no build system. Must open correctly in a modern browser from the local filesystem.

## Counter Math (CMMC L2 — Questions, not Practices)

**Unit: assessment questions** (not CMMC practices; CMMC L2 has 110 practices / 320 assessment objectives — do not surface either raw number in the UI. The side panel counter tracks "questions" as the unit visible to the user.)

### Per-tile default question counts and prune deltas

| Tile | Domain | Default Q-count (unresolved) | Pruned when absent / cloud-only | Pruned when named product resolved |
|------|--------|-----------------------------|---------------------------------|------------------------------------|
| 1 | Identity & SSO | 20 | 18 | 18 (auto-detected path) |
| 2 | Endpoint Protection / AV | 16 | 14 | 14 (auto-detected path) |
| 3 | Email & Collaboration | 12 | 10 | 10 (auto-detected path) |
| 4 | Firewall / Network Perimeter | 13 | 10 | 10 (auto-detected path) |
| 5 | SIEM / Logging & Monitoring | 14 | 12 | 12 (auto-detected path) |
| 6 | MFA | 10 | BLOCKED (cannot mark absent) | 8 (auto-detected path) |
| 7 | DLP | 11 | 9 | 9 (auto-detected path) |
| 8 | On-Prem / OT | 44 | 40 (cloud-only) | 0 (if present, no prune) |
| **Residual floor** | Governance / policy Qs that no service choice prunes | **10** | — | — |

**Sum of tile defaults (rows 1–8):** 20+16+12+13+14+10+11+44 = **140**  
**Residual floor (always present, never prunable):** **10**  
**Total starting pool: 140 + 10 = 150 questions**

**Starting counter shown in UI: 150**

**Demo scenario (all 8 tiles resolved with the "best case" GCC High stack — all Microsoft products + cloud-only on-prem):**
- Tile 1 (Entra ID): −18
- Tile 2 (Defender for Endpoint): −14
- Tile 3 (Exchange Online): −10
- Tile 4 (Azure Firewall): −10
- Tile 5 (Sentinel): −12
- Tile 6 (Entra MFA): −8
- Tile 7 (Purview DLP): −9
- Tile 8 (cloud-only): −40
- **Total pruned: −121**
- **Remaining: 150 − 121 = 29 questions** (residual floor 10 + 19 product-specific follow-ups across tiles)

**The side panel breakdown table reads:**
- Starting pool: 150 questions
- Switched off by your inventory: −N (live, updates per tile)
- Remaining to assess: N (live)

Do NOT show "CMMC L2 practices: 320" or any raw CMMC practice/objective count. Show only the question-unit numbers above.

**Consistency rule in JS:** `remaining = 150 − sum(qdelta for each resolved tile)`. The `qdelta` for each product option is defined in the TILES array (see Architecture Decisions). `remaining` must never drop below 10 (the residual floor is hardcoded as non-prunable).

## Interaction to Build

### Layout
- **Sticky topbar:** same Muster topbar pattern (navy gradient, heron SVG, "Muster · readiness check by Blue Heron Defense" wordmark, save chip).
- **Explanatory band:** immediately below topbar (not in a step card), full-width navy "reframe" band with headline and one sentence: frame this as "service-by-service, not one-at-a-time."
- **Two-column layout below the band:** left = inventory grid (70% width); right = sticky side panel (30% width). On mobile (max-width: 840px), stack vertically.

### Left: Service Inventory Grid
- An `<h2>` eyebrow: "Step 1 of 2 · Your security services"
- A subtitle: "Tell us which tools you use. Each answer switches off whole blocks of questions."
- Grid of **8 service tiles**, 2 columns on desktop, 1 on mobile. Each tile is a `.card` with:
  - **Domain label** (e.g., "Identity & SSO") — eyebrow style
  - **Short plain-English description** of what this domain covers (one line)
  - **Product selector:** a row of named option buttons (`.opt` style) — 3–4 named products + "We don't use this" + "Not sure". Selecting an option:
    - Marks the tile as resolved (add a `.resolved` class, show a green check on the tile header)
    - Updates the live counter in the side panel
    - If "We don't use this" is selected, the tile background shifts to a light grey and a teal pruneline banner appears inside the tile showing how many questions just switched off
    - If a specific product is named, the tile shows provenance badge(s) (see dual-badge spec below)
  - **Provenance badges — Dual-badge rule:** Each product renders its badge(s) as one or two `.src` pills displayed left-to-right immediately after the product label. The TILES array product object uses a `badges` field (array, not a single string) containing 1 or 2 badge codes. Render each code as a separate pill: `"A"` → `.src.machine` green "auto-detected"; `"B"` → `.src.interview` blue "you told us"; `"C"` → `.src.artifact` amber "needs evidence". For dual-badge products (e.g. CrowdStrike tagged `["B","C"]`) render two pills side by side — the B pill first (blue), then the C pill (amber). Never collapse dual badges to a single pill; both must be visible simultaneously.
  - **Question-delta annotation:** small line inside the tile (visible once a selection is made) showing e.g. "Switched off 14 questions" in teal, or "Added 3 specific questions" in amber.

### The 8 Service Tiles (content spec)

**Tile 1 — Identity & SSO**
- Products: Entra ID (Azure AD) [A], On-premises Active Directory [C], Okta [B], We don't use this, Not sure
- Entra ID: badges: ["A"], "Switched off 18 questions — we'll read your policies directly"
- On-prem AD: badges: ["C"], "3 questions added — we'll need a read-only AD export"
- Absent: "Switched off 18 questions — no SSO in scope"

**Tile 2 — Endpoint Protection / AV**
- Products: Microsoft Defender for Endpoint [A], CrowdStrike [B+C], SentinelOne [B+C], We don't use this, Not sure
- Defender: badges: ["A"], "Switched off 14 questions — we'll read your Intune enrollment"
- CrowdStrike: badges: ["B","C"], "2 specific questions added — config export required"
- SentinelOne: badges: ["B","C"], "2 specific questions added — config export required"
- Absent: "Switched off 14 questions" + prominent amber flag: "Endpoint protection is a high-weight CMMC control — confirm with a specialist before marking absent"

**Tile 3 — Email & Collaboration**
- Products: Exchange Online / GCC High [A], Google Workspace [B], Other hosted email [B], We don't use this, Not sure
- Exchange Online: badges: ["A"], "Switched off 10 questions"
- Google Workspace: badges: ["B"], "7 questions remain — tailored to Google"
- Absent: unusual flag + specialist note

**Tile 4 — Firewall / Network Perimeter**
- Products: Azure Firewall [A], Palo Alto / Fortinet [B+C], Meraki [B+C], Windows Firewall only [B], We don't use this
- NOTE: "Not sure" is intentionally omitted from Tile 4 — every org has some perimeter stance and must make an explicit choice.
- Azure Firewall: badges: ["A"], "Switched off 10 questions"
- Palo Alto / Fortinet: badges: ["B","C"], "4 specific questions added — config export required"
- Meraki: badges: ["B","C"], "4 specific questions added — config export required"
- Windows Firewall only: badges: ["B"], "Switched off 6 questions — host-based controls only"
- Absent: high-weight flag

**Tile 5 — SIEM / Logging & Monitoring**
- Products: Microsoft Sentinel [A], Splunk [B+C], Sumo Logic [B+C], We don't use this, Not sure
- Sentinel: badges: ["A"], "Switched off 12 questions"
- Splunk: badges: ["B","C"], "3 specific questions added — log retention export required"
- Sumo Logic: badges: ["B","C"], "3 specific questions added — log retention export required"
- Absent: collapses AU.L2-3.3.x cluster, "12 questions switched off — AU.L2 cluster flagged for specialist"

**Tile 6 — Multi-Factor Authentication**
- Products: Entra MFA / Conditional Access [A], Duo Security [B], Authenticator app (no SSO) [B], We don't use this
- Entra CA: badges: ["A"], "Switched off 8 questions — we'll read your Conditional Access policies"
- Duo: badges: ["B"], "3 targeted questions about coverage scope"
- **Absent routing UI:** "We don't use this" is rendered as a visually disabled button (`.opt` with `opacity: 0.45`, `pointer-events: none`, `cursor: not-allowed`). Clicking or hovering it shows a tooltip: "MFA cannot be marked absent." Simultaneously, an inline amber banner renders inside the tile (a `<div class="mfa-warn">` styled with amber left border, amber background tint, bold amber text: "IA.L2-3.5.3 requires MFA — this tile routes to a specialist. Select a product above or contact your readiness advisor."). The tile does NOT resolve and the counter does NOT change when this banner is visible. The tile badge flips to an amber pill labeled "needs specialist". This is the concrete UI for "routes to specialist."

**Tile 7 — Data Loss Prevention (DLP)**
- Products: Microsoft Purview DLP [A], We handle this manually [B], We don't have DLP, Not sure
- Purview: badges: ["A"], "Switched off 9 questions"
- Manual / absent: "9 questions switched off — replaced by 2 process questions"

**Tile 8 — On-Premises / OT Systems**
- Products: Windows file server / AD [C], CNC or PLC shop-floor systems [C], Both [C], We're cloud-only (none)
- Default (unresolved) Q-count: 44
- Any present: badges: ["C"] (always routes to Approach C), "Read-only capture recipes will be provided for each system you named"
- Cloud-only: "Switched off 40 questions — on-prem branch removed" (qdelta: 40; 4 residual cloud-boundary Qs remain in pool)

### Right: Sticky Side Panel
The side panel has two sections:

**Section 1 — Live counter (top half)**
- Header: "Questions remaining" (matching `.narrowbox` style from the existing mockup)
- Large number showing questions remaining (start: **150**, decrement as tiles are resolved)
- Progress bar (`.pbar`) showing % of tiles resolved
- Subtitle: "Tiles resolved: X of 8"
- Below: a breakdown table — "Starting pool: 150 questions" / "Switched off by your inventory: −N" / "Remaining to assess: N" — updating live as tiles are resolved. Do NOT show any raw CMMC practice or assessment-objective count.

**Section 2 — Contrast panel (bottom half, separated by a divider)**
- Header: "vs. linear approach" in muted text
- A static mini-illustration: two side-by-side micro-lists
  - Left: "Linear" — 14 items in a vertical list, each a thin grey bar, no skips visible
  - Right: "Service-first" — 8 items in a vertical list, with strikethrough/greyed groups showing pruned clusters
- One-line caption: "Service-first prunes whole branches at once."

### Bottom: Continue Flow
- After all 8 tiles are resolved (or a "Skip remaining" button is hit), show a navy "Continue to focused interview" CTA button
- Below the CTA: a one-line summary of the provenance mix: "X auto-detected · Y you confirmed · Z need evidence"
- Clicking continue shows a second panel (same page, no navigation) labeled "Step 2 of 2 · Focused interview" that displays the 3 sample questions below — each visibly tagged to a specific tile and product

### Step 2 Sample Questions (exact text — do not invent alternatives)

**Question 1 — Endpoint tile, CrowdStrike path:**
> **CrowdStrike (Endpoint Protection)**
> "Does your CrowdStrike Falcon policy enforce real-time prevention mode (not just detection) on all devices in scope for CMMC? Attach your prevention policy export or confirm the setting name."

**Question 2 — Endpoint tile, Microsoft Defender path:**
> **Microsoft Defender for Endpoint (Endpoint Protection)**
> "Is your Defender for Endpoint onboarding scoped to your GCC High tenant only, or does it span a shared commercial tenant? We'll verify this against your Intune enrollment report."

**Question 3 — SIEM tile, absent / no-EDR path (routes to specialist):**
> **No EDR Selected (Endpoint Protection → Specialist Review)**
> "Your inventory indicates no endpoint detection tool is in place. IA.L2-3.14.2 and SI.L2-3.14.6 require active threat monitoring. A readiness specialist will contact you to assess compensating controls before this assessment can continue."

Each question card must display the tile label and product as a coloured eyebrow tag above the question text, and the associated CMMC practice ID (if present) as a small `.pill` below the text.

## File Inventory
| File | Action | Lines/Functions Affected |
|------|--------|------------------------|
| `C:\Users\mhsut\DevProjects\scre\SCRE-Muster-Sub-Experience-Mockup.html` | READ ONLY — CSS source | Copy entire `<style>` block verbatim into new file |
| `C:\Users\mhsut\DevProjects\scre\SCRE-Service-Inventory-Mockup.html` | CREATE | Full file — inline CSS + JS |

## Architecture Decisions
- **No step navigation / rail:** this mockup focuses on the inventory interaction only. Do not replicate the full 6-step Muster flow.
- **CSS vars inherited verbatim:** open `SCRE-Muster-Sub-Experience-Mockup.html`, copy the entire `<style>` block character-for-character. Add only new vars needed for the inventory (e.g., `--tile-resolved-bg`). Do not recreate from memory or from the partial var list below — use the actual file.
- **Provenance badges use `badges[]` array in TILES:** each product object in the TILES constant has `badges: ["A"]`, `badges: ["B"]`, `badges: ["C"]`, or `badges: ["B","C"]`. The render function maps each code to the correct `.src` class and pill label. No product has more than two badges.
- **`.pruneline` class — define explicitly:** this class may or may not exist in the source file. After copying the sibling CSS block, check whether `.pruneline` is defined. If it is present, use it as-is. If it is absent, append this definition in the new inventory-specific CSS section: `.pruneline { display:block; border-left: 3px solid var(--teal); background: rgba(15,122,108,0.07); color: var(--teal); font-size: 0.78rem; font-style: italic; padding: 6px 10px; border-radius: 0 6px 6px 0; margin-top: 8px; }`. This renders as a teal left-border band with small italic text inside the tile.
- **MFA absent UI:** the "We don't use this" option for Tile 6 is a disabled `.opt` button. The tile contains a `<div class="mfa-warn">` amber inline banner (amber left border, amber background tint). The tile badge becomes `<span class="src interview">needs specialist</span>` (amber pill). The tile does not add a `.resolved` class and the counter does not decrement.
- **Question-delta animation:** when a tile is resolved, the side panel counter animates the number decrement via a simple JS counter tick with CSS transition.
- **"We don't use this" greying:** tiles marked absent get `opacity: 0.65` on the product options, a `.pruneline` inside the tile, and a `.absent` class on the tile card that applies a subtle grey left border.
- **Tile data as a JS array:** define all 8 tiles as a `TILES` constant array at the top of the script. Each tile: `{ id, domain, desc, questions, products: [{label, badges:[], qdelta, note}] }`. The `questions` field holds the default unresolved Q-count per the table above. The render loop reads from this array — no tile-specific logic scattered in event handlers.
- **Counter floor:** `remaining = Math.max(10, 150 - totalPruned)`. The floor of 10 ensures the residual governance/policy questions are always visible even if all tiles are resolved.

## Testing Strategy
- Open the file from the local filesystem in Chrome and Firefox. No server needed.
- Resolve each of the 8 tiles in turn; confirm the counter decrements correctly for each.
- Verify counter starts at 150 and bottoms out at 29 (not below 10) when the full GCC High stack is selected.
- Mark Tile 8 (On-Prem) as "cloud-only"; confirm the counter drops by 40 (150 → 110 if only this tile is resolved).
- Mark Tile 6 (MFA) "We don't use this"; confirm the disabled button, amber `mfa-warn` banner, and "needs specialist" badge all appear; confirm the counter does NOT change.
- Name "Entra ID" in Tile 1; confirm the single green "auto-detected" badge appears.
- Name "CrowdStrike" in Tile 2; confirm TWO pills appear: blue "you told us" + amber "needs evidence" side by side.
- Click "Continue to focused interview"; confirm all 3 exact sample question strings appear, each with its tile/product eyebrow tag.
- Resize to 600px wide; confirm the grid collapses to 1 column and the side panel stacks below the grid.

## Out of Scope
- No actual API calls or data persistence of any kind
- No full 6-step Muster flow — this is the inventory concept demo only
- No Approach C capture recipe UI (the tile badge indicates "needs evidence"; the full recipe flow lives in the existing Muster mockup)
- No authentication / consent flow (Approach A pre-fill is simulated by marking tiles auto-detected when a Microsoft product is named)
- No PDF export or submission flow
- No animation libraries or external fonts
- No raw CMMC practice count or assessment-objective count displayed in the UI

## Acceptance Criteria
- [ ] File opens from local filesystem with no external network requests
- [ ] Design is visually indistinguishable in style from `SCRE-Muster-Sub-Experience-Mockup.html` (navy/amber/teal palette, same font stack, same card/pill/rail component shapes) — CSS copied verbatim from that file
- [ ] All 8 service tiles are present with named product options and "We don't use this" options; Tile 4 has no "Not sure" option (intentional)
- [ ] Selecting any product option resolves the tile and updates the live counter in the side panel within the same interaction (no page reload)
- [ ] Counter starts at 150 and never drops below 10
- [ ] Marking a tile absent shows a visible `.pruneline` inside the tile and a measurable counter drop
- [ ] Naming a Microsoft/GCC High product shows a single green "auto-detected" (Machine/A) badge
- [ ] Naming CrowdStrike or Splunk shows TWO pills side by side: blue "you told us" + amber "needs evidence"
- [ ] Marking Tile 8 (On-Prem) as present shows an amber "needs evidence" (Artifact/C) badge
- [ ] Tile 6 "We don't use this" is a disabled button; clicking it triggers the amber `mfa-warn` inline banner and "needs specialist" pill; counter does not change
- [ ] The side panel contrast section shows the linear vs. service-first visual at all times
- [ ] The "Continue to focused interview" button appears once all 8 tiles are resolved and reveals the 3 exact sample question strings specified in the plan
- [ ] Layout is responsive and usable at 375px viewport width
