// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-EO-C AO-16 (2026-09-27): the AdminOps approver-token issuer (founder decision 7, 2026-09-27).
//
// AdminOps verifies Tier-3 approvers with a signed `ces-shared/http/principal` HS256 token
// (CES_AO_PRINCIPAL_SECRET, optional CES_AO_PRINCIPAL_ISSUER / _AUDIENCE) — see ces-ao
// src/execution/VerifiedApprover.ts. Until now nothing in production minted those tokens. This
// issuer does, under these rules:
//
//   * ONLY an authenticated BHD operator may mint: a principal VERIFIED from a token holding the
//     `bhd-operator` role. FC-EO-E (2026-09-28, founder decision 5): operators sign in with Microsoft
//     Entra ID; the role comes from membership of the configured operator group in a validated
//     Entra token (EntraOperatorVerifier.ts). The old CES_EO_OPERATOR_SECRET (HS256) operator token
//     survives ONLY as an explicit dev fallback: off unless CES_EO_OPERATOR_DEV_FALLBACK=1, loopback
//     only, never together with Entra config, and its principal is marked `dev-unverified` — the
//     issuer accepts such a principal only when the caller passes `allowDevOperator` (the router
//     does so only for that mode on a loopback request). Its secret must DIFFER from
//     CES_AO_PRINCIPAL_SECRET, or every operator token would itself be a valid AO approver token.
//     FC-EO-G (2026-09-28, founder decisions 16-19): BHD has no Microsoft tenant, so operators
//     sign in with passkeys registered on the EvidenceOps machine (PasskeyOperatorService.ts); the
//     role comes from being an enrolled operator with an unrevoked passkey. Entra stays available
//     (off unless configured); passkey, Entra and the dev fallback are mutually exclusive.
//   * The token names ONE approver (UPN), is tenant-scoped (`tid` = the tenant's GUID) and
//     short-lived (default 15 min, hard max 30 min).
//   * An operator may not mint a token for themselves (issuer and approver must be two people).
//   * Every mint is written to the evidence log (who, for whom, tenant, expiry — never the token)
//     BEFORE the token is returned; if the evidence write fails, no token is returned.
//
// Signing uses ces-shared's exported signPrincipalToken — the same module AdminOps verifies with.
// No crypto is copied here.

import { randomUUID } from 'node:crypto';
import {
  signPrincipalToken,
  createHs256PrincipalVerifier,
  type PrincipalClaims,
  type PrincipalVerifier,
  type RequestPrincipal,
} from 'ces-shared/http/principal';
import type { ApproverTokenMintRecord, ApproverTokenMintSink, OperatorAuthMode } from './ApproverTokenMintLog.js';
import { entraOperatorConfigFromEnv, entraOperatorConfigured, type EntraOperatorConfig } from './EntraOperatorVerifier.js';
import { passkeyOperatorConfigFromEnv, passkeyOperatorConfigured, type PasskeyOperatorConfig } from './PasskeyOperatorService.js';

/** Role an EO principal must hold to mint approver tokens. */
export const BHD_OPERATOR_ROLE = 'bhd-operator';
/** Role stamped into minted tokens (informational; AdminOps keys on the verified UPN). */
export const AO_APPROVER_ROLE = 'ao-approver';
export const DEFAULT_APPROVER_TOKEN_TTL_SECONDS = 15 * 60;
export const MAX_APPROVER_TOKEN_TTL_SECONDS = 30 * 60;
const MIN_SECRET_LENGTH = 16;

export type ApproverTokenRefusalCode =
  | 'not_operator'
  | 'operator_auth_not_configured'
  | 'operator_auth_misconfigured'
  | 'operator_keys_unavailable'
  | 'dev_operator_not_loopback'
  | 'issuer_not_configured'
  | 'secret_reuse'
  | 'tenant_required'
  | 'approver_required'
  | 'approver_invalid'
  | 'self_mint'
  | 'ttl_invalid'
  | 'ttl_excessive'
  | 'evidence_write_failed';

export class ApproverTokenRefusal extends Error {
  constructor(
    readonly code: ApproverTokenRefusalCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApproverTokenRefusal';
  }
}

type Env = Record<string, string | undefined>;

/** A caller is an operator only if verified from a token AND holding the operator role. */
export function assertBhdOperator(
  principal: RequestPrincipal | undefined,
  opts: { allowDevOperator?: boolean } = {},
): RequestPrincipal {
  if (!principal) {
    throw new ApproverTokenRefusal('not_operator', 401, 'an authenticated BHD operator principal is required to mint approver tokens');
  }
  const devAllowed = opts.allowDevOperator === true && principal.verified === false && principal.source === 'dev-unverified';
  if (!devAllowed && (!principal.verified || principal.source !== 'token')) {
    throw new ApproverTokenRefusal('not_operator', 403, 'an unverified (dev) principal may not mint approver tokens');
  }
  if (!principal.roles.includes(BHD_OPERATOR_ROLE)) {
    throw new ApproverTokenRefusal('not_operator', 403, `only a principal with role '${BHD_OPERATOR_ROLE}' may mint approver tokens`);
  }
  return principal;
}

