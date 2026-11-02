// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * P1.3c: order the execution graph by capture dependency. When a task's sub-commands need a
 * variable that no plan variable supplies, and a sub-command in another task captures it,
 * the consumer gets a `depends_on` edge to the earliest such producer and the graph is
 * re-sorted producer-first. Existing edges are kept. An edge that would close a cycle is
 * not added; it is reported instead.
 */
import type { ExecutablePlan, ExeTask, SubCommand } from '../types/schema.types.js';
import { DependencyResolver } from '../core/DependencyResolver.js';
import { VARIABLE_DEFAULTS } from '../shared/variable-map.js';

export const CAPTURE_DEPENDENCY_PREFIX = 'CAPTURE_DEPENDENCY:';
export const CAPTURE_DEPENDENCY_CYCLE_PREFIX = 'CAPTURE_DEPENDENCY_CYCLE:';

function subsOf(task: ExeTask): SubCommand[] {
  return ((task.action.args?._sub_commands as SubCommand[] | undefined) ?? []);
}

/** True when `from` already reaches `to` through depends_on edges. */
function reaches(byId: Map<string, ExeTask>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of byId.get(id)?.depends_on ?? []) stack.push(dep);
  }
  return false;
}

/** Adds the edges, re-sorts plan.execution_graph in place, and returns warnings. */
export function orderByCaptureDependencies(plan: ExecutablePlan): string[] {
  const warnings: string[] = [];
  const graph = plan.execution_graph;
  const supplied = new Set<string>();
  for (const [k, v] of Object.entries({ ...VARIABLE_DEFAULTS, ...(plan.variables ?? {}) })) {
    if (v !== undefined && v !== null && v !== '') supplied.add(k);
  }

  // variable -> producing task ids, in graph order
  const producers = new Map<string, string[]>();
  for (const task of graph) {
    for (const sub of subsOf(task)) {
      for (const c of sub.captures ?? []) {
        const list = producers.get(c.variable) ?? [];
        if (!list.includes(task.id)) list.push(task.id);
        producers.set(c.variable, list);
      }
    }
  }

  const byId = new Map(graph.map(t => [t.id, t] as const));
  let added = 0;
  for (const task of graph) {
    const ownCaptures = new Set(subsOf(task).flatMap(s => (s.captures ?? []).map(c => c.variable)));
    const needed = new Set<string>();
    for (const sub of subsOf(task)) {
      for (const v of [...(sub.variables_runtime ?? []), ...(sub.variables_required ?? [])]) {
        if (!supplied.has(v) && !ownCaptures.has(v) && producers.has(v)) needed.add(v);
      }
    }
    for (const v of needed) {
      const candidates = producers.get(v)!.filter(id => id !== task.id);
      if (candidates.length === 0) continue;
      if (candidates.some(id => task.depends_on.includes(id))) continue;
      const producerId = candidates.find(id => !reaches(byId, id, task.id));
      if (!producerId) {
        warnings.push(`${CAPTURE_DEPENDENCY_CYCLE_PREFIX} ${task.id} needs ${v} from ${candidates.join(', ')}, but every producer already depends on it — edge not added`);
        continue;
      }
      task.depends_on.push(producerId);
      added++;
      warnings.push(`${CAPTURE_DEPENDENCY_PREFIX} ${task.id} now depends on ${producerId} for ${v}`);
    }
  }

  if (added > 0) {
    const sorted = new DependencyResolver(graph).topoSort(graph);
    if (sorted.length === graph.length) {
      plan.execution_graph = sorted;
    } else {
      warnings.push(`${CAPTURE_DEPENDENCY_CYCLE_PREFIX} the graph has a cycle; order left unchanged`);
    }
  }
  return warnings;
}

export const READ_AFTER_PREFIX = 'READ_AFTER:';

/**
 * PH-13 (P13-ST, founder Q3 2026-11-01: an empty successful read is never evidence). A sub-command whose registry
 * entry names `read_after` entry ids reads an object those entries create. Its task gets a `depends_on` edge to
 * each task holding such an entry and the graph is re-sorted creator-first, so the read is never empty by
 * ordering alone (LOG-PH13-REG STOP-3: SI.L1-3.14.4 ran before SI.L1-3.14.5 created the AV policy). A creator
 * that is not planned adds nothing; an edge that would close a cycle is not added and is reported.
 */
export function orderByReadAfter(plan: ExecutablePlan): string[] {
  const warnings: string[] = [];
  const graph = plan.execution_graph;
  const taskOfEntry = new Map<string, string>();
  for (const task of graph) for (const sub of subsOf(task)) if (!taskOfEntry.has(sub.id)) taskOfEntry.set(sub.id, task.id);
  const byId = new Map(graph.map(t => [t.id, t] as const));
  let added = 0;
  for (const task of graph) {
    for (const sub of subsOf(task)) {
      for (const creator of sub.read_after ?? []) {
        const creatorTask = taskOfEntry.get(creator);
        if (!creatorTask || creatorTask === task.id || task.depends_on.includes(creatorTask)) continue;
        if (reaches(byId, creatorTask, task.id)) {
          warnings.push(`${CAPTURE_DEPENDENCY_CYCLE_PREFIX} ${task.id} reads after ${creator} (${creatorTask}), but that task already depends on it — edge not added`);
          continue;
        }
        task.depends_on.push(creatorTask);
        added++;
        warnings.push(`${READ_AFTER_PREFIX} ${task.id} now depends on ${creatorTask}: ${sub.id} reads what ${creator} creates`);
      }
    }
  }
  if (added > 0) {
    const sorted = new DependencyResolver(graph).topoSort(graph);
    if (sorted.length === graph.length) plan.execution_graph = sorted;
    else warnings.push(`${CAPTURE_DEPENDENCY_CYCLE_PREFIX} the graph has a cycle; order left unchanged`);
  }
  return warnings;
}
