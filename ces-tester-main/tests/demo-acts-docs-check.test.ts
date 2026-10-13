// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the documentation axis.
 *
 * Three classes of test here, and the first is the important one:
 *
 * 1. **Every rule, against FIXTURES.** A clean fixture dossier must yield ZERO
 *    findings, and each mutation must yield exactly the one rule it targets.
 *    That is what proves a finding is drift in the document rather than a defect
 *    in the checker — the failure mode this whole harness exists to prevent.
 * 2. **The AD4 graph scan.** No `playwright` and no `node:child_process`
 *    anywhere in the transitive source graph reachable from `docs-check.ts`, so
 *    `--docs-only` provably spawns no browser, no server and no sibling.
 * 3. **A doc-drift guard on the harness's own documentation** — every DD rule id
 *    and every tier flag must appear in `docs/demo/ACT-HARNESS.md`. Same pattern
 *    the op catalog uses on `OP-CATALOG.md`: a checker that has quietly diverged
 *    from its own doc is worse than none.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import { TEMPLATE_FIELDS } from '../src/demo/acts/dossier.js';
import {
  DD10_SEVERITY,
  DD6B_TRIGGER_PHRASES,
  invocableToday,
  runDocsCheck,
  type GitFacts,
} from '../src/demo/acts/docs-check.js';
import { parseDossier } from '../src/demo/acts/dossier.js';
import {
  groupsFor,
  parseActsTestArgs,
  runDemoActsTestCommand,
} from '../src/cli/acts-test-command.js';
import { ACTS_REPORT_FILE } from '../src/demo/acts/acts-report.js';

const _require = createRequire(import.meta.url);
const testerRoot = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ fixtures */

const GIT: GitFacts = {
  branch: 'fixture-branch',
  head: 'abc1234deadbeefdeadbeefdeadbeefdeadbeef0',
  reflog: 'abc1234deadbeefdeadbeefdeadbeefdeadbeef0 checkout\n',
};

const FIELD_DEFAULTS: Record<string, string> = {
  ID: '`ao-registry`',
  PURPOSE: 'does a thing',
  STATUS: '**IMPLEMENTED** — committed.',
  TARGET: 'ces-ao',
  GRADE: 'CURSOR',
  MODES: '`live`',
  PARAMS: '`command`',
  PRECONDITIONS: 'armed',
  POSTCONDITIONS: 'done',
  INPUTS: 'stuff',
  OUTPUTS: 'stuff',
  'FAILURE MODES': 'it throws',
  'SUCCESS (TESTABLE)': 'it passes',
  DOCTRINE: 'not gated',
  DRIVER: 'exists',
};

