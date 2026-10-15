// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-AO1 (2026-09-27, P0 separation of duties): the approver of a Tier-3
// request on the CLI and MCP surfaces is a VERIFIED principal, never a typed name.
//
// The web route already requires a ces-shared request principal (W4-AO3). The
// CLI `ao approve` and the MCP `ao_approve` tool now use the same verifier: the
// caller presents a signed principal token (HS256, `ces-shared/http/principal`),
// verified against CES_AO_PRINCIPAL_SECRET (+ optional CES_AO_PRINCIPAL_ISSUER /
// CES_AO_PRINCIPAL_AUDIENCE) — the same posture as the web route. The approver
// recorded is the token's UPN. There is no dev-principal fallback here: that
// exists only for a loopback web request.
//
// Refusals (nothing is recorded, the approval stays pending):
//  - a typed approver name (`--approver` / `approverUPN`) — always refused;
//  - no token;
//  - no verifier configured (CES_AO_PRINCIPAL_SECRET unset);
//  - a token that fails verification (bad signature, expired, wrong iss/aud, ...);
//  - a verified principal who is the requestor (SoD, enforced by the store);
//  - FC-AO-2: a token whose tenant (`tid`) is missing or is not the approval's tenant
//    (TOKEN_TENANT_MISMATCH, enforced by the store for every surface).

import { aoPrincipalOptionsFromEnv } from '../server/principal.js';
import { recordApprovalDecision, type ApprovalDecisionResult, type ApproverPrincipal } from './ApprovalStore.js';

/** Env var the CLI reads the operator's signed principal token from. */
export const APPROVER_TOKEN_ENV = 'CES_AO_PRINCIPAL_TOKEN';

export class ApproverIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApproverIdentityError';
  }
}

export const TYPED_APPROVER_REFUSED =
  'typed approver names are not accepted: the approver is the verified principal of a signed token ' +
  '(x-ces-principal token issued with CES_AO_PRINCIPAL_SECRET), not a name you type';

/** Verify a principal token for an approval decision. Throws ApproverIdentityError on any refusal. */
export function verifyApproverToken(token: string | undefined, env: NodeJS.ProcessEnv = process.env): ApproverPrincipal {
  if (typeof token !== 'string' || !token.trim()) {
    throw new ApproverIdentityError(
      'no verified principal: an approval needs a signed principal token (none was supplied); a typed name is never accepted'
    );
  }
  const opts = aoPrincipalOptionsFromEnv(env);
  if (!opts.verifier) {
    throw new ApproverIdentityError(
      'no verified principal: CES_AO_PRINCIPAL_SECRET is not configured, so no principal token can be verified; approval refused'
    );
  }
  const result = opts.verifier.verify(token.trim());
  if (!result.ok) {
    throw new ApproverIdentityError(`no verified principal: the principal token was rejected (${result.reason}); approval refused`);
  }
  const p = result.principal;
  if (!p.verified || p.source !== 'token') {
    throw new ApproverIdentityError('no verified principal: the verifier did not return a verified token principal');
  }
  // FC-AO-2 step 1: carry the token's tenant (`tid`) so the store can bind the decision to
  // the approval's tenant (a token minted for tenant A never approves on tenant B).
  // FC-AO-3 step 1: carry `roles` so the store can require `ao-approver`.
  // FC-AO-3 step 3: carry `tokenId` (jti) so the store can record it on the decision.
  return {
    upn: p.upn,
    subjectId: p.subjectId,
    verified: true,
    source: 'token',
    roles: p.roles,
    ...(typeof p.tenantId === 'string' ? { tenantId: p.tenantId } : {}),
    ...(typeof p.tokenId === 'string' ? { tokenId: p.tokenId } : {}),
  };
}

export interface VerifiedDecisionInput {
  approvalId: string;
  decision: 'approve' | 'reject';
  reason?: string;
  /** Signed principal token (CLI: --principal-token or CES_AO_PRINCIPAL_TOKEN; MCP: principalToken). */
  principalToken?: string;
  /** A typed approver name, if the caller sent one. Its presence alone refuses the decision. */
  typedApprover?: unknown;
  env?: NodeJS.ProcessEnv;
}

/** The one decision path for CLI and MCP: verify, then record with the principal. */
export async function decideApprovalAsVerifiedPrincipal(input: VerifiedDecisionInput): Promise<ApprovalDecisionResult> {
  if (input.typedApprover !== undefined && input.typedApprover !== null && input.typedApprover !== false) {
    throw new ApproverIdentityError(TYPED_APPROVER_REFUSED);
  }
  const approver = verifyApproverToken(input.principalToken, input.env ?? process.env);
  return recordApprovalDecision(input.approvalId, approver, input.decision, input.reason);
}
