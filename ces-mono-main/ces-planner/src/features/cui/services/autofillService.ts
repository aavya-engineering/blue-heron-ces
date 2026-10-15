// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { CUIAnswer, CUISectionDef } from '../types';
import type { SIBaseline } from '@/shared/types/artifacts';
import { deriveCUIDefaults } from './cuiSIDerivation';

/**
 * Hardcoded good-choice defaults for a typical M365 GCC High DoD contractor.
 * Keyed by question ID → raw_answer value.
 */
const CUI_DEFAULTS: Record<string, string | number | string[]> = {
  'CUI.CAT.001': ['Controlled Technical Information (CTI)', 'Export-controlled data (ITAR)'],
  'CUI.CONTRACT.001': ['DFARS 252.204-7012'],
  'CUI.GEN.001': 'Both',
  'CUI.GEN.002': ['Engineering', 'Program Management', 'Security/IT'],
  'CUI.LC.ING.001': ['Encrypted email', 'Prime/customer portal', 'Teams/SharePoint sharing'],
  'CUI.LC.STO.001': [
    'SharePoint Online (GCC High)',
    'OneDrive (GCC High)',
    'Exchange mailboxes',
    'Teams file libraries',
  ],
  'CUI.LC.PROC.001': ['Microsoft 365', 'SharePoint', 'Teams'],
  'CUI.LC.EGR.001': 'Yes – controlled external sharing',
  'CUI.LC.RET.001': 'Contract-specific retention',
  'CUI.USR.001': ['Engineers', 'Program Managers', 'IT Admins', 'Security Team'],
  'CUI.USR.002': 25,
  'CUI.ID.001': 'Yes – fully isolated tenant',
  'CUI.ID.002': 'No',
  'CUI.DEV.001': 'Yes – managed only',
  'CUI.DEV.002': 'Planned',
  'CUI.DEVOPS.001': 'Yes – fully in scope',
  'CUI.DEVOPS.002': ['Azure DevOps (GCC High)'],
  'CUI.INT.001': ['Ticketing system', 'SIEM'],
  'CUI.INT.002': 'No',
  'CUI.INT.003': 'Yes',
  'CUI.BKP.001': 'M365 native only',
  'CUI.OOS.001': ['Personal devices', 'Commercial tenant'],
  'CUI.OOS.002':
    'Conditional Access policies restrict sign-in to compliant managed devices; DLP and sensitivity labels prevent CUI from leaving the boundary.',
  'CUI.ENF.001': [
    'Conditional Access',
    'Intune compliance enforcement',
    'DLP policies',
    'Sensitivity labels',
  ],
};

/**
 * Generate autofill answers for all CUI questions using hardcoded good-choice defaults.
 * Falls back to sensible defaults for any question ID not in the map.
 */
export function autofillCUIAnswers(
  sections: CUISectionDef[],
  siBaseline?: SIBaseline | null
): Record<string, CUIAnswer> {
  // When SI Baseline is available, merge SI-derived defaults over hardcoded ones
  let mergedDefaults = CUI_DEFAULTS;
  if (siBaseline) {
    const { defaults: siDefaults } = deriveCUIDefaults(siBaseline, sections);
    const overrides: Record<string, string | number | string[]> = {};
    for (const [qId, answer] of Object.entries(siDefaults)) {
      overrides[qId] = answer.raw_answer;
    }
    mergedDefaults = { ...CUI_DEFAULTS, ...overrides };
  }
  const answers: Record<string, CUIAnswer> = {};
  const now = new Date().toISOString();

  for (const section of sections) {
    for (const question of section.questions) {
      const hardcoded = mergedDefaults[question.id];

      let rawAnswer: string | number | string[];
      if (hardcoded !== undefined) {
        rawAnswer = hardcoded;
      } else {
        // Fallback by answer type
        switch (question.answer_type) {
          case 'multi_select':
            rawAnswer = question.options.length > 0 ? [question.options[0]] : [];
            break;
          case 'single_select':
            rawAnswer = question.options[0] ?? '';
            break;
          case 'list':
            rawAnswer = [];
            break;
          case 'number':
            rawAnswer = 0;
            break;
          case 'text':
            rawAnswer = '';
            break;
          default:
            rawAnswer = '';
        }
      }

      answers[question.id] = {
        question_id: question.id,
        answer_type: question.answer_type,
        raw_answer: rawAnswer,
        captured_at: now,
        provenance_class: 'client_assertion',
      };
    }
  }

  return answers;
}