function makeEntry(n: number, name: string, over: Record<string, string> = {}): string {
  const f = { ...FIELD_DEFAULTS, ...over };
  const lines = [`### D.${n} \`${name}\``, ''];
  for (const key of TEMPLATE_FIELDS) {
    if (key === 'SUGGESTED TALK-TRACK') {
      lines.push('- **SUGGESTED TALK-TRACK**', '  - a presenter line');
      continue;
    }
    lines.push(`- **${key}** ${f[key]}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** One clean entry per registered op id, every catalog param key named. */
function cleanEntries(): string[] {
  return [
    makeEntry(1, 'ao-registry-command'),
    makeEntry(2, 'eo-assess', { ID: '`eo-review`', PARAMS: '`family` and `land`' }),
    makeEntry(3, 'muster-readiness', { ID: '`muster-readiness`', PARAMS: '`detail`' }),
    makeEntry(4, 'stamper-translate', {
      ID: '`stamper-translate`',
      PARAMS: '`missionPlan`, `manifest`',
    }),
    makeEntry(5, 'stamper-execute', {
      ID: '`stamper-execute`',
      PARAMS: '`skipKnownFalseFails` and `peekMs`',
    }),
    makeEntry(6, 'ao-make-change', { ID: '`ao-make-change`', PARAMS: '`command`' }),
    makeEntry(7, 'eo-show-change-captured', {
      ID: '`eo-show-change-captured`',
      PARAMS: '`control`, `family`',
    }),
    // Zero-param op: DD2-non-empty prose with NO bare backticked identifier, so
    // DD5b reads no spurious key.
    makeEntry(8, 'simstack-create', {
      ID: '`simstack-create`',
      PARAMS: 'none — reads only ctx.armed',
    }),
    makeEntry(9, 'simstack-destroy', {
      ID: '`simstack-destroy`',
      PARAMS: 'none — keepEvidence is hardcoded',
    }),
    makeEntry(10, 'muster-connect-tenant', {
      ID: '`muster-connect-tenant`',
      PARAMS: '`mode`, `authTier`, `slug`',
    }),
    makeEntry(11, 'muster-auto-analysis', {
      ID: '`muster-auto-analysis`',
      PARAMS: '`slug`',
    }),
    makeEntry(12, 'muster-consent-and-attest', {
      ID: '`muster-consent-and-attest`',
      PARAMS: 'none — the confirmer is the demo operator',
    }),
    makeEntry(13, 'muster-adaptive-interview', {
      ID: '`muster-adaptive-interview`',
      PARAMS: 'none — both branches use the same profile',
    }),
    makeEntry(14, 'muster-generate-sprs-mp', {
      ID: '`muster-generate-sprs-mp`',
      PARAMS: 'none — exports the readiness result',
    }),
    makeEntry(15, 'muster-rollup', {
      ID: '`muster-rollup`',
      PARAMS: 'none — the fixed sample fleet',
    }),
  ];
}

function makeDoc(entries: readonly string[], extra: { asOf?: string; tail?: string } = {}): string {
  const asOf =
    extra.asOf ??
    ['| **Date** | 2026-09-06 |', '| **Branch / HEAD** | `fixture-branch` @ `abc1234` |', '| **Build state** | Complete. |'].join(
      '\n',
    );
  return [
    '# Fixture Dossier',
    '',
    '## AS OF',
    '',
    '| | |',
    '|---|---|',
    asOf,
    '',
    '## D. The acts',
    '',
    ...entries,
    extra.tail ?? '',
    '',
  ].join('\n');
}

function check(markdown: string) {
  return runDocsCheck({
    markdown,
    testerRoot,
    git: GIT,
    // Fixture probes: OP-CATALOG.md "absent", show-run.ts "does not wire artifact".
    fileExists: () => false,
    readFile: () => '',
  });
}

const rules = (r: ReturnType<typeof check>) => r.findings.map((f) => f.rule);

/* --------------------------------------------------------------- the rules */

describe('docs-check over fixtures', () => {
  it('a clean dossier yields ZERO findings — no rule fires spuriously', () => {
    const result = check(makeDoc(cleanEntries()));
    expect(result.findings).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('DD1 — a registered op id with no entry', () => {
    const entries = cleanEntries().slice(0, -1); // drops muster-rollup (the last)
    const result = check(makeDoc(entries));
    expect(rules(result)).toEqual(['DD1']);
    expect(result.findings[0].subject).toBe('muster-rollup');
    expect(result.findings[0].failureClass).toBe('doc-drift');
  });

  it('DD2 — a template field missing, and one present but empty', () => {
    const broken = makeEntry(1, 'ao-registry-command')
      .replace('- **GRADE** CURSOR\n', '')
      .replace('- **DRIVER** exists', '- **DRIVER**');
    const result = check(makeDoc([broken, ...cleanEntries().slice(1)]));
    expect(rules(result)).toEqual(['DD2']);
    expect(result.findings[0].message).toContain('GRADE (missing)');
    expect(result.findings[0].message).toContain('DRIVER (empty)');
  });

  it('DD3 — PROPOSED while invocable today, including a param qualifier', () => {
    const entries = cleanEntries();
    entries[1] = makeEntry(2, 'eo-verify-evidence', {
      ID: '`eo-review` + `land=evidence`',
      STATUS: 'PROPOSED — awaits the params column.',
      PARAMS: '`family` and `land`',
    });
    const result = check(makeDoc(entries));
    expect(rules(result)).toEqual(['DD3']);
    expect(result.skipped).toEqual(['D.2 eo-verify-evidence']);
  });

  it('DD3 does NOT fire for a PROPOSED entry whose id is unregistered', () => {
    // `unregistered-op` is a synthetic id that is not in DEMO_OP_IDS, so
    // `invocableToday` is false and DD3 stays quiet. (`ao-make-change` was this
    // example until GP-DEMO-4 Slice 1B registered it.)
    const entries = [
      ...cleanEntries(),
      makeEntry(16, 'unregistered-op', {
        ID: '`unregistered-op`',
        STATUS: 'PROPOSED — new code.',
        PARAMS: '`command`',
      }),
    ];
    const result = check(makeDoc(entries));
    expect(rules(result)).toEqual([]);
    expect(result.skipped).toEqual(['D.16 unregistered-op']);
  });

  it('DD3b — IMPLEMENTED while no deck can name it', () => {
    const entries = cleanEntries();
    entries[0] = makeEntry(1, 'ao-registry-command', {
      ID: '`ao-registry` + `nosuchkey=1`',
    });
    const result = check(makeDoc(entries));
    expect(rules(result)).toEqual(['DD3b']);
  });

  it('DD4 — IN-BUILD on a registered id, and DD3 stays silent (one finding, not two)', () => {
    const entries = cleanEntries();
    entries[3] = makeEntry(4, 'stamper-translate', {
      ID: '`stamper-translate`',
      STATUS: '⚠ **IN-BUILD — being written right now.**',
      PARAMS: '`missionPlan`, `manifest`',
    });
    const result = check(makeDoc(entries));
    expect(rules(result)).toEqual(['DD4']);
  });

  it('DD5 — a catalog key on no PARAMS line, unioned per id across entries', () => {
    const entries = cleanEntries();
    entries[1] = makeEntry(2, 'eo-assess', { ID: '`eo-review`', PARAMS: '`family` only' });
    const missing = check(makeDoc(entries));
    expect(rules(missing)).toEqual(['DD5']);
    expect(missing.findings[0].message).toContain('`land`');

    // Split the same op across two entries and the union covers it again.
    entries.push(makeEntry(6, 'eo-verify-evidence', { ID: '`eo-review`', PARAMS: '`land`' }));
    expect(rules(check(makeDoc(entries)))).toEqual([]);
  });

  it('DD5b — a param-shaped token that is not a catalog key (WARN)', () => {
    const entries = cleanEntries();
    entries[0] = makeEntry(1, 'ao-registry-command', { PARAMS: '`command` and `bogusKey`' });
    const result = check(makeDoc(entries));
    expect(rules(result)).toEqual(['DD5b']);
    expect(result.findings[0].severity).toBe('warn');
  });

  it('DD5b stays silent on catalog defaults and enum values', () => {
    const entries = cleanEntries();
    entries[1] = makeEntry(2, 'eo-assess', {
      ID: '`eo-review`',
      PARAMS: '`family` default `IA`; `land` default `sprs`, or `evidence`',
    });
    expect(rules(check(makeDoc(entries)))).toEqual([]);
  });

  it('DD6 — stale-future prose on a registered id whose catalog declares params', () => {
    for (const phrase of ['Slice 4a', 'None today', 'does not exist']) {
      const entries = cleanEntries();
      entries[2] = makeEntry(3, 'muster-readiness', {
        ID: '`muster-readiness`',
        PARAMS: `${phrase} — \`detail\` is proposed.`,
      });
      expect(rules(check(makeDoc(entries))), phrase).toEqual(['DD6']);
    }
  });

  it('DD6b — a STATUS blocking on an artifact that exists, once per entry', () => {
    for (const phrase of DD6B_TRIGGER_PHRASES) {
      const entries = cleanEntries();
      entries[0] = makeEntry(1, 'ao-registry-command', {
        STATUS: `PROPOSED — it ${phrase} the \`params\` column.`,
      });
      const result = check(makeDoc(entries));
      // PROPOSED + registered + no qualifier ⇒ DD3 fires too; DD6b is the point.
      expect(rules(result), phrase).toContain('DD6b');
      expect(rules(result).filter((r) => r === 'DD6b'), phrase).toHaveLength(1);
    }
  });

  it('DD6b fires once even when a STATUS matches two trigger phrases', () => {
    const entries = cleanEntries();
    entries[5 - 5] = makeEntry(1, 'ao-registry-command', {
      STATUS: 'PROPOSED — it needs the `params` column, which does not exist.',
    });
    const result = check(makeDoc(entries));
    expect(rules(result).filter((r) => r === 'DD6b')).toHaveLength(1);
  });

  it('DD6b reaches an entry with no catalog entry at all — where DD6 cannot', () => {
    // An id with NO catalog entry: DD6 iterates only registered ids, so DD6b is
    // the only rule that can reach this. (`ao-make-change` served this role until
    // Slice 1B gave it a catalog entry.)
    const entries = [
      ...cleanEntries(),
      makeEntry(16, 'unregistered-op', {
        ID: '`unregistered-op`',
        STATUS: 'PROPOSED — it needs the `params` column, which does not exist.',
        PARAMS: '`command`',
      }),
    ];
    const result = check(makeDoc(entries));
    expect(rules(result)).toEqual(['DD6b']);
  });

  it('DD6b ignores a paraphrase outside its closed trigger list', () => {
    const entries = cleanEntries();
    entries[0] = makeEntry(1, 'ao-registry-command', {
      STATUS: 'PROPOSED — it is blocked on the `params` column being unavailable.',
    });
    expect(rules(check(makeDoc(entries)))).toEqual(['DD3']);
  });

  it('DD7 — an A.1 "does not exist yet" bullet naming something that exists', () => {
    const doc = makeDoc(cleanEntries()).replace(
      '## D. The acts',
      [
        '**What does NOT exist yet — do not author against it:**',
        '- **No `params` column.** Not a knob you can turn today.',
        '- **No `act` / `demo act` alias** for the `op` column.',
        '',
        '## D. The acts',
      ].join('\n'),
    );
    const result = check(doc);
    expect(rules(result)).toEqual(['DD7', 'DD7']);
    expect(result.findings.map((f) => f.subject)).toEqual([
      'A.1 params-column',
      'A.1 act-alias',
    ]);
  });

  it('DD8 — section E items 4 and 11, each with its own probe', () => {
    const tail = [
      '## E. Known inconsistencies',
      '',
      '1. Something with no probe at all.',
      '4. **No `params` column exists**, so parameters are futures.',
      '11. **`ShowOpContext.artifact` is committed but inert** — a no-op today.',
      '',
    ].join('\n');
    // E4's probe reads CANONICAL_COLUMNS (always true); E11's reads show-run.ts.
    const withArtifactWired = runDocsCheck({
      markdown: makeDoc(cleanEntries(), { tail }),
      testerRoot,
      git: GIT,
      fileExists: () => false,
      readFile: () => 'recorder?.opArtifact(index, p)',
    });
    expect(rules(withArtifactWired)).toEqual(['DD8', 'DD8']);
    expect(withArtifactWired.findings.map((f) => f.subject)).toEqual(['E.4', 'E.11']);

    // With the recorder NOT wired, E11 is a true statement and must stay silent.
    expect(rules(check(makeDoc(cleanEntries(), { tail })))).toEqual(['DD8']);
  });

  it('DD9 — PROPOSED entries are SKIPPED, and a skip is independent of a FAIL', () => {
    const entries = cleanEntries();
    entries[1] = makeEntry(2, 'eo-verify-evidence', {
      ID: '`eo-review` + `land=evidence`',
      STATUS: 'PROPOSED — awaits the column.',
      PARAMS: '`family` and `land`',
    });
    const result = check(makeDoc(entries));
    expect(result.skipped).toEqual(['D.2 eo-verify-evidence']);
    // The same entry is BOTH runtime-skipped and a docs FAIL.
    expect(rules(result)).toEqual(['DD3']);
  });

  it('DD10 — minute prose outside the tolerance, with 2.0x passing exactly', () => {
    const entries = cleanEntries();
    // eo-review declares typicalWarmMs 10_000, so 5 min is 30x.
    entries[1] = makeEntry(2, 'eo-assess', {
      ID: '`eo-review`',
      PARAMS: '`family` and `land`',
      PRECONDITIONS: 'Takes ≈ 5 min.',
    });
    const far = check(makeDoc(entries));
    expect(rules(far)).toEqual(['DD10']);
    expect(far.findings[0].severity).toBe(DD10_SEVERITY);
    expect(far.findings[0].failureClass).toBe('pace');

    // stamper-translate declares 300_000 ms; 10 min is exactly 2.0x ⇒ passes.
    const entries2 = cleanEntries();
    entries2[3] = makeEntry(4, 'stamper-translate', {
      ID: '`stamper-translate`',
      PARAMS: '`missionPlan`, `manifest`',
      MODES: '`warm` — ~10 min.',
    });
    expect(rules(check(makeDoc(entries2)))).toEqual([]);

    // 11 min is 2.2x ⇒ fires.
    const entries3 = cleanEntries();
    entries3[3] = makeEntry(4, 'stamper-translate', {
      ID: '`stamper-translate`',
      PARAMS: '`missionPlan`, `manifest`',
      MODES: '`warm` — ~11 min.',
    });
    expect(rules(check(makeDoc(entries3)))).toEqual(['DD10']);
  });

  it('DD10 does not read a seconds-level anecdote as a pacing claim', () => {
    const entries = cleanEntries();
    entries[3] = makeEntry(4, 'stamper-translate', {
      ID: '`stamper-translate`',
      PARAMS: '`missionPlan`, `manifest`',
      'FAILURE MODES': 'reports Complete in 0.7 s with a 20 s timeout by design.',
    });
    expect(rules(check(makeDoc(entries)))).toEqual([]);
  });

  it('DD11 — a branch cut without a re-stamp', () => {
    const result = check(makeDoc(cleanEntries()));
    expect(rules(result)).toEqual([]);
    const moved = runDocsCheck({
      markdown: makeDoc(cleanEntries()),
      testerRoot,
      git: { ...GIT, branch: 'gp-demo-9' },
      fileExists: () => false,
      readFile: () => '',
    });
    expect(rules(moved)).toEqual(['DD11']);
    expect(moved.findings[0].severity).toBe('warn');
    expect(moved.findings[0].message).toContain('fixture-branch');
  });

  it('DD11 — a commit hash that is not a commit of this repository', () => {
    const asOf = [
      '| **Date** | 2026-09-06 |',
      '| **Branch / HEAD** | `fixture-branch` @ `9999999` |',
      '| **Build state** | Complete. |',
    ].join('\n');
    expect(rules(check(makeDoc(cleanEntries(), { asOf })))).toEqual(['DD11']);
  });

  it('DD11 — an in-flight build claim whose IN-BUILD acts have already landed', () => {
    const asOf = [
      '| **Date** | 2026-09-06 |',
      '| **Branch / HEAD** | `fixture-branch` @ `abc1234` |',
      '| **Build state** | ⚠ An executor is running; Slice 2b is mid-write. |',
    ].join('\n');
    const entries = cleanEntries();
    entries[3] = makeEntry(4, 'stamper-translate', {
      ID: '`stamper-translate`',
      STATUS: '⚠ **IN-BUILD.**',
      PARAMS: '`missionPlan`, `manifest`',
    });
    const landed = runDocsCheck({
      markdown: makeDoc(entries, { asOf }),
      testerRoot,
      git: GIT,
      fileExists: () => true, // the implementation module is on disk
      readFile: () => '',
    });
    expect(rules(landed)).toEqual(expect.arrayContaining(['DD11']));
    expect(landed.findings.find((f) => f.rule === 'DD11')!.message).toContain('in flight');

    // A genuine in-flight executor has UN-registered ops, so it must not fire.
    const genuine = runDocsCheck({
      markdown: makeDoc(cleanEntries(), { asOf }),
      testerRoot,
      git: GIT,
      fileExists: () => true,
      readFile: () => '',
    });
    expect(rules(genuine)).toEqual([]);
  });

  it('DD11 goes inert on the sha when there is no reflog to check against', () => {
    const asOf = [
      '| **Date** | 2026-09-06 |',
      '| **Branch / HEAD** | `fixture-branch` @ `9999999` |',
      '| **Build state** | Complete. |',
    ].join('\n');
    const noReflog = runDocsCheck({
      markdown: makeDoc(cleanEntries(), { asOf }),
      testerRoot,
      git: { branch: 'fixture-branch', head: GIT.head },
      fileExists: () => false,
      readFile: () => '',
    });
    expect(rules(noReflog)).toEqual([]);
  });
});

