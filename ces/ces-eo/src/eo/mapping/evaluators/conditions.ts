// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W5 cycle 1: shared condition tests for the rewritten (formerly presence-only)
 * evaluators. Founder rule: an evaluator tests a condition against the expected state (the Tenant
 * Manifest verification `expected_value` when the caller supplies it, else the control's
 * requirement default in REQUIREMENT_DEFAULTS); an unread or empty read, or a read that does not
 * carry the setting, is `not_assessed` with the read printed.
 */
import type { SignalResult } from 'ces-shared/types/signal';
import type { ControlStatus } from 'ces-shared/types/controls';
import { describeRead } from './helpers.js';

export type Verdict = { status: ControlStatus; evidence: string };

/** One Tenant Manifest verification check (ces-shared `ExpectedValueSchema`). */
export interface ExpectedValueCheck {
  path: string;
  op: 'equals' | 'contains' | 'gte' | 'lte' | 'exists' | 'count-gte';
  value?: unknown;
  source?: string;
}

/** Optional second evaluator argument. Absent fields fall back to the requirement defaults. */
export interface EvaluatorContext {
  /** The control's TM `normative_controls[].verification[].expected_value` checks. */
  expected?: ExpectedValueCheck[];
  /** Break-glass account object ids (else derived from the all-users MFA policy's exclusions). */
  breakGlassIds?: string[];
  /**
   * W7-EO3 (AC.L2-3.1.7 only): the organisation's designated break-glass account object ids from the TM
   * `tenant_identity` (`breakGlassUserId`, and `breakGlassUPN` resolved through the users read).
   */
  designatedBreakGlassIds?: string[];
  /** Separate admin account object ids (TM asset list / roster kind admin). */
  adminAccountIds?: string[];
  /**
   * W5 cycle 3 (AC.L2-3.1.6): the organisation's admin account naming convention, as the TM states it
   * (`config_intents[].desired_config.admin_naming_convention`, e.g. `adm.{firstname}.{lastname}@{domain}`).
   */
  adminNamingConvention?: string;
}

/**
 * Requirement defaults used when no TM expected value reaches the evaluator. Chosen from the
 * requirement text and the platform defaults; each one is an organisation-defined parameter (ODP)
 * that the answered value overrides.
 */
export const REQUIREMENT_DEFAULTS = {
  /** AC.L2-3.1.8: Entra smart lockout default threshold (attempts). */
  LOCKOUT_THRESHOLD_MAX: 10,
  /** AC.L2-3.1.8: Entra smart lockout default duration (seconds). */
  LOCKOUT_DURATION_MIN_SECONDS: 60,
  /** AC.L2-3.1.10 / SC.L2-3.13.9: screen lock after inactivity (minutes). */
  SCREEN_LOCK_MAX_MINUTES: 15,
  /**
   * AC.L2-3.1.11: CA sign-in frequency bound (hours). W7-EO (founder ruling 2, 2026-10-29): the CES 8-hour
   * baseline; an organisation's answered value may tighten it, never relax it (was 24).
   */
  SIGN_IN_FREQUENCY_MAX_HOURS: 8,
  /** IA.L2-3.5.6: days of inactivity after which an enabled identifier is stale. */
  INACTIVITY_MAX_DAYS: 90,
  /** IA.L2-3.5.7: minimum password length. */
  PASSWORD_MIN_LENGTH: 12,
  /** IA.L2-3.5.8: password generations remembered. */
  PASSWORD_HISTORY_MIN: 24,
  /** IA.L2-3.5.9: Temporary Access Pass maximum lifetime (minutes). */
  TAP_MAX_LIFETIME_MINUTES: 480,
  /** SI.L1-3.14.4: Defender signature update interval (hours). */
  AV_UPDATE_MAX_HOURS: 24,
  /** AC.L1-3.1.2: Global Administrator holders (Microsoft guidance: fewer than five). */
  GLOBAL_ADMIN_MAX: 4,
  /** AC.L2-3.1.5: break-glass accounts that may hold a standing privileged role. */
  BREAK_GLASS_MAX: 2,
  /**
   * W5 cycle 8 (IR.L2-3.6.1): days an alert or incident may stay new and unassigned before it counts as
   * unhandled (two weeks: a conservative bound; the organisation's triage period overrides it).
   */
  ALERT_TRIAGE_MAX_DAYS: 14,
} as const;

