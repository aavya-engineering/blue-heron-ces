// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-02: the CLI execute paths get a tenant slug and (live runs) an ExecutionContext loaded
// like the server's: plan variables over VARIABLE_DEFAULTS.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCliExecutionInputs, loadPlanVariablesIntoContext } from '../../src/cli/cliExecutionContext';
import { VARIABLE_DEFAULTS } from '../../src/shared/variable-map';

describe('FX-02 CLI execution inputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx02-cli-'));
  const planPath = path.join(dir, 'plan.json');
  const savedSlug = process.env.TENANT_SLUG;

  beforeAll(() => {
    delete process.env.TENANT_SLUG;
    fs.writeFileSync(planPath, JSON.stringify({
      plan_id: 'p1',
      ces: { tenantSlug: 'plan-tenant-fx02' },
      variables: { cuiGroupName: 'CUI-Users' },
    }));
  });
  afterAll(() => {
    if (savedSlug !== undefined) process.env.TENANT_SLUG = savedSlug;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('takes the slug from --tenant, else from the plan', async () => {
    expect((await buildCliExecutionInputs(planPath, 'cli-tenant-fx02', true)).tenantSlug).toBe('cli-tenant-fx02');
    expect((await buildCliExecutionInputs(planPath, undefined, true)).tenantSlug).toBe('plan-tenant-fx02');
  });

  it('builds no context for a dry run (server parity)', async () => {
    expect((await buildCliExecutionInputs(planPath, undefined, true)).executionContext).toBeUndefined();
  });

  it('builds a context for a live run and loads plan variables over VARIABLE_DEFAULTS', async () => {
    const inputs = await buildCliExecutionInputs(planPath, undefined, false);
    expect(inputs.executionContext).toBeDefined();
    // No tenant record for this slug: a warning, not a stop.
    expect(inputs.warnings.length).toBeGreaterThan(0);
    loadPlanVariablesIntoContext(inputs.executionContext, { cuiGroupName: 'CUI-Users' });
    const defaultKey = Object.keys(VARIABLE_DEFAULTS)[0];
    expect(inputs.executionContext!.hasVariable(defaultKey)).toBe(true);
    expect(inputs.executionContext!.resolve('Get-MgGroup -Filter "{cuiGroupName}"', ['cuiGroupName'], [])).toBe('Get-MgGroup -Filter "CUI-Users"');
    // A missing required value now stops the task instead of running with the literal token.
    expect(() => inputs.executionContext!.resolve("'{operatorUPN}'", ['operatorUPN'], [])).toThrow('Unresolved manifest variables');
  });
});
