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
import { getSignalData, validatePolicyState, validateGrantControls } from './helpers.js';
import { unreadSignalVerdict } from '../StatusTranslator.js';
import { COLLECTED } from '../../collect/Collector.js';
import { collectedRows, eventTimeOf, auditDataOf } from '../../collect/views.js';
import {
  REQUIREMENT_DEFAULTS, REQUIREMENT_DEFAULT_SOURCE, PRIVILEGED_ROLE_TEMPLATES, GLOBAL_ADMIN_TEMPLATE, type CaPolicy, type EvaluatorContext,
  rowsOf, listOf, notAssessed, unreadOrEmpty, expectedNumber, failingChecks, toNumber,
  breakGlassOf, targetsAllUsers, targetsGroupsOrRoles, builtIns, requiresMfa, blocks, includesPrivilegedRole,
  cfgName, screenLockVerdict, storageBlockVerdict, caVerdict, SCREEN_LOCK_READS, sharedAccountsOf, accountLabel,
} from './conditions.js';

// W5 cycle 1: every evaluator below except caEnforcementEvaluator and privilegedFunctionEvaluator
// (which already tested a setting) was presence only and now tests a condition; the rules are in
// docs/EVALUATOR-AUDIT.md. Unread, empty, or a read without the setting -> not_assessed, read printed.
const CA = ['conditionalAccess'];
const ROLE_IDS = ['roleAssignments', 'roleAssignmentsAll'];
const ELIG_IDS = ['roleEligibility', 'roleEligibilitySchedules', 'roleEligibilityScheduleInstances'];
const USER_IDS = ['users', 'directoryUsers'];
const CFG = ['deviceConfigurations'];
const CUI_LABEL_RE = /\bCUI\b|controlled unclassified/i;
const D = REQUIREMENT_DEFAULTS;

const isPrivileged = (r: Record<string, unknown>): boolean => PRIVILEGED_ROLE_TEMPLATES.has(String(r.roleDefinitionId));
const roleName = (r: Record<string, unknown>): string => PRIVILEGED_ROLE_TEMPLATES.get(String(r.roleDefinitionId)) ?? String(r.roleDefinitionId);
const wifiOf = (rows: Record<string, unknown>[]) => rows.filter(c => c.wifiSecurityType !== undefined || /wifi/i.test(String(c['@odata.type'] ?? '')));

/**
 * W5 cycle 3 (AC.L2-3.1.6): a stated admin naming convention (`adm.{firstname}.{lastname}@{domain}`) as a
 * case-insensitive whole-UPN pattern; `{firstname}` / `{lastname}` are captured, any other token matches
 * one or more characters other than `@` or space.
 */
function conventionPattern(convention: string): { re: RegExp; parts: string[] } {
  const parts: string[] = [];
  const src = convention.split(/(\{[A-Za-z]+\})/).map(t => {
    const m = /^\{([A-Za-z]+)\}$/.exec(t);
    if (!m) return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const key = m[1].toLowerCase();
    if (key === 'firstname' || key === 'lastname') { parts.push(key); return "([a-z0-9'-]+)"; }
    return '[^@\\s]+';
  }).join('');
  return { re: new RegExp(`^${src}$`, 'i'), parts };
}

/** The display name without an admin marker ("(Admin)", "Admin-", "- Admin", "adm "), lower-cased. */
const personName = (displayName: unknown): string => String(displayName ?? '')
  .replace(/\s*[([]\s*admin(istrator)?\s*[)\]]\s*/gi, ' ')
  .replace(/^\s*(admin|adm)[-_. ]+/i, '')
  .replace(/[-_ ]+(admin|adm)\s*$/i, '')
  .trim().replace(/\s+/g, ' ').toLowerCase();

/** The same person's normal account (another user): employeeId, display name, or the convention's name parts. */
function counterpartOf(admin: Record<string, unknown>, users: Record<string, unknown>[], convention?: { re: RegExp; parts: string[] }): { user: Record<string, unknown>; by: string } | undefined {
  const others = users.filter(u => u.id !== admin.id);
  const emp = admin.employeeId;
  if (typeof emp === 'string' && emp.trim() !== '') {
    const u = others.find(o => o.employeeId === emp);
    if (u) return { user: u, by: 'employeeId' };
  }
  const own = personName(admin.displayName);
  if (own && own !== String(admin.displayName ?? '').trim().toLowerCase()) {
    const u = others.find(o => String(o.displayName ?? '').trim().toLowerCase() === own);
    if (u) return { user: u, by: 'display name' };
  }
  if (convention && convention.parts.includes('firstname') && convention.parts.includes('lastname')) {
    const m = convention.re.exec(String(admin.userPrincipalName ?? ''));
    if (m) {
      const first = m[1 + convention.parts.indexOf('firstname')].toLowerCase();
      const last = m[1 + convention.parts.indexOf('lastname')].toLowerCase();
      const u = others.find(o => String(o.displayName ?? '').trim().toLowerCase() === `${first} ${last}`);
      if (u) return { user: u, by: 'naming convention' };
    }
  }
  return undefined;
}

/** Directory setting values (`values: [{ name, value }]`) found on any read passed to the evaluator. */
function settingValues(signals: SignalResult[], names: string[]): Record<string, unknown> | undefined {
  for (const s of signals) {
    if (s.status !== 'success') continue;
    for (const row of listOf(s.rawData)) {
      const values = row.values;
      if (!Array.isArray(values)) continue;
      const out: Record<string, unknown> = {};
      for (const v of values as Array<Record<string, unknown>>) {
        if (v && typeof v === 'object' && names.includes(String(v.name))) out[String(v.name)] = v.value;
      }
      if (Object.keys(out).length > 0) return out;
    }
  }
  return undefined;
}

