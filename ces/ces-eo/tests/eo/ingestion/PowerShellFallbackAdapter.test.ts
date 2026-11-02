// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * P-7: the three Purview reads connect with Connect-IPPSSession (GCC High Security & Compliance
 * endpoint, app-only certificate); the three Exchange reads stay on Connect-ExchangeOnline.
 * The spawn is stubbed, so only the command strings are checked.
 */
import { PowerShellFallbackAdapter } from '../../../src/eo/ingestion/PowerShellFallbackAdapter';

const tc = { certThumbprint: 'THUMB123', appId: 'app-guid-1', domain: 'contoso.onmicrosoft.us' } as any;

function capture(adapter: PowerShellFallbackAdapter): string[] {
  const cmds: string[] = [];
  jest.spyOn(adapter as any, 'runPwsh').mockImplementation(async (...args: unknown[]) => {
    cmds.push(String(args[0]));
    return '[]';
  });
  return cmds;
}

describe('PowerShellFallbackAdapter connect commands (P-7)', () => {
  it('Purview reads use Connect-IPPSSession with the GCC High URIs and app-only certificate', async () => {
    const adapter = new PowerShellFallbackAdapter(tc);
    const cmds = capture(adapter);
    const signals = await adapter.runPurviewCommands();

    expect(signals.map((s) => s.signalId)).toEqual(['retentionPolicies', 'ediscoveryCases', 'protectionAlerts']);
    expect(cmds).toHaveLength(3);
    const prefix =
      "Connect-IPPSSession -CertificateThumbprint 'THUMB123' -AppId 'app-guid-1' -Organization 'contoso.onmicrosoft.us'" +
      ' -ConnectionUri https://ps.compliance.protection.office365.us/powershell-liveid/' +
      ' -AzureADAuthorizationEndpointUri https://login.microsoftonline.us/organizations -ShowBanner:$false; ';
    for (const c of cmds) {
      expect(c.startsWith(prefix)).toBe(true);
      expect(c).not.toContain('Connect-ExchangeOnline');
      expect(c).not.toContain('-ExchangeEnvironmentName');
    }
    expect(cmds[0]).toContain('Get-RetentionCompliancePolicy');
    expect(cmds[1]).toContain('Get-ComplianceCase');
    expect(cmds[2]).toContain('Get-ProtectionAlert');
  });

  it('Exchange reads stay on Connect-ExchangeOnline (GCC High environment)', async () => {
    const adapter = new PowerShellFallbackAdapter(tc);
    const cmds = capture(adapter);
    const signals = await adapter.runExchangeCommands();

    expect(signals.map((s) => s.signalId)).toEqual(['transportRules', 'mailboxAudit', 'adminAuditLogConfig']);
    const prefix =
      "Connect-ExchangeOnline -CertificateThumbprint 'THUMB123' -AppId 'app-guid-1' -Organization 'contoso.onmicrosoft.us'" +
      ' -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false; ';
    for (const c of cmds) {
      expect(c.startsWith(prefix)).toBe(true);
      expect(c).not.toContain('Connect-IPPSSession');
    }
    expect(cmds[0]).toContain('Get-TransportRule');
    expect(cmds[1]).toContain('Get-OrganizationConfig');
    expect(cmds[2]).toContain('Get-AdminAuditLogConfig');
  });
});
