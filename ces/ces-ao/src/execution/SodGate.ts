// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 8: SOD Gate
// Detects Tier 3 commands requiring manual approval gates

import type { AoCommand } from '../types/AoCommand.js';
import type { CommandEntry } from 'ces-shared/types/registry';
import {
  isSamePerson,
  SodViolationError,
  type ApprovalRequest,
} from './ApprovalStore.js';
import { assertApprovalValidForExecution } from './ManualGateAdapter.js';

/**
 * Tenant posture consulted by the M4 additive floor. Optional — callers without
 * tenant context (listing/inspection paths) get the static-tier behavior only.
 */
export interface SodTenantContext {
  cmmcLevel?: 'L1' | 'L2';
  kind?: string;
  /** Command resolves to a real mutation (get-then-set with a set_command, or a CONFIG trigger). */
  writeShaped?: boolean;
}

/** W9-C1 (founder ruling 2026-10-31): env switch that re-enables every two-person approval. */
export const TWO_PERSON_APPROVAL_ENV = 'CES_TWO_PERSON_APPROVAL';

/**
 * W9-C1: is two-person approval in force? Default OFF (no two-person authorization anywhere
 * for now). `CES_TWO_PERSON_APPROVAL=1` (or `true`) re-enables the Tier 3 second approver, the
 * M4 live-L2 floor and the approver-token requirement. Read at call time, so it can be toggled.
 * requiresManualGate below still answers the tier question; the executor applies this switch.
 */
export function isTwoPersonApprovalEnabled(): boolean {
  const v = String(process.env[TWO_PERSON_APPROVAL_ENV] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Check if command requires manual approval gate.
 * Returns true for Tier 3 commands.
 *
 * G-AO-CMMC-BOUND-1 M4 — the SINGLE additive floor (scope boundary: no other
 * tenant attribute may drive SoD tier): against a hardened LIVE L2 tenant
 * (`cmmcLevel === 'L2' && kind === 'live'`), a write-shaped Tier 2 command is
 * floored up to the manual gate — a mutation that wouldn't normally require
 * two-person approval does on that tenant. Read/evidence commands and sim
 * tenants are unaffected (sim-transparency: gate behavior vs stacksim differs
 * only by the record's declared kind, never by how the command executes).
 */
export function requiresManualGate(aoCommand: AoCommand, tenant?: SodTenantContext): boolean {
  if (aoCommand.sodTier === 'Tier 3') return true;
  if (
    tenant?.cmmcLevel === 'L2' &&
    tenant?.kind === 'live' &&
    tenant?.writeShaped === true &&
    aoCommand.sodTier === 'Tier 2'
  ) {
    return true;
  }
  return false;
}

/**
 * Wrap CommandEntry with manual_gate engine for Tier 3 commands.
 * Sets engine to 'manual_gate' for commands requiring approval.
 * The gate itself is the two-person approval: decisions are recorded by
 * ApprovalStore.recordApprovalDecision, which refuses requestor = approver, and execution is cleared by
 * assertManualGateCleared below.
 */
export function wrapWithManualGate(commandEntry: CommandEntry): CommandEntry {
  return {
    ...commandEntry,
    engine: 'manual_gate',
  };
}

/** AO-3: refusal code for a manual-gate call made without an approval id. */
export const APPROVAL_ID_REQUIRED = 'APPROVAL_ID_REQUIRED';

/** AO-3: a missing-approval-id refusal. The approval store is not touched. */
export class ApprovalIdRequiredError extends Error {
  readonly code = APPROVAL_ID_REQUIRED;
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalIdRequiredError';
  }
}

function requireApprovalId(approvalId: unknown): string {
  if (typeof approvalId !== 'string' || !approvalId.trim()) {
    throw new ApprovalIdRequiredError(
      `${APPROVAL_ID_REQUIRED}: the manual separation-of-duties gate needs an approval id`
    );
  }
  return approvalId.trim();
}

/**
 * AO-3: manual separation-of-duties gate. Requires an approval id, checks the
 * approval authorises this command with these inputs (ManualGateAdapter), then re-checks the
 * RECORDED decision: an approver and decision time are present and the approver is not the
 * requestor. Returns the approval; throws on any failure.
 */
export async function assertManualGateCleared(
  approvalId: string,
  aoCommand: AoCommand,
  inputs: Record<string, any>
): Promise<ApprovalRequest> {
  const id = requireApprovalId(approvalId);
  const req = await assertApprovalValidForExecution(id, aoCommand, inputs);
  if (!req.approverUPN || !req.decidedAt) {
    throw new Error(`Approval ${id} has no recorded second-person decision`);
  }
  if (isSamePerson(req.approverUPN, req.requestorUPN)) {
    throw new SodViolationError(
      'Separation-of-duties violation: the approver must be a different person than the requestor'
    );
  }
  return req;
}
