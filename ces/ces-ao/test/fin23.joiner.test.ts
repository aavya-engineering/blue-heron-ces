// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-23 (QUESTIONS P-8): A-01 is the complete joiner — account, licence, base group, CUI group,
// a one-time Temporary Access Pass, optional PIM eligibility and optional device
// pre-registration. Plus F-15 (the AO "CES subnet egress baseline" left over from FIN-40).
// Static and render-level proofs; the sim leg (S1 E7A joiner) is the harness's (LOG-FIN-23.md).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderPs } from 'ces-shared/security';
import { getCommandTemplates } from '../src/registry/TemplateRegistry.js';
import { mapAoParametersToVariables } from '../src/execution/ParameterMapper.js';
import { readOnlyViolation } from '../src/execution/GetThenSetExecutor.js';
import { translateAoCommandToCommandEntry } from '../src/registry/RegistryBridge.js';
import { classifyIdempotency } from '../src/execution/IdempotencyClassifier.js';
import type { AoCommand } from '../src/types/AoCommand.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(path.resolve(__dirname, '../src/registry/ao-commands.registry.json'), 'utf-8'),
) as AoCommand[];
const A01 = REGISTRY.find((c) => c.id === 'A-01')!;
const F15 = REGISTRY.find((c) => c.id === 'F-15')!;
const T01 = getCommandTemplates('A-01')!;
const T15 = getCommandTemplates('F-15')!;

const TENANT = {
  tenantSlug: 'fin23-sim',
  tenantId: 'fin23-tenant',
  appId: 'app',
  certThumbprint: 'T',
  certPath: 'C:/x.pfx',
  domain: 'fin23.onmicrosoft.us',
  kind: 'sim',
  cmmcMigrationExempt: true,
  endpoints: {},
  resources: { m365_license_sku_id: 'sku-1', base_group_id: 'grp-base', cui_group_id: 'grp-cui' },
} as any;

