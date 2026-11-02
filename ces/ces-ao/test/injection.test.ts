// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SEC-3 breakout test (GAP-CLOSURE-PLAN.md section 4 G-SEC, V74 shape) over all 96 AO commands.
// Each payload enters the way production values do: a tenant-sourced parameter through the tenant
// record, any other parameter through the request, both via the production mapAoParametersToVariables.
// The command is rendered by the production Stamper PowerShellAdapter interpolation (dist, the same
// path CommandExecutor uses), raw and inside the get-then-set state-capture wrapper.
// Pass: the rendered command's code outside string literals equals that of a neutral render, so the
// payload sits only inside literals; or the guard rejects the value (NUL / line breaks).
// The SEC-1 payload table (ces-shared/src/security/psGuard.test.ts) is copied verbatim.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { TenantConfig } from 'ces-shared/config';
import { psContext } from 'ces-shared/security';
import { PowerShellAdapter } from 'ces-stamper/adapters/powershell';
import { mapAoParametersToVariables } from '../src/execution/ParameterMapper.js';
import { getCommandTemplates } from '../src/registry/TemplateRegistry.js';
import { buildStateCaptureCommand } from '../src/execution/GetThenSetExecutor.js';
import type { AoCommand } from '../src/types/AoCommand.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(path.resolve(__dirname, '../src/registry/ao-commands.registry.json'), 'utf-8'),
) as AoCommand[];

// ----- SEC-1 payload table (verbatim) ---------------------------------------------------------
const PAYLOADS_INLINE: string[] = [
  "'; Remove-MgUser x; '",
  "x'; Remove-MgUser -UserId admin@contoso.us -Confirm:$false; '",
  '"+(Remove-MgUser x)+"',
  '"; Remove-MgUser x; "',
  '$(calc)',
  '$(Remove-MgUser x)',
  '${env:x}',
  '${env:USERPROFILE}',
  '$env:x',
  '$true',
  '`$(calc)',
  'x`; calc',
  '`"; calc; `"',
  "`'; calc; `'",
  '\u2018; Remove-MgUser x; \u2018',
  '\u2019; Remove-MgUser x; \u2019',
  '\u201A; calc; \u201B',
  '\u201C+(calc)+\u201D',
  '\u201D; calc; \u201C',
  '\u201E; calc',
  "'\u2018\u2019\u2019; calc; \u2018",
  'x | Remove-MgUser',
  'x & calc',
  'x && calc',
  'x || calc',
  'x > C:\\out.txt',
  'x < C:\\in.txt',
  'x 2>&1',
  '(calc)',
  'x) ; calc ; (',
  '@(calc)',
  "''; calc; ''",
  "'''; calc #",
  "'+(calc)+'",
  "' -Force; '",
  '$null = calc',
  '"@; calc',
  "'@; calc",
  'x;calc',
  "[System.Diagnostics.Process]::Start('calc')",
  "& 'calc.exe'",
  '. { calc };',
  '--% ; calc',
  '<# x #> calc;',
  '-Filter "x"',
  "O'Brien; calc",
  "') | ForEach-Object { calc } #",
];
const PAYLOADS_LINEBREAK: string[] = [
  'x\nRemove-MgUser y',
  'x\r\nRemove-MgUser y',
  'x\rcalc',
  'x\u0000calc',
  "x\n'@\ncalc\n@'",
  'x\n"@\ncalc',
  'x\u2028calc',
  'x\u0085calc',
];
const NEUTRAL = 'zqz0neutral';

// ----- independent reader (does not use psContext) ----------------------------------------------
// Removes the bodies of single- and double-quoted strings and keeps everything else, tracking
// `$( )` inside double-quoted strings, backtick escapes and doubled quotes. Smart quotes count.
const SQ = new Set(["'", '\u2018', '\u2019', '\u201A', '\u201B']);
const DQ = new Set(['"', '\u201C', '\u201D', '\u201E']);
function codeOutsideLiterals(s: string): string {
  let out = '';
  // stack frames: 'code' | 'dq' | 'sub' (with paren depth)
  const stack: Array<{ k: 'code' | 'dq' | 'sub'; depth: number }> = [{ k: 'code', depth: 0 }];
  let i = 0;
  while (i < s.length) {
    const top = stack[stack.length - 1];
    const c = s[i];
    if (top.k === 'dq') {
      if (c === '`') { i += 2; continue; }
      if (DQ.has(c)) {
        if (i + 1 < s.length && DQ.has(s[i + 1])) { i += 2; continue; }
        stack.pop(); out += '"'; i++; continue;
      }
      if (c === '$' && s[i + 1] === '(') { stack.push({ k: 'sub', depth: 1 }); out += '$('; i += 2; continue; }
      i++;
      continue;
    }
    // code or sub-expression
    if (c === '`') { out += s.slice(i, i + 2); i += 2; continue; }
    if (SQ.has(c)) {
      i++;
      while (i < s.length) {
        if (SQ.has(s[i])) {
          if (i + 1 < s.length && SQ.has(s[i + 1])) { i += 2; continue; }
          break;
        }
        i++;
      }
      out += "''";
      i++;
      continue;
    }
    if (DQ.has(c)) { stack.push({ k: 'dq', depth: 0 }); out += '"'; i++; continue; }
    if (top.k === 'sub') {
      if (c === '(') top.depth++;
      if (c === ')') { top.depth--; if (top.depth === 0) { stack.pop(); out += ')'; i++; continue; } }
    }
    out += c;
    i++;
  }
  return out + `|depth=${stack.length}`;
}

