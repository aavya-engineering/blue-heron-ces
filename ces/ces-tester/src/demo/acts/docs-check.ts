// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the documentation axis (DD1-DD11).
 *
 * The founder named three things a demo-act must be: it must **work**, it must
 * be **paced** well, and it must be **documented** well. This module is the
 * third. Doc-drift is a first-class failure, not a nag: a deck author authors
 * against `DEMO-ACTS-DOSSIER.md`, so a dossier that has quietly diverged from
 * the registry and the catalog is worse than no dossier at all.
 *
 * **Every rule here is mechanical and every rule id is stable.** The point of
 * enumerating the expected red list in `docs/demo/PLAN-ACT-HARNESS.md` — rather
 * than asserting "exits non-zero" — is that an EXTRA or a MISSING finding fails
 * the check. That only works if a rule never depends on a paraphrase: DD6b's
 * trigger phrases are a closed list, extended only by plan revision.
 *
 * **AD4 — this module spawns nothing.** It reaches the registry, the catalog and
 * the loader's column vocabulary, and it reads files with `node:fs`. It never
 * touches Playwright, never starts a server and never runs a sibling process, so
 * `demo:acts-test --docs-only` is safe to run anywhere.
 * `tests/demo-acts-docs-check.test.ts` proves that over the transitive graph.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEMO_OP_IDS, isDemoOpId, type DemoOpId } from '../show/deck-model.js';
import { OP_CATALOG, OP_CATALOG_DOC, validateParams } from '../show/op-catalog.js';
import { CANONICAL_COLUMNS, canonicalColumn } from '../show/xlsx-loader.js';
import type { Finding } from './acts-report.js';
import {
  DOSSIER_PATH,
  parseDossier,
  paramKeysOf,
  type DossierEntry,
  type ParsedDossier,
} from './dossier.js';

/**
 * DD10's severity. `'warn'` while `typicalWarmMs` is a set of guesses, flipped
 * to `'fail'` in Slice F once the catalog carries measured values: a pacing lie
 * is advisory while the numbers are estimates and a failure once they are
 * evidence.
 */
export const DD10_SEVERITY: 'warn' | 'fail' = 'fail';

/**
 * DD10's tolerance. Flagged **strictly outside** these multiples, so 2.0x
 * exactly passes. That is a decision, not an accident.
 */
export const DD10_TOLERANCE = { min: 0.5, max: 2.0 } as const;

/**
 * DD6's stale-future phrases: prose promising a future that has since shipped.
 */
export const DD6_TRIGGER_PHRASES: readonly string[] = [
  'Slice 4a',
  'None today',
  'does not exist',
];

/**
 * DD6b's trigger phrases — a CLOSED list. A paraphrase outside it is not a
 * finding, which is what keeps the predicted count derivable from the files
 * rather than from a judgement call about what a sentence means.
 */
export const DD6B_TRIGGER_PHRASES: readonly string[] = [
  'does not exist',
  'not selectable without',
  'needs the',
];

export interface GitFacts {
  readonly branch?: string;
  readonly head?: string;
  /** Raw `.git/logs/HEAD`; absent on a fresh clone, which makes DD11's sha sub-check inert. */
  readonly reflog?: string;
  /** `undefined` means "not determined" — the sub-check stays inert rather than guessing. */
  readonly workingTreeClean?: boolean;
}

export interface DocsCheckOptions {
  readonly markdown: string;
  readonly testerRoot: string;
  readonly dossierPath?: string;
  readonly git?: GitFacts;
  readonly fileExists?: (absPath: string) => boolean;
  readonly readFile?: (absPath: string) => string | undefined;
}

export interface DocsCheckResult {
  readonly parsed: ParsedDossier;
  readonly findings: readonly Finding[];
  /** DD9 — PROPOSED entries are reported skipped at runtime, never failed. */
  readonly skipped: readonly string[];
}

/** The three artifacts §A.1 claims do not exist yet, each with a real probe. */
interface ArtifactProbe {
  readonly id: string;
  /** The backticked token a document uses to name it. */
  readonly token: string;
  readonly label: string;
  readonly exists: (ctx: ProbeContext) => boolean;
}

interface ProbeContext {
  readonly testerRoot: string;
  readonly fileExists: (absPath: string) => boolean;
  readonly readFile: (absPath: string) => string | undefined;
}

