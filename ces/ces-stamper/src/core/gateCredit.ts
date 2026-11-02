// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W8-STX (4), moved here from `src/server/routes/execute.routes.ts` (W9 C1, FG-6 follow-up): the
 * controls a manual gate credits are its gate entries' control_ids ∩ task.controls. When no entry
 * carries control_ids (the translator's own `validate-manual-*` gate), all of task.controls.
 */
export function gateCreditedControls(
  taskControls: string[] | undefined,
  gateEntries: Array<{ control_ids?: string[] }>,
): string[] {
  const controls = taskControls || [];
  if (!gateEntries.some(e => Array.isArray(e.control_ids))) return [...controls];
  const entryIds = new Set(gateEntries.flatMap(e => e.control_ids ?? []));
  return controls.filter(cid => entryIds.has(cid));
}

/**
 * W9 FG-6 + founder decision D-5 (2026-10-31): the controls a task's result (credit, provisional
 * or failure) is recorded against. A `manual_gate` task uses `gateCreditedControls` over its
 * `_sub_commands` entries, so a REJECTED gate counts its failure only against its own entries'
 * controls, the same set it would credit. Any other task: all of task.controls.
 */
export function gateResultControls(task: {
  controls?: string[];
  action?: { engine?: string; args?: Record<string, unknown> };
}): string[] {
  if (task.action?.engine !== 'manual_gate') return task.controls ?? [];
  const entries = (task.action.args?._sub_commands as Array<{ control_ids?: string[] }> | undefined) ?? [];
  return gateCreditedControls(task.controls, entries);
}
