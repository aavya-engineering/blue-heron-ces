// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module: Approval Store
// Durable persistence for two-person (separation-of-duties) approval requests.
// Tier 3 destructive commands cannot execute until a SECOND, distinct UPN approves.
//
// Storage: {CES_PIPELINE_ROOT}/AdminOps/approvals/{approvalId}.json

import { randomUUID } from 'node:crypto';
import { canonicalSha256 } from 'ces-shared/crypto';
import { resolveCesIdentity, type CesIdentity } from 'ces-shared/config/ces';
import { loadCesConfig } from 'ces-shared/config/ces/node';
import { getCesRepository } from 'ces-shared/persistence/node';
import { generateExecutionId, persistEvidenceArtifact } from './EvidenceEmitter.js';
import { resolveTargetIdentity } from './TargetIdentity.js';
import type { StructuredEvidence } from '../types/StamperTypes.js';

// G2: approvals persist in the unified repository as a global control collection keyed by the
// unguessable approvalId capability, replacing {AdminOps}/approvals/{id}.json. See ADR-002.
const AO_APPROVALS_COLLECTION = 'adminops_approvals';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed';

export interface ApprovalRequest {
  approvalId: string;
  commandId: string;
  commandTitle: string;
  domain: string;
  tenantId: string;
  /** G1/T2: CES identity (customer↔tenant lineage), resolved from the CES config. */
  ces?: CesIdentity;
  sodTier: string;
  /** UPN of the operator who requested the destructive action. */
  requestorUPN: string;
  /** SHA-256 of the request inputs — binds the approval to exact parameters. */
  paramsHash: string;
  inputs: Record<string, any>;
  /** AE-R3: CMMC practice IDs from the command — needed for rejection evidence. */
  controlIds?: string[];
  status: ApprovalStatus;
  createdAt: string;
  /** UPN of the second person who approved/rejected. Must differ from requestorUPN. */
  approverUPN?: string;
  /** W4-AO3: subject id of the authenticated principal who decided (ces-shared request principal). */
  approverSubjectId?: string;
  /** W4-AO3: true when the decider was proven by a token verifier; false for the explicit dev principal. */
  approverVerified?: boolean;
  /** W4-AO3: where the decider's identity came from ('token' | 'dev-unverified'). */
  approverPrincipalSource?: string;
  /** FC-AO-2: the tenant (`tid`) the approver's token was minted for (equals tenantId when set). */
  approverTenantId?: string;
  /**
   * FC-AO-3 step 3: the approver token's id (`jti`), when the principal carried one — links
   * the decision back to EvidenceOps's mint record. Explicitly `null` (not absent) when the
   * approver carried no token id (e.g. the dev loopback principal), so every decision states
   * the fact rather than leaving it ambiguous.
   */
  approverTokenId?: string | null;
  /** W4-AO3: true when the requestor was an authenticated principal (not a request-body UPN). */
  requestorAuthenticated?: boolean;
  decidedAt?: string;
  rejectionReason?: string;
  executedAt?: string;
  /**
   * FX-AO3: set when the rejection's evidence row failed to persist, so the approval
   * list/detail views show the loss (not just the one decision response).
   */
  evidenceError?: string;
}

/** FX-AO3: a decision result also reports whether its evidence row persisted. */
export type ApprovalDecisionResult = ApprovalRequest & { evidencePersisted?: boolean };

export function hashInputs(inputs: Record<string, any>): string {
  // G8: canonical (key-order-stable) hashing so the requestor's and approver's serializations of
  // the same parameters bind to the SAME hash regardless of key insertion order. Empty/scalar
  // inputs hash identically to the previous JSON.stringify behavior (back-compatible).
  return canonicalSha256(inputs ?? {});
}

function saveApproval(request: ApprovalRequest): void {
  getCesRepository().put(AO_APPROVALS_COLLECTION, {
    id: request.approvalId,
    ces: request.ces ?? { tenantId: request.tenantId },
    data: request,
  });
}