const ARTIFACT_PROBES: readonly ArtifactProbe[] = [
  {
    id: 'params-column',
    token: 'params',
    label: 'the `params` deck column',
    exists: () => (CANONICAL_COLUMNS as readonly string[]).includes('params'),
  },
  {
    id: 'act-alias',
    token: 'act',
    label: 'the `act` / `demo act` alias for the `op` column',
    exists: () => canonicalColumn('act') === 'op' && canonicalColumn('demoact') === 'op',
  },
  {
    id: 'op-catalog-doc',
    token: OP_CATALOG_DOC,
    label: 'the published op catalog',
    exists: (ctx) => ctx.fileExists(path.join(ctx.testerRoot, OP_CATALOG_DOC)),
  },
];

/**
 * DD8 — the section E items that carry a mechanical probe. **Exactly two are
 * defined.** E5 (`DEMO_PORTS` labels 5173 `muster`) was re-verified still true
 * and needs no probe; E1/E2/E3/E6/E9/E10 have no mechanical probe at all and
 * are deliberately not tested. Inventing a probe for a claim you cannot check is
 * how a docs check starts lying.
 */
interface SectionEProbe {
  readonly item: number;
  readonly claim: string;
  /**
   * The item must still MAKE the claim for the rule to fire. Without this the
   * rule keys on an item merely being numbered 4, and the only way to go green
   * would be to DELETE the item — hiding a known inconsistency instead of
   * correcting it, which is the opposite of what section E is for.
   */
  readonly claimPattern: RegExp;
  /** True when the item's claim is STALE — i.e. the thing it says is absent now exists. */
  readonly stale: (ctx: ProbeContext) => boolean;
  readonly evidence: string;
}

const SECTION_E_PROBES: readonly SectionEProbe[] = [
  {
    item: 4,
    claim: 'No `params` column exists',
    claimPattern: /No .?params.? column exists/i,
    stale: () => (CANONICAL_COLUMNS as readonly string[]).includes('params'),
    evidence: '`params` is in CANONICAL_COLUMNS (xlsx-loader.ts)',
  },
  {
    item: 11,
    claim: '`ShowOpContext.artifact` is committed but inert',
    claimPattern: /artifact.? is committed but inert/i,
    stale: (ctx) =>
      (ctx.readFile(path.join(ctx.testerRoot, 'src', 'demo', 'show', 'show-run.ts')) ?? '').includes(
        'opArtifact',
      ),
    evidence: 'show-run.ts wires ctx.artifact to the report recorder (opArtifact)',
  },
];

function drift(
  rule: string,
  subject: string,
  message: string,
  line?: number,
  severity: 'fail' | 'warn' = 'fail',
): Finding {
  return { rule, severity, failureClass: 'doc-drift', subject, message, line };
}

const label = (entry: DossierEntry): string => `D.${entry.ordinal} ${entry.actName}`;

/**
 * Catalog defaults and enum values for an op — excluded from param-key
 * extraction. Without this, `IA` / `sprs` / `evidence` read as unknown parameter
 * keys and DD5b warns on three values that are perfectly correct documentation.
 */
function catalogValueTokens(opId: DemoOpId): Set<string> {
  const out = new Set<string>();
  for (const spec of OP_CATALOG[opId].params) {
    if (spec.default !== undefined) out.add(String(spec.default));
    for (const value of spec.values ?? []) out.add(value);
  }
  return out;
}

function catalogKeys(opId: DemoOpId): string[] {
  return OP_CATALOG[opId].params.map((p) => p.key);
}

/**
 * Deck-invocability of committed code — the dossier's own AS OF rule, encoded.
 *
 * NOT string-matched from the AS OF cell: that cell is a markdown table cell
 * carrying bold markers and a comma continuation, so any literal quote match
 * finds nothing.
 *
 * An entry is invocable today when its op id is registered AND every qualifier
 * is expressible in a deck cell: a mode qualifier always is (`op mode` is a
 * shipped column); a param qualifier is iff the catalog validates it.
 */
export function invocableToday(entry: DossierEntry): boolean {
  if (!entry.opId || !isDemoOpId(entry.opId)) return false;
  const opId = entry.opId;
  return entry.qualifiers.every((q) => {
    if (q.kind === 'mode') return true;
    return validateParams(opId, { [q.key]: q.value }).errors.length === 0;
  });
}

/** DD10's patterns. The seconds pattern is DELETED outright — see the plan. */
function minuteClaimsMs(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:≈|~)\s*(\d+)\s*min/g)) out.push(Number(m[1]) * 60_000);
  for (const m of text.matchAll(/(\d+)\s*minutes?\b/g)) out.push(Number(m[1]) * 60_000);
  return out;
}

