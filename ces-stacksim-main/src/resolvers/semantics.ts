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
import type { ResolverEntry } from './types.js';
import { NotFoundError } from './targets.js';

/**
 * SIMFIX FIX-S2 (GOAL-AO-SIM-COVERAGE M1-M5, 2026-09-27): semantic behaviour
 * for the cmdlets AO's 95 commands send - what the real service DOES, not
 * just "a resolver exists".
 *
 * Three tables, each keyed by the exact cmdlet name:
 *  - COLLECTION_REMAP: the cmdlet's real resource lives in a collection other
 *    than the one its noun auto-derives to (the "collection is the real
 *    identity" class: Get-MgRiskyUser -> riskyUser vs the seeded riskyUsers,
 *    Update-MgIdentityConditionalAccessPolicy -> identityConditionalAccessPolicy
 *    vs caPolicies, device actions -> their own action-named collections vs
 *    managedDevices). Writes then land where the paired read looks.
 *  - TARGET_ACTIONS: a cmdlet that names its target (-UserId, -ManagedDeviceId,
 *    -ApplicationId, ...) and changes it in a way that is not a plain property
 *    patch (retire/wipe/lost-mode/isolate set the device's real action state;
 *    sign-in revocation stamps signInSessionsValidFromDateTime; licence
 *    assignment edits assignedLicenses; app password add/remove edits
 *    passwordCredentials).
 *  - CUSTOM_GETS / UNTARGETED_ACTIONS: reads and writes whose selection rules
 *    are the service's own (Search-UnifiedAuditLog's RecordType/Operations/
 *    date window; Get-PnPListItem -List; Confirm-MgRiskyUser -UserIds).
 *
 * Nothing here is keyed on an AO command id or returns canned output: every
 * handler reads and writes the store.
 */

export const COLLECTION_REMAP: Record<string, string> = {
  // Identity / PIM
  'Update-MgIdentityConditionalAccessPolicy': 'caPolicies',
  'Get-MgRoleManagementDirectoryRoleAssignment': 'roleAssignments',
  'New-MgRoleManagementDirectoryRoleAssignment': 'roleAssignments',
  'Get-MgRoleManagementDirectoryRoleEligibilitySchedule': 'roleEligibilitySchedules',
  'New-MgRoleManagementDirectoryRoleEligibilityScheduleRequest': 'roleEligibilityScheduleRequests',
  'Get-MgUserAuthenticationMethod': 'authMethods',
  'Update-MgPolicyAuthenticationMethodPolicyAuthenticationMethodConfiguration': 'authenticationMethodsPolicyConfigurations',
  'Set-MgUserAuthenticationMethodRequirement': 'users',
  'Revoke-MgUserSignInSession': 'users',
  'Invoke-MgInvalidateAllUserRefreshToken': 'users',
  'Set-MgUserLicense': 'users',
  'Remove-MgGroupMemberByRef': 'groupMember',
  'Set-MgGroupVisibility': 'groups',
  'Get-MgRiskyUser': 'riskyUsers',
  'Confirm-MgRiskyUser': 'riskyUsers',
  'Get-MgApplication': 'applications',
  'Get-MgApplicationOwner': 'applicationOwners',
  'Add-MgApplicationPassword': 'applications',
  'Remove-MgApplicationPassword': 'applications',
  'Get-MgDirectorySetting': 'directorySettings',
  'Update-MgDirectorySetting': 'directorySettings',
  'Get-MgSecuritySecureScoreControlProfile': 'secureScoreControlProfiles',
  'Get-MgServicePrincipalAppRoleAssignment': 'servicePrincipalAppRoleAssignments',
  'Get-MgSecurityIncident': 'securityIncidents',
  'Update-MgSecurityIncident': 'securityIncidents',
  // Devices / MAM
  'Get-MgDeviceManagementDeviceConfiguration': 'deviceConfigurations',
  'New-MgDeviceManagementDeviceConfiguration': 'deviceConfigurations',
  'Get-MgDeviceManagementDeviceCompliancePolicyDeviceStatus': 'deviceCompliancePolicyDeviceStatuses',
  'Get-MgDeviceManagementWindowsAutopilotDeploymentProfile': 'windowsAutopilotDeploymentProfiles',
  'Set-MgDeviceManagementManagedDeviceName': 'managedDevices',
  'Invoke-MgDeviceManagementManagedDeviceSyncDevice': 'managedDevices',
  'Clear-MgDeviceManagementManagedDevice': 'managedDevices',
  'Invoke-MgDeviceManagementManagedDeviceRetireDevice': 'managedDevices',
  'Enable-MgDeviceManagementManagedDeviceLostMode': 'managedDevices',
  'Invoke-MgDeviceManagementManagedDeviceIsolateDevice': 'managedDevices',
  'Invoke-MgDeviceManagementManagedDeviceRequestRemoteAssistance': 'managedDevices',
  'Get-MgDeviceAppManagementAndroidManagedAppProtection': 'androidManagedAppProtections',
  'Update-MgDeviceAppManagementAndroidManagedAppProtection': 'androidManagedAppProtections',
  'New-MgDeviceAppManagementAndroidManagedAppProtectionApp': 'androidManagedAppProtectionApps',
  'Get-MgDeviceAppManagementIosManagedAppProtection': 'iosManagedAppProtections',
  'Update-MgDeviceAppManagementIosManagedAppProtection': 'iosManagedAppProtections',
  // Exchange / SharePoint
  'Set-Mailbox': 'mailboxes',
  'Get-SPOTenant': 'spoTenant',
  'Get-SPOSite': 'spoSites',
  'Set-SPOSite': 'spoSites',
  'Get-SPOUser': 'spoUsers',
  'Get-PnPListItem': 'pnpListItems',
  // Azure (New-* must create where the paired Get-* reads)
  'Get-AzOperationalInsightsWorkspace': 'logAnalyticsWorkspaces',
  'New-AzOperationalInsightsWorkspace': 'logAnalyticsWorkspaces',
  'New-AzVirtualNetwork': 'vnets',
  'New-AzNetworkSecurityGroup': 'nsgs',
  'Get-AzPublicIpAddress': 'publicIpAddresses',
  'New-AzPublicIpAddress': 'publicIpAddresses',
  'Get-AzRouteTable': 'routeTables',
  'New-AzRouteTable': 'routeTables',
  'Set-AzRouteTable': 'routeTables',
  'Get-AzNetworkWatcher': 'networkWatchers',
  'New-AzNetworkWatcher': 'networkWatchers',
  'Get-AzNetworkWatcherFlowLog': 'flowLogs',
  'New-AzNetworkWatcherFlowLog': 'flowLogs',
  'Get-AzSentinelAlertRule': 'sentinelAlertRules',
  'New-AzSentinelAlertRule': 'sentinelAlertRules',
};

