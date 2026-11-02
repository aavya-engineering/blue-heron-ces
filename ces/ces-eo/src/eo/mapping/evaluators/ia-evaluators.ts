// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SignalResult } from 'ces-shared/types/signal';
import type { EvaluatorFn } from './index.js';
import {
  REQUIREMENT_DEFAULTS, REQUIREMENT_DEFAULT_SOURCE, PHISHING_RESISTANT_COMBINATIONS, type CaPolicy, type Verdict, type EvaluatorContext,
  rowsOf, listOf, notAssessed, unreadOrEmpty, expectedNumber, failingChecks, toNumber, successRead,
  breakGlassOf, isEnabled, targetsAllUsers, requiresMfa, blocks, caName, cfgName,
  includesPrivilegedRole, usersOf, PRIVILEGED_ROLE_TEMPLATES, sharedAccountsOf, accountLabel, primaryDevicesOf,
} from './conditions.js';

/** W7-EO (IA.L1-3.5.1): the evidence marker of a name-only shared-login hit (a review finding, never not_met; V70). */
export const SHARED_LOGIN_REVIEW = 'Review finding (shared-login name, not corroborated)';

// W5 cycle 1: every IA evaluator was presence only and now tests a condition; the rules are in
// docs/EVALUATOR-AUDIT.md. Unread, empty, or a read without the setting -> not_assessed, read printed.
const AUTH = ['authMethods'];
const CA = ['conditionalAccess'];
const USER_IDS = ['users', 'directoryUsers'];
/** W5 cycle 8 (IA.L2-3.5.3): the per-user MFA registration report (/reports/authenticationMethods/userRegistrationDetails). */
const REGISTRATION = ['userRegistrationDetails'];
const D = REQUIREMENT_DEFAULTS;
/** W5 cycle 3 (item 5): the deleted-users read covers Entra's 30-day recycle bin only. */
export const REUSE_WINDOW_NOTE = 'window-limited: Entra keeps deleted users for 30 days, so reuse after a permanent deletion is outside this read';
const MFA_METHODS = new Set(['fido2', 'microsoftauthenticator', 'x509certificate', 'softwareoath', 'sms', 'voice']);

type MethodConfig = Record<string, any>;

