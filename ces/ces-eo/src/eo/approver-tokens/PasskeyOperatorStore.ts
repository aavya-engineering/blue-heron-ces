// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-EO-G (2026-09-28, founder decisions 16-19): BHD operators prove identity to the approver-token
// issuer with passkeys registered on the EvidenceOps machine (BHD has no Microsoft tenant).
//
// Three collections in EO's CES store, all under the fixed scope `bhd-operators` (operators are
// BHD's, not a customer tenant's):
//
//   eo_operator_passkeys            one record per registered passkey (operator id, display name,
//                                   UPN, credential id, public key, sign counter, created, last used,
//                                   revoked). Mutable: the counter and last-used move on every
//                                   sign-in; revocation sets revokedAt (the record is kept).
//   eo_operator_enrollment_codes    one-time enrollment codes, stored by SHA-256 hash only, 10-minute
//                                   expiry, consumed on successful enrollment.
//   eo_operator_passkey_events      the evidence trail: code issued, passkey enrolled, passkey
//                                   revoked. Append-only by construction (record/list only, fresh
//                                   id per event). Repo-level WORM enforcement needs ces-shared —
//                                   see docs/requirements/REQ-ces-shared-worm-operator-passkey-events.md.

import { randomUUID } from 'node:crypto';
import { getCesRepository } from 'ces-shared/persistence/node';

export const OPERATOR_PASSKEY_COLLECTION = 'eo_operator_passkeys';
export const OPERATOR_ENROLLMENT_CODE_COLLECTION = 'eo_operator_enrollment_codes';
export const OPERATOR_PASSKEY_EVENT_COLLECTION = 'eo_operator_passkey_events';
/** Scope of every operator record: BHD's own operators, not a customer tenant. */
export const OPERATOR_SCOPE = Object.freeze({ tenantSlug: 'bhd-operators' });

export interface OperatorIdentity {
  operatorId: string;
  displayName: string;
  /** The operator's own sign-in address; the no-self-issue mint rule compares against it. */
  upn: string;
}

export interface OperatorPasskeyRecord extends OperatorIdentity {
  /** WebAuthn credential id (base64url). */
  credentialId: string;
  /** COSE public key (base64url). */
  publicKey: string;
  /** Last accepted signature counter. */
  counter: number;
  transports?: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: EventActor;
}

/** Who performed an enrollment / revocation. */
export type EventActor =
  | { kind: 'local-command' }
  | { kind: 'operator'; operatorId: string; upn: string; credentialId: string };

export interface EnrollmentCodeRecord extends OperatorIdentity {
  /** SHA-256 (hex) of the code; the code itself is never stored. */
  codeHash: string;
  issuedAt: string;
  expiresAt: string;
  issuedBy: EventActor;
  usedAt?: string;
  /** The passkey enrolled with this code. */
  credentialId?: string;
}

export type OperatorPasskeyEventKind =
  | 'operator-enrollment-code-issued'
  | 'operator-passkey-enrolled'
  | 'operator-passkey-revoked';

export interface OperatorPasskeyEvent {
  kind: OperatorPasskeyEventKind;
  eventId: string;
  at: string;
  operator: OperatorIdentity;
  by: EventActor;
  credentialId?: string;
  /** Code expiry (code-issued events). */
  expiresAt?: string;
}

export class PasskeyOperatorStore {
  /** @param dbPath optional ces.db path (tests); default is the shared CES repository. */
  constructor(private readonly dbPath?: string) {}

  private get repo() {
    return getCesRepository(this.dbPath);
  }

  // ---- passkeys --------------------------------------------------------------------------------
  addPasskey(rec: OperatorPasskeyRecord): void {
    if (this.getPasskey(rec.credentialId)) throw new Error(`passkey ${rec.credentialId} is already registered`);
    this.repo.put(OPERATOR_PASSKEY_COLLECTION, { id: rec.credentialId, ces: OPERATOR_SCOPE, data: rec });
  }

  getPasskey(credentialId: string): OperatorPasskeyRecord | undefined {
    return this.repo.get<OperatorPasskeyRecord>(OPERATOR_PASSKEY_COLLECTION, credentialId, OPERATOR_SCOPE)?.data;
  }

  listPasskeys(): OperatorPasskeyRecord[] {
    return this.repo.list<OperatorPasskeyRecord>(OPERATOR_PASSKEY_COLLECTION, OPERATOR_SCOPE).map((r) => r.data);
  }

  updatePasskey(credentialId: string, patch: Partial<OperatorPasskeyRecord>): void {
    this.repo.update<OperatorPasskeyRecord>(OPERATOR_PASSKEY_COLLECTION, credentialId, OPERATOR_SCOPE, patch);
  }

  // ---- enrollment codes ------------------------------------------------------------------------
  addEnrollmentCode(rec: EnrollmentCodeRecord): void {
    this.repo.put(OPERATOR_ENROLLMENT_CODE_COLLECTION, { id: rec.codeHash, ces: OPERATOR_SCOPE, data: rec });
  }

  getEnrollmentCode(codeHash: string): EnrollmentCodeRecord | undefined {
    return this.repo.get<EnrollmentCodeRecord>(OPERATOR_ENROLLMENT_CODE_COLLECTION, codeHash, OPERATOR_SCOPE)?.data;
  }

  updateEnrollmentCode(codeHash: string, patch: Partial<EnrollmentCodeRecord>): void {
    this.repo.update<EnrollmentCodeRecord>(OPERATOR_ENROLLMENT_CODE_COLLECTION, codeHash, OPERATOR_SCOPE, patch);
  }

  // ---- evidence (append-only) ------------------------------------------------------------------
  recordEvent(e: Omit<OperatorPasskeyEvent, 'eventId'>): OperatorPasskeyEvent {
    const event: OperatorPasskeyEvent = { ...e, eventId: randomUUID() };
    this.repo.put(OPERATOR_PASSKEY_EVENT_COLLECTION, { id: event.eventId, ces: OPERATOR_SCOPE, data: event });
    return event;
  }

  listEvents(): OperatorPasskeyEvent[] {
    return this.repo.list<OperatorPasskeyEvent>(OPERATOR_PASSKEY_EVENT_COLLECTION, OPERATOR_SCOPE).map((r) => r.data);
  }
}
