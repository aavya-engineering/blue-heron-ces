// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 P13-LV: the production dependencies of the leaver flow.
//
// The leave signal (verified on Microsoft Learn 2026-11-01, LEAVE_SIGNAL_SOURCE_URLS):
//   user.employeeLeaveDateTime - "the date and time when the user left or will leave the organization".
//   Read: application permission User-LifeCycleInfo.Read.All (delegated: Lifecycle Workflows Administrator or
//   Global Reader). Write: User.Read.All + User-LifeCycleInfo.ReadWrite.All (delegated: Global Administrator).
//   Supports $filter (eq, ne, not, ge, le, in). Learn names no licence for the property itself; the Lifecycle
//   Workflows that TRIGGER on it are the Entra ID Governance feature G5 lacks. HR provisioning, Entra Connect
//   or a custom sync sets it ("best updated via automation"). Where the tenant does not keep it, the operator
//   / HR input route (POST /api/leaver/flows) names the leaver instead.
// The read goes through the same rails as every AO execution: the sim-only rail and, for a sim tenant, the
// stacksim-mode check; it must pass the get-then-set read-only guard; it never writes.

import type { TenantConfig } from 'ces-shared/config';
import { PowerShellAdapter } from 'ces-stamper/adapters/powershell';
import { createExecutionContext } from '../execution/AuthChain.js';
import { checkSimOnlyRail, isStacksimModeActive } from '../execution/SimOnlyRail.js';
import { readOnlyViolation } from '../execution/GetThenSetExecutor.js';
import { requiredSessionsForScript } from '../execution/AdapterRouter.js';
import { findCommand, resolveInvocationTenant, executeInvocation } from '../execution/invokeCommand.js';
import { LEAVER_OP } from './leaverStore.js';
import type { LeaverExecArgs, LeaverExecResult, LeaverSignalRead, LeaverSignalUser } from './LeaverFlowService.js';

export const SIGNAL_BEGIN = '<<AO-LEAVER-SIGNAL-BEGIN>>';
export const SIGNAL_END = '<<AO-LEAVER-SIGNAL-END>>';
export const SIGNAL_SELECT = 'id,userPrincipalName,displayName,accountEnabled,employeeLeaveDateTime';

/** The read-only PowerShell the signal read sends (paged; relative URI, so it follows the connected cloud). */
export function signalCommand(): string {
  return [
    "$now=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ');",
    `$uri="/v1.0/users?\`$filter=employeeLeaveDateTime le $now&\`$select=${SIGNAL_SELECT}";`,
    '$all=@(); do { $r=Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject; if($r.value){ $all+=@($r.value) }; $uri=$r.\'@odata.nextLink\' } while($uri);',
    `Write-Output '${SIGNAL_BEGIN}'; ConvertTo-Json -InputObject @($all) -Depth 4 -Compress; Write-Output '${SIGNAL_END}'`,
  ].join(' ');
}

const prop = (o: Record<string, unknown>, k: string): unknown => {
  const key = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase());
  return key === undefined ? undefined : o[key];
};

/** Parse the read's stdout (banner noise around the markers is ignored). Throws when the markers are missing. */
export function parseSignalOutput(stdout: string): LeaverSignalUser[] {
  const a = stdout.indexOf(SIGNAL_BEGIN);
  const b = stdout.indexOf(SIGNAL_END, a + SIGNAL_BEGIN.length);
  if (a < 0 || b < 0) throw new Error('leave-signal read: no result markers in the output (the read did not complete)');
  const text = stdout.slice(a + SIGNAL_BEGIN.length, b).trim();
  const parsed: unknown = text ? JSON.parse(text) : [];
  const rows = (Array.isArray(parsed) ? parsed : [parsed]).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  return rows
    .map((r) => ({
      id: (prop(r, 'id') as string | undefined) ?? null,
      upn: String(prop(r, 'userPrincipalName') ?? ''),
      displayName: (prop(r, 'displayName') as string | undefined) ?? null,
      accountEnabled: typeof prop(r, 'accountEnabled') === 'boolean' ? (prop(r, 'accountEnabled') as boolean) : null,
      employeeLeaveDateTime: (prop(r, 'employeeLeaveDateTime') as string | undefined) ?? null,
    }))
    .filter((u) => u.upn);
}

