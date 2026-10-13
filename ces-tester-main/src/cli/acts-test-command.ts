// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — `demo:acts-test`, the demo-act test harness command.
 *
 * Runs each IMPLEMENTED demo-act against the real environment and judges the
 * three things the founder named: it **works** (the dossier's
 * `SUCCESS (TESTABLE)` clauses, artifact-first), it is **paced** (measured wall
 * time vs the op catalog), and it is **documented** (`DEMO-ACTS-DOSSIER.md`
 * cross-checked against the registry and the catalog — doc-drift is a
 * first-class failure).
 *
 * **Exit codes mirror `demo:show --check`** (AD6): `0` pass · `1`
 * checked-and-failed · `2` bad invocation, or the harness could not run.
 * `2` is never used for "the act is broken" — an honest act-red is a `1`.
 *
 * **`--docs-only` spawns nothing.** The runtime is reached only through a
 * dynamic `import('../demo/acts/act-run.js')` gated on tier, so a docs run never
 * loads the op registry, Playwright, or a sibling process.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ACTS_REPORT_FILE,
  ACTS_REPORT_SCHEMA_VERSION,
  countSeverity,
  formatFinding,
  writeActsReport,
  type ActGroupReport,
  type ActsReport,
  type ActsTier,
  type Finding,
} from '../demo/acts/acts-report.js';
import { dossierClaimsByOpId, runDocsCheck } from '../demo/acts/docs-check.js';
import { DOSSIER_PATH } from '../demo/acts/dossier.js';
import { buildPacingReport, pacingFindings, summaryMarkdown } from '../demo/acts/pacing.js';
import { OP_CATALOG } from '../demo/show/op-catalog.js';
import { DEMO_OP_IDS } from '../demo/show/deck-model.js';

/** AD10 — tiers are group sets. The docs check runs in EVERY tier. */
export const TIER_GROUPS: Readonly<Record<Exclude<ActsTier, 'act'>, readonly string[]>> = {
  'docs-only': [],
  quick: ['muster-readiness', 'ao-registry'],
  full: [
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
  ],
};

export interface ActsTestArgs {
  readonly tier: ActsTier;
  /** Non-empty only when `--act` was used; it OVERRIDES the tier. */
  readonly actGroupIds: readonly string[];
  readonly runId: string;
  readonly fromReport?: string;
  readonly testerRoot: string;
  readonly stacksimRoot: string;
  readonly aoRoot: string;
  readonly eoRoot: string;
  readonly stamperRoot: string;
  readonly musterRoot: string;
  readonly errors: readonly string[];
}

/**
 * Flags that consume the next argv entry. A value-taking flag missing here is
 * not a compile error and not a test failure — it silently makes the next token
 * read as a flag. Every value-taking flag above must appear here.
 */
const FLAGS_WITH_VALUES = new Set([
  '--run-id',
  '--act',
  '--from-report',
  '--stacksim-root',
  '--ao-root',
  '--eo-root',
  '--stamper-root',
  '--muster-root',
]);

function argFlag(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

function argFlagAll(argv: readonly string[], flag: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === flag && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(argv[i + 1]);
  });
  return out;
}

/** Pure argv parser. Never throws; bad values land in `errors`. */
export function parseActsTestArgs(argv: readonly string[], testerRoot: string): ActsTestArgs {
  const errors: string[] = [];
  const ces = path.resolve(testerRoot, '..');

  const tierFlags = (['--docs-only', '--quick', '--full'] as const).filter((f) =>
    argv.includes(f),
  );
  const actGroupIds = argFlagAll(argv, '--act');

  if (tierFlags.length > 1) {
    errors.push(`pick one tier: ${tierFlags.join(' and ')} were both given`);
  }
  if (actGroupIds.length > 0 && tierFlags.length > 0) {
    errors.push(
      `--act ${actGroupIds.join(' --act ')} overrides a tier, so it cannot be combined with ${tierFlags.join(' ')}`,
    );
  }

  let tier: ActsTier = 'docs-only';
  if (actGroupIds.length > 0) tier = 'act';
  else if (tierFlags[0] === '--quick') tier = 'quick';
  else if (tierFlags[0] === '--full') tier = 'full';

  for (const unknown of argv.filter(
    (a, i) =>
      a.startsWith('--') &&
      !FLAGS_WITH_VALUES.has(a) &&
      !['--docs-only', '--quick', '--full'].includes(a) &&
      i >= 0,
  )) {
    errors.push(`unknown flag ${unknown}`);
  }

  const root = (flag: string, name: string): string =>
    argFlag(argv, flag) ? path.resolve(argFlag(argv, flag)!) : path.join(ces, name);

  return {
    tier,
    actGroupIds,
    runId: argFlag(argv, '--run-id') ?? `acts-${Date.now()}`,
    fromReport: argFlag(argv, '--from-report'),
    testerRoot,
    stacksimRoot: root('--stacksim-root', 'tenant-stacksim'),
    aoRoot: root('--ao-root', 'ces-ao'),
    eoRoot: root('--eo-root', 'ces-eo'),
    stamperRoot: root('--stamper-root', 'ces-stamper'),
    musterRoot: root('--muster-root', 'ces-muster'),
    errors,
  };
}

export function groupsFor(args: ActsTestArgs): readonly string[] {
  if (args.tier === 'act') return args.actGroupIds;
  return TIER_GROUPS[args.tier];
}

