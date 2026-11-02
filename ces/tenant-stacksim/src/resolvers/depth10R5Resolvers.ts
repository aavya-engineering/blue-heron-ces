// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { randomUUID } from 'node:crypto';
import type { ObjectStore } from '../store/ObjectStore.js';
import type { StoreObject } from '../store/StoreTypes.js';
import type { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import type { NamedCmdletResolverEntry, UriPatternResolverEntry } from './types.js';
import { registerObjectType } from '../store/schemas.js';
import { BadRequestError, NotFoundError } from './targets.js';

/**
 * PH-12, agent P12-R5 (2026-11-01; ces-strategy `docs/context/finish/LOG-PH12-R5.md`).
 *
 * Part 1, DEPTH-10.6..10.11 (CM, MA, PS, RA+CA): the Graph REST surfaces the batch entries send that no
 * hand-authored or inventory-derived resolver answered. Plain collection semantics: POST creates a new member
 * with a new id (`singletonId` = the collection name, as deviceCompliancePolicies and configurationPolicies do),
 * GET lists the members in a `value` envelope. Registered FIRST in ResolverTable's DEFAULT_ENTRIES so a POST here
 * wins over an older GET-only entry of the same path.
 *  - /beta/deviceManagement/managedDeviceCleanupRules (CM.L2-3.4.1.device-cleanup): Intune device clean-up rules
 *    (managedDeviceCleanupRule; displayName, deviceCleanupRulePlatformType, deviceInactivityBeforeRetirementInDays).
 *  - /v1.0/identityGovernance/accessReviews/definitions (PS.L2-3.9.2.access-review): access review schedule
 *    definitions. graphResolvers.ts held this path GET-only (EO's coverage read); the sub-resources
 *    (/{id}/instances...) stay in ResolverTable.resolveCoverageSubresource.
 *
 * Part 2, the infra entries the simulator could not answer (PH12-FAMILY-GAPS.md "Simulator cannot answer"), with
 * the service's own semantics so a GET after the SET reads the SET's state back. Spread into azureResolvers.ts's
 * manual list (so the psmodule exports them and no derived twin is generated); ResolverTable.resolveCmdlet routes
 * DEPTH10_R5_CMDLETS (and the guest-configuration Invoke-AzRestMethod path) to resolveDepth10R5.
 *  - Get-/Register-AzProviderFeature (AZ-VM-001: EncryptionAtHost): one feature per -ProviderNamespace and
 *    -FeatureName, RegistrationState 'NotRegistered' until registered, then 'Registered' (Azure reports
 *    'Registering' first; the sim settles at once, as Register-AzResourceProvider does).
 *  - New-/Get-/Set-AzNetworkInterface (AZ-VM-001, AZ-NET-007): NICs in `networkInterfaces`, with one ipconfig on
 *    the -SubnetId subnet. Set persists the object it is handed (pipeline -InputObject), so a public IP set on
 *    `$nic.IpConfigurations[0].PublicIpAddress` is read back. A NIC that does not exist reads as an empty list
 *    (the registry reads it with -ErrorAction SilentlyContinue).
 *  - New-AzVM (AZ-VM-001): a virtual machine in `armResources` (the collection Get-AzVM reads) with a system
 *    managed identity, the -SecurityType / -EnableSecureBoot / -EnableVtpm / -EncryptionAtHost security profile,
 *    the NIC, and an OS disk (in `disks`, platform-key encryption). The -Credential is never stored.
 *  - Stop-/Start-AzVM, Update-AzVM (AZ-VM-002): power state; Update-AzVM -EncryptionAtHost changes the security
 *    profile only while the VM is deallocated (Azure: the setting can be changed only on a stopped, deallocated VM).
 *  - Get-AzDisk (AZ-VM-002 evidence): a disk by -DiskName in a resource group, 404 when absent.
 *  - Get-/New-AzPolicyExemption (AZ-NET-007): exemptions per -Name and -Scope; New names a -PolicyAssignment.
 *  - New-AzServiceEndpointPolicyDefinition, New-/Get-AzServiceEndpointPolicy (AZ-SEP-001): the definition is a
 *    local object (nothing stored, as in Az.Network); the policy stores its definitions (service + resources).
 *  - Invoke-AzRestMethod on .../virtualMachines/{vm}/providers/Microsoft.GuestConfiguration/
 *    guestConfigurationAssignments/{name} (AZ-VM-005): PUT creates or replaces the assignment (201 / 200), GET
 *    reads it (200) or 404; the answer is the PSHttpResponse shape the registry reads ({ StatusCode, Content }).
 *    A VM that does not exist is a 404 (ParentResourceNotFound).
 * Set-AzNetworkSecurityRuleConfig (AZ-NSG-007) is a client-side object editor in Az.Network, like
 * Add-AzNetworkSecurityRuleConfig; generatePsModule.ts carries it. Its entry here only makes the module export it.
 */

// ------------------------------------------------------------------ part 1: Graph REST collections

export const DEPTH10_R5_URI_ENTRIES: UriPatternResolverEntry[] = [
  {
    kind: 'uri',
    pattern: '/beta/deviceManagement/managedDeviceCleanupRules',
    collection: 'managedDeviceCleanupRules',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
    mutationVerbs: ['POST'],
    singletonId: 'managedDeviceCleanupRules',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/identityGovernance/accessReviews/definitions',
    collection: 'accessReviewDefinitions',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
    mutationVerbs: ['POST'],
    singletonId: 'accessReviewDefinitions',
  },
];

// ------------------------------------------------------------------ part 2: Azure

registerObjectType('providerFeatures');
registerObjectType('networkInterfaces');
registerObjectType('disks');
registerObjectType('policyExemptions');
registerObjectType('serviceEndpointPolicies');
registerObjectType('guestConfigurationAssignments');

const cmdlet = (name: string, collection: string, verb: NamedCmdletResolverEntry['verb']): NamedCmdletResolverEntry => ({
  kind: 'cmdlet',
  cmdlet: name,
  endpoint: `arm:${collection}`,
  collection,
  verb,
  azureTier: 'full',
  ...(verb === 'GET' ? {} : { mutationVerbs: [verb as 'POST' | 'PATCH' | 'DELETE'] }),
});

/** Az entries; spread into azureResolvers.ts's manual list (so no derived twin is generated). */
export const DEPTH10_R5_AZ_ENTRIES: NamedCmdletResolverEntry[] = [
  cmdlet('Get-AzProviderFeature', 'providerFeatures', 'GET'),
  cmdlet('Register-AzProviderFeature', 'providerFeatures', 'POST'),
  cmdlet('Get-AzNetworkInterface', 'networkInterfaces', 'GET'),
  cmdlet('New-AzNetworkInterface', 'networkInterfaces', 'POST'),
  cmdlet('Set-AzNetworkInterface', 'networkInterfaces', 'PATCH'),
  cmdlet('New-AzVM', 'armResources', 'POST'),
  cmdlet('Stop-AzVM', 'armResources', 'PATCH'),
  cmdlet('Start-AzVM', 'armResources', 'PATCH'),
  cmdlet('Update-AzVM', 'armResources', 'PATCH'),
  cmdlet('Get-AzDisk', 'disks', 'GET'),
  cmdlet('Get-AzPolicyExemption', 'policyExemptions', 'GET'),
  cmdlet('New-AzPolicyExemption', 'policyExemptions', 'POST'),
  cmdlet('New-AzServiceEndpointPolicyDefinition', 'serviceEndpointPolicies', 'POST'),
  cmdlet('New-AzServiceEndpointPolicy', 'serviceEndpointPolicies', 'POST'),
  cmdlet('Get-AzServiceEndpointPolicy', 'serviceEndpointPolicies', 'GET'),
  // Client-side in the psmodule (generatePsModule.ts AZ_CLIENT_SIDE_CONFIG_FNS); never reaches the server.
  cmdlet('Set-AzNetworkSecurityRuleConfig', 'nsgs', 'PATCH'),
];

/** The cmdlets resolveDepth10R5 answers (Set-AzNetworkSecurityRuleConfig is client-side, not here). */
export const DEPTH10_R5_CMDLETS: ReadonlySet<string> = new Set(
  DEPTH10_R5_AZ_ENTRIES.map((e) => e.cmdlet).filter((c) => c !== 'Set-AzNetworkSecurityRuleConfig'),
);

/** The ARM guest-configuration assignment path (AZ-VM-005), after normalizeUri (no host, no query). */
export const GUEST_CONFIG_PATH = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.Compute\/virtualMachines\/([^/]+)\/providers\/Microsoft\.GuestConfiguration\/guestConfigurationAssignments\/([^/]+)$/i;

export interface Depth10R5Context {
  store: ObjectStore;
  auditWriter?: DirectoryAuditWriter;
}

type Row = Record<string, unknown>;

// ------------------------------------------------------------------ args (same rules as depthInfraResolvers.ts)

function paramIndex(args: unknown[], name: string): number {
  const l = name.toLowerCase();
  return args.findIndex((a) => typeof a === 'string' && /^-[A-Za-z]/.test(a) && a.slice(1).replace(/:.*$/, '').toLowerCase() === l);
}

function unwrapPsArray(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Row;
    if (Array.isArray(o.value) && typeof o.Count === 'number' && Object.keys(o).length === 2) return o.value;
  }
  return v;
}