/** Graph leave-signal read for one tenant, through AO's PowerShell adapter and rails. */
export async function readLeaveSignal(tenantSlug: string): Promise<LeaverSignalRead> {
  const cfg = (await resolveInvocationTenant(tenantSlug)) as TenantConfig & { kind?: string };
  const rail = checkSimOnlyRail(cfg.kind, cfg.endpoints as Record<string, string | undefined> | undefined);
  if (!rail.allowed) throw new Error(`leave-signal read refused: ${rail.reason}`);
  if (cfg.kind === 'sim' && !isStacksimModeActive()) {
    throw new Error('leave-signal read refused: a sim tenant, but this process is not wired to the simulator (STACKSIM_SERVER_URL / PSModulePath)');
  }
  const command = signalCommand();
  const violation = readOnlyViolation(command);
  if (violation) throw new Error(`leave-signal read refused by the read-only guard: ${violation}`);
  const ctx = createExecutionContext(cfg, false);
  const adapter = new PowerShellAdapter(
    ctx.executionConfig as unknown as ConstructorParameters<typeof PowerShellAdapter>[0],
    ctx.sessionFactory as unknown as ConstructorParameters<typeof PowerShellAdapter>[1],
  );
  const task = {
    id: 'ao-leaver-signal',
    action: { command, engine: 'mgraph', args: { _sessions: requiredSessionsForScript(command) } },
    controls: ['PS.L2-3.9.2'],
    idempotency: 'safe',
  };
  const res = await adapter.execute(task as any, {}, false);
  if (!res.success) throw new Error(`leave-signal read failed: ${res.error ?? res.stderr ?? 'unknown error'}`);
  return { query: `GET /v1.0/users?$filter=employeeLeaveDateTime le <now>&$select=${SIGNAL_SELECT}`, users: parseSignalOutput(res.stdout ?? '') };
}

/** Tenant id and any administrator contacts the tenant record names (`tenantAdminContacts`, optional). */
export async function resolveLeaverTenant(slug: string): Promise<{ tenantId: string; adminContacts?: string[] }> {
  const cfg = (await resolveInvocationTenant(slug)) as TenantConfig & { tenantAdminContacts?: unknown };
  const contacts = Array.isArray(cfg.tenantAdminContacts) ? cfg.tenantAdminContacts.filter((x): x is string => typeof x === 'string') : undefined;
  return { tenantId: cfg.tenantId, ...(contacts ? { adminContacts: contacts } : {}) };
}

/** Run A-22 through the governed engine, live (the confirm IS the operator's go-ahead; same path as the CLI). */
export async function executeLeaverOp(args: LeaverExecArgs): Promise<LeaverExecResult> {
  const cmd = findCommand(LEAVER_OP);
  if (!cmd) throw new Error(`${LEAVER_OP} is not in the AO registry`);
  const cfg = await resolveInvocationTenant(args.tenantSlug);
  const r = await executeInvocation(cmd, cfg, { targetUPN: args.upn }, false, {
    requestorUPN: args.requestorUPN,
    correlationId: args.correlationId,
    ...(args.approvalId ? { approvalId: args.approvalId } : {}),
  });
  if ('status' in r) return { pendingApprovalId: r.approvalId, success: false, summary: r.message };
  const lines = String(r.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("leaver '"));
  const summary = r.success ? (lines.at(-1) ?? 'A-22 applied') : String(r.error ?? r.stderr ?? 'A-22 failed');
  return {
    success: r.success === true,
    outcome: r.evidence?.outcome,
    verdict: r.evidence?.complianceVerdict,
    evidencePath: r.evidencePath,
    evidencePersisted: r.evidencePersisted,
    evidenceSha256: r.evidence?.metadata?.sha256Hash,
    summary,
  };
}