/** Applies COLLECTION_REMAP to a resolver list (singleton defaults follow the new collection name). */
export function applyCollectionRemap(entries: ResolverEntry[]): ResolverEntry[] {
  return entries.map((e) => {
    if (e.kind !== 'cmdlet') return e;
    const to = COLLECTION_REMAP[e.cmdlet];
    if (!to || to === e.collection) return e;
    return {
      ...e,
      collection: to,
      ...(e.singletonId !== undefined ? { singletonId: e.singletonId === e.collection ? to : e.singletonId } : {}),
    };
  });
}

export interface ActionContext {
  store: ObjectStore;
  /** The resolved target object (already proven to exist). */
  target: StoreObject;
  targetCollection: string;
  /** The call's parameters as a patch (target parameter removed). */
  patch: Record<string, unknown>;
  now: string;
}

type TargetAction = (ctx: ActionContext) => Promise<unknown>;

function lcGet(o: Record<string, unknown>, key: string): unknown {
  const k = Object.keys(o).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : o[k];
}

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** PS 5.1 serializes DateTime as "\/Date(ms)\/" (or an object carrying it as `value`); normalize to ISO. */
export function normalizePsDate(v: unknown): string | undefined {
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) v = (v as Record<string, unknown>).value;
  if (typeof v !== 'string') return undefined;
  const m = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(v);
  if (m) return new Date(Number(m[1])).toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

async function deviceAction(ctx: ActionContext, actionName: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  const prior = asArray(lcGet(ctx.target, 'deviceActionResults'));
  return ctx.store.update(ctx.targetCollection, ctx.target.id, {
    ...extra,
    deviceActionResults: [
      ...prior,
      { actionName, actionState: 'pending', startDateTime: ctx.now, lastUpdatedDateTime: ctx.now },
    ],
  });
}

