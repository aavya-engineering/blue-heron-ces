// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH-13 P13-LV: AdminOps leaver-flow escalations become EO findings.
 *
 * AdminOps' leaver flow (ces-ao src/leaver/, founder decision 2026-11-01 for PS.L2-3.9.2[b]) asks the tenant's
 * administrators to confirm a leaver before it ends their access. When nobody confirms in the window, or the
 * termination fails, AO records an escalation in ITS OWN ces.db collection `adminops_leaver_escalations`
 * (AD-1 tool boundary: AO never writes EO's store). On every collection-scheduler tick EO reads the tenant's
 * escalations (read only) and records each one once as an EO finding (write-once collection
 * `eo_leaver_findings`), with a notice naming the open POA&M items of PS.L2-3.9.2.
 *
 * Effect: reported only. A leaver finding changes no control status, SPRS score or POA&M item by itself
 * (AR5 = none); PS.L2-3.9.2's status stays the assessment's. The finding says an account that should have been
 * closed is still open, and who must act. EO never changes the tenant.
 */
import { getCesRepository } from 'ces-shared/persistence/node';

/** AO's collection (ces-ao src/leaver/leaverStore.ts LEAVER_COLLECTIONS.escalations). Read only here. */
export const AO_LEAVER_ESCALATIONS = 'adminops_leaver_escalations';
export const EO_LEAVER_FINDINGS = 'eo_leaver_findings';
export const LEAVER_FINDING_CODE = 'LEAVER_UNCONFIRMED';

/** The fields EO reads from an AO escalation (ces-ao LeaverEscalation, schema ces-ao/leaver-escalation@1). */
export interface AoLeaverEscalationLike {
  escalationId: string;
  flowId: string;
  tenantSlug: string;
  tenantId?: string;
  leaverUpn: string;
  controlId: string;
  objectiveId: string;
  reason: string;
  detail?: string;
  confirmBy?: string;
  raisedAt: string;
}

export interface EoLeaverFinding {
  schema: 'ces-eo/leaver-finding@1';
  findingId: string;
  code: typeof LEAVER_FINDING_CODE | 'LEAVER_TERMINATION_FAILED';
  source: 'ces-ao';
  aoEscalationId: string;
  aoFlowId: string;
  tenantSlug: string;
  tenantId: string | null;
  controlId: string;
  objectiveId: string;
  leaverUpn: string;
  detail: string;
  aoRaisedAt: string;
  recordedAt: string;
  effect: string;
  action: string;
}

export const LEAVER_EFFECT = 'reported only: no control status, SPRS score or POA&M item changes by itself';
export const LEAVER_ACTION = 'tenant administrator: confirm or decline the leaver through the AdminOps confirm link (or AdminOps /api/leaver), or end the access by hand; EO changes nothing';

function rowId(tenantSlug: string, escalationId: string): string {
  return `${tenantSlug}|${escalationId}`;
}

/** AO's escalations for one tenant (read only); an absent collection is an empty list. */
export function readAoLeaverEscalations(tenantSlug: string, dbPath?: string): AoLeaverEscalationLike[] {
  return getCesRepository(dbPath).list<AoLeaverEscalationLike>(AO_LEAVER_ESCALATIONS, { tenantSlug }).map((r) => r.data);
}

/** Record each of this tenant's escalations once. Returns only the findings recorded now (write-once). */
export function recordLeaverFindings(
  escalations: readonly AoLeaverEscalationLike[],
  scope: { tenantSlug: string; tenantId: string | null },
  nowIso: string,
  dbPath?: string,
): EoLeaverFinding[] {
  const repo = getCesRepository(dbPath);
  const fresh: EoLeaverFinding[] = [];
  for (const e of escalations) {
    if (!e || e.tenantSlug !== scope.tenantSlug || typeof e.escalationId !== 'string') continue;
    const id = rowId(scope.tenantSlug, e.escalationId);
    if (repo.get(EO_LEAVER_FINDINGS, id, { tenantSlug: scope.tenantSlug })) continue;
    const row: EoLeaverFinding = {
      schema: 'ces-eo/leaver-finding@1',
      findingId: `eolf-${e.escalationId}`,
      code: e.reason === 'execution_failed' ? 'LEAVER_TERMINATION_FAILED' : LEAVER_FINDING_CODE,
      source: 'ces-ao',
      aoEscalationId: e.escalationId,
      aoFlowId: e.flowId,
      tenantSlug: scope.tenantSlug,
      tenantId: scope.tenantId ?? e.tenantId ?? null,
      controlId: e.controlId,
      objectiveId: e.objectiveId,
      leaverUpn: e.leaverUpn,
      detail: e.detail ?? e.reason,
      aoRaisedAt: e.raisedAt,
      recordedAt: nowIso,
      effect: LEAVER_EFFECT,
      action: LEAVER_ACTION,
    };
    repo.put(EO_LEAVER_FINDINGS, { id, ces: { tenantSlug: scope.tenantSlug, ...(row.tenantId ? { tenantId: row.tenantId } : {}) }, data: row });
    fresh.push(row);
  }
  return fresh;
}

/** The tenant's EO leaver findings, oldest first. */
export function listLeaverFindings(tenantSlug: string, dbPath?: string): EoLeaverFinding[] {
  return getCesRepository(dbPath).list<EoLeaverFinding>(EO_LEAVER_FINDINGS, { tenantSlug }).map((r) => r.data);
}
