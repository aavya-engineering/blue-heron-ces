// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Depth plan (DEPTH-REPORT-AND-PLAN.md §4) steps the directive-mode translator applies after it has built
 * its tasks:
 *  - DEPTH-3 creditByObjective: a task's controls[] are its step's own controls; every registry entry runs
 *    once per plan, in a task that runs it (not a manual gate), preferring the task of its primary control
 *    (control_ids[0]) and the copy that keeps its SET; the objectives it
 *    names outside that task's controls are written as credits[] on that task. A task left with no
 *    sub-command is not planned (it would otherwise run its action.command, the deduplicated SET, again).
 *  - DEPTH-5 refuseImplementWithoutConfiguration: an implement task with no sub-command is not planned; an
 *    implement task whose sub-commands are all reads is planned as `validate` (or `manual` when its engine
 *    is a manual gate); action.command becomes a summary of the sub-commands, never prose or a comment.
 *  - DEPTH-6 buildObjectiveCoverage: one coverage record per assessment objective (warn mode).
 */
import { createRequire } from 'node:module';
import * as fs from 'fs';
import type { ExeTask, SubCommand, ObjectiveCoverage, Check } from '../types/schema.types.js';
import type { CommandEntry } from '../registry/command-registry.types.js';

const _require = createRequire(import.meta.url);

export interface ObjectiveRef { objectiveId: string; controlId: string; description: string }

let objectivesCache: ObjectiveRef[] | null = null;
/** ces-shared assessment-objectives.reference.json (320 objectives of the 110 practices). */
export function loadObjectives(): ObjectiveRef[] {
  if (!objectivesCache) {
    const file = _require.resolve('ces-shared/data/assessment-objectives');
    objectivesCache = (JSON.parse(fs.readFileSync(file, 'utf-8')).objectives ?? []) as ObjectiveRef[];
  }
  return objectivesCache;
}

let documentOnlyCache: Map<string, string[]> | null = null;
/**
 * KB-1 (ces-shared assessor-evidence-matrix.reference.json): the objectives no tenant read or Stamper record
 * can evidence (no `stack_signal` or `stamper_evidence` row), with the CES sources that do (EC upload,
 * EO store, AdminOps row, interview). They are met by documents through EO's review route, not by a SET.
 */
export function loadDocumentOnlyObjectives(): Map<string, string[]> {
  if (!documentOnlyCache) {
    const file = _require.resolve('ces-shared/data/assessor-evidence-matrix');
    const rows = (JSON.parse(fs.readFileSync(file, 'utf-8')).objectives ?? []) as Array<{ id: string; evidence?: Array<{ ces_source?: string }> }>;
    documentOnlyCache = new Map();
    for (const r of rows) {
      const sources = [...new Set((r.evidence ?? []).map(e => String(e.ces_source ?? '')).filter(Boolean))];
      if (sources.length > 0 && !sources.includes('stack_signal') && !sources.includes('stamper_evidence')) documentOnlyCache.set(r.id, sources);
    }
  }
  return documentOnlyCache;
}

/** 'AC.L1-3.1.1[d]' -> 'AC.L1-3.1.1'. */
export const controlOfObjective = (objectiveId: string): string => {
  const i = objectiveId.indexOf('[');
  return i < 0 ? objectiveId : objectiveId.slice(0, i);
};

const subsOf = (t: ExeTask): SubCommand[] => (Array.isArray(t.action.args._sub_commands) ? t.action.args._sub_commands as SubCommand[] : []);
const isWrite = (s: SubCommand): boolean => typeof s.set_command === 'string' && s.set_command.trim() !== '';
/** A Conditional Access write left in report-only mode configures nothing it enforces (DEPTH-5). */
export const isReportOnlyWrite = (s: SubCommand): boolean => isWrite(s) && /enabledForReportingButNotEnforced/.test(s.set_command);

export interface CreditResult {
  tasks: ExeTask[];
  /** Controls that receive an objective credit from an entry another task runs. */
  creditedControls: Set<string>;
}

/**
 * DEPTH-3. `tasks` must be in execution order (the copy kept is chosen in this order). Sub-commands whose
 * id is not a registry entry (manual / nonstack / inheritance pseudo-entries) are never moved.
 */
