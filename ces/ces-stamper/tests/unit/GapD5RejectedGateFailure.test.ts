// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W9 C1 D-5: a REJECTED manual gate counts its failure only against its own entries' controls
// (same set as its credit), on the CLI and the server path, through one src/core helper.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import { gateResultControls } from '../../src/core/gateCredit';
import { cliResultsTasks } from '../../src/cli/cliExecutionContext';
import { recordTaskStatuses } from '../../src/core/ExecutionResultsPublisher';
import { ExecutionResultsCollector, ResultVerdict } from '../../src/core/ExecutionResultsCollector';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../../src');

const gate = {
  id: 'gate', controls: ['A', 'B'],
  action: { engine: 'manual_gate', args: { _sub_commands: [{ id: 'e1', control_ids: ['A'] }] } },
};
const automated = { id: 'ps-1', controls: ['B'], action: { engine: 'powershell', args: {} } };

describe('W9 C1 D-5 rejected-gate failure narrowing', () => {
  it('gateResultControls narrows a gate and leaves other tasks whole', () => {
    expect(gateResultControls(gate)).toEqual(['A']);
    expect(gateResultControls(automated)).toEqual(['B']);
    expect(gateResultControls({ controls: ['X'], action: { engine: 'manual_gate', args: {} } })).toEqual(['X']);
    expect(gateResultControls({})).toEqual([]);
  });

  it('CLI: a rejected (failed) gate is NOT_SAT only for its entry control; B stays SAT from its own task', () => {
    const c = new ExecutionResultsCollector();
    const recorded: Array<[string, string, string]> = [];
    const spy = jest.spyOn(c, 'recordControlResult').mockImplementation(((cid: string, _d: string, v: string, o: string) => { recorded.push([cid, v, o]); }) as any);
    recordTaskStatuses(c, cliResultsTasks([gate, automated]), (id) => (id === 'gate' ? 'failed' : 'completed'), {}, () => false);
    expect(recorded).toEqual(expect.arrayContaining([
      ['A', ResultVerdict.NOT_SAT, 'failed'],
      ['B', ResultVerdict.SAT, 'completed'],
    ]));
    expect(recorded).toHaveLength(2);
    spy.mockRestore();
  });

  it('server: the failure block records NOT_SAT through gateResultControls', () => {
    const src = fs.readFileSync(path.join(SRC, 'server/routes/execute.routes.ts'), 'utf8');
    expect(src).toMatch(/for \(const cid of gateResultControls\(task\)\) \{\s*resultsCollector\.recordControlResult\(cid, [^)]*ResultVerdict\.NOT_SAT, 'failed'\)/);
    expect(src).not.toMatch(/export function gateCreditedControls/);
  });

  it('no file under src/cli imports a server route module (import cycle removed)', () => {
    const dir = path.join(SRC, 'cli');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/from '\.\.\/server\/routes\//);
    }
  });
});