/** The method configurations embedded in the authentication methods policy read, or undefined. */
function methodConfigs(signals: SignalResult[]): MethodConfig[] | undefined {
  const r = rowsOf(signals, AUTH);
  if (!r) return undefined;
  const configs = r.rows.flatMap(p => (Array.isArray(p.authenticationMethodConfigurations) ? p.authenticationMethodConfigurations : []));
  return configs.length > 0 ? (configs as MethodConfig[]) : undefined;
}
const methodId = (c: MethodConfig): string => String(c.id ?? c['@odata.type'] ?? '').replace(/^#?microsoft\.graph\./, '').replace(/AuthenticationMethodConfiguration$/i, '').toLowerCase();
const NO_CONFIGS = 'the authentication methods policy was read without its method configurations (authenticationMethodConfigurations)';

/** Rows carrying `field` on any read passed to the evaluator (device configurations, compliance policies). */
function rowsCarrying(signals: SignalResult[], field: string): Record<string, unknown>[] {
  return signals.filter(s => s.status === 'success').flatMap(s => listOf(s.rawData)).filter(r => r[field] !== undefined && r[field] !== null);
}

/** A password setting compared with its bound on every object that carries it. */
function passwordSetting(signals: SignalResult[], ctx: EvaluatorContext | undefined, what: string, field: string, fallback: number): Verdict {
  const ids = [...new Set(signals.map(s => s.signalId))];
  const rows = rowsCarrying(signals, field);
  if (rows.length === 0) return notAssessed(what, `no read carries ${field} (a device configuration or compliance policy setting); the authentication methods policy does not hold it`, signals, ids.length ? ids : AUTH);
  const bound = expectedNumber(ctx, field, fallback);
  const seen = rows.map(r => `'${cfgName(r)}' ${String(r[field])}`).join(', ');
  const ok = rows.filter(r => (toNumber(r[field]) ?? -Infinity) >= bound.value);
  const failing = failingChecks(ok, ctx);
  if (ok.length > 0 && failing.length === 0) return { status: 'met', evidence: `${what}: ${field} ${seen} (at least ${bound.value}, ${bound.source})` };
  return { status: 'not_met', evidence: `${what}: ${field} ${seen}; ${ok.length === 0 ? `none at least ${bound.value} (${bound.source})` : `failing ${failing.join(', ')}`}` };
}

/** IA.L2-3.5.5 / 3.5.6: enabled identifiers inactive beyond the defined period. */
function inactivity(signals: SignalResult[], ctx: EvaluatorContext | undefined, what: string): Verdict {
  const empty = unreadOrEmpty(signals, USER_IDS, 'Users');
  if (empty) return empty;
  const read = successRead(signals, USER_IDS)!;
  const users = listOf(read.rawData);
  if (!users.some(u => u.signInActivity !== undefined)) return notAssessed(what, 'the users were read without signInActivity, so last activity is not shown', signals, USER_IDS);
  const days = expectedNumber(ctx, 'inactiv', D.INACTIVITY_MAX_DAYS);
  const ref = Date.parse(read.timestamp) || Date.now();
  const enabled = users.filter(u => u.accountEnabled !== false);
  const stale = enabled.filter(u => {
    const a = (u.signInActivity ?? {}) as Record<string, unknown>;
    const times = [a.lastSignInDateTime, a.lastNonInteractiveSignInDateTime, a.lastSuccessfulSignInDateTime]
      .map(t => (typeof t === 'string' ? Date.parse(t) : NaN)).filter(Number.isFinite);
    const last = times.length > 0 ? Math.max(...times) : Date.parse(String(u.createdDateTime ?? ''));
    return Number.isFinite(last) && (ref - last) / 86_400_000 > days.value;
  });
  if (stale.length > 0) {
    return { status: 'not_met', evidence: `${what}: ${stale.length} enabled account(s) inactive more than ${days.value} days (${days.source}): ${stale.map(u => String(u.id)).join(', ')}` };
  }
  return { status: 'met', evidence: `${what}: none of ${enabled.length} enabled account(s) is inactive more than ${days.value} days (${days.source}); ${users.length - enabled.length} disabled` };
}

/** A registration-report field, from flat Graph JSON or a PowerShell SDK object (PascalCase). */
const regField = (r: Record<string, unknown>, key: string): unknown => (key in r ? r[key] : r[key.charAt(0).toUpperCase() + key.slice(1)]);

/**
 * IA.L2-3.5.3 (W5 cycle 8): the registration report's rows with isMfaRegistered false, disabled accounts
 * (a users read matched by UPN) left out. Not_met naming each account by its object id; null when the
 * report was not read, holds no row, or every enabled account is registered.
 */
function unregisteredForMfa(signals: SignalResult[]): Verdict | null {
  const reg = rowsOf(signals, REGISTRATION);
  if (!reg || reg.rows.length === 0) return null;
  const users = rowsOf(signals, USER_IDS)?.rows ?? [];
  const byUpn = new Map(users.map(u => [String(u.userPrincipalName ?? '').toLowerCase(), u]));
  const userOf = (r: Record<string, unknown>) => byUpn.get(String(regField(r, 'userPrincipalName') ?? '').toLowerCase());
  const rows = reg.rows.filter(r => userOf(r)?.accountEnabled !== false);
  const missing = rows.filter(r => regField(r, 'isMfaRegistered') === false);
  if (missing.length === 0) return null;
  const idOf = (r: Record<string, unknown>) => String(userOf(r)?.id ?? regField(r, 'id'));
  return { status: 'not_met', evidence: `Multifactor authentication: ${missing.length} of ${rows.length} enabled account(s) in the registration report have no MFA method registered, so they cannot complete MFA whatever the policies require: ${missing.map(r => `${idOf(r)} (${String(regField(r, 'userPrincipalName') ?? '')})`).join(', ')}` };
}

export const iaEvaluators: Record<string, EvaluatorFn> = {
  // IA.L1-3.5.1: every user and every device carries a unique identifier.
  userDeviceIdentifyEvaluator: (signals) => {
    const empty = unreadOrEmpty(signals, USER_IDS, 'Users');
    if (empty) return empty;
    const users = rowsOf(signals, USER_IDS)!.rows;
    if (!users.some(u => u.userPrincipalName)) return notAssessed('User and device identification', 'the users were read without userPrincipalName', signals, USER_IDS);
    const upns = users.map(u => String(u.userPrincipalName ?? '').toLowerCase());
    if (upns.some(u => u === '') || users.some(u => !u.id)) return { status: 'not_met', evidence: `User and device identification: ${users.filter(u => !u.id || !u.userPrincipalName).length} account(s) without an id or user principal name` };
    const dup = upns.filter((u, i) => upns.indexOf(u) !== i);
    if (dup.length > 0) return { status: 'not_met', evidence: `User and device identification: duplicate user principal name(s): ${[...new Set(dup)].join(', ')}` };
    // W5 cycle 8 (S3-D12): a shared or generic login identifies no one person.
    // W7-EO: the name alone is a review finding; not_met needs a corroborating signal: the account is the
    // primary user of more than one managed device (no roster record reaches EO).
    const shared = sharedAccountsOf(users).map(u => ({ u, devices: primaryDevicesOf(signals, u) }));
    const corroborated = shared.filter(s => s.devices.length > 1);
    if (corroborated.length > 0) return { status: 'not_met', evidence: `User and device identification: ${corroborated.length} enabled account(s) named as a shared or generic login and primary user of more than one managed device, so its actions are not traceable to one person: ${corroborated.map(s => `${accountLabel(s.u)} on ${s.devices.length} devices (${s.devices.join(', ')})`).join('; ')}` };
    const review = shared.length > 0 ? `; ${SHARED_LOGIN_REVIEW}: ${shared.map(s => `${accountLabel(s.u)} (managed devices with this primary user: ${s.devices.length})`).join('; ')}` : '';
    const dev = rowsOf(signals, ['devices']);
    if (!dev || dev.rows.length === 0) return notAssessed('User and device identification', `${users.length} account(s) each carry a unique id and user principal name; the device read (/devices) was not read or was empty${review}`, signals, [...USER_IDS, 'devices']);
    const noId = dev.rows.filter(d => !d.deviceId && !d.id);
    if (noId.length === dev.rows.length) return notAssessed('User and device identification', `the devices were read without identifiers${review}`, signals, ['devices']);
    if (noId.length > 0) return { status: 'not_met', evidence: `User and device identification: ${noId.length} device(s) without an identifier${review}` };
    return { status: 'met', evidence: `User and device identification: ${users.length} account(s) with unique user principal names and ${dev.rows.length} device(s) with identifiers${review}` };
  },

  // IA.L1-3.5.2: an authentication method is enabled, so access requires authentication.
  authTransactionEvaluator: (signals) => {
    const empty = unreadOrEmpty(signals, AUTH, 'Authentication methods policy');
    if (empty) return empty;
    const configs = methodConfigs(signals);
    if (!configs) return notAssessed('Authentication methods', NO_CONFIGS, signals, AUTH);
    const on = configs.filter(c => c.state === 'enabled');
    if (on.length === 0) return { status: 'not_met', evidence: `Authentication methods: all ${configs.length} method configuration(s) are disabled` };
    return { status: 'met', evidence: `Authentication methods: ${on.length} of ${configs.length} enabled (${on.map(methodId).join(', ')})` };
  },

  // IA.L2-3.5.3: MFA for privileged and non-privileged accounts: an MFA method is enabled and an
  // enabled CA policy requires MFA of all users, excusing only break-glass accounts.
  mfaMethodsEvaluator: (signals, ctx) => {
    const empty = unreadOrEmpty(signals, AUTH, 'Authentication methods policy');
    if (empty) return empty;
    const configs = methodConfigs(signals);
    if (!configs) return notAssessed('Multifactor authentication', NO_CONFIGS, signals, AUTH);
    const mfa = configs.filter(c => c.state === 'enabled' && MFA_METHODS.has(methodId(c)));
    if (mfa.length === 0) return { status: 'not_met', evidence: `Multifactor authentication: no MFA method is enabled (${configs.map(c => `${methodId(c)} ${String(c.state)}`).join(', ')})` };
    const methods = `MFA method(s) enabled: ${mfa.map(methodId).join(', ')}`;
    // W5 cycle 8 (S3-D06): an enabled method or a CA policy does not make a user able to complete MFA;
    // every registration-report row of an enabled account must show an MFA method registered.
    const unregistered = unregisteredForMfa(signals);
    if (unregistered) return unregistered;
    const ca = rowsOf(signals, CA);
    if (!ca || ca.rows.length === 0) return notAssessed('Multifactor authentication', `${methods}; no conditional access read reached this control, so enforcement for every account is not shown`, signals, [...AUTH, ...CA]);
    const policies = ca.rows as CaPolicy[];
    const all = policies.filter(p => isEnabled(p) && targetsAllUsers(p) && requiresMfa(p));
    if (all.length === 0) return { status: 'not_met', evidence: `Multifactor authentication: ${methods}; no enabled policy requires MFA of all users` };
    const bg = breakGlassOf(policies, ctx);
    if (bg.overflow) return { status: 'not_met', evidence: `Multifactor authentication: ${methods}; ${bg.source}` };
    return { status: 'met', evidence: `Multifactor authentication: ${methods}; '${all.map(caName).join("', '")}' require MFA of all users, excusing only ${bg.ids.size} break-glass account(s)` };
  },

  // IA.L2-3.5.4: a replay-resistant (phishing-resistant) authentication strength is defined.
  // W5 cycle 5: and used. The strength counts only when an enabled CA policy requires it (grant
  // `authenticationStrength` referencing it by id, or by name when the read carries no id) of the
  // privileged roles or of all users; otherwise not met, naming the strength and the policies read.
  // No CA read -> not assessed (the strength is printed).
  authStrengthEvaluator: (signals) => {
    const ids = ['authStrength'];
    const empty = unreadOrEmpty(signals, ids, 'Authentication strength policies');
    if (empty) return empty;
    const rows = rowsOf(signals, ids)!.rows;
    const shaped = rows.filter(p => Array.isArray(p.allowedCombinations) && (p.allowedCombinations as unknown[]).length > 0);
    if (shaped.length === 0) return notAssessed('Replay-resistant authentication', 'the strength policies were read without allowedCombinations', signals, ids);
    const pr = shaped.filter(p => (p.allowedCombinations as string[]).every(c => String(c).split(',').every(m => PHISHING_RESISTANT_COMBINATIONS.has(m.trim()))));
    if (pr.length === 0) return { status: 'not_met', evidence: `Replay-resistant authentication: ${shaped.length} strength policy(ies) read; each allows a method that is not phishing resistant` };
    const names = `'${pr.map(cfgName).join("', '")}'`;
    const methods = [...new Set(pr.flatMap(p => p.allowedCombinations as string[]))].join(', ');
    const ca = rowsOf(signals, CA);
    if (!ca || ca.rows.length === 0) {
      return notAssessed('Replay-resistant authentication', `${names} allow only phishing-resistant methods (${methods}); no conditional access read reached this control, so whether an enabled policy requires the strength is not shown`, signals, [...ids, ...CA]);
    }
    const policies = ca.rows as CaPolicy[];
    const prIds = new Set(pr.map(p => String(p.id ?? '')).filter(Boolean));
    const prNames = new Set(pr.map(p => String(p.displayName ?? '').toLowerCase()).filter(Boolean));
    const references = (p: CaPolicy): boolean => {
      const s = p.grantControls?.authenticationStrength;
      if (!s) return false;
      if (s.id) return prIds.has(String(s.id));
      return !!s.displayName && prNames.has(String(s.displayName).toLowerCase());
    };
    const hits = policies.filter(p => isEnabled(p) && references(p) && (targetsAllUsers(p) || includesPrivilegedRole(p)));
    if (hits.length > 0) {
      const scope = (p: CaPolicy) => (targetsAllUsers(p) ? 'all users' : `privileged roles (${(usersOf(p).includeRoles as string[]).filter(r => PRIVILEGED_ROLE_TEMPLATES.has(r)).map(r => PRIVILEGED_ROLE_TEMPLATES.get(r)).join(', ')})`);
      return { status: 'met', evidence: `Replay-resistant authentication: ${names} allow only phishing-resistant methods (${methods}); enabled conditional access ${hits.map(p => `'${caName(p)}' requires it of ${scope(p)}`).join('; ')}` };
    }
    return { status: 'not_met', evidence: `Replay-resistant authentication: ${names} allow only phishing-resistant methods (${methods}), but no enabled conditional access policy requires it of the privileged roles or of all users; ${policies.length} policy(ies) read: '${policies.map(caName).join("', '")}'` };
  },

  // IA.L2-3.5.5 (founder decision 2026-10-28, NIST SP 800-171 r2): identifiers are not reused within
  // the defined period. A deleted account's UPN reassigned to a newer account within the period
  // (any reassignment when the organisation set no period) -> not_met; an enabled and a disabled
  // account sharing a UPN -> not_met. The directory refuses duplicate UPNs among existing accounts,
  // so reuse can only follow deletion: without a deleted-users read -> not_assessed.
  inactiveAccountsEvaluator: (signals, ctx) => {
    const empty = unreadOrEmpty(signals, USER_IDS, 'Users');
    if (empty) return empty;
    const users = rowsOf(signals, USER_IDS)!.rows;
    const upn = (u: Record<string, unknown>) => String(u.userPrincipalName ?? '').toLowerCase();
    const disabled = users.filter(u => u.accountEnabled === false && upn(u));
    const clash = disabled.filter(d => users.some(u => u !== d && u.accountEnabled !== false && upn(u) === upn(d)));
    if (clash.length > 0) return { status: 'not_met', evidence: `Identifier reuse: ${clash.length} disabled account UPN(s) also held by an enabled account: ${clash.map(u => String(u.id)).join(', ')}` };
    const del = rowsOf(signals, ['deletedUsers']);
    if (!del) return notAssessed('Identifier reuse', `${disabled.length} disabled account(s) keep their UPN and no enabled account shares one; reuse can only follow deletion, and no deleted-users read (/directory/deletedItems) reached this control`, signals, [...USER_IDS, 'deletedUsers']);
    // W5 cycle 3: an empty deleted-users read that succeeded: nothing deleted in the window can be reused.
    // Window-limited, not presence only: Entra keeps deleted users for 30 days only.
    if (del.rows.length === 0) {
      return { status: 'met', evidence: `Identifier reuse: no identifiers deleted in the 30-day recycle-bin window, so none could be reused (${REUSE_WINDOW_NOTE}); no disabled account's UPN is held by an enabled account` };
    }
    const period = ctx?.expected?.find(e => /reuse|period/i.test(e.path) && toNumber(e.value) !== undefined);
    const days = period ? toNumber(period.value)! : Infinity;
    // W5 cycle 3 (item 5): the read is window-limited, so the default basis says so (was "any period").
    const basis = period ? `${days} days (organisation value: TM expected value (${period.source ?? 'tm'}))` : `the 30-day recycle-bin window (${REQUIREMENT_DEFAULT_SOURCE}: any reassignment counts)`;
    const reused: string[] = [];
    for (const d of del.rows) {
      // Graph prefixes a deleted user's UPN with its object id (hex, no hyphens).
      const original = upn(d).replace(/^[0-9a-f]{32}/, '');
      const deletedAt = Date.parse(String(d.deletedDateTime ?? ''));
      for (const u of users) {
        if (upn(u) !== original || u.id === d.id) continue;
        const created = Date.parse(String(u.createdDateTime ?? ''));
        if (!Number.isFinite(deletedAt) || !Number.isFinite(created) || created < deletedAt) continue;
        if ((created - deletedAt) / 86_400_000 <= days) reused.push(`${original} (deleted ${String(d.deletedDateTime)}, reassigned to ${String(u.id)})`);
      }
    }
    if (reused.length > 0) return { status: 'not_met', evidence: `Identifier reuse: ${reused.length} UPN(s) reassigned within ${basis}: ${reused.join('; ')}` };
    return { status: 'met', evidence: `Identifier reuse: none of ${del.rows.length} deleted account UPN(s) was reassigned within ${basis} (${REUSE_WINDOW_NOTE}); no disabled account's UPN is held by an enabled account` };
  },

  // IA.L2-3.5.6: identifiers inactive beyond the defined period are disabled.
  accountDisableEvaluator: (signals, ctx) => inactivity(signals, ctx, 'Inactive identifiers disabled'),

  // IA.L2-3.5.7: password composition: minimum length against the defined value.
  passwordComplexityEvaluator: (signals, ctx) => passwordSetting(signals, ctx, 'Password complexity', 'passwordMinimumLength', D.PASSWORD_MIN_LENGTH),

  // IA.L2-3.5.8: password reuse: generations remembered against the defined value.
  passwordReuseEvaluator: (signals, ctx) => passwordSetting(signals, ctx, 'Password reuse', 'passwordPreviousPasswordBlockCount', D.PASSWORD_HISTORY_MIN),

  // IA.L2-3.5.9: temporary passwords (Temporary Access Pass) are one-time and short-lived.
  temporaryPasswordEvaluator: (signals, ctx) => {
    const empty = unreadOrEmpty(signals, AUTH, 'Authentication methods policy');
    if (empty) return empty;
    const configs = methodConfigs(signals);
    if (!configs) return notAssessed('Temporary passwords', NO_CONFIGS, signals, AUTH);
    const tap = configs.find(c => methodId(c) === 'temporaryaccesspass');
    if (!tap || tap.state !== 'enabled') return notAssessed('Temporary passwords', 'Temporary Access Pass is not enabled; a temporary password then comes from the user password profile (forceChangePasswordNextSignIn), which no read carries', signals, AUTH);
    const max = expectedNumber(ctx, 'LifetimeInMinutes', D.TAP_MAX_LIFETIME_MINUTES);
    const life = toNumber(tap.maximumLifetimeInMinutes ?? tap.defaultLifetimeInMinutes);
    const fails: string[] = [];
    if (tap.isUsableOnce !== true) fails.push(`isUsableOnce ${String(tap.isUsableOnce)}`);
    if (life === undefined || life > max.value) fails.push(`lifetime ${String(life)} min (at most ${max.value}, ${max.source})`);
    if (fails.length > 0) return { status: 'not_met', evidence: `Temporary passwords: Temporary Access Pass ${fails.join(', ')}` };
    return { status: 'met', evidence: `Temporary passwords: Temporary Access Pass is one-time use with a ${life} min lifetime (at most ${max.value}, ${max.source})` };
  },

  // IA.L2-3.5.10: passwords only cross the network protected: legacy (basic) authentication is blocked.
  certBasedAuthEvaluator: (signals, ctx) => {
    const ca = rowsOf(signals, CA);
    if (!ca || ca.rows.length === 0) return notAssessed('Cryptographically protected passwords', 'blocking legacy authentication (basic auth sends the password in clear) is a conditional access setting; no conditional access read reached this control', signals, [...AUTH, ...CA]);
    const policies = ca.rows as CaPolicy[];
    const legacy = policies.filter(p => isEnabled(p) && blocks(p) && targetsAllUsers(p)
      && (p.conditions?.clientAppTypes ?? []).some((t: string) => t === 'exchangeActiveSync' || t === 'other'));
    const failing = failingChecks(legacy, ctx);
    if (legacy.length > 0 && failing.length === 0) return { status: 'met', evidence: `Cryptographically protected passwords: '${legacy.map(caName).join("', '")}' block legacy authentication for all users; the platform stores only password hashes` };
    return { status: 'not_met', evidence: `Cryptographically protected passwords: ${policies.length} policy(ies) read; none blocks legacy authentication for all users${failing.length ? ` (failing ${failing.join(', ')})` : ''}` };
  },

  // IA.L2-3.5.11 (founder decision 2026-10-28): obscuring authentication feedback is platform-inherited
  // (the CRM, the customer responsibility matrix); it is not tested. Always not_assessed, reads printed.
  sessionTerminationEvaluator: (signals) => {
    const ids = [...new Set(signals.map(s => s.signalId))];
    return notAssessed('Obscured authentication feedback', 'inherited from the platform (CRM): the sign-in experience masks authentication input; not tested', signals, ids.length ? ids : CA);
  },
};