/**
 * DEV-ONLY fallback verifier (CES_EO_OPERATOR_SECRET, optional CES_EO_OPERATOR_ISSUER /
 * CES_EO_OPERATOR_AUDIENCE). Refuses when unset, too short, or equal to the AdminOps principal
 * secret. Every principal it yields is marked `verified: false, source: 'dev-unverified'`: an
 * HS256 shared-secret token is not an operator identity. Selected only by operatorAuthFromEnv when
 * CES_EO_OPERATOR_DEV_FALLBACK=1 and no Entra config is present.
 */
export function operatorVerifierFromEnv(env: Env = process.env): PrincipalVerifier {
  const secret = env.CES_EO_OPERATOR_SECRET;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new ApproverTokenRefusal(
      'operator_auth_not_configured', 503,
      `operator authentication is not configured (CES_EO_OPERATOR_SECRET must be set, >= ${MIN_SECRET_LENGTH} chars)`,
    );
  }
  if (secret === env.CES_AO_PRINCIPAL_SECRET) {
    throw new ApproverTokenRefusal(
      'secret_reuse', 503,
      'CES_EO_OPERATOR_SECRET must differ from CES_AO_PRINCIPAL_SECRET (an operator token would otherwise be a valid AdminOps approver token)',
    );
  }
  const hs = createHs256PrincipalVerifier({
    secret,
    ...(env.CES_EO_OPERATOR_ISSUER ? { issuer: env.CES_EO_OPERATOR_ISSUER } : {}),
    ...(env.CES_EO_OPERATOR_AUDIENCE ? { audience: env.CES_EO_OPERATOR_AUDIENCE } : {}),
  });
  return {
    verify(token: string) {
      const r = hs.verify(token);
      if (!r.ok) return r;
      const roles = Object.freeze([...r.principal.roles]);
      const p: RequestPrincipal = Object.freeze({ ...r.principal, roles, verified: false, source: 'dev-unverified' as const });
      return { ok: true as const, principal: p };
    },
  };
}

/** How operators authenticate, resolved from the environment. */
export type OperatorAuth =
  | { mode: 'entra'; config: EntraOperatorConfig }
  | { mode: 'passkey'; config: PasskeyOperatorConfig }
  | { mode: 'dev-hs256'; verifier: PrincipalVerifier };

/**
 * Pick the operator authentication mode. Entra ID (FC-EO-E) and passkeys on the EO machine (FC-EO-G)
 * are the real paths; the HS256 fallback needs CES_EO_OPERATOR_DEV_FALLBACK=1. Any two of them
 * together are refused (fail closed: an ambiguous deployment mints nothing). None configured -> 503.
 */
export function operatorAuthFromEnv(env: Env = process.env): OperatorAuth {
  const devFlag = env.CES_EO_OPERATOR_DEV_FALLBACK === '1';
  const passkey = passkeyOperatorConfigured(env);
  if (entraOperatorConfigured(env)) {
    if (devFlag) {
      throw new ApproverTokenRefusal(
        'operator_auth_misconfigured', 503,
        'CES_EO_OPERATOR_DEV_FALLBACK must not be set together with Entra operator sign-in',
      );
    }
    if (passkey) {
      throw new ApproverTokenRefusal(
        'operator_auth_misconfigured', 503,
        'configure either Entra operator sign-in or passkey operator sign-in (CES_EO_OPERATOR_PASSKEY_*), not both',
      );
    }
    const r = entraOperatorConfigFromEnv(env);
    if (!r.ok) throw new ApproverTokenRefusal('operator_auth_not_configured', 503, r.error);
    return { mode: 'entra', config: r.config };
  }
  if (passkey) {
    if (devFlag) {
      throw new ApproverTokenRefusal(
        'operator_auth_misconfigured', 503,
        'CES_EO_OPERATOR_DEV_FALLBACK must not be set together with passkey operator sign-in',
      );
    }
    const r = passkeyOperatorConfigFromEnv(env);
    if (!r.ok) throw new ApproverTokenRefusal('operator_auth_not_configured', 503, r.error);
    return { mode: 'passkey', config: r.config };
  }
  if (devFlag) return { mode: 'dev-hs256', verifier: operatorVerifierFromEnv(env) };
  throw new ApproverTokenRefusal(
    'operator_auth_not_configured', 503,
    'operator sign-in is not configured (set CES_EO_OPERATOR_PASSKEY_ORIGIN for passkeys on the EO machine, or the CES_EO_OPERATOR_ENTRA_* settings)',
  );
}

