// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — prep-phase arming, against injected process seams.
 *
 * Everything asserted here fails SILENTLY in production and never in a code
 * review, which is the whole reason `ArmSimDeps` exists:
 *
 * 1. **Port conditionality.** Probing a port the deck has no use for turns
 *    somebody else's unrelated server into a refusal to start; starting a server
 *    no slide will drive costs the operator prep time for nothing.
 * 2. **The run-scoped `STORAGE_ROOT`.** `GuiChildEnvOptions.storageRoot` is
 *    OPTIONAL, so omitting it is not a compile error — and a Stamper GUI without
 *    it writes execution reports to the default root, silently contaminating the
 *    artifact `stamper-execute` judges.
 * 3. **Teardown ORDER.** Consumers must die before the sim they talk to. A wrong
 *    order leaves a listener behind, and the next run — usually in front of the
 *    same customer — silently drives the wrong tenant (`preflight.ts`'s header
 *    records exactly that).
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { armSim, STACKSIM_PORT, SHOW_SLUG, type ArmSimDeps, type ArmSimOptions } from '../src/demo/show/arm-sim.js';
import type { ShowRunOptions } from '../src/demo/show/show-run.js';
import { STAMPER_GUI_PORT, AO_GUI_PORT } from '../src/demo/gui-servers.js';
import { EO_PORT } from '../src/demo/show/arm-eo.js';

/** `armSim` really does mkdir its run dir, so give it a throwaway tester root. */
function optionsIn(testerRoot: string): ShowRunOptions {
  return {
    deckPath: 'demos/t.xlsx',
    slidesPort: 4500,
    defaultDwellSec: 30,
    auto: true,
    presenter: true,
    slidesGeometry: { width: 1280, height: 720, x: 0, y: 0 },
    appGeometry: { width: 620, height: 1000, x: 1290, y: 0 },
    testerRoot,
    stacksimRoot: 'C:/ces/tenant-stacksim',
    aoRoot: 'C:/ces/ces-ao',
    eoRoot: 'C:/ces/ces-eo',
    stamperRoot: 'C:/ces/ces-stamper',
    musterRoot: 'C:/ces/ces-muster',
  };
}

interface Recorded {
  readonly probed: number[];
  readonly started: string[];
  readonly stopped: string[];
  readonly guiEnv: Record<string, NodeJS.ProcessEnv>;
  readonly deps: ArmSimDeps;
}

function recordingDeps(): Recorded {
  const probed: number[] = [];
  const started: string[] = [];
  const stopped: string[] = [];
  const guiEnv: Record<string, NodeJS.ProcessEnv> = {};

  const handle = (name: string, port: number) => ({
    kind: name as 'stamper' | 'ao',
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    process: {} as never,
    stop: async () => void stopped.push(name),
  });

  return {
    probed,
    started,
    stopped,
    guiEnv,
    deps: {
      probePort: async (port: number) => {
        probed.push(port);
        return 'free' as const;
      },
      resetDemoDibSmallTenant: async () => undefined as never,
      startServe: (async () => {
        started.push('serve');
        return { stop: async () => void stopped.push('serve') };
      }) as unknown as ArmSimDeps['startServe'],
      waitUntilReady: (async () => undefined) as unknown as ArmSimDeps['waitUntilReady'],
      createTenantRegistry: (() => ({})) as unknown as ArmSimDeps['createTenantRegistry'],
      createEphemeralSimTenant: (async () => undefined) as unknown as ArmSimDeps['createEphemeralSimTenant'],
      getSimLaunchEnv: (async () => ({
        psModulePath: 'C:\\sim\\psmodules',
        path: 'C:\\sim\\azshim;C:\\Windows',
        stacksimServerUrl: 'http://127.0.0.1:4390',
      })) as unknown as ArmSimDeps['getSimLaunchEnv'],
      ensureSimCert: (async () => ({
        thumbprint: 'AA11',
        pfxPath: 'C:/tmp/sim.pfx',
        route: 'reused',
      })) as unknown as ArmSimDeps['ensureSimCert'],
      authorSimTenantRecord: (async () => undefined) as unknown as ArmSimDeps['authorSimTenantRecord'],
      resolvePsHomeModules: (async () => 'C:/PSHOME/Modules') as unknown as ArmSimDeps['resolvePsHomeModules'],
      startAoGui: (async (opts: { env: NodeJS.ProcessEnv; port?: number }) => {
        started.push('ao');
        guiEnv.ao = opts.env;
        return handle('ao', opts.port ?? AO_GUI_PORT);
      }) as unknown as ArmSimDeps['startAoGui'],
      startStamperGui: (async (opts: { env: NodeJS.ProcessEnv; port?: number }) => {
        started.push('stamper');
        guiEnv.stamper = opts.env;
        return handle('stamper', opts.port ?? STAMPER_GUI_PORT);
      }) as unknown as ArmSimDeps['startStamperGui'],
      startShowEoServer: (async (opts: { port?: number }) => {
        started.push('eo');
        return { baseUrl: `http://127.0.0.1:${opts.port ?? EO_PORT}`, stop: async () => void stopped.push('eo') };
      }) as unknown as ArmSimDeps['startShowEoServer'],
    },
  };
}