export const TARGET_ACTIONS: Record<string, TargetAction> = {
  // Graph revokeSignInSessions / invalidateAllRefreshTokens: the user's
  // signInSessionsValidFromDateTime moves to "now" (every earlier token dies).
  'Revoke-MgUserSignInSession': async (ctx) => {
    await ctx.store.update('users', ctx.target.id, { signInSessionsValidFromDateTime: ctx.now });
    return { value: true };
  },
  'Invoke-MgInvalidateAllUserRefreshToken': async (ctx) => {
    await ctx.store.update('users', ctx.target.id, { signInSessionsValidFromDateTime: ctx.now });
    return { value: true };
  },
  // assignLicense: add/remove SKU ids on the user; subscribedSkus consumedUnits follow.
  'Set-MgUserLicense': async (ctx) => {
    const add = asArray(lcGet(ctx.patch, 'addLicenses'))
      .map((l) => (l && typeof l === 'object' ? lcGet(l as Record<string, unknown>, 'skuId') : undefined))
      .filter((x): x is string => typeof x === 'string' && x.length > 0);
    const remove = asArray(lcGet(ctx.patch, 'removeLicenses')).filter((x): x is string => typeof x === 'string');
    const skus = await ctx.store.list('subscribedSkus');
    for (const skuId of add) {
      if (!skus.some((s) => lcGet(s, 'skuId') === skuId || s.id === skuId)) {
        throw new Error(`Request_BadRequest: License ${skuId} does not correspond to a valid company License.`);
      }
    }
    const current = asArray(lcGet(ctx.target, 'assignedLicenses')) as Array<Record<string, unknown>>;
    const kept = current.filter((l) => !remove.includes(String(lcGet(l, 'skuId'))));
    const next = [...kept];
    for (const skuId of add) if (!next.some((l) => lcGet(l, 'skuId') === skuId)) next.push({ skuId, disabledPlans: [] });
    for (const s of skus) {
      const skuId = String(lcGet(s, 'skuId') ?? s.id);
      const delta = (next.some((l) => lcGet(l, 'skuId') === skuId) ? 1 : 0) - (current.some((l) => lcGet(l, 'skuId') === skuId) ? 1 : 0);
      if (delta !== 0) await ctx.store.update('subscribedSkus', s.id, { consumedUnits: Number(lcGet(s, 'consumedUnits') ?? 0) + delta });
    }
    return ctx.store.update('users', ctx.target.id, { assignedLicenses: next });
  },
  'Set-MgUserAuthenticationMethodRequirement': async (ctx) => {
    const state = lcGet(ctx.patch, 'perUserMfaState');
    return ctx.store.update('users', ctx.target.id, { perUserMfaState: state ?? 'enforced' });
  },
  'Set-MgGroupVisibility': async (ctx) => ctx.store.update('groups', ctx.target.id, { visibility: lcGet(ctx.patch, 'visibility') }),
  // Intune managedDevice actions: each is queued on the device (real Intune
  // reports it in deviceActionResults; wipe/retire move managementState to
  // *Pending until the device checks in - the record is NOT removed at call time).
  'Set-MgDeviceManagementManagedDeviceName': async (ctx) => {
    const name = lcGet(ctx.patch, 'managedDeviceName') ?? lcGet(ctx.patch, 'deviceName');
    return deviceAction(ctx, 'setDeviceName', typeof name === 'string' ? { deviceName: name } : {});
  },
  'Invoke-MgDeviceManagementManagedDeviceSyncDevice': async (ctx) => deviceAction(ctx, 'syncDevice', { lastSyncDateTime: ctx.now }),
  'Clear-MgDeviceManagementManagedDevice': async (ctx) => deviceAction(ctx, 'wipe', { managementState: 'wipePending' }),
  'Invoke-MgDeviceManagementManagedDeviceRetireDevice': async (ctx) => deviceAction(ctx, 'retire', { managementState: 'retirePending' }),
  'Enable-MgDeviceManagementManagedDeviceLostMode': async (ctx) => deviceAction(ctx, 'enableLostMode', { lostModeState: 'enabled' }),
  'Invoke-MgDeviceManagementManagedDeviceIsolateDevice': async (ctx) => deviceAction(ctx, 'isolate'),
  'Invoke-MgDeviceManagementManagedDeviceRequestRemoteAssistance': async (ctx) => deviceAction(ctx, 'requestRemoteAssistance'),
  // addPassword / removePassword on an application.
  'Add-MgApplicationPassword': async (ctx) => {
    const cred = (lcGet(ctx.patch, 'passwordCredential') ?? {}) as Record<string, unknown>;
    const creds = asArray(lcGet(ctx.target, 'passwordCredentials')) as Array<Record<string, unknown>>;
    const keyId = `sim-key-${ctx.target.id}-${Date.parse(ctx.now).toString(36)}`;
    const endDateTime = normalizePsDate(lcGet(cred, 'endDateTime')) ?? new Date(Date.parse(ctx.now) + 180 * 86400000).toISOString();
    const created = {
      keyId,
      displayName: lcGet(cred, 'displayName') ?? null,
      startDateTime: ctx.now,
      endDateTime,
      hint: 'sim',
    };
    await ctx.store.update('applications', ctx.target.id, { passwordCredentials: [...creds, created] });
    // The real response carries the secret once; the sim hands back an obviously fake one and never stores it.
    return { ...created, secretText: 'sim-secret-not-a-real-credential' };
  },
  'Remove-MgApplicationPassword': async (ctx) => {
    const keyId = lcGet(ctx.patch, 'keyId');
    const creds = asArray(lcGet(ctx.target, 'passwordCredentials')) as Array<Record<string, unknown>>;
    if (!creds.some((c) => lcGet(c, 'keyId') === keyId)) {
      throw new NotFoundError(`application ${ctx.target.id} has no password credential with keyId "${String(keyId)}"`);
    }
    await ctx.store.update('applications', ctx.target.id, { passwordCredentials: creds.filter((c) => lcGet(c, 'keyId') !== keyId) });
    return { id: ctx.target.id, removedKeyId: keyId };
  },
};

