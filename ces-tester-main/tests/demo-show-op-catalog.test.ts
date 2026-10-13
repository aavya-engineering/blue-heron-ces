// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — the published op catalog.
 *
 * The catalog is only worth anything if it is TRUE. Two classes of test here:
 *
 * 1. **Parsing and validation**, including that every error cites
 *    `docs/demo/OP-CATALOG.md` by path — that citation is what makes the
 *    catalog the authoring vocabulary rather than a doc nobody opens.
 * 2. **A doc-drift guard.** Every registered op id, every parameter key and
 *    every act alias must appear in `docs/demo/OP-CATALOG.md`. A catalog that
 *    has quietly diverged from its own documentation is worse than none: a deck
 *    author writes against the doc.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ACT_ALIASES,
  OP_CATALOG,
  OP_CATALOG_DOC,
  PREP_BUDGET_WARN_MS,
  parseParamsCell,
  prepBudgetMs,
  validateParams,
} from '../src/demo/show/op-catalog.js';
import { DEMO_OP_IDS, type DemoOpId } from '../src/demo/show/deck-model.js';

const REPO_ROOT = path.resolve(__dirname, '..');

describe('the catalog covers exactly the registered ops', () => {
  it('has one entry per DemoOpId, keyed by its own id', () => {
    expect(Object.keys(OP_CATALOG).sort()).toEqual([...DEMO_OP_IDS].sort());
    for (const id of DEMO_OP_IDS) {
      expect(OP_CATALOG[id].id, id).toBe(id);
    }
  });

  it('every entry is complete enough to author against', () => {
    for (const id of DEMO_OP_IDS) {
      const entry = OP_CATALOG[id];
      expect(entry.version, id).toBeGreaterThanOrEqual(1);
      expect(entry.stageName, id).not.toBe('');
      expect(entry.shows.length, id).toBeGreaterThan(20);
      expect(entry.modes.length, id).toBeGreaterThan(0);
      expect(entry.typicalWarmMs, id).toBeGreaterThan(0);
      expect(entry.preconditions.length, id).toBeGreaterThan(0);
      // T1.5: every op declares an in-slide mirror mode (required field).
      expect(['none', 'theatrical', 'readout'], id).toContain(entry.mirror);
      // GP-DEMO-5 streamgui: every op declares its screencast source (required).
      expect(['pane', 'backstage'], id).toContain(entry.mirrorSource);
      // An enum with no values is unauthorable and unvalidatable.
      for (const spec of entry.params) {
        expect(spec.description.length, `${id}.${spec.key}`).toBeGreaterThan(10);
        if (spec.type === 'enum') {
          expect(spec.values?.length ?? 0, `${id}.${spec.key}`).toBeGreaterThan(1);
          expect(spec.values, `${id}.${spec.key}`).toContain(String(spec.default));
        }
      }
    }
  });
});

describe('the in-slide app mirror mode (T1.5) is declared per op', () => {
  // The live-GUI acts stream the app; the readout acts stream their own REAL
  // result card (rev 2, founder-approved 2026-09-07 "build it" with
  // mirror:'readout' INCLUDED). No op is `none` today.
  const READOUT: DemoOpId[] = [
    // GP-DEMO-5 streamgui: the Config pair (A2/A3) and muster-readiness (B1) all
    // flipped to theatrical. Only the two simstack readouts remain — they present
    // armed state with no interface to walk.
    'simstack-create',
    'simstack-destroy',
  ];

  it('the readout ops are readout, everything else theatrical', () => {
    for (const id of DEMO_OP_IDS as readonly DemoOpId[]) {
      expect(OP_CATALOG[id].mirror, id).toBe(READOUT.includes(id) ? 'readout' : 'theatrical');
    }
  });

  it('both Config (Stamper) ops stream their live GUI from backstage (decision 11)', () => {
    // Decision 11 lifted decision 8's no-live-Config rule: the Configuration GUI
    // streams live, but from the headless backstage session (never the pane).
    for (const id of ['stamper-translate', 'stamper-execute'] as const) {
      expect(OP_CATALOG[id].mirror, id).toBe('theatrical');
      expect(OP_CATALOG[id].mirrorSource, id).toBe('backstage');
    }
  });
});

