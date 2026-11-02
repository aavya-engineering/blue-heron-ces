// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RegistryEntry } from 'ces-ui-kit';
import { registryTypeOf, replaceEntryContents, useRegistryStore, variableCheckCommand } from './registry';
import { FIXTURE_REGISTRY, FIXTURE_TENANT, mockApi } from './spa3-mock-api';
import type { MockApi } from './spa3-mock-api';

let api: MockApi | null = null;
const entries = () => FIXTURE_REGISTRY.map((e) => ({ ...e })) as RegistryEntry[];

beforeEach(() => useRegistryStore.getState().reset());
afterEach(() => {
  api?.restore();
  api = null;
});

describe('registry rules', () => {
  it('reads the type as legacy (infra, else m365)', () => {
    expect([registryTypeOf('infra'), registryTypeOf('m365'), registryTypeOf(null), registryTypeOf('other')]).toEqual([
      'infra',
      'm365',
      'm365',
      'm365',
    ]);
  });

  it('builds the variable-check command as legacy and skips it without a real tenant or commands', () => {
    const [ca] = entries();
    expect(variableCheckCommand(ca!, FIXTURE_TENANT)).toBe('Get-MgPolicy -Domain {domain}\nSet-MgPolicy -Domain {domain}');
    expect(variableCheckCommand(ca!, 'dev')).toBeNull();
    expect(variableCheckCommand(ca!, null)).toBeNull();
    expect(variableCheckCommand({ entry_id: 'x' }, FIXTURE_TENANT)).toBeNull();
  });

  it('replaces an entry object’s contents in place', () => {
    const target: RegistryEntry = { entry_id: 'x', label: 'old', notes: 'gone' };
    const ref = target;
    replaceEntryContents(target, { entry_id: 'x', label: 'new' });
    expect(ref).toEqual({ entry_id: 'x', label: 'new' });
  });
});

describe('registry store (PC-13)', () => {
  it('loads GET /api/registry/:type and switches type', async () => {
    api = mockApi({
      'GET /api/registry/m365': { body: { entries: entries() } },
      'GET /api/registry/infra': { body: { entries: [] } },
    });
    await useRegistryStore.getState().init(FIXTURE_TENANT, 'm365');
    expect(useRegistryStore.getState().entries.map((e) => e.entry_id)).toEqual(['ac-ca-baseline', 'au-unified-audit']);
    await useRegistryStore.getState().loadType('infra');
    expect(useRegistryStore.getState().registryType).toBe('infra');
    expect(api.signatures()).toEqual(['GET /api/registry/m365', 'GET /api/registry/infra']);
  });

  it('a 400 reply loads no entries without a notice (legacy reads the body)', async () => {
    api = mockApi({ 'GET /api/registry/m365': { status: 400, body: { error: 'Invalid registry type.' } } });
    await useRegistryStore.getState().init(null, 'm365');
    expect(useRegistryStore.getState().entries).toEqual([]);
    expect(useRegistryStore.getState().notice).toBeNull();
  });

  it('saves with PUT /api/registry/:type/:entryId, the entry as body, and updates the cache in place', async () => {
    api = mockApi({
      'GET /api/registry/m365': { body: { entries: entries() } },
      'PUT /api/registry/m365/ac-ca-baseline': (call) => ({ body: { success: true, entry: call.body } }),
    });
    await useRegistryStore.getState().init(FIXTURE_TENANT, 'm365');
    const cached = useRegistryStore.getState().entries[0]!;
    const edited = { ...cached, label: 'Conditional Access baseline (edited)' };
    await useRegistryStore.getState().save('m365', edited);
    expect(api.calls.at(-1)).toMatchObject({ method: 'PUT', path: '/api/registry/m365/ac-ca-baseline', body: edited });
    expect(useRegistryStore.getState().entries[0]).toBe(cached);
    expect(cached.label).toBe('Conditional Access baseline (edited)');
    expect(useRegistryStore.getState().notice).toEqual({ kind: 'success', text: 'Entry saved successfully' });
  });

  it('reports a failed save with the server error', async () => {
    api = mockApi({
      'GET /api/registry/m365': { body: { entries: entries() } },
      'PUT /api/registry/m365/ac-ca-baseline': { status: 400, body: { error: 'Entry ID mismatch between URL and body.' } },
    });
    await useRegistryStore.getState().init(FIXTURE_TENANT, 'm365');
    await useRegistryStore.getState().save('m365', useRegistryStore.getState().entries[0]!);
    expect(useRegistryStore.getState().notice?.text).toBe('Save failed: Entry ID mismatch between URL and body.');
  });

  it('variable check and resolve: POST /api/registry/resolve {command, tenant}', async () => {
    api = mockApi({
      'GET /api/registry/m365': { body: { entries: entries() } },
      'POST /api/registry/resolve': (call) => ({
        body: { resolved: String((call.body as { command: string }).command).replace('{domain}', 'ridgeline.example'), unresolved: [] },
      }),
    });
    await useRegistryStore.getState().init(FIXTURE_TENANT, 'm365');
    const [first] = useRegistryStore.getState().entries;
    await useRegistryStore.getState().checkEntry(first!);
    expect(api.calls.at(-1)).toMatchObject({
      path: '/api/registry/resolve',
      body: { command: 'Get-MgPolicy -Domain {domain}\nSet-MgPolicy -Domain {domain}', tenant: FIXTURE_TENANT },
    });
    expect(useRegistryStore.getState().varStatus).toEqual({ unresolved: [] });
    await expect(useRegistryStore.getState().resolveCommand('Get-MgPolicy -Domain {domain}')).resolves.toEqual({
      resolved: 'Get-MgPolicy -Domain ridgeline.example',
      unresolved: [],
    });
  });

  it('skips the variable check for dev', async () => {
    api = mockApi({ 'GET /api/registry/m365': { body: { entries: entries() } } });
    await useRegistryStore.getState().init('dev', 'm365');
    await useRegistryStore.getState().checkEntry(useRegistryStore.getState().entries[0]!);
    expect(api.signatures()).toEqual(['GET /api/registry/m365']);
    expect(useRegistryStore.getState().varStatus).toBeNull();
  });
});
