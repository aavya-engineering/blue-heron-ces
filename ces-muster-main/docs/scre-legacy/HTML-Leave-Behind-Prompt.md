# Prompt — One-Page HTML Prospect Leave-Behind (reusable for any app)

> Fill in the `>>> FILL THIS IN <<<` block, then paste the whole thing as a task to a writing/build
> agent (or as a `/fabrica` argument). It grounds the page in the app's real context, matches the
> SCRE design family, and bakes in the no-overpromise / compliance guardrails.

```
You are a senior B2B product-marketing designer. Build a single self-contained HTML one-page
prospect leave-behind for the app described below — a prospect-facing artifact a rep emails or hands
to a buyer around an intro call. It must reinforce value, be honest about what the product does
today, and drive one low-friction CTA.

>>> FILL THIS IN <<<
- APP NAME / SHORT TAG: [e.g. "CES — Compliance Engine System"]
- WHAT IT IS (1-2 sentences): [plain-language description]
- WHO IT'S FOR (the buyer): [role + company type]
- ROOT CONTEXT TO READ FIRST (ground all claims in these — read before writing):
    1. [path to the authoritative product map / module map]
    2. [path to product story / README / positioning doc]
    3. [path to any "known gaps / current state" doc — REQUIRED so the page doesn't overpromise]
- PROSPECT INTEL (optional): [path to scored-prospect intel, if personalization is wanted]
- OUTPUT FILE: [absolute path, e.g. C:/Users/mhsut/DevProjects/<app>-gtm/<APP>-Leave-Behind.html]
- READ-ONLY / DO-NOT-EDIT DIRS: [e.g. the source codebase — reference only, never modify]
- CTA: book an initial ~25-30 minute meeting to learn more.
>>> END FILL IN <<<

STEP 1 — GROUND IN ROOT CONTEXT. Read the files above. From them, derive and state plainly (do not
invent): what the product actually does, its honest current-state limits (from the gaps doc), and
the 3-4 differentiators that are PROVABLE from the source — not aspirational. If a capability is
beta/early or delivered as a managed service rather than self-serve, the page must reflect that.

STEP 2 — DESIGN (match the SCRE design family). Read this existing file for the exact visual idiom
and REUSE it: C:/Users/mhsut/DevProjects/scre/SCRE-Prospect-Leave-Behind.html (and SCRE-OnePager.html
if present). Requirements:
- Single self-contained .html: inline <style> + minimal/no vanilla <script>. NO frameworks, NO
  external assets/fonts/CDNs. System font stack.
- Palette: --navy:#0f2740, --navy2:#1b3a5b, --amber:#c97a16, --teal:#0f7a6c, --blue:#1f6feb,
  --green:#1c7c43, --bg:#f4f7fa, --card:#fff, --line:#dce4ec, --radius:14px.
- Navy gradient hero, KPI/stat cards, clean section bands, navy CTA band, responsive
  @media(max-width:900px), and print-friendly color rules (it may be saved to PDF).

STEP 3 — CONTENT (one page, scannable in ~90 seconds by a busy buyer):
1. Header — app name + one-line value prop + a "for [buyer]" framing tag + subtle vendor attribution.
2. The problem — 3-4 tight, buyer-framed points (the risk/cost they carry today).
3. What it does — the core capability as 3 cards or a short flow (grounded in root context).
4. Why it's different — 3-4 provable differentiators vs the status-quo alternative.
5. The outcome — what the buyer walks away with (concrete deliverables/result).
6. CTA band — "Book a 25-minute intro" with placeholders: [rep name] · [email] · [calendar link].

GUARDRAILS (obey in all copy):
- HONESTY / NO OVERPROMISE: sell only what the product does today per the root context + gaps doc.
  Do NOT claim self-serve SaaS, customer dashboards, multi-tenant, push-button automation, or
  integrations/capabilities the source doesn't support. If something is delivered as a managed
  service or is beta, say so plainly (soft phrasing is fine).
- If the domain is regulated (legal/compliance/financial/health/security): frame any liability or
  regulatory risk as a GENERAL, public-sourced industry fact — never assert THIS reader is
  non-compliant / will be penalized; add a small footer disclaimer ("[Vendor] is not a law firm;
  this is informational, not legal advice" — adapt to domain) and "Figures are illustrative."
- Any statistic must be hedged/sourced, not a bare precise number; any deadline attributed to its
  governing rule and framed accurately (not as a universal cliff if it isn't one).
- No internal pricing dumped on a prospect-facing page (pricing is a scoping conversation); ROI
  framing is fine. Do not expose internal tooling/engine names.
- TONE: peer-level, credible, concise, low-hype. Lead with the buyer's risk and outcome, not features.

Build the complete file at the OUTPUT FILE path now. When done, reply with the path and a 2-3
sentence description of the layout, and confirm a self-check that no overpromise/forbidden claim
(self-serve, dashboard, guaranteed outcome, unsupported integration) appears.
```

---

**Notes:** The single most important line is the **"known gaps / current state" doc** in the root-context list — that's what stops the page from overpromising (the trap the CES run kept hitting). If your different app has no such doc, tell the agent to derive limits from the README/code and err conservative. If you tell me which app, I'll fill the block in and run it.
