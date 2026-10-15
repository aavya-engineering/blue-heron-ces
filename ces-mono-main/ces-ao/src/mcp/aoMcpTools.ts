// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// ces-adminops MCP tool definitions + dispatch (FX2-AO1: moved out of
// mcp/ao-mcp-server.mjs so the tool behaviour is TypeScript under test; the
// .mjs is now transport-only and imports this module from dist/).
//
// SAFETY: dry-run is the default and a LIVE write (dryRun=false) is HARD-BLOCKED
// unless AO_MCP_ALLOW_APPLY=1. PRECEDENCE (G-AO-CMMC-BOUND-1 M4): that flag arms
// live writes but is NOT sufficient alone — CmmcScopeGate (and the CUI-boundary
// check) can still deny a tenant/command pair inside executeAoCommand.
//
// FX2-AO1: ao_approve records the decision as a VERIFIED principal. The caller
// passes `principalToken` — the approving person's own signed principal token
// (HS256, ces-shared/http/principal, verified with CES_AO_PRINCIPAL_SECRET in the
// server's env). A typed `approverUPN` is refused. There is no server-env token
// fallback: every approval call must present the approver's token itself.

import { listCommands, getCommand, invokeAoCommand } from '../execution/invokeCommand.js';
import { listApprovals, getApprovalRequest } from '../execution/ApprovalStore.js';
import { decideApprovalAsVerifiedPrincipal } from '../execution/VerifiedApprover.js';
import { isStacksimModeActive } from '../execution/SimOnlyRail.js';

export const AO_MCP_TOOLS = [
  {
    name: 'ao_list_commands',
    description: 'List AdminOps commands from the registry. Optional filters: domain (letter or name), sodTier ("Tier 2"/"Tier 3"), cmmc (practice substring, e.g. "AC.L2-3.1.5").',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' }, sodTier: { type: 'string' }, cmmc: { type: 'string' }, trigger: { type: 'string' },
      },
    },
  },
  {
    name: 'ao_get_command',
    description: 'Get one AdminOps command with its full definition and parameters.',
    inputSchema: { type: 'object', properties: { commandId: { type: 'string' } }, required: ['commandId'] },
  },
  {
    name: 'ao_execute',
    description: 'Execute an AdminOps command through the governed engine. dryRun defaults to true (safe preview of the exact command that would run). A live write (dryRun:false) is blocked unless the server was started with AO_MCP_ALLOW_APPLY=1. Tier-3 commands return a pending-approval record instead of executing.',
    inputSchema: {
      type: 'object',
      properties: {
        commandId: { type: 'string' },
        tenant: { type: 'string', description: 'tenant slug, e.g. vfsgov' },
        inputs: { type: 'object', description: 'command parameter inputs' },
        dryRun: { type: 'boolean', description: 'default true; false requires AO_MCP_ALLOW_APPLY=1' },
        requestorUPN: { type: 'string' },
        approvalId: { type: 'string' },
        tenantConfigPath: { type: 'string', description: 'explicit tenant config path override' },
      },
      required: ['commandId', 'tenant'],
    },
  },
  {
    name: 'ao_approvals',
    description: 'List Tier-3 two-person approval requests (default: pending). Each record carries approvalId, commandId, requestorUPN, bound inputs, and status (pending|approved|rejected|executed). An approval binds the EXACT inputs by hash - executing with different inputs requires a new request.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'pending | approved | rejected | executed (default pending)' },
        approvalId: { type: 'string', description: 'fetch one approval by id instead of listing' },
      },
    },
  },
  {
    name: 'ao_approve',
    description:
      'Record the SECOND-person decision on a pending Tier-3 approval. The approver is the VERIFIED principal of `principalToken` ' +
      "(the approving person's own signed principal token, verified with CES_AO_PRINCIPAL_SECRET in this server's env) — a typed " +
      'approverUPN is refused. Separation of duties is enforced: the verified approver must differ from the requestor. Approving does ' +
      'NOT execute - re-call ao_execute with { approvalId, dryRun:false } to run the gated command. Blocked unless the server was ' +
      'started with AO_MCP_ALLOW_APPLY=1 (approval is the second half of a live-write authorization).',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: { type: 'string' },
        principalToken: { type: 'string', description: "the approving person's signed principal token (never a typed name); tenant-bound: its tid must be the approval's tenant; must carry the 'ao-approver' role" },
        reject: { type: 'boolean', description: 'reject instead of approve' },
        reason: { type: 'string', description: 'rejection reason (with reject:true)' },
      },
      required: ['approvalId', 'principalToken'],
    },
  },
] as const;

