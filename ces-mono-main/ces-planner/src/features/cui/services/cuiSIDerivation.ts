// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline } from '@/shared/types/artifacts';
import type { CUIAnswer, CUISectionDef } from '../types';

export interface CUIDerivationResult {
  defaults: Record<string, CUIAnswer>;
  sourceLabels: Record<string, string>;
  skipCUI: boolean;
  fciOnly: boolean;
}

/**
 * SI field → CUI question mapping rules.
 * Each entry maps an SI Baseline field to a CUI question ID + value transform.
 */
interface MappingRule {
  questionId: string;
  sourceLabel: string;
  derive: (siBaseline: SIBaseline) => string | number | string[] | null;
}

const MAPPING_RULES: MappingRule[] = [
  {
    questionId: 'CUI.ID.001',
    sourceLabel: 'SI tenant model',
    derive: (si) => {
      const tenant = si.si_baseline?.dependencies?.tenant_model_preference;
      if (!tenant) return null;
      if (['gcc_high', 'dod_il5', 'dod_il6'].includes(tenant)) {
        return 'Yes – fully isolated tenant';
      }
      return null;
    },
  },
  {
    questionId: 'CUI.DEV.001',
    sourceLabel: 'SI BYOD posture',
    derive: (si) => {
      const byod = si.si_baseline?.operations?.byod_posture;
      if (!byod) return null;
      switch (byod) {
        case 'not_allowed':
          return 'Yes – managed only';
        case 'allowed_vdi_only':
          return 'BYOD via VDI/Cloud PC';
        case 'allowed_mdm':
          return 'BYOD direct access allowed';
        default:
          return null;
      }
    },
  },
  {
    questionId: 'CUI.DEVOPS.001',
    sourceLabel: 'SI DevOps scope',
    derive: (si) => {
      const devops = si.si_baseline?.operations?.devops_touches_cui;
      if (devops === undefined || devops === null) return null;
      return devops ? 'Yes – fully in scope' : 'No';
    },
  },
  {
    questionId: 'CUI.LC.EGR.001',
    sourceLabel: 'SI collaboration mode',
    derive: (si) => {
      const collab = si.si_baseline?.operations?.collaboration_mode;
      if (!collab) return null;
      if (['teams_first', 'email_first', 'mixed'].includes(collab)) {
        return 'Yes – controlled external sharing';
      }
      return null;
    },
  },
  {
    questionId: 'CUI.GEN.001',
    sourceLabel: 'SI CUI presence',
    derive: (si) => {
      const cui = si.si_baseline?.target?.cui_presence;
      if (!cui) return null;
      if (cui === 'cui_present' || cui === 'cui_plus_other_sensitive') return 'Both';
      if (cui === 'fci_only') return 'No – only received';
      // no_cui is handled by skipCUI flag
      return null;
    },
  },
  {
    questionId: 'CUI.USR.002',
    sourceLabel: 'SI user estimate',
    derive: (si) => {
      const users = si.si_baseline?.scope?.in_scope_users_estimate;
      if (users === undefined || users === null) return null;
      return users;
    },
  },
  {
    questionId: 'CUI.ID.002',
    sourceLabel: 'SI tenant model',
    derive: (si) => {
      const tenant = si.si_baseline?.dependencies?.tenant_model_preference;
      if (!tenant) return null;
      // Isolated tenants (GCC High, DoD IL5/IL6) → identity not shared
      if (['gcc_high', 'dod_il5', 'dod_il6'].includes(tenant)) return 'No';
      // Commercial / GCC → identity typically shared
      if (['commercial_only', 'gcc'].includes(tenant)) return 'Yes';
      return null;
    },
  },
  {
    questionId: 'CUI.LC.RET.001',
    sourceLabel: 'SI retention target',
    derive: (si) => {
      const days = si.si_baseline?.evidence?.retention_target_days;
      if (days === undefined || days === null || days <= 0) return null;
      return 'Standard retention schedule';
    },
  },
];

/**
 * Derive CUI answer defaults from an SI Baseline.
 * Answers get provenance_class 'operator_inference' to distinguish from user-entered.
 */
