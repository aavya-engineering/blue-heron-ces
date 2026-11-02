// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SEC-2 breakout tests (GAP-CLOSURE-PLAN.md section 4 G-SEC, V74 shape), per adapter, with the
// SEC-1 payload table (ces-shared/src/security/psGuard.test.ts, copied: that file is Vitest).
// Single-quoted spot: the payload stays inside the literal. Double-quoted or bare spot: rejected
// with a clear "injection guard" error that surfaces as a task failure, before anything is spawned.

import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { CLIAdapter } from '../../src/adapters/CLIAdapter';
import { APIAdapter } from '../../src/adapters/APIAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { resolveTemplate } from '../../src/utils/templateResolver';
import { ExeTask, SubCommand } from '../../src/types/schema.types';

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
const ALL = [...PAYLOADS_INLINE, ...PAYLOADS_LINEBREAK];

// Independent PowerShell single-quoted string reader (does not use psContext).
const SQ = ["'", '\u2018', '\u2019', '\u201A', '\u201B'];
function readSingle(s: string, open: number): { close: number; body: string } {
  let body = '';
  let i = open + 1;
  while (i < s.length) {
    if (SQ.includes(s[i])) {
      if (i + 1 < s.length && SQ.includes(s[i + 1])) { body += s[i]; i += 2; continue; }
      return { close: i, body };
    }
    body += s[i];
    i++;
  }
  return { close: -1, body };
}

/** The payload is the whole body of the template's one literal, which closes where the template's did. */
function expectStaysInLiteral(template: string, out: string, payload: string): void {
  const open = template.indexOf("'");
  const tpl = readSingle(template, open);
  const got = readSingle(out, open);
  expect(got.close).toBe(out.length - (template.length - tpl.close));
  expect(got.body).toBe(tpl.body.replace(/\$?\{v\}/, payload));
  expect(out.slice(got.close + 1)).toBe(template.slice(tpl.close + 1));
}

const SINGLE = "Set-MgUser -UserId 'PRE-{v} SUF' -AccountEnabled:$false";
const SINGLE_DOLLAR = "Set-MgUser -UserId '${v}' -AccountEnabled:$false";
const DOUBLE = 'Get-MgUser -Filter "displayName eq {v}" | ConvertTo-Json';
const BARE = 'Get-DkimSigningConfig -Identity {v} | ConvertTo-Json';
const GUARD = /injection guard/i;

const config = StamperConfig.fromTenantConfig({
  tenantId: 'test-tenant',
  appId: 'test-app',
  certThumbprint: 'test-thumbprint',
  certPath: '/path/to/cert',
  targetTenantDomain: 'test.onmicrosoft.us',
  clientName: 'Test Client',
});

function ctxWith(v: string): ExecutionContext {
  const ctx = new ExecutionContext(false);
  ctx.loadManifestVariables({ v });
  return ctx;
}

describe('payload table', () => {
  it('has 40+ payloads (SEC-1 table: 47 inline + 8 line-break)', () => {
    expect(PAYLOADS_INLINE.length).toBe(47);
    expect(PAYLOADS_LINEBREAK.length).toBe(8);
  });
});

describe('PowerShellAdapter: single context never closes the literal', () => {
  const adapter = new PowerShellAdapter(config);
  it.each(PAYLOADS_INLINE)('interpolateVariables (legacy map) <- %j', (payload) => {
    expectStaysInLiteral(SINGLE, (adapter as any).interpolateVariables(SINGLE, { v: payload }), payload);
    expectStaysInLiteral(SINGLE_DOLLAR, (adapter as any).interpolateVariables(SINGLE_DOLLAR, { v: payload }), payload);
  });
  it.each(PAYLOADS_INLINE)('ExecutionContext path (resolveCommand) <- %j', (payload) => {
    const a = new PowerShellAdapter(config, undefined, ctxWith(payload));
    const sub = { variables_required: ['v'], variables_runtime: [] } as unknown as SubCommand;
    expectStaysInLiteral(SINGLE, (a as any).resolveCommand(SINGLE, sub, {}), payload);
  });
  it.each(PAYLOADS_INLINE)('resolveTemplate (dry-run reads, L383/L444 fallback) <- %j', (payload) => {
    expectStaysInLiteral(SINGLE, resolveTemplate(SINGLE, { v: payload }), payload);
  });
  it.each(PAYLOADS_LINEBREAK)('single context rejects line-break payload %j', (payload) => {
    expect(() => (adapter as any).interpolateVariables(SINGLE, { v: payload })).toThrow(GUARD);
    expect(() => resolveTemplate(SINGLE, { v: payload })).toThrow(GUARD);
  });
});

