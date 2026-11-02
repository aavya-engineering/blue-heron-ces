// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 1 addendum: builds each control's evaluator context from the Tenant Manifest (TM):
 * the control's `normative_controls[].verification[].expected_value` checks, plus the break-glass
 * and admin account object ids (TM `assets[]` of type break_glass_account / admin_account, whose
 * `owner` UPN is resolved to an object id through the users read). A TM for another tenant
 * (tenant_identity.tenant_id differs from the assessed tenant) contributes nothing.
 */
import type { SignalResult } from 'ces-shared/types/signal';
import type { EvaluatorContext, ExpectedValueCheck } from './conditions.js';
import { listOf } from './conditions.js';

export interface TmContexts {
  /** The context for one control id (exact id first, then the same NIST number). */
  forControl(controlId: string): EvaluatorContext | undefined;
  /** Why the TM was or was not used, and what it resolved (for logs). */
  readonly summary: string;
}

const NONE: TmContexts = { forControl: () => undefined, summary: 'no tenant manifest' };
const nistOf = (id: string): string => id.match(/\d+\.\d+\.\d+/)?.[0] ?? id;
const OPS = new Set(['equals', 'contains', 'gte', 'lte', 'exists', 'count-gte']);

export function evaluatorContextsFromTm(raw: unknown, signals: SignalResult[], opts: { tenantId?: string } = {}): TmContexts {
  if (!raw || typeof raw !== 'object') return NONE;
  const outer = raw as Record<string, unknown>;
  const tm = (outer.tenant_manifest && typeof outer.tenant_manifest === 'object' ? outer.tenant_manifest : outer) as Record<string, any>;
  const tmTenant = tm.tenant_identity?.tenant_id;
  if (opts.tenantId && tmTenant && String(tmTenant) !== String(opts.tenantId)) {
    return { forControl: () => undefined, summary: `tenant manifest is for '${String(tmTenant)}', not '${opts.tenantId}'; not used` };
  }

  // Expected values per control id.
  const byControl = new Map<string, ExpectedValueCheck[]>();
  for (const nc of (Array.isArray(tm.normative_controls) ? tm.normative_controls : []) as Array<Record<string, any>>) {
    const checks = ((nc.verification ?? []) as Array<Record<string, any>>)
      .map(v => v?.expected_value)
      .filter((e): e is ExpectedValueCheck => !!e && typeof e.path === 'string' && OPS.has(String(e.op)));
    if (checks.length > 0 && nc.control_id) byControl.set(String(nc.control_id), [...(byControl.get(String(nc.control_id)) ?? []), ...checks]);
  }

  // Break-glass and admin accounts: owner UPN -> object id through the users read.
  const users = signals.filter(s => (s.signalId === 'directoryUsers' || s.signalId === 'users') && s.status === 'success')
    .flatMap(s => listOf(s.rawData));
  const idOfUpn = new Map(users.filter(u => u.userPrincipalName && u.id).map(u => [String(u.userPrincipalName).toLowerCase(), String(u.id)]));
  const assets = (Array.isArray(tm.assets) ? tm.assets : []) as Array<Record<string, any>>;
  const resolve = (type: string) => {
    const owners = assets.filter(a => a.asset_type === type && a.owner).map(a => String(a.owner).toLowerCase());
    return { ids: owners.map(o => idOfUpn.get(o)).filter((x): x is string => !!x), unresolved: owners.filter(o => !idOfUpn.has(o)).length, total: owners.length };
  };
  const bg = resolve('break_glass_account');
  const admin = resolve('admin_account');

  // W7-EO3 (AC.L2-3.1.7): the designated break-glass account in tenant_identity (id, and UPN via the users read).
  const ti = (tm.tenant_identity ?? {}) as Record<string, unknown>;
  const designated = [...new Set([
    typeof ti.breakGlassUserId === 'string' && ti.breakGlassUserId.trim() ? ti.breakGlassUserId.trim() : undefined,
    typeof ti.breakGlassUPN === 'string' ? idOfUpn.get(ti.breakGlassUPN.trim().toLowerCase()) : undefined,
  ].filter((x): x is string => !!x))];

  const base: EvaluatorContext = {};
  if (bg.ids.length > 0) base.breakGlassIds = bg.ids;
  if (designated.length > 0) base.designatedBreakGlassIds = designated;
  if (admin.ids.length > 0) base.adminAccountIds = admin.ids;
  // W5 cycle 3 (AC.L2-3.1.6): the stated admin naming convention (first structured value found).
  const convention = ((Array.isArray(tm.config_intents) ? tm.config_intents : []) as Array<Record<string, any>>)
    .map(ci => ci?.desired_config?.admin_naming_convention)
    .find((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (convention) base.adminNamingConvention = convention.trim();

  const byNist = new Map<string, ExpectedValueCheck[]>();
  for (const [id, checks] of byControl) if (!byNist.has(nistOf(id))) byNist.set(nistOf(id), checks);

  return {
    forControl(controlId: string) {
      const expected = byControl.get(controlId) ?? byNist.get(nistOf(controlId));
      if (!expected && !base.breakGlassIds && !base.designatedBreakGlassIds && !base.adminAccountIds && !base.adminNamingConvention) return undefined;
      return { ...base, ...(expected ? { expected } : {}) };
    },
    summary: `tenant manifest used: expected values for ${byControl.size} control(s); break-glass ${bg.ids.length} of ${bg.total} resolved; designated break-glass ${designated.length ? designated.join(', ') : 'none'}; admin accounts ${admin.ids.length} of ${admin.total} resolved`,
  };
}
