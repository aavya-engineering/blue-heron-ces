// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the roster of act GROUPS.
 *
 * **An act-group is the unit, not an act.** Two of the five ops are only
 * meaningful in sequence, and running them apart would test something the demo
 * never does:
 *
 * - `eo-review` **warm** hydrates a page that `eo-review` **live** then walks.
 *   The hydration is page state, not server state, so the pair has to share one
 *   pane in one lifecycle or the live half self-heals and we have measured the
 *   degradation path instead of the act.
 * - `stamper-translate` leaves the backstage page holding a populated
 *   `#outputPath`, which is what makes `stamper-execute`'s fast path the common
 *   case. Split them and every execute run pays the full flow.
 *
 * Each group also DECLARES the surfaces it expects arming to bring up. That
 * declaration is checked (ARM1) rather than assumed: `armingFor` derives arming
 * from the deck's own driven op ids, so a group whose expectation and whose
 * slides disagree is a roster bug, and one that would otherwise show up as a
 * mysterious timeout mid-op.
 */

import type { DemoOpId, OpMode } from '../show/deck-model.js';
import { MUSTER_SPA_PORT } from '../show/arm-muster.js';

/** stacksim's serve. Armed for every group, always. */
export const STACKSIM_PORT = 4390;
export const AO_GUI_PORT = 3001;
export const EO_PORT = 4002;
export const STAMPER_GUI_PORT = 3000;
export { MUSTER_SPA_PORT };

export interface ActSlide {
  readonly opId: DemoOpId;
  readonly mode: OpMode;
  /**
   * Raw deck-cell params. Filled through `validateParams(...).resolved` so the
   * harness mirrors the loader's default-filling instead of hand-rolling it.
   */
  readonly params?: Readonly<Record<string, string>>;
}

export interface ExpectedArming {
  readonly withAoGui: boolean;
  readonly withEo: boolean;
  readonly withStamperGui: boolean;
  readonly withMuster: boolean;
}

export interface ActGroup {
  readonly id: string;
  /** The dossier entries this group is judging, for the report and the log. */
  readonly dossierEntries: readonly string[];
  readonly opIds: readonly DemoOpId[];
  readonly slides: readonly ActSlide[];
  readonly expectedArming: ExpectedArming;
  /** Every port arming should have brought up — probed free again by TD1. */
  readonly expectedPorts: readonly number[];
  /** The check ids this group's judge must account for. */
  readonly checkIds: readonly string[];
}

const NO_EXTRA_SURFACE: ExpectedArming = {
  withAoGui: false,
  withEo: false,
  withStamperGui: false,
  withMuster: false,
};

