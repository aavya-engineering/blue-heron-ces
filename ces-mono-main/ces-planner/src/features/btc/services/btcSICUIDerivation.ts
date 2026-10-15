// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline, CUIBoundaryOutput } from '@/shared/types/artifacts';
import type { BTCAnswer, RunlistEntry } from '../types';

export interface BTCDerivationResult {
  defaults: Record<string, BTCAnswer>;
  sourceLabels: Record<string, string>;
  skippableIds: Set<string>;
}

interface BTCMappingRule {
  questionId: string;
  sourceLabel: string;
  derive: (
    si: SIBaseline,
    cuiBoundary: CUIBoundaryOutput | null,
  ) => string | boolean | null;
}

const MAPPING_RULES: BTCMappingRule[] = [
  {
    questionId: 'BTC.DEVOPS.001',
    sourceLabel: 'SI DevOps scope',
    derive: (si) => {
      const devops = si.si_baseline?.operations?.devops_touches_cui;
      if (devops === false) return 'No';
      return null;
    },
  },
  {
    questionId: 'BTC.DEVOPS.002',
    sourceLabel: 'SI DevOps scope',
    derive: (si) => {
      const devops = si.si_baseline?.operations?.devops_touches_cui;
      if (devops === false) return 'N/A \u2013 DevOps not in scope';
      return null;
    },
  },
  {
    questionId: 'BTC.DEVOPS.003',
    sourceLabel: 'SI DevOps scope',
    derive: (si) => {
      const devops = si.si_baseline?.operations?.devops_touches_cui;
      if (devops === false) return 'N/A \u2013 DevOps not in scope';
      return null;
    },
  },
  {
    questionId: 'BTC.INT.003',
    sourceLabel: 'CUI egress controls',
    derive: (_si, cuiBoundary) => {
      if (!cuiBoundary) return null;
      const egrAnswer = cuiBoundary.cui_boundary?.['CUI.LC.EGR.001'];
      if (typeof egrAnswer === 'string' && egrAnswer.toLowerCase().includes('no')) {
        return 'No external email forwarding';
      }
      return null;
    },
  },
  {
    questionId: 'BTC.ID.001',
    sourceLabel: 'CUI identity isolation',
    derive: (_si, cuiBoundary) => {
      if (!cuiBoundary) return null;
      const answer = cuiBoundary.cui_boundary?.['CUI.ID.001'];
      if (typeof answer === 'string' && answer.toLowerCase().includes('isolated')) {
        return 'Yes – dedicated identity domain';
      }
      return null;
    },
  },
  {
    questionId: 'BTC.ID.002',
    sourceLabel: 'CUI shared identity',
    derive: (_si, cuiBoundary) => {
      if (!cuiBoundary) return null;
      const answer = cuiBoundary.cui_boundary?.['CUI.ID.002'];
      if (typeof answer === 'string') {
        if (answer.startsWith('Yes')) return 'Yes';
        if (answer === 'No') return 'No';
      }
      return null;
    },
  },
  {
    questionId: 'BTC.DEV.001',
    sourceLabel: 'CUI device model',
    derive: (_si, cuiBoundary) => {
      if (!cuiBoundary) return null;
      const answer = cuiBoundary.cui_boundary?.['CUI.DEV.001'];
      if (typeof answer === 'string') {
        const lower = answer.toLowerCase();
        if (lower.includes('managed only')) return 'Managed devices only';
        if (lower.includes('vdi')) return 'VDI / Cloud PC only';
        if (lower.includes('byod')) return 'BYOD with MDM enrollment required';
      }
      return null;
    },
  },
  {
    questionId: 'BTC.ID.003',
    sourceLabel: 'CUI user count',
    derive: (_si, cuiBoundary) => {
      if (!cuiBoundary) return null;
      const answer = cuiBoundary.cui_boundary?.['CUI.USR.002'];
      if (typeof answer === 'number' && answer > 0) {
        return `${answer} in-scope users identified`;
      }
      if (typeof answer === 'string') {
        const n = parseInt(answer, 10);
        if (!isNaN(n) && n > 0) return `${n} in-scope users identified`;
      }
      return null;
    },
  },
  {
    questionId: 'BTC.GOV.001',
    sourceLabel: 'CUI scope',
    derive: (_si, cuiBoundary) => {
      if (!cuiBoundary) return null;
      const answer = cuiBoundary.cui_boundary?.['CUI.GEN.001'];
      if (typeof answer === 'string') {
        const lower = answer.toLowerCase();
        if (lower.includes('both')) return 'CUI created and received';
        if (lower.includes('received')) return 'CUI received only';
      }
      return null;
    },
  },
  {
    questionId: 'BTC.LOG.001',
    sourceLabel: 'CUI retention policy',
    derive: (_si, cuiBoundary) => {
      if (!cuiBoundary) return null;
      const answer = cuiBoundary.cui_boundary?.['CUI.LC.RET.001'];
      if (typeof answer === 'string' && answer.trim().length > 0) {
        return answer;
      }
      return null;
    },
  },
];

/**
 * Derive BTC answer defaults from SI Baseline and CUI Boundary data.
 *
 * Key rule: evidence-required BTC questions are pre-filled but NOT skipped.
 * Only questions that are both derived AND do not require evidence are skippable.
 */
export function deriveBTCDefaults(
  siBaseline: SIBaseline,
  cuiBoundary: CUIBoundaryOutput | null,
  runlistEntries: RunlistEntry[],
): BTCDerivationResult {
  const runlistMap = new Map<string, RunlistEntry>();
  for (const entry of runlistEntries) {
    runlistMap.set(entry.question_id, entry);
  }

  const defaults: Record<string, BTCAnswer> = {};
  const sourceLabels: Record<string, string> = {};
  const skippableIds = new Set<string>();
  const now = new Date().toISOString();

  for (const rule of MAPPING_RULES) {
    const entry = runlistMap.get(rule.questionId);
    if (!entry || !entry.enabled) continue;

    const value = rule.derive(siBaseline, cuiBoundary);
    if (value === null) continue;

    defaults[rule.questionId] = {
      question_id: rule.questionId,
      raw_answer: value,
      mode: entry.mode,
      evidence_ids: [],
      captured_at: now,
      provenance_class: 'operator_inference',
    };
    sourceLabels[rule.questionId] = rule.sourceLabel;

    // Only skip if evidence is NOT required
    if (!entry.evidence_required) {
      skippableIds.add(rule.questionId);
    }
  }

  return { defaults, sourceLabels, skippableIds };
}
