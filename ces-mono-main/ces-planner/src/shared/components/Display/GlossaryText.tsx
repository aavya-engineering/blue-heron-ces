// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useMemo } from 'react';
import type { GlossaryEntry } from '@/shared/types/help';

interface GlossaryTextProps {
  text: string;
  glossary: GlossaryEntry[];
}

/**
 * Renders text with glossary terms highlighted as dotted-underline spans with CSS-only tooltips.
 * Terms are sorted longest-first to prevent partial matches.
 * Only highlights terms with `highlight_in_prompts: true`.
 */
export function GlossaryText({ text, glossary }: GlossaryTextProps) {
  const segments = useMemo(() => {
    const highlightable = glossary.filter((e) => e.highlight_in_prompts);
    if (highlightable.length === 0) return [{ type: 'text' as const, value: text }];

    // Sort longest-first to avoid partial matches (e.g., "GCC High" before "GCC")
    const sorted = [...highlightable].sort((a, b) => b.term.length - a.term.length);

    // Build a case-insensitive regex matching any term as a whole word
    const escaped = sorted.map((e) => escapeRegex(e.term));
    const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

    // Build a lookup map (lowercase key → entry)
    const lookup = new Map<string, GlossaryEntry>();
    for (const entry of sorted) {
      lookup.set(entry.term.toLowerCase(), entry);
    }

    const result: { type: 'text' | 'term'; value: string; definition?: string }[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      const matched = match[0];
      const entry = lookup.get(matched.toLowerCase());
      result.push({
        type: 'term',
        value: matched,
        definition: entry?.definition,
      });
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
      result.push({ type: 'text', value: text.slice(lastIndex) });
    }

    return result;
  }, [text, glossary]);

  if (segments.length === 1 && segments[0].type === 'text') {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'term' ? (
          <span key={i} className="group relative">
            <span className="border-b border-dotted border-gray-400 cursor-help">{seg.value}</span>
            <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 w-64 rounded bg-gray-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 z-50">
              <span className="font-semibold">{seg.value}</span>
              <br />
              {seg.definition}
            </span>
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </>
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