describe('invocableToday', () => {
  const one = (md: string) => parseDossier(md).entries[0];

  it('is true for a registered id with no qualifier', () => {
    expect(invocableToday(one(makeEntry(1, 'x')))).toBe(true);
  });

  it('is true for a mode qualifier — `op mode` is a shipped column', () => {
    expect(invocableToday(one(makeEntry(1, 'x', { ID: '`eo-review` with `op mode: warm`' })))).toBe(
      true,
    );
  });

  it('is true for a param qualifier the catalog validates', () => {
    expect(invocableToday(one(makeEntry(1, 'x', { ID: '`eo-review` + `land=evidence`' })))).toBe(
      true,
    );
  });

  it('is false for a param value the catalog rejects', () => {
    expect(invocableToday(one(makeEntry(1, 'x', { ID: '`eo-review` + `land=nowhere`' })))).toBe(
      false,
    );
  });

  it('is false for an unregistered id — no deck can name it', () => {
    expect(invocableToday(one(makeEntry(1, 'x', { ID: '`unregistered-op`' })))).toBe(false);
  });
});

/* ---------------------------------------------------------- the CLI surface */

describe('parseActsTestArgs', () => {
  it('defaults to the docs tier, which runs no groups', () => {
    const args = parseActsTestArgs([], testerRoot);
    expect(args.tier).toBe('docs-only');
    expect(groupsFor(args)).toEqual([]);
    expect(args.errors).toEqual([]);
  });

  it('parses each tier into its group set', () => {
    expect(groupsFor(parseActsTestArgs(['--quick'], testerRoot))).toEqual([
      'muster-readiness',
      'ao-registry',
    ]);
    expect(groupsFor(parseActsTestArgs(['--full'], testerRoot))).toEqual([
      'muster-readiness',
      'ao-registry',
      'ao-make-change',
      'eo-review',
      'eo-verify-evidence',
      'eo-show-change-captured',
      'simstack-create',
      'simstack-destroy',
      'muster-gui',
      'stamper',
    ]);
  });

  it('--act overrides the tier and is repeatable', () => {
    const args = parseActsTestArgs(['--act', 'eo-review', '--act', 'stamper'], testerRoot);
    expect(args.tier).toBe('act');
    expect(groupsFor(args)).toEqual(['eo-review', 'stamper']);
    expect(args.errors).toEqual([]);
  });

  it('--act with a tier flag is an invocation error naming both', () => {
    const args = parseActsTestArgs(['--act', 'stamper', '--full'], testerRoot);
    expect(args.errors).toHaveLength(1);
    expect(args.errors[0]).toContain('stamper');
    expect(args.errors[0]).toContain('--full');
  });

  it('two tier flags is an invocation error', () => {
    expect(parseActsTestArgs(['--quick', '--full'], testerRoot).errors[0]).toContain('--quick');
  });

  it('parses --run-id, --from-report and all five sibling roots', () => {
    const args = parseActsTestArgs(
      ['--run-id', 'r1', '--from-report', 'x.json', '--eo-root', 'D:/eo'],
      testerRoot,
    );
    expect(args.runId).toBe('r1');
    expect(args.fromReport).toBe('x.json');
    expect(path.resolve(args.eoRoot)).toBe(path.resolve('D:/eo'));
    expect(args.musterRoot).toBe(path.join(path.resolve(testerRoot, '..'), 'ces-muster'));
    expect(args.stacksimRoot).toBe(
      path.join(path.resolve(testerRoot, '..'), 'tenant-stacksim'),
    );
    expect(args.errors).toEqual([]);
  });

  it('rejects an unknown flag rather than silently ignoring it', () => {
    expect(parseActsTestArgs(['--nope'], testerRoot).errors[0]).toContain('--nope');
  });
});

