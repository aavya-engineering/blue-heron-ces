// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * NS-0 (2026-10-30): EvidenceOps verification of approver tokens minted by the production issuer,
 * checked against a real (temp) ces.db WORM mint log (eo_approver_token_mints).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { signPrincipalToken, type RequestPrincipal } from 'ces-shared/http/principal';
import { mintApproverToken, AO_APPROVER_ROLE } from '../../../src/eo/approver-tokens/ApproverTokenIssuer';
import { ApproverTokenMintLog } from '../../../src/eo/approver-tokens/ApproverTokenMintLog';
import { verifyMintedApproverToken } from '../../../src/eo/approver-tokens/ApproverTokenVerifier';

const AO_SECRET = 'ao-principal-secret-for-tests-0123456789';
const OP_SECRET = 'eo-operator-secret-for-tests-9876543210';
const TENANT = { slug: 'ns0-sim-tenant', tenantId: '00000000-0000-4000-8000-00000000a500' };
const OTHER_TENANT = { slug: 'ns0-other-tenant', tenantId: '00000000-0000-4000-8000-00000000a501' };
const REVIEWER = 'reviewer.one@sim-tenant.example.test';

const operator: RequestPrincipal = Object.freeze({
  subjectId: 'op-subject-1', upn: 'operator.one@bhd.example.test', roles: ['bhd-operator'],
  verified: true, source: 'token',
});

describe('NS-0: verifyMintedApproverToken', () => {
  let tmp: string;
  let log: ApproverTokenMintLog;
  const env = { CES_AO_PRINCIPAL_SECRET: AO_SECRET, CES_EO_OPERATOR_SECRET: OP_SECRET };

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ns0-verify-'));
    log = new ApproverTokenMintLog(path.join(tmp, 'ces.db'));
  });
  afterAll(() => {
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const mint = (tenant = TENANT, now?: () => number, e: Record<string, string | undefined> = env) =>
    mintApproverToken({ operator, tenant, approverUpn: REVIEWER }, { env: e, evidence: log, ...(now ? { now } : {}) });
  const verify = (token: string | undefined, tenant = TENANT, e: Record<string, string | undefined> = env, now?: () => number) =>
    verifyMintedApproverToken(token, tenant, { mints: log, env: e, ...(now ? { now } : {}) });

  it('valid: a token from the production issuer returns the reviewer identity and its mint record', () => {
    const minted = mint();
    const r = verify(minted.token);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reviewer).toEqual(expect.objectContaining({
      upn: REVIEWER, subjectId: `ao-approver:${REVIEWER}`, tenantId: TENANT.tenantId, tokenId: minted.mintId,
    }));
    expect(r.reviewer.mint.mintId).toBe(minted.mintId);
    expect(r.reviewer.mint.mintedBy.upn).toBe(operator.upn);
  });

  it('valid: honours CES_AO_PRINCIPAL_ISSUER / _AUDIENCE the token was minted with', () => {
    const e = { ...env, CES_AO_PRINCIPAL_ISSUER: 'ces-eo', CES_AO_PRINCIPAL_AUDIENCE: 'ces-ao' };
    const minted = mint(TENANT, undefined, e);
    expect(verify(minted.token, TENANT, e).ok).toBe(true);
    expect(verify(minted.token, TENANT, { ...e, CES_AO_PRINCIPAL_AUDIENCE: 'someone-else' })).toEqual({ ok: false, reason: 'wrong_audience' });
  });

  it('expired: a token past its exp is refused', () => {
    const past = Date.now() - 2 * 3600_000;
    const minted = mint(TENANT, () => past);
    expect(verify(minted.token)).toEqual({ ok: false, reason: 'expired' });
    // Same token is valid at mint time: the refusal is expiry, not anything else.
    expect(verify(minted.token, TENANT, env, () => past + 1000).ok).toBe(true);
  });

  it('tampered: a changed payload (other reviewer UPN) fails the signature', () => {
    const minted = mint();
    const [h, p, s] = minted.token.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    claims.upn = 'someone.else@sim-tenant.example.test';
    const forged = `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`;
    expect(verify(forged)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('tampered: signed with a different secret fails the signature', () => {
    const t = signPrincipalToken(
      { sub: `ao-approver:${REVIEWER}`, upn: REVIEWER, roles: [AO_APPROVER_ROLE], tid: TENANT.tenantId, jti: randomUUID() },
      { secret: 'not-the-ao-secret-0123456789abcdef' },
    );
    expect(verify(t)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('unknown: validly signed with the shared secret but never minted (no WORM mint record) is refused', () => {
    const t = signPrincipalToken(
      { sub: `ao-approver:${REVIEWER}`, upn: REVIEWER, roles: [AO_APPROVER_ROLE], tid: TENANT.tenantId, jti: randomUUID() },
      { secret: AO_SECRET },
    );
    expect(verify(t)).toEqual({ ok: false, reason: 'unknown_mint' });
  });

  it('unknown: a real mint id re-signed for a different UPN is refused', () => {
    const minted = mint();
    const t = signPrincipalToken(
      { sub: 'ao-approver:other@sim-tenant.example.test', upn: 'other@sim-tenant.example.test', roles: [AO_APPROVER_ROLE], tid: TENANT.tenantId, jti: minted.mintId },
      { secret: AO_SECRET },
    );
    expect(verify(t)).toEqual({ ok: false, reason: 'unknown_mint' });
  });

  it('refuses a token with no jti, the wrong role, or another tenant', () => {
    const base = { sub: `ao-approver:${REVIEWER}`, upn: REVIEWER, tid: TENANT.tenantId };
    expect(verify(signPrincipalToken({ ...base, roles: [AO_APPROVER_ROLE] }, { secret: AO_SECRET })))
      .toEqual({ ok: false, reason: 'missing_token_id' });
    expect(verify(signPrincipalToken({ ...base, roles: ['bhd-operator'], jti: randomUUID() }, { secret: AO_SECRET })))
      .toEqual({ ok: false, reason: 'wrong_role' });
    const minted = mint(OTHER_TENANT);
    expect(verify(minted.token, TENANT)).toEqual({ ok: false, reason: 'wrong_tenant' });
    expect(verify(minted.token, OTHER_TENANT).ok).toBe(true);
  });

  it('refuses missing/garbage tokens and an unconfigured verifier', () => {
    expect(verify(undefined)).toEqual({ ok: false, reason: 'missing_token' });
    expect(verify('   ')).toEqual({ ok: false, reason: 'missing_token' });
    expect(verify('not.a.jwt')).toEqual({ ok: false, reason: 'malformed' });
    const minted = mint();
    expect(verify(minted.token, TENANT, {})).toEqual({ ok: false, reason: 'verifier_not_configured' });
  });
});
