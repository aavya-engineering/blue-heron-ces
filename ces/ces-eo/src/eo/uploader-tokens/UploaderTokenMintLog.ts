// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31: the evidence trail of EC uploader-token mints (UploaderTokenIssuer.ts). Who minted, for
// which uploader, which tenant, when it expires; never the token (only its `jti` = mintId).
//
// Append-only by construction: record() puts under a fresh UUID and refuses an id already present;
// there is no update or delete. Repository-level WORM enforcement needs the collection name in
// ces-shared DEFAULT_WORM_COLLECTIONS — filed as a requirement in LOG-FIN-31.md (not this slice's file).

import { getCesRepository } from 'ces-shared/persistence/node';
import type { OperatorAuthMode } from '../approver-tokens/ApproverTokenMintLog.js';

export const UPLOADER_TOKEN_MINT_COLLECTION = 'eo_uploader_token_mints';

export interface UploaderTokenMintRecord {
  kind: 'ec-uploader-token-mint';
  /** Equals the minted token's `jti` claim. */
  mintId: string;
  mintedBy: { upn: string; subjectId: string };
  operatorAuth: OperatorAuthMode;
  operatorCredentialId?: string;
  uploader: { upn: string; displayName?: string };
  tenant: { slug: string; tenantId: string };
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
  issuer?: string;
  audience?: string;
}

export interface UploaderTokenMintSink {
  record(entry: UploaderTokenMintRecord): void;
}

export class UploaderTokenMintLog implements UploaderTokenMintSink {
  constructor(private readonly dbPath?: string) {}

  private get repo() {
    return getCesRepository(this.dbPath);
  }

  record(entry: UploaderTokenMintRecord): void {
    const scope = { tenantSlug: entry.tenant.slug, tenantId: entry.tenant.tenantId };
    if (this.repo.get(UPLOADER_TOKEN_MINT_COLLECTION, entry.mintId, scope)) {
      throw new Error(`uploader-token mint ${entry.mintId} already recorded (append-only)`);
    }
    this.repo.put(UPLOADER_TOKEN_MINT_COLLECTION, {
      id: entry.mintId,
      ces: scope,
      data: entry,
    });
  }

  /** This tenant's mint records, oldest first. */
  list(tenant: { slug: string; tenantId: string }): UploaderTokenMintRecord[] {
    return this.repo
      .list<UploaderTokenMintRecord>(UPLOADER_TOKEN_MINT_COLLECTION, { tenantSlug: tenant.slug, tenantId: tenant.tenantId })
      .map((r) => r.data);
  }
}