/**
 * Plain same-collection updates that the real service post-processes:
 * a users PATCH carrying passwordProfile resets the password -> the service
 * stamps lastPasswordChangeDateTime and never stores/returns the password.
 */
export function transformUserPatch(patch: Record<string, unknown>, now: string): Record<string, unknown> {
  const pp = lcGet(patch, 'passwordProfile');
  if (!pp || typeof pp !== 'object') return patch;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (k.toLowerCase() !== 'passwordprofile') out[k] = v;
  const force = lcGet(pp as Record<string, unknown>, 'forceChangePasswordNextSignIn');
  out.passwordProfile = { forceChangePasswordNextSignIn: force === true };
  out.lastPasswordChangeDateTime = now;
  return out;
}

/** Confirm-MgRiskyUser -UserIds @(...): every named user becomes confirmedCompromised (users must exist). */
export async function confirmRiskyUsers(store: ObjectStore, args: unknown, now: string): Promise<unknown> {
  const ids: string[] = [];
  if (Array.isArray(args)) {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (typeof a === 'string' && /^-UserIds:?$/i.test(a)) {
        let v = args[i + 1];
        if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { value?: unknown }).value)) v = (v as { value: unknown[] }).value;
        for (const x of asArray(v)) if (typeof x === 'string' && x.trim()) ids.push(x.trim());
      }
    }
  }
  if (ids.length === 0) throw new Error('Confirm-MgRiskyUser: -UserIds is required');
  const users = await store.list('users');
  const out: StoreObject[] = [];
  for (const id of ids) {
    const user = users.find((u) => u.id === id);
    if (!user) throw new NotFoundError(`Confirm-MgRiskyUser: no user with id "${id}"`);
    out.push(
      await store.upsert('riskyUsers', id, {
        userPrincipalName: lcGet(user, 'userPrincipalName'),
        userDisplayName: lcGet(user, 'displayName'),
        riskLevel: 'high',
        riskState: 'confirmedCompromised',
        riskDetail: 'adminConfirmedUserCompromised',
        riskLastUpdatedDateTime: now,
        isDeleted: false,
        isProcessing: false,
      }),
    );
  }
  return out;
}

/** Get-MgUserMemberOf -UserId <id|upn>: the groups whose membership records name the user (SDK shape). */
export async function userMemberOf(store: ObjectStore, user: StoreObject): Promise<unknown[]> {
  const memberships = (await store.list('groupMember')).filter(
    (m) => (m as Record<string, unknown>).memberId === user.id,
  );
  const groups = await store.list('groups');
  const out: unknown[] = [];
  for (const m of memberships) {
    const g = groups.find((x) => x.id === (m as Record<string, unknown>).groupId);
    if (!g) continue;
    const displayName = lcGet(g, 'displayName');
    out.push({
      id: g.id,
      AdditionalProperties: { '@odata.type': '#microsoft.graph.group', id: g.id, displayName },
    });
  }
  return out;
}