describe('runDemoActsTestCommand', () => {
  it('exits 2 on a bad invocation — never 1', async () => {
    const code = await runDemoActsTestCommand(['--quick', '--full'], testerRoot, {
      log: () => undefined,
    });
    expect(code).toBe(2);
  });

  it('exits 2 when the dossier cannot be read', async () => {
    const code = await runDemoActsTestCommand(['--docs-only'], testerRoot, {
      log: () => undefined,
      readDossier: () => {
        throw new Error('nope');
      },
    });
    expect(code).toBe(2);
  });

  it('exits 1 with findings, 0 without, and never loads the runtime for docs-only', async () => {
    const lines: string[] = [];
    const runId = `vitest-docs-${process.pid}`;
    const failing = await runDemoActsTestCommand(['--docs-only', '--run-id', runId], testerRoot, {
      log: (l) => lines.push(l),
      readDossier: () => makeDoc([makeEntry(1, 'x', { ID: '`ao-registry`', PARAMS: 'None today.' })]),
      runGroups: () => {
        throw new Error('the runtime must never be reached for --docs-only');
      },
    });
    expect(failing).toBe(1);
    expect(lines.join('\n')).toContain('FAIL');

    const clean = await runDemoActsTestCommand(['--docs-only', '--run-id', runId], testerRoot, {
      log: (l) => lines.push(l),
      readDossier: () => makeDoc(cleanEntries()),
    });
    // The real repo probes make DD7/DD8 fire only if the fixture names them; it
    // does not, so a clean fixture is clean against the real filesystem too.
    expect(clean).toBe(0);
    fs.rmSync(path.join(testerRoot, 'runs', 'acts-test', runId), { recursive: true, force: true });
  });

  it('writes a report that validates against schemas/demo-acts-test.schema.json', async () => {
    const runId = `vitest-schema-${process.pid}`;
    await runDemoActsTestCommand(['--docs-only', '--run-id', runId], testerRoot, {
      log: () => undefined,
    });
    const reportPath = path.join(testerRoot, 'runs', 'acts-test', runId, ACTS_REPORT_FILE);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as unknown;

    const ajvModule = _require('ajv') as { default?: unknown } & Record<string, unknown>;
    const AjvCtor = (ajvModule.default ?? ajvModule) as new (opts: {
      strict: boolean;
      allErrors: boolean;
    }) => { compile: (schema: unknown) => ValidateFunction };
    const schema = _require('../schemas/demo-acts-test.schema.json');
    const validate = new AjvCtor({ strict: false, allErrors: true }).compile(schema);

    expect(validate(report), JSON.stringify(validate.errors, null, 2)).toBe(true);
    fs.rmSync(path.join(testerRoot, 'runs', 'acts-test', runId), { recursive: true, force: true });
  });
});

