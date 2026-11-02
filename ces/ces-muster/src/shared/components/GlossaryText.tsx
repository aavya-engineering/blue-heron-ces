// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// GlossaryText.tsx — MG-25: modelled on Planner's
// src/shared/components/Display/GlossaryText.tsx. Glossary terms in a text
// render as dotted-underline spans whose definition is the hover tooltip.
// Muster has no Tailwind, so the tooltip is the native title attribute (no
// CSS-only popover); the matching is Planner's (highlight_in_prompts terms,
// longest first, whole words, case-insensitive).
import { useMemo } from 'react';
import { glossaryTermsIn, type GlossaryEntry } from '@/features/interview/derivedAnswerHelp';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function GlossaryText({ text, glossary }: { text: string; glossary: GlossaryEntry[] }) {
  const segments = useMemo(() => {
    const terms = glossaryTermsIn(text, glossary);
    if (terms.length === 0) return [{ type: 'text' as const, value: text }];
    const pattern = new RegExp(`\\b(${terms.map((e) => escapeRegex(e.term)).join('|')})\\b`, 'gi');
    const lookup = new Map(terms.map((e) => [e.term.toLowerCase(), e]));
    const out: Array<{ type: 'text' | 'term'; value: string; definition?: string }> = [];
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ type: 'text', value: text.slice(last, at) });
      out.push({ type: 'term', value: m[0], definition: lookup.get(m[0].toLowerCase())?.definition });
      last = at + m[0].length;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out;
  }, [text, glossary]);

  if (segments.length === 1 && segments[0].type === 'text') return <>{text}</>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'term' ? (
          <span
            key={i}
            data-testid="glossary-term"
            title={`${seg.value}: ${seg.definition ?? ''}`}
            style={{ borderBottom: '1px dotted currentColor', cursor: 'help' }}
          >
            {seg.value}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </>
  );
}
