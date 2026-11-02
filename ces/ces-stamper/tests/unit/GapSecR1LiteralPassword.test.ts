// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-20 / SP-1 (R1, SECRETS-PLAN.md): no route turns a tenant record's `resources.initial_password`
// into `variables.initialPassword`. The record refusal itself (a live record with a literal is
// refused) is ces-shared's loader, tested in ces-shared/src/config/TenantConfig.test.ts. Here the
// record is a SIM record (tenant-stacksim's labelled fake is still allowed there), so the routes see
// a literal and must still not map it.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import { SECRET_VARIABLE_NAMES } from 'ces-shared/types/mission-plan';
import { loadTenantConfig } from 'ces-shared/config';
import { VARIABLE_MAPPING, REVERSE_MAPPING, SECRET_REFERENCE_FIELDS } from '../../src/shared/variable-map';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', '..', 'src');

const SIM_LITERAL = 'Sim-Only-Fin20-Literal-NOT-A-SECRET';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin20-r1-'));
const SLUG = 'fin20r1';
const recordPath = path.join(tmp, `${SLUG}.json`);
fs.writeFileSync(
  recordPath,
  JSON.stringify({
    client: { slug: SLUG, name: 'FIN-20 R1 sim' },
    tenant: { tenant_id: 'sim-tenant-fin20', domain: 'fin20.simtenant.onmicrosoft.us', environment: 'gcc-high-sim' },
    auth: { app_id: 'sim-app', cert_path: path.join(tmp, 'none.pfx'), cert_thumbprint: 'SIMTHUMB' },
    resources: { initial_password: SIM_LITERAL, admin_username: 'sim.user1', wifi_ssid: 'SIM-CUI-WLAN' },
  }),
);

jest.unstable_mockModule('../../src/config/ClientConfig', () => ({
  loadClientConfigFromTenantJson: loadTenantConfig,
  resolveTenantJsonPath: async () => recordPath,
  loadClientConfig: () => {
    throw new Error('not used in this test');
  },
}));

/** Call one route handler directly (no listening server). */
async function callRoute(router: any, method: string, routePath: string, req: any): Promise<{ status: number; body: any }> {
  const layer = router.stack.find((l: any) => l.route?.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${routePath} not found`);
  let status = 200;
  let body: any;
  const res: any = {
    status(s: number) { status = s; return res; },
    json(b: any) { body = b; return res; },
  };
  for (const h of layer.route.stack) await h.handle(req, res, () => undefined);
  return { status, body };
}

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('SP-1 variable-map: a secret-class variable is never a record-mapped variable', () => {
  it('VARIABLE_MAPPING holds no SECRET_VARIABLE_NAMES key, so no gap-fill loop copies one', () => {
    for (const name of SECRET_VARIABLE_NAMES) expect(Object.keys(VARIABLE_MAPPING)).not.toContain(name);
  });

  it('no record field maps back to initialPassword', () => {
    expect(Object.values(VARIABLE_MAPPING)).not.toContain('initial_password');
    expect(REVERSE_MAPPING['initial_password']).toBeUndefined();
    expect(Object.values(VARIABLE_MAPPING)).not.toContain('initial_password_ref');
  });

  it('the reference-only field is declared separately', () => {
    expect(SECRET_REFERENCE_FIELDS).toEqual({ initialPassword: 'initial_password_ref' });
    expect(Object.isFrozen(SECRET_REFERENCE_FIELDS)).toBe(true);
  });
});

describe('SP-1 routes: no route produces variables.initialPassword from a record', () => {
  it('the source of both routes has no initial_password -> initialPassword mapping', () => {
    for (const f of ['server/routes/registry.routes.ts', 'server/routes/tenant.routes.ts']) {
      const code = fs.readFileSync(path.join(SRC, f), 'utf8');
      expect(code).not.toMatch(/initialPassword\s*[:=]\s*r\.initial_password/);
      expect(code).not.toMatch(/r\.initial_password\b(?!_ref)/);
    }
  });

  it('POST /api/registry/resolve leaves {initialPassword} unresolved for a record carrying a literal', async () => {
    const { createRegistryRouter } = await import('../../src/server/routes/registry.routes');
    const router = createRegistryRouter(() => [], () => [], () => undefined);
    const { status, body } = await callRoute(router, 'post', '/api/registry/resolve', {
      body: { tenant: SLUG, command: 'New-User -Name {adminUserName} -Password {initialPassword} -Ssid {wifiSsid}' },
    });
    expect(status).toBe(200);
    expect(body.resolved).not.toContain(SIM_LITERAL);
    expect(body.resolved).toContain('{initialPassword}');
    expect(body.unresolved).toContain('initialPassword');
    // the ordinary resource variables still resolve
    expect(body.resolved).toContain('sim.user1');
    expect(body.resolved).toContain('SIM-CUI-WLAN');
  });

  it('GET /api/tenants/:slug migration writes no initialPassword into variables.json', async () => {
    const { createTenantRouter } = await import('../../src/server/routes/tenant.routes');
    const { getTenantVariablesPath } = await import('../../src/server/routes/tenantVariablesPath');
    const router = createTenantRouter();
    const { status } = await callRoute(router, 'get', '/api/tenants/:slug', { params: { slug: SLUG } });
    expect(status).toBe(200);
    const varsPath = getTenantVariablesPath(SLUG);
    expect(fs.existsSync(varsPath)).toBe(true);
    const text = fs.readFileSync(varsPath, 'utf8');
    const vars = JSON.parse(text);
    expect(vars.initialPassword).toBeUndefined();
    expect(text).not.toContain(SIM_LITERAL);
    expect(vars.adminUserName).toBe('sim.user1');
  });
});