/** Built-in Entra role template ids treated as privileged (platform constants). */
export const PRIVILEGED_ROLE_TEMPLATES: ReadonlyMap<string, string> = new Map([
  ['62e90394-69f5-4237-9190-012177145e10', 'Global Administrator'],
  ['e8611ab8-c189-46e8-94e1-60213ab1f814', 'Privileged Role Administrator'],
  ['7be44c8a-adaf-4e2a-84d6-ab2649e08a13', 'Privileged Authentication Administrator'],
  ['194ae4cb-b126-40b2-bd5b-6091b380977d', 'Security Administrator'],
  ['3a2c62db-5318-420d-8d74-23affee5d9d5', 'Intune Administrator'],
  ['29232cdf-9323-42fd-ade2-1d097af3e4de', 'Exchange Administrator'],
  ['f28a1f50-f6e7-4571-818b-6a12f2af6b6c', 'SharePoint Administrator'],
  ['fe930be7-5e62-47db-91af-98c3a49a38b1', 'User Administrator'],
  ['b1be1c3e-b65d-4f19-8427-f6fa0d97feb9', 'Conditional Access Administrator'],
  ['9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3', 'Application Administrator'],
  ['158c047a-c907-4556-b7ef-446551a6b5f7', 'Cloud Application Administrator'],
  ['c4e39bd9-1100-46d3-8c65-fb160da0071f', 'Authentication Administrator'],
  ['17315797-102d-40b4-93e0-432062caca18', 'Compliance Administrator'],
]);
export const GLOBAL_ADMIN_TEMPLATE = '62e90394-69f5-4237-9190-012177145e10';

/** Graph authentication-strength combinations that are phishing resistant. */
export const PHISHING_RESISTANT_COMBINATIONS: ReadonlySet<string> = new Set([
  'fido2', 'windowsHelloForBusiness', 'x509CertificateMultiFactor',
]);

// ---------------------------------------------------------------- reads

/** The successful read of the first listed signal id that is present (any id order). */
export function successRead(signals: SignalResult[], ids: string[]): SignalResult | undefined {
  for (const id of ids) {
    const s = signals.find(x => x.signalId === id && x.status === 'success' && x.rawData != null);
    if (s) return s;
  }
  return undefined;
}

/** Array view of a read: a bare array, a `{ value: [] }` envelope, or one object. */
export function listOf(data: unknown): Record<string, unknown>[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data.filter(x => x && typeof x === 'object') as Record<string, unknown>[];
  if (typeof data === 'object') {
    const v = (data as Record<string, unknown>).value;
    if (Array.isArray(v)) return v.filter(x => x && typeof x === 'object') as Record<string, unknown>[];
    return [data as Record<string, unknown>];
  }
  return [];
}

/** Rows of the first successful read among `ids`, with its id; undefined when none was read. */
export function rowsOf(signals: SignalResult[], ids: string[]): { id: string; rows: Record<string, unknown>[] } | undefined {
  const s = successRead(signals, ids);
  return s ? { id: s.signalId, rows: listOf(s.rawData) } : undefined;
}

/** Every listed id's read state, for the evidence line. */
export function readsOf(signals: SignalResult[], ids: string[]): string {
  return ids.map(id => describeRead(signals, id)).join('; ');
}

/** The founder-rule `not_assessed`: what could not be decided, and the reads printed. */
export function notAssessed(what: string, reason: string, signals: SignalResult[], ids: string[]): Verdict {
  return { status: 'not_assessed', evidence: `${what}: ${reason} — not assessed. Read: ${readsOf(signals, ids)}` };
}

/** `not_assessed` when none of `ids` was read with objects; else null. */
export function unreadOrEmpty(signals: SignalResult[], ids: string[], what: string): Verdict | null {
  const r = rowsOf(signals, ids);
  if (r && r.rows.length > 0) return null;
  return notAssessed(what, r ? 'the read returned no objects' : 'not read', signals, ids);
}

// ---------------------------------------------------------------- expected values

/**
 * Resolves the small JSONPath subset the TM writes: `$.a.b`, `$.a[*].b`, `$.a[?(@.k=='v')].b`.
 * Returns every value found (an empty array when the path is absent).
 */
