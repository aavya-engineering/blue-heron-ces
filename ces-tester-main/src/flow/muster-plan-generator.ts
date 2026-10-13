// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Flow-through MS-R3 / MS-R10: obtain a Manual Mission Plan + Tenant Manifest
 * from Muster's REAL generator — `buildPlanArtifacts` in
 * ces-muster/src/features/plan/tenantManifestAdapter.ts, the one-compile path
 * the Plan tab (`compilePlanForSession`) calls — never a hand-built plan.
 *
 * What this module supplies is Muster's generator INPUT (SIT answers keyed by
 * real SI-bank question ids + requirement_results), exactly the two things
 * `compilePlanForSession` feeds `buildPlanArtifacts`. The banks are the ones
 * Muster ships in ces-muster/public/knowledge (the files the SPA fetches).
 *
 * RUNTIME NOTE: Muster's sources are TypeScript with an `@/` alias, so this
 * module only works under vite (vitest, or vite-node with this repo's
 * vitest.config.ts, which mirrors the alias). Plain `node dist/...` cannot run
 * it; the X2 scenario path spawns vite-node on scripts/muster-plan-gen.ts.
 * Read-only: nothing is written into ces-muster.
 */

export type MusterStatus = 'met' | 'partial' | 'not_met' | 'unknown';

export interface MusterPlanCase {
  id: string;
  /** SIT answers keyed by real SI-bank question id -> raw answer. */
  sitAnswers: Record<string, string | number | string[] | boolean>;
  /** Requirement posture; 'all-met' = every requirement in Muster's requirements store is `met`. */
  requirementResults: Array<{ requirement_id: string; status: MusterStatus }> | 'all-met';
  /** Engagement id Muster passes as cesId (compilePlanForSession uses engagement.id). */
  cesId: string;
}

export interface MusterPlanOutput {
  caseId: string;
  missionPlan: Record<string, any>;
  tenantManifest: Record<string, any>;
  siBaseline: Record<string, any>;
  provenance: {
    generator: string;
    generatorFn: 'buildPlanArtifacts';
    musterHead: string;
    banksDir: string;
  };
}

function gitHead(repo: string): string {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '(unknown)';
  }
}

async function importFrom(absPath: string): Promise<any> {
  return import(pathToFileURL(absPath).href);
}

/** Muster's shipped banks, loaded with absolute paths (never cwd-relative). */
export async function loadMusterBanks(musterRoot: string): Promise<Record<string, unknown>> {
  const yamlMod = await importFrom(path.join(musterRoot, 'node_modules', 'js-yaml', 'dist', 'js-yaml.mjs'));
  const load: (s: string) => unknown = yamlMod.load ?? yamlMod.default?.load;
  const k = path.join(musterRoot, 'public', 'knowledge');
  const yml = (f: string) => load(fs.readFileSync(path.join(k, f), 'utf8'));
  return {
    cmmcRequirements: yml('domain CES CMMC Fundamental Requirements Store.yaml'),
    evidenceMatrix: yml('domain Assessor Evidence Matrix.yaml'),
    assessorKB: yml('domain Assessor Approach Knowledge Base.yaml'),
    evidenceArchetypeCatalog: yml('domain Evidence Archetype Catalog.yaml'),
    patterns: yml('domain Implementation Patterns.yaml'),
    playbook: yml('vendor playbook Microsoft 365.yaml'),
    techRef: JSON.parse(fs.readFileSync(path.join(k, 'gcc-high-g5-cmmc-2-tech-ref-structured.json'), 'utf8')),
    inheritanceTable: yml('fedramp-inheritance-table.yaml'),
    siQuestionBank: yml('primed SI Question Bank.yaml'),
  };
}

function answerTypeOf(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'enum';
}

export async function generateMusterPlan(c: MusterPlanCase, cesRoot: string): Promise<MusterPlanOutput> {
  const musterRoot = path.join(cesRoot, 'ces-muster');
  const generator = path.join(musterRoot, 'src', 'features', 'plan', 'tenantManifestAdapter.ts');
  const { buildPlanArtifacts } = await importFrom(generator);
  const banks = await loadMusterBanks(musterRoot);

  const sitAnswers: Record<string, unknown> = {};
  for (const [qid, raw] of Object.entries(c.sitAnswers)) {
    sitAnswers[qid] = {
      question_id: qid,
      answer_type: answerTypeOf(raw),
      raw_answer: raw,
      captured_at: '1970-01-01T00:00:00.000Z',
      provenance_class: 'client_assertion',
    };
  }

  const requirementResults =
    c.requirementResults === 'all-met'
      ? ((banks.cmmcRequirements as { requirements: Array<{ requirement_id: string }> }).requirements).map((r) => ({
          requirement_id: r.requirement_id,
          status: 'met' as const,
        }))
      : c.requirementResults;

  const artifacts = buildPlanArtifacts(
    { sitAnswers, requirementResults, tenantConfig: null, cesId: c.cesId },
    banks,
  );

  return {
    caseId: c.id,
    missionPlan: artifacts.missionPlan,
    tenantManifest: artifacts.tenantManifest,
    siBaseline: artifacts.siBaseline,
    provenance: {
      generator: path.relative(cesRoot, generator).split(path.sep).join('/'),
      generatorFn: 'buildPlanArtifacts',
      musterHead: gitHead(musterRoot),
      banksDir: 'ces-muster/public/knowledge',
    },
  };
}