// ----- inputs ---------------------------------------------------------------------------------
function setPath(obj: Record<string, any>, dotted: string, value: string): void {
  const parts = dotted.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts[parts.length - 1]] = value;
}

function tenantBase(): Record<string, any> {
  return {
    tenantSlug: 'sec3-injection',
    tenantId: 'sec3-injection-tid',
    appId: 'app-id',
    certPath: '/dev/null',
    certThumbprint: 'AABB000000000000000000000000000000000000',
    domain: 'sec3-injection.onmicrosoft.us',
    kind: 'sim',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'sub-1',
    resources: {},
  };
}

/** Every parameter of the command gets `value`: sourced ones via the tenant record, others via the request. */
function variablesFor(cmd: AoCommand, value: string): Record<string, string> {
  const tenant = tenantBase();
  const inputs: Record<string, string> = {};
  for (const p of cmd.parameters) {
    if (p.source) setPath(tenant, p.source, value);
    else inputs[p.name] = value;
  }
  return mapAoParametersToVariables(cmd, tenant as unknown as TenantConfig, inputs);
}

const adapter = new PowerShellAdapter({} as any) as any;
const render = (template: string, vars: Record<string, string>): string => adapter.interpolateVariables(template, vars);

const cases: Array<{ id: string; label: string; template: string; cmd: AoCommand }> = [];
for (const cmd of REGISTRY) {
  const t = getCommandTemplates(cmd.id);
  if (!t) continue;
  if (t.get_command) {
    cases.push({ id: cmd.id, label: 'get', template: t.get_command, cmd });
    cases.push({ id: cmd.id, label: 'get(state-capture)', template: buildStateCaptureCommand(t.get_command), cmd });
  }
  if (t.set_command) cases.push({ id: cmd.id, label: 'set', template: t.set_command, cmd });
}
const withPlaceholders = cases.filter((c) => psContext(c.template).length > 0);

describe('SEC-3 breakout over all 98 AO commands (mapAoParametersToVariables -> Stamper adapter)', () => {
  it('the payload table has 40+ entries and the case list covers all 98 commands', () => {
    expect(PAYLOADS_INLINE.length + PAYLOADS_LINEBREAK.length).toBe(55);
    expect(new Set(cases.map((c) => c.id)).size).toBe(98); // FIN-22: + F-15; PH-13 P13-LV: + A-22
    expect(withPlaceholders.length).toBeGreaterThan(60);
  });

  it.each(PAYLOADS_INLINE.map((p, i) => [i, p] as const))('inline payload #%i stays inside literals in every command', (_i, payload) => {
    const breakouts: string[] = [];
    for (const c of withPlaceholders) {
      const neutral = render(c.template, variablesFor(c.cmd, NEUTRAL));
      let out: string;
      try {
        out = render(c.template, variablesFor(c.cmd, payload));
      } catch (e: any) {
        breakouts.push(`${c.id} ${c.label}: unexpected rejection ${e?.message}`);
        continue;
      }
      if (codeOutsideLiterals(out) !== codeOutsideLiterals(neutral)) breakouts.push(`${c.id} ${c.label}`);
      if (out === neutral) breakouts.push(`${c.id} ${c.label}: payload not substituted`);
    }
    expect(breakouts).toEqual([]);
  });

  it.each(PAYLOADS_LINEBREAK.map((p, i) => [i, p] as const))('line-break payload #%i is rejected by the guard in every command', (_i, payload) => {
    const passed: string[] = [];
    for (const c of withPlaceholders) {
      try {
        render(c.template, variablesFor(c.cmd, payload));
        passed.push(`${c.id} ${c.label}`);
      } catch (e: any) {
        if (!/injection guard/i.test(String(e?.message))) passed.push(`${c.id} ${c.label}: ${e?.message}`);
      }
    }
    expect(passed).toEqual([]);
  });

  it('the independent reader sees a breakout in an unquoted or double-quoted template', () => {
    const sq = "Get-X -Id '{v}'";
    expect(codeOutsideLiterals(render(sq, { v: "'; calc; '" }))).toBe(codeOutsideLiterals(render(sq, { v: NEUTRAL })));
    // A hand-built unescaped render (what an unguarded resolver would produce) is caught.
    expect(codeOutsideLiterals("Get-X -Id ''; calc; ''")).not.toBe(codeOutsideLiterals(`Get-X -Id '${NEUTRAL}'`));
    expect(codeOutsideLiterals('Get-X -Filter "a"+(calc)+"b"')).not.toBe(codeOutsideLiterals(`Get-X -Filter "a${NEUTRAL}b"`));
  });
});

