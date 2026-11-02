// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { ObjectStore } from '../store/ObjectStore.js';
import type { StoreObject } from '../store/StoreTypes.js';
import type { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import type { NamedCmdletResolverEntry } from './types.js';
import { registerObjectType } from '../store/schemas.js';
import { BadRequestError, NotFoundError } from './targets.js';

/**
 * DEPTH-9a (2026-10-31): the Azure cmdlets the infra registry entries send once DEPTH-2 plans them
 * for an m365_azure enclave (ces-strategy `docs/context/finish/LOG-DEPTH-2.md` §2), with the
 * service's own semantics, so a GET after a SET reads the SET's state back:
 *  - Get-/Set-AzContext: the session's Azure context. Set-AzContext -Subscription selects a
 *    subscription (the tenant's seeded one, when it has one; else the one named) and Get-AzContext
 *    then returns { Subscription: { Id, Name }, Tenant: { Id }, Account: null, Environment }
 *    (AZ-CTX-001 reads `.Subscription.Id`). Before any Set it returns an empty list, as before.
 *  - New-/Get-AzPolicyAssignment: a policy assignment at a scope (AZ-FOUND-002 at the
 *    subscription, AZ-POL-001 at the resource group). -Name (and -Scope, when given) names ONE
 *    assignment or is a 404 (PolicyAssignmentNotFound); no -Name lists every assignment (in
 *    -Scope, when given). The definition comes from -PolicyDefinition / -PolicySetDefinition
 *    (the object a Get-AzPolicy*Definition returned) or -PolicyDefinitionId /
 *    -PolicySetDefinitionId. EnforcementMode is 'Default', as Azure sets it.
 *  - Get-AzPolicyDefinition -Id / Get-AzPolicySetDefinition -Id: a built-in definition or
 *    initiative by its id (/providers/Microsoft.Authorization/policy[Set]Definitions/<guid>); a
 *    malformed id is a 400. (Before DEPTH-9a the derived Get-AzPolicySetDefinition read an unseeded
 *    collection, so AZ-FOUND-002 assigned a null initiative.)
 *  - New-AzNetworkWatcher: a Network Watcher in a region, ProvisioningState 'Succeeded' (AZ-NW-001
 *    verifies it); read back by the existing Get-AzNetworkWatcher (collection networkWatchers).
 *
 * DEPTH-9b (2026-11-01, PH-9 P9-SIM, V55 / V77 H-07):
 *  - Register-/Get-AzResourceProvider: one provider per -ProviderNamespace (registering again is a
 *    no-op), RegistrationState 'Registered' (the sim settles at once; Azure reports 'Registering'
 *    first). Get lists the registered providers (-ProviderNamespace names one). The derived resolver
 *    stored a row per call with no RegistrationState, so AZ-PREFLIGHT-001 could not assert state.
 *  - Set-/Get-AzSecurityPricing: one plan per -Name with its PricingTier. The derived PATCH collapsed
 *    every call onto one object, so AZ-FOUND-003's four Set calls left only the last plan (Arm).
 *    Get -Name reads one plan (none set: an empty list, as before); no -Name lists every plan set.
 *  - Get-AzRecoveryServicesVault: the Recovery Services vaults the tenant's ARM resources hold
 *    (armResources type Microsoft.RecoveryServices/vaults, which the customer seed already creates),
 *    in the Az shape (Name, ID, Type, Location, ResourceGroupName, Properties). No cmdlet read them,
 *    so the AO sweep's discovery found no vault for H-07's backupVaultName.
 */

registerObjectType('azContext');
registerObjectType('policyAssignments');
registerObjectType('networkWatchers');
registerObjectType('resourceProviders');
registerObjectType('securityPricings');

const cmdlet = (
  name: string,
  endpoint: string,
  collection: string,
  verb: NamedCmdletResolverEntry['verb'],
  azureTier: NamedCmdletResolverEntry['azureTier'] = 'sentinel',
): NamedCmdletResolverEntry => ({
  kind: 'cmdlet',
  cmdlet: name,
  endpoint,
  collection,
  verb,
  azureTier,
  ...(verb === 'GET' ? {} : { mutationVerbs: [verb as 'POST' | 'PATCH' | 'DELETE'] }),
});

/** Az entries; spread into azureResolvers.ts's manual list (so no derived twin is generated). */
export const DEPTH_INFRA_AZ_ENTRIES: NamedCmdletResolverEntry[] = [
  cmdlet('Get-AzContext', 'az:context', 'azContext', 'GET'),
  cmdlet('Set-AzContext', 'az:context', 'azContext', 'PATCH'),
  cmdlet('Get-AzPolicyAssignment', 'arm:Microsoft.Authorization/policyAssignments', 'policyAssignments', 'GET'),
  cmdlet('New-AzPolicyAssignment', 'arm:Microsoft.Authorization/policyAssignments', 'policyAssignments', 'POST'),
  cmdlet('Get-AzPolicyDefinition', 'arm:Microsoft.Authorization/policyDefinitions', 'policyDefinitions', 'GET'),
  cmdlet('Get-AzPolicySetDefinition', 'arm:Microsoft.Authorization/policySetDefinitions', 'policySetDefinitions', 'GET'),
  cmdlet('New-AzNetworkWatcher', 'arm:Microsoft.Network/networkWatchers', 'networkWatchers', 'POST', 'full'),
  // DEPTH-9b: tier 'full', as the derived entries these replace had.
  cmdlet('Register-AzResourceProvider', 'arm:Microsoft.Resources/providers', 'resourceProviders', 'POST', 'full'),
  cmdlet('Get-AzResourceProvider', 'arm:Microsoft.Resources/providers', 'resourceProviders', 'GET', 'full'),
  cmdlet('Set-AzSecurityPricing', 'arm:Microsoft.Security/pricings', 'securityPricings', 'PATCH', 'full'),
  cmdlet('Get-AzSecurityPricing', 'arm:Microsoft.Security/pricings', 'securityPricings', 'GET', 'full'),
  cmdlet('Get-AzRecoveryServicesVault', 'arm:Microsoft.RecoveryServices/vaults', 'armResources', 'GET', 'full'),
];

export const DEPTH_INFRA_CMDLETS: ReadonlySet<string> = new Set(DEPTH_INFRA_AZ_ENTRIES.map((e) => e.cmdlet));

export interface DepthInfraContext {
  store: ObjectStore;
  auditWriter?: DirectoryAuditWriter;
}

type Row = Record<string, unknown>;

// ------------------------------------------------------------------ args (same rules as tenantInitResolvers.ts)

function paramIndex(args: unknown[], name: string): number {
  const lc = name.toLowerCase();
  return args.findIndex((a) => typeof a === 'string' && /^-[A-Za-z]/.test(a) && a.slice(1).replace(/:.*$/, '').toLowerCase() === lc);
}

function unwrapPsArray(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Row;
    if (Array.isArray(o.value) && typeof o.Count === 'number' && Object.keys(o).length === 2) return o.value;
  }
  return v;
}

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

