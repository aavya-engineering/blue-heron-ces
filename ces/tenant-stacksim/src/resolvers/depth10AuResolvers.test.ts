// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../store/ObjectStore.js';
import { DEPTH10_AU_CMDLETS } from './depth10AuResolvers.js';
import { exoResolvers } from './exoResolvers.js';
import { ResolverTable } from './ResolverTable.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';

type Row = Record<string, any>;

/**
 * DEPTH-10.1 golden (P12-R1): each AU SET the new registry entries send, then the GET the entry
 * verifies, through the ResolverTable (the path /resolve takes). The expected values are the
 * registry entries' verification values.
 */
describe('DEPTH-10.1 AU resolvers (depth10AuResolvers.ts)', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-depth10au-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_only'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('each DEPTH-10.1 cmdlet is one manual Exchange entry (so the module exports it and no derived twin exists)', () => {
    const named = exoResolvers.filter((e) => e.kind === 'cmdlet').map((e) => (e as { cmdlet: string }).cmdlet);
    for (const c of DEPTH10_AU_CMDLETS) expect(named.filter((n) => n === c)).toHaveLength(1);
  });

  it('AU.L2-3.3.2.mailbox-audit-default: Set-OrganizationConfig -AuditDisabled $false, then Get-OrganizationConfig reads AuditDisabled false', async () => {
    await store.create('organizationConfig', { id: 'organizationConfig', Name: 'sim.onmicrosoft.us', IsDehydrated: false });
    expect(((await table.resolveCmdlet('Get-OrganizationConfig', [])) as Row[])[0].AuditDisabled).toBeUndefined();
    expect(await table.resolveCmdlet('Set-OrganizationConfig', ['-AuditDisabled', false])).toBeNull();
    const cfg = ((await table.resolveCmdlet('Get-OrganizationConfig', [])) as Row[]);
    expect(cfg).toHaveLength(1);
    expect(cfg[0]).toMatchObject({ AuditDisabled: false, IsDehydrated: false, Name: 'sim.onmicrosoft.us' });
    // PowerShell's own spellings of a boolean argument.
    await table.resolveCmdlet('Set-OrganizationConfig', ['-AuditDisabled:$true']);
    expect(((await table.resolveCmdlet('Get-OrganizationConfig', [])) as Row[])[0].AuditDisabled).toBe(true);
    await table.resolveCmdlet('Set-OrganizationConfig', ['-AuditDisabled', 'False']);
    expect(((await table.resolveCmdlet('Get-OrganizationConfig', [])) as Row[])[0].AuditDisabled).toBe(false);
  });

  it('Set-OrganizationConfig with no organization config is a 404, and with no parameter a 400', async () => {
    await expect(table.resolveCmdlet('Set-OrganizationConfig', ['-AuditDisabled', false])).rejects.toThrow(/no organizationConfig/);
    await store.create('organizationConfig', { id: 'organizationConfig' });
    await expect(table.resolveCmdlet('Set-OrganizationConfig', [])).rejects.toThrow(/no parameter/);
  });

  it('AU.L2-3.3.4.audit-config-alert: New-ProtectionAlert, then Get-ProtectionAlert reads the policy enabled, on the activity, with its recipient', async () => {
    const created = (await table.resolveCmdlet('New-ProtectionAlert', [
      '-Name', 'CMMC-Audit-Logging-Changed', '-Category', 'Others', '-ThreatType', 'Activity', '-Operation', 'Set-AdminAuditLogConfig',
      '-NotifyUser', 'isso@sim.example', '-Severity', 'High', '-AggregationType', 'None', '-Comment', 'CMMC AU.L2-3.3.4',
    ])) as Row;
    expect(created).toMatchObject({ Name: 'CMMC-Audit-Logging-Changed', Disabled: false, IsSystemRule: false, Operation: ['Set-AdminAuditLogConfig'], NotifyUser: ['isso@sim.example'], Severity: 'High' });
    const all = (await table.resolveCmdlet('Get-ProtectionAlert', [])) as Row[];
    expect(all.map((p) => p.Name)).toContain('CMMC-Audit-Logging-Changed');
    const one = (await table.resolveCmdlet('Get-ProtectionAlert', ['-Identity', 'CMMC-Audit-Logging-Changed'])) as Row;
    expect(one).toMatchObject({ Disabled: false, Operation: ['Set-AdminAuditLogConfig'], NotifyUser: ['isso@sim.example'] });
    await expect(table.resolveCmdlet('New-ProtectionAlert', ['-Name', 'CMMC-Audit-Logging-Changed', '-Operation', 'x'])).rejects.toThrow(/already exists/);
    await expect(table.resolveCmdlet('New-ProtectionAlert', ['-Category', 'Others'])).rejects.toThrow(/-Name is required/);
  });

  it('an unresolved placeholder recipient is a 400 before anything is stored (FX-10)', async () => {
    await expect(table.resolveCmdlet('New-ProtectionAlert', ['-Name', 'X', '-NotifyUser', '{cisoEmail}'])).rejects.toThrow(/placeholder/);
    expect(await store.list('protectionAlert')).toHaveLength(0);
  });
});
