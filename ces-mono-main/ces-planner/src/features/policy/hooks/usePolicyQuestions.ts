// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useEffect, useState } from 'react';
import yaml from 'js-yaml';
import type { PolicySectionDef, PolicyQuestionDef } from '../types';

interface UsePolicyQuestionsResult {
  sections: PolicySectionDef[];
  allQuestions: PolicyQuestionDef[];
  bankVersion: string;
  loading: boolean;
  error: Error | null;
}

export function usePolicyQuestions(): UsePolicyQuestionsResult {
  const [sections, setSections] = useState<PolicySectionDef[]>([]);
  const [bankVersion, setBankVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch(encodeURI('/data/primed Policy Inputs Question Bank.yaml'));
        if (!res.ok) throw new Error(`Failed to load Policy Inputs Question Bank: ${res.status}`);
        const text = await res.text();
        const data = yaml.load(text) as any;

        if (!mounted) return;

        const version = data?.schema_version || '1.0';
        const rawSections: any[] = data?.sections || [];

        const parsed: PolicySectionDef[] = rawSections.map((s: any) => ({
          id: s.id,
          name: s.name,
          questions: (s.questions || []).map((q: any) => ({
            id: q.id,
            section: q.section || s.name,
            prompt: q.prompt,
            answer_type: q.answer_type || 'text',
            options: q.options || [],
            required: q.required ?? false,
            help: q.help || '',
            recommended: q.recommended,
            roles: q.roles || { primary_respondents: [], validators: [] },
            bindings: q.bindings || {},
            risk_flags: q.risk_flags || [],
            guidance: q.guidance,
            option_help: q.option_help,
          })),
        }));

        setSections(parsed);
        setBankVersion(version);
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const allQuestions = sections.flatMap((s) => s.questions);

  return { sections, allQuestions, bankVersion, loading, error };
}
