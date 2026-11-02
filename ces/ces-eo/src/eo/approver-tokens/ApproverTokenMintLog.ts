// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-EO-C AO-16 (2026-09-27): the evidence trail of AdminOps approver-token mints.
//
// Every token the EvidenceOps issuer mints is recorded here BEFORE the token is handed back: who
// minted it (the authenticated BHD operator), for whom (the named approver), for which tenant, and
// when it expires. The token itself is NEVER stored — only its `jti` (the mint id), which lets a
// presented token be tied back to its mint record without the record being usable as a credential.
//
// The log is append-only by construction: this class exposes record() and list() only (no update,
// no delete), and every record gets a fresh UUID. Repo-level WORM enforcement for this collection
// needs ces-shared (DEFAULT_WORM_COLLECTIONS) — see docs/requirements/REQ-ces-shared-worm-approver-token-mints.md.

import { getCesRepository } from 'ces-shared/persistence/node';

export const APPROVER_TOKEN_MINT_COLLECTION = 'eo_approver_token_mints';

/**
 * How the minting operator authenticated (FC-EO-E): `entra` = validated Entra ID token + operator
 * group; `passkey` = a passkey registered on the EO machine (FC-EO-G); `dev-hs256-unverified` = the
 * loopback-only dev fallback; `verified-token` = any other verified principal handed to the issuer directly.
 */
export type OperatorAuthMode = 'entra' | 'passkey' | 'dev-hs256-unverified' | 'verified-token';

export interface ApproverTokenMintRecord {
  /** Evidence record kind. */
  kind: 'ao-approver-token-mint';
  /** Mint id; equals the minted token's `jti` claim. */
  mintId: string;
  /** The authenticated BHD operator who minted the token. */
  mintedBy: { upn: string; subjectId: string };
  /** How the minting operator authenticated. */
  operatorAuth: OperatorAuthMode;
  /** FC-EO-G: the passkey (credential id) the operator signed in with, for `passkey` mints. */
  operatorCredentialId?: string;
  /** The named approver the token was minted for. */
  approver: { upn: string; displayName?: string };
  tenant: { slug: string; tenantId: string };
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
  /** `iss` / `aud` stamped into the token (mirrors AdminOps' CES_AO_PRINCIPAL_ISSUER / _AUDIENCE). */
  issuer?: string;
  audience?: string;
}

export interface ApproverTokenMintSink {
  record(entry: ApproverTokenMintRecord): void;
}

export class ApproverTokenMintLog implements ApproverTokenMintSink {
  /** @param dbPath optional ces.db path (tests); default is the shared CES repository. */
  constructor(private readonly dbPath?: string) {}

  private get repo() {
    return getCesRepository(this.dbPath);
  }

  record(entry: ApproverTokenMintRecord): void {
    this.repo.put(APPROVER_TOKEN_MINT_COLLECTION, {
      id: entry.mintId,
      ces: { tenantSlug: entry.tenant.slug, tenantId: entry.tenant.tenantId },
      data: entry,
    });
  }

  /** This tenant's mint records, oldest first. */
  list(tenant: { slug: string; tenantId: string }): ApproverTokenMintRecord[] {
    return this.repo
      .list<ApproverTokenMintRecord>(APPROVER_TOKEN_MINT_COLLECTION, { tenantSlug: tenant.slug, tenantId: tenant.tenantId })
      .map((r) => r.data);
  }
}
