// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { isLiveExecution, type AdminOpsEvidence } from 'ces-shared/types/adminops-evidence';

/**
 * Production view mappers for AdminOps evidence rows (FX-EO1/2/5).
 *
 * The Explorer index, the Explorer item route and `/api/adminops/executions` all shape
 * rows through these functions, so tests exercise the exact production mapping instead
 * of re-implementing it.
 */

export interface AdminOpsEntry {
  rowId: string;
  evidence: AdminOpsEvidence;
}

export const ADMINOPS_PATH_PREFIX = 'adminops/';

export function isPreview(ev: AdminOpsEvidence): boolean {
  return ev.dryRun || ev.mode === 'dry_run' || ev.outcome === 'dry_run';
}

/** Explorer path for an AO row — carries the unique ces.db row id (FX-EO2). */
export function adminOpsItemPath(rowId: string): string {
  return ADMINOPS_PATH_PREFIX + rowId;
}

/** Inverse of adminOpsItemPath; null when the path is not an AO item path. */
export function parseAdminOpsItemPath(itemPath: string): string | null {
  if (!itemPath.startsWith(ADMINOPS_PATH_PREFIX)) return null;
  const rowId = itemPath.slice(ADMINOPS_PATH_PREFIX.length);
  return rowId.length > 0 ? rowId : null;
}

export function toExplorerItem(entry: AdminOpsEntry) {
  const ev = entry.evidence;
  return {
    id: 'adminops:' + entry.rowId,
    source: 'adminops',
    title: ev.commandId + (isPreview(ev) ? ' (preview)' : '') + ' — ' + ev.outcome,
    family: ev.controlIds[0]?.split('.')[0]?.replace(/L\d+-/, ''),
    controlIds: ev.controlIds,
    timestamp: ev.timestamp,
    verdict: ev.verdict || undefined,
    path: adminOpsItemPath(entry.rowId),
    requiresConnection: false,
  };
}

export function toExecutionView(entry: AdminOpsEntry) {
  const ev = entry.evidence;
  return {
    rowId: entry.rowId,
    commandId: ev.commandId,
    outcome: ev.outcome,
    mode: ev.mode,
    dryRun: ev.dryRun,
    controlIds: ev.controlIds,
    timestamp: ev.timestamp,
    verdict: ev.verdict,
    correlationId: ev.correlationId,
    label: isPreview(ev) ? 'preview' : ev.outcome,
  };
}

/**
 * FX-EO5: controls an AdminOps row may credit in the CRM — live + executed + SAT only
 * (denied, failed, dry-run, pending and legacy rows never credit). Used by SspGenerator.
 */
export function liveSatAdminOpsControls(parsed: readonly AdminOpsEvidence[]): Set<string> {
  return new Set(
    parsed
      .filter(ev => isLiveExecution(ev) && ev.verdict === 'SAT')
      .flatMap(ev => ev.controlIds),
  );
}

/**
 * FX-EO5: controls that get AdminOps CRM credit — an AdminOps knowledge bank exists for the
 * control AND a live SAT AdminOps row evidences it. Used by SspGenerator.
 */
export function adminOpsCrmCreditedControls(
  controlIds: readonly string[],
  liveAoControls: ReadonlySet<string>,
  hasAdminOpsKnowledgeBank: (controlId: string) => boolean,
): Set<string> {
  const out = new Set<string>();
  for (const id of controlIds) {
    if (hasAdminOpsKnowledgeBank(id) && liveAoControls.has(id)) out.add(id);
  }
  return out;
}

/** FX-EO5: how one AdminOps row is written into the evidence package (used by EvidencePackager). */
export function packageAdminOpsRow(ev: AdminOpsEvidence): { fileName: string; json: string; label: string } {
  const label = isPreview(ev) ? 'preview' : ev.outcome;
  return {
    fileName: `${ev.commandId}-${ev.timestamp.replace(/[:.]/g, '-')}.json`,
    json: JSON.stringify({ ...ev, label }, null, 2),
    label,
  };
}
