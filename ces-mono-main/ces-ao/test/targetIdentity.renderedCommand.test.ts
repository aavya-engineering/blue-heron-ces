// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AO-04 (2026-09-27, FC-AO): rendered-command identity test for A-03.
//
// VERIFY-ao.md's AO-04 gap: nothing pins that AO's *interpolated command text* carries
// the requested UPN. `test/targetIdentity.contract13.test.ts` proves the evidence row's
// `targetUPN` field is correct, but it mocks the PowerShell boundary entirely, so it
// never renders the actual get_command/set_command strings that would be sent to the
// tenant. TemplateRegistry.ts:294/299 use `{targetUPN}` (not a hardcoded UPN) — this test
// pins that fact independently of the (currently broken) sim, by rendering A-03's real
// templates through the production parameter mapper + the production adapter's
// interpolation, for two different UPNs, and asserting each rendered command contains
// only its own UPN.
//
// Production code exercised (no mocks): mapAoParametersToVariables (ParameterMapper.ts),
// getCommandTemplates('A-03') (TemplateRegistry.ts), and PowerShellAdapter's private
// interpolateVariables (ces-stamper/adapters/powershell) — the same interpolation the
// executor actually uses (CommandExecutor.ts -> PowerShellAdapter.execute -> this method).

import { describe, it, expect } from 'vitest';
import type { TenantConfig } from 'ces-shared/config';
import { mapAoParametersToVariables } from '../src/execution/ParameterMapper.js';
import { getCommandTemplates } from '../src/registry/TemplateRegistry.js';
import { getCommand } from '../src/execution/invokeCommand.js';
import { PowerShellAdapter } from 'ces-stamper/adapters/powershell';

const A_03 = getCommand('A-03')!;
const TEMPLATES = getCommandTemplates('A-03')!;

function makeTenant(): TenantConfig {
  return {
    tenantSlug: 'a03-identity-test',
    tenantId: 'a03-identity-tid',
    appId: 'app-id',
    certPath: '/dev/null',
    certThumbprint: 'AABB000000000000000000000000000000000000',
    domain: 'a03-identity-test.onmicrosoft.us',
    kind: 'sim',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'sub-1',
    resources: {},
  } as TenantConfig;
}

// Any object with the interpolateVariables shape works; the method is pure (template +
// variables in, string out) and does not touch config/session, so a minimal fake config
// is sufficient. Accessed via `as any` the same way ces-stamper's own unit test does
// (tests/unit/PowerShellAdapter.test.ts:109) since it is intentionally private.
const adapter = new PowerShellAdapter({} as any) as any;

function render(template: string, vars: Record<string, string>): string {
  return adapter.interpolateVariables(template, vars);
}

describe('AO-04: A-03 rendered command carries the requested UPN, not a fixed one', () => {
  it('is missing neither template (guards against a future registry/template drift)', () => {
    expect(A_03).toBeDefined();
    expect(A_03.id).toBe('A-03');
    expect(TEMPLATES.get_command).toContain('{targetUPN}');
    expect(TEMPLATES.set_command).toContain('{targetUPN}');
  });

  it('renders get_command and set_command with UPN-A, containing UPN-A only', () => {
    const upnA = 'alice.leaver@a03-identity-test.onmicrosoft.us';
    const upnB = 'bob.other@a03-identity-test.onmicrosoft.us';
    const vars = mapAoParametersToVariables(
      A_03,
      makeTenant(),
      { targetUPN: upnA, reason: 'Permanent termination — approved by HR' },
    );

    const renderedGet = render(TEMPLATES.get_command, vars);
    const renderedSet = render(TEMPLATES.set_command, vars);

    expect(renderedGet).toContain(upnA);
    expect(renderedGet).not.toContain(upnB);
    expect(renderedSet).toContain(upnA);
    expect(renderedSet).not.toContain(upnB);
    // The construction reason from VERIFY-ao.md: Remove-MgUser must target -UserId with
    // the interpolated UPN, not a different field.
    expect(renderedSet).toBe(`Remove-MgUser -UserId '${upnA}' -ErrorAction Stop`);
  });

  it('renders get_command and set_command with UPN-B, containing UPN-B only (proves the value is not fixed)', () => {
    const upnA = 'alice.leaver@a03-identity-test.onmicrosoft.us';
    const upnB = 'bob.other@a03-identity-test.onmicrosoft.us';
    const vars = mapAoParametersToVariables(
      A_03,
      makeTenant(),
      { targetUPN: upnB, reason: 'Voluntary resignation' },
    );

    const renderedGet = render(TEMPLATES.get_command, vars);
    const renderedSet = render(TEMPLATES.set_command, vars);

    expect(renderedGet).toContain(upnB);
    expect(renderedGet).not.toContain(upnA);
    expect(renderedSet).toContain(upnB);
    expect(renderedSet).not.toContain(upnA);
    expect(renderedSet).toBe(`Remove-MgUser -UserId '${upnB}' -ErrorAction Stop`);
  });

  // Fail-first proof (recorded, not executed as part of the suite): pointing the
  // set_command template at a literal, fixed UPN instead of `{targetUPN}` --
  //   "Remove-MgUser -UserId 'fixed@a03-identity-test.onmicrosoft.us' -ErrorAction Stop"
  // -- makes the second test above fail both the `.toContain(upnB)` and the exact-string
  // assertion, while leaving the first test passing (upnA happens to differ from the
  // fixed literal). That asymmetry is exactly the bug this test is designed to catch:
  // a template that silently always targets the same account regardless of the request.
});
