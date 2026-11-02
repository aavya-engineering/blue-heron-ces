// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31 (closes LOG-FIN-12 open item 2): how a browser user gets an uploader token.
//
// EC records an upload's uploader only from a verified `x-ces-principal` HS256 token signed with
// CES_EC_PRINCIPAL_SECRET (ces-ec src/auth.ts optionalUploaderPrincipal). Until now only the tester
// harness signed one. This issuer lets EO mint one for a NAMED uploader, under the same rule as the
// approver-token issuer (ApproverTokenIssuer.ts): only an authenticated BHD operator (passkey on the
// EO machine, Entra ID, or the loopback-only dev fallback) may mint, and every mint is recorded as
// evidence before the token is returned (no evidence, no token). The token itself is never stored.
//
//   * Claims: { sub: 'uploader:<upn lower>', upn, name?, roles: ['ec-uploader'], tid, jti } — the
//     shape the tester's uploaderClaims() already proves EC accepts, plus tenant and mint id.
//   * Lifetime: default 60 min, hard max 8 h (an upload session, not a standing credential).
//   * The EC principal secret must differ from CES_AO_PRINCIPAL_SECRET and CES_EO_OPERATOR_SECRET,
//     or an uploader token could be presented as an approver or operator token (secret_reuse).
//     Even without that check an uploader token cannot review: verifyMintedApproverToken checks the
//     AO signature, the ao-approver role and the approver mint log.
//   * An operator MAY mint an uploader token for themselves (an operator uploading on a customer's
//     behalf). GD-b still holds: the reviewer's approver token must name someone else, and the
//     review route refuses a reviewer whose UPN is the recorded uploader's (403 reviewer_is_uploader).

import { randomUUID } from 'node:crypto';
import { signPrincipalToken, type PrincipalClaims, type RequestPrincipal } from 'ces-shared/http/principal';
import { secretEnv } from 'ces-shared/secrets';
import { ApproverTokenRefusal, assertBhdOperator } from '../approver-tokens/ApproverTokenIssuer.js';
import type { OperatorAuthMode } from '../approver-tokens/ApproverTokenMintLog.js';
import type { UploaderTokenMintRecord, UploaderTokenMintSink } from './UploaderTokenMintLog.js';

export const EC_UPLOADER_ROLE = 'ec-uploader';
export const DEFAULT_UPLOADER_TOKEN_TTL_SECONDS = 60 * 60;
export const MAX_UPLOADER_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const MIN_SECRET_LENGTH = 16;
const UPN_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Env = Record<string, string | undefined>;

export interface MintUploaderTokenInput {
  operator: RequestPrincipal | undefined;
  tenant: { slug: string; tenantId: string } | undefined;
  uploaderUpn: unknown;
  uploaderDisplayName?: unknown;
  ttlSeconds?: unknown;
  operatorAuthMode?: 'entra' | 'passkey';
  operatorCredentialId?: string;
  /** Accept a `dev-unverified` operator. The router sets this ONLY for the dev fallback on loopback. */
  allowDevOperator?: boolean;
}

export interface MintUploaderTokenDeps {
  env?: Env;
  evidence: UploaderTokenMintSink;
  now?: () => number;
}

export interface MintedUploaderToken {
  token: string;
  mintId: string;
  uploaderUpn: string;
  tenant: { slug: string; tenantId: string };
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
  operatorAuth: OperatorAuthMode;
}

/** True when EO can mint uploader tokens (the EC principal secret is present and long enough). */
export function uploaderIssuerConfigured(env: Env = secretEnv()): boolean {
  const s = env.CES_EC_PRINCIPAL_SECRET;
  return typeof s === 'string' && s.length >= MIN_SECRET_LENGTH;
}

function resolveTtl(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_UPLOADER_TOKEN_TTL_SECONDS;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw new ApproverTokenRefusal('ttl_invalid', 400, 'ttlSeconds must be a positive whole number of seconds');
  }
  if (raw > MAX_UPLOADER_TOKEN_TTL_SECONDS) {
    throw new ApproverTokenRefusal('ttl_excessive', 400,
      `ttlSeconds ${raw} exceeds the maximum uploader-token lifetime of ${MAX_UPLOADER_TOKEN_TTL_SECONDS} seconds`);
  }
  return raw;
}

