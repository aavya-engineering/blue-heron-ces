// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution): proves the resolved secret value
// reaches the command at execution only — the fake session/engine boundary — never the string
// returned for streaming/evidence/logs, and that an unresolved sentinel blocks the task instead
// of running with a blank or literal-sentinel value.
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

describe('PowerShellAdapter — secret overlay (FC-ST-3 step 2)', () => {
  it('leaves a command with no sentinel completely unchanged', () => {
    const adapter = new PowerShellAdapter(makeConfig());
    adapter.setSecretOverlay({ initialPassword: 'Real-Secret-Value!' });
    const command = 'Get-MgUser -UserId someone@contoso.us';
    expect((adapter as any).applySecretOverlay(command)).toBe(command);
  });

  it('swaps the sentinel for the real value when the overlay has it', () => {
    const adapter = new PowerShellAdapter(makeConfig());
    adapter.setSecretOverlay({ initialPassword: 'Real-Secret-Value!' });
    const command = `Set-MgUser -PasswordProfile @{Password='${secretSentinel('initialPassword')}'}`;
    const resolved = (adapter as any).applySecretOverlay(command);
    expect(resolved).toBe("Set-MgUser -PasswordProfile @{Password='Real-Secret-Value!'}");
    expect(resolved).not.toContain('CES_SECRET');
  });

  it('throws SecretResolutionError — never runs with the literal sentinel or a blank value — when the overlay is missing the variable', () => {
    const adapter = new PowerShellAdapter(makeConfig());
    // No setSecretOverlay() call at all — the common "operator never supplied it" case.
    const command = `Set-MgUser -PasswordProfile @{Password='${secretSentinel('initialPassword')}'}`;
    expect(() => (adapter as any).applySecretOverlay(command)).toThrow(SecretResolutionError);
    try {
      (adapter as any).applySecretOverlay(command);
    } catch (err) {
      expect((err as SecretResolutionError).variable).toBe('initialPassword');
      expect((err as SecretResolutionError).message).toContain('initialPassword');
      expect((err as SecretResolutionError).message).toContain('Configure time');
    }
  });

  it('setSecretOverlay replaces any previous overlay outright (no silent merge with a stale one)', () => {
    const adapter = new PowerShellAdapter(makeConfig());
    adapter.setSecretOverlay({ initialPassword: 'first' });
    adapter.setSecretOverlay({ touAdminSecret: 'second' });
    const command = `X ${secretSentinel('initialPassword')}`;
    expect(() => (adapter as any).applySecretOverlay(command)).toThrow(SecretResolutionError);
  });

  describe('executeViaSession — the real command the engine/spawn boundary receives', () => {
    it('the fake session receives the RESOLVED command (real secret); the caller\'s own copy of the resolved-template string never changes', async () => {
      const received: { engine: string; command: string }[] = [];
      const fakeSessionManager = {
        execute: async (sessionType: string, command: string, _onStdout?: (c: string) => void) => {
          received.push({ engine: sessionType, command });
          return { stdout: 'ok', stderr: '', exitCode: 0 };
        },
      };
      const adapter = new PowerShellAdapter(makeConfig(), fakeSessionManager as any);
      adapter.setSecretOverlay({ initialPassword: 'Real-Secret-Value!' });

      // This is exactly the shape PowerShellAdapter's own resolveCommand() produces: the resolved
      // command template, still carrying the sentinel (never the real value) because the secret
      // variable is deliberately never loaded as a plain value into ExecutionContext or the
      // variables record — see PlanTranslator's applySecretReferences().
      const resolvedCommandForDisplay = `Set-MgUser -PasswordProfile @{Password='${secretSentinel('initialPassword')}'}`;

      const result = await (adapter as any).executeViaSession('mgraph', resolvedCommandForDisplay, false);

      expect(result.exitCode).toBe(0);
      expect(received).toHaveLength(1);
      expect(received[0].command).toContain('Real-Secret-Value!');
      expect(received[0].command).not.toContain('CES_SECRET');

      // The string the caller already had (what a stream event / evidence record would carry)
      // is a separate local variable in this test and is untouched by the call — proving
      // executeViaSession's substitution is a local, execution-only transformation, not a mutation
      // of shared state that could leak back into logs.
      expect(resolvedCommandForDisplay).toContain('<<CES_SECRET:initialPassword>>');
      expect(resolvedCommandForDisplay).not.toContain('Real-Secret-Value!');
    });

    it('blocks the task (throws, never spawns) when the sentinel cannot be resolved', async () => {
      const received: string[] = [];
      const fakeSessionManager = {
        execute: async (_sessionType: string, command: string) => {
          received.push(command);
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      };
      const adapter = new PowerShellAdapter(makeConfig(), fakeSessionManager as any);
      // No overlay set.
      const command = `Set-MgUser -PasswordProfile @{Password='${secretSentinel('initialPassword')}'}`;

      await expect((adapter as any).executeViaSession('mgraph', command, false)).rejects.toThrow(SecretResolutionError);
      expect(received).toHaveLength(0);
    });
  });
});