export function resolvePath(obj: unknown, path: string): unknown[] {
  const tokens = path.replace(/^\$\.?/, '').match(/[^.[\]]+|\[\*\]|\[\?\([^)]*\)\]/g) ?? [];
  let cur: unknown[] = [obj];
  for (const t of tokens) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (c == null || typeof c !== 'object') continue;
      if (t === '[*]') {
        if (Array.isArray(c)) next.push(...c);
      } else if (t.startsWith('[?(')) {
        const m = t.match(/@\.(\w+)\s*==\s*'([^']*)'/);
        if (m && Array.isArray(c)) next.push(...c.filter(x => x && typeof x === 'object' && String((x as Record<string, unknown>)[m[1]]) === m[2]));
      } else if (Array.isArray(c)) {
        for (const x of c) if (x && typeof x === 'object' && t in (x as object)) next.push((x as Record<string, unknown>)[t]);
      } else if (t in (c as object)) {
        next.push((c as Record<string, unknown>)[t]);
      }
    }
    cur = next;
  }
  return cur;
}

export const toNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Applies one check to an object: `pass`, `fail`, or `absent` (the path is not on the object). */
export function applyCheck(obj: unknown, check: ExpectedValueCheck): 'pass' | 'fail' | 'absent' {
  const found = resolvePath(obj, check.path);
  if (check.op === 'exists') return found.length > 0 && found.some(v => v != null) ? 'pass' : 'fail';
  if (found.length === 0) return 'absent';
  const flat = found.flatMap(v => (Array.isArray(v) ? v : [v]));
  switch (check.op) {
    case 'equals': return flat.some(v => v === check.value || String(v) === String(check.value)) ? 'pass' : 'fail';
    case 'contains': return flat.some(v => v === check.value || String(v) === String(check.value)) ? 'pass' : 'fail';
    case 'gte': { const e = toNumber(check.value); return e !== undefined && flat.some(v => (toNumber(v) ?? -Infinity) >= e) ? 'pass' : 'fail'; }
    case 'lte': { const e = toNumber(check.value); return e !== undefined && flat.some(v => (toNumber(v) ?? Infinity) <= e) ? 'pass' : 'fail'; }
    case 'count-gte': { const e = toNumber(check.value); return e !== undefined && flat.length >= e ? 'pass' : 'fail'; }
    default: return 'absent';
  }
}

export const describeCheck = (c: ExpectedValueCheck): string => `${c.path} ${c.op} ${JSON.stringify(c.value)}${c.source ? ` (${c.source})` : ''}`;

/** Provenance printed beside a requirement default (founder decision 2026-10-28: defaults only as the fallback). */
export const REQUIREMENT_DEFAULT_SOURCE = 'requirement default, no organisation value';

/** The expected value for one path, when the TM supplied it; else the default. */
export function expectedNumber(ctx: EvaluatorContext | undefined, pathPart: string, fallback: number): { value: number; source: string } {
  const c = ctx?.expected?.find(e => e.path.includes(pathPart) && toNumber(e.value) !== undefined);
  return c ? { value: toNumber(c.value)!, source: `organisation value: TM expected value (${c.source ?? 'tm'})` } : { value: fallback, source: REQUIREMENT_DEFAULT_SOURCE };
}

/**
 * The TM checks that apply to an object kind: those whose path resolves on at least one candidate.
 * Returns the failing checks (empty when every applicable check passes or none applies).
 */
export function failingChecks(candidates: unknown[], ctx: EvaluatorContext | undefined): string[] {
  const out: string[] = [];
  for (const check of ctx?.expected ?? []) {
    const results = candidates.map(c => applyCheck(c, check));
    if (results.every(r => r === 'absent')) continue;
    if (!results.includes('pass')) out.push(describeCheck(check));
  }
  return out;
}

// ---------------------------------------------------------------- Conditional Access

export type CaPolicy = Record<string, any>;

export const caName = (p: CaPolicy): string => String(p.displayName ?? p.id ?? 'unnamed');
export const isEnabled = (p: CaPolicy): boolean => p.state === 'enabled';
export const usersOf = (p: CaPolicy): Record<string, any> => p.conditions?.users ?? {};
export const targetsAllUsers = (p: CaPolicy): boolean => (usersOf(p).includeUsers ?? []).some((u: string) => String(u).toLowerCase() === 'all');
export const targetsGroupsOrRoles = (p: CaPolicy): boolean => (usersOf(p).includeGroups ?? []).length > 0 || (usersOf(p).includeRoles ?? []).length > 0;
export const builtIns = (p: CaPolicy): string[] => p.grantControls?.builtInControls ?? [];
export const requiresMfa = (p: CaPolicy): boolean => builtIns(p).includes('mfa') || !!p.grantControls?.authenticationStrength;
export const blocks = (p: CaPolicy): boolean => builtIns(p).includes('block');
export const includesPrivilegedRole = (p: CaPolicy): boolean => (usersOf(p).includeRoles ?? []).some((r: string) => PRIVILEGED_ROLE_TEMPLATES.has(r));