function lcGet(o: unknown, key: string): unknown {
  if (!o || typeof o !== 'object') return undefined;
  const k = Object.keys(o as Row).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : (o as Row)[k];
}

const lc = (v: unknown) => String(v ?? '').toLowerCase();
const trimSlash = (s: string) => s.replace(/\/+$/, '');

async function armSubscription(store: ObjectStore): Promise<{ id: string; name: string; tenantId: string | null; seeded: boolean }> {
  const sub = (await store.list('armResources')).find((r) => (r as Row).type === 'Microsoft.Resources/subscriptions') as Row | undefined;
  return {
    seeded: sub !== undefined,
    id: String(sub?.subscriptionId ?? 'sim-sub'),
    name: String(sub?.displayName ?? sub?.name ?? 'Simulated subscription'),
    tenantId: (sub?.tenantId as string | undefined) ?? null,
  };
}

async function audit(ctx: DepthInfraContext, objectType: string, objectId: string, verb: 'POST' | 'PATCH', source: string) {
  await ctx.auditWriter?.recordMutation({ objectType, objectId, activityDisplayName: `${verb} ${source}`, requestVerb: verb, source });
}

/** The definition id an assignment call names, from an object argument or an id argument. */
function definitionIdOf(args: unknown[]): { kind: 'policy' | 'set'; id: string } | undefined {
  for (const [param, kind, field] of [
    ['PolicyDefinition', 'policy', 'PolicyDefinitionId'],
    ['PolicySetDefinition', 'set', 'PolicySetDefinitionId'],
  ] as const) {
    const v = paramValue(args, param);
    if (v && typeof v === 'object') {
      const id = lcGet(v, field) ?? lcGet(v, 'ResourceId') ?? lcGet(v, 'Id');
      if (typeof id === 'string' && id) return { kind, id };
    }
    if (typeof v === 'string' && v) return { kind, id: v };
  }
  const pid = str(args, 'PolicyDefinitionId');
  if (pid) return { kind: 'policy', id: pid };
  const sid = str(args, 'PolicySetDefinitionId');
  if (sid) return { kind: 'set', id: sid };
  return undefined;
}

