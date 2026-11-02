// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: Translate (legacy card 3) state. The plan input paths are the values the legacy
// page reads from card 1 (#configMissionPlanPath, #configManifestPath, #configInfraManifestPath)
// and #outputPath when it translates and executes. Card 1 and its /api/last-translate load
// belong to W8-SPA1's configure screen, which writes them here through setPlanInputs,
// setOutputPath and setVariablesPath (LOG-W8-SPA2 Open item 1). The actions that also move the
// execute card (doTranslate, the dev quick run) live in ./execute.

import { create } from 'zustand';
import { ApiError, stamperApi } from '../api';
import type { TranslateBody } from '../api';

export interface CardBadge {
  text: string;
  /** Legacy class after `card-status-badge`: status-locked, status-default, status-running, status-done, status-error. */
  cls: string;
}

export const LOCKED_BADGE: CardBadge = { text: 'Locked', cls: 'status-locked' };
/** FIN-33: card 3 once Translate is ready, before a translate (legacy updateCardStatus(3, 'Pending')). */
export const PENDING_BADGE: CardBadge = { text: 'Pending', cls: 'status-default' };

/** POST /api/translate reply (translate.routes.ts L271-289). */
export interface TranslateReply {
  success: boolean;
  error?: string;
  planId?: string;
  totalTasks?: number;
  warnings?: unknown[];
  preAccomplished?: number;
  infraVarsMerged?: number;
  directiveCounts?: { automated: number; excluded: number; nonstack: number };
  gapsOnly?: boolean;
  gapsRemoved?: number;
  planDataPaths?: { missionPlan?: string; manifest?: string; output?: string; infraManifest?: string; variables?: string };
}

export interface PlanInputs {
  missionPlan: string;
  manifest: string;
  infraManifest: string;
}

export interface TranslateState extends PlanInputs {
  /** `#outputPath` (read-only; set by a translate reply or by card 1's last-translate load). */
  outputPath: string;
  /** Legacy `varsFilePath` (plan variables file of the last translate). */
  variablesPath: string;
  gapsOnly: boolean;
  automatedOnly: boolean;
  badge: CardBadge;
  lastReply: TranslateReply | null;
  setPlanInputs: (inputs: Partial<PlanInputs>) => void;
  setOutputPath: (path: string) => void;
  setVariablesPath: (path: string) => void;
  /** Legacy onGapsOnlyChange: Gaps Only clears and disables Automated Only. */
  setGapsOnly: (on: boolean) => void;
  /** Legacy onAutomatedOnlyChange: Automated Only clears and disables Gaps Only. */
  setAutomatedOnly: (on: boolean) => void;
  setBadge: (badge: CardBadge) => void;
  setLastReply: (reply: TranslateReply | null) => void;
  reset: () => void;
}

const INITIAL = {
  missionPlan: '',
  manifest: '',
  infraManifest: '',
  outputPath: '',
  variablesPath: '',
  gapsOnly: false,
  automatedOnly: true,
  badge: LOCKED_BADGE,
  lastReply: null,
};

export const useTranslateStore = create<TranslateState>()((set) => ({
  ...INITIAL,
  setPlanInputs: (inputs) => set(inputs),
  setOutputPath: (outputPath) => set({ outputPath }),
  setVariablesPath: (variablesPath) => set({ variablesPath }),
  setGapsOnly: (gapsOnly) => set(gapsOnly ? { gapsOnly: true, automatedOnly: false } : { gapsOnly: false }),
  setAutomatedOnly: (automatedOnly) => set(automatedOnly ? { automatedOnly: true, gapsOnly: false } : { automatedOnly: false }),
  setBadge: (badge) => set({ badge }),
  setLastReply: (lastReply) => set({ lastReply }),
  reset: () => set(INITIAL),
}));

/** Gaps Only is disabled while Automated Only is on, and the other way round. */
export function translateToggleDisabled(state: Pick<TranslateState, 'gapsOnly' | 'automatedOnly'>) {
  return { gapsOnly: state.automatedOnly, automatedOnly: state.gapsOnly };
}

/**
 * The card-3 request body, keys in the legacy order (L7673). Empty optional paths are left out
 * (legacy sends `undefined`, which JSON drops).
 */
export function translateBody(s: TranslateState, tenant: string | null): TranslateBody {
  return {
    missionPlan: s.missionPlan.trim(),
    manifest: s.manifest.trim(),
    output: s.outputPath.trim() || undefined,
    infraManifest: s.infraManifest.trim() || undefined,
    tenant: tenant || undefined,
    gapsOnly: s.gapsOnly,
    automatedOnly: s.automatedOnly,
  };
}

/** The dev quick-run body: the same paths, no Gaps Only / Automated Only keys (L7759). */
export function quickRunBody(s: TranslateState, tenant: string | null): TranslateBody {
  return {
    missionPlan: s.missionPlan.trim(),
    manifest: s.manifest.trim(),
    output: s.outputPath.trim() || undefined,
    infraManifest: s.infraManifest.trim() || undefined,
    tenant: tenant || undefined,
  };
}

/** The legacy success line (L7688-7704). */
export function translateSuccessMessage(data: TranslateReply): string {
  let msg = `Translated: ${data.planId} — ${data.totalTasks} tasks`;
  if ((data.infraVarsMerged ?? 0) > 0) msg += ` | ${data.infraVarsMerged} infra vars merged`;
  if (data.gapsOnly && (data.gapsRemoved ?? 0) > 0) msg += ` | ${data.gapsRemoved} completed tasks removed (gaps only)`;
  if ((data.preAccomplished ?? 0) > 0) msg += ` | ${data.preAccomplished} pre-accomplished`;
  if (data.warnings && data.warnings.length > 0) msg += ` | ${data.warnings.length} warning(s)`;
  if (data.directiveCounts) {
    msg += ` | Directives: Automated (${data.directiveCounts.automated}), Excluded (${data.directiveCounts.excluded}), Non-Stack (${data.directiveCounts.nonstack})`;
  }
  return msg;
}

/**
 * Sends POST /api/translate and returns the reply. Legacy reads the JSON body whatever the
 * HTTP status (400 and 500 carry `{ success: false, error }`), so an HTTP error with a JSON
 * body is returned as that reply; a transport failure throws.
 */
export async function requestTranslate(body: TranslateBody): Promise<TranslateReply> {
  try {
    return (await stamperApi.translate(body)) as TranslateReply;
  } catch (err) {
    if (err instanceof ApiError && err.payload && typeof err.payload === 'object') return err.payload as TranslateReply;
    throw err;
  }
}