// ----- legitimate E7A values (harness: ces-tester scenarios/muster/*-e2e.json adminops_ops) ---------
// S1/S2 values from <WS>/out/adminops-e7a.json (S1 run 2026-10-30); S2 app-protection ids and S3
// values from the tenant-stacksim seeds (customerHistoryS2.ts, s3-def.json, gen-customer.mjs).
const E7A_TENANT_RESOURCES = {
  offboard_upn: 'merrin.hollinmere@s1-mach.simtenant.onmicrosoft.us',
  leaver_workflow_id: '51510000-001f-4000-8000-000000000003',
  android_app_protection_policy_id: 'androidManagedAppProtection-1',
  ios_app_protection_policy_id: 'iosManagedAppProtection-1',
  standing_admin_upn: 'derwyn.arrowbrook@s3-def.simtenant.onmicrosoft.us',
  breakglass_upn: 'emergency.access@s3-def.simtenant.onmicrosoft.us',
  // A-11's sourced (unused by its template) operatorUPN / breakGlassUPN: S1 sim-overrides.json operatorUPN.
  operator_upn: 'adm.dorrel.nettlecombe@s1-mach.simtenant.onmicrosoft.us',
  breakglass_ca_policy_1: 'S3-CA01 Require MFA - all users',
  breakglass_ca_policy_2: 'S3-CA02 Require MFA - administrators',
};
const E7A_OPS: Array<{ op: string; params: Record<string, string> }> = [
  { op: 'A-11', params: {} },
  { op: 'A-02', params: { upn: 'resources.offboard_upn' } },
  { op: 'A-09', params: {} },
  { op: 'A-21', params: { leaverWorkflowId: 'resources.leaver_workflow_id' } },
  { op: 'B-09', params: { appProtectionPolicyId: 'resources.android_app_protection_policy_id', iosAppProtectionPolicyId: 'resources.ios_app_protection_policy_id' } },
  { op: 'B-03', params: {} },
  { op: 'A-10', params: { targetUPN: 'resources.standing_admin_upn' } },
  { op: 'A-19', params: { policyDisplayName: 'resources.breakglass_ca_policy_1' } },
  { op: 'A-19', params: { policyDisplayName: 'resources.breakglass_ca_policy_2' } },
];

describe('SEC-3 legitimate E7A values render and are accepted', () => {
  it.each(E7A_OPS.map((o) => [o.op, JSON.stringify(o.params), o] as const))('%s %s', (_op, _p, o) => {
    const cmd = REGISTRY.find((c) => c.id === o.op)!;
    const tenant = tenantBase();
    tenant.resources = { ...E7A_TENANT_RESOURCES };
    const inputs: Record<string, string> = {};
    for (const [name, from] of Object.entries(o.params)) inputs[name] = (E7A_TENANT_RESOURCES as Record<string, string>)[from.replace(/^resources\./, '')];
    const vars = mapAoParametersToVariables(cmd, tenant as unknown as TenantConfig, inputs);
    const t = getCommandTemplates(cmd.id)!;
    for (const tpl of [t.get_command, t.set_command, t.get_command ? buildStateCaptureCommand(t.get_command) : ''].filter(Boolean)) {
      const out = render(tpl, vars);
      for (const ph of psContext(tpl)) {
        expect(vars[ph.name], `${cmd.id} {${ph.name}} bound`).toBeDefined();
        expect(out).toContain(vars[ph.name]);
      }
      expect(psContext(out).filter((ph) => Object.prototype.hasOwnProperty.call(vars, ph.name))).toEqual([]);
    }
    for (const v of Object.values(inputs)) expect(Object.values(vars)).toContain(v);
  });
});
