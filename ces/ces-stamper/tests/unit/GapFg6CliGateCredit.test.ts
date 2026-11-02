// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W9 FG-6: the CLI credits a manual gate only to its own entries' controls, the same rule as the
// server route (gateCreditedControls). Other tasks keep their controls.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import { cliResultsTasks } from '../../src/cli/cliExecutionContext';
import { gateCreditedControls } from '../../src/core/gateCredit';
import { recordTaskStatuses } from '../../src/core/ExecutionResultsPublisher';
import { ExecutionResultsCollector, ResultVerdict } from '../../src/core/ExecutionResultsCollector';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type T = { id: string; controls?: string[]; action?: { engine?: string; args?: Record<string, unknown> } };

const gateWithEntries: T = {
  id: 'gate-entries', controls: ['A', 'B'],
  action: { engine: 'manual_gate', args: { _sub_commands: [{ id: 'e1', control_ids: ['A'] }] } },
};
const gateNoIds: T = {
  id: 'validate-manual-1', controls: ['C', 'D'],
  action: { engine: 'manual_gate', args: { _sub_commands: [{ id: 'validate-manual-1' }] } },
};
const automated: T = {
  id: 'ps-1', controls: ['B', 'E'],
  action: { engine: 'powershell', args: { _sub_commands: [{ id: 'p1', control_ids: ['E'] }] } },
};

describe('W9 FG-6 CLI manual-gate crediting', () => {
  it('a manual gate keeps only its entries\' control_ids, same as the server helper', () => {
    const [g] = cliResultsTasks([gateWithEntries]);
    expect(g.controls).toEqual(['A']);
    expect(g.controls).toEqual(gateCreditedControls(gateWithEntries.controls, [{ control_ids: ['A'] }]));
  });

  it('a gate whose entries carry no control_ids keeps all of task.controls', () => {
    expect(cliResultsTasks([gateNoIds])[0].controls).toEqual(['C', 'D']);
  });

  it('non-gate tasks are passed through unchanged (entry control_ids ignored)', () => {
    expect(cliResultsTasks([automated])[0]).toBe(automated);
  });

  it('a gate with no _sub_commands keeps all of task.controls', () => {
    const t: T = { id: 'g', controls: ['X'], action: { engine: 'manual_gate', args: {} } };
    expect(cliResultsTasks([t])[0].controls).toEqual(['X']);
  });

  it('recorded results: B is not credited by the gate, only by its own automated task', () => {
    const c = new ExecutionResultsCollector();
    const recorded: Array<[string, string, string]> = [];
    const spy = jest.spyOn(c, 'recordControlResult').mockImplementation(((cid: string, _d: string, v: string, o: string) => { recorded.push([cid, v, o]); }) as any);
    // gate approved, B appears only via the gate: B must not be recorded at all.
    recordTaskStatuses(c, cliResultsTasks([gateWithEntries, gateNoIds]), () => 'completed', {}, () => false);
    expect(recorded.map(r => r[0]).sort()).toEqual(['A', 'C', 'D']);
    expect(recorded.every(r => r[1] === ResultVerdict.SAT)).toBe(true);
    // gate with no action (auto): A is PROVISIONAL, B still not recorded from the gate; B SAT from ps-1.
    recorded.length = 0;
    recordTaskStatuses(c, cliResultsTasks([gateWithEntries, automated]), () => 'completed', {}, (id) => id === 'gate-entries');
    expect(recorded).toEqual(expect.arrayContaining([
      ['A', ResultVerdict.PROVISIONAL, 'manual_gate_pending'],
      ['B', ResultVerdict.SAT, 'completed'],
      ['E', ResultVerdict.SAT, 'completed'],
    ]));
    expect(recorded).toHaveLength(3);
    spy.mockRestore();
  });

  it('publishCliResults feeds recordTaskStatuses through cliResultsTasks', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/cli/index.ts'), 'utf8');
    expect(src).toMatch(/recordTaskStatuses\(\s*collector,[\s\S]{0,200}?cliResultsTasks\(plan\.execution_graph\)/s);
    expect(src).not.toMatch(/recordTaskStatuses\(\s*collector,\s*plan\.execution_graph/);
  });
});