const BUILTIN_SET_DEFINITION = /^\/providers\/Microsoft\.Authorization\/policySetDefinitions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const BUILTIN_DEFINITION = /^\/providers\/Microsoft\.Authorization\/policyDefinitions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Resolves one DEPTH_INFRA_CMDLETS call against the store. */
export async function resolveDepthInfra(ctx: DepthInfraContext, name: string, rawArgs: unknown): Promise<unknown> {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const { store } = ctx;

  switch (name) {
    case 'Get-AzContext': {
      // Before any Set-AzContext there is no selected context: an empty list, as the derived
      // resolver answered before DEPTH-9a (so ces-tenant's azure identity probe,
      // `(Get-AzContext).Account`, reads what it always read).
      return await store.list('azContext');
    }
    case 'Set-AzContext': {
      const subId = str(args, 'Subscription') ?? str(args, 'SubscriptionId');
      if (!subId) throw new BadRequestError('Set-AzContext: -Subscription is required');
      const sub = await armSubscription(store);
      // A tenant seeded with a subscription row accepts only that subscription; a tenant with none
      // (no Azure seed) has nothing to contradict the caller and takes the one named.
      if (sub.seeded && lc(subId) !== lc(sub.id) && lc(subId) !== lc(sub.name)) {
        throw new BadRequestError(`Set-AzContext: subscription '${subId}' is not in this tenant (Please provide a valid tenant or a valid subscription)`);
      }
      const subscriptionId = sub.seeded ? sub.id : subId;
      const ctxRow: StoreObject = {
        id: 'context',
        Name: subscriptionId,
        Subscription: { Id: subscriptionId, Name: sub.seeded ? sub.name : subId },
        Tenant: { Id: str(args, 'Tenant') ?? sub.tenantId },
        Account: null,
        Environment: { Name: 'AzureUSGovernment' },
      };
      const out = await store.upsert('azContext', 'context', ctxRow);
      await audit(ctx, 'azContext', 'context', 'PATCH', name);
      return out;
    }
    case 'Get-AzPolicyDefinition': {
      const id = str(args, 'Id');
      if (!id) throw new BadRequestError('Get-AzPolicyDefinition: -Id is required in the simulator');
      const m = BUILTIN_DEFINITION.exec(id);
      if (!m) throw new BadRequestError(`Get-AzPolicyDefinition: '${id}' is not a built-in policy definition id`);
      return {
        id: m[1],
        Name: m[1],
        ResourceId: id,
        PolicyDefinitionId: id,
        Id: id,
        PolicyType: 'BuiltIn',
        Properties: { PolicyType: 'BuiltIn', Mode: 'Indexed' },
      };
    }
    case 'Get-AzPolicySetDefinition': {
      const id = str(args, 'Id');
      if (!id) throw new BadRequestError('Get-AzPolicySetDefinition: -Id is required in the simulator');
      const m = BUILTIN_SET_DEFINITION.exec(id);
      if (!m) throw new BadRequestError(`Get-AzPolicySetDefinition: '${id}' is not a built-in policy set definition id`);
      return { id: m[1], Name: m[1], ResourceId: id, PolicySetDefinitionId: id, Id: id, PolicyType: 'BuiltIn', Properties: { PolicyType: 'BuiltIn' } };
    }
    case 'Get-AzPolicyAssignment': {
      const all = (await store.list('policyAssignments')) as Row[];
      const scope = str(args, 'Scope');
      const inScope = scope ? all.filter((a) => lc(trimSlash(String(a.Scope))) === lc(trimSlash(scope))) : all;
      const nm = str(args, 'Name');
      if (nm === undefined) return inScope;
      const one = inScope.find((a) => lc(a.Name) === lc(nm));
      if (!one) throw new NotFoundError(`Get-AzPolicyAssignment -Name '${nm}'${scope ? ` -Scope '${scope}'` : ''}: PolicyAssignmentNotFound`);
      return one;
    }
    case 'New-AzPolicyAssignment': {
      const nm = str(args, 'Name');
      const scope = str(args, 'Scope');
      if (!nm || !scope) throw new BadRequestError('New-AzPolicyAssignment: -Name and -Scope are required');
      const def = definitionIdOf(args);
      if (!def) throw new BadRequestError('New-AzPolicyAssignment: a policy definition or policy set definition is required');
      const all = (await store.list('policyAssignments')) as Row[];
      if (all.some((a) => lc(a.Name) === lc(nm) && lc(trimSlash(String(a.Scope))) === lc(trimSlash(scope)))) {
        throw new BadRequestError(`New-AzPolicyAssignment: an assignment named '${nm}' already exists at '${scope}'`);
      }
      const resourceId = `${trimSlash(scope)}/providers/Microsoft.Authorization/policyAssignments/${nm}`;
      const identityType = str(args, 'IdentityType');
      const row: StoreObject = {
        id: resourceId,
        Name: nm,
        ResourceId: resourceId,
        Id: resourceId,
        DisplayName: str(args, 'DisplayName') ?? nm,
        Scope: scope,
        EnforcementMode: str(args, 'EnforcementMode') ?? 'Default',
        PolicyDefinitionId: def.id,
        ...(identityType ? { Identity: { Type: identityType }, Location: str(args, 'Location') ?? null } : {}),
      };
      const created = await store.create('policyAssignments', row);
      await audit(ctx, 'policyAssignments', created.id, 'POST', name);
      return created;
    }
    case 'New-AzNetworkWatcher': {
      const nm = str(args, 'Name');
      const rg = str(args, 'ResourceGroupName');
      const location = str(args, 'Location');
      if (!nm || !rg || !location) throw new BadRequestError('New-AzNetworkWatcher: -Name, -ResourceGroupName and -Location are required');
      const all = (await store.list('networkWatchers')) as Row[];
      if (all.some((w) => lc(lcGet(w, 'Location')) === lc(location))) {
        throw new BadRequestError(`New-AzNetworkWatcher: a Network Watcher already exists in '${location}' (only one per region)`);
      }
      const sub = await armSubscription(store);
      const resourceId = `/subscriptions/${sub.id}/resourceGroups/${rg}/providers/Microsoft.Network/networkWatchers/${nm}`;
      const created = await store.create('networkWatchers', {
        id: resourceId,
        Name: nm,
        ResourceGroupName: rg,
        Location: location,
        Id: resourceId,
        ProvisioningState: 'Succeeded',
      });
      await audit(ctx, 'networkWatchers', created.id, 'POST', name);
      return created;
    }
    case 'Register-AzResourceProvider': {
      const ns = str(args, 'ProviderNamespace');
      if (!ns) throw new BadRequestError('Register-AzResourceProvider: -ProviderNamespace is required');
      const all = (await store.list('resourceProviders')) as Row[];
      const found = all.find((p) => lc(p.ProviderNamespace) === lc(ns));
      if (found) return found;
      const created = await store.create('resourceProviders', {
        id: `provider-${ns.toLowerCase()}`,
        ProviderNamespace: ns,
        RegistrationState: 'Registered',
        ResourceTypes: [],
        Locations: [],
      });
      await audit(ctx, 'resourceProviders', created.id, 'POST', name);
      return created;
    }
    case 'Get-AzResourceProvider': {
      const all = (await store.list('resourceProviders')) as Row[];
      const ns = str(args, 'ProviderNamespace');
      return ns === undefined ? all : all.filter((p) => lc(p.ProviderNamespace) === lc(ns));
    }
    case 'Set-AzSecurityPricing': {
      const nm = str(args, 'Name');
      const tier = str(args, 'PricingTier');
      if (!nm || !tier) throw new BadRequestError('Set-AzSecurityPricing: -Name and -PricingTier are required');
      const all = (await store.list('securityPricings')) as Row[];
      const found = all.find((p) => lc(p.Name) === lc(nm));
      const sub = await armSubscription(store);
      const id = `/subscriptions/${sub.id}/providers/Microsoft.Security/pricings/${nm}`;
      const out = found
        ? await store.update('securityPricings', String(found.id), { PricingTier: tier })
        : await store.create('securityPricings', { id, Id: id, Name: nm, PricingTier: tier });
      await audit(ctx, 'securityPricings', out.id, 'PATCH', name);
      return out;
    }
    case 'Get-AzSecurityPricing': {
      const all = (await store.list('securityPricings')) as Row[];
      const nm = str(args, 'Name');
      return nm === undefined ? all : all.filter((p) => lc(p.Name) === lc(nm));
    }
    case 'Get-AzRecoveryServicesVault': {
      const vaults = ((await store.list('armResources')) as Row[])
        .filter((r) => lc(r.type) === 'microsoft.recoveryservices/vaults')
        .map((r) => {
          const armId = String(r.id);
          const rg = /\/resourceGroups\/([^/]+)\//i.exec(armId)?.[1] ?? null;
          const sub = /^\/subscriptions\/([^/]+)\//i.exec(armId)?.[1] ?? null;
          return {
            Name: r.name,
            name: r.name,
            ID: armId,
            Id: armId,
            Type: 'Microsoft.RecoveryServices/vaults',
            Location: r.location ?? null,
            ResourceGroupName: rg,
            SubscriptionId: sub,
            Properties: r.properties ?? {},
          };
        });
      const rg = str(args, 'ResourceGroupName');
      const inRg = rg ? vaults.filter((v) => lc(v.ResourceGroupName) === lc(rg)) : vaults;
      const nm = str(args, 'Name');
      if (nm === undefined) return inRg;
      const one = inRg.find((v) => lc(v.Name) === lc(nm));
      if (!one) throw new NotFoundError(`Get-AzRecoveryServicesVault -Name '${nm}': ResourceNotFound`);
      return one;
    }
    default:
      throw new BadRequestError(`resolveDepthInfra: ${name} is not a DEPTH-9a cmdlet`);
  }
}
