// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { SessionManager, ENGINE_SESSION_MAP } from '../../src/core/SessionManager';
import { ClientConfig } from '../../src/config/ClientConfig';

/**
 * Characterization tests pinning SessionManager's CURRENT behavior ahead of
 * the M1 extraction move (tenant-manager-extraction.md design doc, M0 gate).
 * These tests exercise only the public surface — no source changes were made
 * to enable testing (per the M0 task's constraint). Process-spawning behavior
 * (spawnPersistentProcess/queueCommand/sendCommand) is private and not
 * directly invoked here; PowerShellAdapter.test.ts already establishes that
 * jest.mock('child_process') is unsupported in this ESM/jest setup (CJS
 * auto-mock limitation, documented there) — this suite follows the same
 * constraint and covers what is reachable without spawning a real process:
 * buildConnectCommand's session-type mapping, ENGINE_SESSION_MAP, initial
 * session-state shape, and dry-run behavior of ensureConnected/execute.
 */

function makeConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    tenantSlug: 'test-tenant',
    tenantId: 'tenant-id-123',
    appId: 'app-id-456',
    certPath: '/path/to/cert.pfx',
    certThumbprint: 'THUMBPRINT789',
    domain: 'test.onmicrosoft.us',
    endpoints: {
      graph: 'https://graph.microsoft.us',
      login: 'https://login.microsoftonline.us',
    },
    targetTenantDomain: 'contoso.onmicrosoft.us',
    ...overrides,
  } as ClientConfig;
}

