// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useMemo } from 'react';
import { useBTCQuestionBank, useBTCHelpOverlay } from '@/shared/hooks/useDataLoader';
import type { BTCSectionDef, BTCQuestionDef } from '../types';

export function useBTCQuestions() {
  const { data: raw, loading, error, fromCache } = useBTCQuestionBank();
  const { data: helpOverlay } = useBTCHelpOverlay();

  const result = useMemo(() => {
    if (!raw) return { sections: [], virtualQuestions: [], bankVersion: '1.0' };

    const rawSections = raw.sections || [];
    const sections: BTCSectionDef[] = rawSections.map((s: Record<string, unknown>) => ({
      id: s.id as string,
      name: s.name as string,
      activation: (s.activation as BTCSectionDef['activation']) || {
        default_mode: 'full',
        gating: true,
      },
      questions: ((s.questions as Record<string, unknown>[]) || []).map(
        (q: Record<string, unknown>): BTCQuestionDef => {
          const qId = q.id as string;
          const helpEntry = helpOverlay?.questions?.[qId];
          return {
            id: qId,
            section: q.section as string,
            prompt: q.prompt as string,
            answer_type: q.answer_type as BTCQuestionDef['answer_type'],
            options: (q.options as string[]) || [],
            required: (q.required as boolean) ?? true,
            help: (q.help as string) || '',
            roles: (q.roles as BTCQuestionDef['roles']) || {
              primary_respondents: [],
              validators: [],
            },
            validations: (q.validations as BTCQuestionDef['validations']) || [],
            risk_flags: (q.risk_flags as string[]) || [],
            bindings: (q.bindings as BTCQuestionDef['bindings']) || {},
            activation: (q.activation as BTCQuestionDef['activation']) || {
              default_mode: 'full',
            },
            aliases: (q.aliases as string[]) || [],
            guidance: helpEntry?.guidance,
            option_help: helpEntry?.options,
          };
        }
      ),
    }));

    const rawVirtual = (raw.virtual_questions as Record<string, unknown>[]) || [];
    const virtualQuestions: BTCQuestionDef[] = rawVirtual.map(
      (q: Record<string, unknown>): BTCQuestionDef => {
        const qId = q.id as string;
        const helpEntry = helpOverlay?.questions?.[qId];
        return {
          id: qId,
          section: q.section as string,
          prompt: q.prompt as string,
          answer_type: q.answer_type as BTCQuestionDef['answer_type'],
          options: (q.options as string[]) || [],
          required: (q.required as boolean) ?? true,
          help: (q.help as string) || '',
          roles: (q.roles as BTCQuestionDef['roles']) || {
            primary_respondents: [],
            validators: [],
          },
          validations: (q.validations as BTCQuestionDef['validations']) || [],
          risk_flags: (q.risk_flags as string[]) || [],
          bindings: (q.bindings as BTCQuestionDef['bindings']) || {},
          activation: (q.activation as BTCQuestionDef['activation']) || {
            default_mode: 'full',
          },
          aliases: [],
          guidance: helpEntry?.guidance,
          option_help: helpEntry?.options,
        };
      }
    );

    const bankVersion = raw.schema_version || '1.0';
    return { sections, virtualQuestions, bankVersion };
  }, [raw, helpOverlay]);

  return { ...result, loading, error, fromCache };
}