/** A membership record presented as the member directoryObject (joined with the user it names). */
export async function presentMembers(store: ObjectStore, records: StoreObject[]): Promise<StoreObject[]> {
  const users = await store.list('users');
  return records.map((r) => {
    const memberId = (r as Record<string, unknown>).memberId;
    if (typeof memberId !== 'string') return r;
    const u = users.find((x) => x.id === memberId);
    const displayName = u ? lcGet(u, 'displayName') : undefined;
    const userPrincipalName = u ? lcGet(u, 'userPrincipalName') : undefined;
    return {
      ...r,
      id: memberId,
      ...(u ? { displayName, userPrincipalName } : {}),
      AdditionalProperties: {
        '@odata.type': '#microsoft.graph.user',
        ...(u ? { displayName, userPrincipalName } : {}),
      },
    };
  });
}

/** Parses `-Name value` style scalar args (case-insensitive name; colon form tolerated). */
export function argValue(args: unknown, name: string): unknown {
  if (!Array.isArray(args)) return undefined;
  const lc = name.toLowerCase();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string') continue;
    const m = /^-([A-Za-z]+):?(.*)$/.exec(a);
    if (!m || m[1].toLowerCase() !== lc) continue;
    if (m[2]) return m[2];
    const v = args[i + 1];
    if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { value?: unknown }).value) && 'Count' in (v as object)) {
      return (v as { value: unknown[] }).value;
    }
    return v;
  }
  return undefined;
}