/** Mint a short-lived EC uploader token for a named uploader. Throws ApproverTokenRefusal. */
export function mintUploaderToken(input: MintUploaderTokenInput, deps: MintUploaderTokenDeps): MintedUploaderToken {
  const env = deps.env ?? secretEnv();
  const operator = assertBhdOperator(input.operator, { allowDevOperator: input.allowDevOperator === true });
  const operatorAuth: OperatorAuthMode = operator.source === 'dev-unverified'
    ? 'dev-hs256-unverified'
    : input.operatorAuthMode === 'entra' ? 'entra'
    : input.operatorAuthMode === 'passkey' ? 'passkey' : 'verified-token';
  if (operatorAuth === 'passkey' && (typeof input.operatorCredentialId !== 'string' || !input.operatorCredentialId)) {
    throw new ApproverTokenRefusal('not_operator', 403, 'a passkey-signed-in operator must be tied to the passkey used');
  }

  const tenant = input.tenant;
  if (!tenant || typeof tenant.slug !== 'string' || !tenant.slug.trim() || typeof tenant.tenantId !== 'string' || !tenant.tenantId.trim()) {
    throw new ApproverTokenRefusal('tenant_required', 400, 'a resolved tenant (slug and tenant GUID) is required');
  }

  const secret = env.CES_EC_PRINCIPAL_SECRET;
  if (!uploaderIssuerConfigured(env) || typeof secret !== 'string') {
    throw new ApproverTokenRefusal('issuer_not_configured', 503,
      `the uploader-token issuer is not configured (CES_EC_PRINCIPAL_SECRET must be set in EO's environment, >= ${MIN_SECRET_LENGTH} chars, the same value EC verifies with)`);
  }
  if (secret === env.CES_AO_PRINCIPAL_SECRET || secret === env.CES_EO_OPERATOR_SECRET) {
    throw new ApproverTokenRefusal('secret_reuse', 503,
      'CES_EC_PRINCIPAL_SECRET must differ from CES_AO_PRINCIPAL_SECRET and CES_EO_OPERATOR_SECRET');
  }

  if (typeof input.uploaderUpn !== 'string' || !input.uploaderUpn.trim()) {
    throw new ApproverTokenRefusal('approver_required', 400, 'uploaderUpn (the named uploader) is required');
  }
  const uploaderUpn = input.uploaderUpn.trim();
  if (!UPN_RE.test(uploaderUpn) || uploaderUpn.length > 256) {
    throw new ApproverTokenRefusal('approver_invalid', 400, 'uploaderUpn must be a user principal name (name@domain)');
  }
  const displayName = typeof input.uploaderDisplayName === 'string' && input.uploaderDisplayName.trim()
    ? input.uploaderDisplayName.trim().slice(0, 256)
    : undefined;
  const ttlSeconds = resolveTtl(input.ttlSeconds);

  const nowMs = (deps.now ?? Date.now)();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlSeconds;
  const mintId = randomUUID();
  const issuer = env.CES_EC_PRINCIPAL_ISSUER || undefined;
  const audience = env.CES_EC_PRINCIPAL_AUDIENCE || undefined;

  const claims: PrincipalClaims = {
    sub: `uploader:${uploaderUpn.toLowerCase()}`,
    upn: uploaderUpn,
    ...(displayName ? { name: displayName } : {}),
    roles: [EC_UPLOADER_ROLE],
    tid: tenant.tenantId,
    ...(issuer ? { iss: issuer } : {}),
    ...(audience ? { aud: audience } : {}),
    jti: mintId,
  };
  const token = signPrincipalToken(claims, { secret, ttlSeconds, now: () => nowMs });

  const record: UploaderTokenMintRecord = {
    kind: 'ec-uploader-token-mint',
    mintId,
    mintedBy: { upn: operator.upn, subjectId: operator.subjectId },
    operatorAuth,
    ...(operatorAuth === 'passkey' ? { operatorCredentialId: input.operatorCredentialId } : {}),
    uploader: { upn: uploaderUpn, ...(displayName ? { displayName } : {}) },
    tenant: { slug: tenant.slug, tenantId: tenant.tenantId },
    issuedAt: new Date(iat * 1000).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString(),
    ttlSeconds,
    ...(issuer ? { issuer } : {}),
    ...(audience ? { audience } : {}),
  };
  try {
    deps.evidence.record(record);
  } catch (e) {
    throw new ApproverTokenRefusal('evidence_write_failed', 500,
      `the mint could not be recorded as evidence, so no token was issued: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    token,
    mintId,
    uploaderUpn,
    tenant: record.tenant,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    ttlSeconds,
    operatorAuth,
  };
}
