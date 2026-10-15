// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline } from '@/shared/types/artifacts';
import type { TCPAnswer, TCPSectionDef } from '../types';

export interface TCPDerivationResult {
  defaults: Record<string, TCPAnswer>;
  sourceLabels: Record<string, string>;
}

interface MappingRule {
  questionId: string;
  sourceLabel: string;
  derive: (siBaseline: SIBaseline) => string | number | boolean | string[] | null;
}

const MAPPING_RULES: MappingRule[] = [
  {
    questionId: 'TCP.TI.004',
    sourceLabel: 'SI tenant model',
    derive: (si) => {
      const tenant = si.si_baseline?.dependencies?.tenant_model_preference;
      if (!tenant) return null;
      if (tenant === 'gcc_high' || tenant === 'dod_il5' || tenant === 'dod_il6') return 'GCC High';
      if (tenant === 'gcc') return 'GCC';
      if (tenant === 'commercial_only') return 'Commercial';
      return null;
    },
  },
  {
    questionId: 'TCP.IA.004',
    sourceLabel: 'SI deployment posture',
    derive: (si) => {
      const posture = si.si_baseline?.scope?.deployment_posture;
      if (!posture) return null;
      if (posture === 'cloud_only') return 'Entra ID native (cloud-only)';
      if (posture === 'hybrid') return 'Hybrid with AD Connect';
      return null;
    },
  },
  {
    questionId: 'TCP.IA.005',
    sourceLabel: 'SI deployment posture',
    derive: (si) => {
      const posture = si.si_baseline?.scope?.deployment_posture;
      if (!posture) return null;
      return posture === 'hybrid';
    },
  },
  {
    questionId: 'TCP.DM.001',
    sourceLabel: 'SI BYOD posture',
    derive: (si) => {
      const byod = si.si_baseline?.operations?.byod_posture;
      if (!byod) return null;
      if (byod === 'not_allowed') return 'Azure AD Join';
      if (byod === 'allowed_vdi_only') return 'Azure AD Join';
      if (byod === 'allowed_mdm') return 'Enroll Only (BYOD MDM)';
      return null;
    },
  },
  {
    questionId: 'TCP.LIC.002',
    sourceLabel: 'SI user estimate',
    derive: (si) => {
      const users = si.si_baseline?.scope?.in_scope_users_estimate;
      if (users === undefined || users === null) return null;
      return users;
    },
  },
];

/**
 * Derive TCP answer defaults from an SI Baseline.
 * Answers get provenance_class 'operator_inference' for auto-skip.
 */
export function deriveTCPDefaults(
  siBaseline: SIBaseline,
  sections: TCPSectionDef[],
): TCPDerivationResult {
  const validQuestionIds = new Set<string>();
  const questionDefMap = new Map<string, TCPSectionDef['questions'][number]>();
  for (const section of sections) {
    for (const q of section.questions) {
      validQuestionIds.add(q.id);
      questionDefMap.set(q.id, q);
    }
  }

  const defaults: Record<string, TCPAnswer> = {};
  const sourceLabels: Record<string, string> = {};
  const now = new Date().toISOString();

  for (const rule of MAPPING_RULES) {
    if (!validQuestionIds.has(rule.questionId)) continue;

    const value = rule.derive(siBaseline);
    if (value === null) continue;

    const questionDef = questionDefMap.get(rule.questionId);
    if (!questionDef) continue;

    defaults[rule.questionId] = {
      question_id: rule.questionId,
      answer_type: questionDef.answer_type,
      raw_answer: value,
      captured_at: now,
      provenance_class: 'operator_inference',
    };
    sourceLabels[rule.questionId] = rule.sourceLabel;
  }

  return { defaults, sourceLabels };
}