/** Arm into a throwaway tester root, then always clean it up. */
async function arming(opts: ArmSimOptions, fn: (r: Recorded, armed: Awaited<ReturnType<typeof armSim>>) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-arm-sim-'));
  try {
    const r = recordingDeps();
    const armed = await armSim(optionsIn(root), () => undefined, { runId: 'test', ...opts }, r.deps);
    await fn(r, armed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('armSim port conditionality', () => {
  it('probes and starts :3000 ONLY when a stamper op is driven', async () => {
    await arming({ withAoGui: false, withEo: false, withStamperGui: false }, async (r) => {
      expect(r.probed).toEqual([STACKSIM_PORT]);
      expect(r.started).toEqual(['serve']);
    });

    await arming({ withAoGui: false, withEo: false, withStamperGui: true }, async (r, armed) => {
      expect(r.probed).toEqual([STACKSIM_PORT, STAMPER_GUI_PORT]);
      expect(r.started).toEqual(['serve', 'stamper']);
      expect(armed.stamperBaseUrl).toBe(`http://127.0.0.1:${STAMPER_GUI_PORT}`);
    });
  });

  it('leaves stamperBaseUrl undefined when the GUI was not armed', async () => {
    await arming({ withAoGui: true, withEo: false }, async (_r, armed) => {
      expect(armed.stamperBaseUrl).toBeUndefined();
      expect(armed.aoBaseUrl).toBe(`http://127.0.0.1:${AO_GUI_PORT}`);
    });
  });

  it('defaults the stamper GUI OFF, so callers that predate it arm the same set', async () => {
    await arming({}, async (r) => {
      expect(r.started).toEqual(['serve', 'ao', 'eo']);
      expect(r.probed).not.toContain(STAMPER_GUI_PORT);
    });
  });

  it('honours an overridden stamper GUI port', async () => {
    await arming({ withAoGui: false, withEo: false, withStamperGui: true, stamperGuiPort: 3100 }, async (r, armed) => {
      expect(r.probed).toContain(3100);
      expect(armed.stamperBaseUrl).toBe('http://127.0.0.1:3100');
    });
  });
});

describe('the Stamper GUI child env', () => {
  it('gets a RUN-SCOPED STORAGE_ROOT — the silent-contamination guard', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-arm-sim-'));
    try {
      const r = recordingDeps();
      await armSim(optionsIn(root), () => undefined, { runId: 'r1', withAoGui: false, withEo: false, withStamperGui: true }, r.deps);
      const expected = path.join(root, 'runs', 'show', 'r1', 'stamper-storage');
      expect(r.guiEnv.stamper.STORAGE_ROOT).toBe(expected);
      // Run-scoped means it moves with the run id, not a fixed default root.
      expect(r.guiEnv.stamper.STORAGE_ROOT).toContain('r1');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('shares the AO GUI\'s pipelineRoot — Stamper plan-data lives there, not in eo-pipeline', async () => {
    await arming({ withAoGui: true, withEo: false, withStamperGui: true }, async (r) => {
      expect(r.guiEnv.stamper.CES_PIPELINE_ROOT).toBe(r.guiEnv.ao.CES_PIPELINE_ROOT);
      // One scope pointer per database (REQ-EO-ASSESSMENT-SCOPE-POINTER-CRASH).
      expect(r.guiEnv.stamper.CES_PIPELINE_ROOT).not.toContain('eo-pipeline');
    });
  });

  it('goes through buildGuiChildEnv, so the sim shims stay first and ours is appended', async () => {
    // The append-not-replace rule itself is pinned in demo-gui-servers.test.ts;
    // what matters here is that the STAMPER child gets that env at all, rather
    // than a hand-rolled one that skips the FD-5 shim.
    await arming({ withAoGui: false, withEo: false, withStamperGui: true }, async (r) => {
      const psPath = r.guiEnv.stamper.PSModulePath ?? '';
      expect(psPath.startsWith('C:\\sim\\psmodules')).toBe(true);
      expect(psPath).toContain(path.join('assets', 'psmodules-shim'));
    });
  });

  it('gives the child the run-scoped tenant root the record step authored', async () => {
    await arming({ withAoGui: false, withEo: false, withStamperGui: true }, async (r) => {
      expect(r.guiEnv.stamper.CES_TENANT_ROOT).toContain('tenant-root');
    });
  });
});

describe('armSim teardown (A8)', () => {
  it('stops EO -> stamper -> AO -> serve, so consumers die before the sim', async () => {
    await arming({ withAoGui: true, withEo: true, withStamperGui: true }, async (r, armed) => {
      expect(r.started).toEqual(['serve', 'ao', 'stamper', 'eo']);
      await armed.stop();
      expect(r.stopped).toEqual(['eo', 'stamper', 'ao', 'serve']);
    });
  });

  it('is idempotent — a second stop kills nothing twice', async () => {
    await arming({ withAoGui: false, withEo: false, withStamperGui: true }, async (r, armed) => {
      await armed.stop();
      await armed.stop();
      expect(r.stopped).toEqual(['stamper', 'serve']);
    });
  });

  it('arms the canonical demo tenant', async () => {
    await arming({ withAoGui: false, withEo: false }, async (_r, armed) => {
      expect(armed.slug).toBe(SHOW_SLUG);
    });
  });
});