describe('SessionManager', () => {
  describe('ENGINE_SESSION_MAP re-export', () => {
    it('maps engine/CLI aliases onto the six SessionType values', () => {
      expect(ENGINE_SESSION_MAP).toEqual({
        mgraph: 'graph',
        powershell: 'graph',
        exchange: 'exchange',
        ipps: 'purview',
        az: 'azure',
        cli: 'azure',
        spo: 'sharepoint',
        teams: 'teams',
      });
    });
  });

  describe('buildConnectCommand — session-type mapping and env injection', () => {
    let sm: SessionManager;

    beforeEach(() => {
      sm = new SessionManager(makeConfig(), true /* dryRun */);
    });

    it('graph: uses config tenantId/appId/certThumbprint and USGov environment', () => {
      const cmd = sm.buildConnectCommand('graph');
      expect(cmd).toBe(
        'Connect-MgGraph -TenantId "tenant-id-123" -ClientId "app-id-456" -CertificateThumbprint "THUMBPRINT789" -Environment USGov -NoWelcome',
      );
    });

    it('exchange: uses targetTenantDomain as Organization and O365USGovGCCHigh environment', () => {
      const cmd = sm.buildConnectCommand('exchange');
      expect(cmd).toBe(
        'Connect-ExchangeOnline -AppId "app-id-456" -Organization "contoso.onmicrosoft.us" -CertificateThumbprint "THUMBPRINT789" -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false',
      );
    });

    it('purview: hardcodes the compliance ConnectionUri and login.microsoftonline.us auth endpoint', () => {
      const cmd = sm.buildConnectCommand('purview');
      expect(cmd).toContain('Connect-IPPSSession');
      expect(cmd).toContain('-ConnectionUri "https://ps.compliance.protection.office365.us/powershell-liveid/"');
      expect(cmd).toContain('-AzureADAuthorizationEndpointUri "https://login.microsoftonline.us/organizations"');
      expect(cmd).toContain('-Organization "contoso.onmicrosoft.us"');
    });

    it('azure: uses AzureUSGovernment environment and omits -Subscription when no subscriptionId configured', () => {
      const cmd = sm.buildConnectCommand('azure');
      expect(cmd).toBe(
        'Connect-AzAccount -ServicePrincipal -TenantId "tenant-id-123" -ApplicationId "app-id-456" -CertificateThumbprint "THUMBPRINT789" -Environment AzureUSGovernment | Out-Null',
      );
    });

    it('azure: includes -Subscription when subscriptionId is configured', () => {
      const smWithSub = new SessionManager(makeConfig({ subscriptionId: 'sub-abc' }), true);
      const cmd = smWithSub.buildConnectCommand('azure');
      expect(cmd).toContain('-Subscription "sub-abc"');
    });

    it('sharepoint: derives tenantName from targetTenantDomain and uses ITAR region', () => {
      const cmd = sm.buildConnectCommand('sharepoint');
      expect(cmd).toContain('Connect-SPOService -Url "https://contoso-admin.us.sharepoint.us"');
      expect(cmd).toContain('-Region ITAR');
      expect(cmd).toContain('-TenantId "tenant-id-123"');
      expect(cmd).toContain('-CertificateThumbprint "THUMBPRINT789"');
      expect(cmd).toContain('Import-Module Microsoft.Online.SharePoint.PowerShell -DisableNameChecking -WarningAction SilentlyContinue;');
    });

    it('teams: uses TeamsGCCH environment', () => {
      const cmd = sm.buildConnectCommand('teams');
      expect(cmd).toBe(
        'Connect-MicrosoftTeams -TenantId "tenant-id-123" -ApplicationId "app-id-456" -CertificateThumbprint "THUMBPRINT789" -TeamsEnvironmentName TeamsGCCH',
      );
    });

    it('explicit credential overrides win over config values', () => {
      const cmd = sm.buildConnectCommand('graph', 'override-tenant', 'override-app', 'override-thumb');
      expect(cmd).toContain('-TenantId "override-tenant"');
      expect(cmd).toContain('-ClientId "override-app"');
      expect(cmd).toContain('-CertificateThumbprint "override-thumb"');
    });

    it('throws on an unknown session type', () => {
      expect(() => sm.buildConnectCommand('bogus' as any)).toThrow('Unknown session type: bogus');
    });
  });

  describe('initial session state', () => {
    it('initializes all six session types as disconnected with null timestamps', () => {
      const sm = new SessionManager(makeConfig(), true);
      const states = sm.getAllSessionStates();
      const types = states.map(s => s.type).sort();
      expect(types).toEqual(['azure', 'exchange', 'graph', 'purview', 'sharepoint', 'teams']);
      for (const state of states) {
        expect(state.connected).toBe(false);
        expect(state.connectedAt).toBeNull();
        expect(state.lastUsedAt).toBeNull();
        expect(state.tokenExpiresAt).toBeNull();
      }
    });

    it('getSessionState returns a copy, not the live object', () => {
      const sm = new SessionManager(makeConfig(), true);
      const state1 = sm.getSessionState('graph');
      state1.connected = true;
      const state2 = sm.getSessionState('graph');
      expect(state2.connected).toBe(false);
    });
  });

  describe('dry-run mode', () => {
    it('ensureConnected is a no-op in dry-run mode', async () => {
      const sm = new SessionManager(makeConfig(), true);
      await expect(sm.ensureConnected('graph')).resolves.toBeUndefined();
      expect(sm.getSessionState('graph').connected).toBe(false);
    });

    it('execute short-circuits with a dry-run result and does not spawn a process', async () => {
      const sm = new SessionManager(makeConfig(), true);
      const result = await sm.execute('graph', 'Get-MgUser -All');
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.durationMs).toBe(0);
      expect(result.stdout).toContain('[dry-run] Session: graph');
      expect(result.stdout).toContain('Get-MgUser -All');
    });

    it('connectMgGraph and connectIPPS are no-ops in dry-run mode', async () => {
      const sm = new SessionManager(makeConfig(), true);
      await expect(sm.connectMgGraph()).resolves.toBeUndefined();
      await expect(sm.connectIPPS()).resolves.toBeUndefined();
      expect(sm.getSessionState('graph').connected).toBe(false);
      expect(sm.getSessionState('purview').connected).toBe(false);
    });

    it('disconnectAll on a session with no spawned processes resolves cleanly', async () => {
      const sm = new SessionManager(makeConfig(), true);
      await expect(sm.disconnectAll()).resolves.toBeUndefined();
    });
  });
});