// ---------------------------------------------------------------- shared accounts

/**
 * W5 cycle 8 (IA.L1-3.5.1, AC.L2-3.1.7): a user principal name (local part) or display name that names
 * a shared or generic login rather than one person (a shop-floor, kiosk, front-desk or terminal login).
 */
export const SHARED_ACCOUNT_RE = /(^|[^a-z])(shared|generic|kiosk|shop[ ._-]?floor|front[ ._-]?desk|reception|terminal)([^a-z]|$)/i;

/** The enabled users whose UPN local part or display name marks a shared or generic login. */
export function sharedAccountsOf(users: Record<string, unknown>[]): Record<string, unknown>[] {
  return users.filter(u => u.accountEnabled !== false
    && (SHARED_ACCOUNT_RE.test(String(u.userPrincipalName ?? '').split('@')[0]) || SHARED_ACCOUNT_RE.test(String(u.displayName ?? ''))));
}

/** One account as evidence: id, UPN and display name. */
export const accountLabel = (u: Record<string, unknown>): string =>
  `${String(u.id)} (${String(u.userPrincipalName ?? '')}${u.displayName ? `, '${String(u.displayName)}'` : ''})`;

/** W7-EO: the managed-device reads (any signal on /deviceManagement/managedDevices, Graph JSON or PowerShell SDK casing). */
export const MANAGED_DEVICES_ENDPOINT = '/deviceManagement/managedDevices';
const devField = (r: Record<string, unknown>, key: string): unknown => (key in r ? r[key] : r[key.charAt(0).toUpperCase() + key.slice(1)]);

/**
 * W7-EO (IA.L1-3.5.1, shared login): the managed devices whose primary user (userPrincipalName or userId)
 * is this account, from every successful managed-device read, one per device id. More than one is the
 * corroborating signal that a name-matched account is a shared login.
 */
export function primaryDevicesOf(signals: SignalResult[], user: Record<string, unknown>): string[] {
  const upn = String(user.userPrincipalName ?? '').toLowerCase();
  const id = String(user.id ?? '');
  const seen = new Map<string, string>();
  for (const s of signals) {
    if (s.status !== 'success' || String(s.endpoint ?? '').split('?')[0] !== MANAGED_DEVICES_ENDPOINT) continue;
    for (const d of listOf(s.rawData)) {
      const dUpn = String(devField(d, 'userPrincipalName') ?? '').toLowerCase();
      const dUser = String(devField(d, 'userId') ?? '');
      if (!((upn && dUpn === upn) || (id && dUser === id))) continue;
      const key = String(devField(d, 'id') ?? devField(d, 'deviceName') ?? '');
      if (!seen.has(key)) seen.set(key, String(devField(d, 'deviceName') ?? key));
    }
  }
  return [...seen.values()];
}

/**
 * Break-glass accounts: the caller's list, else the users excluded from an enabled CA policy that
 * requires MFA of all users. More than BREAK_GLASS_MAX exclusions cannot all be break-glass, so the
 * derived list is then empty (nobody is excused) and `overflow` names the exclusions.
 */
export function breakGlassOf(policies: CaPolicy[], ctx?: EvaluatorContext): { ids: Set<string>; source: string; overflow?: string[] } {
  if (ctx?.breakGlassIds?.length) return { ids: new Set(ctx.breakGlassIds), source: 'supplied break-glass list' };
  const mfaAll = policies.filter(p => isEnabled(p) && targetsAllUsers(p) && requiresMfa(p));
  if (mfaAll.length === 0) return { ids: new Set(), source: 'no enabled all-users MFA policy read' };
  const excluded = new Set<string>(mfaAll.flatMap(p => (usersOf(p).excludeUsers ?? []) as string[]));
  if (excluded.size > REQUIREMENT_DEFAULTS.BREAK_GLASS_MAX) {
    return { ids: new Set(), source: `'${caName(mfaAll[0])}' excludes ${excluded.size} users, more than ${REQUIREMENT_DEFAULTS.BREAK_GLASS_MAX} break-glass accounts`, overflow: [...excluded] };
  }
  return { ids: excluded, source: `users excluded from '${caName(mfaAll[0])}'` };
}

