// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-G (2026-09-28) — passkey operator sign-in as an operator-auth mode of the approver-token
 * issuer: selection rules (passkey only when configured, never alongside Entra or the dev
 * fallback), config parsing (fail closed), and the mint evidence tying a passkey mint to the
 * credential used. AdminOps' real verifier accepts the passkey-minted token.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import type { RequestPrincipal } from 'ces-shared/http/principal';
import { mintApproverToken, operatorAuthFromEnv, ApproverTokenRefusal } from '../../../src/eo/approver-tokens/ApproverTokenIssuer';
import { ApproverTokenMintLog } from '../../../src/eo/approver-tokens/ApproverTokenMintLog';
import { passkeyOperatorConfigFromEnv } from '../../../src/eo/approver-tokens/PasskeyOperatorService';
import { verifyApproverToken } from '../../../../ces-ao/src/execution/VerifiedApprover';
import { entraEnv } from './entra-test-kit';

const AO_SECRET = 'ao-principal-secret-for-passkey-unit-01';
const TENANT = { slug: 'fceog-unit-tenant', tenantId: '00000000-0000-4000-8000-0000000fce0b' };
const operator: RequestPrincipal = Object.freeze({
  subjectId: 'bhd-operator:op-1', upn: 'operator.one@bhd.example.test', roles: ['bhd-operator'], verified: true, source: 'token',
});

function refusal(fn: () => unknown) {
  try { fn(); } catch (e) { if (e instanceof ApproverTokenRefusal) return { code: e.code, status: e.status }; throw e; }
  throw new Error('expected a refusal');
}

describe('FC-EO-G: passkey operator auth mode', () => {
  it('passkey mode is selected by CES_EO_OPERATOR_PASSKEY_ORIGIN; RP id defaults to the host name', () => {
    const a = operatorAuthFromEnv({ CES_EO_OPERATOR_PASSKEY_ORIGIN: 'http://localhost:5004' });
    expect(a).toMatchObject({ mode: 'passkey', config: { origin: 'http://localhost:5004', rpId: 'localhost', sessionTtlSeconds: 900 } });
    const b = operatorAuthFromEnv({ CES_EO_OPERATOR_PASSKEY_ORIGIN: 'https://eo.ops.example.test', CES_EO_OPERATOR_PASSKEY_RP_ID: 'ops.example.test' });
    expect(b).toMatchObject({ mode: 'passkey', config: { rpId: 'ops.example.test' } });
  });

  it('is never combined with Entra or the dev fallback (fail closed)', () => {
    const pk = { CES_EO_OPERATOR_PASSKEY_ORIGIN: 'http://localhost:5004' };
    expect(refusal(() => operatorAuthFromEnv({ ...pk, ...entraEnv() }))).toMatchObject({ code: 'operator_auth_misconfigured', status: 503 });
    expect(refusal(() => operatorAuthFromEnv({ ...pk, CES_EO_OPERATOR_DEV_FALLBACK: '1' }))).toMatchObject({ code: 'operator_auth_misconfigured', status: 503 });
    // An RP id alone (no origin) is a half configuration.
    expect(refusal(() => operatorAuthFromEnv({ CES_EO_OPERATOR_PASSKEY_RP_ID: 'localhost' }))).toMatchObject({ code: 'operator_auth_not_configured' });
  });

  it('refuses unsafe passkey settings', () => {
    const bad = (e: Record<string, string>) => passkeyOperatorConfigFromEnv(e).ok;
    expect(bad({ CES_EO_OPERATOR_PASSKEY_ORIGIN: 'http://eo.example.test' })).toBe(false); // plain http off-box
    expect(bad({ CES_EO_OPERATOR_PASSKEY_ORIGIN: 'http://127.0.0.1:5004' })).toBe(false); // IP is not an RP id
    expect(bad({ CES_EO_OPERATOR_PASSKEY_ORIGIN: 'http://localhost:5004/x' })).toBe(false); // not an origin
    expect(bad({ CES_EO_OPERATOR_PASSKEY_ORIGIN: 'http://localhost:5004', CES_EO_OPERATOR_PASSKEY_RP_ID: 'example.test' })).toBe(false);
    expect(bad({ CES_EO_OPERATOR_PASSKEY_ORIGIN: 'http://localhost:5004', CES_EO_OPERATOR_SESSION_TTL_SECONDS: '901' })).toBe(false);
    expect(passkeyOperatorConfigFromEnv({ CES_EO_OPERATOR_PASSKEY_ORIGIN: 'http://localhost:5004', CES_EO_OPERATOR_SESSION_TTL_SECONDS: '300' }))
      .toMatchObject({ ok: true, config: { sessionTtlSeconds: 300 } });
  });

  describe('mint evidence', () => {
    let tmp: string;
    let log: ApproverTokenMintLog;
    beforeAll(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-eo-g-unit-'));
      log = new ApproverTokenMintLog(path.join(tmp, 'ces.db'));
    });
    afterAll(() => {
      closeAllCesRepositories();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('a passkey mint records the credential id; AdminOps accepts the token', () => {
      const m = mintApproverToken(
        { operator, tenant: TENANT, approverUpn: 'approver@unit-tenant.example.test', operatorAuthMode: 'passkey', operatorCredentialId: 'cred-abc' },
        { env: { CES_AO_PRINCIPAL_SECRET: AO_SECRET }, evidence: log },
      );
      expect(m.operatorAuth).toBe('passkey');
      const row = log.list({ slug: TENANT.slug, tenantId: TENANT.tenantId }).find(r => r.mintId === m.mintId)!;
      expect(row).toMatchObject({ operatorAuth: 'passkey', operatorCredentialId: 'cred-abc', mintedBy: { upn: operator.upn } });
      expect(JSON.stringify(row)).not.toContain(m.token);
      expect(verifyApproverToken(m.token, { CES_AO_PRINCIPAL_SECRET: AO_SECRET } as NodeJS.ProcessEnv).upn).toBe('approver@unit-tenant.example.test');
    });

    it('a passkey mint without the credential id is refused', () => {
      expect(refusal(() => mintApproverToken(
        { operator, tenant: TENANT, approverUpn: 'approver@unit-tenant.example.test', operatorAuthMode: 'passkey' },
        { env: { CES_AO_PRINCIPAL_SECRET: AO_SECRET }, evidence: log },
      ))).toMatchObject({ code: 'not_operator', status: 403 });
    });
  });
});
