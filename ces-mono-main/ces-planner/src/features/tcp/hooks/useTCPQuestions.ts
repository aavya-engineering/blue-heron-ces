// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useMemo } from 'react';
import { useTCPQuestionBank, useTCPHelpOverlay } from '@/shared/hooks/useDataLoader';
import type { TCPSectionDef, TCPQuestionDef } from '../types';

export function useTCPQuestions() {
  const { data: raw, loading, error, fromCache } = useTCPQuestionBank();
  const { data: helpOverlay } = useTCPHelpOverlay();

  const sections = useMemo<TCPSectionDef[]>(() => {
    if (!raw) return [];
    const rawSections = raw.sections || [];
    return rawSections.map((s: Record<string, unknown>) => ({
      id: s.id as string,
      name: s.name as string,
      questions: ((s.questions as Record<string, unknown>[]) || []).map(
        (q: Record<string, unknown>): TCPQuestionDef => {
          const qId = q.id as string;
          const helpEntry = helpOverlay?.questions?.[qId];
          return {
            id: qId,
            section: q.section as string,
            prompt: q.prompt as string,
            answer_type: q.answer_type as TCPQuestionDef['answer_type'],
            options: (q.options as string[]) || [],
            required: (q.required as boolean) ?? false,
            help: (q.help as string) || '',
            roles: (q.roles as TCPQuestionDef['roles']) || {
              primary_respondents: [],
              validators: [],
            },
            bindings: (q.bindings as TCPQuestionDef['bindings']) || {},
            risk_flags: (q.risk_flags as string[]) || [],
            guidance: helpEntry?.guidance,
            option_help: helpEntry?.options,
          };
        },
      ),
    }));
  }, [raw, helpOverlay]);

  const bankVersion = raw?.schema_version || '1.0';

  const allQuestions = useMemo(() => sections.flatMap((s) => s.questions), [sections]);

  return { sections, allQuestions, bankVersion, loading, error, fromCache };
}
