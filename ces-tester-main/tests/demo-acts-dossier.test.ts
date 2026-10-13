// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the dossier parser.
 *
 * These tests exist because the failure mode this whole harness is built to
 * prevent is **a parser defect reported as doc-drift**. Every count below was
 * derived from `DEMO-ACTS-DOSSIER.md` as it stands, and each one is a claim the
 * docs check will later turn into a pass/fail verdict:
 *
 * - 16 entries x 16 template fields = 256 field lines, of which 240 carry their
 *   value inline and 16 carry it in an indented block.
 * - Every entry is substantively COMPLETE. A parser that reports 16
 *   completeness failures here is reporting itself.
 * - D.11's ID-line parenthetical is prose, not a qualifier — the single
 *   distinction that keeps an IMPLEMENTED entry from reading as un-invocable.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DOSSIER_PATH,
  TEMPLATE_FIELDS,
  classifyQualifiers,
  paramKeysOf,
  parseDossier,
} from '../src/demo/acts/dossier.js';

const testerRoot = path.resolve(__dirname, '..');
const markdown = fs.readFileSync(path.join(testerRoot, DOSSIER_PATH), 'utf8');
const parsed = parseDossier(markdown);

const byOrdinal = (n: number) => {
  const entry = parsed.entries.find((e) => e.ordinal === n);
  if (!entry) throw new Error(`no D.${n} entry parsed`);
  return entry;
};

