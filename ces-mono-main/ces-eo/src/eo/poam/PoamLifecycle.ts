// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PoamLifecycle — objective-level POA&M with a real lifecycle (G-EUT-5 "auto-remove when remediated").
//
// The legacy PoamGenerator rebuilds a fresh POA&M from the assessment snapshot every run with a
// random itemId, so it can never auto-close: nothing links this run's item to last run's. This
// module reconciles the DeterminationLedger's deficiencies (which carry STABLE keys = objectiveId)
// against the previously persisted POA&M ledger, so a deficiency:
//   * new this run              -> OPEN a tracked item
//   * still deficient           -> CARRY the same item forward (id, openedAt, history preserved)
//   * no longer a deficiency    -> AUTO-CLOSE (closedAt + audit event), dropped from the active list
//   * previously closed, back   -> REOPEN (audit event)
//
// Auto-close is inherently source-aware: a deficiency only leaves the ledger when its OWNING source
// says met — a digital control when its signal/AO-remediation/suite-probe flips, a manual control
// only when its readiness store attests completion. So a manual item never auto-closes on a guess.
//
// This is ADDITIVE: it does not modify PoamGenerator or the practice-level PlanOfActionMilestones.

import type { Deficiency } from '../assessment/DeterminationLedger.js';

export type PoamItemStatus = 'open' | 'closed';
export type PoamLifecycleEvent = 'opened' | 'reopened' | 'auto-closed';

export interface PoamHistoryEntry {
  at: string;                       // ISO
  event: PoamLifecycleEvent;
  note?: string;
}

export interface PoamLedgerItem {
  key: string;                      // stable reconciliation key = objectiveId
  objectiveId: string;
  controlId: string;
  statement: string;
  weight: number;
  noPoam: boolean;                  // 5-point => certification blocker (cannot go on a POA&M)
  status: PoamItemStatus;
  openedAt: string;
  closedAt?: string;
  lastSeenAt: string;               // last reconciliation where this was still a deficiency
  source: string;                   // provenance from the ledger (which source evidences it)
  history: PoamHistoryEntry[];
}

export interface PoamLedger {
  poamId: string;
  tenantId: string;
  generatedAt: string;
  items: PoamLedgerItem[];          // ALL items ever tracked (open + closed) — the audit trail
  summary: {
    open: number;                   // currently-deficient, POA&M-eligible (weight < 5)
    certificationBlockers: number;  // currently-deficient, weight >= 5 (cannot POA&M)
    closed: number;                 // total closed (remediated) over the tenant's history
    newThisRun: number;
    closedThisRun: number;
    carriedForward: number;
    reopenedThisRun: number;
  };
}

/**
 * Reconcile the current ledger deficiencies against the previously persisted POA&M ledger.
 * Pure and deterministic — `now` and `poamId` are passed in (no Date.now()/uuid inside).
 */
export function reconcilePoamLifecycle(
  previous: PoamLedger | null,
  deficiencies: Deficiency[],
  now: string,
  poamId: string,
  tenantId: string,
): PoamLedger {
  const prevByKey = new Map<string, PoamLedgerItem>();
  for (const it of previous?.items ?? []) prevByKey.set(it.key, it);

  const currentKeys = new Set(deficiencies.map(d => d.key));
  const items: PoamLedgerItem[] = [];
  let newThisRun = 0, closedThisRun = 0, carriedForward = 0, reopenedThisRun = 0;

  // 1) walk current deficiencies -> open / carry / reopen
  for (const d of deficiencies) {
    const prev = prevByKey.get(d.key);
    if (prev && prev.status === 'open') {
      carriedForward++;
      items.push({ ...prev, lastSeenAt: now, weight: d.weight, noPoam: d.noPoam, source: d.source, statement: d.statement, controlId: d.controlId });
    } else if (prev && prev.status === 'closed') {
      reopenedThisRun++;
      items.push({
        ...prev, status: 'open', openedAt: now, closedAt: undefined, lastSeenAt: now,
        weight: d.weight, noPoam: d.noPoam, source: d.source, statement: d.statement, controlId: d.controlId,
        history: [...prev.history, { at: now, event: 'reopened', note: 'deficiency recurred after remediation' }],
      });
    } else {
      newThisRun++;
      items.push({
        key: d.key, objectiveId: d.objectiveId, controlId: d.controlId, statement: d.statement,
        weight: d.weight, noPoam: d.noPoam, status: 'open', openedAt: now, lastSeenAt: now, source: d.source,
        history: [{ at: now, event: 'opened' }],
      });
    }
  }

  // 2) prior items no longer deficient -> auto-close (or retain if already closed)
  for (const prev of previous?.items ?? []) {
    if (currentKeys.has(prev.key)) continue;   // handled above
    if (prev.status === 'open') {
      closedThisRun++;
      items.push({
        ...prev, status: 'closed', closedAt: now,
        history: [...prev.history, { at: now, event: 'auto-closed', note: 'remediated — no longer a deficiency in the ledger' }],
      });
    } else {
      items.push(prev);   // already closed — retain for the audit trail
    }
  }

  items.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));

  const open = items.filter(i => i.status === 'open' && !i.noPoam).length;
  const certificationBlockers = items.filter(i => i.status === 'open' && i.noPoam).length;
  const closed = items.filter(i => i.status === 'closed').length;

  return {
    poamId, tenantId, generatedAt: now, items,
    summary: { open, certificationBlockers, closed, newThisRun, closedThisRun, carriedForward, reopenedThisRun },
  };
}