describe('the screencast source (GP-DEMO-5 streamgui) is declared per op', () => {
  // The Config (Stamper) ops drive the headless backstage session; every other
  // op drives the visible pane directly. Decision 11 lifted no-live-Config, so a
  // theatrical Config slide streams `/mirror/backstage`.
  it('only the two Config ops stream from backstage; the other twelve from the pane', () => {
    for (const id of DEMO_OP_IDS as readonly DemoOpId[]) {
      const backstage = id === 'stamper-translate' || id === 'stamper-execute';
      expect(OP_CATALOG[id].mirrorSource, id).toBe(backstage ? 'backstage' : 'pane');
    }
  });
});

describe('parseParamsCell', () => {
  it('reads key=value, one per line, trimming both halves', () => {
    const { params, errors } = parseParamsCell('family=IA\n  land = sprs  \n\n');
    expect(errors).toEqual([]);
    expect(params).toEqual({ family: 'IA', land: 'sprs' });
  });

  it('keeps an = inside the VALUE — only the first one separates', () => {
    const { params } = parseParamsCell('command=A-18=B');
    expect(params).toEqual({ command: 'A-18=B' });
  });

  it('rejects a line that is not key=value, citing the catalog', () => {
    const { errors } = parseParamsCell('family IA');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('is not `key=value`');
    expect(errors[0]).toContain(OP_CATALOG_DOC);
  });

  it('rejects an empty key and a repeated key', () => {
    expect(parseParamsCell('=IA').errors[0]).toContain('is not `key=value`');
    const repeated = parseParamsCell('family=IA\nfamily=AC');
    expect(repeated.errors[0]).toContain('set more than once');
  });
});