describe('dossier entries', () => {
  it('finds all 17 acts, in order, with their heading act names', () => {
    expect(parsed.entries).toHaveLength(17);
    expect(parsed.entries.map((e) => e.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(byOrdinal(1).actName).toBe('simstack-create');
    expect(byOrdinal(11).actName).toBe('ao-registry-command');
    expect(byOrdinal(16).actName).toBe('eo-show-change-captured');
    expect(byOrdinal(17).actName).toBe('muster-rollup');
  });

  it('counts 255 inline + 17 block-style field lines = 272 = 17 x 16', () => {
    expect(parsed.inlineFieldLines).toBe(255);
    expect(parsed.blockFieldLines).toBe(17);
    expect(parsed.inlineFieldLines + parsed.blockFieldLines).toBe(
      parsed.entries.length * TEMPLATE_FIELDS.length,
    );
  });

  it('reads every entry as COMPLETE — no missing and no empty template field', () => {
    for (const entry of parsed.entries) {
      expect(
        { d: entry.ordinal, missing: entry.missingFields, empty: entry.emptyFields },
        `D.${entry.ordinal}`,
      ).toEqual({ d: entry.ordinal, missing: [], empty: [] });
    }
  });

  it('takes SUGGESTED TALK-TRACK from the indented block beneath a bare bullet', () => {
    for (const entry of parsed.entries) {
      const field = entry.fields['SUGGESTED TALK-TRACK'];
      expect(field.shape, `D.${entry.ordinal}`).toBe('block');
      expect(field.inline).toBe('');
      expect(field.nonEmpty).toBe(true);
      expect(field.block.filter((l) => l.trim() !== '').length).toBeGreaterThan(0);
    }
  });

  it('scans heading-to-heading, so blockquote boxes never truncate an entry', () => {
    // D.1 and D.2 both interleave a `>` box between DRIVER and the talk track.
    for (const n of [1, 2]) {
      const entry = byOrdinal(n);
      const driverLine = entry.fields.DRIVER.line;
      const talkLine = entry.fields['SUGGESTED TALK-TRACK'].line;
      expect(talkLine).toBeGreaterThan(driverLine + 1);
      expect(entry.fields.DRIVER.block.some((l) => l.startsWith('>'))).toBe(true);
    }
  });

  it('does not truncate at the first blank line either', () => {
    const truncating = parsed.entries.filter((e) => Object.keys(e.fields).length < 16);
    expect(truncating).toEqual([]);
  });

  it('reads statuses', () => {
    expect(byOrdinal(3).status).toBe('IMPLEMENTED');
    // D.9 / D.10 were re-stamped from IN-BUILD once the Config pair landed, and
    // D.15 from PROPOSED once `land=evidence` became deck-expressible.
    expect(byOrdinal(9).status).toBe('IMPLEMENTED');
    expect(byOrdinal(10).status).toBe('IMPLEMENTED');
    expect(byOrdinal(15).status).toBe('IMPLEMENTED');
    // D.12 (`ao-make-change`, Slice 1B) and D.16 (`eo-show-change-captured`,
    // Slice 1C) were re-stamped from PROPOSED once their ids were registered.
    expect(byOrdinal(12).status).toBe('IMPLEMENTED');
    expect(byOrdinal(16).status).toBe('IMPLEMENTED');
    // D.1/D.2 (simstack 2A/2B) and D.4 (`muster-connect-tenant`, 3.0) IMPLEMENTED.
    expect(byOrdinal(1).status).toBe('IMPLEMENTED');
    expect(byOrdinal(2).status).toBe('IMPLEMENTED');
    expect(byOrdinal(4).status).toBe('IMPLEMENTED');
    expect(byOrdinal(5).status).toBe('IMPLEMENTED');
    expect(byOrdinal(6).status).toBe('IMPLEMENTED');
    expect(byOrdinal(7).status).toBe('IMPLEMENTED');
    expect(byOrdinal(8).status).toBe('IMPLEMENTED');
    // D.17 (`muster-rollup`, GP-DEMO-6) is IMPLEMENTED.
    expect(byOrdinal(17).status).toBe('IMPLEMENTED');
    // ALL 17 acts are IMPLEMENTED (GP-DEMO-4/5/6 complete).
    expect(parsed.entries.filter((e) => e.status === 'PROPOSED')).toHaveLength(0);
    expect(parsed.entries.filter((e) => e.status === 'IMPLEMENTED')).toHaveLength(17);
    expect(parsed.entries.filter((e) => e.status === 'IN-BUILD')).toEqual([]);
    expect(parsed.entries.filter((e) => e.status === 'UNKNOWN')).toEqual([]);
  });

  it('takes the op id from the first backticked token on the ID line', () => {
    expect(byOrdinal(3).opId).toBe('muster-readiness');
    // The heading says `ao-registry-command`; the ID line says the registered id.
    expect(byOrdinal(11).opId).toBe('ao-registry');
    expect(byOrdinal(13).opId).toBe('eo-review');
    expect(byOrdinal(15).opId).toBe('eo-review');
  });
});

describe('qualifier classification', () => {
  it('treats D.11 prose as prose — an alias parenthetical is NOT a qualifier', () => {
    expect(byOrdinal(11).qualifiers).toEqual([]);
  });

  it('reads `op mode: <mode>` as a mode qualifier (D.13 warm, D.14 live)', () => {
    expect(byOrdinal(13).qualifiers).toEqual([{ kind: 'mode', key: 'op mode', value: 'warm' }]);
    expect(byOrdinal(14).qualifiers).toEqual([{ kind: 'mode', key: 'op mode', value: 'live' }]);
  });

  it('reads `land=evidence` as a param qualifier (D.15)', () => {
    expect(byOrdinal(15).qualifiers).toEqual([
      { kind: 'param', key: 'land', value: 'evidence' },
    ]);
  });

  it('classifies the two shapes and ignores everything else', () => {
    expect(classifyQualifiers('*(the §3 catalog name is `x-command`; the id is `x`)*')).toEqual([]);
    expect(classifyQualifiers('**with `op mode: staged`**')).toEqual([
      { kind: 'mode', key: 'op mode', value: 'staged' },
    ]);
    expect(classifyQualifiers('+ `land=evidence`')).toEqual([
      { kind: 'param', key: 'land', value: 'evidence' },
    ]);
    expect(classifyQualifiers('with `family` = `IA`')).toEqual([
      { kind: 'param', key: 'family', value: 'IA' },
    ]);
    expect(classifyQualifiers('a sentence with no qualifier at all.')).toEqual([]);
  });
});

describe('param-key extraction', () => {
  it('pulls the documented future keys off each registered entry PARAMS line', () => {
    expect(paramKeysOf(byOrdinal(9).paramsText)).toEqual(['missionPlan', 'manifest']);
    expect(paramKeysOf(byOrdinal(10).paramsText)).toEqual(['skipKnownFalseFails', 'peekMs']);
    expect(paramKeysOf(byOrdinal(11).paramsText)).toEqual(['command']);
  });

  it('drops dotted, slashed, hyphenated, pipe-bearing and underscored tokens', () => {
    // D.3's PARAMS names `ctx.armed` and `ctx.slide.op.mode`, plus the enum's
    // own values — which the caller excludes, exactly as docs-check does.
    expect(paramKeysOf(byOrdinal(3).paramsText, new Set(['counts', 'controls']))).toEqual([
      'detail',
    ]);
    expect(paramKeysOf(byOrdinal(3).paramsText)).not.toContain('ctx.armed');
    // D.11's names the code constant AO_DEMO_COMMAND_ID.
    expect(byOrdinal(11).paramsText).toContain('AO_DEMO_COMMAND_ID');
    expect(paramKeysOf(byOrdinal(11).paramsText)).not.toContain('AO_DEMO_COMMAND_ID');
    // D.9's names the `assets/demo-plan` fixture path.
    expect(paramKeysOf(byOrdinal(9).paramsText)).not.toContain('assets/demo-plan');
    // D.4's names pipe enums plus a bare default value (`independent`), which the
    // caller excludes exactly as docs-check's catalogValueTokens does.
    expect(
      paramKeysOf(
        byOrdinal(4).paramsText,
        new Set([
          'self-hosted',
          'independent',
          'collaborative-bhd',
          'lite',
          'script-upload',
          'device-code',
          'cert-app-only',
        ]),
      ),
    ).toEqual(['mode', 'authTier', 'slug']);
  });

  it('drops the None/true/false literals', () => {
    expect(paramKeysOf('`None` `true` `false` `real`')).toEqual(['real']);
  });

  it('drops caller-excluded catalog defaults and enum values', () => {
    const exclude = new Set(['IA', 'sprs', 'evidence']);
    expect(paramKeysOf(byOrdinal(13).paramsText, exclude)).toEqual(['family', 'land']);
    expect(paramKeysOf(byOrdinal(14).paramsText, exclude)).toEqual(['family', 'land']);
    expect(paramKeysOf(byOrdinal(15).paramsText, exclude)).toEqual(['land', 'family']);
    // Without the exclusion the enum values leak in — which is exactly the
    // reverse-drift false positive the exclusion exists to prevent.
    expect(paramKeysOf(byOrdinal(13).paramsText)).toContain('IA');
  });
});

describe('the sections the docs check probes', () => {
  it('parses the AS OF table by row label', () => {
    expect(Object.keys(parsed.asOf)).toEqual(
      expect.arrayContaining(['Date', 'Branch / HEAD', 'Build state', 'Rule applied']),
    );
    expect(parsed.asOf['Branch / HEAD'].value).toContain('gp-demo-4');
  });

  it('parses A.1 "What does NOT exist yet" — one bullet, now the column has shipped', () => {
    // The block is deliberately kept ALIVE rather than deleted: DD7 probes it,
    // and a rule that keys on a removed marker stops being a rule. What it lists
    // is now the one thing genuinely still missing.
    expect(parsed.doesNotExistYet).toHaveLength(1);
    expect(parsed.doesNotExistYet[0].text).toContain('ACT_ALIASES');
    // None of DD7's three probe tokens appear, so none of them can fire.
    for (const token of ['`params`', '`act`', '`docs/demo/OP-CATALOG.md`']) {
      expect(parsed.doesNotExistYet[0].text, token).not.toContain(token);
    }
  });

  it('parses section E as 14 numbered items, continuation lines folded in', () => {
    // GP-DEMO-4 Slice 1A added item 12; Slice 1C item 13; GP-DEMO-5 Slice 3.1
    // added item 14 (assessed_count counts SPRS requirements, not observations).
    expect(parsed.sectionE.map((i) => i.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(parsed.sectionE[3].text).toContain('parameters column now ships');
    expect(parsed.sectionE[10].text).toContain('ShowOpContext.artifact');
    expect(parsed.sectionE[11].text).toContain('Evidence Explorer has no');
    expect(parsed.sectionE[12].text).toContain('does not flip the EO determination');
    expect(parsed.sectionE[13].text).toContain('assessed_count');
    // Item 5 spans three source lines; folding must keep the tail.
    expect(parsed.sectionE[4].text).toContain('DEMO_PORTS');
    expect(parsed.sectionE[4].text).toContain('4000');
  });
});

describe('parser robustness', () => {
  const fixture = [
    '### D.1 `fixture-act`',
    '',
    '- **ID** `fixture-act`',
    '- **DRIVER** None needed.',
    '',
    '> A blockquote box that a blank-line parser would stop at.',
    '> | a | b |',
    '',
    '- **SUGGESTED TALK-TRACK**',
    '  - one line',
    '',
    '### D.2 `next-act`',
    '- **ID** `next-act`',
    '',
  ].join('\n');

  it('keeps fields that follow a blank line and a blockquote', () => {
    const p = parseDossier(fixture);
    expect(p.entries).toHaveLength(2);
    expect(Object.keys(p.entries[0].fields)).toEqual(['ID', 'DRIVER', 'SUGGESTED TALK-TRACK']);
    expect(p.entries[0].fields['SUGGESTED TALK-TRACK'].nonEmpty).toBe(true);
  });

  it('reports a bare field with an empty block as EMPTY, not as present', () => {
    const p = parseDossier(['### D.1 `x`', '- **ID** `x`', '- **PURPOSE**', '', ''].join('\n'));
    expect(p.entries[0].fields.PURPOSE.nonEmpty).toBe(false);
    expect(p.entries[0].emptyFields).toContain('PURPOSE');
    expect(p.entries[0].missingFields).toContain('STATUS');
  });

  it('reports no op id when the ID line carries no backticked token', () => {
    const p = parseDossier(['### D.1 `x`', '- **ID** none yet', ''].join('\n'));
    expect(p.entries[0].opId).toBeUndefined();
    expect(p.entries[0].status).toBe('UNKNOWN');
  });
});