export interface ActsTestDeps {
  readonly log?: (line: string) => void;
  readonly readDossier?: (absPath: string) => string;
  /**
   * The runtime seam. Injected in tests; in production it is reached ONLY via a
   * dynamic import gated on tier, so `--docs-only` never loads the op registry.
   */
  readonly runGroups?: (
    groupIds: readonly string[],
    args: ActsTestArgs,
    log: (line: string) => void,
  ) => Promise<readonly ActGroupReport[]>;
}

export async function runDemoActsTestCommand(
  argv: string[],
  testerRoot: string,
  deps: ActsTestDeps = {},
): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseActsTestArgs(argv, testerRoot);

  if (args.errors.length > 0) {
    for (const e of args.errors) console.error(`demo:acts-test: ${e}`);
    return 2;
  }

  const startedAt = new Date().toISOString();
  const dossierAbs = path.join(testerRoot, DOSSIER_PATH);
  let markdown: string;
  try {
    markdown = (deps.readDossier ?? ((p: string) => fs.readFileSync(p, 'utf8')))(dossierAbs);
  } catch {
    console.error(`demo:acts-test: cannot read the dossier at ${dossierAbs}`);
    return 2;
  }

  const docs = runDocsCheck({ markdown, testerRoot });

  const groupIds = groupsFor(args);
  let groups: readonly ActGroupReport[] = [];
  let tier = args.tier;
  if (args.fromReport !== undefined) {
    // Re-analysis. The runtime is NEVER reached: the expensive tier costs ~25
    // minutes against real siblings, and re-deriving pacing or a summary from
    // evidence already on disk must not cost that again.
    try {
      const prior = JSON.parse(
        fs.readFileSync(path.resolve(testerRoot, args.fromReport), 'utf8'),
      ) as ActsReport;
      groups = prior.groups;
      // Carry the PRIOR tier: a re-analysis of a `--full` run is evidence about
      // a full run, and labelling it `docs-only` would misdescribe the groups it
      // is reporting on.
      tier = prior.tier;
      log(`  re-analysing ${prior.groups.length} act group(s) from run ${prior.runId} (${prior.tier})`);
    } catch (err) {
      console.error(
        `demo:acts-test: cannot re-analyse ${args.fromReport}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 2;
    }
  } else if (groupIds.length > 0) {
    const runner = deps.runGroups ?? (await loadRuntime());
    if (!runner) {
      console.error(
        `demo:acts-test: the runtime tier is not available (could not load src/demo/acts/act-run.ts)`,
      );
      return 2;
    }
    try {
      groups = await runner(groupIds, args, log);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`demo:acts-test: the harness could not run: ${message}`);
      return 2;
    }
  }

  // The pacing axis. Built for EVERY catalogued op, not only the ones this tier
  // ran: an op with no measurement reports `unmeasured`, which is a different
  // and more honest statement than silence or than "as fast as the catalog says".
  const catalogMsById = Object.fromEntries(
    DEMO_OP_IDS.map((id) => [id, OP_CATALOG[id].typicalWarmMs]),
  );
  const pacing = buildPacingReport(groups, catalogMsById, dossierClaimsByOpId(docs.parsed));

  const findings: Finding[] = [
    ...docs.findings,
    ...groups.flatMap((g) => g.findings),
    ...pacingFindings(pacing),
  ];
  const failCount = countSeverity(findings, 'fail');
  const warnCount = countSeverity(findings, 'warn');
  const exitCode = failCount > 0 ? 1 : 0;

  const report: ActsReport = {
    schemaVersion: ACTS_REPORT_SCHEMA_VERSION,
    runId: args.runId,
    startedAt,
    endedAt: new Date().toISOString(),
    tier,
    exitCode,
    docs: {
      dossierPath: DOSSIER_PATH,
      entryCount: docs.parsed.entries.length,
      failCount: countSeverity(docs.findings, 'fail'),
      warnCount: countSeverity(docs.findings, 'warn'),
      skipped: docs.skipped,
      findings: docs.findings,
    },
    groups,
    findings,
    pacing,
  };

  const runDir = path.join(testerRoot, 'runs', 'acts-test', args.runId);
  const reportAbs = path.join(runDir, ACTS_REPORT_FILE);
  await writeActsReport(report, reportAbs);
  await fs.promises.writeFile(
    path.join(runDir, 'summary.md'),
    summaryMarkdown(report, testerRoot),
    'utf8',
  );

  for (const finding of findings) log(formatFinding(finding));
  for (const entry of docs.skipped) log(`SKIP DD9 ${entry} — PROPOSED, not run`);
  log('');
  log(
    `demo:acts-test [${tier}]: ${failCount} FAIL, ${warnCount} WARN, ${docs.skipped.length} skipped`,
  );
  log(`  report: ${path.relative(testerRoot, reportAbs).replace(/\\/g, '/')}`);

  return exitCode;
}

/**
 * The tier gate. The specifier is held in a variable deliberately: the runtime
 * module is OPTIONAL at this layer, and a computed specifier keeps the docs tier
 * compiling and running whether or not the runtime half is present.
 */
const ACT_RUN_MODULE = '../demo/acts/act-run.js';

async function loadRuntime(): Promise<ActsTestDeps['runGroups'] | undefined> {
  try {
    const mod = (await import(ACT_RUN_MODULE)) as {
      runActGroups?: ActsTestDeps['runGroups'];
    };
    return mod.runActGroups;
  } catch {
    return undefined;
  }
}
