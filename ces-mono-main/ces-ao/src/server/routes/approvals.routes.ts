// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module: Approvals Routes
// Express router for the two-person (SoD) approval workflow used by Tier 3 commands.
//
//   GET  /api/approvals            — list approvals (optional ?status=pending)
//   GET  /api/approvals/:id        — fetch one approval request
//   POST /api/approvals/:id/decision — second-person approve/reject
//        body: { decision: 'approve'|'reject', reason?: string }
//        W4-AO3: REQUIRES an authenticated principal (ces-shared request principal,
//        header x-ces-principal). The approver recorded is the principal's UPN; a
//        body `approverUPN` is ignored (logged when it differs). No principal => 401,
//        and no decision is recorded.
//
// Note: approving does NOT execute the command. To run an approved Tier 3
// command, re-POST to /api/execute/:commandId with { approvalId, inputs, dryRun:false,
// confirmApply:<commandId> } (W4-AO5 web apply guard).

import { Router, type Request, type Response } from 'express';
import {
  listApprovals,
  getApprovalRequest,
  recordApprovalDecision,
  TOKEN_TENANT_MISMATCH,
  APPROVER_ROLE_REQUIRED,
  type ApprovalStatus,
} from '../../execution/ApprovalStore.js';
import { evidenceLostWarning } from '../../execution/EvidenceEmitter.js';
import { getRequestPrincipal, type RequirePrincipalOptions } from 'ces-shared/http/principal';
import { aoPrincipalOptionsFromEnv, requireAoPrincipal, withDevApproverTenant } from '../principal.js';

export interface ApprovalsRouterOptions {
  /** Principal posture for decisions; defaults to aoPrincipalOptionsFromEnv() (fail closed when unset). */
  principal?: RequirePrincipalOptions;
}

/** FX-AO3: surface a recorded evidence loss on an approval view. */
function withEvidenceWarning<T extends { evidenceError?: string }>(approval: T) {
  return approval.evidenceError
    ? { ...approval, evidenceLost: true, evidenceWarning: evidenceLostWarning(approval.evidenceError) }
    : approval;
}

export function createApprovalsRouter(options: ApprovalsRouterOptions = {}): Router {
  const router = Router();
  const principalGuard = requireAoPrincipal(options.principal ?? aoPrincipalOptionsFromEnv());

  router.get('/approvals', async (req: Request, res: Response) => {
    try {
      const status = req.query['status'] as ApprovalStatus | undefined;
      const approvals = await listApprovals(status);
      return res.status(200).json({ success: true, approvals: approvals.map(withEvidenceWarning) });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/approvals/:id', async (req: Request, res: Response) => {
    try {
      const approval = await getApprovalRequest(req.params['id']);
      if (!approval) {
        return res.status(404).json({ success: false, error: 'Approval request not found' });
      }
      return res.status(200).json({ success: true, approval: withEvidenceWarning(approval) });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/approvals/:id/decision', principalGuard as any, async (req: Request, res: Response) => {
    try {
      const { decision, reason } = req.body ?? {};
      const rawPrincipal = getRequestPrincipal(req);
      if (!rawPrincipal) {
        // Unreachable behind the guard; kept fail-closed.
        return res.status(401).json({ success: false, error: 'an authenticated principal is required to decide an approval' });
      }
      // FC-AO-3 step 2: the dev loopback principal carries no tenant claim from ces-shared;
      // attach CES_AO_DEV_PRINCIPAL_TENANT here so the store's tenant check applies to it too.
      const principal = withDevApproverTenant(rawPrincipal, process.env);
      if (decision !== 'approve' && decision !== 'reject') {
        return res.status(400).json({
          success: false,
          error: "decision must be 'approve' or 'reject'",
        });
      }
      const claimed = req.body?.approverUPN;
      if (claimed !== undefined && String(claimed).trim().toLowerCase() !== principal.upn.trim().toLowerCase()) {
        console.warn(
          `[approvals.routes] ignoring body approverUPN "${claimed}" for approval ${req.params['id']}; ` +
            `the approver is the authenticated principal "${principal.upn}".`
        );
      }
      // FX2-AO1: the store takes the principal itself, never a UPN string.
      const approval = await recordApprovalDecision(req.params['id'], principal, decision, reason);
      if (approval.evidencePersisted === false) {
        console.error(`[approvals.routes] evidence lost for approval ${approval.approvalId}: ${approval.evidenceError}`);
        return res.status(200).json({
          success: true,
          approval: withEvidenceWarning(approval),
          evidencePersisted: false,
          evidenceLost: true,
          evidenceError: approval.evidenceError,
          evidenceWarning: evidenceLostWarning(approval.evidenceError),
        });
      }
      return res.status(200).json({ success: true, approval, evidencePersisted: approval.evidencePersisted });
    } catch (error: any) {
      // FC-AO-2 step 1: a token bound to another tenant (or to none) is forbidden.
      if (error?.code === TOKEN_TENANT_MISMATCH) {
        return res.status(403).json({ success: false, code: TOKEN_TENANT_MISMATCH, error: error.message });
      }
      // FC-AO-3 step 1: a valid, verified principal without the ao-approver role is forbidden.
      if (error?.code === APPROVER_ROLE_REQUIRED) {
        return res.status(403).json({ success: false, code: APPROVER_ROLE_REQUIRED, error: error.message });
      }
      // SoD violations / not-pending / not-found surface as 409 Conflict.
      const msg = (error.message || '').toLowerCase();
      const status =
        msg.includes('separation-of-duties') || msg.includes('not pending') ? 409 :
        msg.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, error: error.message });
    }
  });

  return router;
}
