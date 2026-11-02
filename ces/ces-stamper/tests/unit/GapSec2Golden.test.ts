// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SEC-2 golden render (GAP-CLOSURE-PLAN.md section 4 G-SEC): every command in the S1 executable
// plan, rendered with that plan's `variables` block, is byte-identical under the frozen pre-SEC-2
// resolvers and the guarded ones. Same for every PowerShell template in Stamper's registries.

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { resolveTemplate, PS_TOKEN_KINDS } from '../../src/utils/templateResolver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------------------------
// FROZEN pre-SEC-2 algorithms (copied verbatim from the sources SEC-2 replaced).
// ---------------------------------------------------------------------------------------------
/** PowerShellAdapter.sanitizePowerShellValue before SEC-2. */
function oldSanitizePowerShellValue(key: string, value: any): string {
  const s = String(value);
  // eslint-disable-next-line no-control-regex
  const breakout = new RegExp('[`;|&<>\\x00\\r\\n]|\\$\\(|\\$\\{');
  const m = breakout.exec(s);
  if (m) {
    throw new Error(
      `PowerShell injection guard: parameter "${key}" contains a disallowed metacharacter ` +
        `(${JSON.stringify(m[0])}) and was rejected before command execution. ` +
        `CES parameters may not contain: \` ; | & < > $( \${ or newlines.`
    );
  }
  return s.replace(/'/g, "''");
}

/** PowerShellAdapter.interpolateVariables before SEC-2. */
function oldInterpolateVariables(template: string, variables: Record<string, any>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const dollarPattern = '\\$\\{' + key + '\\}';
    const bracePattern = '(?<![$\\w])\\{' + key + '\\}';
    if (!new RegExp(dollarPattern + '|' + bracePattern).test(result)) {
      continue;
    }
    const safe = oldSanitizePowerShellValue(key, value);
    result = result.replace(new RegExp(dollarPattern, 'g'), safe);
    result = result.replace(new RegExp(bracePattern, 'g'), safe);
  }
  return result;
}

/** templateResolver.resolveTemplate before SEC-2 (non-strict). */
function oldResolveTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (match, varName) => {
    if (varName in variables) {
      const value = variables[varName];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      return match;
    }
    return match;
  });
}

// ---------------------------------------------------------------------------------------------
const FIXTURE = path.resolve(__dirname, '../fixtures/gap-sec2/s1-executable-plan.json');
const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
const variables: Record<string, any> = plan.variables;

type Cmd = [where: string, command: string];
function planCommands(p: any): Cmd[] {
  const out: Cmd[] = [];
  const add = (w: string, c: unknown): void => { if (typeof c === 'string' && c) out.push([w, c]); };
  for (const t of p.execution_graph) {
    const a = t.action;
    const g = a.args ?? {};
    add(`${t.id}:command`, a.command);
    add(`${t.id}:_get_command`, g._get_command);
    (g._evidence_commands ?? []).forEach((c: string, i: number) => add(`${t.id}:_evidence_commands[${i}]`, c));
    (g.powershell_commands ?? []).forEach((c: string, i: number) => add(`${t.id}:powershell_commands[${i}]`, c));
    for (const s of g._sub_commands ?? []) {
      add(`${s.id}:set_command`, s.set_command);
      add(`${s.id}:get_command`, s.get_command);
      (s.evidence_commands ?? []).forEach((c: string, i: number) => add(`${s.id}:evidence_commands[${i}]`, c));
      add(`${s.id}:preview_command`, s.destructive_guard?.preview_command);
      (s.destructive_guard?.exclusion_checks ?? []).forEach((c: string, i: number) => add(`${s.id}:exclusion_checks[${i}]`, c));
    }
  }
  return out;
}

const config = StamperConfig.fromTenantConfig({
  tenantId: 'test-tenant',
  appId: 'test-app',
  certThumbprint: 'test-thumbprint',
  certPath: '/path/to/cert',
  targetTenantDomain: 'test.onmicrosoft.us',
  clientName: 'Test Client',
});

const commands = planCommands(plan);

describe('SEC-2 golden render: S1 executable plan (fixture)', () => {
  it('the fixture holds the full S1 command set (923 commands, destructive-guard checks included)', () => {
    expect(commands.length).toBe(923);
  });

  it('PowerShellAdapter.interpolateVariables: every command identical to the frozen pre-SEC-2 algorithm', () => {
    const adapter = new PowerShellAdapter(config);
    const mismatches: string[] = [];
    for (const [where, cmd] of commands) {
      const oldOut = oldInterpolateVariables(cmd, variables);
      const newOut = (adapter as any).interpolateVariables(cmd, variables) as string;
      if (newOut !== oldOut) mismatches.push(where);
    }
    expect(mismatches).toEqual([]);
  });

  it('resolveTemplate: every command identical to the frozen pre-SEC-2 resolver', () => {
    const mismatches: string[] = [];
    for (const [where, cmd] of commands) {
      if (resolveTemplate(cmd, variables) !== oldResolveTemplate(cmd, variables)) mismatches.push(where);
    }
    expect(mismatches).toEqual([]);
  });

  it('ExecutionContext path (resolveCommand / queryResourceState): identical to ExecutionContext.resolve', () => {
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables(variables);
    const adapter = new PowerShellAdapter(config, undefined, ctx);
    const mismatches: string[] = [];
    for (const [where, cmd] of commands) {
      const oldOut = ctx.resolve(cmd, [], []);
      const newOut = (adapter as any).resolveInContext(cmd, [], []) as string;
      if (newOut !== oldOut) mismatches.push(where);
    }
    expect(mismatches).toEqual([]);
  });

  it('ExecutionContext path keeps its missing-variable error', () => {
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables(variables);
    const adapter = new PowerShellAdapter(config, undefined, ctx);
    expect(() => (adapter as any).resolveInContext("Get-X '{notAVariable}'", ['notAVariable'], []))
      .toThrow(/^Unresolved manifest variables: notAVariable\./);
  });

  it('every PS_TOKEN_KINDS entry renders its fixture value in a bare position unchanged', () => {
    const adapter = new PowerShellAdapter(config);
    for (const name of Object.keys(PS_TOKEN_KINDS)) {
      const tpl = `Get-MgUser -UserId {${name}} | Out-Null`;
      expect(typeof variables[name]).toBe('string');
      const oldOut = oldInterpolateVariables(tpl, variables);
      expect((adapter as any).interpolateVariables(tpl, variables)).toBe(oldOut);
      expect(resolveTemplate(tpl, variables)).toBe(oldOut);
    }
  });
});