export const ACT_GROUPS: readonly ActGroup[] = [
  {
    id: 'muster-readiness',
    dossierEntries: ['D.3'],
    opIds: ['muster-readiness'],
    // GP-DEMO-5 streamgui: `warm` was dropped (a warm SPA drive shows a stale
    // panel). One LIVE slide — it runs the CLI walk, then imports the result into
    // the Muster SPA (:4173) and ends on the boundary panel.
    slides: [{ opId: 'muster-readiness', mode: 'live' }],
    // Arms the Muster SPA (:4173) now — it imports its CLI result into the SPA.
    expectedArming: { ...NO_EXTRA_SURFACE, withMuster: true },
    expectedPorts: [STACKSIM_PORT, MUSTER_SPA_PORT],
    checkIds: ['MR1', 'MR2', 'MR3', 'MR4', 'MR5', 'MR6', 'ARM1', 'TD1'],
  },
  {
    id: 'ao-registry',
    dossierEntries: ['D.11'],
    opIds: ['ao-registry'],
    slides: [
      { opId: 'ao-registry', mode: 'warm' },
      { opId: 'ao-registry', mode: 'live' },
    ],
    expectedArming: { ...NO_EXTRA_SURFACE, withAoGui: true },
    expectedPorts: [STACKSIM_PORT, AO_GUI_PORT],
    checkIds: ['AO1', 'AO2', 'AO3', 'AO4', 'ARM1', 'TD1'],
  },
  {
    // GP-DEMO-4 Slice 1B — `ao-make-change` (D.12). The remediating governed
    // change: `ao-registry`'s flow under a distinct id, defaulting to the
    // remediation command A-18. Single live slide; it does not branch on mode.
    id: 'ao-make-change',
    dossierEntries: ['D.12'],
    opIds: ['ao-make-change'],
    slides: [{ opId: 'ao-make-change', mode: 'live' }],
    expectedArming: { ...NO_EXTRA_SURFACE, withAoGui: true },
    expectedPorts: [STACKSIM_PORT, AO_GUI_PORT],
    checkIds: ['AM1', 'AM2', 'AM3', 'AM4', 'ARM1', 'TD1'],
  },
  {
    id: 'eo-review',
    dossierEntries: ['D.13', 'D.14'],
    opIds: ['eo-review'],
    // The ORDER is the point. `warm` hydrates the pane; `live` walks what warm
    // left there. Run them apart, or let a pane-navigating act between them, and
    // the live half self-heals — honest, but then the harness has measured the
    // degradation path instead of the act the deck actually performs.
    slides: [
      { opId: 'eo-review', mode: 'warm' },
      { opId: 'eo-review', mode: 'live' },
    ],
    expectedArming: { ...NO_EXTRA_SURFACE, withEo: true },
    expectedPorts: [STACKSIM_PORT, EO_PORT],
    checkIds: ['EO1', 'EO2', 'EO3', 'EO4', 'EO5', 'ARM1', 'TD1'],
  },
  {
    // GP-DEMO-4 Slice 1A — `eo-verify-evidence` (D.15). Runtime-verify of the
    // cross-act chain: an AO command executed live, then EO assessed and walked
    // to the Evidence Explorer landing. No new op id — this is `ao-registry` +
    // `eo-review` (land=evidence), a configuration the roster runs in one
    // lifecycle so the chain is proven end to end.
    //
    // AO is FIRST on purpose: `ao-registry` calls `ctx.pane.goto` unconditionally
    // (A.3 trap), so placing it after the EO warm would force the EO self-heal.
    // Order is AO(live) → EO(warm, hydrate) → EO(live, walk to evidence).
    id: 'eo-verify-evidence',
    dossierEntries: ['D.15'],
    opIds: ['ao-registry', 'eo-review'],
    slides: [
      { opId: 'ao-registry', mode: 'live' },
      { opId: 'eo-review', mode: 'warm' },
      { opId: 'eo-review', mode: 'live', params: { land: 'evidence' } },
    ],
    expectedArming: { ...NO_EXTRA_SURFACE, withAoGui: true, withEo: true },
    expectedPorts: [STACKSIM_PORT, AO_GUI_PORT, EO_PORT],
    checkIds: ['EV1', 'EV2', 'EV3', 'ARM1', 'TD1'],
  },
  {
    // GP-DEMO-4 Slice 1C — `eo-show-change-captured` (D.16). The loop-closes
    // proof: eo-review(warm) captures the BEFORE, ao-make-change(live) remediates,
    // eo-show-change-captured(live) re-assesses and compares. The BEFORE is
    // snapshotted between slide 0 and slide 1 by SLIDE_PROBES, while it is still
    // true. eo-review is FIRST (A.3 trap: ao-make-change navigates the pane).
    id: 'eo-show-change-captured',
    dossierEntries: ['D.16'],
    opIds: ['eo-review', 'ao-make-change', 'eo-show-change-captured'],
    slides: [
      { opId: 'eo-review', mode: 'warm' },
      { opId: 'ao-make-change', mode: 'live' },
      { opId: 'eo-show-change-captured', mode: 'live' },
    ],
    expectedArming: { ...NO_EXTRA_SURFACE, withAoGui: true, withEo: true },
    expectedPorts: [STACKSIM_PORT, AO_GUI_PORT, EO_PORT],
    checkIds: ['EC1', 'EC2', 'EC3', 'EC4', 'EC5', 'ARM1', 'TD1'],
  },
  {
    // GP-DEMO-4 Slice 2A — `simstack-create` (D.1). A READOUT over the armed
    // state: the sim answers, the registry record is usable, the report-only gap
    // is present. Adds no surface beyond the always-armed stacksim serve.
    id: 'simstack-create',
    dossierEntries: ['D.1'],
    opIds: ['simstack-create'],
    slides: [{ opId: 'simstack-create', mode: 'live' }],
    expectedArming: NO_EXTRA_SURFACE,
    expectedPorts: [STACKSIM_PORT],
    checkIds: ['SC1', 'SC2', 'SC3', 'ARM1', 'TD1'],
  },
  {
    // GP-DEMO-4 Slice 2B — `simstack-destroy` (D.2). Removes the sim registry
    // record (wrapping `teardownEphemeralSimTenant`, never `demo:reset`) and
    // keeps the run evidence. Put LAST in any multi-op group.
    id: 'simstack-destroy',
    dossierEntries: ['D.2'],
    opIds: ['simstack-destroy'],
    slides: [{ opId: 'simstack-destroy', mode: 'live' }],
    expectedArming: NO_EXTRA_SURFACE,
    expectedPorts: [STACKSIM_PORT],
    checkIds: ['SD1', 'SD2', 'SD3', 'SD4', 'ARM1', 'TD1'],
  },
  {
    // GP-DEMO-5 Slice 3.0 — `muster-gui` (D.4-D.8). The five Muster SPA acts
    // share ONE group grown incrementally (workflow-sequential SPA state, like
    // the eo-review warm→live pair). 3.0 seeds it with `muster-connect-tenant`.
    // Arming brings up the Vite preview on :4173.
    id: 'muster-gui',
    dossierEntries: ['D.4', 'D.5', 'D.6', 'D.7', 'D.8'],
    opIds: ['muster-connect-tenant', 'muster-auto-analysis', 'muster-consent-and-attest', 'muster-adaptive-interview', 'muster-generate-sprs-mp'],
    slides: [
      { opId: 'muster-connect-tenant', mode: 'live' },
      { opId: 'muster-auto-analysis', mode: 'live' },
      { opId: 'muster-consent-and-attest', mode: 'live' },
      { opId: 'muster-adaptive-interview', mode: 'live' },
      { opId: 'muster-generate-sprs-mp', mode: 'live' },
    ],
    expectedArming: { ...NO_EXTRA_SURFACE, withMuster: true },
    expectedPorts: [STACKSIM_PORT, MUSTER_SPA_PORT],
    checkIds: ['MU-C1', 'MA1', 'MA2', 'MA3', 'MA4', 'MC1', 'MC2', 'MC3', 'MI1', 'MP1', 'MP2', 'MP3', 'ARM1', 'TD1'],
  },
  {
    id: 'stamper',
    dossierEntries: ['D.9', 'D.10'],
    opIds: ['stamper-translate', 'stamper-execute'],
    // Both warm, and both on the BACKSTAGE session — Config is doctrine-gated
    // (THREAD_HANDOFF item 2, reaffirmed by decision 9 which lifted the
    // restriction for RE only), so no Config GUI ever reaches the visible pane.
    // Translate first leaves `#outputPath` populated, which is what makes
    // execute's ~5 min fast path the common case instead of the ~12 min flow.
    slides: [
      { opId: 'stamper-translate', mode: 'warm' },
      { opId: 'stamper-execute', mode: 'warm' },
    ],
    expectedArming: { ...NO_EXTRA_SURFACE, withStamperGui: true },
    expectedPorts: [STACKSIM_PORT, STAMPER_GUI_PORT],
    checkIds: ['ST1', 'ST2', 'ST3', 'ST4', 'SE1', 'SE2', 'SE3', 'SE4', 'ARM1', 'TD1'],
  },
];

export function actGroup(id: string): ActGroup | undefined {
  return ACT_GROUPS.find((g) => g.id === id);
}

export const ACT_GROUP_IDS: readonly string[] = ACT_GROUPS.map((g) => g.id);
