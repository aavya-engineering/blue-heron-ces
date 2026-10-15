#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Command } from 'commander';
import { AoServer } from '../server/AoServer.js';
import { invokeAoCommand, listCommands, getCommand } from '../execution/invokeCommand.js';
import { listApprovals } from '../execution/ApprovalStore.js';
import { runApproveCommand, APPROVE_HELP_TEXT } from './approveCommand.js';

const program = new Command();

program
  .name('ao')
  .description('AdminOps CLI — CMMC Operations Console')
  .version('0.2.0');

program
  .command('gui')
  .description('Start AdminOps web GUI')
  .option('-p, --port <number>', 'Server port', '3000')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    await AoServer.start(port);
  });

program
  .command('list')
  .description('List AdminOps commands from the registry')
  .option('-d, --domain <domain>', 'Filter by domain letter or name')
  .option('-t, --tier <tier>', 'Filter by SoD tier (e.g. "Tier 2", "Tier 3")')
  .option('-c, --cmmc <practice>', 'Filter by CMMC practice substring (e.g. AC.L2-3.1.5)')
  .option('--json', 'Emit JSON')
  .action((o) => {
    const cmds = listCommands({ domain: o.domain, sodTier: o.tier, cmmc: o.cmmc });
    if (o.json) { console.log(JSON.stringify(cmds, null, 2)); return; }
    for (const c of cmds) {
      console.log(`${c.id.padEnd(5)} [${c.sodTier}] ${c.title}  (${(c.cmmcPractices || []).join(', ')})`);
    }
    console.log(`\n${cmds.length} command(s)`);
  });

program
  .command('show <commandId>')
  .description('Show one command with its parameters')
  .action((commandId) => {
    const c = getCommand(commandId);
    if (!c) { console.error(`Command ${commandId} not found`); process.exit(1); }
    console.log(JSON.stringify(c, null, 2));
  });

program
  .command('exec <commandId>')
  .description('Execute an AO command (dry-run by default; --apply for a live write)')
  .requiredOption('-t, --tenant <slug>', 'Tenant slug (e.g. vfsgov)')
  .option('-i, --inputs <json>', 'Parameter inputs as a JSON object', '{}')
  .option('-p, --param <kv>', 'Parameter as key=value (repeatable; PowerShell-friendly)',
    (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
  // PRECEDENCE (G-AO-CMMC-BOUND-1 M4): --apply arms a live write but is NOT
  // sufficient alone — the CmmcScopeGate can still deny this tenant/command
  // pair (and the CUI boundary can deny a resource param) even with --apply set.
  .option('--apply', 'Perform a LIVE write (dryRun=false). Omit for a safe preview.', false)
  .option('--strict-cmmc', 'Fail closed when the tenant lacks CMMC scoping fields (overrides AO_CMMC_STRICT/default)', false)
  .option('--requestor <upn>', 'Requestor UPN (for Tier-3 approval binding)')
  .option('--approval <id>', 'Approval id (for a gated Tier-3 execution)')
  .option('--config <path>', 'Explicit tenant config path override')
  .option('--stacksim [url]', "Run against tenant-stacksim: the tenant slug must resolve to (or is created as) a kind:'sim' ces-tenant registry record, and stacksim mode is enabled before any session spawns")
  .option('--json', 'Emit raw JSON result')
  .action(async (commandId, o) => {
    let inputs: Record<string, any> = {};
    try { inputs = JSON.parse(o.inputs); } catch { console.error('--inputs must be valid JSON'); process.exit(1); }
    // --param key=value entries override/extend --inputs (no JSON quoting needed in PowerShell)
    for (const kv of (o.param as string[])) {
      const eq = kv.indexOf('=');
      if (eq < 0) { console.error(`--param must be key=value (got "${kv}")`); process.exit(1); }
      inputs[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    const dryRun = !o.apply;
    try {
      if (o.stacksim) {
        // G-TENANT-M5 kind:'sim' path: registry-verified sim tenant + ces-tenant's
        // StacksimModeController (refuses live slugs — the A9 guard).
        const { requestAoStacksimMode } = await import('../tenant/aoTenants.js');
        await requestAoStacksimMode(
          typeof o.stacksim === 'string' ? o.stacksim : undefined,
          { preferredSlug: o.tenant }
        );
      }
      const result: any = await invokeAoCommand({
        commandId, tenant: o.tenant, inputs, dryRun,
        requestorUPN: o.requestor, approvalId: o.approval, tenantConfigPath: o.config,
        ...(o.strictCmmc ? { strictCmmc: true } : {}),
      });
      if (o.json) { console.log(JSON.stringify(result, null, 2)); return; }
      if (result && result.status === 'pending_approval') {
        console.log(`⏸  Tier-3 gate: approval required. approvalId=${result.approvalId}`);
        console.log(result.message || '');
        return;
      }
      const mode = dryRun ? 'DRY-RUN (no change applied)' : 'LIVE';
      console.log(`[${mode}] ${commandId} — success=${result.success}`);
      if (result.evidence?.metadata?.commandExecuted) {
        console.log(`command: ${result.evidence.metadata.commandExecuted}`);
      }
      if (result.evidence?.outcomeRationale) console.log(`outcome: ${result.evidence.outcomeRationale}`);
      if (result.evidence?.metadata?.preStateOutput) {
        console.log(`preview / pre-state:\n${result.evidence.metadata.preStateOutput}`);
      }
    } catch (e: any) {
      console.error(`error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command('approvals')
  .description('List Tier-3 approval requests (default: pending)')
  .option('-s, --status <status>', 'pending | approved | rejected | executed', 'pending')
  .action(async (o) => {
    try {
      const rows = await listApprovals(o.status);
      if (!rows.length) { console.log(`No ${o.status} approvals.`); return; }
      for (const r of rows) {
        console.log(`${r.approvalId}  ${r.commandId}  requestor=${r.requestorUPN}  status=${r.status}${r.approverUPN ? `  approver=${r.approverUPN}` : ''}`);
      }
    } catch (e: any) { console.error(`error: ${e.message}`); process.exit(1); }
  });

program
  .command('approve <approvalId>')
  .description('Record a SECOND-person approval (or --reject) on a pending Tier-3 request. The approver is the VERIFIED principal of a signed token (CES_AO_PRINCIPAL_TOKEN or --principal-token), never a typed name; it must differ from the requestor.')
  .option('--principal-token <token>', 'Signed principal token of the approving person (prefer the CES_AO_PRINCIPAL_TOKEN env var)')
  .option('--approver <upn>', 'NOT ACCEPTED (FX2-AO1): typed approver names are refused; use a principal token')
  .option('--reject', 'Reject instead of approve', false)
  .option('--reason <text>', 'Rejection reason (with --reject)')
  .addHelpText('after', APPROVE_HELP_TEXT)
  .action(async (approvalId, o) => {
    const code = await runApproveCommand(approvalId, {
      reject: o.reject, reason: o.reason, principalToken: o.principalToken, approver: o.approver,
    });
    if (code !== 0) process.exit(code);
  });

program.parse();
