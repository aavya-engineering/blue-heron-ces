// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-6 — `muster-rollup`: the PRIME contractor's subcontractor rollup, on
 * stage as **"Readiness Evaluation (RE)"**. The 15th act.
 *
 * ## What it is, and the one honesty fact that shapes it
 *
 * A Readiness Evaluation reads ONE tenant (`muster-readiness` / the discovery
 * CLI walk). The prime's payoff is the OTHER view — every sub at once, Red /
 * Amber / Green on one board. ces-muster ships that surface for real
 * (`src/features/rollup/StaticRollup.tsx`): it imports one **StatusPayload**
 * JSON per sub, AJV-validates each, and renders a RAG row keyed on the sub's
 * `conservative_score`.
 *
 * Three facts force the design, and each is load-bearing:
 *
 * **1. The fleet is a labeled SAMPLE, never "this run's subs."** StatusPayload is
 * a DIFFERENT artifact from the `readiness-result` the walk produces — there is
 * no converter and no CLI that emits one, and the presence-based walk yields no
 * `conservative_score`, so this run's real sub CANNOT become an honest RAG row.
 * A single armed tenant is also a single sub — there is no real fleet to roll up.
 * So this act writes a fixed set of SAMPLE StatusPayloads (every party name
 * carries `(sample)`) and drives the REAL surface with them. The live thing is
 * the surface — the component, its AJV validation, its RAG math, its CSV export —
 * NOT a second live evaluation. The captions and this card say "sample" out loud.
 *
 * **2. It drives the real SPA rollup, or it degrades to an honest card.** On the
 * SUCCESS path it opens a `prime_and_subs` engagement (the rollup nav appears
 * only for that engagement kind), navigates to the rollup, and imports the sample
 * files through the SPA's own file seam — the same honest seam
 * `muster-readiness` uses, never a fixture button. If the SPA is not armed, the
 * readout card below is the only honest surface (mirrors `muster-readiness`).
 *
 * **3. A schema-rejected sample FAILS the beat loudly.** The driver reads the
 * SPA's `ul.form-error` after import; any entry there means a sample no longer
 * matches `status-payload.schema.json`, and a board silently short a row is the
 * partial-proof failure this harness exists to prevent — so it throws.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { escapeHtml } from '../slide-render.js';
import { htmlDataUrl, hudSurfaceOf } from '../app-pane.js';
import { driveMusterRollup } from '../../muster-ui-driver.js';
import { paneHud } from '../theatrical-page.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext, OpImplementation } from '../op-registry.js';

const CAP = CAPTIONS['muster-rollup'];

/**
 * The subset of ces-muster's StatusPayload contract this act authors, verbatim
 * from `../ces-muster/public/schemas/status-payload.schema.json` (strict,
 * `additionalProperties:false`). Kept as a local type because ces-tester never
 * imports a sibling — the SPA's own AJV is the real validator at import time, and
 * `tests/demo-muster-rollup.test.ts` hand-asserts the required fields.
 */
export interface StatusPayload {
  readonly schema_version: '1.0.0';
  readonly engagement_kind: 'prime_and_subs' | 'individual_contractor';
  readonly party: { readonly name: string; readonly uei?: string; readonly cage?: string };
  readonly on_prem_ot: 'yes' | 'no' | 'unsure';
  readonly interview_facts: readonly {
    readonly question_id: string;
    readonly question_text: string;
    readonly answer: string;
    readonly provenance: string;
    readonly confidence: 'high' | 'medium' | 'low' | 'unknown';
    readonly recorded_at: string;
  }[];
  readonly posture_summary: {
    readonly conservative_score: number;
    readonly control_status_summary: {
      readonly level: string;
      readonly met: number;
      readonly partial: number;
      readonly not_met: number;
      readonly unknown: number;
    };
  };
  readonly timing_segments: readonly {
    readonly segment: 'setup' | 'interview' | 'verification' | 'review';
    readonly started_at: string;
    readonly duration_ms?: number;
  }[];
}