describe('SEC-2 golden render: Stamper registry templates with representative values', () => {
  const scalars: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(variables)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') scalars[k] = v;
  }
  // Names the registries use that the S1 plan does not carry (runtime captures, other stacks).
  const representative: Record<string, string> = {
    operatorUserId: '11111111-2222-4333-8444-555555555555',
    globalAdminRoleDefId: '62e90394-69f5-4237-9190-012177145e10',
    privilegedRoleAdminDefId: 'e8611ab8-c189-46e8-94e1-60213ab1f814',
    securityAdminRoleDefId: '194ae4cb-b126-40b2-bd5b-6091b380977d',
    namedLocationId: '0c4b2e7d-1111-4222-8333-944455556666',
    hostname: 's1mach-vm-mgmt',
    safeAttachPolicyName: 'S1 Safe Attachments - all users',
    antiPhishPolicyName: 'S1 Anti-Phish - all users',
    malwarePolicyName: 'S1 Malware - all users',
    antiSpamPolicyName: 'S1 Anti-Spam - all users',
    outboundSpamPolicyName: 'S1 Outbound Spam - all users',
    storageMiPrincipalId: '22222222-3333-4444-8555-666666666666',
    eoSpObjectId: '33333333-4444-4555-8666-777777777777',
    automationMiPrincipalId: '44444444-5555-4666-8777-888888888888',
    lawResourceId: '/subscriptions/51510000-00a2-4000-8000-000000000001/resourceGroups/rg-s1-mach-prod/providers/Microsoft.OperationalInsights/workspaces/law-s1-mach-prod',
    storageResourceId: '/subscriptions/51510000-00a2-4000-8000-000000000001/resourceGroups/rg-s1-mach-prod/providers/Microsoft.Storage/storageAccounts/s1machevops01',
    lawWorkspaceId: '51510000-00a3-4000-8000-000000000001',
    appId: '55555555-6666-4777-8888-999999999999',
  };
  const vars: Record<string, string | number | boolean> = { ...representative, ...scalars };

  const registryCommands: Cmd[] = [];
  for (const file of ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json']) {
    const reg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/registry', file), 'utf-8'));
    for (const e of reg.entries) {
      const add = (w: string, c: unknown): void => { if (typeof c === 'string' && c) registryCommands.push([`${file}#${e.entry_id}:${w}`, c]); };
      add('set_command', e.set_command);
      add('get_command', e.get_command);
      (e.evidence_commands ?? []).forEach((c: string, i: number) => add(`evidence_commands[${i}]`, c));
      add('preview_command', e.destructive_guard?.preview_command);
      (e.destructive_guard?.exclusion_checks ?? []).forEach((c: string, i: number) => add(`exclusion_checks[${i}]`, c));
    }
  }

  it('covers every PowerShell template field in both registries (685 templates: 595 before PH-12; DEPTH-1a removed 5 duplicate entries; CG + key-escrow get/evidence; FIN-40 + 7 infra entries x 3; FIN-41 + AZ-KV-005 x 3; PH-12 merge + 91: P12-R1 + 26, P12-R2 + 15, P12-R3 + 12, P12-R4 + 14 (attack-sim manual-only - 1), P12-R5 + 24; PH-13 (P13-ST) - 1: PS.L2-3.9.2.account-disable-evidence two evidence commands merged into one count read; PH-13 (P13-LV, P13-INT) + 1: PS.L2-3.9.2.leaver-access-terminated get_command = 686)', () => {
    expect(registryCommands.length).toBe(686);
  });

  it('every template renders identically to the frozen pre-SEC-2 resolver; none is rejected', () => {
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables(vars);
    const adapter = new PowerShellAdapter(config, undefined, ctx);
    const mismatches: string[] = [];
    for (const [where, cmd] of registryCommands) {
      const oldOut = oldResolveTemplate(cmd, vars);
      let ok: boolean;
      try {
        ok = resolveTemplate(cmd, vars) === oldOut
          && (adapter as any).resolveInContext(cmd, [], []) === ctx.resolve(cmd, [], []);
      } catch (e) {
        ok = false;
      }
      if (!ok) mismatches.push(where);
    }
    expect(mismatches).toEqual([]);
  });
});