/** W5 cycle 8 (AC.L1-3.1.22): unified-audit-log operations that create, change or use an anonymous link. */
const ANONYMOUS_LINK_OPERATIONS = new Set(['anonymouslinkcreated', 'anonymouslinkupdated', 'anonymouslinkused']);
const anonymousOperationOf = (row: unknown): string =>
  String((row as Record<string, unknown>)?.Operations ?? auditDataOf(row).Operation ?? '');

/** The collected UAL rows (C1a view) that record an anonymous ('Anyone') sharing link. */
function anonymousLinkEvents(signals: SignalResult[]): unknown[] {
  const ual = collectedRows(signals, [COLLECTED.UNIFIED_AUDIT_LOG]);
  return ual.rows.filter(r => ANONYMOUS_LINK_OPERATIONS.has(anonymousOperationOf(r).toLowerCase())
    || String(auditDataOf(r).SharingLinkScope ?? '').toLowerCase() === 'anyone');
}

/**
 * W5 cycle 8 (AC.L2-3.1.7, S3-D04): standing privileged role assignments held by an account that is not a
 * dedicated admin account: an enabled user with a productivity licence (someone's normal account; a
 * licensed UPN that follows the organisation's stated admin naming convention counts as dedicated), or a
 * shared or generic login. Break-glass accounts (the supplied list) are left out. Null without both reads.
 * W7-EO3: the organisation's designated break-glass accounts (the supplied list plus the TM tenant_identity
 * designation; never a name pattern) are exempt by design and returned in `exempt`; `others` counts the
 * standing privileged assignments held by any other account.
 */
function privilegedOnNormalAccounts(signals: SignalResult[], ctx?: EvaluatorContext): { violations: string[]; exempt: string[]; others: number } | null {
  const roles = rowsOf(signals, ROLE_IDS);
  const users = rowsOf(signals, USER_IDS);
  if (!roles || !users) return null;
  const bg = new Set([...(ctx?.breakGlassIds ?? []), ...(ctx?.designatedBreakGlassIds ?? [])]);
  const convention = ctx?.adminNamingConvention ? conventionPattern(ctx.adminNamingConvention) : undefined;
  const shared = new Set(sharedAccountsOf(users.rows).map(u => String(u.id)));
  const out: string[] = [];
  const exempt: string[] = [];
  let others = 0;
  for (const a of roles.rows.filter(isPrivileged)) {
    const id = String(a.principalId);
    if (bg.has(id)) {
      const b = users.rows.find(x => String(x.id) === id);
      exempt.push(`${b ? accountLabel(b) : id} standing ${roleName(a)}`);
      continue;
    }
    others += 1;
    const u = users.rows.find(x => String(x.id) === id);
    if (!u || u.accountEnabled === false) continue;
    const licensed = Array.isArray(u.assignedLicenses) && (u.assignedLicenses as unknown[]).length > 0;
    const follows = !!convention && convention.re.test(String(u.userPrincipalName ?? ''));
    const why = shared.has(id) ? 'a shared or generic login' : licensed && !follows ? 'a licensed normal user account' : '';
    if (why) out.push(`${accountLabel(u)} holds standing ${roleName(a)} as ${why}`);
  }
  return { violations: out, exempt, others };
}