describe('PowerShellAdapter: double-quoted and bare contexts reject every payload', () => {
  const adapter = new PowerShellAdapter(config);
  it.each(ALL)('%j', (payload) => {
    for (const tpl of [DOUBLE, BARE]) {
      expect(() => (adapter as any).interpolateVariables(tpl, { v: payload })).toThrow(GUARD);
      expect(() => resolveTemplate(tpl, { v: payload })).toThrow(GUARD);
      const a = new PowerShellAdapter(config, undefined, ctxWith(payload));
      expect(() => (a as any).resolveInContext(tpl, ['v'], [])).toThrow(GUARD);
    }
  });

  it('the error names the parameter and never echoes the value', () => {
    let msg = '';
    try { (adapter as any).interpolateVariables(BARE, { v: 'x; Remove-MgUser secret-value' }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/parameter "v"/);
    expect(msg).not.toContain('secret-value');
  });
});

describe('PowerShellAdapter: a rejection is a task failure, before anything runs', () => {
  const legacyTask = (command: string): ExeTask => ({
    id: 'gap-sec2-legacy', type: 'policy', priority: 'p1', depends_on: [],
    action: { engine: 'mgraph', command, args: {} },
  } as unknown as ExeTask);

  it.each(['"+(Remove-MgUser x)+"', 'x; calc', '$(calc)'])('legacy path: success=false with the guard error <- %j', async (payload) => {
    const adapter = new PowerShellAdapter(config);
    const spawnSpy = jestSpyExecute(adapter);
    for (const tpl of [DOUBLE, BARE]) {
      const result = await adapter.execute(legacyTask(tpl), { v: payload }, false);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(GUARD);
    }
    expect(spawnSpy.calls).toBe(0);
  });

  it.each(['"+(Remove-MgUser x)+"', 'x; calc', '$(calc)'])('sub-command path: the task stops with the guard error <- %j', async (payload) => {
    const adapter = new PowerShellAdapter(config, undefined, ctxWith(payload));
    const spawnSpy = jestSpyExecute(adapter);
    for (const tpl of [DOUBLE, BARE]) {
      const sub = {
        id: 'gap-sec2.sub', label: 'gap-sec2', set_command: "Set-X '{v}'", get_command: tpl, engine: 'mgraph',
        sequence_hint: 1, idempotency: 'get-then-set', variables_required: ['v'], variables_runtime: [],
        captures: [], on_failure: 'abort_step', evidence_commands: [],
      } as unknown as SubCommand;
      const task = {
        id: 'gap-sec2-sub', type: 'policy', priority: 'p1', depends_on: [],
        action: { engine: 'mgraph', command: 'Get-X', args: { _sub_commands: [sub] } },
      } as unknown as ExeTask;
      // StamperEngine.executeGraph catches the rejection and records failTask (same path as an
      // unresolved variable).
      await expect(adapter.execute(task, {}, true)).rejects.toThrow(GUARD);
    }
    expect(spawnSpy.calls).toBe(0);
  });
});

/** Count calls to the adapter's process / session runners (none may happen on a rejection). */
function jestSpyExecute(adapter: PowerShellAdapter): { calls: number } {
  const counter = { calls: 0 };
  const a = adapter as any;
  a.executePowerShell = async () => { counter.calls++; return { stdout: '', stderr: '', exitCode: 0 }; };
  a.executeViaSession = async () => { counter.calls++; return { stdout: '', stderr: '', exitCode: 0 }; };
  return counter;
}

describe('CLIAdapter (shell:true): ${key} placeholders through the guard plus the double-quoted blocklist', () => {
  const adapter = new CLIAdapter();
  const interp = (tpl: string, vars: Record<string, any>): string => (adapter as any).interpolateVariables(tpl, vars);

  it('legitimate values render as before; {key} is still not a CLI placeholder', () => {
    expect(interp('az group show --name ${rg} --subscription ${sub}', { rg: 'rg-s1-mach-prod', sub: '51510000-00a2-4000-8000-000000000001' }))
      .toBe('az group show --name rg-s1-mach-prod --subscription 51510000-00a2-4000-8000-000000000001');
    expect(interp("az x --display-name '${n}' --tag {n}", { n: 'S1 Safe Links - all users' }))
      .toBe("az x --display-name 'S1 Safe Links - all users' --tag {n}");
    expect(interp('az x --name "${n}"', { n: 'CUI-Authorized-Users' })).toBe('az x --name "CUI-Authorized-Users"');
  });

  it.each(ALL)('every context rejects %j', (payload) => {
    for (const tpl of ["az x --name '${v}'", 'az x --name "${v}"', 'az x --name ${v}']) {
      expect(() => interp(tpl, { v: payload })).toThrow(GUARD);
    }
  });

  it.each(['x & calc', '"; calc; "', "'; calc; '"])('execute(): success=false with the guard error, nothing spawned <- %j', async (payload) => {
    const a = new CLIAdapter() as any;
    let spawned = 0;
    a.executeCommand = async () => { spawned++; return { stdout: '', stderr: '', exitCode: 0 }; };
    const task = { id: 'gap-sec2-cli', action: { engine: 'cli', command: 'az x --name ${v}', args: {} } } as unknown as ExeTask;
    const result = await a.execute(task, { v: payload }, false);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(GUARD);
    expect(spawned).toBe(0);
  });
});

describe('APIAdapter: ${key} path / query substitutions are URL-encoded', () => {
  const adapter = new APIAdapter();
  const interp = (tpl: string, vars: Record<string, any>): string => (adapter as any).interpolateVariables(tpl, vars);

  it('legitimate values render as before', () => {
    expect(interp('https://graph.microsoft.us/v1.0/users/${upn}/mailboxSettings', { upn: 'adm.dorrel.nettlecombe@s1-mach.simtenant.onmicrosoft.us' }))
      .toBe('https://graph.microsoft.us/v1.0/users/adm.dorrel.nettlecombe%40s1-mach.simtenant.onmicrosoft.us/mailboxSettings');
    expect(interp('https://graph.microsoft.us/v1.0/groups/${id}', { id: '51510000-00a3-4000-8000-000000000001' }))
      .toBe('https://graph.microsoft.us/v1.0/groups/51510000-00a3-4000-8000-000000000001');
    // A leading base URL (the origin) is substituted as before.
    expect(interp('${base}/v1.0/groups/${id}', { base: 'https://graph.microsoft.us', id: 'group-1' }))
      .toBe('https://graph.microsoft.us/v1.0/groups/group-1');
  });

  it.each(ALL)('a path / query value stays one encoded component <- %j', (payload) => {
    const out = interp('https://graph.microsoft.us/v1.0/users/${v}/x?$filter=${v}', { v: payload });
    const enc = encodeURIComponent(payload);
    expect(out).toBe(`https://graph.microsoft.us/v1.0/users/${enc}/x?$filter=${enc}`);
    const url = new URL(out);
    expect(url.origin).toBe('https://graph.microsoft.us');
    expect(decodeURIComponent(url.pathname.split('/')[3])).toBe(payload);
  });
});