function listArg(args: unknown, name: string): string[] | undefined {
  const v = argValue(args, name);
  if (v === undefined || v === null || v === true) return undefined;
  const parts = asArray(v).flatMap((x) => (typeof x === 'string' ? x.split(',') : []));
  const clean = parts.map((p) => p.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return clean.length ? clean : undefined;
}

/**
 * Search-UnifiedAuditLog over the seeded unifiedAuditLog collection. Honours
 * -StartDate/-EndDate (PS DateTime, '\/Date(ms)\/' or an ISO/yyyy-MM-dd
 * string), -RecordType and -Operations (comma lists / arrays, any-match),
 * -UserIds and -ResultSize. Seeded records carry `ageMinutes` (their
 * CreationDate is "now - ageMinutes" at query time - a rolling tenant log, so
 * AO's 1/7/30/90/365-day windows stay meaningful whenever the sim is served)
 * (anchored at the top of the current hour so repeated reads are identical)
 * or an absolute `CreationDate` (records written by the sim's own actions).
 * Output is the EXO object shape: CreationDate, UserIds, RecordType,
 * Operations, AuditData (a JSON string), ResultIndex, ResultCount.
 */
export async function searchUnifiedAuditLog(store: ObjectStore, args: unknown, nowMs: number): Promise<unknown[]> {
  const start = normalizePsDate(argValue(args, 'StartDate'));
  const end = normalizePsDate(argValue(args, 'EndDate'));
  const recordTypes = listArg(args, 'RecordType')?.map((r) => r.toLowerCase());
  const operations = listArg(args, 'Operations')?.map((o) => o.toLowerCase());
  const userIds = listArg(args, 'UserIds')?.map((u) => u.toLowerCase());
  const sizeRaw = argValue(args, 'ResultSize');
  const resultSize = typeof sizeRaw === 'number' ? sizeRaw : Number.parseInt(String(sizeRaw ?? '100'), 10) || 100;
  const startMs = start ? Date.parse(start) : undefined;
  // An EndDate given as a bare day (H-06's '2026-09-02') covers that whole day.
  const endRaw = argValue(args, 'EndDate');
  let endMs = end ? Date.parse(end) : undefined;
  if (endMs !== undefined && typeof endRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endRaw.trim())) endMs += 86400000 - 1;
  // Rolling records are dated from the top of the current hour, not from the
  // exact query instant: two reads seconds apart (a get-then-set's pre and
  // post reads) must return IDENTICAL records, or every audit read would look
  // "changed" without any write. Dates move only when the hour turns.
  const anchor = Math.floor(nowMs / 3600000) * 3600000;
  const rows = (await store.list('unifiedAuditLog'))
    .map((r) => {
      const rec = r as Record<string, unknown>;
      const created =
        typeof rec.ageMinutes === 'number' ? anchor - rec.ageMinutes * 60000 : Date.parse(String(rec.CreationDate ?? ''));
      return { rec, created };
    })
    .filter(({ rec, created }) => {
      if (Number.isNaN(created)) return false;
      if (startMs !== undefined && created < startMs) return false;
      if (endMs !== undefined && created > endMs) return false;
      if (recordTypes && !recordTypes.includes(String(rec.RecordType).toLowerCase())) return false;
      if (operations && !operations.includes(String(rec.Operations).toLowerCase())) return false;
      if (userIds && !userIds.includes(String(rec.UserIds).toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => b.created - a.created)
    .slice(0, resultSize);
  return rows.map(({ rec, created }, i) => {
    const { ageMinutes: _age, id, ...rest } = rec;
    const auditData = typeof rest.AuditData === 'string' ? rest.AuditData : JSON.stringify(rest.AuditData ?? {});
    return {
      ...rest,
      Identity: id,
      CreationDate: new Date(created).toISOString(),
      AuditData: auditData,
      ResultIndex: i + 1,
      ResultCount: rows.length,
    };
  });
}

/** Appends an audit record for an admin action the sim itself executed (absolute CreationDate). */
export async function appendAuditRecord(
  store: ObjectStore,
  rec: { RecordType: string; Operations: string; UserIds: string; ObjectId: string; now: string },
): Promise<void> {
  const existing = await store.list('unifiedAuditLog');
  const id = `ual-live-${existing.length + 1}`;
  await store.create('unifiedAuditLog', {
    id,
    CreationDate: rec.now,
    RecordType: rec.RecordType,
    Operations: rec.Operations,
    UserIds: rec.UserIds,
    AuditData: JSON.stringify({ Operation: rec.Operations, ObjectId: rec.ObjectId, UserId: rec.UserIds, CreationTime: rec.now }),
  });
}

/** Get-PnPListItem -List <title>: the list's items, each with a FieldValues bag (PnP shape). */
export async function getPnpListItems(store: ObjectStore, args: unknown): Promise<unknown[]> {
  const list = argValue(args, 'List');
  const title = typeof list === 'string' ? list.replace(/^['"]|['"]$/g, '') : undefined;
  if (!title) throw new Error('Get-PnPListItem: -List is required');
  const items = (await store.list('pnpListItems')).filter((i) => String(lcGet(i, 'list')).toLowerCase() === title.toLowerCase());
  if (items.length === 0 && !(await store.list('pnpLists')).some((l) => String(lcGet(l, 'title')).toLowerCase() === title.toLowerCase())) {
    throw new NotFoundError(`Get-PnPListItem: list '${title}' does not exist at the connected site`);
  }
  return items.map((i) => ({ Id: i.id, FieldValues: lcGet(i, 'fieldValues') }));
}

/**
 * SDK object shape for cmdlet reads whose derived-type properties live in the
 * SDK's AdditionalProperties bag (Graph PowerShell types a namedLocation as the
 * base class; ipRanges/isTrusted of an ipNamedLocation surface ONLY there).
 * The raw fields stay at the top level too, for callers that read them there.
 */
export function presentForCmdlet(cmdlet: string, obj: unknown): unknown {
  if (cmdlet !== 'Get-MgIdentityConditionalAccessNamedLocation') return obj;
  const one = (o: unknown) => {
    if (!o || typeof o !== 'object') return o;
    const r = o as Record<string, unknown>;
    return {
      ...r,
      AdditionalProperties: {
        '@odata.type': r['@odata.type'] ?? '#microsoft.graph.ipNamedLocation',
        ipRanges: r.ipRanges ?? [],
        isTrusted: r.isTrusted ?? false,
      },
    };
  };
  return Array.isArray(obj) ? obj.map(one) : one(obj);
}

/** ARM resource types of the collections New-Az* creates into (for the server-assigned resource `Id`). */
export const AZ_ARM_TYPES: Record<string, string> = {
  nsgs: 'Microsoft.Network/networkSecurityGroups',
  vnets: 'Microsoft.Network/virtualNetworks',
  routeTables: 'Microsoft.Network/routeTables',
  publicIpAddresses: 'Microsoft.Network/publicIPAddresses',
  firewalls: 'Microsoft.Network/azureFirewalls',
  flowLogs: 'Microsoft.Network/networkWatchers/flowLogs',
  storageAccounts: 'Microsoft.Storage/storageAccounts',
  keyVaults: 'Microsoft.KeyVault/vaults',
  logAnalyticsWorkspaces: 'Microsoft.OperationalInsights/workspaces',
  sentinelAlertRules: 'Microsoft.SecurityInsights/alertRules',
};
