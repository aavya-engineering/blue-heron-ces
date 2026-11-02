// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-42 (SP-4): the direct-spawn PowerShell path (executePowerShell) gives its child a scrubbed env.
// A real powershell.exe child reports which planted names it can see (names only, never values);
// a non-secret planted name must still reach it (the W4-ST3 stacksim shadow relies on that).

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLANTED: Record<string, string> = {
  CES_AO_AUTH_TOKEN: 'fin42-dummy', CES_STAMPER_AUTH_TOKEN: 'fin42-dummy', CES_EC_PRINCIPAL_SECRET: 'fin42-dummy',
  CES_MUSTER_SECRETS_TOKEN: 'fin42-dummy', JWT_SECRET: 'fin42-dummy', FIN42_KEEP_ME: 'kept',
};

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
}

const onWindows = process.platform === 'win32';

describe('FIN-42 PowerShellAdapter child env scrub', () => {
  (onWindows ? it : it.skip)('a real PowerShell child sees no CES module secret, and still sees other names', async () => {
    const had = new Set(Object.keys(process.env));
    Object.assign(process.env, PLANTED);
    try {
      const adapter = new PowerShellAdapter(makeConfig(), undefined, new ExecutionContext(false));
      const names = Object.keys(PLANTED).map((n) => `'${n}'`).join(',');
      const script = `foreach ($n in @(${names})) { if ([Environment]::GetEnvironmentVariable($n)) { "SEEN:$n" } }`;
      const r = await (adapter as unknown as { executePowerShell(s: string): Promise<{ stdout: string; exitCode: number }> }).executePowerShell(script);
      expect(r.exitCode).toBe(0);
      const seen = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('SEEN:')).map((l) => l.slice(5)).sort();
      expect(seen).toEqual(['FIN42_KEEP_ME']);
      expect(r.stdout).not.toContain('fin42-dummy');
      expect(process.env.CES_AO_AUTH_TOKEN).toBe('fin42-dummy'); // the parent env is not mutated
    } finally {
      for (const k of Object.keys(PLANTED)) if (!had.has(k)) delete process.env[k];
    }
  }, 60_000);

  it('the source spawns with env: scrubEnv(process.env) (text pin; keeps CRLF)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/adapters/PowerShellAdapter.ts'), 'utf8');
    expect(src).toContain("import { scrubEnv } from 'ces-shared/secrets';");
    expect(src).toContain('], { env: scrubEnv(process.env) });');
    expect(src).not.toContain('], { env: process.env });');
    expect(src.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('the Stamper CLI entry loads the module-secret store before any command (text pin)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/cli/index.ts'), 'utf8');
    expect(src).toContain("import { initModuleSecrets } from 'ces-shared/secrets';");
    const init = src.indexOf('\ninitModuleSecrets();\n');
    expect(init).toBeGreaterThan(-1);
    expect(init).toBeLessThan(src.indexOf('program.parse(process.argv);'));
  });
});