// ---------------------------------------------------------------- Intune device configurations

const NON_SETTING_KEYS = new Set([
  'id', 'displayName', 'description', 'createdDateTime', 'lastModifiedDateTime', 'version',
  '@odata.type', 'roleScopeTagIds', 'supportsScopeTags', 'deviceManagementApplicabilityRuleOsEdition',
  'deviceManagementApplicabilityRuleOsVersion', 'deviceManagementApplicabilityRuleDeviceMode', 'AdditionalProperties',
  // W5 cycle 3: assignment fields ($expand=assignments) are not settings.
  'assignments', 'groupAssignments', 'isAssigned',
]);

/** Configurations that carry at least one setting field (not only identity fields). */
export function withSettings(configs: Record<string, unknown>[]): Record<string, unknown>[] {
  return configs.filter(c => Object.keys(c).some(k => !NON_SETTING_KEYS.has(k)));
}

/** Configurations whose `field` is present (not null/undefined). */
export function carrying(configs: Record<string, unknown>[], field: string): Record<string, unknown>[] {
  return configs.filter(c => c[field] !== undefined && c[field] !== null);
}

export const cfgName = (c: Record<string, unknown>): string => String(c.displayName ?? c.id ?? 'unnamed');

// ---------------------------------------------------------------- shared verdicts

/**
 * W5 cycle 5: the settings-catalog device-lock settings (DeviceLock policy CSP; definition ids from the
 * settings catalog, not verified live). The maximum inactivity is an integer (simple) setting in minutes;
 * DevicePasswordEnabled `_1` means the device password is disabled (no password to unlock).
 */
export const DEVICE_LOCK_MAX_INACTIVITY = 'device_vendor_msft_policy_config_devicelock_maxinactivitytimedevicelock';
export const DEVICE_PASSWORD_ENABLED = 'device_vendor_msft_policy_config_devicelock_devicepasswordenabled';
/** W5 cycle 5: the reads screen lock is judged on (device configurations, compliance policies, settings catalog). */
export const SCREEN_LOCK_READS = ['deviceConfigurations', 'compliancePolicies', 'configurationPolicies'];

