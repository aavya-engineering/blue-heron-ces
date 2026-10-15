// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module: Manual Gate Adapter
// Two-person (separation-of-duties) approval gate for Tier 3 destructive commands.
//
// Flow:
//  1. A Tier 3 command request does NOT execute. It creates a pending approval
//     record (requestGateApproval) bound to the requestor UPN and exact inputs.
//  2. A second, distinct UPN approves via the approvals API (ApprovalStore).
//  3. Only an approved request whose commandId + paramsHash still match can be
//     executed (assertApprovalValidForExecution), and the approval is single-use.

import type { AoCommand } from '../types/AoCommand.js';
import {
  createApprovalRequest,
  getApprovalRequest,
  hashInputs,
  type ApprovalRequest,
} from './ApprovalStore.js';

/**
 * Create a pending approval request for a Tier 3 command. Does NOT execute.
 */
export async function requestGateApproval(
  aoCommand: AoCommand,
  tenantId: string,
  requestorUPN: string,
  inputs: Record<string, any>,
  requestorAuthenticated?: boolean
): Promise<ApprovalRequest> {
  if (!requestorUPN || typeof requestorUPN !== 'string') {
    throw new Error('requestorUPN is required to request approval for a Tier 3 command');
  }
  return createApprovalRequest({
    commandId: aoCommand.id,
    commandTitle: aoCommand.title,
    domain: aoCommand.domain,
    tenantId,
    sodTier: aoCommand.sodTier,
    requestorUPN,
    inputs,
    controlIds: aoCommand.cmmcPractices,
    requestorAuthenticated,
  });
}

/**
 * Validate that an approval authorises executing THIS command with THESE inputs.
 * Throws if the approval is missing, not approved, for a different command, or
 * for different parameters. Returns the approval record on success.
 */
export async function assertApprovalValidForExecution(
  approvalId: string,
  aoCommand: AoCommand,
  inputs: Record<string, any>
): Promise<ApprovalRequest> {
  const req = await getApprovalRequest(approvalId);
  if (!req) {
    throw new Error(`Approval request not found: ${approvalId}`);
  }
  if (req.status !== 'approved') {
    throw new Error(
      `Approval ${approvalId} is not in 'approved' status (current: ${req.status}). ` +
        `A second-person approval is required before this Tier 3 command can run.`
    );
  }
  if (req.commandId !== aoCommand.id) {
    throw new Error(
      `Approval ${approvalId} authorises command ${req.commandId}, not ${aoCommand.id}`
    );
  }
  if (req.paramsHash !== hashInputs(inputs)) {
    throw new Error(
      `Approval ${approvalId} was granted for different parameters than the current request`
    );
  }
  return req;
}