/** Create a new pending approval request and persist it. */
export async function createApprovalRequest(input: {
  commandId: string;
  commandTitle: string;
  domain: string;
  tenantId: string;
  sodTier: string;
  requestorUPN: string;
  inputs: Record<string, any>;
  controlIds?: string[];
  requestorAuthenticated?: boolean;
}): Promise<ApprovalRequest> {
  const now = new Date().toISOString();
  const request: ApprovalRequest = {
    approvalId: randomUUID(),
    commandId: input.commandId,
    commandTitle: input.commandTitle,
    domain: input.domain,
    tenantId: input.tenantId,
    ces: resolveCesIdentity(loadCesConfig(), { tenantId: input.tenantId }),
    sodTier: input.sodTier,
    requestorUPN: input.requestorUPN,
    paramsHash: hashInputs(input.inputs),
    inputs: input.inputs,
    controlIds: input.controlIds,
    status: 'pending',
    createdAt: now,
    ...(input.requestorAuthenticated !== undefined ? { requestorAuthenticated: input.requestorAuthenticated } : {}),
  };
  saveApproval(request);
  return request;
}

export async function getApprovalRequest(approvalId: string): Promise<ApprovalRequest | null> {
  const rec = getCesRepository().findById<ApprovalRequest>(AO_APPROVALS_COLLECTION, approvalId);
  return rec ? rec.data : null;
}

/**
 * FX2-AO1: the ONLY accepted approver shape — a principal produced by a verifier
 * (ces-shared request principal, source 'token'), or the explicit loopback dev
 * principal of the web route (source 'dev-unverified', verified:false). A raw
 * approver string is not accepted by any code path.
 */
export interface ApproverPrincipal {
  readonly upn: string;
  readonly subjectId: string;
  readonly verified: boolean;
  readonly source: 'token' | 'dev-unverified';
  /**
   * FC-AO-2 step 1: the token's tenant claim (`tid`). A token principal must carry the
   * approval's own tenant id, or the decision is refused (TOKEN_TENANT_MISMATCH).
   */
  readonly tenantId?: string;
  /**
   * FC-AO-3 step 1 (founder decision 10, 2026-09-28): the principal's roles (token `roles`
   * claim, or the dev loopback principal's configured roles). Only a principal carrying
   * `ao-approver` may decide an approval — see assertApproverRole.
   */
  readonly roles?: readonly string[];
  /**
   * FC-AO-3 step 3: the token's id (`jti`, exposed as `RequestPrincipal.tokenId` by
   * ces-shared/http/principal 1.1.0+). Persisted as `approverTokenId` so a decision links
   * back to EvidenceOps's mint record. Never set for the dev loopback principal.
   */
  readonly tokenId?: string;
}

/** FC-AO-3 step 1: the only role that may decide a two-person approval, on any surface. */
export const REQUIRED_APPROVER_ROLE = 'ao-approver';

/** FC-AO-3 step 1: refusal code for a valid, verified principal that lacks the required role. */
export const APPROVER_ROLE_REQUIRED = 'APPROVER_ROLE_REQUIRED';

/** FC-AO-3 step 1: a role refusal. Nothing is recorded; the approval stays pending. */
export class ApproverRoleError extends Error {
  readonly code = APPROVER_ROLE_REQUIRED;
  constructor(message: string) {
    super(message);
    this.name = 'ApproverRoleError';
  }
}

/**
 * FC-AO-3 step 1 (founder decision 10, 2026-09-28): only a principal carrying the
 * `ao-approver` role may decide an approval — on web, CLI and MCP alike. Any other
 * VALID principal (a correctly verified token, or the dev loopback principal, that simply
 * lacks the role) is refused with a clear reason. Runs before the tenant check, on every
 * surface, because all three route through recordApprovalDecision.
 */
