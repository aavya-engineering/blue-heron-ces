// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the `DEMO-ACTS-DOSSIER.md` parser.
 *
 * The dossier is the CONTRACT the harness judges the demo-acts against, so the
 * parser is the part that must not lie. Every semantic below is a decision
 * recorded in `docs/demo/PLAN-ACT-HARNESS.md`, made because the naive reading
 * would report the parser's own defect as doc-drift:
 *
 * 1. **Entries are scanned heading-to-next-heading**, never "until the first
 *    blank or non-list line". D.1 and D.2 interleave `>` blockquote boxes
 *    between field bullets; a first-blank-line parser silently drops their last
 *    fields and then reports 2 phantom incomplete entries.
 * 2. **Two field shapes are both legal.** 240 field lines carry their value
 *    inline (`- **FIELD** value`); 16 are bare (`- **FIELD**`) with the value in
 *    the indented block beneath. 240 + 16 = 256 = 16 entries x 16 fields. All 16
 *    bare ones are `SUGGESTED TALK-TRACK`. A parser that only understands the
 *    inline shape counts 15 fields per entry and fires a completeness failure on
 *    every entry in the file.
 * 3. **Not everything after the op id is a qualifier.** Only `op mode: <mode>`
 *    (a mode qualifier) and `<key>=<value>` (a param qualifier) are. Prose,
 *    parentheticals and alias notes are ignored — D.11's ID line carries a prose
 *    parenthetical reconciling the catalog name with the registered id, and
 *    treating it as an unexpressible qualifier reds an IMPLEMENTED entry.
 *
 * Pure: this module imports nothing at all, so the docs check that consumes it
 * can never reach a browser, a server or a sibling process through it.
 */

/** Repo **root**, not `docs/demo/`. */
export const DOSSIER_PATH = 'DEMO-ACTS-DOSSIER.md';

/** The section C template, in order. Every entry fills exactly these. */
export const TEMPLATE_FIELDS = [
  'ID',
  'PURPOSE',
  'STATUS',
  'TARGET',
  'GRADE',
  'MODES',
  'PARAMS',
  'PRECONDITIONS',
  'POSTCONDITIONS',
  'INPUTS',
  'OUTPUTS',
  'FAILURE MODES',
  'SUCCESS (TESTABLE)',
  'DOCTRINE',
  'DRIVER',
  'SUGGESTED TALK-TRACK',
] as const;

export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

/** The three status words the dossier uses, plus the parser's "no word found". */
export type EntryStatus = 'IMPLEMENTED' | 'IN-BUILD' | 'PROPOSED' | 'UNKNOWN';

/** Searched in no particular order — the earliest occurrence in the line wins. */
export const ENTRY_STATUSES: readonly Exclude<EntryStatus, 'UNKNOWN'>[] = [
  'IMPLEMENTED',
  'IN-BUILD',
  'PROPOSED',
];

/**
 * A qualifier narrows an entry's op id to one act view. `mode` is always
 * expressible in a deck (`op mode` is a shipped column); `param` is expressible
 * only if the op catalog validates it.
 */
export type QualifierKind = 'mode' | 'param';

export interface Qualifier {
  readonly kind: QualifierKind;
  readonly key: string;
  readonly value: string;
}

export type FieldShape = 'inline' | 'block';

export interface DossierField {
  readonly name: string;
  readonly shape: FieldShape;
  /** 1-based line number of the field bullet. */
  readonly line: number;
  /** Text after `- **NAME** ` — empty string for a block-style field. */
  readonly inline: string;
  /** Lines between this field bullet and the next one (or the entry end). */
  readonly block: readonly string[];
  /** Inline text is non-blank, or the block carries at least one non-blank line. */
  readonly nonEmpty: boolean;
}

export interface DossierEntry {
  /** The `n` in `### D.n`. */
  readonly ordinal: number;
  /** The backticked act name on the heading — NOT necessarily the op id. */
  readonly actName: string;
  /** 1-based. */
  readonly headingLine: number;
  /** 1-based, exclusive: the first line that is no longer part of this entry. */
  readonly endLine: number;
  readonly fields: Readonly<Record<string, DossierField>>;
  /** Template fields with no bullet at all. */
  readonly missingFields: readonly string[];
  /** Template fields present but carrying no value in either shape. */
  readonly emptyFields: readonly string[];
  /** First backticked token on the `ID` line; undefined when there is none. */
  readonly opId: string | undefined;
  readonly qualifiers: readonly Qualifier[];
  readonly status: EntryStatus;
  readonly statusText: string;
  readonly paramsText: string;
}

export interface AsOfRow {
  readonly key: string;
  readonly value: string;
  readonly line: number;
}

