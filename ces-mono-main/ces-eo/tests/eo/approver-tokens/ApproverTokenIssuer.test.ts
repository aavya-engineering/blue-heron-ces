// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-C AO-16 (2026-09-27) — the EvidenceOps approver-token issuer, proven against AdminOps'
 * REAL verification function (`verifyApproverToken`, ces-ao src/execution/VerifiedApprover.ts,
 * imported read-only). Every refusal the founder decision names is exercised on the production
 * issuer; the mint evidence row is read back from a real (temp) ces.db and must not contain the token.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { signPrincipalToken, type RequestPrincipal } from 'ces-shared/http/principal';
import {
  mintApproverToken,
  operatorVerifierFromEnv,
  operatorAuthFromEnv,
  ApproverTokenRefusal,
  DEFAULT_APPROVER_TOKEN_TTL_SECONDS,
  MAX_APPROVER_TOKEN_TTL_SECONDS,
  type MintApproverTokenInput,
} from '../../../src/eo/approver-tokens/ApproverTokenIssuer';
import { ApproverTokenMintLog } from '../../../src/eo/approver-tokens/ApproverTokenMintLog';
// AdminOps' real verifier (read-only import from the sibling module).
import { verifyApproverToken, ApproverIdentityError } from '../../../../ces-ao/src/execution/VerifiedApprover';

const AO_SECRET = 'ao-principal-secret-for-tests-0123456789';
const OP_SECRET = 'eo-operator-secret-for-tests-9876543210';
const TENANT = { slug: 'fceoc-sim-tenant', tenantId: '00000000-0000-4000-8000-0000000fc0c1' };
const APPROVER = 'approver.one@sim-tenant.example.test';

const operator: RequestPrincipal = Object.freeze({
  subjectId: 'op-subject-1', upn: 'operator.one@bhd.example.test', roles: ['bhd-operator'],
  verified: true, source: 'token',
});