export function assertApproverRole(approver: ApproverPrincipal): void {
  const roles = Array.isArray(approver.roles) ? approver.roles : [];
  if (!roles.includes(REQUIRED_APPROVER_ROLE)) {
    throw new ApproverRoleError(
      `${APPROVER_ROLE_REQUIRED}: the approver principal does not carry the '${REQUIRED_APPROVER_ROLE}' role ` +
        `(roles: ${roles.length ? roles.join(', ') : 'none'}) — only an ao-approver-role principal may decide an approval`
    );
  }
}

/** FC-AO-2 step 1: refusal code for a token whose tenant is not the approval's tenant. */
export const TOKEN_TENANT_MISMATCH = 'TOKEN_TENANT_MISMATCH';

/** FC-AO-2 step 1: a token-tenant refusal. Nothing is recorded; the approval stays pending. */
export class ApprovalTenantMismatchError extends Error {
  readonly code = TOKEN_TENANT_MISMATCH;
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalTenantMismatchError';
  }
}

const normTenant = (t: string) => t.trim().toLowerCase();

/**
 * FC-AO-2 step 1 (P0, security): a verified token principal may decide only an approval
 * of the tenant its token was minted for. Fail closed: a token with no tenant claim is
 * refused too.
 *
 * FC-AO-3 step 2: the explicit loopback dev principal (source 'dev-unverified') is bound
 * the SAME way — it must carry a `tenantId` (attached by the route from
 * `CES_AO_DEV_PRINCIPAL_TENANT`, see `withDevApproverTenant`), and it may decide only that
 * tenant's approvals. `CES_AO_DEV_PRINCIPAL_UPN` set with no tenant configured therefore
 * fails closed here (no tenant claim), matching an unbound token.
 */
export function assertApproverTenant(approver: ApproverPrincipal, approvalTenantId: string): void {
  const tid = typeof approver.tenantId === 'string' ? approver.tenantId : '';
  const who = approver.source === 'dev-unverified' ? 'the dev loopback approver' : 'the approver token';
  if (!tid.trim()) {
    throw new ApprovalTenantMismatchError(
      `${TOKEN_TENANT_MISMATCH}: ${who} carries no tenant (tid) claim; an approver must be bound ` +
        `to the approval's tenant — approval refused`
    );
  }
  if (normTenant(tid) !== normTenant(String(approvalTenantId ?? ''))) {
    throw new ApprovalTenantMismatchError(
      `${TOKEN_TENANT_MISMATCH}: ${who} was bound to tenant "${tid}", not this approval's tenant ` +
        `"${approvalTenantId}" — approval refused`
    );
  }
}

function assertApproverPrincipal(approver: unknown): asserts approver is ApproverPrincipal {
  const a = approver as Partial<ApproverPrincipal> | null;
  if (!a || typeof a !== 'object') {
    throw new Error('approver must be a verified principal (a typed approver name is not accepted)');
  }
  if (typeof a.upn !== 'string' || !a.upn.trim() || typeof a.subjectId !== 'string' || !a.subjectId.trim()) {
    throw new Error('approver principal must carry a upn and a subjectId');
  }
  const consistent =
    (a.source === 'token' && a.verified === true) || (a.source === 'dev-unverified' && a.verified === false);
  if (!consistent) {
    throw new Error("approver principal must come from a verifier (source 'token') or the explicit dev principal");
  }
}

/**
 * Record a second-person decision on a pending request.
 * Enforces separation of duties: the approver principal's UPN must NOT equal requestorUPN.
 * Only a request in `pending` status can be decided.
 */
