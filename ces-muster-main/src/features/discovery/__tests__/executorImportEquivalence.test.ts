// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DISCOVERY-1 acceptance GATE 3 — the EXECUTOR-emitted readiness-result.v1
// file, fed through Muster's import seam, produces boundary-draft behavior
// equivalent to the canned-fixture path. This is G-MUSTER-PLAN-2's equivalence
// discipline (importEquivalence.test.ts) applied to the real engine's output:
// one shape, one seam, no second format — now proven from the executor's rows,
// not just the fixture's.
//
// The walk here is the REAL muster-api executor (discoveryService is pure +
// dependency-injected, so it imports cleanly cross-package) driven by a mock
// session that exercises every outcome class Gate 1/2 defined: evidence found
// (met/high), read-succeeded-empty (low), restricted-tier denial (unknown,
// Gate 2's fact-status), and manual_only (recorded, not omitted).
import { describe, test, expect } from 'vitest';
import {
  runDiscovery,
  AUTH_TIER_UNAVAILABLE,
  type RegistryGetEntry,
  type DiscoverySession,
  type CaptureSink,
} from '../../../../muster-api/src/services/discoveryService';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { synthesizeFactsFromDiscovery } from '@/features/interview/discoveryFactJoin';
import { inferBoundaryDrafts } from '@/features/interview/boundaryInference';
import {
  parseReadinessResultFile,
  discoveryResultsFromPayload,
} from '../importReadinessResult';
import type { ReadinessResult } from '@/shared/types/readinessResult';
import type { DiscoveryResult } from '@/shared/types/discovery';

/** Strip volatile timestamps so equivalence compares substance. */
function stable<T extends { recorded_at: string }>(facts: T[]): Omit<T, 'recorded_at'>[] {
  return facts.map(({ recorded_at: _r, ...rest }) => rest);
}

// Entries whose control_ids overlap the QUESTION_GRAPH mapped_requirements the
// canned fixture also targets — so the seam has real joins to make.
const ENTRIES: RegistryGetEntry[] = [
  { entry_id: 'AC.get-users', control_ids: ['AC.L1-3.1.1'], engine: 'mgraph', get_command: 'Get-MgUser' },
  { entry_id: 'IA.get-authpolicy', control_ids: ['IA.L2-3.5.3', 'AC.L2-3.1.13'], engine: 'mgraph', get_command: 'Get-MgPolicyAuthenticationMethodPolicy' },
  { entry_id: 'CM.get-deviceconfig', control_ids: ['CM.L2-3.4.1'], engine: 'mgraph', get_command: 'Get-MgDeviceManagementDeviceConfiguration' },
  { entry_id: 'RA.get-risk', control_ids: ['RA.L2-3.11.1'], engine: 'mgraph', get_command: 'Get-MgRiskDetection' },
  { entry_id: 'MP.manual-media', control_ids: ['MP.L2-3.8.1'], engine: 'manual', manual_only: true },
];

// A restricted-tier session: risk reads are denied with Graph's real
// insufficient-privileges signature; device config reads succeed but empty.
const session: DiscoverySession = {
  execute: async (_engine, cmd) => {
    if (cmd === 'Get-MgRiskDetection') {
      return {
        stdout: '',
        stderr:
          'Get-MgRiskDetection : Authorization_RequestDenied: Insufficient privileges to complete the operation.',
        exitCode: 1,
        durationMs: 1,
      };
    }
    if (cmd === 'Get-MgDeviceManagementDeviceConfiguration') {
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 };
    }
    return { stdout: '[{"id":"obj-1"}]', stderr: '', exitCode: 0, durationMs: 1 };
  },
};

const capture: CaptureSink = { write: (entryId) => `captures/${entryId}.json` };

/** Wrap executor observations in a complete, schema-valid emitted payload —
 * the file shape the discovery lane emits (Gate 1's envelope). */