function has(args: unknown[], name: string): boolean {
  return paramIndex(args, name) >= 0;
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

/** A switch (-EncryptionAtHost) or a bool parameter (-EnableSecureBoot $true): true / false / undefined. */
function bool(args: unknown[], name: string): boolean | undefined {
  const i = paramIndex(args, name);
  if (i < 0) return undefined;
  const a = args[i] as string;
  const colon = a.indexOf(':');
  const v = colon > 0 && colon < a.length - 1 ? a.slice(colon + 1) : args[i + 1];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && /^\$?(true|false)$/i.test(v.trim())) return /true/i.test(v);
  return true; // a bare switch
}

function obj(args: unknown[], name: string): Row | undefined {
  const v = paramValue(args, name);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : undefined;
}

function lcGet(o: unknown, key: string): unknown {
  if (!o || typeof o !== 'object') return undefined;
  const k = Object.keys(o as Row).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : (o as Row)[k];
}

const lc = (v: unknown) => String(v ?? '').toLowerCase();
const rgOf = (id: unknown) => /\/resourceGroups\/([^/]+)/i.exec(String(id ?? ''))?.[1];

async function subscriptionId(store: ObjectStore): Promise<string> {
  const sub = ((await store.list('armResources')) as Row[]).find((r) => r.type === 'Microsoft.Resources/subscriptions');
  return String(sub?.subscriptionId ?? 'sim-sub');
}

