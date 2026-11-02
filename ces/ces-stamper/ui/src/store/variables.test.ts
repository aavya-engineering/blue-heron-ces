// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_TOU_FILE, useVariablesStore } from './variables';
import { FIXTURE_CONFIG, FIXTURE_TENANT, FIXTURE_VARIABLES, mockApi } from './spa3-mock-api';
import type { MockApi } from './spa3-mock-api';

const T = FIXTURE_TENANT;
let api: MockApi | null = null;

const loadRoutes = {
  'GET /api/resolvable-variables': { body: { ok: true, variables: ['kvName', 'domain'] } },
  [`GET /api/tenants/${T}`]: { body: { ok: true, slug: T, path: 'C:\\fixture\\tenants\\ridgeline-fixture.json', config: FIXTURE_CONFIG } },
  [`GET /api/tenants/${T}/variables`]: { body: { ok: true, variables: FIXTURE_VARIABLES } },
};

beforeEach(() => useVariablesStore.getState().reset());
afterEach(() => {
  api?.restore();
  api = null;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('variables store (PC-12)', () => {
  it('makes no request for no tenant or dev (legacy init)', async () => {
    api = mockApi({});
    await useVariablesStore.getState().load(null);
    await useVariablesStore.getState().load('dev');
    expect(api.calls).toEqual([]);
  });

  it('loads in the legacy order: resolvable names, config, variables', async () => {
    api = mockApi(loadRoutes);
    await useVariablesStore.getState().load(T);
    expect(api.signatures()).toEqual([
      'GET /api/resolvable-variables',
      `GET /api/tenants/${T}`,
      `GET /api/tenants/${T}/variables`,
    ]);
    const s = useVariablesStore.getState();
    expect(s.config).toEqual(FIXTURE_CONFIG);
    expect(s.pathHint).toBe('C:\\fixture\\tenants\\ridgeline-fixture.json');
    expect(s.variables).toEqual(FIXTURE_VARIABLES);
    expect(s.resolvable).toEqual(['kvName', 'domain']);
  });

  it('a failed config load shows the legacy notice; a failed variables load is empty', async () => {
    api = mockApi({
      'GET /api/resolvable-variables': { body: { ok: true, variables: [] } },
      [`GET /api/tenants/${T}`]: { status: 404, body: { ok: false, error: `Tenant config not found: ${T}` } },
      [`GET /api/tenants/${T}/variables`]: { status: 500, body: { ok: false, error: 'disk' } },
    });
    await useVariablesStore.getState().load(T);
    const s = useVariablesStore.getState();
    expect(s.notice).toEqual({ kind: 'error', text: `Failed to load config: Tenant config not found: ${T}` });
    expect(s.variables).toEqual({});
  });

  it('saves config (PUT {json}), save-as (POST {json}) and variables (PUT {variables})', async () => {
    api = mockApi({
      ...loadRoutes,
      [`PUT /api/tenants/${T}`]: { body: { ok: true, slug: T } },
      'POST /api/tenants': { body: { ok: true } },
      [`PUT /api/tenants/${T}/variables`]: { body: { ok: true } },
    });
    const store = useVariablesStore.getState();
    await store.load(T);
    const cfg = { ...FIXTURE_CONFIG, client: { ...FIXTURE_CONFIG.client, name: 'Ridgeline Machining West' } };
    await useVariablesStore.getState().saveConfig(cfg);
    expect(api.calls.at(-1)).toMatchObject({ method: 'PUT', path: `/api/tenants/${T}`, body: { json: JSON.stringify(cfg, null, 2) } });
    expect(useVariablesStore.getState().notice).toEqual({ kind: 'success', text: 'Config saved' });
    expect(useVariablesStore.getState().config).toBe(cfg);

    await useVariablesStore.getState().saveConfigAs('ridgeline-west', cfg);
    expect(api.calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/tenants', body: { json: JSON.stringify(cfg, null, 2) } });
    expect(useVariablesStore.getState().notice?.text).toBe('Saved as: ridgeline-west');

    await useVariablesStore.getState().saveVariables({ domain: 'ridgeline.example', retentionDays: 30 });
    expect(api.calls.at(-1)).toMatchObject({
      method: 'PUT',
      path: `/api/tenants/${T}/variables`,
      body: { variables: { domain: 'ridgeline.example', retentionDays: 30 } },
    });
    expect(useVariablesStore.getState().notice?.text).toBe('Variables saved');
  });

  it('reports save failures with the legacy text', async () => {
    api = mockApi({
      ...loadRoutes,
      [`PUT /api/tenants/${T}`]: { status: 400, body: { ok: false, error: 'Missing required field: auth.app_id' } },
    });
    await useVariablesStore.getState().load(T);
    await useVariablesStore.getState().saveConfig({});
    expect(useVariablesStore.getState().notice?.text).toBe('Save failed: Missing required field: auth.app_id');
  });

  it('resolve: POST {variable, tenant}; success reloads the config; ambiguity and errors map for the editor', async () => {
    let reply: { status?: number; body: unknown } = { body: { ok: true, resolved: { kvName: 'kv-ridgeline' } } };
    api = mockApi({ ...loadRoutes, 'POST /api/resolve-variable': () => reply });
    await useVariablesStore.getState().load(T);
    const before = api.calls.length;
    await expect(useVariablesStore.getState().resolve('kvName')).resolves.toEqual({ resolved: { kvName: 'kv-ridgeline' } });
    await flush();
    expect(api.signatures().slice(before)).toEqual(['POST /api/resolve-variable', `GET /api/tenants/${T}`]);
    expect(api.calls[before]!.body).toEqual({ variable: 'kvName', tenant: T });

    reply = { body: { ok: true, ambiguous: true, candidates: ['kv-a', 'kv-b'] } };
    await expect(useVariablesStore.getState().resolve('kvName')).resolves.toEqual({ ambiguous: { kvName: ['kv-a', 'kv-b'] } });
    reply = { body: { ok: false, error: 'No kvName found in tenant' } };
    await expect(useVariablesStore.getState().resolve('kvName')).rejects.toThrow('No kvName found in tenant');
  });

  it('resolve all: POST {variables, tenant}, then reloads the config', async () => {
    api = mockApi({
      ...loadRoutes,
      'POST /api/resolve-all-variables': { body: { ok: true, resolved: { kvName: 'kv-ridgeline' }, ambiguous: {}, notFound: ['lawName'] } },
    });
    await useVariablesStore.getState().load(T);
    const before = api.calls.length;
    const result = await useVariablesStore.getState().resolveAll(['kvName', 'lawName']);
    await flush();
    expect(result).toEqual({ resolved: { kvName: 'kv-ridgeline' }, ambiguous: {}, notFound: ['lawName'] });
    expect(api.calls[before]).toMatchObject({ method: 'POST', path: '/api/resolve-all-variables', body: { variables: ['kvName', 'lawName'], tenant: T } });
    expect(api.signatures()[before + 1]).toBe(`GET /api/tenants/${T}`);
  });

  it('Load: browse then read the chosen file; Sample: POST /api/file-to-base64', async () => {
    const path = 'C:\\fixture\\tenants\\ridgeline-west.json';
    api = mockApi({
      ...loadRoutes,
      'GET /api/tenants-browse': { body: { ok: true, files: [{ name: 'ridgeline-west.json', path }] } },
      'GET /api/browse-file': { body: { ok: true, path, content: JSON.stringify({ client: { slug: 'ridgeline-west' } }) } },
      'POST /api/file-to-base64': { body: { ok: true, base64: 'JVBERi0=', fileName: SAMPLE_TOU_FILE } },
    });
    await useVariablesStore.getState().load(T);
    await useVariablesStore.getState().browseConfigs();
    expect(useVariablesStore.getState().browseFiles).toEqual([{ name: 'ridgeline-west.json', path }]);
    await useVariablesStore.getState().loadConfigFromPath(path);
    expect(api.calls.at(-1)).toMatchObject({ path: '/api/browse-file', query: { path } });
    const s = useVariablesStore.getState();
    expect([s.browseFiles, s.pathHint, s.notice?.text]).toEqual([null, path, 'Loaded from ridgeline-west.json']);
    expect(s.config).toEqual({ client: { slug: 'ridgeline-west' } });

    await expect(useVariablesStore.getState().loadSampleTermsOfUse()).resolves.toEqual({ fileName: SAMPLE_TOU_FILE, base64: 'JVBERi0=' });
    expect(api.calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/file-to-base64', body: { filePath: SAMPLE_TOU_FILE } });
  });

  it('posts the legacy opener notices after saves', async () => {
    const post = vi.fn();
    Object.defineProperty(window, 'opener', { value: { postMessage: post }, configurable: true, writable: true });
    api = mockApi({ ...loadRoutes, [`PUT /api/tenants/${T}`]: { body: { ok: true } }, [`PUT /api/tenants/${T}/variables`]: { body: { ok: true } } });
    await useVariablesStore.getState().load(T);
    await useVariablesStore.getState().saveConfig(FIXTURE_CONFIG);
    await useVariablesStore.getState().saveVariables({});
    expect(post.mock.calls).toEqual([
      [{ type: 'config-saved', tenant: T }, '*'],
      [{ type: 'variables-saved' }, '*'],
    ]);
    Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
  });
});
