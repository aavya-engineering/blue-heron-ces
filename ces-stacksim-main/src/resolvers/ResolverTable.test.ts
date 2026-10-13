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
import { Ledger } from '../ledger/Ledger.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';
import { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import { EvidenceHold } from '../evidence/EvidenceHold.js';
import { ResolverTable, cmdletArgsToPatch, applyCmdletFilter, parseInvokeAzRestMethodArgs } from './ResolverTable.js';
import { exoResolvers } from './exoResolvers.js';
import { generateDlpCompliancePolicies } from '../seed/generators/compliance.js';
import type { ResolverEntry } from './types.js';

describe('ResolverTable', () => {
  let dir: string;
  let store: ObjectStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-resolver-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('resolveCmdlet returns the collection contents for a registered named-cmdlet entry', async () => {
    await store.create('caPolicies', { id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' });
    await store.create('caPolicies', { id: 'caPolicy-2', displayName: 'Sim CA Policy 2', state: 'enabled' });

    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);
    const result = await table.resolveCmdlet('Get-MgIdentityConditionalAccessPolicy');

    expect(result).toHaveLength(2);
  });

  it('resolveCmdlet throws for an unregistered cmdlet', async () => {
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);
    await expect(table.resolveCmdlet('Get-MgBogusThing')).rejects.toThrow(/no resolver registered/);
  });

  it('resolveUri returns the collection contents for a registered URI-pattern entry', async () => {
    await store.create('authorizationPolicy', { id: 'authorizationPolicy-1', allowInvitesFrom: 'everyone' });

    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);
    const result = await table.resolveUri('GET', '/v1.0/policies/authorizationPolicy');

    expect(result).toEqual([{ id: 'authorizationPolicy-1', allowInvitesFrom: 'everyone' }]);
  });

  // STAB-1 M1b (2026-07-11): item-level GET fidelity — real Graph returns the
  // single object for '/....../{id}' URIs, not the whole collection. Serving the
  // collection broke Stamper's jsonpath `$.state` post-set verification on every
  // task whose SET changed state (22 tasks in the ces-tester M2 gate).
  it('resolveUri returns the SINGLE object for a fixed-singleton item-level GET (pattern last segment == singletonId)', async () => {
    await store.create('authenticationMethodsPolicyConfigurations', { id: 'MicrosoftAuthenticator', state: 'enabled' });
    await store.create('authenticationMethodsPolicyConfigurations', { id: 'Fido2', state: 'disabled' });

    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);
    const result = await table.resolveUri(
      'GET',
      '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2',
    );

    expect(result).toEqual({ id: 'Fido2', state: 'disabled' });
  });

  it('resolveUri returns the SINGLE object for a dynamic-id item-level GET and 404s when the id is missing', async () => {
    await store.create('caPolicies', { id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' });

    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);

    const found = await table.resolveUri('GET', '/v1.0/identity/conditionalAccess/policies/caPolicy-1');
    expect(found).toEqual({ id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' });

    await expect(
      table.resolveUri('GET', '/v1.0/identity/conditionalAccess/policies/nope-9'),
    ).rejects.toThrow(/no caPolicies object with id "nope-9"/);
  });

  it('resolveUri keeps collection behavior when a codegen-defaulted singletonId (== collection) does not match an object', async () => {
    // deriveResolversFromInventory defaults singletonId to the collection name on
    // derived collection endpoints; a GET there must keep returning the list.
    await store.create('storageAccounts', { id: 'sa-1' });
    await store.create('storageAccounts', { id: 'sa-2' });
    const entries: ResolverEntry[] = [
      {
        kind: 'uri',
        pattern: '/v1.0/derived/storageAccounts',
        collection: 'storageAccounts',
        verb: 'GET',
        azureTier: 'none',
        envelope: 'raw',
        mutationVerbs: ['PATCH'],
        singletonId: 'storageAccounts',
      },
    ];
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate, entries);

    const result = await table.resolveUri('GET', '/v1.0/derived/storageAccounts');
    expect(result).toEqual([{ id: 'sa-1' }, { id: 'sa-2' }]);
  });

  // STACKSIM-FIDELITY (2026-07-11): named-cmdlet mutations apply their args as
  // state - a Set-* upserting a bare {id} shell made every post-set verify read
  // properties that were never written (the 15 remaining M2-gate failures).
  describe('cmdletArgsToPatch', () => {
    it('parses named params, coercing $true/$false, numbers, and quoted strings', () => {
      expect(cmdletArgsToPatch([
        '-EnableATPForSPOTeamsODB', '$true',
        '-Identity', "'Global'",
        '-RetentionDays', '90',
        '-Mode', 'Enforce',
      ])).toEqual({ EnableATPForSPOTeamsODB: true, Identity: 'Global', RetentionDays: 90, Mode: 'Enforce' });
    });

    it('handles bare switches, colon syntax, arrays, and negative-number values', () => {
      expect(cmdletArgsToPatch(['-Enabled:$false', '-Force', '-Offset', '-5', '-Domains', ['a.us', 'b.us']]))
        .toEqual({ Enabled: false, Force: true, Offset: -5, Domains: ['a.us', 'b.us'] });
    });

    it('drops PowerShell common parameters and returns undefined for empty/positional-only args', () => {
      expect(cmdletArgsToPatch(['-ErrorAction', 'SilentlyContinue', '-WhatIf'])).toBeUndefined();
      expect(cmdletArgsToPatch([])).toBeUndefined();
      expect(cmdletArgsToPatch('not-an-array')).toBeUndefined();
      expect(cmdletArgsToPatch(['positional-only'])).toBeUndefined();
    });
  });

  // FIDELITY tail (a)/(b)/(c) — 2026-07-12.
  it('(a) -BodyParameter objects are SPREAD as the resource body, not nested under a key', () => {
    expect(
      cmdletArgsToPatch(['-BodyParameter', { displayName: 'Approved-CUI-Networks', isTrusted: true }])
    ).toEqual({ displayName: 'Approved-CUI-Networks', isTrusted: true });
    expect(cmdletArgsToPatch(['-Body', { state: 'enabled' }, '-Force'])).toEqual({
      state: 'enabled',
      Force: true,
    });
    // GP-STACKSIM-1 M3: with camelCaseParams (Graph -Mg* cmdlets), PascalCase
    // parameter names map to camelCase wire properties (the SDK's own
    // mapping) — spreading them verbatim wrote case-duplicate keys PS 5.1's
    // ConvertFrom-Json cannot parse. -AdditionalProperties spreads its
    // wire-shaped contents like -Body, matched case-insensitively. Az/EXO
    // (default, no flag) keep their natively-PascalCase object models.
    expect(
      cmdletArgsToPatch(
        ['-IsTrusted:$true', '-AdditionalProperties', { ipRanges: [{ cidrAddress: '10.0.0.0/24' }] }],
        { camelCaseParams: true },
      )
    ).toEqual({ isTrusted: true, ipRanges: [{ cidrAddress: '10.0.0.0/24' }] });
  });

  it('(b) applyCmdletFilter honors "field eq \'value\'" case-insensitively; complex filters pass through', () => {
    const rows = [
      { id: 'n1', displayName: 'Approved-CUI-Networks' },
      { id: 'n2', displayName: 'Other' },
    ];
    expect(applyCmdletFilter(rows, ['-Filter', "displayName eq 'Approved-CUI-Networks'"])).toEqual([rows[0]]);
    expect(applyCmdletFilter(rows, ['-Filter', "DisplayName eq 'Other'"])).toEqual([rows[1]]);
    expect(applyCmdletFilter(rows, ['-Filter', "startswith(displayName,'App')"])).toEqual(rows);
    expect(applyCmdletFilter(rows, ['-All'])).toEqual(rows);
  });

  it('(b) applyCmdletFilter honors BARE OData literals (bool/number/null), not just quoted strings', () => {
    const users = [
      { id: 'u1', accountEnabled: true, jobId: 7 },
      { id: 'u2', accountEnabled: false, jobId: 7 },
      { id: 'u3', accountEnabled: true, jobId: 9 },
    ];
    // The reported gap: a bare-boolean filter used to fall through and return
    // the WHOLE collection (u2 leaked in). It must now narrow to enabled users.
    expect(applyCmdletFilter(users, ['-Filter', 'accountEnabled eq true'])).toEqual([users[0], users[2]]);
    expect(applyCmdletFilter(users, ['-Filter', 'accountEnabled eq $true'])).toEqual([users[0], users[2]]);
    expect(applyCmdletFilter(users, ['-Filter', 'accountEnabled eq false'])).toEqual([users[1]]);
    // bare number, case-insensitive field name
    expect(applyCmdletFilter(users, ['-Filter', 'JobId eq 9'])).toEqual([users[2]]);
    // quoted-string form still works alongside the new bare form
    expect(applyCmdletFilter(users, ['-Filter', "id eq 'u1'"])).toEqual([users[0]]);
  });

  it('(b-integration) a -Filter on a Get-Mg* cmdlet narrows the response, raw casing preserved', async () => {
    await store.create('namedLocations', {
      id: 'n1',
      displayName: 'Approved-CUI-Networks',
      isTrusted: true,
    });
    await store.create('namedLocations', { id: 'n2', displayName: 'Other' });
    const entries: ResolverEntry[] = [
      {
        kind: 'cmdlet',
        cmdlet: 'Get-MgIdentityConditionalAccessNamedLocation',
        endpoint: 'derived:Get-MgIdentityConditionalAccessNamedLocation',
        collection: 'namedLocations',
        verb: 'GET',
        azureTier: 'none',
      },
    ];
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate, entries);
    const out = (await table.resolveCmdlet('Get-MgIdentityConditionalAccessNamedLocation', [
      '-Filter',
      "displayName eq 'Approved-CUI-Networks'",
    ])) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(1);
    // Raw camelCase preserved — EO/AO real code consumes Graph JSON as-is;
    // PascalCase surfacing (tail c) was backed out to protect those consumers.
    expect(out[0].displayName).toBe('Approved-CUI-Networks');
    expect(out[0].isTrusted).toBe(true);
  });

  it('(a) Get-DlpCompliancePolicy returns the seeded IPPS policy WITH its server-computed DistributionStatus', async () => {
    // The derived-cmdlet path must map the IPPS cmdlet's noun to the seeded
    // collection, and the seed must carry DistributionStatus (server-computed
    // on a real tenant) so Stamper's `$.DistributionStatus -eq 'Success'` read
    // is truthful, not undefined against an unseeded collection.
    const derived = exoResolvers.find(
      (e) => e.kind === 'cmdlet' && e.cmdlet === 'Get-DlpCompliancePolicy',
    );
    expect(derived).toBeDefined();
    expect(derived?.collection).toBe('dlpCompliancePolicy');

    for (const p of generateDlpCompliancePolicies(2)) {
      await store.create('dlpCompliancePolicy', p);
    }
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);
    const out = (await table.resolveCmdlet('Get-DlpCompliancePolicy')) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);
    for (const policy of out) {
      expect(policy.DistributionStatus).toBe('Success');
      expect(policy.Enabled).toBe(true);
    }
    expect(out.map((p) => p.Name)).toContain('CMMC-CUI-Block');
    // and the Enabled-filter Stamper actually uses narrows correctly
    const enabled = applyCmdletFilter(out, ['-Filter', 'Enabled eq true']) as unknown[];
    expect(enabled).toHaveLength(2);
  });

  // P0-2 fix 8 (dlp-policy, KEYSTONE, 2026-07-27): -Identity was previously
  // ignored on named-cmdlet GETs, so Get-DlpCompliancePolicy -Identity
  // 'CMMC-CUI-Block' against a 2-elem seeded collection returned the whole
  // 2-elem array (undefined through Stamper's extractJsonPath). New-* now
  // keys onto the -Name/-Identity natural id, so the New- call upserts onto
  // the already-seeded 'CMMC-CUI-Block' object rather than minting a 3rd.
  it('(P0-2 fix 8) New-DlpCompliancePolicy upserts onto the seeded natural id; Get -Identity narrows to the single object', async () => {
    for (const p of generateDlpCompliancePolicies(2)) {
      await store.create('dlpCompliancePolicy', p);
    }
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);

    await table.resolveCmdlet('New-DlpCompliancePolicy', [
      '-Name', "'CMMC-CUI-Block'",
      '-ExchangeLocation', 'All',
      '-SharePointLocation', 'All',
      '-OneDriveLocation', 'All',
      '-Mode', 'Enable',
    ]);

    const all = (await table.resolveCmdlet('Get-DlpCompliancePolicy')) as unknown[];
    expect(all).toHaveLength(2); // upserted onto the existing id, not a 3rd object

    const single = (await table.resolveCmdlet('Get-DlpCompliancePolicy', [
      '-Identity', "'CMMC-CUI-Block'",
    ])) as Record<string, unknown>;
    expect(Array.isArray(single)).toBe(false);
    expect(single.Name).toBe('CMMC-CUI-Block');
    expect(single.id).toBe('CMMC-CUI-Block');
    expect(single.DistributionStatus).toBe('Success'); // seeded field survives the merge-patch
  });

  // P0-2 fix 6+7 (malware-rule + anti-phish, 2026-07-27): New-MalwareFilterRule/
  // New-AntiPhishPolicy's own args never set State/Enabled - both are
  // server-computed create defaults a real tenant returns.
  it('(P0-2 fix 6+7) New-MalwareFilterRule/New-AntiPhishPolicy apply creationDefaults; an explicit arg still wins', async () => {
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);

    await table.resolveCmdlet('New-MalwareFilterRule', [
      '-Name', "'CMMC-Malware-Rule'",
      '-MalwareFilterPolicy', "'CMMC-Malware'",
      '-RecipientDomainIs', 'example.mil',
    ]);
    const rule = (await table.resolveCmdlet('Get-MalwareFilterRule', [
      '-Identity', "'CMMC-Malware-Rule'",
    ])) as Record<string, unknown>;
    expect(rule.State).toBe('Enabled');

    await table.resolveCmdlet('New-AntiPhishPolicy', [
      '-Name', "'CMMC-AntiPhish'",
      '-EnableMailboxIntelligence', '$true',
    ]);
    const policy = (await table.resolveCmdlet('Get-AntiPhishPolicy', [
      '-Identity', "'CMMC-AntiPhish'",
    ])) as Record<string, unknown>;
    expect(policy.Enabled).toBe(true);

    // an explicit -State wins over the creationDefault
    await table.resolveCmdlet('New-MalwareFilterRule', ['-Name', "'Other-Rule'", '-State', 'Disabled']);
    const disabled = (await table.resolveCmdlet('Get-MalwareFilterRule', [
      '-Identity', "'Other-Rule'",
    ])) as Record<string, unknown>;
    expect(disabled.State).toBe('Disabled');
  });

  // P0-2 fix 9 (member-add, 2026-07-27): New-MgGroupMemberByRef used to write
  // into its own auto-derived "groupMemberByRef" collection while
  // Get-MgGroupMember reads "groupMember" - the write was never visible to
  // the read. Now both target "groupMember", and the member's id is parsed
  // from the trailing directoryObjects/{id} segment of the @odata.id ref.
  it('(P0-2 fix 9) New-MgGroupMemberByRef writes into the SAME collection Get-MgGroupMember reads', async () => {
    // SIMFIX FIX-S1 (2026-09-27): -GroupId names the group the member is
    // added to, so that group must exist (a real tenant 404s otherwise) and
    // the read is scoped to it: Get-MgGroupMember -GroupId returns THAT
    // group's members, each presented under the member's own id.
    await store.create('groups', { id: 'cuiGroup-1', displayName: 'CUI-Authorized-Users' });
    await store.create('groups', { id: 'otherGroup-1', displayName: 'Other' });
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);

    await table.resolveCmdlet('New-MgGroupMemberByRef', [
      '-GroupId', 'cuiGroup-1',
      '-BodyParameter', { '@odata.id': 'https://graph.microsoft.us/v1.0/directoryObjects/operator-1' },
    ]);

    const members = (await table.resolveCmdlet('Get-MgGroupMember', ['-GroupId', 'cuiGroup-1'])) as Array<
      Record<string, unknown>
    >;
    const added = members.find((m) => m.id === 'operator-1');
    expect(added).toBeDefined();
    expect(added).not.toHaveProperty('@odata.id');
    expect(await table.resolveCmdlet('Get-MgGroupMember', ['-GroupId', 'otherGroup-1'])).toEqual([]);
    await expect(
      table.resolveCmdlet('New-MgGroupMemberByRef', [
        '-GroupId', 'no-such-group',
        '-BodyParameter', { '@odata.id': 'https://graph.microsoft.us/v1.0/directoryObjects/operator-1' },
      ]),
    ).rejects.toThrow(/Request_ResourceNotFound/);
  });

  // P0-2 fix 10 (CA-policy create, 2026-07-28): New-MgIdentityConditionalAccessPolicy
  // had no manual resolver entry, so codegen auto-derived it onto its own
  // mismatched collection ("identityConditionalAccessPolicy") distinct from
  // Get-MgIdentityConditionalAccessPolicy's/GET-/v1.0/identity/conditionalAccess/
  // policies' real "caPolicies" collection - the exact write->read gap
  // ces-tester's remote-maintenance-mfa-baseline scenario surfaced (create,
  // then GET .../policies with a select on displayName, 404-equivalent "not
  // found in the collection"). This proves the round-trip through BOTH read
  // surfaces a real tenant offers: the named cmdlet (Get-MgIdentityConditional
  // AccessPolicy) and the URI Stamper/EO's registries actually GET.
  it('(P0-2 fix 10) New-MgIdentityConditionalAccessPolicy writes into the SAME "caPolicies" collection both GET surfaces read', async () => {
    for (const p of [
      { id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' },
      { id: 'caPolicy-2', displayName: 'Sim CA Policy 2', state: 'enabled' },
      { id: 'caPolicy-3', displayName: 'Sim CA Policy 3', state: 'enabled' },
    ]) {
      await store.create('caPolicies', p);
    }
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);

    await table.resolveCmdlet('New-MgIdentityConditionalAccessPolicy', [
      '-DisplayName', "'CMMC-RemoteMaintenance-MFA'",
      '-State', "'enabled'",
    ]);

    // Named-cmdlet read surface
    const viaCmdlet = (await table.resolveCmdlet('Get-MgIdentityConditionalAccessPolicy')) as Array<Record<string, unknown>>;
    expect(viaCmdlet).toHaveLength(4);
    const foundViaCmdlet = viaCmdlet.find((p) => p.displayName === 'CMMC-RemoteMaintenance-MFA');
    expect(foundViaCmdlet?.state).toBe('enabled');

    // URI read surface (the exact shape ces-tester's expected_state check uses)
    const viaUri = (await table.resolveUri('GET', '/v1.0/identity/conditionalAccess/policies')) as {
      value: Array<Record<string, unknown>>;
    };
    expect(viaUri.value).toHaveLength(4);
    const foundViaUri = viaUri.value.find((p) => p.displayName === 'CMMC-RemoteMaintenance-MFA');
    expect(foundViaUri).toBeDefined();
    expect(foundViaUri?.state).toBe('enabled');
  });

  it('resolveCmdlet applies a mutating cmdlet\'s args as object state (Set-* no longer upserts a bare shell)', async () => {
    const entries: ResolverEntry[] = [
      {
        kind: 'cmdlet',
        cmdlet: 'Set-AtpPolicyForO365',
        endpoint: 'derived:Set-AtpPolicyForO365',
        collection: 'atpPolicyForO365',
        verb: 'PATCH',
        azureTier: 'none',
        mutationVerbs: ['PATCH'],
        singletonId: 'atpPolicyForO365',
      },
      {
        kind: 'cmdlet',
        cmdlet: 'Get-AtpPolicyForO365',
        endpoint: 'derived:Get-AtpPolicyForO365',
        collection: 'atpPolicyForO365',
        verb: 'GET',
        azureTier: 'none',
      },
    ];
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate, entries);

    await table.resolveCmdlet('Set-AtpPolicyForO365', ['-EnableATPForSPOTeamsODB', '$true', '-ErrorAction', 'SilentlyContinue']);
    const after = (await table.resolveCmdlet('Get-AtpPolicyForO365')) as Array<Record<string, unknown>>;

    expect(after).toHaveLength(1);
    // GP-STACKSIM-1 M3: EXO cmdlets (not -Mg*) keep their natively-PascalCase
    // object model — only Graph SDK calls camelCase their parameter names.
    expect(after[0]).toMatchObject({ id: 'atpPolicyForO365', EnableATPForSPOTeamsODB: true });
    expect(after[0]).not.toHaveProperty('ErrorAction');
  });

  it('resolveUri throws for an unregistered URI', async () => {
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);
    await expect(table.resolveUri('GET', '/v1.0/nope')).rejects.toThrow(/no resolver registered/);
  });

  it('honors StackShapeGate: a full-tier resolver throws under an m365_only profile before touching the store', async () => {
    const fullTierEntries: ResolverEntry[] = [
      {
        kind: 'cmdlet',
        cmdlet: 'Get-AzStorageAccount',
        endpoint: '/subscriptions/x/providers/Microsoft.Storage/storageAccounts',
        collection: 'storageAccounts',
        verb: 'GET',
        azureTier: 'full',
      },
    ];
    const gate = new StackShapeGate('m365_only');
    const table = new ResolverTable(store, gate, fullTierEntries);

    await expect(table.resolveCmdlet('Get-AzStorageAccount')).rejects.toThrow(/StackShapeGate/);
  });

  it('rejects a verb the resolved entry does not declare mutationVerbs for', async () => {
    // The default authorizationPolicy entry supports PATCH (M4) but not DELETE.
    const gate = new StackShapeGate('m365_azure');
    const table = new ResolverTable(store, gate);
    await expect(table.resolveUri('DELETE', '/v1.0/policies/authorizationPolicy')).rejects.toThrow(
      /not supported by resolver/,
    );
  });

  describe('M4: mutation handling (Invoke-MgGraphRequest -Method POST/PATCH/DELETE)', () => {
    it('PATCH on the default authorizationPolicy entry merge-patches the singleton store object', async () => {
      await store.create('authorizationPolicy', {
        id: 'authorizationPolicy',
        allowInvitesFrom: 'adminsAndGuestInviters',
      });
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);

      const result = await table.resolveUri('PATCH', '/v1.0/policies/authorizationPolicy', {
        defaultUserRolePermissions: { allowedToCreateApps: false },
      });

      expect(result).toEqual({
        id: 'authorizationPolicy',
        allowInvitesFrom: 'adminsAndGuestInviters',
        defaultUserRolePermissions: { allowedToCreateApps: false },
      });
      const stored = await store.read('authorizationPolicy', 'authorizationPolicy');
      expect(stored?.defaultUserRolePermissions).toEqual({ allowedToCreateApps: false });
    });

    it('normalizes an absolute-URL Uri (ces-stamper convention) before matching a resolver pattern', async () => {
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);

      const result = await table.resolveUri(
        'PATCH',
        'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2',
        { state: 'enabled' },
      );

      expect(result).toEqual({ id: 'Fido2', state: 'enabled' });
      const stored = await store.read('authenticationMethodsPolicyConfigurations', 'Fido2');
      expect(stored?.state).toBe('enabled');
    });

    it('records a directoryAudits entry and a ledger mutate entry when a DirectoryAuditWriter is supplied', async () => {
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const auditWriter = new DirectoryAuditWriter(store, ledger);
      const table = new ResolverTable(store, gate, undefined, auditWriter);

      await table.resolveUri('PATCH', '/v1.0/policies/authorizationPolicy', {
        defaultUserRolePermissions: { allowedToCreateApps: false },
      });

      const audits = await store.list('directoryAudits');
      expect(audits).toHaveLength(1);
      const targetResources = audits[0].targetResources as Array<{ id: string }>;
      expect(targetResources[0].id).toBe('authorizationPolicy');

      const ledgerEntries = await ledger.query({ type: 'mutate' });
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0].objectType).toBe('authorizationPolicy');
    });

    it('honors StackShapeGate on mutation calls: a full-tier mutable resolver throws under m365_only before touching the store', async () => {
      const fullTierMutableEntries: ResolverEntry[] = [
        {
          kind: 'uri',
          pattern: '/v1.0/full-tier-thing',
          collection: 'storageAccounts',
          verb: 'GET',
          azureTier: 'full',
          envelope: 'raw',
          mutationVerbs: ['PATCH'],
          singletonId: 'thing-1',
        },
      ];
      const gate = new StackShapeGate('m365_only');
      const table = new ResolverTable(store, gate, fullTierMutableEntries);

      await expect(table.resolveUri('PATCH', '/v1.0/full-tier-thing', { a: 1 })).rejects.toThrow(
        /StackShapeGate/,
      );
      expect(await store.list('storageAccounts')).toHaveLength(0);
    });

    it('throws for a mutation verb on an entry with no singletonId', async () => {
      const noSingletonEntries: ResolverEntry[] = [
        {
          kind: 'uri',
          pattern: '/v1.0/no-singleton',
          collection: 'authorizationPolicy',
          verb: 'GET',
          azureTier: 'none',
          envelope: 'raw',
          mutationVerbs: ['PATCH'],
        },
      ];
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate, noSingletonEntries);

      await expect(table.resolveUri('PATCH', '/v1.0/no-singleton', {})).rejects.toThrow(/singletonId/);
    });
  });

  describe('M5: evidence hold on GET-shaped reads', () => {
    it('records an evidence snapshot + read-serve ledger entry when an EvidenceHold is supplied (named-cmdlet GET)', async () => {
      await store.create('caPolicies', { id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' });
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const evidenceHold = new EvidenceHold(path.join(dir, 'evidence'), ledger);
      const table = new ResolverTable(store, gate, undefined, undefined, evidenceHold);

      const result = await table.resolveCmdlet('Get-MgIdentityConditionalAccessPolicy');

      expect(result).toEqual([{ id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' }]);

      const ledgerEntries = await ledger.query({ type: 'read-serve' });
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0].objectType).toBe('caPolicies');
      expect(ledgerEntries[0].source).toBe('Get-MgIdentityConditionalAccessPolicy');

      const snapshot = await evidenceHold.read(ledgerEntries[0].requestId);
      expect(snapshot?.response).toEqual(result);
    });

    it('records an evidence snapshot for a URI-pattern GET, including the OData envelope in the snapshot response', async () => {
      await store.create('caPolicies', { id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' });
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const evidenceHold = new EvidenceHold(path.join(dir, 'evidence'), ledger);
      const table = new ResolverTable(store, gate, undefined, undefined, evidenceHold);

      const result = await table.resolveUri('GET', '/v1.0/identity/conditionalAccess/policies');
      expect(result).toEqual({ value: [{ id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' }] });

      const ledgerEntries = await ledger.query({ type: 'read-serve', objectType: 'caPolicies' });
      expect(ledgerEntries).toHaveLength(1);
      const snapshot = await evidenceHold.read(ledgerEntries[0].requestId);
      expect(snapshot?.response).toEqual(result);
    });

    it('does not record evidence for a mutation (PATCH), only for GET-shaped resolves', async () => {
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const evidenceHold = new EvidenceHold(path.join(dir, 'evidence'), ledger);
      const table = new ResolverTable(store, gate, undefined, undefined, evidenceHold);

      await table.resolveUri('PATCH', '/v1.0/policies/authorizationPolicy', {
        defaultUserRolePermissions: { allowedToCreateApps: false },
      });

      const ledgerEntries = await ledger.query({ type: 'read-serve' });
      expect(ledgerEntries).toHaveLength(0);
    });

    it('does not throw and records no evidence when no EvidenceHold is supplied (backward-compatible default)', async () => {
      await store.create('caPolicies', { id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' });
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);

      const result = await table.resolveCmdlet('Get-MgIdentityConditionalAccessPolicy');
      expect(result).toHaveLength(1);
    });
  });

  describe('GP-DEMO-2 (2026-07-28): Invoke-AzRestMethod honors its own -Method (read-vs-write ledger truthfulness)', () => {
    describe('parseInvokeAzRestMethodArgs', () => {
      it('parses -Method and -Path, uppercasing the method', () => {
        expect(
          parseInvokeAzRestMethodArgs(['-Method', 'get', '-Path', '/subscriptions/x/locks']),
        ).toEqual({ method: 'GET', path: '/subscriptions/x/locks' });
      });

      it('accepts -Uri as an alias for -Path (AZ-AUTO-002 registry convention)', () => {
        expect(
          parseInvokeAzRestMethodArgs(['-Method', 'PATCH', '-Uri', '/subscriptions/x/foo']),
        ).toEqual({ method: 'PATCH', path: '/subscriptions/x/foo' });
      });

      it('defaults to POST when -Method is absent', () => {
        expect(parseInvokeAzRestMethodArgs(['-Path', '/subscriptions/x/foo'])).toEqual({
          method: 'POST',
          path: '/subscriptions/x/foo',
        });
      });

      it('returns no path when args is not an array', () => {
        expect(parseInvokeAzRestMethodArgs(undefined)).toEqual({ method: 'POST', path: undefined });
      });
    });

    it('GET on a modeled ARM path (resource locks list) does not mutate and returns a read-shaped result', async () => {
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const auditWriter = new DirectoryAuditWriter(store, ledger);
      const evidenceHold = new EvidenceHold(path.join(dir, 'evidence'), ledger);
      const table = new ResolverTable(store, gate, undefined, auditWriter, evidenceHold);

      const result = await table.resolveCmdlet('Invoke-AzRestMethod', [
        '-Method',
        'GET',
        '-Path',
        '/subscriptions/sim-sub/resourceGroups/sim-rg/providers/Microsoft.OperationalInsights/workspaces/sim-law/providers/Microsoft.Authorization/locks?api-version=2016-09-01',
      ]);

      expect(result).toEqual({ value: [] });
      expect(await ledger.query({ type: 'mutate' })).toHaveLength(0);
      expect(await ledger.query({ type: 'read-serve' })).toHaveLength(1);
    });

    it('GET on an unmodeled ARM path returns an honest empty shape without mutating or ledgering (no fabricated state)', async () => {
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const auditWriter = new DirectoryAuditWriter(store, ledger);
      const evidenceHold = new EvidenceHold(path.join(dir, 'evidence'), ledger);
      const table = new ResolverTable(store, gate, undefined, auditWriter, evidenceHold);

      const result = await table.resolveCmdlet('Invoke-AzRestMethod', [
        '-Method',
        'GET',
        '-Path',
        '/subscriptions/sim-sub/resourceGroups/sim-rg/providers/Microsoft.Automation/automationAccounts/sim-aa?api-version=2021-06-22',
      ]);

      expect(result).toEqual({});
      expect(await ledger.query({ type: 'mutate' })).toHaveLength(0);
      expect(await ledger.query({ type: 'read-serve' })).toHaveLength(0);
    });

    it('a non-GET Invoke-AzRestMethod still mutates and ledgers (unmodeled path falls back to the generic restMethod singleton)', async () => {
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const auditWriter = new DirectoryAuditWriter(store, ledger);
      const table = new ResolverTable(store, gate, undefined, auditWriter);

      await table.resolveCmdlet('Invoke-AzRestMethod', [
        '-Method',
        'PATCH',
        '-Uri',
        '/subscriptions/sim-sub/resourceGroups/sim-rg/providers/Microsoft.Automation/automationAccounts/sim-aa?api-version=2021-06-22',
        '-Payload',
        '{"identity":{"type":"SystemAssigned"}}',
      ]);

      const ledgerEntries = await ledger.query({ type: 'mutate' });
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0].objectType).toBe('restMethod');
    });

    // Live-reproduced defect (Muster's read-only discovery walk correctly
    // refused output on these exact two ces-stamper infra-registry
    // get_commands, which ledgered as mutations under the old always-POST
    // heuristic): AZ-LOG-004 (resource locks) and AZ-SEN-010 (Sentinel Ueba
    // settings).
    it('resolves the 2 real infra get_command shapes (resource locks + Sentinel Ueba settings) without mutating', async () => {
      await store.create('resourceLocks', { id: 'DoNotDelete', properties: { level: 'CanNotDelete' } });
      await store.create('sentinelUebaSettings', {
        id: 'Ueba',
        kind: 'Ueba',
        properties: { dataSources: ['AuditLogs'] },
      });
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const auditWriter = new DirectoryAuditWriter(store, ledger);
      const table = new ResolverTable(store, gate, undefined, auditWriter);

      const locksResult = await table.resolveCmdlet('Invoke-AzRestMethod', [
        '-Method',
        'GET',
        '-Path',
        '/subscriptions/sim-sub/resourceGroups/sim-rg/providers/Microsoft.OperationalInsights/workspaces/sim-law/providers/Microsoft.Authorization/locks?api-version=2016-09-01',
      ]);
      expect(locksResult).toEqual({ value: [{ id: 'DoNotDelete', properties: { level: 'CanNotDelete' } }] });

      const uebaResult = await table.resolveCmdlet('Invoke-AzRestMethod', [
        '-Method',
        'GET',
        '-Path',
        '/subscriptions/sim-sub/resourceGroups/sim-rg/providers/Microsoft.OperationalInsights/workspaces/sim-law/providers/Microsoft.SecurityInsights/settings/Ueba?api-version=2023-02-01',
      ]);
      expect(uebaResult).toEqual({ id: 'Ueba', kind: 'Ueba', properties: { dataSources: ['AuditLogs'] } });

      expect(await ledger.query({ type: 'mutate' })).toHaveLength(0);
    });
  });

  // FC-SIM-2 (2026-09-28): REQ-tenant-stacksim-ao-paired-read-endpoints (B-08's
  // paired read, A-07's optional per-user MFA read).
  describe('FC-SIM-2: AO paired-read endpoints (B-08, A-07 optional)', () => {
    it('Get-MgDeviceAppManagementAndroidManagedAppProtectionApp scopes to the named policy\'s apps (B-08 paired read)', async () => {
      await store.create('androidManagedAppProtections', { id: 'androidManagedAppProtection-1', displayName: 'Sim Android CUI Protection' });
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);

      const before = await table.resolveCmdlet('Get-MgDeviceAppManagementAndroidManagedAppProtectionApp', [
        '-AndroidManagedAppProtectionId', 'androidManagedAppProtection-1', '-All',
      ]);
      expect(before).toEqual([]);

      // An app added to a DIFFERENT policy must never leak into this read.
      await store.create('androidManagedAppProtectionApps', {
        id: 'managedMobileApp-9', androidManagedAppProtectionId: 'androidManagedAppProtection-9',
        mobileAppIdentifier: { '@odata.type': '#microsoft.graph.androidMobileAppIdentifier', packageId: 'com.other.app' },
      });
      await store.create('androidManagedAppProtectionApps', {
        id: 'managedMobileApp-1', androidManagedAppProtectionId: 'androidManagedAppProtection-1',
        mobileAppIdentifier: { '@odata.type': '#microsoft.graph.androidMobileAppIdentifier', packageId: 'com.example.cui.app' },
      });

      const after = await table.resolveCmdlet('Get-MgDeviceAppManagementAndroidManagedAppProtectionApp', [
        '-AndroidManagedAppProtectionId', 'androidManagedAppProtection-1', '-All',
      ]);
      expect(after).toHaveLength(1);
      expect((after as Array<Record<string, unknown>>)[0].id).toBe('managedMobileApp-1');
      expect(((after as Array<{ mobileAppIdentifier: { packageId: string } }>)[0]).mobileAppIdentifier.packageId).toBe('com.example.cui.app');
    });

    it('Get-MgDeviceAppManagementAndroidManagedAppProtectionApp 404s for an unknown policy id', async () => {
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);
      await expect(
        table.resolveCmdlet('Get-MgDeviceAppManagementAndroidManagedAppProtectionApp', [
          '-AndroidManagedAppProtectionId', 'androidManagedAppProtection-bogus', '-All',
        ]),
      ).rejects.toThrow(/no androidManagedAppProtections object/);
    });

    it('GET /beta/users/{upn}/authentication/requirements reads the seeded perUserMfaState, lower-cased (A-07 optional follow-up)', async () => {
      await store.create('users', { id: 'user-1', userPrincipalName: 'sim.user1@simtenant.onmicrosoft.us', perUserMfaState: 'Enforced' });
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);

      const result = await table.resolveUri('GET', '/beta/users/sim.user1@simtenant.onmicrosoft.us/authentication/requirements');
      expect(result).toEqual({ perUserMfaState: 'enforced' });

      // Item-level id addressing works too (Graph accepts id or UPN).
      const byId = await table.resolveUri('GET', '/beta/users/user-1/authentication/requirements');
      expect(byId).toEqual({ perUserMfaState: 'enforced' });
    });

    it('GET /beta/users/{upn}/authentication/requirements 404s for an unknown user and never mutates the store', async () => {
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const auditWriter = new DirectoryAuditWriter(store, ledger);
      const table = new ResolverTable(store, gate, undefined, auditWriter);

      await expect(
        table.resolveUri('GET', '/beta/users/nobody@simtenant.onmicrosoft.us/authentication/requirements'),
      ).rejects.toThrow(/no users object/);
      expect(await ledger.query({ type: 'mutate' })).toHaveLength(0);
    });
  });

  // FC-SIM-2 (2026-09-28): EvidenceOps overlay signal reads
  // (REQ-tenant-stacksim-{training-user-coverage,users,security-incidents,
  // lifecycle-workflows,run-hunting-query,vpn-device-configurations}.md).
  describe('FC-SIM-2: EvidenceOps overlay signal reads (EO-03)', () => {
    it('GET /v1.0/reports/security/getAttackSimulationTrainingUserCoverage returns the seeded coverage, $-query stripped', async () => {
      await store.create('trainingUserCoverage', {
        id: 'training-user-1',
        attackSimulationUser: { userId: 'user-1', displayName: 'Sim User 1', email: 'sim.user1@simtenant.onmicrosoft.us' },
        userTrainings: [{ assignedDateTime: '2026-01-01T00:00:00Z', completionDateTime: '2026-02-01T00:00:00Z', displayName: 'Security Awareness Essentials', trainingStatus: 'completed' }],
      });
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);
      const result = await table.resolveUri('GET', '/v1.0/reports/security/getAttackSimulationTrainingUserCoverage');
      expect(result).toEqual({
        value: [{
          id: 'training-user-1',
          attackSimulationUser: { userId: 'user-1', displayName: 'Sim User 1', email: 'sim.user1@simtenant.onmicrosoft.us' },
          userTrainings: [{ assignedDateTime: '2026-01-01T00:00:00Z', completionDateTime: '2026-02-01T00:00:00Z', displayName: 'Security Awareness Essentials', trainingStatus: 'completed' }],
        }],
      });
    });

    it('GET /v1.0/users (bare collection, no item id) returns every seeded user in the "value" envelope', async () => {
      await store.create('users', { id: 'user-1', userPrincipalName: 'sim.user1@simtenant.onmicrosoft.us', accountEnabled: true, userType: 'Member', assignedLicenses: [{ skuId: 'sim-sku-g5' }] });
      await store.create('users', { id: 'user-12', userPrincipalName: 'sim.departed1@simtenant.onmicrosoft.us', accountEnabled: false, userType: 'Member', assignedLicenses: [] });
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);
      const result = await table.resolveUri('GET', "/v1.0/users?$select=id,userPrincipalName,accountEnabled,userType,assignedLicenses&$top=999");
      expect(result).toEqual({
        value: [
          { id: 'user-1', userPrincipalName: 'sim.user1@simtenant.onmicrosoft.us', accountEnabled: true, userType: 'Member', assignedLicenses: [{ skuId: 'sim-sku-g5' }] },
          { id: 'user-12', userPrincipalName: 'sim.departed1@simtenant.onmicrosoft.us', accountEnabled: false, userType: 'Member', assignedLicenses: [] },
        ],
      });
    });

    it('GET /v1.0/security/incidents?$expand=alerts returns incidents WITH their embedded alerts (distinct from Get-MgSecurityIncident item reads)', async () => {
      await store.create('securityIncidents', {
        id: 'incident-1', createdDateTime: '2026-09-28T00:00:00Z',
        alerts: [{ id: 'a-1', serviceSource: 'microsoftDefenderForEndpoint' }, { id: 'a-2', serviceSource: 'azureAdIdentityProtection' }],
      });
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);
      const result = await table.resolveUri('GET', "/v1.0/security/incidents?$expand=alerts&$filter=createdDateTime%20ge%202026-01-01T00:00:00.000Z");
      expect(result).toEqual({
        value: [{ id: 'incident-1', createdDateTime: '2026-09-28T00:00:00Z', alerts: [{ id: 'a-1', serviceSource: 'microsoftDefenderForEndpoint' }, { id: 'a-2', serviceSource: 'azureAdIdentityProtection' }] }],
      });
    });

    it('GET /v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks returns workflows WITH their tasks', async () => {
      await store.create('lifecycleWorkflows', {
        id: 'lifecycleWorkflow-1', category: 'leaver', isEnabled: true, isSchedulingEnabled: true,
        tasks: [{ id: 't-1', displayName: 'Disable User Account', taskDefinitionId: '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950', isEnabled: true }],
      });
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);
      const result = await table.resolveUri('GET', '/v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks');
      expect(result).toEqual({
        value: [{ id: 'lifecycleWorkflow-1', category: 'leaver', isEnabled: true, isSchedulingEnabled: true,
          tasks: [{ id: 't-1', displayName: 'Disable User Account', taskDefinitionId: '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950', isEnabled: true }] }],
      });
    });

    it('POST /v1.0/security/runHuntingQuery reads TVM recency from managedDevices, ignores the KQL body, and never mutates the store', async () => {
      await store.create('managedDevices', { id: 'managedDevice-1', deviceName: 'Sim Managed Device 1', lastTvmAssessed: '2026-09-27T06:00:00.000Z' });
      await store.create('managedDevices', { id: 'managedDevice-9', deviceName: 'Sim Unassessed Device' }); // no lastTvmAssessed: excluded, not fabricated
      const gate = new StackShapeGate('m365_azure');
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const auditWriter = new DirectoryAuditWriter(store, ledger);
      const evidenceHold = new EvidenceHold(path.join(dir, 'evidence'), ledger);
      const table = new ResolverTable(store, gate, undefined, auditWriter, evidenceHold);

      const result = await table.resolveUri(
        'POST',
        '/v1.0/security/runHuntingQuery',
        { Query: 'DeviceTvmInfoGathering | summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName' },
      );
      expect(result).toEqual({
        schema: [
          { name: 'DeviceId', type: 'String' },
          { name: 'DeviceName', type: 'String' },
          { name: 'LastAssessed', type: 'DateTime' },
        ],
        results: [{ DeviceId: 'managedDevice-1', DeviceName: 'Sim Managed Device 1', LastAssessed: '2026-09-27T06:00:00.000Z' }],
      });
      expect(await ledger.query({ type: 'mutate' })).toHaveLength(0);
      expect(await store.list('managedDevices')).toHaveLength(2);
    });

    it('Get-MgDeviceManagementDeviceConfiguration serves a seeded VPN profile with enableSplitTunneling (SC.L2-3.13.7)', async () => {
      await store.create('deviceConfigurations', {
        id: 'deviceConfiguration-vpn-1', displayName: 'Sim Always On VPN - Enclave',
        '@odata.type': '#microsoft.graph.windows10VpnConfiguration', enableSplitTunneling: false,
        AdditionalProperties: { '@odata.type': '#microsoft.graph.windows10VpnConfiguration', enableSplitTunneling: false },
      });
      const gate = new StackShapeGate('m365_azure');
      const table = new ResolverTable(store, gate);
      const result = await table.resolveCmdlet('Get-MgDeviceManagementDeviceConfiguration');
      expect(result).toEqual([{
        id: 'deviceConfiguration-vpn-1', displayName: 'Sim Always On VPN - Enclave',
        '@odata.type': '#microsoft.graph.windows10VpnConfiguration', enableSplitTunneling: false,
        AdditionalProperties: { '@odata.type': '#microsoft.graph.windows10VpnConfiguration', enableSplitTunneling: false },
      }]);
    });
  });
});