/** The integer (simple) values of one settings-catalog definition in a policy, group children included. */
export function catalogSimpleValues(policy: Record<string, unknown>, definitionId: string): number[] {
  const out: number[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.settingDefinitionId === definitionId) {
      const v = toNumber((o.simpleSettingValue as Record<string, unknown> | undefined)?.value);
      if (v !== undefined) out.push(v);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(policy.settings);
  return out;
}

/**
 * AC.L2-3.1.10 and SC.L2-3.13.9: the screen locks within the bound with a password to unlock.
 * W5 cycle 5: judged on a device configuration (`passwordMinutesOfInactivityBeforeScreenTimeout`), a
 * compliance policy (`passwordMinutesOfInactivityBeforeLock`) or a settings-catalog policy (the device-lock
 * maximum inactivity), whichever reads reached the control; any one within the bound is met. The one bound
 * (the TM value of the inactivity ODP, else the requirement default) applies to all three. Assignment is
 * the mapper's assignment gate (an unassigned object credits nothing).
 */
export function screenLockVerdict(signals: SignalResult[], ctx: EvaluatorContext | undefined, what: string): Verdict {
  const ids = SCREEN_LOCK_READS;
  const rows = (id: string) => rowsOf(signals, [id])?.rows ?? [];
  const lock: Array<{ label: string; minutes: number | undefined; raw: unknown; password: boolean }> = [];
  for (const c of carrying(rows('deviceConfigurations'), 'passwordMinutesOfInactivityBeforeScreenTimeout')) {
    lock.push({ label: `'${cfgName(c)}'`, minutes: toNumber(c.passwordMinutesOfInactivityBeforeScreenTimeout), raw: c.passwordMinutesOfInactivityBeforeScreenTimeout, password: c.passwordRequired !== false });
  }
  for (const c of carrying(rows('compliancePolicies'), 'passwordMinutesOfInactivityBeforeLock')) {
    lock.push({ label: `compliance policy '${cfgName(c)}'`, minutes: toNumber(c.passwordMinutesOfInactivityBeforeLock), raw: c.passwordMinutesOfInactivityBeforeLock, password: c.passwordRequired !== false });
  }
  for (const p of rows('configurationPolicies')) {
    const values = catalogSimpleValues(p, DEVICE_LOCK_MAX_INACTIVITY);
    if (values.length === 0) continue;
    const disabled = (catalogChoices(p).choices.get(DEVICE_PASSWORD_ENABLED) ?? []).some(v => v.endsWith('_1'));
    for (const m of values) lock.push({ label: `settings-catalog policy '${catalogName(p)}'`, minutes: m, raw: m, password: !disabled });
  }
  if (lock.length === 0) {
    return notAssessed(what, `no device configuration sets passwordMinutesOfInactivityBeforeScreenTimeout, no compliance policy sets passwordMinutesOfInactivityBeforeLock and no settings-catalog policy sets ${DEVICE_LOCK_MAX_INACTIVITY}`, signals, ids);
  }
  const max = expectedNumber(ctx, 'passwordMinutesOfInactivityBeforeScreenTimeout', REQUIREMENT_DEFAULTS.SCREEN_LOCK_MAX_MINUTES);
  const seen = lock.map(l => `${l.label} ${String(l.raw)} min`).join(', ');
  const ok = lock.filter(l => l.minutes !== undefined && l.minutes > 0 && l.minutes <= max.value && l.password);
  if (ok.length > 0) {
    return { status: 'met', evidence: `${what}: ${seen}; locks within ${max.value} min (${max.source}) with a password to unlock` };
  }
  return { status: 'not_met', evidence: `${what}: ${seen}; none locks within ${max.value} min (${max.source}) with a password to unlock` };
}

/** AC.L2-3.1.21, MP.L2-3.8.7, MP.L2-3.8.8: a device configuration blocks removable storage. */
export function storageBlockVerdict(rows: Record<string, unknown>[], ctx: EvaluatorContext | undefined, what: string, signals: SignalResult[], ids: string[]): Verdict {
  const set = carrying(rows, 'storageBlockRemovableStorage');
  if (set.length === 0) return notAssessed(what, 'no device configuration sets storageBlockRemovableStorage', signals, ids);
  const blocked = set.filter(c => c.storageBlockRemovableStorage === true);
  const failing = failingChecks(blocked, ctx);
  if (blocked.length > 0 && failing.length === 0) {
    return { status: 'met', evidence: `${what}: '${blocked.map(cfgName).join("', '")}' blocks removable storage (storageBlockRemovableStorage true)` };
  }
  return { status: 'not_met', evidence: `${what}: ${set.map(c => `'${cfgName(c)}' storageBlockRemovableStorage ${String(c.storageBlockRemovableStorage)}`).join(', ')}; removable storage is not blocked${failing.length ? `; failing: ${failing.join(', ')}` : ''}` };
}

/** A CA-policy condition test: enabled policies that pass `test`, then the TM checks on them. */
export function caVerdict(
  signals: SignalResult[], ctx: EvaluatorContext | undefined, what: string,
  test: (p: CaPolicy) => boolean, metText: (names: string) => string, notMetText: string,
): Verdict {
  const empty = unreadOrEmpty(signals, ['conditionalAccess'], what);
  if (empty) return empty;
  const rows = rowsOf(signals, ['conditionalAccess'])!.rows as CaPolicy[];
  const hits = rows.filter(p => isEnabled(p) && test(p));
  if (hits.length === 0) {
    return { status: 'not_met', evidence: `${what}: ${rows.length} policy(ies) read (${rows.filter(isEnabled).length} enabled); ${notMetText}` };
  }
  const failing = failingChecks(hits, ctx);
  if (failing.length > 0) {
    return { status: 'not_met', evidence: `${what}: '${hits.map(caName).join("', '")}' meet the condition but fail the expected value(s): ${failing.join(', ')}` };
  }
  return { status: 'met', evidence: `${what}: ${metText(hits.map(caName).join("', '"))}` };
}

/** One device-configuration restriction: the field, the restrictive test, and how to say it. */
export type Restriction = [field: string, restrictive: (v: unknown) => boolean, label: string];

/**
 * A device configuration sets at least one listed restriction to its restrictive value. No
 * configuration carrying any listed field -> not_assessed; fields present but none restrictive -> not_met.
 */
export function restrictionVerdict(signals: SignalResult[], what: string, restrictions: Restriction[]): Verdict {
  const ids = ['deviceConfigurations'];
  const empty = unreadOrEmpty(signals, ids, 'Intune device configurations');
  if (empty) return empty;
  const rows = rowsOf(signals, ids)!.rows;
  const fields = restrictions.map(r => r[0]);
  const has = (r: Record<string, unknown>, f: string) => r[f] !== undefined && r[f] !== null;
  const shaped = rows.filter(r => fields.some(f => has(r, f)));
  if (shaped.length === 0) return notAssessed(what, `no device configuration sets ${fields.join(', ')}`, signals, ids);
  const hits: string[] = [];
  for (const r of shaped) {
    for (const [f, ok, label] of restrictions) if (has(r, f) && ok(r[f])) hits.push(`'${cfgName(r)}' ${label} (${f} ${String(r[f])})`);
  }
  if (hits.length > 0) return { status: 'met', evidence: `${what}: ${hits.join('; ')}` };
  return { status: 'not_met', evidence: `${what}: ${shaped.map(r => `'${cfgName(r)}' ${fields.filter(f => has(r, f)).map(f => `${f} ${String(r[f])}`).join(', ')}`).join('; ')}; none is set to restrict` };
}

// ---------------------------------------------------------------- Intune settings catalog (W5 cycle 2, EO-2)

/** One settings-catalog choice setting: its definition id, the deployed choice value, and how to say it. */
export type CatalogSetting = [definitionId: string, value: string, label: string];

/**
 * One legacy device-configuration field (`deviceConfigurations` templates) and its configured value.
 * W5 cycle 3: a dotted field (`firewallProfileDomain.firewallEnabled`) reads a nested property.
 */
export type LegacySetting = [field: string, value: unknown, label: string];

/** The value at a dotted field path of a legacy configuration (undefined when absent). */
const fieldAt = (r: Record<string, unknown>, f: string): unknown =>
  f.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), r);

