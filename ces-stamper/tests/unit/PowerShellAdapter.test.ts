// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { jest } from '@jest/globals';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { ExeTask, SubCommand } from '../../src/types/schema.types';
// NOTE: jest.mock('child_process') removed — CJS auto-mock not supported in ESM.
// The 'should handle permission errors' test is skipped until we adopt jest.unstable_mockModule.
// spawn import kept only for the skipped test's type cast.
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('PowerShellAdapter', () => {
  let config: StamperConfig;
  let adapter: PowerShellAdapter;

  beforeEach(() => {
    config = StamperConfig.fromTenantConfig({
      tenantId: 'test-tenant',
      appId: 'test-app',
      certThumbprint: 'test-thumbprint',
      certPath: '/path/to/cert',
      targetTenantDomain: 'test.onmicrosoft.us',
      clientName: 'Test Client'
    });
    adapter = new PowerShellAdapter(config);

    // Reset mock
    jest.clearAllMocks();
  });

  describe('getName', () => {
    it('should return adapter name', () => {
      expect(adapter.getName()).toBe('powershell');
    });
  });

  describe('GCC High channel selection (Graph / EXO / IPPS)', () => {
    const conn = (cmd: string): string => (adapter as any).buildGCCHighConnection(cmd);
    const needs = (cmd: string): boolean => (adapter as any).requiresM365Connection({ action: { command: cmd, args: {} } });

    it('injects the Security & Compliance (IPPS) session for Set-Label, not the regular EXO session', () => {
      const script = conn("Set-Label -Identity $l.Guid -EncryptionEnabled $true -ApplyContentMarkingHeaderEnabled $true");
      expect(script).toContain('Connect-IPPSSession');
      expect(script).toContain('ps.compliance.protection.office365.us');
      expect(script).not.toContain('Connect-ExchangeOnline');   // Set-Label is IPPS, not EXO
      expect(script).not.toContain('Connect-MgGraph');           // and not Graph
    });

    it('still injects EXO for transport rules and Graph for -Mg cmdlets', () => {
      expect(conn("New-TransportRule -Name CUI")).toContain('Connect-ExchangeOnline');
      expect(conn("Get-MgUser")).toContain('Connect-MgGraph');
    });

    it('recognizes label/DLP cmdlets as requiring an M365 connection', () => {
      expect(needs("Set-Label -Identity x")).toBe(true);
      expect(needs("Get-DlpCompliancePolicy")).toBe(true);
    });

    it('injects the ARM (Az) connection for Az cmdlets, not Graph', () => {
      const script = conn("$vnet = Get-AzVirtualNetwork -Name v; $vnet | Set-AzVirtualNetwork");
      expect(script).toContain('Connect-AzAccount -ServicePrincipal');
      expect(script).toContain('AzureUSGovernment');
      expect(script).not.toContain('Connect-MgGraph');
      expect(script).not.toContain('Connect-IPPSSession');
    });

    it('does NOT fire the Az channel on an IPPS label command', () => {
      const script = conn("Set-Label -Identity x -EncryptionEnabled $true");
      expect(script).not.toContain('Connect-AzAccount');
    });

    it('recognizes Az cmdlets as requiring a connection', () => {
      expect(needs("New-AzRouteTable -Name rt")).toBe(true);
      expect(needs("Get-AzNetworkSecurityGroup")).toBe(true);
    });

    // STAB-1 M2: teams/sharepoint channels (registry SC.L2-3.13.14.teams-external is a
    // live teams entry; TaskRunner routes 'teams' and 'spo' engines to this adapter).
    it('injects the Teams session for Cs* cmdlets, from connectCommandSource', () => {
      const script = conn("Set-CsExternalAccessPolicy -Identity Global -EnableFederationAccess $false");
      expect(script).toContain('Connect-MicrosoftTeams');
      expect(script).toContain('TeamsGCCH');
      expect(script).not.toContain('Connect-MgGraph');
      expect(script).not.toContain('Connect-SPOService');
    });

    it('injects the SPO session for SPO* cmdlets, from connectCommandSource', () => {
      const script = conn("Set-SPOTenant -LegacyAuthProtocolsEnabled $false");
      expect(script).toContain('Connect-SPOService');
      expect(script).toContain('-admin.us.sharepoint.us');
      expect(script).not.toContain('Connect-MgGraph');
      expect(script).not.toContain('Connect-MicrosoftTeams');
    });

    it('recognizes teams/spo cmdlets as requiring an M365 connection, without Export-Csv false hits', () => {
      expect(needs("Get-CsExternalAccessPolicy -Identity Global")).toBe(true);
      expect(needs("Set-SPOTenant -SharingCapability Disabled")).toBe(true);
      expect(needs("Get-Process | Export-Csv out.csv")).toBe(false);
    });
  });

  describe('PowerShell injection guard (G-ENG-1)', () => {
    const interp = (tpl: string, vars: Record<string, any>): string =>
      (adapter as any).interpolateVariables(tpl, vars);

    it('passes legitimate values through unchanged (UPN, GUID, display name, rights list)', () => {
      expect(interp("/v1.0/users/{upn}", { upn: 'breakglass@vfsgov.us' })).toBe('/v1.0/users/breakglass@vfsgov.us');
      expect(interp("'{name}'", { name: 'CA-02: Block Legacy Authentication' })).toBe("'CA-02: Block Legacy Authentication'");
      expect(interp("'{rights}'", { rights: 'cui-users-sg@vfsgov.us:VIEW,EDIT,PRINT' })).toBe("'cui-users-sg@vfsgov.us:VIEW,EDIT,PRINT'");
      expect(interp("id='{id}'", { id: '10c831ac-959b-4819-9d8f-8db645367550' })).toBe("id='10c831ac-959b-4819-9d8f-8db645367550'");
    });

    it('escapes a single quote by doubling so it cannot break out of a quoted string', () => {
      // O'Brien is a legitimate name; the ' must survive as '' inside the single-quoted context.
      expect(interp("'{name}'", { name: "O'Brien Corp" })).toBe("'O''Brien Corp'");
    });

    it('REJECTS a classic breakout payload (quote + command chaining)', () => {
      expect(() => interp("Remove-MgUser -UserId '{upn}'", { upn: "x'; Remove-Item C:\\ -Recurse; '" }))
        .toThrow(/injection guard/i);
    });

    it('REJECTS subshell, backtick, pipe, redirection, and newline injections', () => {
      expect(() => interp("{x}", { x: '$(rm -rf /)' })).toThrow(/injection guard/i);
      expect(() => interp("{x}", { x: 'a`whoami`' })).toThrow(/injection guard/i);
      expect(() => interp("{x}", { x: 'a | Out-File evil.ps1' })).toThrow(/injection guard/i);
      expect(() => interp("{x}", { x: 'a & calc' })).toThrow(/injection guard/i);
      expect(() => interp("{x}", { x: 'a > C:\\evil' })).toThrow(/injection guard/i);
      expect(() => interp("{x}", { x: 'line1\nRemove-Item' })).toThrow(/injection guard/i);
    });

    it('names the offending parameter in the error', () => {
      expect(() => interp("{policyDisplayName}", { policyDisplayName: 'a;b' }))
        .toThrow(/policyDisplayName/);
    });

    // G-STAMPER-STAB-1 M1: the variable-poisoning fix. Sanitization is placeholder-driven —
    // an entry the template never references must not be able to fail the task.
    it('does NOT throw on an unreferenced array-valued variable (manifest powershell_commands poisoning)', () => {
      const vars = {
        upn: 'admin@vfsgov.us',
        powershell_commands: ["Set-Thing -A 'x'; Set-Other -B 'y'", "Get-Thing | Out-Null"],
      };
      expect(interp("Get-MgUser -UserId '{upn}'", vars)).toBe("Get-MgUser -UserId 'admin@vfsgov.us'");
    });

    it('does NOT throw on unreferenced plan-metadata objects (_drift_policies, _control_directives)', () => {
      const vars = {
        name: 'CUI Policy',
        _drift_policies: [{ control: 'AC.L2-3.1.1', action: 'alert; escalate' }],
        _control_directives: { 'IA.L2-3.5.3': { directive: 'enforce' } },
      };
      expect(interp("New-Policy -Name '{name}'", vars)).toBe("New-Policy -Name 'CUI Policy'");
    });

    it('STILL throws when the template actually substitutes a metacharacter-bearing value (guard intact)', () => {
      const vars = {
        upn: "x'; Remove-Item C:\\ -Recurse; '",
        powershell_commands: ['harmless'],
      };
      expect(() => interp("Get-MgUser -UserId '{upn}'", vars)).toThrow(/injection guard/i);
      // Referencing the array-valued key itself also still guards.
      expect(() => interp("{powershell_commands}", { powershell_commands: ['a;b'] })).toThrow(/injection guard/i);
    });

    it('supports the legacy ${key} form under placeholder gating', () => {
      // eslint-disable-next-line no-template-curly-in-string
      expect(interp("Get-MgUser -UserId '${upn}'", { upn: 'a@b.us', junk: ['x;y'] }))
        .toBe("Get-MgUser -UserId 'a@b.us'");
    });

    // GP-STAMPER-1 M2: registry-grounded pin of the IA.L2-3.5.3 field failure
    // (ces-tester clean-tenant-mfa-baseline, 07-10/11). The real registry
    // set_command carries a PowerShell hashtable literal whose `;` separator is
    // legitimate COMMAND text, not a parameter value; pre-5252d90 the manifest's
    // powershell_commands array leaked into plan variables and non-placeholder-
    // gated sanitization rejected the whole task on that `;`.
    it('the real IA.L2-3.5.3 registry set_command survives interpolation intact under a poisoned-shape variables map', () => {
      const registryPath = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
      const reg = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      const entry = reg.entries.find((e: any) => e.entry_id === 'IA.L2-3.5.3.mfa-authenticator');
      expect(entry).toBeDefined();
      expect(entry.set_command).toContain(";state='enabled'"); // the colliding hashtable literal is still there
      // Manifest-shaped variables: the command itself rides along as an array entry,
      // exactly how the Mission Plan's desired_config used to poison the plan-wide map.
      const vars = {
        tenantId: 'test-tenant',
        powershell_commands: [entry.set_command],
        _control_directives: { 'IA.L2-3.5.3': { directive: 'implement' } },
      };
      const out = interp(entry.set_command, vars);
      expect(out).toBe(entry.set_command); // no placeholder in the template — byte-identical, semicolon preserved
    });
  });

  describe('validate', () => {
    it('should validate task with command', async () => {
      const task: ExeTask = {
        id: 'test-1',
        type: 'configuration',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'powershell',
          command: 'Get-MgUser',
          args: {}
        },
        inputs: [],
        outputs: [],
        controls: [],
        idempotency: 'safe',
        rollback: { strategy: 'none' }
      };

      const result = await adapter.validate(task);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject task without command', async () => {
      const task: ExeTask = {
        id: 'test-2',
        type: 'configuration',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'powershell',
          command: '',
          args: {}
        },
        inputs: [],
        outputs: [],
        controls: [],
        idempotency: 'safe',
        rollback: { strategy: 'none' }
      };

      const result = await adapter.validate(task);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate powershell_commands array', async () => {
      const task: ExeTask = {
        id: 'test-3',
        type: 'configuration',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'powershell',
          command: 'placeholder',
          args: {
            powershell_commands: ['Get-MgUser', 'Get-MgGroup']
          }
        },
        inputs: [],
        outputs: [],
        controls: [],
        idempotency: 'safe',
        rollback: { strategy: 'none' }
      };

      const result = await adapter.validate(task);
      expect(result.valid).toBe(true);
    });

    it('should reject empty powershell_commands array', async () => {
      const task: ExeTask = {
        id: 'test-4',
        type: 'configuration',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'powershell',
          command: 'placeholder',
          args: {
            powershell_commands: []
          }
        },
        inputs: [],
        outputs: [],
        controls: [],
        idempotency: 'safe',
        rollback: { strategy: 'none' }
      };

      const result = await adapter.validate(task);
      expect(result.valid).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute simple task in dry-run mode', async () => {
      const task: ExeTask = {
        id: 'test-5',
        type: 'configuration',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'powershell',
          command: 'Get-MgUser',
          args: {}
        },
        inputs: [],
        outputs: [],
        controls: [],
        idempotency: 'safe',
        rollback: { strategy: 'none' }
      };

      const result = await adapter.execute(task, {}, true);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.output).toContain('DRY RUN');
    });

    it('should execute sub-commands with chaining', async () => {
      const subCommands: SubCommand[] = [
        {
          id: 'sub-1',
          label: 'Create Resource Group',
          set_command: 'New-AzResourceGroup -Name {resourceGroup} -Location {location}',
          get_command: 'Get-AzResourceGroup -Name {resourceGroup}',
          engine: 'powershell',
          sequence_hint: 1,
          idempotency: 'safe',
          variables_required: ['resourceGroup', 'location'],
          variables_runtime: [],
          captures: [
            {
              variable: 'rgId',
              from: 'json_field',
              json_path: '$.ResourceId'
            }
          ],
          on_failure: 'abort_plan',
          evidence_commands: []
        }
      ];

      const task: ExeTask = {
        id: 'test-6',
        type: 'configuration',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'powershell',
          command: 'placeholder',
          args: {
            _sub_commands: subCommands
          }
        },
        inputs: [],
        outputs: [],
        controls: [],
        idempotency: 'safe',
        rollback: { strategy: 'none' }
      };

      const variables = {
        resourceGroup: 'test-rg',
        location: 'usgovvirginia'
      };

      const result = await adapter.execute(task, variables, true);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
    });

    it('should handle manual_only sub-commands in dry-run', async () => {
      const subCommands: SubCommand[] = [
        {
          id: 'sub-manual',
          label: 'Manual Step',
          set_command: '', // Empty command = manual_only
          get_command: '',
          engine: 'manual_gate',
          sequence_hint: 1,
          idempotency: 'safe',
          variables_required: [],
          variables_runtime: [],
          captures: [],
          on_failure: 'warn_continue',
          evidence_commands: []
        }
      ];

      const task: ExeTask = {
        id: 'test-7',
        type: 'policy',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'manual_gate',
          command: 'manual',
          args: {
            _sub_commands: subCommands
          }
        },
        inputs: [],
        outputs: [],
        controls: [],
        idempotency: 'safe',
        rollback: { strategy: 'none' }
      };

      const result = await adapter.execute(task, {}, true);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
    });

    it.skip('should handle permission errors (requires CJS jest.mock — not supported in ESM)', async () => {
      const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
      const mockProcess: any = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callback(1); // Non-zero exit
          }
        })
      };

      mockSpawn.mockReturnValue(mockProcess);

      // Trigger stderr with permission error
      mockProcess.stderr.on.mockImplementation((event: string, callback: any) => {
        if (event === 'data') {
          callback(Buffer.from('Authorization_RequestDenied: Insufficient privileges'));
        }
      });

      const task: ExeTask = {
        id: 'test-8',
        type: 'configuration',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'powershell',
          command: 'Get-MgUser',
          args: {}
        },
        inputs: [],
        outputs: [],
        controls: [],
        idempotency: 'safe',
        rollback: { strategy: 'none' }
      };

      const result = await adapter.execute(task, {}, false);

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Authorization_RequestDenied');
    });
  });

  describe('queryCaptureValues', () => {
    it('should extract captures from get_command output', async () => {
      const executionContext = new ExecutionContext(false);

      const captures = [
        {
          variable: 'userId',
          from: 'json_field' as const,
          json_path: '$.Id'
        }
      ];

      // Mock session execution to return JSON
      const mockSessionManager: any = {
        execute: jest.fn().mockResolvedValue({
          stdout: '{"Id": "user-123", "DisplayName": "Test User"}',
          stderr: '',
          exitCode: 0
        })
      };

      const adapterWithSession = new PowerShellAdapter(config, mockSessionManager, executionContext);
      const result = await adapterWithSession.queryCaptureValues(
        'powershell',
        'Get-MgUser -UserId {userId}',
        captures,
        { userId: 'test-user' },
        false
      );

      expect(result.userId).toBe('user-123');
    });

    it('should return empty captures in dry-run mode', async () => {
      const captures = [
        {
          variable: 'testVar',
          from: 'stdout' as const
        }
      ];

      const result = await adapter.queryCaptureValues(
        'powershell',
        'Get-Something',
        captures,
        {},
        true
      );

      expect(result).toEqual({});
    });

    it('should handle JSON array output by taking first element', async () => {
      const executionContext = new ExecutionContext(false);
      const mockSessionManager: any = {
        execute: jest.fn().mockResolvedValue({
          stdout: '[{"Id": "first-id"}, {"Id": "second-id"}]',
          stderr: '',
          exitCode: 0
        })
      };

      const adapterWithSession = new PowerShellAdapter(config, mockSessionManager, executionContext);
      const captures = [
        {
          variable: 'firstId',
          from: 'json_field' as const,
          json_path: '$.Id'
        }
      ];

      const result = await adapterWithSession.queryCaptureValues(
        'powershell',
        'Get-Items',
        captures,
        {},
        false
      );

      expect(result.firstId).toBe('first-id');
    });

    it('should extract regex captures', async () => {
      const executionContext = new ExecutionContext(false);
      const mockSessionManager: any = {
        execute: jest.fn().mockResolvedValue({
          stdout: 'ResourceId: /subscriptions/abc-123/resourceGroups/test-rg',
          stderr: '',
          exitCode: 0
        })
      };

      const adapterWithSession = new PowerShellAdapter(config, mockSessionManager, executionContext);
      const captures = [
        {
          variable: 'resourceId',
          from: 'regex' as const,
          regex_pattern: 'ResourceId: (.+)'
        }
      ];

      const result = await adapterWithSession.queryCaptureValues(
        'powershell',
        'Get-Resource',
        captures,
        {},
        false
      );

      expect(result.resourceId).toBe('/subscriptions/abc-123/resourceGroups/test-rg');
    });
  });

  describe('discoverSubCommand', () => {
    it('should detect existing resources', async () => {
      const mockSessionManager: any = {
        execute: jest.fn().mockResolvedValue({
          stdout: '{"Name": "test-resource", "Id": "resource-123"}',
          stderr: '',
          exitCode: 0
        })
      };

      const adapterWithSession = new PowerShellAdapter(config, mockSessionManager);
      const result = await adapterWithSession.discoverSubCommand(
        'powershell',
        'Get-AzResource -Name {resourceName}',
        [],
        { resourceName: 'test-resource' },
        false
      );

      expect(result.exists).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('should detect missing resources', async () => {
      const mockSessionManager: any = {
        execute: jest.fn().mockResolvedValue({
          stdout: 'ResourceNotFound: The resource was not found',
          stderr: '',
          exitCode: 0
        })
      };

      const adapterWithSession = new PowerShellAdapter(config, mockSessionManager);
      const result = await adapterWithSession.discoverSubCommand(
        'powershell',
        'Get-AzResource -Name {resourceName}',
        [],
        { resourceName: 'missing-resource' },
        false
      );

      expect(result.exists).toBe(false);
    });

    it('should detect permission errors', async () => {
      const mockSessionManager: any = {
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: 'Authorization_RequestDenied: Insufficient privileges to complete the operation',
          exitCode: 1
        })
      };

      const adapterWithSession = new PowerShellAdapter(config, mockSessionManager);
      const result = await adapterWithSession.discoverSubCommand(
        'powershell',
        'Get-MgUser',
        [],
        {},
        false
      );

      expect(result.exists).toBe(false);
      expect(result.error).toBe('permission_denied');
      expect(result.stderr).toContain('Authorization_RequestDenied');
    });

    it('should return skip indicator in dry-run mode', async () => {
      const result = await adapter.discoverSubCommand(
        'powershell',
        'Get-Something',
        [],
        {},
        true
      );

      expect(result.exists).toBe(false);
      expect(result.rawOutput).toContain('[dry-run]');
    });

    it('should extract captures during discovery', async () => {
      const executionContext = new ExecutionContext(false);
      const mockSessionManager: any = {
        execute: jest.fn().mockResolvedValue({
          stdout: '{"Name": "test-kv", "VaultUri": "https://test-kv.vault.usgovcloudapi.net"}',
          stderr: '',
          exitCode: 0
        })
      };

      const adapterWithSession = new PowerShellAdapter(config, mockSessionManager, executionContext);
      const captures = [
        {
          variable: 'kvUri',
          from: 'json_field' as const,
          json_path: '$.VaultUri'
        }
      ];

      const result = await adapterWithSession.discoverSubCommand(
        'powershell',
        'Get-AzKeyVault -Name {keyVaultName}',
        captures,
        { keyVaultName: 'test-kv' },
        false
      );

      expect(result.exists).toBe(true);
      expect(result.captures.kvUri).toBe('https://test-kv.vault.usgovcloudapi.net');
    });
  });

  describe('sub-command execution', () => {
    it('should execute tasks with sub-commands in dry-run mode', async () => {
      const subCommands: SubCommand[] = [
        {
          id: 'sub-test',
          label: 'Test Sub-Command',
          set_command: 'Set-Something',
          get_command: 'Get-Something',
          engine: 'powershell',
          sequence_hint: 1,
          idempotency: 'safe',
          variables_required: [],
          variables_runtime: [],
          captures: [],
          on_failure: 'warn_continue',
          evidence_commands: []
        }
      ];

      const task: ExeTask = {
        id: 'test-subs',
        type: 'configuration',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'powershell',
          command: 'placeholder',
          args: {
            _sub_commands: subCommands
          }
        },
        inputs: [],
        outputs: [],
        controls: [],
        idempotency: 'safe',
        rollback: { strategy: 'none' }
      };

      const result = await adapter.execute(task, {}, true);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
    });
  });
});
