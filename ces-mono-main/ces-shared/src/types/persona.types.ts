// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Canonical end-user persona model (P1–P8). Previously the personas lived only as prose in
// docs/tenant-tests/END-USER-USE-CASES.md and were hardcoded again in the tenant-tests dashboard.
// This is the single shared definition + the persona→control map that the EO persona projection
// and any persona-facing view consume.

export type CuiAccess = 'full' | 'none' | 'pending' | 'revoked' | 'constrained';

export interface Persona {
  id: string;                 // "P1".."P8"
  title: string;              // "CUI Engineer"
  description: string;        // one-line role summary
  cuiAccess: CuiAccess;
  /** Controls this persona is OPERATIONALLY responsible for / whose deficiencies are theirs. */
  controls: string[];         // full control ids, e.g. "AC.L2-3.1.7"
  /** Whether this persona is gated on awareness training before/for access (AT.L2-3.2.2). */
  trainingGated?: boolean;
  /** Whether this persona is a personnel-lifecycle subject (screening / offboarding). */
  personnelSubject?: boolean;
}

export interface PersonaReference {
  personas: Persona[];
}