/**
 * The dossier's minute-valued timing claims, grouped by op id — the same numbers
 * DD10 judges, handed to the pacing report so the prose, the catalog and the
 * measurement are all readable in one table instead of three places.
 */
export function dossierClaimsByOpId(
  parsed: ParsedDossier,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const entry of parsed.entries) {
    if (!entry.opId || !isDemoOpId(entry.opId)) continue;
    const claims = minuteClaimsMs(entryText(entry));
    if (claims.length === 0) continue;
    out[entry.opId] = [...(out[entry.opId] ?? []), ...claims];
  }
  return out;
}

function entryText(entry: DossierEntry): string {
  return Object.values(entry.fields)
    .map((f) => [f.inline, ...f.block].join('\n'))
    .join('\n');
}

/** Reads branch / HEAD / reflog straight out of `.git` — no child process. */
export function readGitFacts(
  testerRoot: string,
  readFile: (absPath: string) => string | undefined,
): GitFacts {
  const gitDir = path.join(testerRoot, '.git');
  const headRaw = readFile(path.join(gitDir, 'HEAD'));
  if (headRaw === undefined) return {};
  const ref = /^ref:\s*(\S+)/.exec(headRaw.trim());
  if (!ref) return { branch: undefined, head: headRaw.trim() };
  const refName = ref[1];
  const branch = refName.replace(/^refs\/heads\//, '');
  let head = readFile(path.join(gitDir, refName.replace(/\//g, path.sep)))?.trim();
  if (!head) {
    const packed = readFile(path.join(gitDir, 'packed-refs')) ?? '';
    const line = packed.split(/\r?\n/).find((l) => l.endsWith(` ${refName}`));
    head = line?.split(' ')[0];
  }
  return { branch, head, reflog: readFile(path.join(gitDir, 'logs', 'HEAD')) };
}

export function runDocsCheck(options: DocsCheckOptions): DocsCheckResult {
  const parsed = parseDossier(options.markdown);
  const findings: Finding[] = [];
  const dossierPath = options.dossierPath ?? DOSSIER_PATH;

  const fileExists = options.fileExists ?? ((p: string) => fs.existsSync(p));
  const readFile =
    options.readFile ??
    ((p: string) => {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        return undefined;
      }
    });
  const ctx: ProbeContext = { testerRoot: options.testerRoot, fileExists, readFile };
  const git = options.git ?? readGitFacts(options.testerRoot, readFile);

  const registered = parsed.entries.filter(
    (e): e is DossierEntry & { opId: DemoOpId } => !!e.opId && isDemoOpId(e.opId),
  );

  // ---- DD1: every registered op id has at least one entry -------------------
  for (const opId of DEMO_OP_IDS) {
    if (!registered.some((e) => e.opId === opId)) {
      findings.push(
        drift('DD1', opId, `registered in DEMO_OP_IDS but no ${dossierPath} entry names it`),
      );
    }
  }

  // ---- DD2: template completeness, either field shape -----------------------
  for (const entry of parsed.entries) {
    const problems = [
      ...entry.missingFields.map((f) => `${f} (missing)`),
      ...entry.emptyFields.map((f) => `${f} (empty)`),
    ];
    if (problems.length > 0) {
      findings.push(
        drift(
          'DD2',
          label(entry),
          `does not fill the section C template: ${problems.join(', ')}`,
          entry.headingLine,
        ),
      );
    }
  }

  // ---- DD3 / DD3b / DD4: status vs deck-invocability -------------------------
  for (const entry of parsed.entries) {
    const invocable = invocableToday(entry);
    // IN-BUILD is carved out of DD3 so a drifted entry yields exactly ONE status
    // finding, not two.
    if (entry.status === 'PROPOSED' && invocable) {
      findings.push(
        drift(
          'DD3',
          label(entry),
          `STATUS PROPOSED, but \`${entry.opId}\`${describeQualifiers(entry)} is invocable in a deck today`,
          entry.fields.STATUS?.line,
        ),
      );
    }
    if (entry.status === 'IMPLEMENTED' && !invocable) {
      findings.push(
        drift(
          'DD3b',
          label(entry),
          `STATUS IMPLEMENTED, but no deck can name \`${entry.opId ?? '(no id)'}\`${describeQualifiers(entry)} today`,
          entry.fields.STATUS?.line,
        ),
      );
    }
    if (entry.status === 'IN-BUILD' && entry.opId && isDemoOpId(entry.opId)) {
      findings.push(
        drift(
          'DD4',
          label(entry),
          `STATUS IN-BUILD, but \`${entry.opId}\` is registered and committed`,
          entry.fields.STATUS?.line,
        ),
      );
    }
  }

  // ---- DD5 / DD5b: PARAMS lines vs the catalog ------------------------------
  // Per-id and UNIONED across every entry sharing that id: the dossier
  // deliberately splits one op into three act views (D.13 / D.14 / D.15 all
  // document `eo-review`), so a per-entry reading would red a correct document.
  for (const opId of DEMO_OP_IDS) {
    const entries = registered.filter((e) => e.opId === opId);
    if (entries.length === 0) continue;
    const exclude = catalogValueTokens(opId);
    const union = new Set(entries.flatMap((e) => paramKeysOf(e.paramsText, exclude)));
    for (const key of catalogKeys(opId)) {
      if (!union.has(key)) {
        findings.push(
          drift(
            'DD5',
            opId,
            `catalog parameter \`${key}\` appears on no PARAMS line for this op (checked ${entries
              .map((e) => `D.${e.ordinal}`)
              .join(', ')})`,
          ),
        );
      }
    }
    const known = new Set(catalogKeys(opId));
    for (const entry of entries) {
      for (const key of paramKeysOf(entry.paramsText, exclude)) {
        if (!known.has(key)) {
          findings.push(
            drift(
              'DD5b',
              label(entry),
              `PARAMS names \`${key}\`, which is not a catalog parameter of \`${opId}\``,
              entry.fields.PARAMS?.line,
              'warn',
            ),
          );
        }
      }
    }
  }

  // ---- DD6: stale-future prose on a registered id ---------------------------
  for (const entry of registered) {
    if (OP_CATALOG[entry.opId].params.length === 0) continue;
    const hay = `${entry.paramsText}\n${entry.statusText}`;
    const hits = DD6_TRIGGER_PHRASES.filter((p) => hay.includes(p));
    if (hits.length > 0) {
      findings.push(
        drift(
          'DD6',
          label(entry),
          `\`${entry.opId}\` declares ${OP_CATALOG[entry.opId].params.length} catalog parameter(s), but the entry still says ${hits
            .map((h) => `"${h}"`)
            .join(' / ')}`,
          entry.fields.PARAMS?.line,
        ),
      );
    }
  }

  // ---- DD6b: a STATUS blocking on an artifact that already exists -----------
  // Reaches entries with NO catalog entry at all (`ao-make-change`), which is
  // why DD6 can never cover this case.
  for (const entry of parsed.entries) {
    for (const probe of ARTIFACT_PROBES) {
      if (!entry.statusText.includes(`\`${probe.token}\``)) continue;
      const phrases = DD6B_TRIGGER_PHRASES.filter((p) => entry.statusText.includes(p));
      if (phrases.length === 0) continue;
      if (!probe.exists(ctx)) continue;
      // One finding per (entry, artifact) — never one per matched phrase.
      findings.push(
        drift(
          'DD6b',
          label(entry),
          `STATUS blocks on ${probe.label} ("${phrases[0]}"), but it exists today`,
          entry.fields.STATUS?.line,
        ),
      );
    }
  }

  // ---- DD7: section A.1's "does not exist yet" block ------------------------
  for (const bullet of parsed.doesNotExistYet) {
    const probe = ARTIFACT_PROBES.find((p) => bullet.text.includes(`\`${p.token}\``));
    if (!probe) continue;
    if (probe.exists(ctx)) {
      findings.push(
        drift(
          'DD7',
          `A.1 ${probe.id}`,
          `listed under "What does NOT exist yet", but ${probe.label} exists today`,
          bullet.line,
        ),
      );
    }
  }

  // ---- DD8: the two section E items that carry a probe ----------------------
  for (const probe of SECTION_E_PROBES) {
    const item = parsed.sectionE.find((i) => i.number === probe.item);
    if (!item) continue;
    if (!probe.claimPattern.test(item.text)) continue;
    if (probe.stale(ctx)) {
      findings.push(
        drift(
          'DD8',
          `E.${probe.item}`,
          `"${probe.claim}" is no longer true — ${probe.evidence}`,
          item.line,
        ),
      );
    }
  }

  // ---- DD9: PROPOSED entries are SKIPPED, never failed ----------------------
  const skipped = parsed.entries
    .filter((e) => e.status === 'PROPOSED')
    .map((e) => label(e));

  // ---- DD10: minute-valued timing prose vs typicalWarmMs --------------------
  for (const entry of registered) {
    const catalogMs = OP_CATALOG[entry.opId].typicalWarmMs;
    for (const claimMs of minuteClaimsMs(entryText(entry))) {
      const ratio = claimMs / catalogMs;
      if (ratio >= DD10_TOLERANCE.min && ratio <= DD10_TOLERANCE.max) continue;
      findings.push({
        rule: 'DD10',
        severity: DD10_SEVERITY,
        failureClass: 'pace',
        subject: label(entry),
        message: `timing prose claims ${Math.round(claimMs / 60_000)} min (${claimMs} ms) but \`${entry.opId}\` declares typicalWarmMs ${catalogMs} — ${ratio.toFixed(3)}x, outside [${DD10_TOLERANCE.min}, ${DD10_TOLERANCE.max}]`,
        line: entry.headingLine,
      });
    }
  }

  // ---- DD11: AS OF freshness ------------------------------------------------
  const asOfFinding = checkAsOf(parsed, git, ctx);
  if (asOfFinding) findings.push(asOfFinding);

  return { parsed, findings, skipped };
}

function describeQualifiers(entry: DossierEntry): string {
  if (entry.qualifiers.length === 0) return '';
  return ` (${entry.qualifiers.map((q) => (q.kind === 'mode' ? `op mode: ${q.value}` : `${q.key}=${q.value}`)).join(', ')})`;
}

/** Phrases that assert a build is happening RIGHT NOW. A closed list. */
const IN_FLIGHT_PHRASES = /is running|mid-write|being written/i;

/**
 * DD11 emits **at most one** finding, naming every stale fact it found.
 *
 * Two deliberate refinements of the plan's wording, both because the literal
 * reading is not implementable as a rule that can ever go green again:
 *
 * 1. *"the `Branch / HEAD` cell names the current `git HEAD`"* is unsatisfiable
 *    in steady state — the commit that re-stamps AS OF cannot know its own hash,
 *    so a strict equality check reds forever after the first re-stamp. The sha
 *    sub-check therefore asserts the named commit is REAL for this repository
 *    (HEAD, or present in the reflog), which still catches a typo or a hash
 *    carried over from another checkout. It goes inert without `.git/logs`.
 * 2. *"...does not claim an in-flight executor when the working tree is clean"*
 *    is inert in practice — this working tree is never clean (untracked session
 *    logs), so the sub-check would never fire and the rule would be decorative.
 *    Replaced with a probe of the CLAIM ITSELF: an AS OF that says a build is
 *    mid-write, while every op the dossier lists as IN-BUILD is registered AND
 *    has its implementation module on disk, is describing a build that already
 *    landed. That is the sub-check that fires today, and it is *true*: a genuine
 *    in-flight executor has un-registered ops, so it will not trip this.
 */
function checkAsOf(
  parsed: ParsedDossier,
  git: GitFacts,
  ctx: ProbeContext,
): Finding | undefined {
  const row = parsed.asOf['Branch / HEAD'];
  const stale: string[] = [];

  if (row) {
    const tokens = [...row.value.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const namedBranch = tokens[0];
    const namedSha = tokens.find((t) => /^[0-9a-f]{7,40}$/.test(t));
    if (git.branch && namedBranch && namedBranch !== git.branch) {
      stale.push(`names branch \`${namedBranch}\`, but HEAD is on \`${git.branch}\``);
    }
    if (namedSha && git.head && git.reflog !== undefined) {
      const known = git.head.startsWith(namedSha) || git.reflog.includes(namedSha);
      if (!known) {
        stale.push(`names commit \`${namedSha}\`, which is not a commit of this repository`);
      }
    }
  } else {
    stale.push('has no "Branch / HEAD" row');
  }

  const build = parsed.asOf['Build state'];
  if (build && IN_FLIGHT_PHRASES.test(build.value)) {
    const inBuild = parsed.entries.filter(
      (e) => e.status === 'IN-BUILD' && !!e.opId && isDemoOpId(e.opId),
    );
    const landed = inBuild.filter((e) =>
      ctx.fileExists(path.join(ctx.testerRoot, 'src', 'demo', 'show', 'ops', `${e.opId}-op.ts`)),
    );
    if (inBuild.length > 0 && landed.length === inBuild.length) {
      stale.push(
        `claims a build is in flight, but every IN-BUILD act (${inBuild
          .map((e) => `\`${e.opId}\``)
          .join(', ')}) is registered with its implementation on disk`,
      );
    }
  }

  if (stale.length === 0) return undefined;
  return {
    rule: 'DD11',
    severity: 'warn',
    failureClass: 'doc-drift',
    subject: 'AS OF',
    message: `the AS OF block is stale: it ${stale.join('; it ')}`,
    line: row?.line ?? parsed.entries[0]?.headingLine,
  };
}
