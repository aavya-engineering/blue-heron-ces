// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — the published op catalog: the authoring vocabulary ces-strategy
 * writes decks against.
 *
 * **The boundary this file draws is the point of it.** Strategy declares op
 * intents by **id** plus **declared parameters**. Implementations, selectors and
 * environment handling stay in ces-tester. There are deliberately no
 * step-level primitives — no `click`, no `navigate`, no `wait`, no selector
 * cells — because a deck that carries selectors is a deck that breaks whenever
 * a sibling's markup moves, in front of a customer, with no useful error.
 *
 * **This is a DECLARATION-LAYER module.** It imports **types only** from
 * `deck-model.ts` and nothing else, so `demo:show --check` can validate a deck's
 * parameters with no browser, no sibling tool and no runtime present. Do not add
 * a runtime import here.
 *
 * Two fields exist ahead of any behaviour, folded in at authoring time so the
 * catalog is written once (`DEMO-ACTS-CONCEPT.md` §5): `version` and `target`.
 * `ACT_ALIASES` likewise ships as **pure data** — alias *resolution* is
 * GP-DEMO-5 T3, not this slice.
 */

import type { CesTool, DemoOpId, OpMode } from './deck-model.js';
import { DEMO_OP_IDS } from './deck-model.js';

/** Where the authoring vocabulary is published. Cited by every param error. */
export const OP_CATALOG_DOC = 'docs/demo/OP-CATALOG.md';

export type ParamType = 'enum' | 'string' | 'number' | 'boolean';

export interface ParamSpec {
  readonly key: string;
  readonly type: ParamType;
  /** Required when `type === 'enum'`; the complete set of legal values. */
  readonly values?: readonly string[];
  readonly default?: string | number | boolean;
  readonly description: string;
}

export interface OpCatalogEntry {
  readonly id: DemoOpId;
  /** Bumped when a deck written against an older catalog would behave differently. */
  readonly version: number;
  /** The CES tool this op drives — the acts concept's `DemoTool`. */
  readonly target: CesTool;
  /**
   * The in-slide app mirror mode (T1.5), stamped onto every driven slide's
   * `SlideOp` at load time. REQUIRED (not optional) so the compile-forced
   * `Record<DemoOpId,…>` makes all 14 ops declare it — a new op cannot forget.
   *
   * - `theatrical` — the LIVE GUI is the beat (AO/EO/Muster GUI ops).
   * - `readout`    — the op's own REAL result card is the beat: the readout ops
   *                  (`muster-readiness`, `simstack-create`/`-destroy`,
   *                  `stamper-translate`/`-execute`) navigate the VISIBLE pane to
   *                  an `htmlDataUrl` outcome card, and THAT streams into the
   *                  right third, so the on-stage numbers match the run. For the
   *                  Config ops the GUI runs on the separate, unmirrorable
   *                  backstage session; only the result card ever reaches the
   *                  visible pane, so decision 8 (Config GUI never on stage) holds.
   * - `none`       — reserved for an op that surfaces nothing (none today).
   */
  readonly mirror: 'none' | 'theatrical' | 'readout';
  /**
   * WHICH screencast source a `theatrical` mirror streams (GP-DEMO-5 streamgui).
   * REQUIRED (not optional) so the compile-forced `Record<DemoOpId,…>` makes all
   * 14 ops declare it — a new op cannot forget where it streams from.
   *
   * - `pane`      — the VISIBLE pane (`GET /mirror`). Every op that drives the
   *                 pane directly (AO/EO/Muster, the readouts).
   * - `backstage` — the headless backstage session (`GET /mirror/backstage`).
   *                 The Config (Stamper) ops, which drive backstage. Decision 11
   *                 lifted decision 8's no-live-Config rule, so their GUI streams.
   *
   * Stamped onto every driven slide's `SlideOp` at load. Only consulted when
   * `mirror === 'theatrical'`; a `readout` slide always streams `/mirror`.
   */
  readonly mirrorSource: 'pane' | 'backstage';
  /** The on-stage product name (THREAD_HANDOFF stage naming, binding). */
  readonly stageName: string;
  readonly shows: string;
  readonly modes: readonly OpMode[];
  /** Measured warm cost, in ms. Feeds the `--check` prep budget. */
  readonly typicalWarmMs: number;
  readonly params: readonly ParamSpec[];
  readonly preconditions: readonly string[];
}

