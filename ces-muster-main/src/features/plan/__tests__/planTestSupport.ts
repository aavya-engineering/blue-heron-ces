// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planTestSupport.ts — shared Node-test fixtures for the plan feature: the full
// CompilerBanks loaded from the vendored public/knowledge/ YAML+JSON (the same
// files the SPA fetches), and a helper to build SITAnswers keyed by real SIT
// question ids. Keeps the individual test files focused on their assertions.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import type { TechRefCMMCL2 } from '@/vendored/ces-planner/shared/types/domain';
import type { FedRAMPInheritanceTable } from '@/vendored/ces-planner/mpt/services/fedrampInheritance';
import type { SITAnswer } from '@/vendored/ces-planner/types/siBaseline';
import type { CompilerBanks } from '../tenantManifestAdapter';

// `root` defaults to the cwd (the SPA repo root under `npm test`); muster-api's
// cross-package tests pass the SPA root explicitly since their cwd differs.
function bank(file: string, root = process.cwd()): unknown {
  return load(fs.readFileSync(path.resolve(root, 'public/knowledge', file), 'utf8'));
}

export function loadBanks(root = process.cwd()): CompilerBanks {
  return {
    cmmcRequirements: bank('domain CES CMMC Fundamental Requirements Store.yaml', root),
    evidenceMatrix: bank('domain Assessor Evidence Matrix.yaml', root),
    assessorKB: bank('domain Assessor Approach Knowledge Base.yaml', root),
    evidenceArchetypeCatalog: bank('domain Evidence Archetype Catalog.yaml', root),
    patterns: bank('domain Implementation Patterns.yaml', root),
    playbook: bank('vendor playbook Microsoft 365.yaml', root),
    techRef: JSON.parse(
      fs.readFileSync(path.resolve(root, 'public/knowledge', 'gcc-high-g5-cmmc-2-tech-ref-structured.json'), 'utf8')
    ) as TechRefCMMCL2,
    inheritanceTable: bank('fedramp-inheritance-table.yaml', root) as FedRAMPInheritanceTable,
    siQuestionBank: bank('primed SI Question Bank.yaml', root) as CompilerBanks['siQuestionBank'],
    tcpQuestionBank: bank('primed TCP Question Bank.yaml', root) as CompilerBanks['tcpQuestionBank'],
  };
}

/** The SIT question ids for the common SI fields (from the bank's sets_its_fields). */
const FIELD_TO_QID: Record<string, string> = {
  targetLevel: 'G-01', // si_baseline.target.target_cmmc_level
  cuiPresence: 'G-02', // si_baseline.target.cui_presence
  boundaryStrategy: 'G-07', // si_baseline.scope.boundary_strategy
  deploymentPosture: 'G-08', // si_baseline.scope.deployment_posture
};

/** Build SITAnswers keyed by real SIT question id from a friendly partial. */
export function sitAnswers(partial: {
  targetLevel?: string;
  cuiPresence?: string;
  boundaryStrategy?: string;
  deploymentPosture?: string;
}): Record<string, SITAnswer> {
  const answers: Record<string, SITAnswer> = {};
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    const qid = FIELD_TO_QID[key];
    if (!qid) continue;
    answers[qid] = {
      question_id: qid,
      answer_type: 'enum',
      raw_answer: value,
      captured_at: '1970-01-01T00:00:00.000Z',
      provenance_class: 'client_assertion',
    };
  }
  return answers;
}
