// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G13 — Google Workspace evaluators.
//
// Evaluator functions for Google Workspace control signals. Each function matches
// the EvaluatorFn contract: receives a SignalResult[] and returns {status, evidence}.
// Key is the evaluator name referenced in google-workspace-control-signal-registry.json.

import type { SignalResult } from 'ces-shared/types/signal';
import type { EvaluatorFn } from './index.js';

/**
 * IA.L2-3.5.3 — Multi-Factor Authentication (Google Workspace 2-Step Verification).
 * Checks for a google_2sv_enforced signal with a truthy `enforcedForAllUsers` property.
 * The `isEnforcedIn2Sv` field on GET /admin/directory/v1/users is the direct signal source.
 */
const google_2sv_enforced_evaluator: EvaluatorFn = (signals: SignalResult[]) => {
  if (signals.length === 0) {
    return {
      status: 'not_met',
      evidence: '2-Step Verification enforcement status could not be determined: no signals received.',
    };
  }

  for (const signal of signals) {
    const data = signal.rawData as Record<string, unknown> | undefined;
    if (data?.enforcedForAllUsers === true || data?.isEnforcedIn2Sv === true) {
      return {
        status: 'met',
        evidence:
          '2-Step Verification (2SV) is enforced for all users in the Google Workspace domain. ' +
          'This satisfies the multi-factor authentication requirement for IA.L2-3.5.3.',
      };
    }
  }

  return {
    status: 'not_met',
    evidence:
      '2-Step Verification (2SV) enforcement was not confirmed for all users. ' +
      'Enable 2SV enforcement in Google Admin Console to satisfy IA.L2-3.5.3.',
  };
};

export const googleWorkspaceEvaluators: Record<string, EvaluatorFn> = {
  google_2sv_enforced_evaluator,
};
