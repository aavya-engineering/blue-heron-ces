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

export type EvaluatorFn = (signals: SignalResult[]) => {
  status: ControlStatus;
  evidence: string;
};

export { hasSuccessSignal, getSignalData, hasValues } from './helpers.js';

export const evaluatorRegistry: Record<string, EvaluatorFn> = {
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
};

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
