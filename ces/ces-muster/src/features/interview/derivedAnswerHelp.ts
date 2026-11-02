// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// derivedAnswerHelp.ts — MG-25: the copied Planner help files
// (public/knowledge/help Glossary.yaml, help TCP Guidance.yaml, help CUI
// Boundary Guidance.yaml) as the help behind a derived answer. TCP and CUI
// boundary nodes key into the guidance by question id; SI nodes (no SI
// guidance file exists) and the bnd-* boundary nodes get the glossary terms
// their prompt uses (Planner GlossaryText: highlight_in_prompts only).
import { useEffect, useState } from 'react';
import { load } from 'js-yaml';

export interface GlossaryEntry {
  term: string;
  definition: string;
  highlight_in_prompts?: boolean;
}

export interface QuestionGuidance {
  description?: string;
  why_it_matters?: string;
  implications?: string;
  common_pitfalls?: string[];
}

export interface HelpIndex {
  glossary: GlossaryEntry[];
  /** question id -> guidance (TCP and CUI boundary banks). */
  guidance: Record<string, QuestionGuidance>;
}

export type DerivedNodeKind = 'si' | 'tcp' | 'boundary';

const HELP_FILES = {
  glossary: '/knowledge/help Glossary.yaml',
  tcp: '/knowledge/help TCP Guidance.yaml',
  cui: '/knowledge/help CUI Boundary Guidance.yaml',
} as const;

/** Parsed help YAML texts -> one index. */
export function buildHelpIndex(texts: { glossary: string; tcp: string; cui: string }): HelpIndex {
  const glossary = ((load(texts.glossary) as { glossary?: GlossaryEntry[] } | null)?.glossary ?? []).filter(
    (e) => e && typeof e.term === 'string'
  );
  const guidance: Record<string, QuestionGuidance> = {};
  for (const text of [texts.tcp, texts.cui]) {
    const questions = (load(text) as { questions?: Record<string, { guidance?: QuestionGuidance }> } | null)?.questions ?? {};
    for (const [id, q] of Object.entries(questions)) if (q?.guidance) guidance[id] = q.guidance;
  }
  return { glossary, guidance };
}

let cache: Promise<HelpIndex> | null = null;

/** The help index from the SPA's static /knowledge assets (fetched once). */
export function loadHelpIndex(): Promise<HelpIndex> {
  cache ??= Promise.all([
    fetch(HELP_FILES.glossary).then((r) => r.text()),
    fetch(HELP_FILES.tcp).then((r) => r.text()),
    fetch(HELP_FILES.cui).then((r) => r.text()),
  ]).then(([glossary, tcp, cui]) => buildHelpIndex({ glossary, tcp, cui }));
  return cache;
}

export function _resetHelpIndexCache(): void {
  cache = null;
}

/** React hook: the help index, null until loaded (or when it fails to load). */
export function useHelpIndex(): HelpIndex | null {
  const [index, setIndex] = useState<HelpIndex | null>(null);
  useEffect(() => {
    let live = true;
    loadHelpIndex()
      .then((i) => live && setIndex(i))
      .catch(() => live && setIndex(null));
    return () => {
      live = false;
    };
  }, []);
  return index;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The highlightable glossary terms a text uses, longest first (Planner GlossaryText's matching). */
export function glossaryTermsIn(text: string, glossary: GlossaryEntry[]): GlossaryEntry[] {
  const sorted = glossary.filter((e) => e.highlight_in_prompts).sort((a, b) => b.term.length - a.term.length);
  if (!text || sorted.length === 0) return [];
  const pattern = new RegExp(`\\b(${sorted.map((e) => escapeRegex(e.term)).join('|')})\\b`, 'gi');
  const byTerm = new Map(sorted.map((e) => [e.term.toLowerCase(), e]));
  const found = new Map<string, GlossaryEntry>();
  for (const m of text.matchAll(pattern)) {
    const e = byTerm.get(m[0].toLowerCase());
    if (e) found.set(e.term, e);
  }
  return [...found.values()];
}

/** The help for one derived-answer row. */
export function helpForNode(
  nodeId: string,
  kind: DerivedNodeKind,
  prompt: string,
  index: HelpIndex | null
): { guidance: QuestionGuidance | null; terms: GlossaryEntry[] } {
  if (!index) return { guidance: null, terms: [] };
  const guidance = kind === 'si' ? null : index.guidance[nodeId] ?? null;
  return { guidance, terms: glossaryTermsIn(prompt, index.glossary) };
}
