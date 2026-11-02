// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { createHash } from 'node:crypto';
import type { ObjectStore } from '../store/ObjectStore.js';
import type { StoreObject } from '../store/StoreTypes.js';
import type { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import type { NamedCmdletResolverEntry } from './types.js';
import { registerObjectType } from '../store/schemas.js';
import { BadRequestError, NotFoundError } from './targets.js';

/**
 * FIN-21 (2026-10-31): the cmdlets Stamper's tenant initialization sends to a
 * CLEAN tenant (src/profiles/clean-g5.ts) - the bootstrap script
 * (scripts/New-TenantBootstrap.ps1), the preflight route (GET /api/preflight)
 * and the baseline provisioner (BaselineProvisioner.ts) - with the service's
 * own semantics, so each object can be found again after it is built
 * (LOG-FIN-15: an honest baseline counts a resource as built only when a
 * discovery read afterwards finds it).
 *
 * Graph (Microsoft Graph PowerShell SDK):
 *  - Get-MgOrganization, Get-MgSubscribedSku: the tenant's organization and
 *    licence SKUs (the bootstrap licence check, audit step 1).
 *  - New-MgApplication / Update-MgApplication: the CES app registration and
 *    its certificate. Update APPENDS new key credentials (server-assigned
 *    keyId, the certificate's SHA-1 thumbprint as customKeyIdentifier) and
 *    keeps existing ones by keyId; key material is never stored or returned,
 *    as on Graph.
 *  - New-MgServicePrincipal: the app's service principal (the app must exist;
 *    a second one for the same appId is a conflict).
 *  - New-MgServicePrincipalAppRoleAssignment: one app-role grant per call;
 *    the resource service principal must offer the app role, and a duplicate
 *    grant is Graph's 400. Read back by Get-MgServicePrincipalAppRoleAssignment
 *    -ServicePrincipalId (records carry servicePrincipalId).
 *  - Get-/Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy: the
 *    Security Defaults singleton (-BodyParameter @{isEnabled=...} or
 *    -IsEnabled). A tenant whose seed has none reads the service default of
 *    an off policy (a tenant with Conditional Access policies has Security
 *    Defaults off).
 *
 * Azure (Az PowerShell):
 *  - New-/Get-AzResourceGroup: an ARM resource group (armResources, type
 *    Microsoft.Resources/resourceGroups, the same rows a synthetic customer's
 *    facade seeds). Get -Name names ONE group or is a 404.
 *  - Add-/Get-AzKeyVaultKey: a key in an existing vault (404 when the vault
 *    is missing); -Name names one key or is a 404.
 *  - New-/Get-AzAutomationAccount: an Automation account with a resource Id
 *    and, with -AssignSystemIdentity, a system-assigned identity.
 * Every create carries the ARM resource Id under the tenant's own
 * subscription (the armResources subscription row; 'sim-sub' when none).
 */

// Collections no earlier resolver or seed declared.
registerObjectType('identitySecurityDefaultsEnforcementPolicy');

const cmdlet = (
  name: string,
  endpoint: string,
  collection: string,
  verb: NamedCmdletResolverEntry['verb'],
  azureTier: NamedCmdletResolverEntry['azureTier'] = 'none',
): NamedCmdletResolverEntry => ({
  kind: 'cmdlet',
  cmdlet: name,
  endpoint,
  collection,
  verb,
  azureTier,
  ...(verb === 'GET' ? {} : { mutationVerbs: [verb as 'POST' | 'PATCH' | 'DELETE'] }),
});

/** Graph entries; spread into graphResolvers.ts's manual list (so no derived twin is generated). */
export const TENANT_INIT_GRAPH_ENTRIES: NamedCmdletResolverEntry[] = [
  cmdlet('Get-MgOrganization', '/organization', 'organization', 'GET'),
  cmdlet('Get-MgSubscribedSku', '/subscribedSkus', 'subscribedSkus', 'GET'),
  cmdlet('New-MgApplication', '/applications', 'applications', 'POST'),
  cmdlet('Update-MgApplication', '/applications/{id}', 'applications', 'PATCH'),
  cmdlet('New-MgServicePrincipal', '/servicePrincipals', 'servicePrincipals', 'POST'),
  cmdlet(
    'New-MgServicePrincipalAppRoleAssignment',
    '/servicePrincipals/{id}/appRoleAssignments',
    'servicePrincipalAppRoleAssignments',
    'POST',
  ),
  cmdlet(
    'Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy',
    '/policies/identitySecurityDefaultsEnforcementPolicy',
    'identitySecurityDefaultsEnforcementPolicy',
    'GET',
  ),
  cmdlet(
    'Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy',
    '/policies/identitySecurityDefaultsEnforcementPolicy',
    'identitySecurityDefaultsEnforcementPolicy',
    'PATCH',
  ),
];

/** Az entries; spread into azureResolvers.ts's manual list. */
export const TENANT_INIT_AZ_ENTRIES: NamedCmdletResolverEntry[] = [
  cmdlet('Get-AzResourceGroup', 'arm:Microsoft.Resources/resourceGroups', 'armResources', 'GET', 'full'),
  cmdlet('New-AzResourceGroup', 'arm:Microsoft.Resources/resourceGroups', 'armResources', 'POST', 'full'),
  cmdlet('Get-AzKeyVaultKey', 'kv:keys', 'keyVaultKeys', 'GET', 'full'),
  cmdlet('Add-AzKeyVaultKey', 'kv:keys', 'keyVaultKeys', 'POST', 'full'),
  cmdlet('Get-AzAutomationAccount', 'arm:Microsoft.Automation/automationAccounts', 'automationAccounts', 'GET', 'full'),
  cmdlet('New-AzAutomationAccount', 'arm:Microsoft.Automation/automationAccounts', 'automationAccounts', 'POST', 'full'),
];

export const TENANT_INIT_CMDLETS: ReadonlySet<string> = new Set(
  [...TENANT_INIT_GRAPH_ENTRIES, ...TENANT_INIT_AZ_ENTRIES].map((e) => e.cmdlet),
);

export interface TenantInitContext {
  store: ObjectStore;
  auditWriter?: DirectoryAuditWriter;
  now?: () => Date;
}

type Row = Record<string, unknown>;

// ------------------------------------------------------------------ args

function paramIndex(args: unknown[], name: string): number {
  const lc = name.toLowerCase();
  return args.findIndex((a) => typeof a === 'string' && /^-[A-Za-z]/.test(a) && a.slice(1).replace(/:.*$/, '').toLowerCase() === lc);
}

/** True when `-Name` (a switch, or `-Name:$true`) is present. */
function hasSwitch(args: unknown[], name: string): boolean {
  const i = paramIndex(args, name);
  if (i < 0) return false;
  const a = args[i] as string;
  const colon = a.indexOf(':');
  if (colon > 0) {
    const inline = a.slice(colon + 1);
    const v = inline.length > 0 ? inline : args[i + 1];
    return !(v === false || (typeof v === 'string' && /^\$?false$/i.test(v)));
  }
  return true;
}

/** The value after `-Name` (or `-Name:value`), unquoted when a string; undefined when absent. */
function paramValue(args: unknown[], name: string): unknown {
  const i = paramIndex(args, name);
  if (i < 0) return undefined;
  const a = args[i] as string;
  const colon = a.indexOf(':');
  let v: unknown = colon > 0 && colon < a.length - 1 ? a.slice(colon + 1) : args[i + 1];
  if (typeof v === 'string') {
    if (/^-[A-Za-z]/.test(v)) return undefined;
    v = v.trim().replace(/^['"]|['"]$/g, '');
  }
  return unwrapPsArray(v);
}

function str(args: unknown[], name: string): string | undefined {
  const v = paramValue(args, name);
  if (typeof v === 'number') return String(v);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Windows PowerShell 5.1 serializes an array held in $args as {value:[...], Count:n}. */
function unwrapPsArray(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Row;
    if (Array.isArray(o.value) && typeof o.Count === 'number' && Object.keys(o).length === 2) return o.value;
  }
  return v;
}

function lcGet(o: Row | undefined, key: string): unknown {
  if (!o) return undefined;
  const k = Object.keys(o).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : o[k];
}

const lc = (v: unknown) => String(v ?? '').toLowerCase();

/** Deterministic GUID-shaped id from a seed string (sim ids, not Microsoft GUIDs). */
export function simGuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The `appId eq '...'`-style single-clause OData filter value for `field`, if the filter is one. */
function eqFilterValue(args: unknown[], field: string): string | undefined {
  const f = str(args, 'Filter');
  if (!f) return undefined;
  const m = new RegExp(`^\\s*${field}\\s+eq\\s+'((?:[^']|'')*)'\\s*$`, 'i').exec(f);
  return m ? m[1].replace(/''/g, "'") : undefined;
}

// ------------------------------------------------------------------ handler

async function audit(ctx: TenantInitContext, objectType: string, objectId: string, verb: 'POST' | 'PATCH', source: string) {
  await ctx.auditWriter?.recordMutation({ objectType, objectId, activityDisplayName: `${verb} ${source}`, requestVerb: verb, source });
}

async function armSubscription(store: ObjectStore): Promise<string> {
  const sub = (await store.list('armResources')).find((r) => (r as Row).type === 'Microsoft.Resources/subscriptions') as Row | undefined;
  return String(sub?.subscriptionId ?? 'sim-sub');
}

/**
 * Resolves one TENANT_INIT_CMDLETS call against the store. Reads return the
 * object(s) the real cmdlet returns (an array when the cmdlet lists; the
 * psmodule wrapper's PowerShell output unrolls a one-item array, as the real
 * SDK does); writes return the created/updated object.
 */
export async function resolveTenantInit(ctx: TenantInitContext, name: string, rawArgs: unknown): Promise<unknown> {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const now = (ctx.now ?? (() => new Date()))();
  const { store } = ctx;

  switch (name) {
    // ------------------------------------------------------------ Graph
    case 'Get-MgOrganization': {
      const orgs = await store.list('organization');
      const id = str(args, 'OrganizationId');
      if (id === undefined) return orgs;
      const one = orgs.find((o) => o.id === id);
      if (!one) throw new NotFoundError(`Get-MgOrganization -OrganizationId '${id}': no such organization`);
      return one;
    }
    case 'Get-MgSubscribedSku': {
      const skus = await store.list('subscribedSkus');
      const id = str(args, 'SubscribedSkuId');
      if (id === undefined) return skus;
      const one = skus.find((s) => s.id === id || lc((s as Row).skuId) === lc(id));
      if (!one) throw new NotFoundError(`Get-MgSubscribedSku -SubscribedSkuId '${id}': no such SKU`);
      return one;
    }
    case 'New-MgApplication': {
      const displayName = str(args, 'DisplayName');
      if (!displayName) throw new BadRequestError('New-MgApplication: -DisplayName is required');
      const existing = await store.list('applications');
      const seed = `application:${displayName}:${existing.length + 1}`;
      const app: StoreObject = {
        id: simGuid(`${seed}:object`),
        appId: simGuid(`${seed}:appId`),
        displayName,
        signInAudience: str(args, 'SignInAudience') ?? 'AzureADMyOrg',
        keyCredentials: [],
        passwordCredentials: [],
        createdDateTime: now.toISOString(),
      };
      const created = await store.create('applications', app);
      await audit(ctx, 'applications', created.id, 'POST', name);
      return created;
    }
    case 'Update-MgApplication': {
      const id = str(args, 'ApplicationId');
      if (!id) throw new BadRequestError('Update-MgApplication: -ApplicationId is required');
      const app = (await store.list('applications')).find((a) => a.id === id);
      if (!app) throw new NotFoundError(`Update-MgApplication -ApplicationId '${id}': no applications object with that id`);
      const patch: Row = {};
      const dn = str(args, 'DisplayName');
      if (dn) patch.displayName = dn;
      const kc = paramValue(args, 'KeyCredentials');
      if (kc !== undefined) patch.keyCredentials = mergeKeyCredentials(app as Row, kc, now);
      const out = await store.update('applications', app.id, patch);
      await audit(ctx, 'applications', app.id, 'PATCH', name);
      return out;
    }
    case 'New-MgServicePrincipal': {
      const appId = str(args, 'AppId');
      if (!appId) throw new BadRequestError('New-MgServicePrincipal: -AppId is required');
      const app = (await store.list('applications')).find((a) => lc((a as Row).appId) === lc(appId)) as Row | undefined;
      if (!app) throw new BadRequestError(`New-MgServicePrincipal: no application with appId '${appId}' in this tenant`);
      const sps = await store.list('servicePrincipals');
      if (sps.some((s) => lc((s as Row).appId) === lc(appId))) {
        throw new BadRequestError(`New-MgServicePrincipal: a service principal for appId '${appId}' already exists (Request_MultipleObjectsWithSameKeyValue)`);
      }
      const sp: StoreObject = {
        id: simGuid(`servicePrincipal:${appId}`),
        appId,
        displayName: app.displayName ?? null,
        servicePrincipalType: 'Application',
        accountEnabled: true,
        appRoles: [],
        createdDateTime: now.toISOString(),
      };
      const created = await store.create('servicePrincipals', sp);
      await audit(ctx, 'servicePrincipals', created.id, 'POST', name);
      return created;
    }
    case 'New-MgServicePrincipalAppRoleAssignment': {
      const spId = str(args, 'ServicePrincipalId');
      const principalId = str(args, 'PrincipalId');
      const resourceId = str(args, 'ResourceId');
      const appRoleId = str(args, 'AppRoleId');
      if (!spId || !principalId || !resourceId || !appRoleId) {
        throw new BadRequestError(`${name}: -ServicePrincipalId, -PrincipalId, -ResourceId and -AppRoleId are required`);
      }
      const sps = await store.list('servicePrincipals');
      const sp = sps.find((s) => s.id === spId) as Row | undefined;
      if (!sp) throw new NotFoundError(`${name} -ServicePrincipalId '${spId}': no servicePrincipals object with that id`);
      const resource = sps.find((s) => s.id === resourceId) as Row | undefined;
      if (!resource) throw new BadRequestError(`${name}: resource service principal '${resourceId}' does not exist`);
      const role = ((resource.appRoles as Row[] | undefined) ?? []).find((r) => lc(lcGet(r, 'id')) === lc(appRoleId));
      if (!role) throw new BadRequestError(`${name}: Permission being assigned was not found on application '${String(resource.displayName)}' (appRoleId ${appRoleId})`);
      const all = await store.list('servicePrincipalAppRoleAssignments');
      const dup = all.some((a) => {
        const o = a as Row;
        return o.principalId === principalId && o.resourceId === resourceId && lc(o.appRoleId) === lc(appRoleId);
      });
      if (dup) throw new BadRequestError(`${name}: Permission being assigned already exists on the object`);
      const created = await store.create('servicePrincipalAppRoleAssignments', {
        id: simGuid(`appRoleAssignment:${principalId}:${resourceId}:${appRoleId}`),
        servicePrincipalId: sp.id as string,
        principalId,
        principalType: 'ServicePrincipal',
        principalDisplayName: sp.displayName ?? null,
        resourceId,
        resourceDisplayName: resource.displayName ?? null,
        appRoleId,
        appRoleValue: lcGet(role, 'value') ?? null,
        createdDateTime: now.toISOString(),
      });
      await audit(ctx, 'servicePrincipalAppRoleAssignments', created.id, 'POST', name);
      return created;
    }
    case 'Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy': {
      const rows = await store.list('identitySecurityDefaultsEnforcementPolicy');
      return rows[0] ?? SECURITY_DEFAULTS_SERVICE_DEFAULT;
    }
    case 'Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy': {
      const body = paramValue(args, 'BodyParameter');
      let isEnabled: unknown = body && typeof body === 'object' ? lcGet(body as Row, 'isEnabled') : undefined;
      if (isEnabled === undefined && paramIndex(args, 'IsEnabled') >= 0) {
        const v = paramValue(args, 'IsEnabled');
        isEnabled = v === undefined ? hasSwitch(args, 'IsEnabled') : v;
      }
      if (typeof isEnabled === 'string') isEnabled = /^\$?true$/i.test(isEnabled);
      if (typeof isEnabled !== 'boolean') throw new BadRequestError(`${name}: isEnabled (true/false) is required`);
      const rows = await store.list('identitySecurityDefaultsEnforcementPolicy');
      const id = rows[0]?.id ?? SECURITY_DEFAULTS_SERVICE_DEFAULT.id;
      const out = await store.upsert('identitySecurityDefaultsEnforcementPolicy', id, {
        ...(rows[0] ? {} : SECURITY_DEFAULTS_SERVICE_DEFAULT),
        isEnabled,
      });
      await audit(ctx, 'identitySecurityDefaultsEnforcementPolicy', id, 'PATCH', name);
      return out;
    }

    // ------------------------------------------------------------ Azure
    case 'Get-AzResourceGroup': {
      const groups = (await store.list('armResources')).filter((r) => (r as Row).type === 'Microsoft.Resources/resourceGroups').map((r) => presentResourceGroup(r as Row));
      const n = str(args, 'Name') ?? str(args, 'ResourceGroupName');
      if (n === undefined) return groups;
      const one = groups.find((g) => lc(g.ResourceGroupName) === lc(n));
      if (!one) throw new NotFoundError(`Get-AzResourceGroup -Name '${n}': Provided resource group does not exist.`);
      return one;
    }
    case 'New-AzResourceGroup': {
      const n = str(args, 'Name') ?? str(args, 'ResourceGroupName');
      const location = str(args, 'Location');
      if (!n || !location) throw new BadRequestError('New-AzResourceGroup: -Name and -Location are required');
      const id = `/subscriptions/${await armSubscription(store)}/resourceGroups/${n}`;
      const existing = (await store.list('armResources')).find((r) => lc(r.id) === lc(id));
      const tags = paramValue(args, 'Tag');
      const row = existing
        ? await store.update('armResources', existing.id, { location, ...(tags && typeof tags === 'object' ? { tags } : {}) })
        : await store.create('armResources', { id, name: n, type: 'Microsoft.Resources/resourceGroups', location, tags: tags && typeof tags === 'object' ? tags : {}, properties: { provisioningState: 'Succeeded' } });
      await audit(ctx, 'armResources', row.id, existing ? 'PATCH' : 'POST', name);
      return presentResourceGroup(row as Row);
    }
    case 'Get-AzKeyVaultKey': {
      const vaultName = str(args, 'VaultName');
      if (!vaultName) throw new BadRequestError('Get-AzKeyVaultKey: -VaultName is required');
      await requireVault(store, vaultName, name);
      const keys = (await store.list('keyVaultKeys')).map((k) => presentKey(k as Row)).filter((k) => lc(k.VaultName) === lc(vaultName));
      const keyName = str(args, 'Name');
      if (keyName === undefined) return keys;
      const one = keys.find((k) => lc(k.Name) === lc(keyName));
      if (!one) throw new NotFoundError(`Get-AzKeyVaultKey -VaultName '${vaultName}' -Name '${keyName}': Key not found`);
      return one;
    }
    case 'Add-AzKeyVaultKey': {
      const vaultName = str(args, 'VaultName');
      const keyName = str(args, 'Name');
      if (!vaultName || !keyName) throw new BadRequestError('Add-AzKeyVaultKey: -VaultName and -Name are required');
      const vault = await requireVault(store, vaultName, name);
      const uri = String(vault.VaultUri ?? `https://${vaultName}.vault.usgovcloudapi.net/`).replace(/\/?$/, '/');
      const version = simGuid(`key:${vaultName}:${keyName}:${now.getTime()}`).replace(/-/g, '');
      const id = `keyVaultKey-${vaultName}-${keyName}`.toLowerCase();
      const nowSec = Math.floor(now.getTime() / 1000);
      const existing = await store.read('keyVaultKeys', id);
      const row = await store.upsert('keyVaultKeys', id, {
        name: keyName,
        VaultName: vaultName,
        key: { kid: `${uri}keys/${keyName}/${version}`, kty: str(args, 'KeyType') ?? 'RSA' },
        attributes: { enabled: true, expires: null, created: (existing?.attributes as Row | undefined)?.created ?? nowSec, updated: nowSec, recoveryLevel: 'Recoverable' },
        destination: str(args, 'Destination') ?? 'Software',
      });
      await audit(ctx, 'keyVaultKeys', row.id, existing ? 'PATCH' : 'POST', name);
      return presentKey(row as Row);
    }
    case 'Get-AzAutomationAccount': {
      const rg = str(args, 'ResourceGroupName');
      let accounts = (await store.list('automationAccounts')).map((a) => presentAutomation(a as Row));
      if (rg !== undefined) accounts = accounts.filter((a) => lc(a.ResourceGroupName) === lc(rg));
      const n = str(args, 'Name');
      if (n === undefined) return accounts;
      const one = accounts.find((a) => lc(a.AutomationAccountName) === lc(n));
      if (!one) throw new NotFoundError(`Get-AzAutomationAccount -Name '${n}': The Automation account was not found.`);
      return one;
    }
    case 'New-AzAutomationAccount': {
      const rg = str(args, 'ResourceGroupName');
      const n = str(args, 'Name');
      const location = str(args, 'Location');
      if (!rg || !n || !location) throw new BadRequestError('New-AzAutomationAccount: -ResourceGroupName, -Name and -Location are required');
      await requireResourceGroup(store, rg, name);
      const all = await store.list('automationAccounts');
      if (all.some((a) => lc(lcGet(a as Row, 'name') ?? lcGet(a as Row, 'AutomationAccountName')) === lc(n) && lc(presentAutomation(a as Row).ResourceGroupName) === lc(rg))) {
        throw new BadRequestError(`New-AzAutomationAccount: an Automation account named '${n}' already exists in '${rg}'`);
      }
      const resourceId = `/subscriptions/${await armSubscription(store)}/resourceGroups/${rg}/providers/Microsoft.Automation/automationAccounts/${n}`;
      const identity = hasSwitch(args, 'AssignSystemIdentity')
        ? { Type: 'SystemAssigned', PrincipalId: simGuid(`automation-mi:${resourceId}`), TenantId: null }
        : null;
      const created = await store.create('automationAccounts', {
        id: `automationAccount-${n}`.toLowerCase(),
        name: n,
        AutomationAccountName: n,
        ResourceGroupName: rg,
        Location: location,
        Id: resourceId,
        ResourceId: resourceId,
        Plan: str(args, 'Plan') ?? 'Basic',
        State: 'Ok',
        Identity: identity,
        CreationTime: now.toISOString(),
      });
      await audit(ctx, 'automationAccounts', created.id, 'POST', name);
      return presentAutomation(created as Row);
    }
    default:
      throw new Error(`resolveTenantInit: no handler for cmdlet "${name}"`);
  }
}

/** Security Defaults when a seed carries none: off (a tenant with CA policies has turned them off). */
const SECURITY_DEFAULTS_SERVICE_DEFAULT = {
  id: '00000000-0000-0000-0000-000000000005',
  displayName: 'Security Defaults',
  description: 'Security defaults is a set of basic identity security mechanisms recommended by Microsoft.',
  isEnabled: false,
} as const;

/**
 * Update-MgApplication -KeyCredentials: entries that carry a keyId must be
 * the app's existing credentials (kept as stored); entries without one are
 * new certificates. A new credential gets a server keyId and, when its key is
 * a certificate (DER, or base64 text of one, as the bootstrap script sends),
 * the certificate's SHA-1 thumbprint as customKeyIdentifier. The key bytes
 * are not kept.
 */
function mergeKeyCredentials(app: Row, value: unknown, now: Date): Row[] {
  const incoming = (Array.isArray(value) ? value : [value]).map((v) => unwrapPsArray(v)).filter((v): v is Row => !!v && typeof v === 'object');
  const current = ((app.keyCredentials as Row[] | undefined) ?? []).filter((c) => c && typeof c === 'object');
  const out: Row[] = [];
  for (const cred of incoming) {
    const keyId = lcGet(cred, 'keyId');
    if (typeof keyId === 'string' && keyId) {
      const kept = current.find((c) => lc(c.keyId) === lc(keyId));
      if (!kept) throw new BadRequestError(`Update-MgApplication: keyCredential ${keyId} is not one of the application's credentials`);
      out.push(kept);
      continue;
    }
    const thumbprint = certThumbprint(lcGet(cred, 'key'));
    const n = current.length + out.length + 1;
    out.push({
      keyId: simGuid(`keyCredential:${String(app.id)}:${thumbprint ?? n}:${now.getTime()}`),
      type: lcGet(cred, 'type') ?? 'AsymmetricX509Cert',
      usage: lcGet(cred, 'usage') ?? 'Verify',
      displayName: lcGet(cred, 'displayName') ?? null,
      customKeyIdentifier: thumbprint ?? null,
      startDateTime: now.toISOString(),
      endDateTime: new Date(now.getTime() + 2 * 365 * 86400000).toISOString(),
      key: null,
    });
  }
  return out;
}

/** SHA-1 thumbprint (upper-case hex) of a certificate given as bytes, base64 text, or bytes of base64 text. */
export function certThumbprint(key: unknown): string | undefined {
  let buf: Buffer | undefined;
  const k = unwrapPsArray(key);
  if (Array.isArray(k) && k.every((b) => typeof b === 'number')) buf = Buffer.from(k as number[]);
  else if (typeof k === 'string' && k.length > 0) buf = Buffer.from(k, 'utf8');
  if (!buf || buf.length === 0) return undefined;
  const text = buf.toString('utf8').trim();
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(text) && text.length >= 16) {
    const der = Buffer.from(text, 'base64');
    if (der.length > 0) buf = der;
  }
  return createHash('sha1').update(buf).digest('hex').toUpperCase();
}

function presentResourceGroup(r: Row) {
  return {
    ...r,
    ResourceGroupName: String(r.name),
    Location: r.location,
    ProvisioningState: (r.properties as Row | undefined)?.provisioningState ?? 'Succeeded',
    Tags: r.tags ?? {},
    ResourceId: r.id,
  };
}

function presentKey(k: Row) {
  const kid = String((k.key as Row | undefined)?.kid ?? '');
  const m = /^https:\/\/([^.]+)\.[^/]+\/keys\/([^/]+)/i.exec(kid);
  const attrs = (k.attributes as Row | undefined) ?? {};
  return {
    ...k,
    VaultName: (k.VaultName as string | undefined) ?? m?.[1] ?? null,
    Name: (k.name as string | undefined) ?? m?.[2] ?? k.id,
    Id: kid || null,
    Version: kid ? kid.split('/').pop() : null,
    Enabled: attrs.enabled !== false,
    Attributes: { Enabled: attrs.enabled !== false, Expires: attrs.expires ?? null, Created: attrs.created ?? null, Updated: attrs.updated ?? null },
  };
}

function presentAutomation(a: Row) {
  const resourceId = (a.ResourceId as string | undefined) ?? (a.Id as string | undefined) ?? null;
  const rg = (a.ResourceGroupName as string | undefined) ?? (resourceId ? /\/resourceGroups\/([^/]+)/i.exec(resourceId)?.[1] : undefined) ?? null;
  return {
    ...a,
    AutomationAccountName: (a.AutomationAccountName as string | undefined) ?? (a.name as string | undefined) ?? a.id,
    ResourceGroupName: rg,
    Id: resourceId,
    ResourceId: resourceId,
  };
}

async function requireVault(store: ObjectStore, vaultName: string, cmdletName: string): Promise<Row> {
  const vault = (await store.list('keyVaults')).find((v) => lc(lcGet(v as Row, 'VaultName') ?? lcGet(v as Row, 'name')) === lc(vaultName)) as Row | undefined;
  if (!vault) throw new NotFoundError(`${cmdletName} -VaultName '${vaultName}': Vault not found`);
  return vault;
}

async function requireResourceGroup(store: ObjectStore, rg: string, cmdletName: string): Promise<void> {
  const arm = await store.list('armResources');
  // Only a tenant that models its subscription in ARM (clean-g5, the synthetic customers) is checked;
  // the count-generated profiles never modelled resource groups.
  if (!arm.some((r) => (r as Row).type === 'Microsoft.Resources/subscriptions')) return;
  const groups = arm.filter((r) => (r as Row).type === 'Microsoft.Resources/resourceGroups');
  if (!groups.some((g) => lc((g as Row).name) === lc(rg))) {
    throw new NotFoundError(`${cmdletName}: Resource group '${rg}' could not be found.`);
  }
}