async function audit(ctx: Depth10R5Context, objectType: string, objectId: string, verb: 'POST' | 'PATCH', source: string) {
  await ctx.auditWriter?.recordMutation({ objectType, objectId, activityDisplayName: `${verb} ${source}`, requestVerb: verb, source });
}

function need(args: unknown[], cmd: string, ...names: string[]): string[] {
  const vals = names.map((n) => str(args, n));
  const missing = names.filter((_, i) => vals[i] === undefined);
  if (missing.length) throw new BadRequestError(`${cmd}: ${missing.map((m) => `-${m}`).join(', ')} required`);
  return vals as string[];
}

async function findVm(store: ObjectStore, rg: string, name: string): Promise<Row | undefined> {
  return ((await store.list('armResources')) as Row[]).find(
    (r) => r.type === 'Microsoft.Compute/virtualMachines' && lc(r.name) === lc(name) && lc(rgOf(r.id)) === lc(rg),
  );
}

/** The VM name and resource group a call names (-Name / -ResourceGroupName, or the -VM object). */
function vmTarget(args: unknown[], cmd: string): { rg: string; name: string } {
  const vmObj = obj(args, 'VM');
  const name = str(args, 'Name') ?? (vmObj ? String(lcGet(vmObj, 'Name') ?? '') : undefined);
  const rg = str(args, 'ResourceGroupName') ?? (vmObj ? String(lcGet(vmObj, 'ResourceGroupName') ?? rgOf(lcGet(vmObj, 'Id')) ?? '') : undefined);
  if (!name || !rg) throw new BadRequestError(`${cmd}: -ResourceGroupName and -Name (or -VM) are required`);
  return { rg, name };
}