function emittedPayload(observations: ReadinessResult['observations']): ReadinessResult {
  return {
    schema_version: 'readiness-result/1.0.0',
    manifest: {
      mode: 'independent',
      auth_tier: 'device-code',
      tenant: { slug: 'stacksim-m365', kind: 'sim' },
      operator: { name: 'Discovery Executor Test', role: 'operator' },
      engagement_id: 'eng-gate3',
      party_id: 'party-gate3',
      engagement_kind: 'individual_contractor',
      started_at: '2026-07-25T00:00:00.000Z',
    },
    observations,
    derived: {
      sprs_now: { sprs: 110, assessed_count: 0, deductions: [] },
      gaps: [],
      sprs_after: 110,
    },
    provenance: {
      registry_versions: { 'cmmc-l2-commands': 'test' },
      coverage_dataset: 'registry-objective-coverage-2026-07-10',
      engine: { name: 'muster-api-discovery', version: '0.1.0' },
      generated_at: '2026-07-25T00:00:00.000Z',
    },
  };
}

describe('GATE 3 — executor-emitted file through the import seam == canned-fixture path', () => {
  test('the emitted file round-trips the schema gate and the seam joins its rows identically to the direct path', async () => {
    const { observations, statuses } = await runDiscovery(ENTRIES, session, capture);

    // Sanity: the walk produced every outcome class this gate exercises.
    expect(statuses.find((s) => s.entry_id === 'RA.get-risk')!.status).toBe(AUTH_TIER_UNAVAILABLE);
    expect(statuses.find((s) => s.entry_id === 'AC.get-users')!.status).toBe('ok');
    expect(statuses.find((s) => s.entry_id === 'MP.manual-media')!.status).toBe('manual_only');

    // The emitted FILE: executor rows verbatim inside the v1 envelope. It must
    // pass the same parse + schema validation every import does (loud failure
    // path already covered by payloadImportSeam.test.ts).
    const file = JSON.stringify(emittedPayload(observations), null, 2);
    const imported = parseReadinessResultFile(file);
    const importedRows = discoveryResultsFromPayload(imported);

    // The canned-fixture path is DiscoveryResult[] fed straight into the seam
    // functions. The equivalent direct rows are the same observations reduced
    // to the ONE DiscoveryResult shape without any file round-trip.
    const directRows: DiscoveryResult[] = observations.map((o) => ({
      control_id: o.control_id,
      objective_ids: o.objective_ids,
      confidence: o.confidence,
    }));

    // EQUIVALENCE: identical synthesized facts and identical boundary drafts.
    const importedFacts = synthesizeFactsFromDiscovery(importedRows, QUESTION_GRAPH);
    const directFacts = synthesizeFactsFromDiscovery(directRows, QUESTION_GRAPH);
    expect(stable(importedFacts)).toEqual(stable(directFacts));

    const importedDrafts = inferBoundaryDrafts(importedRows);
    const directDrafts = inferBoundaryDrafts(directRows);
    expect(stable(importedDrafts)).toEqual(stable(directDrafts));

    // Guard against vacuous equivalence: the executor's rows really joined —
    // facts were synthesized and at least one boundary draft fired.
    expect(importedFacts.length).toBeGreaterThan(0);
    expect(importedDrafts.length).toBeGreaterThan(0);
  });

  test('FCA survives the file: the denied (unknown) row synthesizes unsure, never yes', async () => {
    const { observations } = await runDiscovery(ENTRIES, session, capture);
    const rows = discoveryResultsFromPayload(
      parseReadinessResultFile(JSON.stringify(emittedPayload(observations)))
    );

    const facts = synthesizeFactsFromDiscovery(rows, QUESTION_GRAPH);
    const fromDenied = facts.filter((f) =>
      QUESTION_GRAPH.some(
        (n) => n.id === f.question_id && n.mapped_requirements.includes('RA.L2-3.11.1')
      )
    );
    for (const fact of fromDenied) {
      expect(fact.answer).toBe('unsure');
      expect(fact.confidence).toBe('unknown');
    }
    // And unknown rows never seed a boundary draft (drafts from unknown would
    // launder unverified evidence into the boundary).
    const draftsFromUnknownOnly = inferBoundaryDrafts(
      rows.filter((r) => r.confidence === 'unknown')
    );
    expect(draftsFromUnknownOnly).toEqual([]);
  });
});