/* ------------------------------------------------- AD4: this thing spawns nothing */

describe('AD4 — the docs tier reaches no browser, no server, no sibling', () => {
  function transitiveSources(entryAbs: string): string[] {
    const seen = new Set<string>();
    const stack = [entryAbs];
    while (stack.length > 0) {
      const file = stack.pop()!;
      if (seen.has(file) || !fs.existsSync(file)) continue;
      seen.add(file);
      const src = fs.readFileSync(file, 'utf8');
      const specifiers = [
        ...[...src.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1]),
        ...[...src.matchAll(/import\('(\.[^']+)'\)/g)].map((m) => m[1]),
      ];
      for (const spec of specifiers) {
        stack.push(path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts')));
      }
    }
    return [...seen];
  }

  it('finds no `playwright` and no `node:child_process` in the whole graph', () => {
    const graph = transitiveSources(path.join(testerRoot, 'src', 'demo', 'acts', 'docs-check.ts'));
    // A graph of one would mean the walker is broken, not that the graph is clean.
    expect(graph.length).toBeGreaterThan(4);
    const offenders = graph.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return src.includes('playwright') || src.includes('node:child_process');
    });
    expect(offenders.map((f) => path.relative(testerRoot, f))).toEqual([]);
  });

  it('reaches the modules it is supposed to reach', () => {
    const graph = transitiveSources(
      path.join(testerRoot, 'src', 'demo', 'acts', 'docs-check.ts'),
    ).map((f) => path.basename(f));
    expect(graph).toEqual(
      expect.arrayContaining(['dossier.ts', 'op-catalog.ts', 'xlsx-loader.ts', 'deck-model.ts']),
    );
    // and NOT the op registry, which is what pulls in Playwright
    expect(graph).not.toContain('op-registry.ts');
  });

  it('the command module reaches the runtime only through a dynamic import', () => {
    const src = fs.readFileSync(
      path.join(testerRoot, 'src', 'cli', 'acts-test-command.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/^import .*act-run\.js/m);
    expect(src).toContain("const ACT_RUN_MODULE = '../demo/acts/act-run.js'");
  });
});

/* --------------------------------------- the harness's own documentation drift */

describe('ACT-HARNESS.md drift guard', () => {
  const doc = fs.readFileSync(path.join(testerRoot, 'docs', 'demo', 'ACT-HARNESS.md'), 'utf8');

  it('documents every DD rule id', () => {
    const ruleIds = [
      'DD1',
      'DD2',
      'DD3',
      'DD3b',
      'DD4',
      'DD5',
      'DD5b',
      'DD6',
      'DD6b',
      'DD7',
      'DD8',
      'DD9',
      'DD10',
      'DD11',
    ];
    expect(ruleIds.filter((r) => !doc.includes(`**${r}**`))).toEqual([]);
  });

  it('documents every tier flag and every exit code', () => {
    for (const flag of [
      '--docs-only',
      '--quick',
      '--full',
      '--act',
      '--run-id',
      '--from-report',
    ]) {
      expect(doc, flag).toContain(flag);
    }
    for (const code of ['**0**', '**1**', '**2**']) expect(doc).toContain(code);
  });

  it('documents every failureClass, so a reader can tell an act-red from a defect', () => {
    for (const cls of ['act-red', 'doc-drift', 'pace', 'environment', 'harness-defect']) {
      expect(doc, cls).toContain(cls);
    }
  });

  it('says out loud that the run touches TWO directories (AD8)', () => {
    expect(doc).toContain('runs/acts-test/');
    expect(doc).toContain('runs/show/');
  });
});

/* ------------------------------------------- the real dossier, after Slice F */

describe('the REAL DEMO-ACTS-DOSSIER.md', () => {
  const real = runDocsCheck({
    markdown: fs.readFileSync(path.join(testerRoot, 'DEMO-ACTS-DOSSIER.md'), 'utf8'),
    testerRoot,
  });

  it('has ZERO failures and ZERO warnings — the dossier agrees with the code', () => {
    // This is the assertion that makes doc-drift a first-class failure rather
    // than a nag: from here on, changing the registry, the catalog or a warm
    // cost without re-stamping the dossier turns `npm test` red.
    expect(
      real.findings.map((f) => `${f.severity.toUpperCase()} ${f.rule} ${f.subject}: ${f.message}`),
    ).toEqual([]);
  });

  it('reports the PROPOSED acts as skipped, not failed', () => {
    // Zero: ALL 16 acts are IMPLEMENTED — none skipped.
    expect(real.skipped).toHaveLength(0);
    expect(real.skipped).not.toContain('D.15 eo-verify-evidence');
    expect(real.skipped).not.toContain('D.12 ao-make-change');
    expect(real.skipped).not.toContain('D.16 eo-show-change-captured');
    expect(real.skipped).not.toContain('D.1 simstack-create');
  });

  it('is green because the rules PASS, not because they stopped running', () => {
    // A rule set that silently found nothing to look at would also report zero
    // findings. These pin the inputs each rule actually reached.
    expect(real.parsed.entries).toHaveLength(17);
    // DD7 still has a live block to probe.
    expect(real.parsed.doesNotExistYet.length).toBeGreaterThan(0);
    // DD8 still has both of its section E items present — corrected, not deleted.
    expect(real.parsed.sectionE.map((i) => i.number)).toEqual(expect.arrayContaining([4, 11]));
    // DD11 still has an AS OF block to check.
    expect(real.parsed.asOf['Branch / HEAD']).toBeDefined();
    expect(real.parsed.asOf['Build state']).toBeDefined();
  });

  it('DD10 is now a FAILURE, because the catalog carries measured values', () => {
    expect(DD10_SEVERITY).toBe('fail');
  });

  it('still fires on a re-introduced drift — the rules are not inert', () => {
    // The dossier's own text, with one status walked backwards. If this does not
    // red, the zero above proves nothing.
    const drifted = fs
      .readFileSync(path.join(testerRoot, 'DEMO-ACTS-DOSSIER.md'), 'utf8')
      .replace(
        '- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-4 Slice 2c).',
        '- **STATUS** ⚠ **IN-BUILD — Slice 2c.**',
      );
    const result = runDocsCheck({ markdown: drifted, testerRoot });
    expect(result.findings.map((f) => f.rule)).toContain('DD4');
  });
});
