// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W1.4: flags a met control whose narrative negates the mechanism ("has not been created",
 * "0 authentication methods", a dangling "managed by ."). Status is never changed here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConsistencyFlag } from '../../shared/types/ssp.types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEXICON_PATH = path.resolve(__dirname, '../../../data/narrative-negation-lexicon.json');

let cached: string[] | undefined;

export function loadNegationLexicon(): string[] {
  if (!cached) {
    cached = (JSON.parse(fs.readFileSync(LEXICON_PATH, 'utf-8')) as { phrases: string[] }).phrases;
  }
  return cached;
}

function phrasePattern(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A phrase that starts with a letter or digit must not be the tail of a longer token ("10 managed devices").
  const lead = /^[A-Za-z0-9]/.test(phrase) ? '(?<![A-Za-z0-9])' : '';
  return new RegExp(lead + escaped, 'i');
}

function excerptAround(narrative: string, index: number, length: number): string {
  const dot = narrative.lastIndexOf('. ', index);
  const start = Math.max(narrative.lastIndexOf('\n', index) + 1, dot === -1 ? 0 : dot + 2);
  const nl = narrative.indexOf('\n', index + length);
  const end = nl === -1 ? narrative.length : nl;
  const text = narrative.slice(start, end).trim();
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

export class NarrativeNegationGuard {
  /** One flag per lexicon phrase found in the narrative of a met control; [] for any other status. */
  static check(status: string, narrative: string, lexicon: string[] = loadNegationLexicon()): ConsistencyFlag[] {
    if (status !== 'met') return [];
    const flags: ConsistencyFlag[] = [];
    for (const phrase of lexicon) {
      const m = phrasePattern(phrase).exec(narrative);
      if (m) flags.push({ kind: 'narrative-negation', phrase, excerpt: excerptAround(narrative, m.index, m[0].length) });
    }
    return flags;
  }
}
