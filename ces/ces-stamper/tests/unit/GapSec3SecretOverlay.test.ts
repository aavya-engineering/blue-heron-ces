// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SEC-3 follow-ups from SEC-2 (GAP-CLOSURE-PLAN.md section 4 G-SEC):
//  B. applySecretOverlay substitutes the real secret by the sentinel's quoting context
//     (single -> quotes doubled, double -> double-quoted blocklist, bare -> rejected) and never
//     puts the value, or one of its characters, into an error message or redacted output.
//  C. buildIdempotentScript 'deterministic-guid-put' writes displayName as a single-quoted literal.

import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { SecretResolutionError } from '../../src/core/SecretResolver';
import { secretSentinel } from '../../src/core/secretSentinel';

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant',
    appId: 'test-app',
    certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert',
    targetTenantDomain: 'test.onmicrosoft.us',
    clientName: 'Test Client',
  });
}

// Independent PowerShell single-quoted string reader (does not use psContext).
const SQ = ["'", '‘', '’', '‚', '‛'];
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

const PASSWORD = "Pa'ss$w0rd!x";
const S = secretSentinel('initialPassword');
const SINGLE_CMD = `New-MgUser -DisplayName 'Admin-x' -PasswordProfile @{Password='${S}';ForceChangePasswordNextSignIn=$true}`;
const DOUBLE_CMD = `New-MgUser -PasswordProfile @{Password="${S}"}`;
const BARE_CMD = `New-MgUser -Password ${S} -AccountEnabled:$true`;

function overlayAdapter(value: string): any {
  const adapter = new PowerShellAdapter(makeConfig()) as any;
  adapter.setSecretOverlay({ initialPassword: value });
  return adapter;
}

function thrown(fn: () => unknown): SecretResolutionError {
  try {
    fn();
  } catch (e) {
    return e as SecretResolutionError;
  }
  throw new Error('expected a throw');
}

