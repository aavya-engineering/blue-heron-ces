// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Shared minimal fixtures for AdminOps characterization tests.
import type { AoCommand } from '../src/types/AoCommand.js';
import { signPrincipalToken } from 'ces-shared/http/principal';
import { verifyApproverToken } from '../src/execution/VerifiedApprover.js';
import type { ApproverPrincipal } from '../src/execution/ApprovalStore.js';

/** Build a minimal valid AoCommand, overriding only the fields a test cares about. */
export function makeAoCommand(overrides: Partial<AoCommand> = {}): AoCommand {
  return {
    id: 'X-01',
    title: 'Test Command',
    domain: 'A',
    domainName: 'Identity & Access Management',
    trigger: 'CONFIG',
    priority: 'P2 High',
    sodTier: 'Tier 2',
    overview: 'A neutral overview with no special keywords.',
    cmmcPractices: ['AC.L1-3.1.1'],
    parameters: [],
    ...overrides,
  } as AoCommand;
}

// FX2-AO1: approvers are verified principals. Tests mint one through the PRODUCTION
// verifier (signed token -> verifyApproverToken), never by typing a name.

export const TEST_PRINCIPAL_SECRET = 'fx2-ao1-test-principal-secret-0001';

/** FC-AO-3 step 1: options for minting a test principal token beyond upn/secret/tid. */
export interface TestTokenOptions {
  /** Default `['ao-approver']` — the role required to decide an approval (FC-AO-3 step 1). Pass `[]` to mint a role-less token for a refusal test. */
  roles?: string[];
  /** Token id (`jti`), surfaced as `RequestPrincipal.tokenId` / `ApproverPrincipal.tokenId` (FC-AO-3 step 3). Omitted by default. */
  jti?: string;
}

/**
 * FC-AO-2 step 1: approver tokens are tenant-bound (`tid`), as EO's issuer mints them.
 * Pass the approval's tenant id as `tid`; omit it only to test the refusal of an unbound token.
 * FC-AO-3 step 1: carries `roles: ['ao-approver']` by default (every existing caller's token
 * decides successfully); pass `{ roles: [] }` to mint a role-less token for a refusal test.
 */
export function testPrincipalToken(
  upn: string,
  secret: string = TEST_PRINCIPAL_SECRET,
  tid?: string,
  opts: TestTokenOptions = {}
): string {
  const roles = opts.roles ?? ['ao-approver'];
  return signPrincipalToken(
    { sub: `sub-${upn}`, upn, ...(tid ? { tid } : {}), ...(roles.length ? { roles } : {}), ...(opts.jti ? { jti: opts.jti } : {}) },
    { secret }
  );
}

/** A verified approver principal whose token is minted for `tenantId` (the approval's tenant). */
export function verifiedApprover(upn: string, tenantId: string, opts: TestTokenOptions = {}): ApproverPrincipal {
  return verifyApproverToken(testPrincipalToken(upn, TEST_PRINCIPAL_SECRET, tenantId, opts), { CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET });
}