export const catalogName = (p: Record<string, unknown>): string => String(p.name ?? p.displayName ?? p.id ?? 'unnamed');

/**
 * Every settingDefinitionId in a settings-catalog policy (group children included) with its choice
 * value(s). `truncated` is true when a nested `children` / `groupSettingCollectionValue` came back as
 * text instead of a list (a serialization-depth loss on the read path, not tenant state).
 */
export function catalogChoices(policy: Record<string, unknown>): { defs: Set<string>; choices: Map<string, string[]>; truncated: boolean } {
  const defs = new Set<string>();
  const choices = new Map<string, string[]>();
  let truncated = false;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (typeof o.settingDefinitionId === 'string') {
      defs.add(o.settingDefinitionId);
      const v = (o.choiceSettingValue as Record<string, unknown> | undefined)?.value;
      if (typeof v === 'string') choices.set(o.settingDefinitionId, [...(choices.get(o.settingDefinitionId) ?? []), v]);
    }
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'children' || k === 'groupSettingCollectionValue') && typeof v === 'string') truncated = true;
      walk(v);
    }
  };
  walk(policy.settings);
  return { defs, choices, truncated };
}

/**
 * W5 cycle 2 (EO-2): a condition test of the settings a Stamper entry deploys as a settings-catalog
 * policy (`configurationPolicies`, read with `$expand=settings`), optionally also of the legacy
 * `deviceConfigurations` fields; either source deciding met is met.
 * - every expected setting at its deployed value (across the policies that carry them) -> met;
 * - a policy carries the settings (or an `anchors` definition id) but one is missing or different ->
 *   not_met, every expected setting printed with the value(s) read;
 * - policies read, none carries the settings (and the legacy read, when routed, has none) -> not_met;
 * - the catalog read unread, errored, empty or without `settings` (and no legacy decision), or a
 *   policy whose nested settings came back as text -> not_assessed, reads printed.
 */