describe('SEC-3 B: context-aware secret overlay', () => {
  it("single-quoted: a password containing ' and $ stays one literal whose value is the password", () => {
    const out: string = overlayAdapter(PASSWORD).applySecretOverlay(SINGLE_CMD);
    const open = SINGLE_CMD.indexOf("@{Password='") + "@{Password=".length;
    const lit = readSingle(out, open);
    expect(lit.body).toBe(PASSWORD);
    expect(out.slice(lit.close + 1)).toBe(';ForceChangePasswordNextSignIn=$true}');
    expect(out).toContain("@{Password='Pa''ss$w0rd!x'}".slice(0, -1));
    expect(out).not.toContain('CES_SECRET');
  });

  it('double-quoted: a password containing $ is rejected with a named, value-free task error', () => {
    const err = thrown(() => overlayAdapter(PASSWORD).applySecretOverlay(DOUBLE_CMD));
    expect(err).toBeInstanceOf(SecretResolutionError);
    expect(err.variable).toBe('initialPassword');
    expect(err.message).toMatch(/SECRET_CONTEXT_REJECTED/);
    expect(err.message).toMatch(/double-quoted/);
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).not.toContain("Pa'ss");
    expect(err.message).not.toContain('w0rd');
    expect(err.message).not.toContain('$');
  });

  it('double-quoted: a password without blocked characters is substituted unchanged', () => {
    const out: string = overlayAdapter("Plain-Pass_1!'").applySecretOverlay(DOUBLE_CMD);
    expect(out).toBe(`New-MgUser -PasswordProfile @{Password="Plain-Pass_1!'"}`);
  });

  it('bare: rejected, even for a password that would pass a token allowlist', () => {
    for (const v of [PASSWORD, 'SimplePass1']) {
      const err = thrown(() => overlayAdapter(v).applySecretOverlay(BARE_CMD));
      expect(err).toBeInstanceOf(SecretResolutionError);
      expect(err.message).toMatch(/SECRET_CONTEXT_BARE/);
      expect(err.message).not.toContain(v);
    }
  });

  it('a sentinel glued to a word (not a lexer placeholder) counts as bare', () => {
    const err = thrown(() => overlayAdapter('SimplePass1').applySecretOverlay(`X -P abc${S}`));
    expect(err.message).toMatch(/SECRET_CONTEXT_BARE/);
  });

  it('here-string @\'...\'@: substituted without doubling; a line break is rejected', () => {
    const cmd = `$p = @'\n${S}\n'@`;
    expect(overlayAdapter(PASSWORD).applySecretOverlay(cmd)).toBe(`$p = @'\n${PASSWORD}\n'@`);
    const err = thrown(() => overlayAdapter("x\n'@\ncalc").applySecretOverlay(cmd));
    expect(err.message).toMatch(/SECRET_CONTEXT_REJECTED/);
    expect(err.message).not.toContain('calc');
  });

  it('single-quoted: a line break in the secret is rejected without echoing it', () => {
    const err = thrown(() => overlayAdapter('abc\ndef').applySecretOverlay(SINGLE_CMD));
    expect(err.message).toMatch(/SECRET_CONTEXT_REJECTED/);
    expect(err.message).not.toMatch(/abc|def/);
  });

  it('every SEC-1 inline breakout payload as a secret stays inside the single-quoted literal', () => {
    const payloads = [
      "'; Remove-MgUser x; '", "x'; calc; '", '"+(calc)+"', '$(calc)', '${env:x}', '`$(calc)',
      '‘; calc; ‘', '’; calc; ’', '‚; calc; ‛', "'‘’’; calc; ‘",
      "''; calc; ''", "'''; calc #", "'+(calc)+'", "' -Force; '", "'@; calc", "O'Brien; calc", "') | ForEach-Object { calc } #",
    ];
    const open = SINGLE_CMD.indexOf("@{Password='") + "@{Password=".length;
    for (const p of payloads) {
      const out: string = overlayAdapter(p).applySecretOverlay(SINGLE_CMD);
      const lit = readSingle(out, open);
      expect(lit.body).toBe(p);
      expect(out.slice(lit.close + 1)).toBe(';ForceChangePasswordNextSignIn=$true}');
    }
  });

  it('two sentinels in different contexts are each judged by their own context', () => {
    const cmd = `A -X '${S}' -Y "${secretSentinel('other')}"`;
    const adapter = new PowerShellAdapter(makeConfig()) as any;
    adapter.setSecretOverlay({ initialPassword: PASSWORD, other: 'ok-value' });
    expect(adapter.applySecretOverlay(cmd)).toBe(`A -X 'Pa''ss$w0rd!x' -Y "ok-value"`);
  });

  it('a missing value still reports SECRET_UNRESOLVED first', () => {
    const adapter = new PowerShellAdapter(makeConfig()) as any;
    const err = thrown(() => adapter.applySecretOverlay(BARE_CMD));
    expect(err.message).toMatch(/SECRET_UNRESOLVED/);
  });

  describe('executeViaSession', () => {
    it('the session gets the escaped secret; an echo of it in output is redacted to the sentinel', async () => {
      const received: string[] = [];
      const fakeSessionManager = {
        execute: async (_t: string, command: string) => {
          received.push(command);
          return { stdout: `echo: ${command}`, stderr: `raw ${PASSWORD}`, exitCode: 0 };
        },
      };
      const adapter = new PowerShellAdapter(makeConfig(), fakeSessionManager as any) as any;
      adapter.setSecretOverlay({ initialPassword: PASSWORD });
      const result = await adapter.executeViaSession('mgraph', SINGLE_CMD, false);
      expect(received[0]).toContain("'Pa''ss$w0rd!x'");
      expect(result.stdout).not.toContain("Pa''ss");
      expect(result.stdout).not.toContain(PASSWORD);
      expect(result.stdout).toContain(S);
      expect(result.stderr).toBe(`raw ${S}`);
    });

    it('a bare sentinel blocks the task before anything reaches the session', async () => {
      const received: string[] = [];
      const fakeSessionManager = { execute: async (_t: string, c: string) => { received.push(c); return { stdout: '', stderr: '', exitCode: 0 }; } };
      const adapter = new PowerShellAdapter(makeConfig(), fakeSessionManager as any) as any;
      adapter.setSecretOverlay({ initialPassword: PASSWORD });
      await expect(adapter.executeViaSession('mgraph', BARE_CMD, false)).rejects.toThrow(/SECRET_CONTEXT_BARE/);
      expect(received).toHaveLength(0);
    });
  });
});

describe("SEC-3 C: deterministic-guid-put displayName is a single-quoted literal", () => {
  const adapter = new PowerShellAdapter(makeConfig()) as any;
  const build = (command: string, args: Record<string, unknown>) =>
    adapter.buildIdempotentScript(command, args, 'deterministic-guid-put', {}) as string;
  const dnLine = (script: string) => script.split('\n').find((l) => l.startsWith('$displayName = '))!;

  it('a plain displayName gives the same string value as before', () => {
    expect(dnLine(build('New-X', { displayName: 'CMMC - Log gap detection' }))).toBe("$displayName = 'CMMC - Log gap detection'");
  });

  it('the S1 fallback (no displayName: the command itself) is one literal with the same value', () => {
    // From <WS>/out/executable-plan.json (S1), the one deterministic-guid-put task.
    const cmd = '# KQL: Heartbeat | summarize LastHeartbeat=max(TimeGenerated) by Computer | where LastHeartbeat < ago(30m); # Create scheduled analytics rule for log gap detection';
    expect(cmd).not.toMatch(/[\r\n'$`"]/);
    const line = dnLine(build(cmd, {}));
    expect(line).toBe(`$displayName = '${cmd}'`);
  });

  it("quotes, $ and breakout text stay inside the literal (no expansion, no code)", () => {
    for (const dn of ["O'Brien $env:x rule", '"; calc; "', "'; calc; '", '$(calc)', '`$(calc)']) {
      const line = dnLine(build('New-X', { displayName: dn }));
      const lit = readSingle(line, '$displayName = '.length);
      expect(lit.body).toBe(dn);
      expect(lit.close).toBe(line.length - 1);
    }
  });

  it('a line break in displayName is rejected by the guard', () => {
    expect(() => build('New-X', { displayName: "x\n'; calc" })).toThrow(/injection guard/i);
  });
});