export async function recordApprovalDecision(
  approvalId: string,
  approver: ApproverPrincipal,
  decision: 'approve' | 'reject',
  rejectionReason?: string
): Promise<ApprovalDecisionResult> {
  assertApproverPrincipal(approver);
  // FC-AO-3 step 1 (P0, founder decision 10): only an ao-approver-role principal may decide.
  // Runs before the tenant check and before the approval is even fetched.
  assertApproverRole(approver);
  const approverUPN = approver.upn;
  const req = await getApprovalRequest(approvalId);
  if (!req) {
    throw new Error(`Approval request not found: ${approvalId}`);
  }
  if (req.status !== 'pending') {
    throw new Error(`Approval ${approvalId} is not pending (status: ${req.status})`);
  }
  // FC-AO-2 step 1: the approver's token must be bound to THIS approval's tenant.
  assertApproverTenant(approver, req.tenantId);
  // Separation of duties: the approver cannot be the requestor.
  if (approverUPN.trim().toLowerCase() === req.requestorUPN.trim().toLowerCase()) {
    throw new Error(
      'Separation-of-duties violation: the approver must be a different person than the requestor'
    );
  }

  req.approverUPN = approverUPN;
  req.approverSubjectId = approver.subjectId;
  req.approverVerified = approver.verified;
  req.approverPrincipalSource = approver.source;
  if (typeof approver.tenantId === 'string' && approver.tenantId.trim()) req.approverTenantId = approver.tenantId;
  // FC-AO-3 step 3: record the token id on every decision (explicit null when the principal
  // carried none), so a decision either links to EO's mint record or says plainly it doesn't.
  req.approverTokenId = typeof approver.tokenId === 'string' && approver.tokenId.trim() ? approver.tokenId : null;
  req.decidedAt = new Date().toISOString();
  req.status = decision === 'approve' ? 'approved' : 'rejected';
  if (decision === 'reject') {
    req.rejectionReason = rejectionReason ?? 'No reason provided';
  }
  saveApproval(req);

  if (decision === 'reject') {
    const rejectionEvidence: StructuredEvidence = {
      rawResponse: '',
      outcome: 'approval_rejected',
      outcomeRationale: `Approval request rejected by ${approverUPN}: ${req.rejectionReason}`,
      complianceVerdict: 'NOT_APPLICABLE',
      verdictRationale: 'A rejected approval is not a compliance determination',
      metadata: {
        controlIds: req.controlIds ?? [],
        timestamp: req.decidedAt,
        executorIdentity: 'ces-ao-approval-store',
        commandExecuted: req.commandId,
        sha256Hash: req.paramsHash,
        dryRun: false,
        mode: 'live',
        approverTokenId: req.approverTokenId ?? null,
      },
    };
    const persisted = await persistEvidenceArtifact(rejectionEvidence, {
      commandId: req.commandId,
      tenantId: req.tenantId,
      executionId: generateExecutionId(),
      domain: req.domain,
      tenantSlug: req.ces?.tenantSlug,
      requestorUPN: req.requestorUPN,
      approverUPN,
      approvalId: req.approvalId,
      // FX-AO6 (contract 1.3.0): the rejected action's target user, from the bound inputs.
      ...resolveTargetIdentity(req.inputs),
    });
    if (!persisted.evidencePersisted) {
      // FX-AO3: record the loss on the approval itself (error already logged by the emitter).
      req.evidenceError = persisted.evidenceError ?? 'Unknown persistence failure';
      try {
        saveApproval(req);
      } catch {
        // The approval store shares the failing backend; the response still carries the loss.
      }
      return { ...req, evidencePersisted: false };
    }
    return { ...req, evidencePersisted: true };
  }

  return req;
}

/** Mark an approved request as executed (consumed). An approval is single-use. */
export async function markApprovalExecuted(approvalId: string): Promise<ApprovalRequest> {
  const req = await getApprovalRequest(approvalId);
  if (!req) {
    throw new Error(`Approval request not found: ${approvalId}`);
  }
  if (req.status !== 'approved') {
    throw new Error(`Approval ${approvalId} cannot be executed (status: ${req.status})`);
  }
  req.status = 'executed';
  req.executedAt = new Date().toISOString();
  saveApproval(req);
  return req;
}

/** List all approval requests, optionally filtered by status. */
export async function listApprovals(status?: ApprovalStatus): Promise<ApprovalRequest[]> {
  return getCesRepository()
    .listAll<ApprovalRequest>(AO_APPROVALS_COLLECTION)
    .map((r) => r.data)
    .filter((req) => !status || req.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
