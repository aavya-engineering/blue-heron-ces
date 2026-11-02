// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// NS-0 (2026-10-30): EvidenceOps-side verification of the approver tokens ApproverTokenIssuer mints.
//
// Until now EO only minted these tokens; only AdminOps checked them. A reviewer identity that EO
// itself relies on (NS-1 document reviews) must be checked here, against the same rules the issuer
// minted under:
//   * signature + expiry (+ iss/aud when configured): ces-shared createHs256PrincipalVerifier with
//     CES_AO_PRINCIPAL_SECRET / CES_AO_PRINCIPAL_ISSUER / CES_AO_PRINCIPAL_AUDIENCE — the issuer's settings;
//   * a verified token principal holding the `ao-approver` role;
//   * tenant-scoped: `tid` must equal the tenant's GUID;
//   * a known mint: the token's `jti` must name a record in the WORM mint log (eo_approver_token_mints)
//     for this tenant, minted for the same approver UPN. A validly signed token with no mint record
//     (e.g. signed directly with the shared secret) is refused as `unknown_mint`.
// There is no revocation list today: the mint log is append-only and holds no revoked flag, so the
// mint-record check is the only "is this a token we issued" check. Short lifetimes (<= 30 min) bound
// exposure. Revocation, if wanted, is a separate change.

import { createHs256PrincipalVerifier, type PrincipalVerifyFailure } from 'ces-shared/http/principal';
import { AO_APPROVER_ROLE } from './ApproverTokenIssuer.js';
import type { ApproverTokenMintRecord } from './ApproverTokenMintLog.js';
import { secretEnv } from 'ces-shared/secrets'; // FIN-42 (SP-4): module-secret view

const MIN_SECRET_LENGTH = 16;

type Env = Record<string, string | undefined>;

export type ApproverTokenVerifyFailure =
  | PrincipalVerifyFailure
  | 'missing_token'
  | 'verifier_not_configured'
  | 'not_verified'
  | 'wrong_role'
  | 'wrong_tenant'
  | 'missing_token_id'
  | 'unknown_mint';

/** The reviewer identity a valid approver token proves. */
export interface VerifiedReviewer {
  upn: string;
  subjectId: string;
  displayName?: string;
  tenantId: string;
  /** The token's jti = the mint record's mintId. */
  tokenId: string;
  /** Token expiry, epoch seconds. */
  expiresAt?: number;
  /** The WORM mint record the token was issued under. */
  mint: ApproverTokenMintRecord;
}

export type ApproverTokenVerifyResult =
  | { ok: true; reviewer: VerifiedReviewer }
  | { ok: false; reason: ApproverTokenVerifyFailure };

/** Read access to the mint log (ApproverTokenMintLog satisfies it). */
export interface ApproverTokenMintSource {
  list(tenant: { slug: string; tenantId: string }): ApproverTokenMintRecord[];
}

export interface VerifyApproverTokenDeps {
  mints: ApproverTokenMintSource;
  env?: Env;
  /** Clock (epoch ms). Injectable for tests. */
  now?: () => number;
}

/** Verify an approver token for `tenant`. Never throws on a bad token; returns a reason instead. */
export function verifyMintedApproverToken(
  token: string | undefined,
  tenant: { slug: string; tenantId: string },
  deps: VerifyApproverTokenDeps,
): ApproverTokenVerifyResult {
  if (typeof token !== 'string' || !token.trim()) return { ok: false, reason: 'missing_token' };
  const env = deps.env ?? secretEnv();
  const secret = env.CES_AO_PRINCIPAL_SECRET;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: 'verifier_not_configured' };

  const verifier = createHs256PrincipalVerifier({
    secret,
    ...(env.CES_AO_PRINCIPAL_ISSUER ? { issuer: env.CES_AO_PRINCIPAL_ISSUER } : {}),
    ...(env.CES_AO_PRINCIPAL_AUDIENCE ? { audience: env.CES_AO_PRINCIPAL_AUDIENCE } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  const r = verifier.verify(token.trim().replace(/^Bearer\s+/i, ''));
  if (!r.ok) return { ok: false, reason: r.reason };
  const p = r.principal;
  if (!p.verified || p.source !== 'token') return { ok: false, reason: 'not_verified' };
  if (!p.roles.includes(AO_APPROVER_ROLE)) return { ok: false, reason: 'wrong_role' };
  if (p.tenantId !== tenant.tenantId) return { ok: false, reason: 'wrong_tenant' };
  if (typeof p.tokenId !== 'string' || !p.tokenId) return { ok: false, reason: 'missing_token_id' };

  const mint = deps.mints.list(tenant).find((m) => m.mintId === p.tokenId);
  if (
    !mint ||
    mint.tenant.tenantId !== tenant.tenantId ||
    mint.approver.upn.toLowerCase() !== p.upn.toLowerCase()
  ) {
    return { ok: false, reason: 'unknown_mint' };
  }

  return {
    ok: true,
    reviewer: {
      upn: p.upn,
      subjectId: p.subjectId,
      ...(p.displayName ? { displayName: p.displayName } : {}),
      tenantId: tenant.tenantId,
      tokenId: p.tokenId,
      ...(typeof p.expiresAt === 'number' ? { expiresAt: p.expiresAt } : {}),
      mint,
    },
  };
}