describe('FIN-23: A-01 complete joiner', () => {
  it('registry: controls unchanged (AR5 low), new inputs optional, CUI group tenant-sourced', () => {
    expect(A01.cmmcPractices).toEqual(['AC.L1-3.1.1', 'IA.L1-3.5.1']);
    expect(A01.sodTier).toBe('Tier 2');
    const p = Object.fromEntries(A01.parameters.map((x) => [x.name, x]));
    expect(p.cuiGroupId).toMatchObject({ source: 'cuiGroupId', required: false });
    for (const n of ['pimRoleDefinitionId', 'deviceIdentifier', 'deviceIdentifierType']) {
      expect(p[n].required, n).toBe(false);
      expect(p[n].source, n).toBeUndefined();
    }
    expect(classifyIdempotency(A01)).toBeDefined();
    expect(A01.idempotencyClass).toBe('get-then-set');
  });

  it('the SET does every joiner step: account (reused when present), licence, base + CUI group, TAP, optional PIM and device', () => {
    const s = T01.set_command;
    expect(s).toMatch(/if\(-not \$u\)\{ .*New-MgUser/);
    expect(s).toContain('Set-MgUserLicense');
    expect(s).toContain("New-MgGroupMember -GroupId '{baseGroupId}'");
    expect(s).toContain('New-MgGroupMember -GroupId $ao_cuiGroupId');
    expect(s).toContain('/authentication/temporaryAccessPassMethods');
    expect(s).toContain('isUsableOnce=$true; lifetimeInMinutes=480');
    expect(s).toContain("if($ao_pimRoleDefinitionId){");
    expect(s).toContain('/v1.0/roleManagement/directory/roleEligibilityScheduleRequests');
    expect(s).toContain("if($ao_deviceIdentifier){");
    expect(s).toContain('/beta/deviceManagement/importedDeviceIdentities/importDeviceIdentityList');
  });

  it('the Temporary Access Pass value can never reach stdout (so never evidence): every POST that returns it is discarded', () => {
    const posts = [...T01.set_command.matchAll(/(\S*)Invoke-MgGraphRequest -Method POST -Uri \$tapUri/g)];
    expect(posts).toHaveLength(1);
    expect(posts[0][1]).toBe('$null=');
    // The read side only counts passes; it never selects the pass value.
    expect(T01.get_command).toContain('TemporaryAccessPasses=$tap.Count');
    expect(T01.get_command).not.toMatch(/temporaryAccessPass\b(?!Methods)/);
  });

  it('every write POST in the SET is discarded ($null=), so stdout is only the joiner summary line', () => {
    const all = [...T01.set_command.matchAll(/(\S*)Invoke-MgGraphRequest -Method POST/g)];
    expect(all.length).toBe(3);
    for (const m of all) expect(m[1]).toBe('$null=');
  });

  it('the GET is read-only and reads the CUI-group membership and TAP count', () => {
    expect(readOnlyViolation(T01.get_command)).toBeUndefined();
    expect(T01.get_command).toContain("InCuiGroup=(('{cuiGroupId}' -ne '') -and ($g -contains '{cuiGroupId}'))");
  });

  it('optional request inputs render as empty strings, so the guarded optional steps are skipped', () => {
    const vars = mapAoParametersToVariables(A01, TENANT, { upn: 'new.hire@fin23.onmicrosoft.us', displayName: 'New Hire' });
    expect(vars.pimRoleDefinitionId).toBe('');
    expect(vars.deviceIdentifier).toBe('');
    expect(vars.deviceIdentifierType).toBe('');
    expect(vars.cuiGroupId).toBe('grp-cui');
    const rendered = renderPs(T01.set_command, vars);
    expect(rendered).toContain("$ao_pimRoleDefinitionId='';");
    expect(rendered).toContain("$ao_deviceIdentifier='';");
    expect(rendered).toContain("$ao_cuiGroupId='grp-cui';");
    expect(rendered).not.toMatch(/\{(upn|displayName|m365LicenseSkuId|baseGroupId|cuiGroupId|pimRoleDefinitionId|deviceIdentifier|deviceIdentifierType)\}/);
  });

  it('given values reach their guarded steps; a tenant with no CUI group leaves a literal the template neutralises', () => {
    const vars = mapAoParametersToVariables(A01, TENANT, {
      upn: 'new.hire@fin23.onmicrosoft.us', displayName: 'New Hire',
      pimRoleDefinitionId: '00000000-0000-0000-0000-0000000000aa', deviceIdentifier: 'SN-123', deviceIdentifierType: 'serialNumber',
    });
    const rendered = renderPs(T01.set_command, vars);
    expect(rendered).toContain("$ao_pimRoleDefinitionId='00000000-0000-0000-0000-0000000000aa';");
    expect(rendered).toContain("$ao_deviceIdentifier='SN-123';");

    const noCui = { ...TENANT, resources: { m365_license_sku_id: 'sku-1', base_group_id: 'grp-base' } };
    const v2 = mapAoParametersToVariables(A01, noCui, { upn: 'u@fin23.onmicrosoft.us', displayName: 'U' });
    expect(v2).not.toHaveProperty('cuiGroupId'); // an unresolved source is omitted (unchanged rule)
    const r2 = renderPs(T01.set_command, v2);
    expect(r2).toContain("$ao_cuiGroupId='{cuiGroupId}';");
    // ...and the template's guard turns any unrendered {placeholder} into '' before use.
    expect(r2).toContain("foreach($n in 'ao_cuiGroupId','ao_pimRoleDefinitionId','ao_deviceIdentifier','ao_deviceIdentifierType'){ if((Get-Variable $n -ValueOnly).StartsWith('{')){ Set-Variable $n '' } };");
    expect(r2).toContain("$skip+='CUI group skipped: the tenant record names no resources.cui_group_id'");
  });

  it('a missing REQUIRED source still fails closed (the optional default never applies to required params)', () => {
    const bad = { ...TENANT, resources: { cui_group_id: 'grp-cui' } };
    expect(() => mapAoParametersToVariables(A01, bad, { upn: 'u@x.us', displayName: 'U' })).toThrow(/m365LicenseSkuId/);
  });

  it('A-01 runs in one Graph session (V118)', () => {
    expect(translateAoCommandToCommandEntry(A01).sessions).toEqual(['graph']);
  });
});

describe('F-15: CES subnet egress baseline (the AO op FIN-40 left)', () => {
  it('registry: Tier 3, free (no cost_gate block = no meter), SC.L1-3.13.1 + SC.L2-3.13.6 with objectives', () => {
    expect(F15).toMatchObject({ domain: 'F', trigger: 'CONFIG', sodTier: 'Tier 3', idempotencyClass: 'get-then-set' });
    expect(F15.cost_gate).toBeUndefined();
    expect(F15.cmmcPractices).toEqual(['SC.L1-3.13.1', 'SC.L2-3.13.6']);
    expect(F15.evidence_objectives).toEqual(['SC.L1-3.13.1[e]', 'SC.L1-3.13.1[f]', 'SC.L2-3.13.6[a]', 'SC.L2-3.13.6[b]']);
    expect(F15.parameters.map((p) => p.name)).toEqual(['resourceGroup', 'cesNsgName']);
  });

  it('the SET applies SB-2: seven 443 service-tag allows, the M365 GCC High ranges, Deny-All in and out at 4096', () => {
    const s = T15.set_command;
    for (const t of ['AzureActiveDirectory', 'AzureResourceManager', 'AzureKeyVault', 'Storage', 'GuestAndHybridManagement', 'AzureUpdateDelivery', 'AzureFrontDoor.FirstParty']) {
      expect(s).toContain(`'${t}'`);
    }
    expect(s).toContain("-DestinationPortRange '443'");
    expect(s).toContain('endpoints.office.com/endpoints/USGovGCCHigh?ServiceAreas=Exchange,Common');
    expect(s).toContain("Name='CES-Out-443-M365'");
    expect(s).toContain("@{n='CES-Deny-All-In';dir='Inbound'},@{n='CES-Deny-All-Out';dir='Outbound'}");
    expect(s).toContain('-Priority 4096');
    // The rule-name dot replace is a regex on a literal dot ('\.'), not "any character".
    expect(s).toContain("($t -replace '\\.','-')");
    expect(s).not.toMatch(/New-AzFirewall|New-AzPublicIpAddress/);
  });

  it('the GET is read-only and runs in the Az session only', () => {
    expect(readOnlyViolation(T15.get_command)).toBeUndefined();
    const e = translateAoCommandToCommandEntry(F15);
    expect(e.sessions).toEqual(['azure']);
    expect(e.engine).toBe('az');
  });
});