export const acEvaluators: Record<string, EvaluatorFn> = {
  caEnforcementEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'conditionalAccess', 'Conditional access policies');
    if (unread) return unread;
    const caData = getSignalData(signals, 'conditionalAccess');

    const policies = Array.isArray(caData) ? caData : (caData as any)?.value ?? [];
    if (!Array.isArray(policies) || policies.length === 0) {
      return { status: 'not_met', evidence: 'No conditional access policies found' };
    }

    const findings: string[] = [];
    let hasEnforcingPolicy = false;

    for (const policy of policies) {
      const stateResult = validatePolicyState(policy, 'enabled');
      findings.push(...stateResult.findings);

      if (!stateResult.valid) continue;

      const grantResult = validateGrantControls(policy, ['mfa', 'compliantDevice'], 'AND');
      findings.push(...grantResult.findings);

      if (grantResult.valid) {
        // Check conditions target all users or specific CUI user groups
        const conditions = policy?.conditions;
        const includeUsers = conditions?.users?.includeUsers ?? [];
        const includeGroups = conditions?.users?.includeGroups ?? [];
        const targetsAllUsers = includeUsers.includes('All') || includeUsers.includes('all');
        if (targetsAllUsers || includeGroups.length > 0) {
          hasEnforcingPolicy = true;
          findings.push(`Policy '${policy.displayName}' targets ${targetsAllUsers ? "'All Users'" : `${includeGroups.length} groups`}`);
        } else {
          // W7-EO: a policy that targets neither all users nor a group (specific users or roles only) is not counted (was credited).
          findings.push(`Policy '${policy.displayName}' targets neither all users nor a group, so it is not counted`);
        }
      }
    }

    if (hasEnforcingPolicy) {
      return {
        status: 'met',
        evidence: `Conditional access policies enforce authorized access with MFA and compliant device requirement. ${findings.join('; ')}`,
      };
    }

    return {
      status: 'not_met',
      evidence: `Conditional access policies found but none enforce MFA + compliant device with AND operator. ${findings.join('; ')}`,
    };
  },

  // AC.L1-3.1.2: functions are limited by role, and Global Administrator is held by few.
  rbacEvidenceEvaluator: (signals) => {
    const ids = ['directoryRoles'];
    const empty = unreadOrEmpty(signals, ids, 'Directory roles');
    if (empty) return empty;
    const roles = rowsOf(signals, ids)!.rows;
    const withMembers = roles.filter(r => Array.isArray(r.members));
    if (withMembers.length === 0) {
      return notAssessed('Directory roles', 'the roles were read without their members ($expand=members), so who may execute which functions is not shown', signals, ids);
    }
    const ga = withMembers.find(r => r.roleTemplateId === GLOBAL_ADMIN_TEMPLATE);
    const gaCount = ga ? (ga.members as unknown[]).length : 0;
    if (gaCount > D.GLOBAL_ADMIN_MAX) {
      return { status: 'not_met', evidence: `Directory roles: Global Administrator has ${gaCount} members, more than ${D.GLOBAL_ADMIN_MAX} (${REQUIREMENT_DEFAULT_SOURCE})` };
    }
    return { status: 'met', evidence: `Directory roles: ${withMembers.length} activated role(s) with members limit functions by role; Global Administrator held by ${gaCount} (at most ${D.GLOBAL_ADMIN_MAX}, ${REQUIREMENT_DEFAULT_SOURCE})` };
  },

  // AC.L1-3.1.20: the default cross-tenant policy does not let all external users in.
  crossTenantEvaluator: (signals) => {
    const ids = ['crossTenantPolicy'];
    const empty = unreadOrEmpty(signals, ids, 'Cross-tenant access policy');
    if (empty) return empty;
    const p = rowsOf(signals, ids)!.rows[0] as Record<string, any>;
    const settings = ['b2bCollaborationInbound', 'b2bDirectConnectInbound'].filter(k => p[k]?.usersAndGroups?.accessType !== undefined);
    if (settings.length === 0) {
      return notAssessed('Cross-tenant access policy', 'the default policy was read without its inbound B2B settings (b2bCollaborationInbound / b2bDirectConnectInbound)', signals, ids);
    }
    const open = settings.filter(k => {
      const ug = p[k].usersAndGroups;
      return ug.accessType === 'allowed' && (ug.targets ?? []).some((t: any) => t?.target === 'AllUsers');
    });
    if (open.length > 0) {
      return { status: 'not_met', evidence: `Cross-tenant access policy: the default allows all external users inbound (${open.join(', ')})` };
    }
    return { status: 'met', evidence: `Cross-tenant access policy: the default blocks or limits inbound external access (${settings.map(k => `${k} ${String(p[k].usersAndGroups.accessType)}`).join(', ')})` };
  },

  // AC.L1-3.1.22: SharePoint does not allow anonymous ("Anyone") links to posted content.
  // W5 cycle 8 (S3-D11): an anonymous-link event in the collected unified audit log (an Anyone link
  // created, updated or used) shows content reachable by anyone -> not_met, naming the site(s). No such
  // event decides nothing (the settings read below still decides).
  publicSharingEvaluator: (signals) => {
    const anonymous = anonymousLinkEvents(signals);
    if (anonymous.length > 0) {
      const sites = [...new Set(anonymous.map(r => String(auditDataOf(r).ObjectId ?? auditDataOf(r).SiteUrl ?? '?')))];
      return { status: 'not_met', evidence: `Public information control: ${anonymous.length} anonymous ('Anyone') sharing-link event(s) in the unified audit log (${[...new Set(anonymous.map(anonymousOperationOf))].join(', ')}), so content is reachable without sign-in: ${sites.join(', ')}` };
    }
    const ids = ['sharepointSettings'];
    const empty = unreadOrEmpty(signals, ids, 'SharePoint sharing settings');
    if (empty) return empty;
    const cap = rowsOf(signals, ids)!.rows[0].sharingCapability;
    if (cap === undefined) return notAssessed('SharePoint sharing settings', 'the settings were read without sharingCapability', signals, ids);
    if (cap === 'externalUserAndGuestSharing') {
      return { status: 'not_met', evidence: "SharePoint sharing settings: sharingCapability externalUserAndGuestSharing allows anonymous 'Anyone' links" };
    }
    return { status: 'met', evidence: `SharePoint sharing settings: sharingCapability ${String(cap)} (no anonymous 'Anyone' links)` };
  },

  // AC.L2-3.1.3: an active sensitivity label identifies CUI, so its flow can be controlled.
  informationBarrierEvaluator: (signals) => {
    const ids = ['dlpLabels'];
    const empty = unreadOrEmpty(signals, ids, 'Information protection labels');
    if (empty) return empty;
    const labels = rowsOf(signals, ids)!.rows;
    const nameOf = (l: Record<string, unknown>) => String(l.name ?? l.displayName ?? '');
    if (labels.every(l => nameOf(l) === '')) return notAssessed('Information protection labels', 'the labels were read without names', signals, ids);
    const cui = labels.filter(l => l.isActive !== false && CUI_LABEL_RE.test(nameOf(l)));
    if (cui.length > 0) {
      return { status: 'met', evidence: `Information protection labels: active CUI label(s) '${cui.map(nameOf).join("', '")}' identify CUI for flow control` };
    }
    return { status: 'not_met', evidence: `Information protection labels: ${labels.length} label(s) read ('${labels.map(nameOf).join("', '")}'); none is an active label marking CUI` };
  },

  // AC.L2-3.1.4: separation of duties: PIM activation needs approval by a named approver.
  // W5 cycle 3: an approver counts only when it resolves to a directory object: a user approver with a
  // userId (and, when a users read reached this control, one in that read), or a group approver with a
  // groupId. A `userId: null` approver does not count and is printed.
  pimApprovalEvaluator: (signals) => {
    const ids = ['pimPolicies'];
    const empty = unreadOrEmpty(signals, ids, 'PIM role management policies');
    if (empty) return empty;
    const policies = rowsOf(signals, ids)!.rows;
    if (!policies.some(p => Array.isArray(p.rules))) {
      return notAssessed('PIM role management policies', 'the policies were read without their rules ($expand=rules), so the approval setting is not shown', signals, ids);
    }
    const userIds = rowsOf(signals, USER_IDS) ? new Set(rowsOf(signals, USER_IDS)!.rows.map(u => String(u.id))) : undefined;
    const unresolved: string[] = [];
    const policyName = (p: Record<string, unknown>) => String(p.displayName ?? p.id ?? 'policy');
    const approverResolves = (p: Record<string, unknown>, a: any): boolean => {
      const id = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
      const label = `${policyName(p)}: approver${a?.description ? ` '${String(a.description)}'` : ''}`;
      if (id(a?.groupId)) return true;
      const userId = id(a?.userId);
      if (!userId) { unresolved.push(`${label} has userId ${JSON.stringify(a?.userId ?? null)}`); return false; }
      if (userIds && !userIds.has(userId)) { unresolved.push(`${label} userId ${userId} is not in the users read`); return false; }
      return true;
    };
    const approving = policies.filter(p => ((p.rules as any[]) ?? []).some(r =>
      (/ApprovalRule$/.test(String(r?.['@odata.type'] ?? '')) || String(r?.id ?? '').startsWith('Approval_'))
      && r?.setting?.isApprovalRequired === true
      && (r.setting.approvalStages ?? []).filter((st: any) => (st?.primaryApprovers ?? []).filter((a: any) => approverResolves(p, a)).length > 0).length > 0));
    const notCounted = unresolved.length > 0 ? `; approver(s) not counted (no directory user): ${[...new Set(unresolved)].join('; ')}` : '';
    if (approving.length > 0) {
      return { status: 'met', evidence: `PIM role management policies: ${approving.length} of ${policies.length} require approval by a named approver before activation${notCounted}` };
    }
    return { status: 'not_met', evidence: `PIM role management policies: ${policies.length} policy(ies) read; none requires approval by a named approver before activation${notCounted}` };
  },

  // AC.L2-3.1.5: no standing privileged role outside break-glass, and privileged roles are PIM-eligible.
  leastPrivilegeEvaluator: (signals, ctx) => {
    const empty = unreadOrEmpty(signals, ROLE_IDS, 'Role assignments');
    if (empty) return empty;
    const assignments = rowsOf(signals, ROLE_IDS)!.rows;
    const bg = breakGlassOf((rowsOf(signals, CA)?.rows ?? []) as CaPolicy[], ctx);
    const standing = assignments.filter(isPrivileged);
    const outside = standing.filter(a => !bg.ids.has(String(a.principalId)));
    if (outside.length > 0) {
      return { status: 'not_met', evidence: `Least privilege: ${outside.length} standing privileged assignment(s) outside break-glass (${bg.source}): ${outside.map(a => `${String(a.principalId)} ${roleName(a)}`).join(', ')}` };
    }
    const std = `${standing.length} standing privileged assignment(s), each a break-glass account (${bg.source})`;
    const elig = rowsOf(signals, ELIG_IDS);
    if (!elig) return notAssessed('Least privilege', `${std}; PIM eligibility was not read, so just-in-time use of privileged roles is not shown`, signals, ['roleAssignments', 'conditionalAccess', 'roleEligibility']);
    const eligible = elig.rows.filter(isPrivileged);
    if (eligible.length === 0) return notAssessed('Least privilege', `${std}; the eligibility read holds no privileged role`, signals, ['roleAssignments', elig.id]);
    return { status: 'met', evidence: `Least privilege: ${std}; ${eligible.length} PIM eligibility(ies) for privileged roles (${[...new Set(eligible.map(roleName))].join(', ')})` };
  },

  // AC.L2-3.1.6: each privileged account is separate from its owner's primary (licensed) account.
  // No naming convention is assumed: privileged accounts come from the role reads or the supplied list.
  // W5 cycle 3: separate accounts for privileged functions. With a role read (standing roleAssignments
  // and / or PIM-eligible roleEligibilitySchedules), every privileged principal (break-glass excluded)
  // must be a dedicated account: no productivity licence, or a UPN that follows the organisation's
  // stated admin naming convention (TM). Each is paired with the same person's normal account
  // (employeeId where read, else the display name without its admin marker, else the convention's
  // name parts); a dedicated account with no counterpart found is printed, not failed. Without any role
  // read the earlier licence-only test (TM admin accounts) is the fallback.
  dedicatedAdminEvaluator: (signals, ctx) => {
    const empty = unreadOrEmpty(signals, USER_IDS, 'Users');
    if (empty) return empty;
    const users = rowsOf(signals, USER_IDS)!.rows;
    const standing = rowsOf(signals, ROLE_IDS);
    const eligible = rowsOf(signals, ELIG_IDS);
    const roleRows = [...(standing?.rows ?? []), ...(eligible?.rows ?? [])];
    const privileged = new Set<string>([...roleRows.filter(isPrivileged).map(r => String(r.principalId)), ...(ctx?.adminAccountIds ?? [])]);
    for (const id of breakGlassOf((rowsOf(signals, CA)?.rows ?? []) as CaPolicy[], ctx).ids) privileged.delete(id);
    if (privileged.size === 0) {
      return notAssessed('Separate admin accounts', standing || eligible
        ? 'the role reads name no privileged principal other than the break-glass accounts, and no admin account list reached this control'
        : 'no privileged-role read or admin account list reached this control; the users read alone cannot tell a separate admin account from a primary one (no naming convention is assumed)', signals, [...USER_IDS, ...ROLE_IDS, ...ELIG_IDS]);
    }
    const found = [...privileged].map(id => users.find(u => u.id === id)).filter((u): u is Record<string, unknown> => !!u);
    if (found.length === 0) return notAssessed('Separate admin accounts', `none of the ${privileged.size} privileged account(s) is in the users read`, signals, USER_IDS);
    if (found.some(u => !Array.isArray(u.assignedLicenses))) return notAssessed('Separate admin accounts', 'the users were read without assignedLicenses', signals, USER_IDS);
    if (!standing && !eligible) {
      const primary = found.filter(u => (u.assignedLicenses as unknown[]).length > 0);
      if (primary.length > 0) {
        return { status: 'not_met', evidence: `Separate admin accounts: ${primary.length} privileged account(s) hold a productivity licence, so they are someone's primary account: ${primary.map(u => String(u.id)).join(', ')}` };
      }
      return { status: 'met', evidence: `Separate admin accounts: ${found.length} privileged account(s) hold no productivity licence, so each is separate from its owner's primary account${found.length < privileged.size ? `; ${privileged.size - found.length} not in the users read` : ''}` };
    }

    const eligibleRows = new Set(eligible?.rows ?? []);
    const rolesOf = (id: string): string[] => [...new Set(roleRows.filter(r => isPrivileged(r) && String(r.principalId) === id)
      .map(r => `${roleName(r)}${eligibleRows.has(r) ? ' (eligible)' : ''}`))];
    const convention = ctx?.adminNamingConvention ? conventionPattern(ctx.adminNamingConvention) : undefined;
    const name = (u: Record<string, unknown>) => String(u.displayName ?? u.userPrincipalName ?? u.id);
    const rows = found.map(u => {
      const licensed = (u.assignedLicenses as unknown[]).length > 0;
      const follows = !!convention && convention.re.test(String(u.userPrincipalName ?? ''));
      return { u, licensed, follows, dedicated: !licensed || follows, roles: rolesOf(String(u.id)), counterpart: counterpartOf(u, users, convention) };
    });
    type Row = typeof rows[number];
    const show = (r: Row) => `'${name(r.u)}' (${String(r.u.id)}${r.roles.length ? `; ${r.roles.join(', ')}` : '; TM admin account'})`
      + (r.counterpart ? ` with normal account '${name(r.counterpart.user)}' (${String(r.counterpart.user.id)}, matched by ${r.counterpart.by})` : '; no normal account of the same person found in the users read');
    const by = [standing ? 'standing role assignments' : '', eligible ? 'PIM-eligible roles' : '', ctx?.adminAccountIds?.length ? 'TM admin accounts' : ''].filter(Boolean).join(', ');
    const shared = rows.filter(r => !r.dedicated);
    if (shared.length > 0) {
      return { status: 'not_met', evidence: `Separate accounts for privileged functions: ${shared.length} of ${rows.length} privileged principal(s) (${by}) hold a productivity licence${convention ? ` and do not follow the stated admin naming convention ${ctx!.adminNamingConvention}` : ''}, so they are someone's normal account: ${shared.map(show).join('; ')}` };
    }
    const why = (r: Row) => r.licensed ? 'follows the stated naming convention' : 'no productivity licence';
    return { status: 'met', evidence: `Separate accounts for privileged functions: ${rows.length} privileged principal(s) (${by}), each a dedicated account: ${rows.map(r => `${show(r)} [${why(r)}]`).join('; ')}${found.length < privileged.size ? `; ${privileged.size - found.length} not in the users read` : ''}` };
  },

  // EO-collection W2 (AC.L2-3.1.7): tests that the execution of privileged functions is logged.
  // Met when the last 30 days hold at least one privileged-role activation or assignment request
  // (PIM, collector C4) and every one is logged with its principal, role, action and time.
  // A request missing any of these → not_met. None in the window, unread or empty → not_assessed.
  // W5 cycle 8 (S3-D04): first, with the standing role assignments and the users read, a privileged role
  // held standing by a normal (licensed) or shared account means non-privileged users can execute
  // privileged functions → not_met, naming each account and role.
  // W7-EO3: the organisation's designated break-glass account holds a standing Global Administrator by design,
  // so it is exempt from the standing-role rule and listed as "break-glass (exempt)" on every verdict. When
  // the activation records do not decide, standing privileged roles held only by designated break-glass
  // accounts (with the PIM eligibility read) → met.
  privilegedFunctionEvaluator: (signals, ctx) => {
    const standing = privilegedOnNormalAccounts(signals, ctx);
    const exemptNote = standing && standing.exempt.length > 0 ? `; break-glass (exempt): ${standing.exempt.join('; ')}` : '';
    const withExempt = <T extends { evidence: string }>(v: T): T => ({ ...v, evidence: `${v.evidence}${exemptNote}` });
    if (standing && standing.violations.length > 0) {
      return withExempt({ status: 'not_met', evidence: `Privileged functions: ${standing.violations.length} standing privileged assignment(s) on accounts that are not dedicated admin accounts, so non-privileged accounts can execute privileged functions: ${standing.violations.join('; ')}` });
    }
    const unread = unreadSignalVerdict(signals, COLLECTED.PIM_ACTIVATIONS, 'Privileged-role activation records');
    if (unread) {
      const elig = rowsOf(signals, ELIG_IDS);
      if (standing && standing.exempt.length > 0 && standing.others === 0 && elig) {
        const eligible = elig.rows.filter(isPrivileged);
        return withExempt({ status: 'met', evidence: `Privileged functions: every standing privileged assignment is held by the organisation's designated break-glass account(s); other privileged roles are PIM-eligible (${eligible.length} privileged eligibility(ies) in '${elig.id}')` });
      }
      return withExempt(unread);
    }
    const acts = collectedRows(signals, [COLLECTED.PIM_ACTIVATIONS]).rows;
    const missing = acts.filter((r) => {
      const a = (r ?? {}) as Record<string, unknown>;
      return !a.principalId || !a.roleDefinitionId || !a.action || !eventTimeOf(a);
    }).length;
    if (missing > 0) {
      return withExempt({ status: 'not_met', evidence: `${missing} of ${acts.length} privileged-role activation request(s) in the last 30 days are not logged with principal, role, action and time` });
    }
    return withExempt({
      status: 'met',
      evidence: `${acts.length} privileged-role activation request(s) in the last 30 days are each logged with principal, role, action and time`,
    });
  },

  // AC.L2-3.1.8: lockout after the defined number of attempts, for at least the defined duration.
  smartLockoutEvaluator: (signals, ctx) => {
    const ids = [...new Set(signals.map(s => s.signalId))];
    const v = settingValues(signals, ['LockoutThreshold', 'LockoutDurationInSeconds']);
    if (!v || v.LockoutThreshold === undefined || v.LockoutDurationInSeconds === undefined) {
      return notAssessed('Account lockout', "no read carries both lockout settings (directory setting 'Password Rule Settings': LockoutThreshold, LockoutDurationInSeconds); the authentication methods policy does not hold them", signals, ids.length ? ids : ['authMethods']);
    }
    const thr = expectedNumber(ctx, 'LockoutThreshold', D.LOCKOUT_THRESHOLD_MAX);
    const dur = expectedNumber(ctx, 'LockoutDurationInSeconds', D.LOCKOUT_DURATION_MIN_SECONDS);
    const t = toNumber(v.LockoutThreshold);
    const d = toNumber(v.LockoutDurationInSeconds);
    const fails: string[] = [];
    if (t === undefined || t <= 0 || t > thr.value) fails.push(`threshold ${String(v.LockoutThreshold)} (expected 1..${thr.value}, ${thr.source})`);
    if (d === undefined || d < dur.value) fails.push(`duration ${String(v.LockoutDurationInSeconds)} s (expected at least ${dur.value} s, ${dur.source})`);
    if (fails.length > 0) return { status: 'not_met', evidence: `Account lockout: ${fails.join('; ')}` };
    return { status: 'met', evidence: `Account lockout: locks after ${t} failed attempts (at most ${thr.value}, ${thr.source}) for ${d} s (at least ${dur.value} s, ${dur.source})` };
  },

  // AC.L2-3.1.9: the CUI notice must be viewed before it is accepted.
  termsOfUseEvaluator: (signals) => {
    const ids = ['agreements'];
    const empty = unreadOrEmpty(signals, ids, 'Terms of Use agreements');
    if (empty) return empty;
    const rows = rowsOf(signals, ids)!.rows;
    const shaped = rows.filter(a => a.isViewingBeforeAcceptanceRequired !== undefined);
    if (shaped.length === 0) return notAssessed('Terms of Use agreements', 'the agreements were read without isViewingBeforeAcceptanceRequired', signals, ids);
    const ok = shaped.filter(a => a.isViewingBeforeAcceptanceRequired === true && a.displayName);
    if (ok.length > 0) {
      return { status: 'met', evidence: `Terms of Use agreements: '${ok.map(a => String(a.displayName)).join("', '")}' must be viewed before acceptance` };
    }
    return { status: 'not_met', evidence: `Terms of Use agreements: ${rows.length} agreement(s) read; none requires viewing before acceptance` };
  },

  // AC.L2-3.1.10: a device configuration locks the screen within the defined inactivity period.
  // W5 cycle 5: or a compliance policy or settings-catalog policy does (screenLockVerdict).
  sessionLockEvaluator: (signals, ctx) => {
    if (SCREEN_LOCK_READS.every(id => (rowsOf(signals, [id])?.rows.length ?? 0) === 0)) {
      return notAssessed('Session lock', 'screen lock is a device setting (passwordMinutesOfInactivityBeforeScreenTimeout, passwordMinutesOfInactivityBeforeLock or the settings-catalog device-lock maximum inactivity); no device configuration, compliance policy or settings-catalog read reached this control and the conditional access read carries none', signals, [...SCREEN_LOCK_READS, ...CA]);
    }
    return screenLockVerdict(signals, ctx, 'Session lock');
  },

  // AC.L2-3.1.11: an enabled CA policy ends sessions within the defined sign-in frequency.
  sessionTimeoutEvaluator: (signals, ctx) => {
    // W7-EO (founder ruling 2): an organisation value only tightens the CES 8-hour baseline, never relaxes it.
    const answered = expectedNumber(ctx, 'signInFrequency', D.SIGN_IN_FREQUENCY_MAX_HOURS);
    const max = answered.value <= D.SIGN_IN_FREQUENCY_MAX_HOURS ? answered
      : { value: D.SIGN_IN_FREQUENCY_MAX_HOURS, source: `CES baseline; the ${answered.value} h ${answered.source} would relax it (founder ruling 2)` };
    const hours = (p: CaPolicy): number | undefined => {
      const f = p.sessionControls?.signInFrequency;
      if (!f?.isEnabled) return undefined;
      const v = toNumber(f.value);
      return v === undefined ? undefined : f.type === 'days' ? v * 24 : v;
    };
    return caVerdict(signals, ctx, 'Session termination',
      p => (targetsAllUsers(p) || targetsGroupsOrRoles(p)) && (hours(p) ?? Infinity) <= max.value,
      names => `'${names}' end sessions by sign-in frequency within ${max.value} h (${max.source})`,
      `none ends sessions by sign-in frequency within ${max.value} h (${max.source})`);
  },

  // AC.L2-3.1.12: approved networks are defined (a trusted named location with ranges) and sign-ins
  // are logged with their source address (monitoring).
  namedLocationEvaluator: (signals, ctx) => {
    const ids = ['namedLocations'];
    const empty = unreadOrEmpty(signals, ids, 'Named locations');
    if (empty) return empty;
    const rows = rowsOf(signals, ids)!.rows as Record<string, any>[];
    const cidrs = (l: Record<string, any>): string[] => [...(l.ipRanges ?? []), ...(l.AdditionalProperties?.ipRanges ?? [])].map((r: any) => r?.cidrAddress).filter(Boolean);
    const trusted = rows.filter(l => (l.isTrusted ?? l.AdditionalProperties?.isTrusted) === true && cidrs(l).length > 0);
    if (trusted.length === 0) return { status: 'not_met', evidence: `Named locations: ${rows.length} read; none is a trusted location with an IP range` };
    const failing = failingChecks(trusted, ctx);
    if (failing.length > 0) return { status: 'not_met', evidence: `Named locations: trusted ranges ${trusted.flatMap(cidrs).join(', ')} fail the expected value(s): ${failing.join(', ')}` };
    const si = rowsOf(signals, ['signInLogs', 'signIns']);
    const loc = `trusted location(s) '${trusted.map(l => String(l.displayName ?? l.id)).join("', '")}' (${[...new Set(trusted.flatMap(cidrs))].join(', ')})`;
    if (!si || si.rows.length === 0) return notAssessed('Remote access monitoring', `${loc} define the approved networks; the sign-in log was not read or was empty, so monitoring is not shown`, signals, ['namedLocations', 'signInLogs']);
    const withIp = si.rows.filter(r => r.ipAddress);
    if (withIp.length === 0) return notAssessed('Remote access monitoring', `${loc} define the approved networks; the ${si.rows.length} sign-in record(s) read carry no source address (ipAddress), so monitoring is not shown`, signals, ['namedLocations', si.id]);
    return { status: 'met', evidence: `Remote access monitoring: ${loc}; ${withIp.length} of ${si.rows.length} sign-in record(s) carry the source address` };
  },

  // AC.L2-3.1.13: Exchange refuses legacy TLS clients and basic SMTP AUTH.
  tlsEnforcementEvaluator: (signals) => {
    const ids = ['transportConfig'];
    const empty = unreadOrEmpty(signals, ids, 'Exchange transport configuration');
    if (empty) return empty;
    const c = rowsOf(signals, ids)!.rows[0];
    if (c.AllowLegacyTLSClients === undefined && c.SmtpClientAuthenticationDisabled === undefined) {
      return notAssessed('Exchange transport configuration', 'the configuration was read without AllowLegacyTLSClients or SmtpClientAuthenticationDisabled', signals, ids);
    }
    const fails: string[] = [];
    if (c.AllowLegacyTLSClients === true) fails.push('AllowLegacyTLSClients true');
    if (c.SmtpClientAuthenticationDisabled === false) fails.push('SmtpClientAuthenticationDisabled false');
    if (fails.length > 0) return { status: 'not_met', evidence: `Exchange transport configuration: ${fails.join(', ')}` };
    return { status: 'met', evidence: 'Exchange transport configuration: legacy TLS clients and basic SMTP AUTH are refused' };
  },

  // AC.L2-3.1.14: an enabled CA policy blocks access from everywhere except the approved locations.
  blockUntrustedEvaluator: (signals, ctx) => caVerdict(signals, ctx, 'Managed access control points',
    p => blocks(p) && (targetsAllUsers(p) || targetsGroupsOrRoles(p))
      && (p.conditions?.locations?.includeLocations ?? []).some((l: string) => String(l).toLowerCase() === 'all')
      && (p.conditions?.locations?.excludeLocations ?? []).length > 0,
    names => `'${names}' block access from outside the approved locations`,
    'none blocks access from outside the approved locations'),

  // AC.L2-3.1.15: privileged roles must pass MFA (or an authentication strength) to act remotely.
  adminMfaEvaluator: (signals, ctx) => caVerdict(signals, ctx, 'Privileged remote access',
    p => requiresMfa(p) && (includesPrivilegedRole(p) || targetsAllUsers(p)),
    names => `'${names}' require MFA or an authentication strength for privileged roles`,
    'none requires MFA or an authentication strength for privileged roles'),

  // AC.L2-3.1.16: Wi-Fi profiles authenticate each user or device before connecting (enterprise mode).
  wifiProfileEvaluator: (signals, ctx) => {
    const empty = unreadOrEmpty(signals, CFG, 'Intune device configurations');
    if (empty) return empty;
    const wifi = wifiOf(rowsOf(signals, CFG)!.rows);
    if (wifi.length === 0) return notAssessed('Wireless access authorization', 'no Wi-Fi profile in the device configurations', signals, CFG);
    const ok = wifi.filter(c => /enterprise/i.test(String(c.wifiSecurityType ?? '')));
    const failing = failingChecks(ok, ctx);
    if (ok.length > 0 && failing.length === 0) {
      return { status: 'met', evidence: `Wireless access authorization: '${ok.map(cfgName).join("', '")}' (${ok.map(c => String(c.ssid ?? c.networkName ?? '')).join(', ')}) authenticate before connecting (${ok.map(c => String(c.wifiSecurityType)).join(', ')})` };
    }
    return { status: 'not_met', evidence: `Wireless access authorization: ${wifi.map(c => `'${cfgName(c)}' ${String(c.wifiSecurityType)}`).join(', ')}; no enterprise-mode profile${failing.length ? ` passes ${failing.join(', ')}` : ''}` };
  },

  // AC.L2-3.1.17: Wi-Fi profiles use authentication and encryption (WPA family, not open or WEP).
  wirelessProtectionEvaluator: (signals) => {
    const empty = unreadOrEmpty(signals, CFG, 'Intune device configurations');
    if (empty) return empty;
    const wifi = wifiOf(rowsOf(signals, CFG)!.rows);
    if (wifi.length === 0) return notAssessed('Wireless protection', 'no Wi-Fi profile in the device configurations', signals, CFG);
    const weak = wifi.filter(c => !/^wpa/i.test(String(c.wifiSecurityType ?? '')));
    if (weak.length > 0) return { status: 'not_met', evidence: `Wireless protection: ${weak.map(c => `'${cfgName(c)}' ${String(c.wifiSecurityType)}`).join(', ')} without WPA authentication and encryption` };
    return { status: 'met', evidence: `Wireless protection: ${wifi.map(c => `'${cfgName(c)}' ${String(c.wifiSecurityType)}`).join(', ')} (authentication and encryption)` };
  },

  // AC.L2-3.1.18: mobile platforms need a compliant device or an approved app.
  mobileDeviceAccessEvaluator: (signals, ctx) => caVerdict(signals, ctx, 'Mobile device connection',
    p => (targetsAllUsers(p) || targetsGroupsOrRoles(p))
      && (p.conditions?.platforms?.includePlatforms ?? []).some((x: string) => /^(ios|android|all)$/i.test(String(x)))
      && builtIns(p).some(c => ['compliantDevice', 'approvedApplication', 'compliantApplication'].includes(c)),
    names => `'${names}' require a compliant device or an approved app on mobile platforms`,
    'none requires a compliant device or an approved app on mobile platforms'),

  // AC.L2-3.1.19: CUI on mobile devices is encrypted: app data encryption, or a compliant (encrypted)
  // device with backup to unmanaged storage blocked.
  appProtectionEvaluator: (signals) => {
    const ids = ['appProtections'];
    const empty = unreadOrEmpty(signals, ids, 'Managed app protection policies');
    if (empty) return empty;
    const rows = rowsOf(signals, ids)!.rows;
    const shaped = rows.filter(p => p.appDataEncryptionType !== undefined || p.deviceComplianceRequired !== undefined);
    if (shaped.length === 0) return notAssessed('Mobile CUI encryption', 'the policies were read without appDataEncryptionType or deviceComplianceRequired', signals, ids);
    const ok = shaped.filter(p => ['whenDeviceLocked', 'whenDeviceLockedExceptOpenFiles', 'afterDeviceRestart'].includes(String(p.appDataEncryptionType))
      || (p.deviceComplianceRequired === true && p.dataBackupBlocked === true));
    if (ok.length > 0) {
      return { status: 'met', evidence: `Mobile CUI encryption: '${ok.map(cfgName).join("', '")}' ${ok.map(p => p.appDataEncryptionType ? `encrypt app data (${String(p.appDataEncryptionType)})` : 'require a compliant device and block backup').join('; ')}` };
    }
    return { status: 'not_met', evidence: `Mobile CUI encryption: ${shaped.length} policy(ies) neither encrypt app data nor require a compliant device with backup blocked` };
  },

  // AC.L2-3.1.21: a device configuration blocks removable storage.
  removableStorageEvaluator: (signals, ctx) => {
    const empty = unreadOrEmpty(signals, CFG, 'Intune device configurations');
    if (empty) return empty;
    return storageBlockVerdict(rowsOf(signals, CFG)!.rows, ctx, 'Portable storage', signals, CFG);
  },
};