export function deriveCUIDefaults(
  siBaseline: SIBaseline,
  sections: CUISectionDef[]
): CUIDerivationResult {
  const cuiPresence = siBaseline.si_baseline?.target?.cui_presence;
  const skipCUI = cuiPresence === 'no_cui';
  const fciOnly = cuiPresence === 'fci_only';

  // Build set of valid question IDs from sections
  const validQuestionIds = new Set<string>();
  const questionDefMap = new Map<string, CUISectionDef['questions'][number]>();
  for (const section of sections) {
    for (const q of section.questions) {
      validQuestionIds.add(q.id);
      questionDefMap.set(q.id, q);
    }
  }

  const defaults: Record<string, CUIAnswer> = {};
  const sourceLabels: Record<string, string> = {};
  const now = new Date().toISOString();

  for (const rule of MAPPING_RULES) {
    // Skip unrecognized question IDs
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

  // Cross-question derivation: CUI.OOS.002 from peer defaults
  if (validQuestionIds.has('CUI.OOS.002') && !defaults['CUI.OOS.002']) {
    const text = deriveCUITechnicalControls(defaults);
    if (text) {
      defaults['CUI.OOS.002'] = {
        question_id: 'CUI.OOS.002',
        answer_type: 'text',
        raw_answer: text,
        captured_at: now,
        provenance_class: 'operator_inference',
      };
      sourceLabels['CUI.OOS.002'] = 'CUI peer answers';
    }
  }

  return { defaults, sourceLabels, skipCUI, fciOnly };
}

/**
 * Derive CUI.OOS.002 ("What technical controls prevent CUI from entering
 * out-of-scope systems?") from peer CUI answers.
 *
 * Builds a narrative from upstream answers the user has already provided:
 *  - CUI.DEV.001 (device model)
 *  - CUI.ID.001  (tenant isolation)
 *  - CUI.LC.STO.001 (CUI storage locations)
 *  - CUI.LC.EGR.001 (egress model)
 *  - CUI.INT.002 (email forwarding)
 *  - CUI.ENF.001 (enforcement mechanisms — answered after OOS.002 in wizard,
 *                  but available on re-derivation or autofill)
 */
export function deriveCUITechnicalControls(
  answers: Record<string, CUIAnswer>,
): string | null {
  const clauses: string[] = [];

  const dev = String(answers['CUI.DEV.001']?.raw_answer || '');
  const tenant = String(answers['CUI.ID.001']?.raw_answer || '');
  const egress = String(answers['CUI.LC.EGR.001']?.raw_answer || '');
  const emailFwd = String(answers['CUI.INT.002']?.raw_answer || '');
  const storage = answers['CUI.LC.STO.001']?.raw_answer;
  const enforcement = answers['CUI.ENF.001']?.raw_answer;

  // Device model → access control
  if (dev.includes('managed only')) {
    clauses.push(
      'Conditional Access policies restrict sign-in to compliant managed devices',
    );
  } else if (dev.includes('VDI') || dev.includes('Cloud PC')) {
    clauses.push(
      'Conditional Access policies restrict CUI access to VDI/Cloud PC sessions',
    );
  }

  // Tenant isolation
  if (tenant.includes('fully isolated')) {
    clauses.push('CUI workloads are isolated in a dedicated GCC High tenant');
  }

  // Storage boundary
  if (Array.isArray(storage)) {
    const gccHigh = storage.some((s) =>
      s.toLowerCase().includes('gcc high'),
    );
    if (gccHigh) {
      clauses.push('CUI storage is restricted to GCC High workloads');
    }
  }

  // Egress controls
  if (egress.includes('controlled')) {
    clauses.push(
      'DLP policies and sensitivity labels prevent unauthorized CUI egress',
    );
  } else if (egress === 'No') {
    clauses.push('CUI is not transmitted outside the enclave boundary');
  }

  // Email forwarding
  if (emailFwd === 'No') {
    clauses.push('email forwarding is disabled for in-scope users');
  } else if (emailFwd.includes('restricted')) {
    clauses.push('email forwarding is restricted to approved domains only');
  }

  // Enforcement mechanisms (CUI.ENF.001 — answered after OOS.002 in wizard,
  // but available on re-derivation or when autofill is used)
  if (Array.isArray(enforcement) && enforcement.length > 0) {
    const alreadyMentioned = clauses.join(' ').toLowerCase();
    const additional = enforcement.filter((m) => {
      const ml = m.toLowerCase();
      if (ml === 'none') return false;
      if (ml.includes('conditional access') && alreadyMentioned.includes('conditional access'))
        return false;
      if (ml.includes('dlp') && alreadyMentioned.includes('dlp')) return false;
      if (ml.includes('sensitivity') && alreadyMentioned.includes('sensitivity')) return false;
      if (ml.includes('intune') && alreadyMentioned.includes('managed devices')) return false;
      return true;
    });
    if (additional.length > 0) {
      clauses.push(`additional enforcement via ${additional.join(', ')}`);
    }
  }

  if (clauses.length === 0) return null;

  return clauses.join('; ') + '.';
}