export function catalogVerdict(
  signals: SignalResult[], what: string, deployedBy: string, expected: CatalogSetting[],
  opts: { anchors?: string[]; legacy?: LegacySetting[]; catalogFirst?: boolean } = {},
): Verdict {
  const ids = ['configurationPolicies', ...(opts.legacy ? ['deviceConfigurations'] : [])];
  const cat = rowsOf(signals, ['configurationPolicies']);
  const catRows = cat?.rows ?? [];
  const keys = new Set([...expected.map(e => e[0]), ...(opts.anchors ?? [])]);
  const read = catRows.map(p => ({ p, ...catalogChoices(p) }));
  const carriers = read.filter(r => [...r.defs].some(d => keys.has(d)));
  const setTo = (def: string) => carriers.flatMap(r => (r.choices.get(def) ?? []).map(v => ({ v, name: catalogName(r.p) })));
  const metCatalog = carriers.length > 0 && expected.every(([def, value]) => setTo(def).some(x => x.v === value));

  const legacyRows = opts.legacy ? (rowsOf(signals, ['deviceConfigurations'])?.rows ?? []) : [];
  const has = (r: Record<string, unknown>, f: string) => fieldAt(r, f) !== undefined && fieldAt(r, f) !== null;
  // W5 cycle 3: with `catalogFirst`, a catalog policy carrying the settings decides; the legacy
  // template is consulted only when no catalog policy carries them.
  const legacyConsidered = !opts.catalogFirst || carriers.length === 0;
  const legacyShaped = opts.legacy && legacyConsidered ? legacyRows.filter(r => opts.legacy!.some(([f]) => has(r, f))) : [];
  const metLegacy = !!opts.legacy && legacyShaped.length > 0 && opts.legacy.every(([f, v]) => legacyShaped.some(r => fieldAt(r, f) === v));

  if (metCatalog) {
    const names = [...new Set(expected.flatMap(([def, value]) => setTo(def).filter(x => x.v === value).map(x => x.name)))];
    return { status: 'met', evidence: `${what}: settings-catalog policy '${names.join("', '")}' sets ${expected.map(e => e[2]).join(', ')} (the ${expected.length} setting(s) ${deployedBy} deploys, at their deployed values)` };
  }
  if (metLegacy) {
    const names = [...new Set(legacyShaped.filter(r => opts.legacy!.some(([f, v]) => fieldAt(r, f) === v)).map(cfgName))];
    return { status: 'met', evidence: `${what}: device configuration '${names.join("', '")}' sets ${opts.legacy!.map(([f, v, l]) => `${l} (${f} ${String(v)})`).join(', ')}` };
  }
  if (carriers.some(r => r.truncated)) {
    return notAssessed(what, `settings-catalog policy '${carriers.filter(r => r.truncated).map(r => catalogName(r.p)).join("', '")}' was read with its nested settings as text (read depth), so the deployed values cannot be compared`, signals, ids);
  }
  const shown: string[] = [];
  if (carriers.length > 0) {
    shown.push(`settings-catalog policy '${carriers.map(r => catalogName(r.p)).join("', '")}': ${expected.map(([def, value, label]) => {
      const seen = [...new Set(setTo(def).map(x => x.v))];
      return `${label}: ${def} = ${seen.length ? seen.join(' / ') : 'not set'} (deployed value ${value})`;
    }).join('; ')}`);
  }
  if (legacyShaped.length > 0) {
    shown.push(`device configuration ${legacyShaped.map(r => `'${cfgName(r)}' ${opts.legacy!.filter(([f]) => has(r, f)).map(([f, v]) => `${f} ${String(fieldAt(r, f))} (configured value ${String(v)})`).join(', ')}`).join('; ')}`);
  }
  if (shown.length > 0) return { status: 'not_met', evidence: `${what}: ${shown.join('; ')}; not every setting is at its deployed value` };

  const catalogRead = catRows.length > 0 && catRows.some(p => Array.isArray(p.settings));
  const legacyRead = !opts.legacy || legacyRows.length > 0;
  if (catalogRead && legacyRead) {
    return { status: 'not_met', evidence: `${what}: ${catRows.length} settings-catalog policy(ies) read ('${catRows.map(catalogName).join("', '")}')${opts.legacy ? ` and ${legacyRows.length} device configuration(s)` : ''}; none configures ${expected.map(e => e[2]).join(', ')}` };
  }
  return notAssessed(what, catRows.length > 0 && !catalogRead
    ? 'the settings-catalog policies were read without their settings ($expand=settings)'
    : (cat ? 'the settings-catalog read returned no objects' : 'the settings-catalog policies were not read'), signals, ids);
}
