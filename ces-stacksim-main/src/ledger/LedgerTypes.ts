// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

export type LedgerEntryType = 'create' | 'mutate' | 'read-serve';

export type LedgerActor = 'stamper' | 'ao' | 'eo' | 'probe';

export interface LedgerEntry {
  ts: string;
  type: LedgerEntryType;
  objectType: string;
  objectId: string;
  actor: LedgerActor;
  source: string;
  milestone: string;
  sessionType: string;
  requestId: string;
}

export interface LedgerQuery {
  type?: LedgerEntryType;
  objectType?: string;
  id?: string;
  from?: string;
  to?: string;
  actor?: LedgerActor;
}