export interface MintApproverTokenInput {
  /** The authenticated caller (from the EO operator verifier). */
  operator: RequestPrincipal | undefined;
  /** The resolved tenant (slug + GUID). */
  tenant: { slug: string; tenantId: string } | undefined;
  approverUpn: unknown;
  approverDisplayName?: unknown;
  /** Requested lifetime in seconds; default 15 min, max 30 min. */
  ttlSeconds?: unknown;
  /** Set by the router: how the operator signed in (recorded as evidence). */
  operatorAuthMode?: 'entra' | 'passkey';
  /** FC-EO-G: the passkey the operator signed in with (recorded as evidence). Required for 'passkey'. */
  operatorCredentialId?: string;
  /** Accept a `dev-unverified` operator principal. The router sets this ONLY for the dev fallback on loopback. */
  allowDevOperator?: boolean;
}

export interface MintApproverTokenDeps {
  env?: Env;
  evidence: ApproverTokenMintSink;
  /** Clock (epoch ms). Injectable for tests. */
  now?: () => number;
}

export interface MintedApproverToken {
  token: string;
  mintId: string;
  approverUpn: string;
  tenant: { slug: string; tenantId: string };
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
  /** How the minting operator authenticated. */
  operatorAuth: OperatorAuthMode;
}

const UPN_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveTtl(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_APPROVER_TOKEN_TTL_SECONDS;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw new ApproverTokenRefusal('ttl_invalid', 400, 'ttlSeconds must be a positive whole number of seconds');
  }
  if (raw > MAX_APPROVER_TOKEN_TTL_SECONDS) {
    throw new ApproverTokenRefusal(
      'ttl_excessive', 400,
      `ttlSeconds ${raw} exceeds the maximum approver-token lifetime of ${MAX_APPROVER_TOKEN_TTL_SECONDS} seconds`,
    );
  }
  return raw;
}

/** Mint a short-lived AdminOps approver token for a named approver. Throws ApproverTokenRefusal. */
export function mintApproverToken(input: MintApproverTokenInput, deps: MintApproverTokenDeps): MintedApproverToken {
  const env = deps.env ?? process.env;
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

  const secret = env.CES_AO_PRINCIPAL_SECRET;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new ApproverTokenRefusal(
      'issuer_not_configured', 503,
      `the approver-token issuer is not configured (CES_AO_PRINCIPAL_SECRET must be set, >= ${MIN_SECRET_LENGTH} chars)`,
    );
  }
  if (env.CES_EO_OPERATOR_SECRET !== undefined && env.CES_EO_OPERATOR_SECRET === secret) {
    throw new ApproverTokenRefusal('secret_reuse', 503, 'CES_EO_OPERATOR_SECRET must differ from CES_AO_PRINCIPAL_SECRET');
  }

  if (typeof input.approverUpn !== 'string' || !input.approverUpn.trim()) {
    throw new ApproverTokenRefusal('approver_required', 400, 'approverUpn (the named approver) is required');
  }
  const approverUpn = input.approverUpn.trim();
  if (!UPN_RE.test(approverUpn) || approverUpn.length > 256) {
    throw new ApproverTokenRefusal('approver_invalid', 400, 'approverUpn must be a user principal name (name@domain)');
  }
  if (approverUpn.toLowerCase() === operator.upn.trim().toLowerCase()) {
    throw new ApproverTokenRefusal('self_mint', 403, 'an operator may not mint an approver token for themselves');
  }
  const displayName = typeof input.approverDisplayName === 'string' && input.approverDisplayName.trim()
    ? input.approverDisplayName.trim().slice(0, 256)
    : undefined;

  const ttlSeconds = resolveTtl(input.ttlSeconds);

  const clock = deps.now ?? Date.now;
  const nowMs = clock();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlSeconds;
  const mintId = randomUUID();
  const issuer = env.CES_AO_PRINCIPAL_ISSUER || undefined;
  const audience = env.CES_AO_PRINCIPAL_AUDIENCE || undefined;

  const claims = {
    sub: `ao-approver:${approverUpn.toLowerCase()}`,
    upn: approverUpn,
    ...(displayName ? { name: displayName } : {}),
    roles: [AO_APPROVER_ROLE],
    tid: tenant.tenantId,
    ...(issuer ? { iss: issuer } : {}),
    ...(audience ? { aud: audience } : {}),
    jti: mintId,
  } as PrincipalClaims & { jti: string };

  const token = signPrincipalToken(claims, { secret, ttlSeconds, now: () => nowMs });

  const record: ApproverTokenMintRecord = {
    kind: 'ao-approver-token-mint',
    mintId,
    mintedBy: { upn: operator.upn, subjectId: operator.subjectId },
    operatorAuth,
    ...(operatorAuth === 'passkey' ? { operatorCredentialId: input.operatorCredentialId } : {}),
    approver: { upn: approverUpn, ...(displayName ? { displayName } : {}) },
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
    // No evidence, no token.
    throw new ApproverTokenRefusal(
      'evidence_write_failed', 500,
      `the mint could not be recorded as evidence, so no token was issued: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return {
    token,
    mintId,
    approverUpn,
    tenant: record.tenant,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    ttlSeconds,
    operatorAuth,
  };
}