/** The PSHttpResponse an Invoke-AzRestMethod call returns. */
const httpResponse = (StatusCode: number, content: unknown) => ({ StatusCode, Content: JSON.stringify(content), Method: undefined });

/** Resolves one DEPTH10_R5_CMDLETS call (or the guest-configuration Invoke-AzRestMethod) against the store. */
export async function resolveDepth10R5(ctx: Depth10R5Context, name: string, rawArgs: unknown): Promise<unknown> {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const { store } = ctx;

  switch (name) {
    case 'Get-AzProviderFeature': {
      const [feature, ns] = need(args, name, 'FeatureName', 'ProviderNamespace');
      const id = `${ns}/${feature}`.toLowerCase();
      const row = ((await store.list('providerFeatures')) as Row[]).find((f) => f.id === id);
      return row ?? { FeatureName: feature, ProviderName: ns, RegistrationState: 'NotRegistered' };
    }
    case 'Register-AzProviderFeature': {
      const [feature, ns] = need(args, name, 'FeatureName', 'ProviderNamespace');
      const id = `${ns}/${feature}`.toLowerCase();
      const out = await store.upsert('providerFeatures', id, { FeatureName: feature, ProviderName: ns, RegistrationState: 'Registered' });
      await audit(ctx, 'providerFeatures', id, 'POST', name);
      return out;
    }
    case 'Get-AzNetworkInterface': {
      const rg = str(args, 'ResourceGroupName');
      const nm = str(args, 'Name');
      const all = ((await store.list('networkInterfaces')) as Row[]).filter((n) => rg === undefined || lc(n.ResourceGroupName) === lc(rg));
      if (nm === undefined) return all;
      return all.find((n) => lc(n.Name) === lc(nm)) ?? [];
    }
    case 'New-AzNetworkInterface': {
      const [rg, nm, location] = need(args, name, 'ResourceGroupName', 'Name', 'Location');
      const subnetId = str(args, 'SubnetId');
      if (!subnetId) throw new BadRequestError('New-AzNetworkInterface: -SubnetId is required');
      const all = (await store.list('networkInterfaces')) as Row[];
      if (all.some((n) => lc(n.Name) === lc(nm) && lc(n.ResourceGroupName) === lc(rg))) {
        throw new BadRequestError(`New-AzNetworkInterface: a network interface named '${nm}' already exists in '${rg}'`);
      }
      const id = `/subscriptions/${await subscriptionId(store)}/resourceGroups/${rg}/providers/Microsoft.Network/networkInterfaces/${nm}`;
      const created = await store.create('networkInterfaces', {
        id,
        Id: id,
        Name: nm,
        ResourceGroupName: rg,
        Location: location,
        ProvisioningState: 'Succeeded',
        IpConfigurations: [{ Name: 'ipconfig1', Id: `${id}/ipConfigurations/ipconfig1`, PrivateIpAllocationMethod: 'Dynamic', Subnet: { Id: subnetId }, PublicIpAddress: null }],
      });
      await audit(ctx, 'networkInterfaces', id, 'POST', name);
      return created;
    }
    case 'Set-AzNetworkInterface': {
      const nic = obj(args, 'InputObject') ?? obj(args, 'NetworkInterface');
      if (!nic) throw new BadRequestError('Set-AzNetworkInterface: -NetworkInterface (or pipeline input) is required');
      const key = String(lcGet(nic, 'Id') ?? lcGet(nic, 'id') ?? '');
      const found = ((await store.list('networkInterfaces')) as Row[]).find((n) => lc(n.id) === lc(key) || lc(n.Id) === lc(key));
      if (!found) throw new NotFoundError(`Set-AzNetworkInterface: no network interface '${key}' (ResourceNotFound)`);
      const { id: _drop, ...state } = nic;
      const out = await store.update('networkInterfaces', String(found.id), state);
      await audit(ctx, 'networkInterfaces', String(found.id), 'PATCH', name);
      return out;
    }
    case 'New-AzVM': {
      const [rg, nm, location] = need(args, name, 'ResourceGroupName', 'Name', 'Location');
      if (await findVm(store, rg, nm)) throw new BadRequestError(`New-AzVM: a virtual machine named '${nm}' already exists in '${rg}'`);
      const nicId = str(args, 'NetworkInterfaceId');
      if (nicId && !((await store.list('networkInterfaces')) as Row[]).some((n) => lc(n.id) === lc(nicId))) {
        throw new NotFoundError(`New-AzVM: network interface '${nicId}' not found`);
      }
      const sub = await subscriptionId(store);
      const id = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines/${nm}`;
      const osDisk = `${nm}_OsDisk_1`;
      const vm: StoreObject = {
        id,
        type: 'Microsoft.Compute/virtualMachines',
        name: nm,
        location,
        identity: has(args, 'SystemAssignedIdentity') ? { type: 'SystemAssigned', principalId: randomUUID(), tenantId: null } : undefined,
        properties: { provisioningState: 'Succeeded' },
        HardwareProfile: { VmSize: str(args, 'Size') ?? null },
        StorageProfile: { ImageReference: str(args, 'Image') ?? null, OsDisk: { Name: osDisk } },
        NetworkProfile: { NetworkInterfaces: nicId ? [{ Id: nicId }] : [] },
        SecurityProfile: {
          SecurityType: str(args, 'SecurityType') ?? null,
          EncryptionAtHost: bool(args, 'EncryptionAtHost') ?? null,
          UefiSettings: { SecureBootEnabled: bool(args, 'EnableSecureBoot') ?? null, VTpmEnabled: bool(args, 'EnableVtpm') ?? null },
        },
        PowerState: 'VM running',
      };
      const created = await store.create('armResources', vm);
      const diskId = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Compute/disks/${osDisk}`;
      await store.create('disks', { id: diskId, Id: diskId, Name: osDisk, ResourceGroupName: rg, Location: location, Encryption: { Type: 'EncryptionAtRestWithPlatformKey' } });
      await audit(ctx, 'armResources', id, 'POST', name);
      return { ...created, Name: nm, Id: id, ResourceGroupName: rg, ProvisioningState: 'Succeeded' };
    }
    case 'Stop-AzVM':
    case 'Start-AzVM':
    case 'Update-AzVM': {
      const { rg, name: nm } = vmTarget(args, name);
      const vm = await findVm(store, rg, nm);
      if (!vm) throw new NotFoundError(`${name}: no virtual machine '${nm}' in '${rg}' (ResourceNotFound)`);
      let patch: Row;
      if (name === 'Stop-AzVM') patch = { PowerState: has(args, 'StayProvisioned') ? 'VM stopped' : 'VM deallocated' };
      else if (name === 'Start-AzVM') patch = { PowerState: 'VM running' };
      else {
        const eah = bool(args, 'EncryptionAtHost');
        const sp = { ...((vm.SecurityProfile as Row | undefined) ?? {}) };
        if (eah !== undefined && eah !== sp.EncryptionAtHost) {
          if (vm.PowerState !== 'VM deallocated') {
            throw new BadRequestError(`Update-AzVM: EncryptionAtHost can only be changed when the virtual machine '${nm}' is stopped and deallocated (OperationNotAllowed)`);
          }
          sp.EncryptionAtHost = eah;
        }
        patch = { SecurityProfile: sp };
      }
      await store.update('armResources', String(vm.id), patch);
      await audit(ctx, 'armResources', String(vm.id), 'PATCH', name);
      return { Status: 'Succeeded', StartTime: new Date().toISOString(), EndTime: new Date().toISOString() };
    }
    case 'Get-AzDisk': {
      const rg = str(args, 'ResourceGroupName');
      const nm = str(args, 'DiskName') ?? str(args, 'Name');
      const all = ((await store.list('disks')) as Row[]).filter((d) => rg === undefined || lc(d.ResourceGroupName) === lc(rg));
      if (nm === undefined) return all;
      const one = all.find((d) => lc(d.Name) === lc(nm));
      if (!one) throw new NotFoundError(`Get-AzDisk -DiskName '${nm}': ResourceNotFound`);
      return one;
    }
    case 'Get-AzPolicyExemption': {
      const scope = str(args, 'Scope');
      const nm = str(args, 'Name');
      const all = ((await store.list('policyExemptions')) as Row[]).filter((x) => scope === undefined || lc(x.Scope) === lc(scope));
      if (nm === undefined) return all;
      return all.find((x) => lc(x.Name) === lc(nm)) ?? [];
    }
    case 'New-AzPolicyExemption': {
      const [nm, scope] = need(args, name, 'Name', 'Scope');
      const pa = obj(args, 'PolicyAssignment');
      const paId = pa ? String(lcGet(pa, 'ResourceId') ?? lcGet(pa, 'Id') ?? '') : str(args, 'PolicyAssignmentId');
      if (!paId) throw new BadRequestError('New-AzPolicyExemption: -PolicyAssignment is required');
      const category = str(args, 'ExemptionCategory');
      if (!category || !/^(Waiver|Mitigated)$/i.test(category)) throw new BadRequestError('New-AzPolicyExemption: -ExemptionCategory must be Waiver or Mitigated');
      const all = (await store.list('policyExemptions')) as Row[];
      if (all.some((x) => lc(x.Name) === lc(nm) && lc(x.Scope) === lc(scope))) throw new BadRequestError(`New-AzPolicyExemption: '${nm}' already exists at '${scope}'`);
      const id = `${scope.replace(/\/+$/, '')}/providers/Microsoft.Authorization/policyExemptions/${nm}`;
      const created = await store.create('policyExemptions', {
        id, ResourceId: id, Name: nm, Scope: scope, PolicyAssignmentId: paId, ExemptionCategory: category, Description: str(args, 'Description') ?? null,
      });
      await audit(ctx, 'policyExemptions', id, 'POST', name);
      return created;
    }
    case 'New-AzServiceEndpointPolicyDefinition': {
      const [nm, service] = need(args, name, 'Name', 'Service');
      const res = paramValue(args, 'ServiceResource');
      const resources = (Array.isArray(res) ? res : res === undefined ? [] : [res]).map(String).filter(Boolean);
      if (resources.length === 0) throw new BadRequestError('New-AzServiceEndpointPolicyDefinition: -ServiceResource needs at least one resource id');
      // A local object in Az.Network (nothing reaches Azure until the policy is created).
      return { Name: nm, Service: service, ServiceResources: resources, Description: str(args, 'Description') ?? null };
    }
    case 'New-AzServiceEndpointPolicy': {
      const [rg, nm, location] = need(args, name, 'ResourceGroupName', 'Name', 'Location');
      const defRaw = unwrapPsArray(paramValue(args, 'ServiceEndpointPolicyDefinition'));
      const defs = (Array.isArray(defRaw) ? defRaw : defRaw ? [defRaw] : []) as Row[];
      const all = (await store.list('serviceEndpointPolicies')) as Row[];
      if (all.some((p) => lc(p.Name) === lc(nm) && lc(p.ResourceGroupName) === lc(rg))) throw new BadRequestError(`New-AzServiceEndpointPolicy: '${nm}' already exists in '${rg}'`);
      const id = `/subscriptions/${await subscriptionId(store)}/resourceGroups/${rg}/providers/Microsoft.Network/serviceEndpointPolicies/${nm}`;
      const created = await store.create('serviceEndpointPolicies', {
        id,
        Id: id,
        Name: nm,
        ResourceGroupName: rg,
        Location: location,
        ProvisioningState: 'Succeeded',
        ServiceEndpointPolicyDefinitions: defs.map((d) => ({
          Name: lcGet(d, 'Name') ?? null,
          Service: lcGet(d, 'Service') ?? null,
          ServiceResources: (lcGet(d, 'ServiceResources') as unknown[] | undefined) ?? [],
          Description: lcGet(d, 'Description') ?? null,
        })),
      });
      await audit(ctx, 'serviceEndpointPolicies', id, 'POST', name);
      return created;
    }
    case 'Get-AzServiceEndpointPolicy': {
      const rg = str(args, 'ResourceGroupName');
      const nm = str(args, 'Name');
      const all = ((await store.list('serviceEndpointPolicies')) as Row[]).filter((p) => rg === undefined || lc(p.ResourceGroupName) === lc(rg));
      if (nm === undefined) return all;
      return all.find((p) => lc(p.Name) === lc(nm)) ?? [];
    }
    case 'Invoke-AzRestMethod': {
      const method = (str(args, 'Method') ?? 'GET').toUpperCase();
      const rawPath = str(args, 'Path') ?? '';
      const m = GUEST_CONFIG_PATH.exec(rawPath.split('?')[0]);
      if (!m) throw new BadRequestError(`Invoke-AzRestMethod: '${rawPath}' is not a guest configuration assignment path`);
      const [, sub, rg, vmName, assignment] = m;
      const id = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines/${vmName}/providers/Microsoft.GuestConfiguration/guestConfigurationAssignments/${assignment}`;
      if (!(await findVm(store, rg, vmName))) {
        return httpResponse(404, { error: { code: 'ParentResourceNotFound', message: `The virtual machine '${vmName}' was not found in '${rg}'.` } });
      }
      const existing = ((await store.list('guestConfigurationAssignments')) as Row[]).find((a) => lc(a.id) === lc(id));
      if (method === 'GET') {
        if (!existing) return httpResponse(404, { error: { code: 'ResourceNotFound', message: `Guest configuration assignment '${assignment}' was not found.` } });
        const { id: _i, ...body } = existing;
        return httpResponse(200, { id, ...body });
      }
      if (method !== 'PUT') throw new BadRequestError(`Invoke-AzRestMethod: ${method} is not modelled on a guest configuration assignment`);
      let payload: Row;
      try {
        const p = paramValue(args, 'Payload');
        payload = (typeof p === 'string' ? JSON.parse(p) : p) as Row;
      } catch {
        return httpResponse(400, { error: { code: 'InvalidRequestContent', message: 'The request content is not valid JSON.' } });
      }
      const gc = ((payload?.properties as Row | undefined)?.guestConfiguration ?? {}) as Row;
      if (!gc.name || !gc.version || !gc.contentUri || !gc.contentHash || !gc.assignmentType) {
        return httpResponse(400, { error: { code: 'InvalidRequestContent', message: 'properties.guestConfiguration needs name, version, contentUri, contentHash and assignmentType.' } });
      }
      const row: StoreObject = {
        id,
        name: assignment,
        location: payload.location ?? null,
        type: 'Microsoft.GuestConfiguration/guestConfigurationAssignments',
        properties: { guestConfiguration: gc, provisioningState: 'Succeeded', complianceStatus: 'Pending' },
      };
      if (existing) await store.update('guestConfigurationAssignments', id, row);
      else await store.create('guestConfigurationAssignments', row);
      await audit(ctx, 'guestConfigurationAssignments', id, existing ? 'PATCH' : 'POST', name);
      return httpResponse(existing ? 200 : 201, row);
    }
    default:
      throw new BadRequestError(`resolveDepth10R5: ${name} is not a P12-R5 cmdlet`);
  }
}

/** True for an Invoke-AzRestMethod call resolveDepth10R5 answers (the guest-configuration path). */
export function isDepth10R5AzRest(rawArgs: unknown): boolean {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  return GUEST_CONFIG_PATH.test((str(args, 'Path') ?? '').split('?')[0]);
}
