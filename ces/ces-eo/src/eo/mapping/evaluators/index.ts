// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SignalResult } from 'ces-shared/types/signal';
import type { ControlStatus } from 'ces-shared/types/controls';

import { acEvaluators } from './ac-evaluators.js';
import { iaEvaluators } from './ia-evaluators.js';
import { auEvaluators } from './au-evaluators.js';
import { scEvaluators } from './sc-evaluators.js';
import { siEvaluators } from './si-evaluators.js';
import { cmEvaluators } from './cm-evaluators.js';
import { operationalEvaluators } from './operational-evaluators.js';
import { coverageEvaluators } from './coverage-evaluators.js';
import { googleWorkspaceEvaluators } from './googleWorkspaceEvaluators.js';
import type { EvaluatorContext } from './conditions.js';

export type { EvaluatorContext, ExpectedValueCheck } from './conditions.js';

/**
 * W5 cycle 1: the optional `ctx` carries the control's Tenant Manifest expected values (and the
 * break-glass / admin account lists). When it is absent the rewritten evaluators use the
 * requirement defaults (`conditions.ts` REQUIREMENT_DEFAULTS).
 */
export type EvaluatorFn = ((signals: SignalResult[], ctx?: EvaluatorContext) => {
  status: ControlStatus;
  evidence: string;
}) & {
  /**
   * Founder decision 2026-10-27: a verdict from a presence-only evaluator (met when the read
   * returned any object; the setting is not inspected) still counts, but is labelled
   * "presence only" in the source, the status rationale, the ledger and the SSP.
   * Declared on the registry entry by PRESENCE_ONLY_EVALUATORS below, never inferred from text.
   */
  readonly presenceOnly?: true;
};

export { hasSuccessSignal, getSignalData, hasValues } from './helpers.js';

/**
 * The evaluators that docs/EVALUATOR-AUDIT.md classifies "presence only". When one is rewritten to
 * test the setting, its audit row and its name here are removed together. Synthetic-customer W5
 * cycle 1 rewrote 44 (the AC and IA families, and the CM, SC, SI, MA and MP evaluators whose data
 * the S1 simulator serves): 65 -> 21. W5 cycle 2 (EO-2) rewrote the four that a Stamper
 * settings-catalog entry configures (CM.L2-3.4.2 ASR rules; SC.L1-3.13.1 / 3.13.5, SC.L2-3.13.6
 * firewall): 21 -> 17. W5 cycle 7 rewrote AU.L2-3.3.7 (time synchronisation, settings catalog): 17 -> 16.
 */
export const PRESENCE_ONLY_EVALUATORS: ReadonlySet<string> = new Set([
  // cm
  'configAccessRestrictEvaluator', 'detectedAppsEvaluator',
  // sc
  'architecturalDesignEvaluator',
  'securityFunctionIsolationEvaluator', 'sharedResourceControlEvaluator',
  'fipsCryptoEvaluator', 'cryptoKeyManagementEvaluator', 'safeAttachmentsEvaluator', 'voipEvaluator',
  'emailProtectionEvaluator', 'mobileCodeEvaluator',
  // si
  'flawRemediationL1Evaluator',
  // operational
  'sensitivityLabelEvaluator', 'mediaMarkingEvaluator', 'mediaAccessEvaluator', 'bitLockerPolicyEvaluator',
]);

/** Sets the declared `presenceOnly` property on each listed registry entry; an unknown name throws. */
function declarePresenceOnly(registry: Record<string, EvaluatorFn>): Record<string, EvaluatorFn> {
  for (const name of PRESENCE_ONLY_EVALUATORS) {
    const fn = registry[name];
    if (!fn) throw new Error(`PRESENCE_ONLY_EVALUATORS names an unregistered evaluator: ${name}`);
    Object.defineProperty(fn, 'presenceOnly', { value: true, enumerable: true });
  }
  return registry;
}

export const evaluatorRegistry: Record<string, EvaluatorFn> = declarePresenceOnly({
  ...acEvaluators,
  ...iaEvaluators,
  ...auEvaluators,
  ...scEvaluators,
  ...siEvaluators,
  ...cmEvaluators,
  ...operationalEvaluators,
  // FC-EO-D (EO-03): evaluators for the six automatic-signal-coverage controls (now registered
  // directly in the shared Microsoft control-signal registry as of ces-shared 2.8.0).
  ...coverageEvaluators,
});

/**
 * G4 — capability id of the Microsoft reference evaluator set. Binds to the existing
 * evaluatorRegistry above (behavior unchanged).
 */
export const MICROSOFT_EVALUATOR_SET_ID = 'microsoft-evaluators';

/**
 * G13 — capability id of the Google Workspace evaluator set.
 */
export const GOOGLE_EVALUATOR_SET_ID = 'google-workspace-evaluators';

/**
 * G4 — select the evaluator set for a stack by its capability `evaluatorSetId`.
 * 'microsoft-evaluators' (default / absent) ⇒ the existing evaluatorRegistry (unchanged).
 * 'google-workspace-evaluators' ⇒ the Google Workspace evaluator set.
 * Any other / unknown id (e.g. the proof stub's 'stub-empty') ⇒ an EMPTY set, so every control
 * falls back to not_assessed with NO authored evaluators.
 */
export function selectEvaluatorRegistry(evaluatorSetId?: string): Record<string, EvaluatorFn> {
  if (evaluatorSetId === undefined || evaluatorSetId === MICROSOFT_EVALUATOR_SET_ID) {
    return evaluatorRegistry;
  } else if (evaluatorSetId === GOOGLE_EVALUATOR_SET_ID) {
    return googleWorkspaceEvaluators;
  }
  return {};
}