export const OP_CATALOG: Readonly<Record<DemoOpId, OpCatalogEntry>> = {
  'ao-registry': {
    id: 'ao-registry',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'ao',
    stageName: 'Operations (Ops)',
    shows: 'A governed command submitted live against the sim tenant, writing its own evidence record.',
    modes: ['live', 'warm', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --full` (run acts-full-1): 3.6 s
    // for the first drive, 0.7 s for the second. The old 30 s was a guess almost
    // an order of magnitude high — and a prep budget padded with guesses tells a
    // presenter to expect dead air that never comes.
    typicalWarmMs: 4_000,
    params: [
      {
        key: 'command',
        type: 'string',
        default: 'A-18',
        description: 'The AdminOps registry command id to submit. Defaults to the demo command (AO_DEMO_COMMAND_ID).',
      },
    ],
    preconditions: ['The AO GUI is armed on :3001 (automatic when a deck names this op).'],
  },

  'ao-make-change': {
    id: 'ao-make-change',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'ao',
    stageName: 'Operations (Ops)',
    shows: 'The REMEDIATING governed command submitted live against the sim tenant — the "fix it" beat — writing its own evidence record.',
    modes: ['live', 'warm', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --act ao-make-change` (run
    // amc-1b-1): the live drive completed in ~1 s against the sim — the identical
    // flow `ao-registry` runs, with the remediation command as the default.
    typicalWarmMs: 4_000,
    params: [
      {
        key: 'command',
        type: 'string',
        default: 'A-18',
        description:
          'The AdminOps registry command id to submit. Defaults to the remediation command A-18 (AO_DEMO_COMMAND_ID), which mutates the tenant authorizationPolicy (the MFA object).',
      },
    ],
    preconditions: ['The AO GUI is armed on :3001 (automatic when a deck names this op).'],
  },

  'eo-review': {
    id: 'eo-review',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'eo',
    stageName: 'Assessment',
    shows: 'The assessment result walked as an assessor does: the compliance matrix, one family’s NOT-MET determinations, then the SPRS score.',
    modes: ['live', 'warm', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --full` (run acts-full-1): the warm
    // assess took 4.7 s against the sim (2.5 s inside the SPA), producing 106
    // live assessments and SPRS -108. NOT the "about five minutes" the dossier
    // and the talk track claimed — that figure was never measured, and a
    // presenter who promises five minutes of dead air here is wrong on stage.
    typicalWarmMs: 5_000,
    params: [
      {
        key: 'family',
        type: 'string',
        default: 'IA',
        description: 'Which control family the live walk filters to. IA is where the MFA control the AO and Config beats remediate lives.',
      },
      {
        key: 'land',
        type: 'enum',
        values: ['dashboard', 'evidence', 'sprs'],
        default: 'sprs',
        description: 'Where the walk ENDS. Every landing walks the matrix and the family determinations first.',
      },
    ],
    preconditions: [
      'The EO server is armed on :4002 (automatic when a deck names this op).',
      'A `live` slide wants an earlier `warm` slide: the EO SPA cannot rehydrate an assessment from a page load. Without one the op self-heals by re-assessing — slower, still real, never a fake result.',
    ],
  },

  'eo-show-change-captured': {
    id: 'eo-show-change-captured',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'eo',
    stageName: 'Assessment',
    shows: 'A re-assessment after remediation, walked to the control that changed — the before/after proof that the loop closes. Narrates only what actually changed.',
    // No `warm`: a warm re-assess fires during prep, BEFORE any live remediator,
    // so it would capture "after" before remediation ran. Slice 2B's loader
    // validation enforces this omission.
    modes: ['live', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --act eo-show-change-captured` (run
    // escc-1c-1): the live re-assess + walk. Seeded, re-stamped from the run.
    typicalWarmMs: 6_000,
    params: [
      {
        key: 'control',
        type: 'string',
        default: 'IA.L2-3.5.3',
        description: 'The control whose before/after determination the walk compares. Defaults to the demo MFA control (DEMO_MFA_CONTROL_ID).',
      },
      {
        key: 'family',
        type: 'string',
        default: 'IA',
        description: 'The control family the walk filters to before landing on the control.',
      },
    ],
    preconditions: [
      'The EO server is armed on :4002 (automatic when a deck names this op).',
      'A `before` assessment captured earlier in the deck (a warm `eo-review`), and a remediating act (`ao-make-change` or `stamper-execute`) BETWEEN before and after. Without a reliable before, the act reports "no reliable before" rather than narrating a delta.',
    ],
  },

  'muster-readiness': {
    id: 'muster-readiness',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'muster',
    stageName: 'Readiness Evaluation (RE)',
    shows: 'A real presence-based readiness evaluation of the tenant: the CLI walk runs, then this run’s real result is imported into the Muster SPA and the boundary panel streams operating on stage — never the fixture "Run Discovery" button.',
    modes: ['live', 'staged'],
    // MEASURED 2026-09-06 against the real ces-muster CLI: 77.6 s for 329
    // observations. The earlier 20 s here was a guess; a prep budget built on
    // guesses is not a budget.
    // RE-MEASURED 2026-09-06 by `demo:acts-test --full` (acts-full-1): 79.4 s
    // warm / 80.5 s live. Confirmed, not changed.
    typicalWarmMs: 80_000,
    params: [
      {
        key: 'detail',
        type: 'enum',
        values: ['counts', 'controls'],
        default: 'counts',
        description: 'How much the readout shows: posture counts only, or the per-control list beneath them.',
      },
    ],
    preconditions: [
      'The stacksim serve is armed (always, for any driven deck), and the ces-muster SPA preview on :4173 (automatic — this op now imports its result into the SPA).',
      '`../ces-muster/muster-api/dist/cli/bin.js` and `../ces-muster/dist/index.html` must exist — an OPERATOR PREREQUISITE, since ces-tester never builds a sibling. A clean `dist/`, or a SPA that is not armed, degrades this beat to the "evaluation unavailable" readout card.',
      'NO readiness score is produced. DISCOVERY-1 yields a four-value per-control posture and nothing else.',
      'On the success path the op navigates the pane to the SPA and imports this run’s real readiness-result through the file-input seam, ending on the boundary panel. It NEVER clicks the fixture "Run Discovery" button.',
    ],
  },

  'muster-connect-tenant': {
    id: 'muster-connect-tenant',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'muster',
    stageName: 'Readiness Evaluation (RE)',
    shows: 'Muster pointed at a tenant with the assessment method DECLARED — session kind, auth tier, operator — the honest opening beat. Fills the readiness manifest and stops on the manifest view.',
    // No `warm`: it is a seconds-long UI step. The 2B loader validation enforces
    // this omission.
    modes: ['live', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --act muster-gui` (run mg-30-2): the
    // manifest fill against the armed Vite preview.
    typicalWarmMs: 4_000,
    params: [
      {
        key: 'mode',
        type: 'enum',
        values: ['self-hosted', 'independent', 'collaborative-bhd'],
        default: 'independent',
        description: 'The readiness session kind (rm-mode).',
      },
      {
        key: 'authTier',
        type: 'enum',
        values: ['lite', 'script-upload', 'device-code', 'cert-app-only'],
        default: 'cert-app-only',
        description: 'The authorization tier achieved (rm-auth-tier).',
      },
      {
        key: 'slug',
        type: 'string',
        default: 'demo-dib-small',
        description: 'The tenant slug declared in the manifest (rm-tenant-slug). Defaults to the armed sim slug.',
      },
    ],
    preconditions: [
      'The ces-muster SPA is armed on :4173 (automatic when a deck names a muster-gui op) — an OPERATOR PREREQUISITE, since ces-tester never builds a sibling: `../ces-muster/dist/index.html` must exist (`npm run build` in ces-muster).',
    ],
  },

  'muster-auto-analysis': {
    id: 'muster-auto-analysis',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'muster',
    stageName: 'Readiness Evaluation (RE)',
    shows: 'The REAL read-only discovery walk (CLI) imported into Muster\'s UI — this tenant\'s real result in this run, never the fixture button. Lands on the boundary confirm panel.',
    modes: ['live', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --act muster-gui` (run maa-31-1): the
    // real CLI walk (~80 s) plus the SPA import.
    typicalWarmMs: 85_000,
    params: [
      {
        key: 'slug',
        type: 'string',
        default: 'demo-dib-small',
        description: 'The tenant slug the discovery CLI walks. Defaults to the armed sim slug.',
      },
    ],
    preconditions: [
      'The ces-muster SPA is armed on :4173, and `muster-connect-tenant` ran earlier (the manifest is captured).',
      'Operator prerequisite: `../ces-muster/muster-api/dist/cli/bin.js` and `../ces-muster/dist/index.html` must exist (`npm run build` in ces-muster).',
      'The CLI walk composes the REAL readiness-result → the SPA file-import seam. It NEVER clicks the fixture "Run Discovery" button.',
    ],
  },

  'muster-consent-and-attest': {
    id: 'muster-consent-and-attest',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'muster',
    stageName: 'Readiness Evaluation (RE)',
    shows: 'A NAMED human attests the CUI boundary the machine inferred — a draft confirm is name-gated, and nothing auto-drafted becomes an attested fact on its own.',
    modes: ['live', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --act muster-gui` (run mca-32-1).
    typicalWarmMs: 4_000,
    // Zero params: the confirmer is the demo operator; the drafts come from the
    // prior import.
    params: [],
    preconditions: [
      'The SPA is armed on :4173 and `muster-auto-analysis` ran earlier (the import left the boundary panel up).',
    ],
  },

  'muster-adaptive-interview': {
    id: 'muster-adaptive-interview',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'muster',
    stageName: 'Readiness Evaluation (RE)',
    shows: 'The question count DROPS because discovery already answered them — the discovery branch total vs a fresh manual branch, the exact comparison ces-muster\'s own e2e makes.',
    modes: ['live', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --act muster-gui` (run mai-33-1).
    typicalWarmMs: 6_000,
    params: [],
    preconditions: [
      'The SPA is armed on :4173 and the discovery import + boundary confirm ran earlier (the visible pane carries the imported facts). Opens a throwaway headless session for the manual-branch baseline (no extra port).',
    ],
  },

  'muster-generate-sprs-mp': {
    id: 'muster-generate-sprs-mp',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'muster',
    stageName: 'Readiness Evaluation (RE)',
    shows: 'The number the customer reports (SPRS), read from the EXPORTED readiness-result payload — never scraped from the DOM. The on-screen conservative-score is a percentage string, not the SPRS integer.',
    modes: ['live', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --act muster-gui` (run msp-34-1).
    typicalWarmMs: 6_000,
    params: [],
    preconditions: [
      'The SPA is armed on :4173 and the interview is in progress (the adaptive-interview beat ran). Finishes the interview → the result view → exports the payload through the download seam.',
    ],
  },

  'muster-rollup': {
    id: 'muster-rollup',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'theatrical',
    target: 'muster',
    stageName: 'Readiness Evaluation (RE)',
    shows: "The prime's real subcontractor rollup surface, operating live: each sub's StatusPayload is imported into Muster's RAG board and the Red/Amber/Green readiness lands per sub. The fleet is a labeled SAMPLE set (party names carry `(sample)`) — a real evaluation produces one sub, so the board's inputs are illustrative, never narrated as this run's tenants.",
    modes: ['live', 'staged'],
    // Fast: no CLI walk — the act writes the sample StatusPayloads to the run
    // dir and drives the SPA's file-import seam (a few imports + the RAG render).
    typicalWarmMs: 12_000,
    // Zero params: the sample fleet is fixed (the honest ceiling — one armed
    // tenant cannot yield a real multi-sub board), so there is nothing a deck
    // could turn without implying the fleet is real.
    params: [],
    preconditions: [
      'The ces-muster SPA is armed on :4173 (automatic when a deck names a muster op) — an OPERATOR PREREQUISITE, since ces-tester never builds a sibling: `../ces-muster/dist/index.html` must exist (`npm run build` in ces-muster). Absent or unarmed, this beat degrades to the honest sample-fleet readout card.',
      'The fleet is illustrative: a Readiness Evaluation reads ONE tenant, so this board shows sample subcontractor status files to demonstrate the real rollup surface. It NEVER claims the subs were evaluated in this run.',
      'The SPA rollup is reached by opening a `prime_and_subs` engagement (the rollup nav appears only for that engagement kind). The import goes through the file seam and any schema-rejected sample fails the beat loudly.',
    ],
  },

  'simstack-create': {
    id: 'simstack-create',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'readout',
    target: 'stacksim',
    stageName: 'stacksim',
    shows: 'The deliberately half-configured demo tenant, presented as a readout: the sim answers, the registry record is usable, and the report-only MFA gap is present. Presents what prep built — never a live re-seed.',
    modes: ['live', 'warm', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --act simstack-create` (run
    // sc-2a-1): a sub-second readout over the armed state.
    typicalWarmMs: 1_000,
    // Zero params: this act reads only ctx.armed. Arming already seeded and
    // served the sim before any op runs, so there is nothing to parameterize.
    params: [],
    preconditions: [
      'The stacksim serve is armed on :4390 (always, for any driven deck).',
      'The sim record was authored by arming (`authorSimTenantRecord`); this act reads it, never writes it.',
    ],
  },

  'simstack-destroy': {
    id: 'simstack-destroy',
    mirrorSource: 'pane',
    version: 1,
    mirror: 'readout',
    target: 'stacksim',
    stageName: 'stacksim',
    shows: 'The ephemeral demo tenant torn down cleanly — the "leave no trace" beat. Removes the registry record and keeps every artifact in the run directory.',
    // NO `warm`: destroying during prep would remove the tenant the deck is about
    // to use. The loader (deck-validate.ts, GP-DEMO-4 Slice 2B) rejects a deck
    // that declares `warm` for this op with a catalog error.
    modes: ['staged', 'live'],
    // MEASURED 2026-09-06 by `demo:acts-test --act simstack-destroy` (run
    // sd-2b-1): a sub-second registry-record teardown.
    typicalWarmMs: 1_000,
    // Zero params: `keepEvidence` is hardcoded true (never delete run evidence),
    // and the slug comes from the armed environment.
    params: [],
    preconditions: [
      'The stacksim serve is armed on :4390 (always, for any driven deck).',
      'Wraps `teardownEphemeralSimTenant` (registry record only) — NEVER `demo:reset`, whose clear-runs would delete the run evidence. Put this act LAST in any multi-op group.',
    ],
  },

  'stamper-translate': {
    id: 'stamper-translate',
    mirrorSource: 'backstage',
    version: 1,
    mirror: 'theatrical',
    target: 'stamper',
    stageName: 'Configuration (Config)',
    shows: 'The real Configuration GUI compiling the mission plan into executable remediation tasks, streamed live from the backstage session into the slide (decision 11 lifted decision 8’s no-live-Config rule).',
    modes: ['warm', 'live', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --full` (acts-full-1): 308.6 s for
    // 110 tasks, backstage. Confirmed, not changed.
    typicalWarmMs: 300_000,
    params: [
      {
        key: 'missionPlan',
        type: 'string',
        default: 'assets/demo-plan/demo-dib-small/mission-plan.json',
        description: 'Path to the mission plan, relative to the tester root. Resolved ABSOLUTE before it reaches the GUI, whose child runs with cwd = stamperRoot.',
      },
      {
        key: 'manifest',
        type: 'string',
        default: 'assets/demo-plan/demo-dib-small/manifest.json',
        description: 'Path to the TENANT manifest (never the infrastructure one), relative to the tester root.',
      },
    ],
    preconditions: [
      'The Stamper GUI is armed on :3000 (automatic when a deck names either stamper op).',
      'Runs BACKSTAGE — a headless, never-displayed session. It touches the visible pane only to render a readout, and only on a `live` slide.',
      '`live` is legal but holds the slide for the whole flow (≈5 min). `warm` is the sensible mode.',
    ],
  },

  'stamper-execute': {
    id: 'stamper-execute',
    mirrorSource: 'backstage',
    version: 1,
    mirror: 'theatrical',
    target: 'stamper',
    stageName: 'Configuration (Config)',
    shows: 'The real Configuration GUI applying and verifying the remediation plan against the tenant, streamed live from the backstage session — judged by the execution report on disk, never by the GUI badge (decision 11).',
    modes: ['warm', 'live', 'staged'],
    // MEASURED 2026-09-06 by `demo:acts-test --full` (acts-full-1): 774.3 s on
    // the execute-only FAST path, 97/110 tasks applied. The old 420 s (7 min)
    // predicted a run 1.84x shorter than the only measurement we have; inside
    // the pacing tolerance, but this catalog's job is to be true, not merely
    // tolerable. Rounded UP to 13 min because a prep budget is a worst-case
    // promise to the presenter, not an average. A deck warming BOTH Config ops
    // now honestly costs ~18 min before slide 1.
    typicalWarmMs: 780_000,
    params: [
      {
        key: 'skipKnownFalseFails',
        type: 'boolean',
        default: true,
        description: 'Report and skip the pinned sim-only verification failures (GUI_LEG_KNOWN_FALSE_FAILS). Set false to fail the op on every failure, expected or not.',
      },
      {
        key: 'peekMs',
        type: 'number',
        description:
          'DEMO PEEK. When set (e.g. 5000) on a `live` slide, the act CLICKS Execute, confirms the GUI is running, streams it for this many ms, then HALTS the run and cuts away without awaiting the ≈13-min terminal — NO report is judged this run. Halting stops the backstage churn that would otherwise crash later live acts (the muster discovery CLI). Omit (the default) to hold the slide for the full flow and judge the report on disk.',
      },
    ],
    preconditions: [
      'The Stamper GUI is armed on :3000. Runs BACKSTAGE.',
      'A warm `stamper-translate` on an EARLIER slide leaves the backstage page connected with an executable plan — that is the ≈5-minute fast path. Without it the op self-heals by running the full flow (≈12 min); `--check` warns when a deck is ordered that way.',
      'Fails only on UNEXPECTED failures. Expected sim false-FAILs are reported and skipped.',
      '`peekMs` makes it a watchable start-and-cut-away beat (≈peekMs on stage) instead of the full ≈13-min hold; the run is HALTED after the peek (so it cannot churn on backstage and crash later live acts) and no report is judged that run.',
    ],
  },
};

/**
 * Named presets: alias -> `{ id, params }`. **DATA ONLY** — resolution lands in
 * GP-DEMO-5 T3. They exist here so the catalog is written once, and so the
 * founder's "act" vocabulary has a home before the machinery does.
 */
export const ACT_ALIASES: Readonly<Record<string, { id: DemoOpId; params: Readonly<Record<string, string>> }>> = {
  'eo-verify-evidence': { id: 'eo-review', params: { land: 'evidence' } },
  'eo-browse-determinations': { id: 'eo-review', params: { land: 'sprs' } },
};

/**
 * `key=value`, one per line — the separator `features` already uses (Alt+Enter
 * in Excel) and the only one a value can never itself contain. Pure.
 */
export function parseParamsCell(raw: string): { params: Record<string, string>; errors: string[] } {
  const params: Record<string, string> = {};
  const errors: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (text === '') continue;
    const eq = text.indexOf('=');
    if (eq <= 0) {
      errors.push(
        `parameter line ${JSON.stringify(text)} is not \`key=value\` — one per line (Alt+Enter in Excel); see ${OP_CATALOG_DOC}`,
      );
      continue;
    }
    const key = text.slice(0, eq).trim();
    const value = text.slice(eq + 1).trim();
    if (key === '') {
      errors.push(`parameter line ${JSON.stringify(text)} has an empty key; see ${OP_CATALOG_DOC}`);
      continue;
    }
    if (key in params) {
      errors.push(`parameter "${key}" is set more than once; see ${OP_CATALOG_DOC}`);
      continue;
    }
    params[key] = value;
  }
  return { params, errors };
}

/**
 * Validate a params bag against one op's catalog entry, filling defaults. Pure.
 * Every error cites `OP_CATALOG_DOC` by path — that is what makes the catalog the
 * authoring vocabulary rather than a doc nobody opens.
 */
export function validateParams(
  opId: DemoOpId,
  params: Readonly<Record<string, string>>,
): { resolved: Record<string, string | number | boolean>; errors: string[] } {
  const entry = OP_CATALOG[opId];
  const errors: string[] = [];
  const resolved: Record<string, string | number | boolean> = {};

  const supported = entry.params.map((p) => p.key);
  for (const key of Object.keys(params)) {
    if (!supported.includes(key)) {
      errors.push(
        `op "${opId}" has no parameter "${key}" (supported: ${supported.join(', ') || 'none'}) — see ${OP_CATALOG_DOC}`,
      );
    }
  }

  for (const spec of entry.params) {
    const raw = params[spec.key];
    if (raw === undefined) {
      if (spec.default !== undefined) resolved[spec.key] = spec.default;
      continue;
    }
    switch (spec.type) {
      case 'enum': {
        const allowed = spec.values ?? [];
        if (!allowed.includes(raw)) {
          errors.push(
            `op "${opId}" parameter "${spec.key}" must be one of ${allowed.join('|')} (got ${JSON.stringify(raw)}) — see ${OP_CATALOG_DOC}`,
          );
        } else {
          resolved[spec.key] = raw;
        }
        break;
      }
      case 'number': {
        const n = Number(raw);
        if (raw === '' || !Number.isFinite(n)) {
          errors.push(
            `op "${opId}" parameter "${spec.key}" must be a number (got ${JSON.stringify(raw)}) — see ${OP_CATALOG_DOC}`,
          );
        } else {
          resolved[spec.key] = n;
        }
        break;
      }
      case 'boolean': {
        const lower = raw.toLowerCase();
        if (lower !== 'true' && lower !== 'false') {
          errors.push(
            `op "${opId}" parameter "${spec.key}" must be true or false (got ${JSON.stringify(raw)}) — see ${OP_CATALOG_DOC}`,
          );
        } else {
          resolved[spec.key] = lower === 'true';
        }
        break;
      }
      default:
        resolved[spec.key] = raw;
    }
  }

  return { resolved, errors };
}

/**
 * Total warm-phase cost of a deck's warm ops. Warm ops fire during prep **in
 * deck order** through one serialization queue, so this is a sum, not a max —
 * and it is wall time an operator commits to before slide 1.
 */
export function prepBudgetMs(warmOpIds: readonly DemoOpId[]): number {
  return warmOpIds.reduce((total, id) => total + OP_CATALOG[id].typicalWarmMs, 0);
}

/** Above this, `--check` warns: five minutes of dead stare before slide 1. */
export const PREP_BUDGET_WARN_MS = 300_000;

/** Every registered op has a catalog entry — asserted, never assumed. */
export const CATALOGUED_OP_IDS: readonly DemoOpId[] = DEMO_OP_IDS;
