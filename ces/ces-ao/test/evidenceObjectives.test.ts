// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AO-1 (gap plan G-AO, V76): every registry command names the assessment objectives its output
// evidences; every id exists in ces-shared's objective reference and belongs to one of the
// command's own controls; the bridge entry and the persisted evidence row carry them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AoCommand } from '../src/types/AoCommand.js';
import { translateAoCommandToCommandEntry } from '../src/registry/RegistryBridge.js';
import {
  getEvidenceObjectivesForAoCommand,
  getEvidenceObjectivesForCommandId,
} from '../src/execution/EvidenceRegistry.js';
import { persistEvidenceArtifact } from '../src/execution/EvidenceEmitter.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(here, '..', 'src', 'registry', 'ao-commands.registry.json');
const OBJECTIVES_PATH = path.resolve(here, '..', '..', 'ces-shared', 'src', 'data', 'assessment-objectives.reference.json');

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as AoCommand[];
const objectiveControl = new Map<string, string>(
  (JSON.parse(fs.readFileSync(OBJECTIVES_PATH, 'utf8')) as { objectives: { objectiveId: string; controlId: string }[] })
    .objectives.map((o) => [o.objectiveId, o.controlId]),
);

describe('AO-1: registry evidence_objectives', () => {
  it('the registry has all 98 commands', () => {
    // FIN-22: 96 -> 97 (F-15, CES subnet egress baseline). PH-13 P13-LV: 97 -> 98 (A-22, leaver access termination).
    expect(registry).toHaveLength(98);
  });

  // FIN-14b (FD-3, QUESTIONS P-13): the 12 commands whose registered control did not match what
  // they do ("registry control mapping suspect", LOG-GC-AO-1.md) are re-aimed to the control
  // they serve, with objectives their own output shows. Pinned here so a later edit is a
  // deliberate, predicted scoring change (AR5). Table and reasons: LOG-FIN-22.md section 4.
  const REAIMED: Record<string, { from: string[]; to: string[]; objectives: string[] }> = {
    'A-09': { from: ['AC.L2-3.1.3'], to: ['AC.L2-3.1.5'], objectives: ['AC.L2-3.1.5[a]', 'AC.L2-3.1.5[b]'] },
    'A-16': { from: ['SI.L1-3.14.2'], to: ['SI.L2-3.14.6', 'IR.L2-3.6.1'], objectives: ['SI.L2-3.14.6[a]', 'IR.L2-3.6.1[c]', 'IR.L2-3.6.1[e]'] },
    'C-10': { from: ['SI.L1-3.14.2'], to: ['SI.L2-3.14.6', 'IR.L2-3.6.1'], objectives: ['SI.L2-3.14.6[a]', 'IR.L2-3.6.1[e]'] },
    'D-02': { from: ['SC.L2-3.13.6'], to: ['AC.L2-3.1.3'], objectives: ['AC.L2-3.1.3[b]', 'AC.L2-3.1.3[e]'] },
    'E-04': { from: ['SI.L1-3.14.4'], to: ['SI.L2-3.14.6'], objectives: ['SI.L2-3.14.6[a]'] },
    'E-05': { from: ['SI.L1-3.14.4'], to: ['SI.L2-3.14.6'], objectives: ['SI.L2-3.14.6[a]'] },
    'E-08': { from: ['SI.L1-3.14.2'], to: ['SI.L2-3.14.6', 'AU.L2-3.3.5'], objectives: ['SI.L2-3.14.6[a]', 'AU.L2-3.3.5[b]'] },
    'E-10': { from: ['CA.L2-3.12.4'], to: ['CA.L2-3.12.2'], objectives: ['CA.L2-3.12.2[c]'] },
    'F-03': { from: ['SI.L1-3.14.5'], to: ['SI.L1-3.14.2'], objectives: ['SI.L1-3.14.2[b]'] },
    'F-04': { from: ['IA.L1-3.5.1'], to: ['CM.L2-3.4.7'], objectives: ['CM.L2-3.4.7[l]'] },
    'G-07': { from: ['PS.L2-3.9.1'], to: ['SI.L2-3.14.7'], objectives: ['SI.L2-3.14.7[b]'] },
    'G-08': { from: ['AC.L2-3.1.3'], to: ['AC.L1-3.1.1'], objectives: ['AC.L1-3.1.1[a]'] },
  };

  it('every command names at least one objective (FIN-14b closed the 12 suspect mappings)', () => {
    const missing = registry.filter((c) => !Array.isArray(c.evidence_objectives) || c.evidence_objectives.length === 0).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('FIN-14b: the 12 re-aimed commands carry exactly the pinned controls and objectives', () => {
    expect(Object.keys(REAIMED)).toHaveLength(12);
    for (const [id, r] of Object.entries(REAIMED)) {
      const c = registry.find((x) => x.id === id)!;
      expect(c.cmmcPractices, id).toEqual(r.to);
      expect(c.evidence_objectives, id).toEqual(r.objectives);
      expect(r.to, id).not.toEqual(r.from);
    }
  });

  it('every objective id resolves in assessment-objectives.reference.json', () => {
    const unresolved = registry.flatMap((c) => (c.evidence_objectives ?? []).filter((id) => !objectiveControl.has(id)).map((id) => `${c.id}: ${id}`));
    expect(unresolved).toEqual([]);
  });

  it("every objective id belongs to one of the command's controls", () => {
    const foreign = registry.flatMap((c) =>
      (c.evidence_objectives ?? [])
        .filter((id) => !c.cmmcPractices.includes(objectiveControl.get(id) ?? ''))
        .map((id) => `${c.id}: ${id} (control ${objectiveControl.get(id)}; command has ${c.cmmcPractices.join(', ')})`),
    );
    expect(foreign).toEqual([]);
  });

  it('no command lists an objective twice', () => {
    const dup = registry.filter((c) => new Set(c.evidence_objectives).size !== (c.evidence_objectives ?? []).length).map((c) => c.id);
    expect(dup).toEqual([]);
  });

  it('EvidenceRegistry and RegistryBridge read the entry field (not a per-domain default)', () => {
    for (const c of registry) {
      expect(getEvidenceObjectivesForAoCommand(c)).toEqual(c.evidence_objectives);
      expect(getEvidenceObjectivesForCommandId(c.id)).toEqual(c.evidence_objectives);
      expect(translateAoCommandToCommandEntry(c).evidence_objectives).toEqual(c.evidence_objectives);
    }
    expect(getEvidenceObjectivesForCommandId('NOT-A-COMMAND')).toEqual([]);
  });
});

describe('AO-1: the persisted evidence row carries the objective ids', () => {
  let root: string;
  const env0 = { ...process.env };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-objectives-'));
    process.env.CES_PIPELINE_ROOT = root;
    delete process.env.CES_CONFIG_PATH;
  });
  afterEach(() => {
    closeAllCesRepositories();
    for (const k of ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH'] as const) {
      if (env0[k] === undefined) delete process.env[k];
      else process.env[k] = env0[k];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('data.evidenceObjectives = the command registry entry; the contract row is unchanged', async () => {
    const a01 = registry.find((c) => c.id === 'A-01')!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evidence: any = {
      rawResponse: '{}',
      outcome: 'automated_success',
      outcomeRationale: 'ok',
      complianceVerdict: 'SAT',
      metadata: {
        controlIds: a01.cmmcPractices,
        timestamp: '2026-10-30T00:00:00.000Z',
        executorIdentity: 'cse-ao-service',
        commandExecuted: 'Get-Thing',
        sha256Hash: 'abc123',
        mode: 'live',
        dryRun: false,
      },
    };
    await persistEvidenceArtifact(evidence, { commandId: 'A-01', tenantId: 'guid-obj', executionId: 'exec-1', domain: 'A' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = getCesRepository().get('adminops_evidence', 'A-01:exec-1', { tenantId: 'guid-obj' })?.data;
    expect(data.evidenceObjectives).toEqual(a01.evidence_objectives);
    expect(data.metadata.evidenceObjectives).toBeUndefined();

    // A non-registry command id carries no objectives key (pre-AO-1 envelope unchanged).
    await persistEvidenceArtifact(evidence, { commandId: 'NOT-A-COMMAND', tenantId: 'guid-obj', executionId: 'exec-2', domain: 'A' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const other: any = getCesRepository().get('adminops_evidence', 'NOT-A-COMMAND:exec-2', { tenantId: 'guid-obj' })?.data;
    expect(other).toBeTruthy();
    expect('evidenceObjectives' in other).toBe(false);
  });
});
