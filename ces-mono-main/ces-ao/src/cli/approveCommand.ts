// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-AO1: `ao approve` — the approver is a VERIFIED principal (signed token), never a typed name.
//
// Operator setup:
//   1. The deployment sets CES_AO_PRINCIPAL_SECRET (>= 16 chars; the same secret the web
//      route verifies x-ces-principal tokens with), and optionally CES_AO_PRINCIPAL_ISSUER /
//      CES_AO_PRINCIPAL_AUDIENCE.
//   2. The approving person obtains THEIR OWN signed principal token from the same issuer
//      that signs web sign-in tokens, and exports it:  $env:CES_AO_PRINCIPAL_TOKEN = '<token>'
//      (or passes --principal-token <token>; the env var keeps it out of shell history).
//   3. ao approve <approvalId>            (or --reject --reason "...")
// The approver recorded is the token's UPN. Self-approval is refused. `--approver` is refused.

import { getApprovalRequest } from '../execution/ApprovalStore.js';
import { APPROVER_TOKEN_ENV, decideApprovalAsVerifiedPrincipal } from '../execution/VerifiedApprover.js';

export const APPROVE_HELP_TEXT = `
Approver identity (FX2-AO1): the approver is the VERIFIED principal of a signed token, never a typed name.
  Setup: the deployment sets CES_AO_PRINCIPAL_SECRET (and optionally CES_AO_PRINCIPAL_ISSUER /
  CES_AO_PRINCIPAL_AUDIENCE). The approving person sets ${APPROVER_TOKEN_ENV} to their own signed
  principal token (from the same issuer as the web sign-in), or passes --principal-token.
  --approver is not accepted. Self-approval is refused.
  The token is tenant-bound (FC-AO-2): its tenant (tid) must be the approval's tenant, else the
  decision is refused (TOKEN_TENANT_MISMATCH). Mint it for this tenant in EvidenceOps.
  The token must also carry the 'ao-approver' role (FC-AO-3), else the decision is refused
  (APPROVER_ROLE_REQUIRED).`;

export interface ApproveCliOptions {
  reject?: boolean;
  reason?: string;
  principalToken?: string;
  /** Legacy typed name — recognised only so it can be refused clearly. */
  approver?: string;
}

export interface CliIo {
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Runs `ao approve`; returns the process exit code. */
export async function runApproveCommand(
  approvalId: string,
  o: ApproveCliOptions,
  io: CliIo = { env: process.env, out: (l) => console.log(l), err: (l) => console.error(l) }
): Promise<number> {
  try {
    const before = await getApprovalRequest(approvalId);
    if (!before) {
      io.err(`error: approval not found: ${approvalId}`);
      return 1;
    }
    const req = await decideApprovalAsVerifiedPrincipal({
      approvalId,
      decision: o.reject ? 'reject' : 'approve',
      reason: o.reason,
      principalToken: o.principalToken ?? io.env[APPROVER_TOKEN_ENV],
      typedApprover: o.approver,
      env: io.env,
    });
    io.out(`${o.reject ? '✗ REJECTED' : '✓ APPROVED'} ${approvalId} — command ${req.commandId} by ${req.approverUPN} (verified principal; requestor ${req.requestorUPN}).`);
    if (!o.reject) io.out(`Now run: ao exec ${req.commandId} --approval ${approvalId} --apply --requestor ${req.requestorUPN} --tenant <slug> [--param ...]`);
    return 0;
  } catch (e: any) {
    io.err(`error: ${e.message}`);
    return 1;
  }
}