describe('validateParams', () => {
  it('fills defaults when the author wrote nothing', () => {
    const { resolved, errors } = validateParams('eo-review', {});
    expect(errors).toEqual([]);
    expect(resolved).toEqual({ family: 'IA', land: 'sprs' });
  });

  it('rejects an unknown key, naming the supported ones and the catalog', () => {
    const { errors } = validateParams('eo-review', { familly: 'IA' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('has no parameter "familly"');
    expect(errors[0]).toContain('supported: family, land');
    expect(errors[0]).toContain(OP_CATALOG_DOC);
  });

  it('rejects a bad enum value, listing what is allowed', () => {
    const { errors } = validateParams('eo-review', { land: 'nowhere' });
    expect(errors[0]).toContain('must be one of dashboard|evidence|sprs');
    expect(errors[0]).toContain(OP_CATALOG_DOC);
  });

  it('coerces booleans and rejects anything that is not true or false', () => {
    expect(validateParams('stamper-execute', { skipKnownFalseFails: 'false' }).resolved).toEqual({
      skipKnownFalseFails: false,
    });
    expect(validateParams('stamper-execute', { skipKnownFalseFails: 'TRUE' }).resolved).toEqual({
      skipKnownFalseFails: true,
    });
    const bad = validateParams('stamper-execute', { skipKnownFalseFails: 'yes' });
    expect(bad.errors[0]).toContain('must be true or false');
  });

  it('collects EVERY error rather than stopping at the first', () => {
    const { errors } = validateParams('eo-review', { land: 'nowhere', bogus: 'x' });
    expect(errors).toHaveLength(2);
  });
});

describe('prepBudgetMs', () => {
  it('SUMS, because warm ops run in deck order through one queue', () => {
    expect(prepBudgetMs([])).toBe(0);
    expect(prepBudgetMs(['eo-review'])).toBe(OP_CATALOG['eo-review'].typicalWarmMs);
    expect(prepBudgetMs(['stamper-translate', 'stamper-execute'])).toBe(
      OP_CATALOG['stamper-translate'].typicalWarmMs + OP_CATALOG['stamper-execute'].typicalWarmMs,
    );
  });

  it('the full Config pair alone blows the 5-minute guideline', () => {
    // If this ever stops being true the warning is dead code and the budget
    // number needs revisiting — so it is pinned rather than assumed.
    expect(prepBudgetMs(['stamper-translate', 'stamper-execute'])).toBeGreaterThan(PREP_BUDGET_WARN_MS);

    // GP-DEMO-4 acts-harness, 2026-09-06 — this second pin was expected to
    // INVERT once `eo-review` was measured, on the prior that the EO assess cost
    // about five minutes. It does not, because that prior was wrong: measured
    // against the sim, the warm assess is **4.7 s**, not 300 s
    // (`demo:acts-test --full`, run acts-full-1). The trio is now
    // 5 000 + 4 000 + 80 000 = 89 000 ms, comfortably under the guideline, so
    // inverting the assertion would pin a falsehood.
    // `PREP_BUDGET_WARN_MS` stays at 300 000 either way — 300 s of dead stare
    // before slide 1 is the founder-accepted threshold (decision 6). What
    // changed is the measurement, not the policy.
    expect(prepBudgetMs(['eo-review', 'ao-registry', 'muster-readiness'])).toBeLessThan(PREP_BUDGET_WARN_MS);
  });
});

describe('act aliases', () => {
  it('every alias resolves to a registered op and only to keys that op supports', () => {
    for (const [alias, preset] of Object.entries(ACT_ALIASES)) {
      expect(DEMO_OP_IDS, alias).toContain(preset.id);
      const { errors } = validateParams(preset.id, preset.params);
      expect(errors, alias).toEqual([]);
    }
  });
});

describe('doc-drift guard', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, OP_CATALOG_DOC), 'utf8');

  it('documents every registered op id', () => {
    for (const id of DEMO_OP_IDS) {
      expect(doc, id).toContain(`\`${id}\``);
    }
  });

  it('documents every parameter key of every op', () => {
    for (const id of DEMO_OP_IDS) {
      for (const spec of OP_CATALOG[id].params) {
        expect(doc, `${id}.${spec.key}`).toContain(`\`${spec.key}\``);
      }
    }
  });

  it('documents every enum value an author could legally write', () => {
    for (const id of DEMO_OP_IDS) {
      for (const spec of OP_CATALOG[id].params) {
        for (const value of spec.values ?? []) {
          expect(doc, `${id}.${spec.key}=${value}`).toContain(value);
        }
      }
    }
  });

  it('documents every act alias', () => {
    for (const alias of Object.keys(ACT_ALIASES)) {
      expect(doc, alias).toContain(alias);
    }
  });

  it('states the boundary and the no-step-primitives refusal', () => {
    expect(doc).toContain('declared parameters');
    expect(doc).toContain('no step-level primitives');
  });

  it('names each op stage per THREAD_HANDOFF', () => {
    for (const id of DEMO_OP_IDS) {
      expect(doc, id).toContain(OP_CATALOG[id].stageName);
    }
  });
});

describe('the catalog is a declaration layer', () => {
  it('imports nothing but the deck model — --check must need no runtime', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'demo', 'show', 'op-catalog.ts'), 'utf8');
    const imports = [...source.matchAll(/^import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./deck-model.js', './deck-model.js']);
  });
});

describe('every op id is exhaustively handled', () => {
  it('a new op id cannot be added without a catalog entry (compile-time, restated)', () => {
    // `OP_CATALOG` is typed `Readonly<Record<DemoOpId, OpCatalogEntry>>`, so an
    // unlisted id is a compile error. This restates it at runtime for the
    // reader, and catches a stray key that no longer maps to an op.
    const ids = new Set<string>(DEMO_OP_IDS as readonly string[]);
    for (const key of Object.keys(OP_CATALOG)) {
      expect(ids.has(key), key).toBe(true);
    }
  });

  it('resolves params for every op without error, using only defaults', () => {
    for (const id of DEMO_OP_IDS as readonly DemoOpId[]) {
      expect(validateParams(id, {}).errors, id).toEqual([]);
    }
  });
});