export function creditByObjective(tasks: ExeTask[], entryById: ReadonlyMap<string, CommandEntry>, warnings: string[]): CreditResult {
  const copies = new Map<string, Array<{ task: ExeTask; sub: SubCommand }>>();
  for (const task of tasks) {
    for (const sub of subsOf(task)) {
      if (!entryById.has(sub.id)) continue;
      const list = copies.get(sub.id) ?? [];
      list.push({ task, sub });
      copies.set(sub.id, list);
    }
  }

  const keep = new Map<string, ExeTask>();
  for (const [entryId, list] of copies) {
    const primary = entryById.get(entryId)!.control_ids[0];
    const own = (c: { task: ExeTask }) => c.task.controls.includes(primary);
    // A manual gate does not run its sub-commands, so a copy in a running task is preferred.
    const runs = (c: { task: ExeTask }) => c.task.action.engine !== 'manual_gate';
    const chosen = list.find(c => runs(c) && own(c) && isWrite(c.sub)) ?? list.find(c => runs(c) && own(c))
      ?? list.find(c => runs(c) && isWrite(c.sub)) ?? list.find(runs)
      ?? list.find(own) ?? list[0];
    keep.set(entryId, chosen.task);
  }

  const lostTo = new Map<ExeTask, Set<ExeTask>>();
  for (const task of tasks) {
    const subs = subsOf(task);
    if (subs.length === 0) continue;
    const kept = subs.filter(s => {
      const home = keep.get(s.id);
      if (!home || home === task) return true;
      const homes = lostTo.get(task) ?? new Set<ExeTask>();
      homes.add(home);
      lostTo.set(task, homes);
      return false;
    });
    task.action.args._sub_commands = kept;
  }

  const creditedControls = new Set<string>();
  for (const task of tasks) {
    const credits: Array<{ objective_id: string; entry_id: string }> = [];
    for (const sub of subsOf(task)) {
      const entry = entryById.get(sub.id);
      if (!entry) continue;
      for (const oid of entry.objective_ids ?? []) {
        const c = controlOfObjective(oid);
        if (task.controls.includes(c)) continue;
        credits.push({ objective_id: oid, entry_id: entry.entry_id });
        creditedControls.add(c);
      }
    }
    if (credits.length > 0) task.credits = credits;
  }

  // A task that lost every sub-command to the task that now runs its entries is not planned.
  const dropped = new Set<ExeTask>();
  for (const task of tasks) {
    if (task.action.args._directive !== 'implement' || subsOf(task).length > 0 || !lostTo.has(task)) continue;
    dropped.add(task);
    const homes = [...lostTo.get(task)!].map(t => t.id).join(', ');
    const credited = task.controls.filter(c => creditedControls.has(c));
    warnings.push(`CREDIT_BY_OBJECTIVE: task ${task.id} (${task.controls.join(', ')}) not planned: its entries run once, in ${homes}${credited.length ? `; objective credit for ${credited.join(', ')} is in that task's credits[]` : '; no objective of this control is credited, so it falls to gap-fill'}`);
  }
  const survivors = tasks.filter(t => !dropped.has(t));
  const index = new Map(survivors.map((t, i) => [t, i]));
  for (const task of survivors) {
    // A task that keeps other sub-commands runs after the task that now creates the shared objects.
    for (const home of lostTo.get(task) ?? []) {
      if (!index.has(home) || index.get(home)! >= index.get(task)!) continue;
      if (!task.depends_on.includes(home.id)) task.depends_on.push(home.id);
    }
  }
  const ids = new Set(survivors.map(t => t.id));
  for (const task of survivors) task.depends_on = task.depends_on.filter(d => d !== task.id && ids.has(d));
  return { tasks: survivors, creditedControls };
}

/** DEPTH-5: action.command as a summary of the sub-commands. */
export function summarizeSubCommands(subs: SubCommand[]): string {
  return subs.map(s => `${s.id}: ${(isWrite(s) ? s.set_command : (s.get_command || s.label)).trim()}`).join(' | ');
}

/** DEPTH-5. Returns the tasks still planned. */
export function refuseImplementWithoutConfiguration(tasks: ExeTask[], entryById: ReadonlyMap<string, CommandEntry>, warnings: string[]): ExeTask[] {
  const out: ExeTask[] = [];
  for (const task of tasks) {
    const args = task.action.args;
    const subs = subsOf(task);
    if (args._directive !== 'implement') { out.push(task); continue; }
    if (subs.length === 0) {
      warnings.push(`IMPLEMENT_REFUSED: task ${task.id} (${task.controls.join(', ')}) not planned: no registry entry configures it (its command was "${String(task.action.command).slice(0, 60)}"); the control falls to gap-fill`);
      continue;
    }
    if (subs.some(s => entryById.has(s.id))) task.action.command = summarizeSubCommands(subs);
    if (!subs.some(isWrite)) {
      const asGate = task.action.engine === 'manual_gate';
      args._directive = asGate ? 'manual' : 'validate';
      if (!asGate) task.type = 'validate';
      args._implement_refused = `no configuring sub-command: ${subs.map(s => s.id).join(', ')} only read${subs.length === 1 ? 's' : ''}`;
      warnings.push(`IMPLEMENT_REFUSED: task ${task.id} (${task.controls.join(', ')}) planned as ${args._directive}: ${args._implement_refused}`);
    }
    out.push(task);
  }
  return out;
}

const DOCUMENT_DIRECTIVES = new Set(['document-renderable', 'document-prohibition', 'eo-tooled']);
const MANUAL_DIRECTIVES = new Set(['manual', 'nonstack', 'skip']);

/**
 * DEPTH-6 (warn mode): one record per objective of the 110 practices. configure = a planned SET entry (not report-only,
 * not manual-only) names the objective; otherwise the control's own task decides: inherit-fedramp ->
 * inherited, document-absence -> not_applicable, document-* / eo-tooled -> document, manual / nonstack or a
 * manual-gate engine -> manual; an objective KB-1 evidences only by documents (loadDocumentOnlyObjectives)
 * -> document; anything else -> uncovered (reads that only evidence it are listed).
 */
export function buildObjectiveCoverage(
  tasks: ExeTask[],
  entryById: ReadonlyMap<string, CommandEntry>,
  objectives: ObjectiveRef[] = loadObjectives(),
  documentOnly: ReadonlyMap<string, string[]> = loadDocumentOnlyObjectives(),
): ObjectiveCoverage[] {
  const writes = new Map<string, Set<string>>();
  const reads = new Map<string, Set<string>>();
  const taskOf = new Map<string, ExeTask>();
  for (const task of tasks) {
    for (const c of task.controls) if (!taskOf.has(c)) taskOf.set(c, task);
    for (const sub of subsOf(task)) {
      const entry = entryById.get(sub.id);
      if (!entry) continue;
      const target = isWrite(sub) && !entry.manual_only && !isReportOnlyWrite(sub) ? writes : reads;
      for (const oid of entry.objective_ids ?? []) target.set(oid, (target.get(oid) ?? new Set()).add(entry.entry_id));
    }
  }
  return objectives.map((o): ObjectiveCoverage => {
    const w = writes.get(o.objectiveId);
    if (w) return { objective_id: o.objectiveId, type: 'configure', entry_ids: [...w] };
    const task = taskOf.get(o.controlId);
    const directive = String(task?.action.args._directive ?? '');
    const justification = String(task?.action.args._justification ?? '').trim();
    if (task && directive === 'inherit-fedramp') {
      const pkg = task.action.args._fedramp_package_id ? ` (FedRAMP package ${task.action.args._fedramp_package_id})` : '';
      return { objective_id: o.objectiveId, type: 'inherited', task_id: task.id, basis: `${justification || 'FedRAMP High inheritance from the CSP'}${pkg}` };
    }
    if (task && directive === 'document-absence') {
      return { objective_id: o.objectiveId, type: 'not_applicable', task_id: task.id, basis: justification || 'Capability absent from the CUI boundary' };
    }
    if (task && DOCUMENT_DIRECTIVES.has(directive)) {
      return { objective_id: o.objectiveId, type: 'document', task_id: task.id, reason: `${directive}: EO document review` };
    }
    if (task && (MANUAL_DIRECTIVES.has(directive) || task.action.engine === 'manual_gate')) {
      return { objective_id: o.objectiveId, type: 'manual', task_id: task.id, reason: `manual gate ${task.id}` };
    }
    const docSources = documentOnly.get(o.objectiveId);
    if (docSources) {
      return { objective_id: o.objectiveId, type: 'document', ...(task ? { task_id: task.id } : {}), reason: `KB-1 evidences it by ${docSources.join(', ')} only: EO document review` };
    }
    const r = reads.get(o.objectiveId);
    return {
      objective_id: o.objectiveId,
      type: 'uncovered',
      ...(r ? { entry_ids: [...r] } : {}),
      ...(task ? { task_id: task.id } : {}),
      reason: r ? 'evidence-only or report-only: the planned entries name this objective but none configures and enforces it' : 'no planned entry names this objective',
    };
  });
}

/**
 * DEPTH-7 follow-up (LOG-DEPTH-78.md §6 A): a postcheck for a `configure` objective with no expected value takes
 * the configuring entry's registry verification (`verification.evidence.jsonpath` equals `equals`), source
 * 'registry'. An `equals` that still holds a {variable} is left alone (no value to compare yet).
 */
export function applyRegistryExpectedValues(postchecks: Check[], coverage: ObjectiveCoverage[], entryById: ReadonlyMap<string, CommandEntry>): number {
  const byObjective = new Map(coverage.filter(r => r.type === 'configure').map(r => [r.objective_id, r.entry_ids ?? []]));
  let n = 0;
  for (const pc of postchecks) {
    if (!pc.objective_id || pc.expected_value) continue;
    for (const id of byObjective.get(pc.objective_id) ?? []) {
      const ev = entryById.get(id)?.verification?.evidence as { jsonpath?: unknown; equals?: unknown; max?: unknown } | undefined;
      if (typeof ev?.jsonpath !== 'string' || !ev.jsonpath) continue;
      if (ev.equals !== undefined && !/\{[A-Za-z_]\w*\}/.test(String(ev.equals))) {
        pc.expected_value = { path: ev.jsonpath, op: 'equals', value: ev.equals, source: 'registry' };
      } else if (ev.equals === undefined && typeof ev.max === 'number') {
        // PH-13 (LOG-PH13-REG STOP-2, R2 O-1): a range check (min..max): the postcheck holds the upper bound,
        // the strictest value every compliant read meets (AC.L2-3.1.10.screen-lock: lte 15).
        pc.expected_value = { path: ev.jsonpath, op: 'lte', value: ev.max, source: 'registry' };
      } else continue;
      // PH-11 (V97, LOG-PH11-REG.md §2 step 3): a state comparison runs on the config_export path; a manual
      // row would never read the state it now names (PostcheckRunner.dispatchCheck -> runManualGate).
      if (pc.method === 'manual') pc.method = 'config_export';
      n++;
      break;
    }
  }
  return n;
}