export interface DossierBullet {
  readonly text: string;
  readonly line: number;
}

export interface SectionEItem {
  readonly number: number;
  readonly text: string;
  readonly line: number;
}

export interface ParsedDossier {
  readonly entries: readonly DossierEntry[];
  /** The AS OF table, keyed by its bolded row label. */
  readonly asOf: Readonly<Record<string, AsOfRow>>;
  /** Section A.1's "What does NOT exist yet" bullets, one entry per bullet. */
  readonly doesNotExistYet: readonly DossierBullet[];
  /** Section E's numbered known-inconsistency items. */
  readonly sectionE: readonly SectionEItem[];
  /** Whole-file field-shape census — the 240 / 16 arithmetic, assertable. */
  readonly inlineFieldLines: number;
  readonly blockFieldLines: number;
}

const HEADING_RE = /^### D\.(\d+) `(.+?)`/;
const ANY_HEADING_RE = /^#{1,6} /;
/**
 * The field-name class must admit spaces, parentheses AND hyphens, or
 * `SUGGESTED TALK-TRACK` and `SUCCESS (TESTABLE)` are invisible to the parser.
 * The trailing group is optional: its absence is the block shape, not a failure.
 */
const FIELD_RE = /^- \*\*([A-Z][A-Z0-9 ()\-]*)\*\*(?: (.*))?$/;
const BACKTICKED_RE = /`([^`]+)`/g;
const PARAM_KEY_RE = /^[A-Za-z][A-Za-z0-9]*$/;

/** Tokens that look like param keys but never are. */
const NON_PARAM_LITERALS: ReadonlySet<string> = new Set(['None', 'true', 'false']);

function backtickedTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(BACKTICKED_RE)) out.push(m[1]);
  return out;
}

/**
 * Param keys on a PARAMS line: backticked tokens that are bare identifiers.
 * Dotted (`ctx.slide.op.mode`), slashed (`assets/demo-plan`), hyphenated and
 * pipe-bearing (`self-hosted|independent`) tokens and code constants carrying
 * `_` (`AO_DEMO_COMMAND_ID`) all fail `PARAM_KEY_RE` and drop out for free.
 *
 * `exclude` is how the caller removes catalog defaults and enum values (`IA`,
 * `sprs`, `evidence`) — this module has no access to the op catalog by design.
 */
export function paramKeysOf(text: string, exclude: ReadonlySet<string> = new Set()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of backtickedTokens(text)) {
    if (!PARAM_KEY_RE.test(token)) continue;
    if (NON_PARAM_LITERALS.has(token)) continue;
    if (exclude.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Classify the remainder of an `ID` line — everything after the op id itself.
 *
 * Exactly two things are qualifiers. Anything else is prose and is IGNORED:
 * that is the decision that keeps D.11 (`ao-registry` with a parenthetical
 * naming the §3 catalog name) from reading as an IMPLEMENTED-but-not-invocable
 * entry.
 */
export function classifyQualifiers(remainder: string): Qualifier[] {
  const out: Qualifier[] = [];
  const seen = new Set<string>();
  const push = (q: Qualifier): void => {
    const key = `${q.kind}:${q.key}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };

  for (const m of remainder.matchAll(/op mode:\s*([A-Za-z]+)/g)) {
    push({ kind: 'mode', key: 'op mode', value: m[1] });
  }
  // `key` = `value`
  for (const m of remainder.matchAll(/`([A-Za-z][A-Za-z0-9]*)`\s*=\s*`([^`]+)`/g)) {
    push({ kind: 'param', key: m[1], value: m[2] });
  }
  // key=value, inside backticks or bare. Backticks become spaces so both read alike.
  const flat = remainder.replace(/`/g, ' ');
  for (const m of flat.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s*=\s*([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
    push({ kind: 'param', key: m[1], value: m[2] });
  }
  return out;
}

function statusOf(text: string): EntryStatus {
  let best: EntryStatus = 'UNKNOWN';
  let bestAt = Number.POSITIVE_INFINITY;
  for (const candidate of ENTRY_STATUSES) {
    const at = text.indexOf(candidate);
    if (at !== -1 && at < bestAt) {
      bestAt = at;
      best = candidate;
    }
  }
  return best;
}

function parseEntry(lines: readonly string[], startIdx: number, endIdx: number): DossierEntry {
  const heading = HEADING_RE.exec(lines[startIdx])!;

  interface Raw {
    name: string;
    inline: string;
    shape: FieldShape;
    idx: number;
  }
  const raw: Raw[] = [];
  for (let i = startIdx + 1; i < endIdx; i += 1) {
    const m = FIELD_RE.exec(lines[i]);
    if (!m) continue;
    raw.push({
      name: m[1],
      inline: m[2] ?? '',
      shape: m[2] === undefined ? 'block' : 'inline',
      idx: i,
    });
  }

  const fields: Record<string, DossierField> = {};
  raw.forEach((r, n) => {
    const blockEnd = n + 1 < raw.length ? raw[n + 1].idx : endIdx;
    const block = lines.slice(r.idx + 1, blockEnd);
    const nonEmpty =
      r.inline.trim() !== '' || (r.shape === 'block' && block.some((l) => l.trim() !== ''));
    fields[r.name] = {
      name: r.name,
      shape: r.shape,
      line: r.idx + 1,
      inline: r.inline,
      block,
      nonEmpty,
    };
  });

  const missingFields = TEMPLATE_FIELDS.filter((f) => !(f in fields));
  const emptyFields = TEMPLATE_FIELDS.filter((f) => f in fields && !fields[f].nonEmpty);

  const idLine = fields.ID?.inline ?? '';
  // Deliberately NOT the shared /g regex: `exec` on a global regex carries
  // `lastIndex` between calls, and this one runs once per entry.
  const first = /`([^`]+)`/.exec(idLine);
  const opId = first ? first[1] : undefined;
  const remainder = first ? idLine.slice(first.index + first[0].length) : idLine;

  const statusText = fields.STATUS?.inline ?? '';

  return {
    ordinal: Number(heading[1]),
    actName: heading[2],
    headingLine: startIdx + 1,
    endLine: endIdx + 1,
    fields,
    missingFields: [...missingFields],
    emptyFields: [...emptyFields],
    opId,
    qualifiers: classifyQualifiers(remainder),
    status: statusOf(statusText),
    statusText,
    paramsText: fields.PARAMS?.inline ?? '',
  };
}

function parseAsOf(lines: readonly string[]): Record<string, AsOfRow> {
  const out: Record<string, AsOfRow> = {};
  const start = lines.findIndex((l) => /^## AS OF\s*$/.test(l));
  if (start === -1) return out;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (ANY_HEADING_RE.test(lines[i])) break;
    const m = /^\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|\s*$/.exec(lines[i]);
    if (m) out[m[1]] = { key: m[1], value: m[2], line: i + 1 };
  }
  return out;
}

function parseDoesNotExistYet(lines: readonly string[]): DossierBullet[] {
  const out: DossierBullet[] = [];
  const start = lines.findIndex((l) => l.includes('What does NOT exist yet'));
  if (start === -1) return out;
  let current: { text: string; line: number } | undefined;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (ANY_HEADING_RE.test(line)) break;
    if (line.trim() === '') {
      if (out.length > 0 || current) break;
      continue;
    }
    if (line.startsWith('- ')) {
      if (current) out.push(current);
      current = { text: line.slice(2), line: i + 1 };
    } else if (current && /^\s+\S/.test(line)) {
      current = { text: `${current.text} ${line.trim()}`, line: current.line };
    } else {
      break;
    }
  }
  if (current) out.push(current);
  return out;
}

function parseSectionE(lines: readonly string[]): SectionEItem[] {
  const out: SectionEItem[] = [];
  const start = lines.findIndex((l) => /^## E\. /.test(l));
  if (start === -1) return out;
  let current: { number: number; text: string; line: number } | undefined;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (ANY_HEADING_RE.test(line)) break;
    const m = /^(\d+)\. (.*)$/.exec(line);
    if (m) {
      if (current) out.push(current);
      current = { number: Number(m[1]), text: m[2], line: i + 1 };
    } else if (current && /^\s+\S/.test(line)) {
      current = { ...current, text: `${current.text} ${line.trim()}` };
    }
  }
  if (current) out.push(current);
  return out;
}

export function parseDossier(markdown: string): ParsedDossier {
  const lines = markdown.split(/\r?\n/);

  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (HEADING_RE.test(line)) starts.push(i);
  });

  const entries: DossierEntry[] = starts.map((startIdx) => {
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i += 1) {
      if (ANY_HEADING_RE.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    return parseEntry(lines, startIdx, endIdx);
  });

  let inlineFieldLines = 0;
  let blockFieldLines = 0;
  for (const line of lines) {
    const m = FIELD_RE.exec(line);
    if (!m) continue;
    if (m[2] === undefined) blockFieldLines += 1;
    else inlineFieldLines += 1;
  }

  return {
    entries,
    asOf: parseAsOf(lines),
    doesNotExistYet: parseDoesNotExistYet(lines),
    sectionE: parseSectionE(lines),
    inlineFieldLines,
    blockFieldLines,
  };
}
