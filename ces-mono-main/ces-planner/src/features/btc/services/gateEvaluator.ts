// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { Runlist, BTCAnswer } from '../types';
import type { BTCEvidenceRef, BTCGateStatus } from '@/shared/types/artifacts';

export function evaluateGateStatuses(
  runlist: Runlist,
  answers: Record<string, BTCAnswer>,
  evidence: BTCEvidenceRef[]
): Record<string, BTCGateStatus> {
  // Group entries by section_id
  const bySection = new Map<string, typeof runlist.entries>();
  for (const entry of runlist.entries) {
    const list = bySection.get(entry.section_id) || [];
    list.push(entry);
    bySection.set(entry.section_id, list);
  }

  const evidenceByQuestion = new Map<string, BTCEvidenceRef[]>();
  for (const e of evidence) {
    const list = evidenceByQuestion.get(e.question_id) || [];
    list.push(e);
    evidenceByQuestion.set(e.question_id, list);
  }

  const gates: Record<string, BTCGateStatus> = {};

  for (const [sectionId, entries] of bySection) {
    const domain = entries[0]?.domain || sectionId;
    const failures: string[] = [];

    for (const entry of entries) {
      if (!entry.required) continue;

      const answer = answers[entry.question_id];
      if (!answer) {
        failures.push(`${entry.question_id}: not answered`);
        continue;
      }

      if (entry.evidence_required) {
        const qEvidence = evidenceByQuestion.get(entry.question_id) || [];
        if (qEvidence.length === 0) {
          failures.push(`${entry.question_id}: evidence required but not provided`);
        }
      }
    }

    gates[sectionId] = {
      domain,
      pass: failures.length === 0,
      reason: failures.length === 0 ? 'All requirements met' : failures.join('; '),
    };
  }

  return gates;
}
