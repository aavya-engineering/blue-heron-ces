// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// P1.3c: the translator orders capture producers before their consumers.
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { orderByCaptureDependencies, CAPTURE_DEPENDENCY_CYCLE_PREFIX } from '../../src/translators/captureDependencies';
import { PlanTranslator, UNRESOLVED_RUNTIME_VARIABLE_PREFIX } from '../../src/translators/PlanTranslator';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import type { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sub(id: string, runtime: string[], captures: string[] = [], required: string[] = []): SubCommand {
  return {
    id, label: id, set_command: '', get_command: 'Get-Thing | ConvertTo-Json', engine: 'mgraph', sequence_hint: 0,
    idempotency: 'evidence-only', variables_required: required, variables_runtime: runtime,
    captures: captures.map(v => ({ variable: v, from: 'json_field' as const, json_path: '$.Id' })),
    on_failure: 'warn_continue', evidence_commands: [],
  };
}

function task(id: string, subs: SubCommand[], depends_on: string[] = []): ExeTask {
  return {
    id, type: 'configuration', priority: 'p1', depends_on,
    action: { engine: 'mgraph', command: 'x', args: { _sub_commands: subs } },
    inputs: [], outputs: [], controls: [], idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

function plan(tasks: ExeTask[], variables: Record<string, unknown> = {}): any {
  return { plan_id: 'p', target_level: 'L2', tech_stack_id: 1, execution_graph: tasks, variables, prechecks: [], postchecks: [] };
}

describe('P1.3c capture-dependency ordering', () => {
  it('a consumer listed first ends up after its producer, with a depends_on edge', () => {
    const p = plan([
      task('consumer', [sub('AC.L2-3.1.11.session-timeout', ['cuiGroupId'])]),
      task('producer', [sub('AC.L2-3.1.1.group-create', [], ['cuiGroupId'])]),
    ]);
    const warnings = orderByCaptureDependencies(p);
    expect(p.execution_graph.map((t: ExeTask) => t.id)).toEqual(['producer', 'consumer']);
    expect(p.execution_graph[1].depends_on).toEqual(['producer']);
    expect(warnings.join('\n')).toContain('consumer now depends on producer for cuiGroupId');
  });

  it('adds no edge when a plan variable already supplies the value, and keeps existing edges', () => {
    const p = plan([
      task('consumer', [sub('c', ['cuiGroupId'])], ['other']),
      task('other', [sub('o', [])]),
      task('producer', [sub('g', [], ['cuiGroupId'])]),
    ], { cuiGroupId: 'group-1' });
    orderByCaptureDependencies(p);
    const consumer = p.execution_graph.find((t: ExeTask) => t.id === 'consumer');
    expect(consumer.depends_on).toEqual(['other']);
  });

  it('reports a cycle instead of adding the edge', () => {
    const p = plan([
      task('a', [sub('a1', ['y'], ['x'])], ['b']),
      task('b', [sub('b1', ['x'], ['y'])]),
    ]);
    const warnings = orderByCaptureDependencies(p);
    expect(warnings.some(w => w.startsWith(CAPTURE_DEPENDENCY_CYCLE_PREFIX))).toBe(true);
  });

  it('a variable with no producer still warns UNRESOLVED_RUNTIME_VARIABLE', () => {
    const p = plan([task('consumer', [sub('CM.L2-3.4.1.security-baseline', ['baselineTemplateId'])])]);
    const result = { plan: p, layerSummary: {}, warnings: orderByCaptureDependencies(p), variableMergeReport: {} };
    (new PlanTranslator() as any).appendUnresolvedVariableWarnings(result);
    expect(result.warnings).toContain(`${UNRESOLVED_RUNTIME_VARIABLE_PREFIX} baselineTemplateId (required by CM.L2-3.4.1.security-baseline, task consumer)`);
  });

  it('the registry has a GET-only lookup that captures breakGlassUserId from breakGlassUPN', () => {
    const reg = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'));
    const e = reg.allEntries.find(x => x.entry_id === 'AC.L2-3.1.1.breakglass-discover')!;
    expect(e.set_command).toBe('');
    expect(e.variables_required).toEqual(['breakGlassUPN']);
    expect(e.captures.map(c => c.variable)).toEqual(['breakGlassUserId']);
  });
});
