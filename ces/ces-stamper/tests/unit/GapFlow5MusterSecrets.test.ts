// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Gap closure FLOW-5 (a): the command line resolves muster-api-issued secret references
// (POST /api/plan/secrets/resolve) into SecretStore before loadPlan; buildSecretOverlay then
// resolves the plan's reference. The value never appears in a returned line.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSecretOverlay, fetchMusterSecrets, primeMusterSecrets } from '../../src/core/SecretResolver';
import { SecretStore } from '../../src/core/SecretStore';
import type { SecretReference } from 'ces-shared/types/mission-plan';

const REF = 'secretref:one-time:11111111-2222-3333-4444-555555555555';
const VALUE = 'Abc-def_ghi.jkl0123456789';
const refs: SecretReference[] = [{ variable: 'initialPassword', form: 'one_time_operator_held', ref: REF }];
const ENV = { CES_MUSTER_SECRETS_URL: 'http://127.0.0.1:4011/', CES_MUSTER_SECRETS_TOKEN: 'tok' };

function fakeFetch(status: number, body: unknown, calls: Array<{ url: string; init: RequestInit }> = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

afterEach(() => SecretStore.clearAll());

describe('fetchMusterSecrets (FLOW-5 a)', () => {
  it('posts the tenant slug and reference with the bearer token and keeps the value in memory only', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const r = await fetchMusterSecrets(refs, 's1-mach', ENV, fakeFetch(200, { ref: REF, variable: 'initialPassword', value: VALUE }, calls));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:4011/api/plan/secrets/resolve');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ tenant_slug: 's1-mach', ref: REF });
    expect(r.operatorHeld).toEqual({ [REF]: VALUE });
    expect(r.lines).toEqual([`Secret reference ${REF} for initialPassword: resolved from muster-api (held in memory only)`]);
    expect(r.lines.join('\n')).not.toContain(VALUE);
  });

  it('fetches nothing without CES_MUSTER_SECRETS_URL or without operator-held references', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    expect(await fetchMusterSecrets(refs, 's1', {}, fakeFetch(200, {}, calls))).toEqual({ operatorHeld: {}, lines: [] });
    const kv: SecretReference[] = [{ variable: 'initialPassword', form: 'key_vault_secret', vault: 'v', name: 'n' }];
    expect(await fetchMusterSecrets(kv, 's1', ENV, fakeFetch(200, {}, calls))).toEqual({ operatorHeld: {}, lines: [] });
    expect(calls).toHaveLength(0);
  });

  it('reports, never throws, a reference muster-api does not hold or an unreachable muster-api', async () => {
    const r404 = await fetchMusterSecrets(refs, 's1', ENV, fakeFetch(404, { error: 'No such secret reference for this tenant' }));
    expect(r404.operatorHeld).toEqual({});
    expect(r404.lines[0]).toContain('NOT resolved by muster-api (HTTP 404)');
    const down = await fetchMusterSecrets(refs, 's1', ENV, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    expect(down.lines[0]).toContain('muster-api unreachable: ECONNREFUSED');
    const wrongVar = await fetchMusterSecrets(refs, 's1', ENV, fakeFetch(200, { variable: 'other', value: VALUE }));
    expect(wrongVar.operatorHeld).toEqual({});
  });
});

describe('primeMusterSecrets (FLOW-5 a)', () => {
  it('installs the value under the reference so the plan overlay resolves it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-flow5-'));
    try {
      const planPath = path.join(dir, 'executable-plan.json');
      fs.writeFileSync(planPath, JSON.stringify({ variables: { initialPassword: '<<CES_SECRET:initialPassword>>', _secret_references: refs } }));
      const lines = await primeMusterSecrets(planPath, 's1-mach', ENV, fakeFetch(200, { variable: 'initialPassword', value: VALUE }));
      expect(lines).toHaveLength(1);
      const { overlay, errors } = buildSecretOverlay(refs, { operatorHeld: SecretStore.getAll('s1-mach') });
      expect(errors).toHaveLength(0);
      expect(overlay).toEqual({ initialPassword: VALUE });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not read the plan when no muster-api URL is set', async () => {
    expect(await primeMusterSecrets(path.join(os.tmpdir(), 'does-not-exist.json'), 's1', {})).toEqual([]);
  });
});