export interface AoMcpContext {
  env?: NodeJS.ProcessEnv;
}

export async function callAoMcpTool(name: string, args: Record<string, any> | undefined, ctx: AoMcpContext = {}): Promise<any> {
  const env = ctx.env ?? process.env;
  const allowApply = env.AO_MCP_ALLOW_APPLY === '1';
  args = args || {};
  if (name === 'ao_list_commands') {
    const cmds = listCommands({ domain: args.domain, sodTier: args.sodTier, cmmc: args.cmmc, trigger: args.trigger } as any);
    return cmds.map((c: any) => ({ id: c.id, title: c.title, sodTier: c.sodTier, trigger: c.trigger, idempotencyClass: c.idempotencyClass, cmmcPractices: c.cmmcPractices, params: (c.parameters || []).map((p: any) => p.name) }));
  }
  if (name === 'ao_get_command') {
    const c = getCommand(args.commandId);
    if (!c) throw new Error(`Command ${args.commandId} not found`);
    return c;
  }
  if (name === 'ao_execute') {
    let dryRun = args.dryRun !== false; // default true
    let forced = false;
    if (args.dryRun === false && !allowApply) { dryRun = true; forced = true; }
    const result = await invokeAoCommand({
      commandId: args.commandId, tenant: args.tenant, inputs: args.inputs || {},
      dryRun, requestorUPN: args.requestorUPN, approvalId: args.approvalId, tenantConfigPath: args.tenantConfigPath,
    });
    return {
      mode: dryRun ? 'DRY_RUN' : 'LIVE',
      liveApplyBlocked: forced ? 'requested dryRun:false was overridden to true — server not started with AO_MCP_ALLOW_APPLY=1' : undefined,
      // AO-20 (2026-09-27, FC-AO): whether THIS MCP SERVER PROCESS is actually routed
      // to stacksim right now (process-level fact, independent of the tenant named
      // above). A 'sim'-kind tenant is refused by the executor when this is false —
      // surfaced here so the caller isn't surprised by a denied_sim_only result.
      stacksimModeActive: isStacksimModeActive(env),
      result,
    };
  }
  if (name === 'ao_approvals') {
    if (args.approvalId) {
      const one = await getApprovalRequest(args.approvalId);
      if (!one) throw new Error(`Approval ${args.approvalId} not found`);
      return one;
    }
    const status = args.status || 'pending';
    return await listApprovals(status);
  }
  if (name === 'ao_approve') {
    if (!allowApply) {
      throw new Error('ao_approve is blocked: server not started with AO_MCP_ALLOW_APPLY=1 (approval authorizes a live write)');
    }
    const decision = args.reject ? 'reject' : 'approve';
    const approval = await decideApprovalAsVerifiedPrincipal({
      approvalId: args.approvalId,
      decision,
      reason: args.reason,
      principalToken: args.principalToken,
      typedApprover: args.approverUPN,
      env,
    });
    return {
      decision,
      approval,
      next: decision === 'approve'
        ? `run ao_execute with { commandId: "${approval.commandId}", approvalId: "${approval.approvalId}", dryRun: false } and the SAME inputs`
        : undefined,
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}
