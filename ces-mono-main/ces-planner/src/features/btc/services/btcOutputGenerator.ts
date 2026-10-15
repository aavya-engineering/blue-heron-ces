// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { BTCConfirmationOutput, BTCEvidenceRef } from '@/shared/types/artifacts';
import type { Runlist, BTCAnswer } from '../types';
import { evaluateGateStatuses } from './gateEvaluator';

export function generateBTCConfirmation(
  answers: Record<string, BTCAnswer>,
  evidence: BTCEvidenceRef[],
  runlist: Runlist,
  bankVersion: string,
  activationPackageVersion: string
): BTCConfirmationOutput {
  // Transform answers to output format using bindings.btc.* from the runlist questions
  const answerOutputs: BTCConfirmationOutput['btc_confirmation']['answers'] = {};
  for (const entry of runlist.entries) {
    const answer = answers[entry.question_id];
    if (!answer) continue;

    answerOutputs[entry.question_id] = {
      question_id: entry.question_id,
      answer: answer.raw_answer,
      mode: answer.mode,
      evidence_ids: answer.evidence_ids,
      captured_at: answer.captured_at,
    };
  }

  const gateStatus = evaluateGateStatuses(runlist, answers, evidence);

  return {
    ces: {
      artifact: 'btc_confirmation_output',
      version: '1.0',
      generated_on: new Date().toISOString().slice(0, 10),
      btc_bank_version: bankVersion,
      activation_package_version: activationPackageVersion,
    },
    btc_confirmation: {
      answers: answerOutputs,
      evidence_refs: evidence,
      risk_flags: runlist.risk_flags,
      gate_status: gateStatus,
      decision_log: runlist.decision_log,
    },
  };
}
