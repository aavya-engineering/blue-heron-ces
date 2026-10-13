// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 Slice 2B — the `simstack-destroy` judge (D.2) against injected seams.
 *
 * The four contract clauses: the slug leaves `listByKind('sim')` (SD1), a second
 * teardown is a no-op (SD2), a LIVE slug is refused (SD3), and the run evidence
 * survives (SD4). A real sim record is authored into a temp registry root before
 * the act, so the teardown has something to remove.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runActGroup, type ActRunArgs, type ActRunDeps } from '../src/demo/acts/act-run.js';
import { actGroup } from '../src/demo/acts/act-roster.js';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { ArmedSim } from '../src/demo/show/arm-sim.js';
import type { UiPage, UiSession } from '../src/demo/ui-page.js';
import { simstackRegistryRoot } from '../src/demo/show/ops/simstack-create-op.js';
import { createTenantRegistry, createEphemeralSimTenant, listSimTenants } from '../src/tenant-registry/index.js';

const testerRoot = path.resolve(__dirname, '..');
const SLUG = 'demo-dib-small';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acts-sd-'));
}
function fakePane(): AppPane {
  const page = new Proxy({} as UiPage, { get: () => async () => undefined });
  const session = new Proxy({} as UiSession, { get: () => async () => undefined });
  return { page, session, goto: async () => undefined, close: async () => undefined };
}
function argsFor(runDir: string): ActRunArgs {
  return {
    testerRoot,
    stacksimRoot: path.join(testerRoot, '..', 'tenant-stacksim'),
    aoRoot: path.join(testerRoot, '..', 'ces-ao'),
    eoRoot: path.join(testerRoot, '..', 'ces-eo'),
    stamperRoot: path.join(testerRoot, '..', 'ces-stamper'),
    musterRoot: path.join(testerRoot, '..', 'ces-muster'),
    runId: path.basename(runDir),
  };
}
function fakeArm(runDir: string): ActRunDeps['arm'] {
  return async (): Promise<ArmedSim> => ({
    slug: SLUG,
    simUrl: 'http://127.0.0.1:4390',
    runDir,
    stop: async () => undefined,
  });
}

/** Author a real sim registry record (what arming does), plus a marker evidence file. */
async function seedRegistryAndEvidence(runDir: string): Promise<void> {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'stacksim-serve.log'), 'arming evidence');
  const registry = createTenantRegistry({ registryRoot: simstackRegistryRoot(runDir) });
  await createEphemeralSimTenant(registry, SLUG, { stance: 'm365_azure' });
}

describe('runActGroup — simstack-destroy (D.2)', () => {
  it('passes SD1/SD2/SD3/SD4: removes the record, idempotent, refuses live, keeps evidence', async () => {
    const runDir = tempDir();
    await seedRegistryAndEvidence(runDir);
    // Precondition sanity: the record is really there before the act.
    const before = await listSimTenants(createTenantRegistry({ registryRoot: simstackRegistryRoot(runDir) }));
    expect(before.some((r) => r.tenantSlug === SLUG)).toBe(true);

    const report = await runActGroup(actGroup('simstack-destroy')!, argsFor(runDir), () => undefined, {
      openPane: async () => fakePane(),
      arm: fakeArm(runDir),
      probe: async () => 'free',
      fileExists: (p) => fs.existsSync(p),
    });

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    for (const id of ['SD1', 'SD2', 'SD3', 'SD4', 'ARM1', 'TD1']) {
      expect(byId[id]?.status, `${id}: ${byId[id]?.detail}`).toBe('pass');
    }
    expect(String(byId.SD3.evidence?.error)).toContain('refusing to tear down');
    expect(Number(byId.SD4.evidence?.runDirEntries)).toBeGreaterThan(0);
    // The evidence really did survive on disk.
    expect(fs.existsSync(path.join(runDir, 'stacksim-serve.log'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'simstack-destroy.json'))).toBe(true);
    expect(report.status).toBe('pass');
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});