describe('FC-EO-C AO-16: approver-token issuer', () => {
  let tmp: string;
  let log: ApproverTokenMintLog;
  const env = { CES_AO_PRINCIPAL_SECRET: AO_SECRET, CES_EO_OPERATOR_SECRET: OP_SECRET };
  const aoEnv = { CES_AO_PRINCIPAL_SECRET: AO_SECRET } as NodeJS.ProcessEnv;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-eo-c-'));
    log = new ApproverTokenMintLog(path.join(tmp, 'ces.db'));
  });
  afterAll(() => {
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const input = (over: Partial<MintApproverTokenInput> = {}): MintApproverTokenInput =>
    ({ operator, tenant: TENANT, approverUpn: APPROVER, ...over });
  const mint = (over: Partial<MintApproverTokenInput> = {}, e: Record<string, string | undefined> = env, now?: () => number) =>
    mintApproverToken(input(over), { env: e, evidence: log, ...(now ? { now } : {}) });

  function refusal(fn: () => unknown): ApproverTokenRefusal {
    try { fn(); } catch (e) { if (e instanceof ApproverTokenRefusal) return e; throw e; }
    throw new Error('expected an ApproverTokenRefusal, but the call succeeded');
  }

  describe('a token minted by the production issuer', () => {
    it('is accepted by AdminOps verifyApproverToken as the named approver', () => {
      const minted = mint();
      const p = verifyApproverToken(minted.token, aoEnv);
      expect(p).toEqual(expect.objectContaining({ upn: APPROVER, verified: true, source: 'token' }));
      expect(minted.ttlSeconds).toBe(DEFAULT_APPROVER_TOKEN_TTL_SECONDS);
    });

    it('is tenant-scoped (tid = tenant GUID) and carries its mint id as jti', () => {
      const minted = mint();
      const claims = JSON.parse(Buffer.from(minted.token.split('.')[1], 'base64url').toString('utf8'));
      expect(claims.tid).toBe(TENANT.tenantId);
      expect(claims.jti).toBe(minted.mintId);
      expect(claims.exp - claims.iat).toBe(DEFAULT_APPROVER_TOKEN_TTL_SECONDS);
    });

    it('carries iss/aud when AdminOps requires them, and AdminOps accepts it', () => {
      const e = { ...env, CES_AO_PRINCIPAL_ISSUER: 'ces-eo', CES_AO_PRINCIPAL_AUDIENCE: 'ces-ao' };
      const minted = mint({}, e);
      expect(verifyApproverToken(minted.token, { ...aoEnv, CES_AO_PRINCIPAL_ISSUER: 'ces-eo', CES_AO_PRINCIPAL_AUDIENCE: 'ces-ao' }).upn)
        .toBe(APPROVER);
    });

    it('is refused by AdminOps when tampered (signature or payload)', () => {
      const { token } = mint();
      const [h, p, s] = token.split('.');
      const flipped = s.slice(0, -2) + (s.at(-2) === 'A' ? 'B' : 'A') + s.at(-1);
      expect(() => verifyApproverToken(`${h}.${p}.${flipped}`, aoEnv)).toThrow(/bad_signature/);
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
      const forged = Buffer.from(JSON.stringify({ ...claims, upn: 'someone.else@sim-tenant.example.test' })).toString('base64url');
      expect(() => verifyApproverToken(`${h}.${forged}.${s}`, aoEnv)).toThrow(ApproverIdentityError);
      expect(() => verifyApproverToken(`${h}.${forged}.${s}`, aoEnv)).toThrow(/bad_signature/);
    });

    it('is refused by AdminOps once expired', () => {
      const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
      const { token } = mint({ ttlSeconds: 60 }, env, () => twoHoursAgo);
      expect(() => verifyApproverToken(token, aoEnv)).toThrow(/expired/);
    });

    it('is refused by AdminOps when signed for a different secret (operator secret is not the AO secret)', () => {
      const { token } = mint();
      expect(() => verifyApproverToken(token, { CES_AO_PRINCIPAL_SECRET: 'some-other-ao-secret-0000000000' } as NodeJS.ProcessEnv))
        .toThrow(/bad_signature/);
    });
  });

  describe('refusals', () => {
    it('non-operator callers: none, unverified dev principal, verified principal without the role', () => {
      expect(refusal(() => mint({ operator: undefined }))).toMatchObject({ code: 'not_operator', status: 401 });
      expect(refusal(() => mint({ operator: { ...operator, verified: false, source: 'dev-unverified' } })))
        .toMatchObject({ code: 'not_operator', status: 403 });
      expect(refusal(() => mint({ operator: { ...operator, roles: ['ao-approver', 'reader'] } })))
        .toMatchObject({ code: 'not_operator', status: 403 });
    });

    it('FC-EO-E: a dev-unverified operator mints only with the explicit allowDevOperator opt-in, recorded as unverified', () => {
      const dev: RequestPrincipal = { ...operator, verified: false, source: 'dev-unverified' };
      expect(refusal(() => mint({ operator: dev }))).toMatchObject({ code: 'not_operator', status: 403 });
      expect(refusal(() => mint({ operator: dev, allowDevOperator: false }))).toMatchObject({ code: 'not_operator', status: 403 });
      // The opt-in never upgrades a principal without the operator role.
      expect(refusal(() => mint({ operator: { ...dev, roles: ['reader'] }, allowDevOperator: true })))
        .toMatchObject({ code: 'not_operator', status: 403 });
      const minted = mint({ operator: dev, allowDevOperator: true });
      expect(minted.operatorAuth).toBe('dev-hs256-unverified');
      expect(log.list(TENANT).find(r => r.mintId === minted.mintId)?.operatorAuth).toBe('dev-hs256-unverified');
      // Claiming 'entra' does not relabel a dev principal.
      expect(mint({ operator: dev, allowDevOperator: true, operatorAuthMode: 'entra' }).operatorAuth).toBe('dev-hs256-unverified');
    });

    it('FC-EO-E: the HS256 dev verifier marks every principal unverified', () => {
      const v = operatorVerifierFromEnv(env);
      const r = v.verify(signPrincipalToken({ sub: 's', upn: 'op@bhd.example.test', roles: ['bhd-operator'] }, { secret: OP_SECRET }));
      expect(r).toMatchObject({ ok: true, principal: { verified: false, source: 'dev-unverified', roles: ['bhd-operator'] } });
    });

    it('FC-EO-E: operatorAuthFromEnv - Entra is the default path; HS256 only behind the dev flag; never both', () => {
      const entra = {
        CES_EO_OPERATOR_ENTRA_TENANT_ID: '00000000-0000-4000-8000-00000000e0e0',
        CES_EO_OPERATOR_ENTRA_CLIENT_ID: '00000000-0000-4000-8000-00000000c1c1',
        CES_EO_OPERATOR_ENTRA_GROUP_ID: '00000000-0000-4000-8000-00000000a9a9',
      };
      expect(operatorAuthFromEnv({ ...env, ...entra })).toMatchObject({ mode: 'entra', config: { tenantId: entra.CES_EO_OPERATOR_ENTRA_TENANT_ID } });
      expect(refusal(() => operatorAuthFromEnv(env))).toMatchObject({ code: 'operator_auth_not_configured', status: 503 });
      expect(operatorAuthFromEnv({ ...env, CES_EO_OPERATOR_DEV_FALLBACK: '1' }).mode).toBe('dev-hs256');
      expect(refusal(() => operatorAuthFromEnv({ ...env, ...entra, CES_EO_OPERATOR_DEV_FALLBACK: '1' })))
        .toMatchObject({ code: 'operator_auth_misconfigured', status: 503 });
      expect(refusal(() => operatorAuthFromEnv({ CES_EO_OPERATOR_ENTRA_TENANT_ID: entra.CES_EO_OPERATOR_ENTRA_TENANT_ID })))
        .toMatchObject({ code: 'operator_auth_not_configured' });
    });

    it('missing or too-short AdminOps secret', () => {
      expect(refusal(() => mint({}, { CES_EO_OPERATOR_SECRET: OP_SECRET }))).toMatchObject({ code: 'issuer_not_configured', status: 503 });
      expect(refusal(() => mint({}, { ...env, CES_AO_PRINCIPAL_SECRET: 'short' }))).toMatchObject({ code: 'issuer_not_configured' });
    });

    it('operator secret reused as the AdminOps secret', () => {
      expect(refusal(() => mint({}, { CES_AO_PRINCIPAL_SECRET: AO_SECRET, CES_EO_OPERATOR_SECRET: AO_SECRET })))
        .toMatchObject({ code: 'secret_reuse', status: 503 });
      expect(refusal(() => operatorVerifierFromEnv({ CES_AO_PRINCIPAL_SECRET: AO_SECRET, CES_EO_OPERATOR_SECRET: AO_SECRET })))
        .toMatchObject({ code: 'secret_reuse' });
      expect(refusal(() => operatorVerifierFromEnv({ CES_AO_PRINCIPAL_SECRET: AO_SECRET })))
        .toMatchObject({ code: 'operator_auth_not_configured', status: 503 });
    });

    it('missing tenant', () => {
      expect(refusal(() => mint({ tenant: undefined }))).toMatchObject({ code: 'tenant_required', status: 400 });
      expect(refusal(() => mint({ tenant: { slug: TENANT.slug, tenantId: '' } }))).toMatchObject({ code: 'tenant_required' });
    });

    it('empty or malformed approver', () => {
      for (const a of [undefined, '', '   ', 42]) {
        expect(refusal(() => mint({ approverUpn: a }))).toMatchObject({ code: 'approver_required', status: 400 });
      }
      for (const a of ['not-a-upn', 'two words@x.test', 'a@b']) {
        expect(refusal(() => mint({ approverUpn: a }))).toMatchObject({ code: 'approver_invalid', status: 400 });
      }
    });

    it('an operator minting for themselves', () => {
      expect(refusal(() => mint({ approverUpn: operator.upn.toUpperCase() }))).toMatchObject({ code: 'self_mint', status: 403 });
    });

    it('excessive or invalid lifetime', () => {
      expect(refusal(() => mint({ ttlSeconds: MAX_APPROVER_TOKEN_TTL_SECONDS + 1 }))).toMatchObject({ code: 'ttl_excessive', status: 400 });
      expect(refusal(() => mint({ ttlSeconds: 24 * 3600 }))).toMatchObject({ code: 'ttl_excessive' });
      for (const t of [0, -5, 1.5, '900']) {
        expect(refusal(() => mint({ ttlSeconds: t }))).toMatchObject({ code: 'ttl_invalid', status: 400 });
      }
      expect(mint({ ttlSeconds: MAX_APPROVER_TOKEN_TTL_SECONDS }).ttlSeconds).toBe(MAX_APPROVER_TOKEN_TTL_SECONDS);
    });

    it('a failed evidence write yields no token', () => {
      const broken = { record: () => { throw new Error('disk full'); } };
      expect(refusal(() => mintApproverToken(input(), { env, evidence: broken })))
        .toMatchObject({ code: 'evidence_write_failed', status: 500 });
    });
  });

  describe('mint evidence', () => {
    it('records who, for whom, tenant and expiry — and never the token', () => {
      const before = log.list(TENANT).length;
      const minted = mint({ approverDisplayName: 'Approver One', ttlSeconds: 300 });
      const rows = log.list(TENANT);
      expect(rows.length).toBe(before + 1);
      const row = rows.find(r => r.mintId === minted.mintId)!;
      expect(row).toEqual({
        kind: 'ao-approver-token-mint',
        mintId: minted.mintId,
        mintedBy: { upn: operator.upn, subjectId: operator.subjectId },
        operatorAuth: 'verified-token',
        approver: { upn: APPROVER, displayName: 'Approver One' },
        tenant: TENANT,
        issuedAt: minted.issuedAt,
        expiresAt: minted.expiresAt,
        ttlSeconds: 300,
      });
      expect(Date.parse(row.expiresAt) - Date.parse(row.issuedAt)).toBe(300 * 1000);
      const serialized = JSON.stringify(row);
      const [, payload, sig] = minted.token.split('.');
      expect(serialized).not.toContain(minted.token);
      expect(serialized).not.toContain(payload);
      expect(serialized).not.toContain(sig);
    });

    it('a refused mint writes no row; rows are tenant-scoped', () => {
      const before = log.list(TENANT).length;
      refusal(() => mint({ ttlSeconds: MAX_APPROVER_TOKEN_TTL_SECONDS * 10 }));
      refusal(() => mint({ operator: undefined }));
      expect(log.list(TENANT).length).toBe(before);
      expect(log.list({ slug: 'other-tenant', tenantId: '00000000-0000-4000-8000-0000000fc0c2' })).toEqual([]);
    });
  });
});