/** The board's RAG rule, verbatim from `StaticRollup.tsx`'s `ragColor`. */
export function ragOf(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

/**
 * One sample sub. A small, fixed helper so the fleet reads as data, not a wall
 * of literal objects. `facts` is a count (the board only reads their number);
 * every fact is the same honest placeholder — a sample file makes no claim about
 * a specific control.
 */
function sampleSub(
  name: string,
  score: number,
  onPremOt: 'yes' | 'no',
  facts: number,
  sessionMs: number,
): StatusPayload {
  const rag = ragOf(score);
  return {
    schema_version: '1.0.0',
    engagement_kind: 'prime_and_subs',
    party: { name },
    on_prem_ot: onPremOt,
    interview_facts: Array.from({ length: facts }, (_unused, i) => ({
      question_id: `sample-q-${i + 1}`,
      question_text: 'Sample interview fact for an illustrative rollup entry.',
      answer: 'yes',
      provenance: 'sample',
      confidence: 'medium' as const,
      recorded_at: '2026-09-15T14:00:00.000Z',
    })),
    posture_summary: {
      conservative_score: score,
      control_status_summary: {
        level: 'L2',
        met: Math.round(score),
        partial: rag === 'green' ? 4 : 10,
        not_met: Math.max(0, Math.round((100 - score) / 8)),
        unknown: 110 - Math.round(score) - (rag === 'green' ? 4 : 10) - Math.max(0, Math.round((100 - score) / 8)),
      },
    },
    timing_segments: [
      { segment: 'setup', started_at: '2026-09-15T14:00:00.000Z', duration_ms: sessionMs },
    ],
  };
}

/**
 * The illustrative fleet: five subs, scores spanning the 70/40 RAG thresholds so
 * the board shows a real prime's spread (two clear, two at risk, one behind), two
 * carrying operational technology (the ⚑ OT flag). Fixed and deterministic — the
 * honest ceiling is a demonstration of the surface, not a live multi-sub run — so
 * every party name carries `(sample)` and the count reaches five to turn the
 * board's "N / 5 subs" counter green.
 */
export const SAMPLE_FLEET: readonly StatusPayload[] = [
  sampleSub('Machining Sub (sample)', 82, 'no', 18, 41 * 60_000),
  sampleSub('Coatings Sub (sample)', 74, 'no', 15, 33 * 60_000),
  sampleSub('Electronics Sub (sample)', 58, 'yes', 12, 47 * 60_000),
  sampleSub('Fasteners Sub (sample)', 44, 'no', 9, 28 * 60_000),
  sampleSub('Logistics Sub (sample)', 31, 'yes', 6, 22 * 60_000),
];

export interface RollupRow {
  readonly name: string;
  readonly score: number;
  readonly rag: 'green' | 'amber' | 'red';
  readonly onPremOt: string;
}

export interface FleetSummary {
  readonly rows: readonly RollupRow[];
  readonly green: number;
  readonly amber: number;
  readonly red: number;
  readonly onPrem: number;
  readonly total: number;
}

/** Pure — what the board and the HUD both report. Directly assertable. */
export function fleetSummary(fleet: readonly StatusPayload[] = SAMPLE_FLEET): FleetSummary {
  const rows = fleet.map((p) => ({
    name: p.party.name,
    score: p.posture_summary.conservative_score,
    rag: ragOf(p.posture_summary.conservative_score),
    onPremOt: p.on_prem_ot,
  }));
  return {
    rows,
    green: rows.filter((r) => r.rag === 'green').length,
    amber: rows.filter((r) => r.rag === 'amber').length,
    red: rows.filter((r) => r.rag === 'red').length,
    onPrem: rows.filter((r) => r.onPremOt === 'yes').length,
    total: rows.length,
  };
}

/** The one-line HUD/log tally — never interpolated into a caption (those are static). */
export function tallyLine(s: FleetSummary): string {
  return `${s.total} sample subs · ${s.green} green / ${s.amber} amber / ${s.red} red · ${s.onPrem} on-prem/OT`;
}

/**
 * Write each sample StatusPayload to the run dir and return the absolute paths,
 * in fleet order. One file per sub — the shape the SPA rollup imports.
 */
export function writeSampleFleet(dir: string, fleet: readonly StatusPayload[] = SAMPLE_FLEET): string[] {
  fs.mkdirSync(dir, { recursive: true });
  return fleet.map((payload, i) => {
    const safe = payload.party.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const file = path.join(dir, `status-payload-${String(i + 1).padStart(2, '0')}-${safe}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    return file;
  });
}

/**
 * The degraded surface — the sample board as a plain card, same navy palette as
 * the staged replay and `muster-readiness`, so the pane never jumps between two
 * visual languages. Shown only when the real SPA cannot be driven; it says
 * SAMPLE loudly and never claims a live surface.
 */
export function readoutHtml(fleet: readonly StatusPayload[] = SAMPLE_FLEET): string {
  const s = fleetSummary(fleet);
  const badge = (rag: 'green' | 'amber' | 'red'): string => {
    const color = rag === 'green' ? '#4ade80' : rag === 'amber' ? '#ffb454' : '#f87171';
    return `<span class="rag" style="color:${color};border-color:${color}">${rag.toUpperCase()}</span>`;
  };
  const rows = s.rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${badge(r.rag)}${
          r.onPremOt === 'yes' ? ' <em>⚑ OT</em>' : ''
        }</td><td>${escapeHtml(String(r.score))}%</td></tr>`,
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Subcontractor Rollup — sample board</title>
<style>
html,body{margin:0;height:100%;background:#0a1930;color:#dce8f7;font-family:"Segoe UI",Segoe,Tahoma,Arial,sans-serif;}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;}
.badge{border:1px solid #ffb454;color:#ffb454;border-radius:20px;padding:2px 14px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;}
h1{font-size:22px;margin:0;font-weight:600;}
table{border-collapse:collapse;margin:4px 0;font-size:14px;}
th,td{border-top:1px solid #1e3a5c;padding:5px 16px;text-align:left;}
td:nth-child(3){text-align:right;font-variant-numeric:tabular-nums;}
.rag{border:1px solid;border-radius:12px;padding:1px 9px;font-size:12px;font-weight:700;letter-spacing:.08em;}
em{color:#f87171;font-style:normal;font-size:12px;}
.cap{color:#9db2cc;font-size:14px;margin:0;}
.note{color:#ffb454;font-size:13px;margin:6px 0 0;max-width:56ch;line-height:1.5;}
</style></head><body><div class="wrap">
<span class="badge">Subcontractor Rollup · sample</span>
<h1>${escapeHtml(String(s.total))} subs · ${escapeHtml(String(s.green))} green / ${escapeHtml(String(s.amber))} amber / ${escapeHtml(String(s.red))} red</h1>
<table><tbody>${rows}</tbody></table>
<p class="cap">Red / Amber / Green readiness, one row per subcontractor.</p>
<p class="note">Sample status files, shown to demonstrate the prime's rollup surface. A Readiness Evaluation reads one tenant; these subs were not evaluated in this run.</p>
</div></body></html>`;
}

/** Side effects, injected so the op wiring is testable without a browser. */
export interface MusterRollupDeps {
  readonly writeFleet?: (dir: string) => string[];
  readonly drive?: typeof driveMusterRollup;
}

/**
 * Build the op with its side effects injected. SUCCESS path: write the sample
 * StatusPayloads to the run dir, navigate the pane to the armed Muster SPA,
 * open a prime engagement, and import the samples into the real rollup board —
 * ending ON the SPA with the RAG board rendered. DEGRADED path (SPA not armed):
 * render the readout card — the only honest surface when the board cannot be
 * driven. A schema-rejected sample throws (the driver surfaces `form-error`).
 */
export function makeMusterRollupOp(deps: MusterRollupDeps = {}): OpImplementation {
  const writeFleet = deps.writeFleet ?? ((dir: string) => writeSampleFleet(dir));
  const drive = deps.drive ?? driveMusterRollup;

  return async (ctx: OpDriveContext): Promise<void> => {
    const mode = ctx.slide.op.mode;
    const baseUrl = ctx.armed.musterBaseUrl;
    const summary = fleetSummary();
    ctx.log(
      `  op muster-rollup (${mode}): rolling up ${summary.total} SAMPLE subcontractor status files into ` +
        "ces-muster's rollup board (illustrative fleet — one run evaluates one sub, never this run's tenants)",
    );

    const paths = writeFleet(ctx.armed.runDir);
    for (const p of paths) ctx.artifact?.(p);

    // DEGRADED — the SPA is not armed: the readout card is the only honest
    // surface. Nothing is driven.
    if (!baseUrl) {
      ctx.log('  op muster-rollup: the Muster SPA is not armed — rendering the sample-board card instead of the live rollup');
      await ctx.pane.goto(htmlDataUrl(readoutHtml()));
      await ctx.caption?.(CAP.degraded[0]);
      return;
    }

    // SUCCESS — drive the real rollup surface. The SPA goes on stage first (this
    // op is standalone; nothing navigated it earlier).
    const page = ctx.pane.page;
    const hud = hudSurfaceOf(ctx.pane);
    await page.goto(baseUrl);
    await ctx.caption?.(CAP.success[0]);
    if (hud) await paneHud.show(hud, ROLLUP_HUD_TITLE, 'opening a prime engagement to reach the rollup board');
    await ctx.caption?.(CAP.success[1]);

    let result: Awaited<ReturnType<typeof driveMusterRollup>>;
    try {
      result = await drive(page, paths);
    } catch (err) {
      // The SPA could not be driven (selector drift, engagement gate). Degrade to
      // the card rather than blank the pane, and say why.
      const detail = err instanceof Error ? err.message : String(err);
      ctx.log(`  op muster-rollup: rollup surface could not be driven (${detail}) — rendering the sample-board card`);
      if (hud) await paneHud.hide(hud);
      await ctx.pane.goto(htmlDataUrl(readoutHtml()));
      await ctx.caption?.(CAP.degraded[0]);
      return;
    }

    // A schema-rejected sample is a real breakage (the samples must match the
    // SPA's own schema) — fail loud, never narrate a board that silently dropped
    // a sub.
    if (result.formErrors.length > 0) {
      throw new Error(
        `muster-rollup: the SPA rejected ${result.formErrors.length} sample StatusPayload(s) — ` +
          `${result.formErrors.join(' | ')}. The samples no longer match status-payload.schema.json.`,
      );
    }
    if (result.rowCount !== paths.length) {
      throw new Error(
        `muster-rollup: imported ${paths.length} sample(s) but the board rendered ${result.rowCount} row(s) — the rollup did not ingest the full fleet.`,
      );
    }

    ctx.log(`  op muster-rollup: rolled up on the live surface — ${tallyLine(summary)}`);
    await ctx.caption?.(CAP.success[2]);
    if (hud) await paneHud.show(hud, ROLLUP_HUD_TITLE, `${tallyLine(summary)} · sample fleet on the real rollup surface`);
    await ctx.caption?.(CAP.success[3]);
  };
}

/** The HUD title for this beat — the stage name, then the surface's own name. */
export const ROLLUP_HUD_TITLE = 'Readiness Evaluation · Subcontractor Rollup';

/** The registered implementation. */
export const runMusterRollupOp: OpImplementation = makeMusterRollupOp();
