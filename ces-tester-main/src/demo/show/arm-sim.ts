// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S5 — prep-phase arming for the live ops.
 *
 * This is **invisible setup**, not a demo surface: it runs before slide 1 and
 * the audience never sees it, exactly the carve-out `gui-servers.ts` documents.
 * It COMPOSES already-exported helpers and adds no new mechanism — `e2e-run.ts`
 * Beat 0 (its ~L996-1048) is the proven order and is reproduced here verbatim in
 * spirit. `e2e-run.ts` itself is deliberately untouched.
 *
 * The order is not stylistic:
 *
 *   seed -> serve -> ready -> register tenant -> sim launch env ->
 *   cert + record patch -> GUI child env -> AO GUI -> EO server
 *
 * - **EO comes last** and only when the deck drives it (`arm-eo.ts`): it reads
 *   the tenant out of the same run-scoped `CES_TENANT_ROOT` the record step
 *   just authored, and it is the slowest thing arming spawns.
 *
 * - **Seeding comes first** or `serve` has nothing to serve. (The plan's helper
 *   list omits this step; without `resetDemoDibSmallTenant` the whole chain
 *   comes up healthy against an unmaterialized tenant.)
 * - **The registry record is authored once.** `authorSimTenantRecord` re-authors
 *   and patches the two auth fields; nothing later re-registers the slug, so the
 *   M3 "later re-registration resets the auth fields" collision cannot occur.
 * - **`buildGuiChildEnv` merges THEN appends the FD-5 shim** — that ordering is
 *   the helper's own contract and the reason it exists.
 *
 * Ports are probed before anything is spawned. That is not defensive padding:
 * `preflight.ts`'s header records a live run where an orphaned listener on a
 * demo port made the harness drive a DIFFERENT product's SPA while every check
 * looked green. A demo that runs against the wrong tenant is worse than one that
 * refuses to start.
 */

import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { probePort } from '../preflight.js';
import { resetDemoDibSmallTenant } from '../needle-run.js';
import { startServe, type ServeHandle } from '../../stacksim-client/serve-lifecycle.js';
import { waitUntilReady } from '../../stacksim-client/ready-check.js';
import { DEFAULT_STACKSIM_SERVER_URL } from '../../stacksim-client/http.js';
import { createTenantRegistry, createEphemeralSimTenant, getSimLaunchEnv } from '../../tenant-registry/index.js';
import { authorSimTenantRecord } from '../sim-tenant-record.js';
import { ensureSimCert } from '../stamper-prereqs.js';
import {
  buildGuiChildEnv,
  startAoGui,
  startStamperGui,
  AO_GUI_PORT,
  STAMPER_GUI_PORT,
  type GuiServerHandle,
} from '../gui-servers.js';
import {
  startShowEoServer,
  resolvePsHomeModules,
  stamperRegistryPath,
  EO_PORT,
  type EoServerHandle,
} from './arm-eo.js';
import {
  startMusterPreview,
  MUSTER_SPA_PORT,
  type MusterPreviewHandle,
} from './arm-muster.js';
import type { ShowRunOptions } from './show-run.js';

/** The canonical demo tenant (founder-approved "Ridgeline Fabrication"). */
export const SHOW_SLUG = 'demo-dib-small';

/** stacksim's serve port — probed, never assumed free. */
export const STACKSIM_PORT = 4390;

/**
 * Where the installed sim cert's thumbprint is remembered BETWEEN runs.
 *
 * Without this, every `demo:show` generates a fresh cert and installs it into
 * the operator's `Cert:\CurrentUser\My` — two rehearsals already left two
 * different thumbprints there. `ensureSimCert` reuses an already-installed cert
 * when it is told one exists, so the demo machine's personal store stops
 * accumulating a certificate per demo. Same pattern, same reason, as
 * `e2e-run.ts`'s `SIM_CERT_STATE_FILE`.
 */
export const SHOW_CERT_STATE_FILE = 'sim-cert-state.json';

export interface ArmedSim {
  readonly slug: string;
  readonly simUrl: string;
  readonly aoBaseUrl?: string;
  /** `http://127.0.0.1:4002` once the EO SPA server is up. */
  readonly eoBaseUrl?: string;
  /** `http://127.0.0.1:3000` once the Stamper Configuration GUI is up. */
  readonly stamperBaseUrl?: string;
  /** `http://127.0.0.1:4173` once the ces-muster Vite preview is up. */
  readonly musterBaseUrl?: string;
  readonly runDir: string;
  /** Stops Muster, EO, the Stamper GUI, the AO GUI and the stacksim serve. Idempotent. */
  stop(): Promise<void>;
}

export interface ArmSimOptions {
  /**
   * Which surfaces to bring up. `withAoGui` / `withEo` default to ON for
   * backwards compatibility, but `op-registry.ts` passes exactly what the loaded
   * deck drives — arming a server no slide will use costs the operator a minute
   * of prep for nothing.
   */
  readonly withAoGui?: boolean;
  readonly withEo?: boolean;
  /**
   * The Stamper Configuration GUI. Defaults **OFF**, unlike the two above: it is
   * a new surface, so every caller that predates it must keep arming exactly the
   * set it always did. `armingFor` turns it on for a deck that drives a stamper
   * op.
   */
  readonly withStamperGui?: boolean;
  /**
   * The ces-muster Vite preview SPA. Defaults **OFF** (a new surface, like
   * `withStamperGui`). `armingFor` turns it on for a deck that drives a
   * `muster-gui` op.
   */
  readonly withMuster?: boolean;
  readonly runId?: string;
  readonly simUrl?: string;
  readonly aoGuiPort?: number;
  readonly eoPort?: number;
  readonly stamperGuiPort?: number;
  readonly musterSpaPort?: number;
}

/**
 * Every process `armSim` spawns, injectable. Without this seam `arm-sim.ts` is
 * untestable — it imports all six directly — and the port-conditionality, the
 * run-scoped `STORAGE_ROOT` and the teardown ORDER are all things that fail
 * silently in production and never in a review.
 *
 * Every field is optional and defaults to the real import, so existing callers
 * are unchanged.
 */
export interface ArmSimDeps {
  readonly probePort?: typeof probePort;
  readonly startServe?: typeof startServe;
  readonly resetDemoDibSmallTenant?: typeof resetDemoDibSmallTenant;
  readonly startAoGui?: typeof startAoGui;
  readonly startStamperGui?: typeof startStamperGui;
  readonly startShowEoServer?: typeof startShowEoServer;
  readonly startMusterPreview?: typeof startMusterPreview;
  // The rest of the chain. The plan named the six above; without these a test
  // still spawns PowerShell for the cert, writes a real registry and waits on a
  // real HTTP port, so the Accept above is unreachable. The rule is simple and
  // complete: EVERY externally-effectful import is injectable, nothing else is.
  // `buildGuiChildEnv` is deliberately NOT here — the test asserts against its
  // real output, which is the point of the run-scoped `storageRoot` check.
  readonly waitUntilReady?: typeof waitUntilReady;
  readonly createTenantRegistry?: typeof createTenantRegistry;
  readonly createEphemeralSimTenant?: typeof createEphemeralSimTenant;
  readonly getSimLaunchEnv?: typeof getSimLaunchEnv;
  readonly ensureSimCert?: typeof ensureSimCert;
  readonly authorSimTenantRecord?: typeof authorSimTenantRecord;
  readonly resolvePsHomeModules?: typeof resolvePsHomeModules;
}

/**
 * Arm the environment the live ops drive. Throws with a specific, actionable
 * message on any failure — a half-armed show must never reach slide 1 looking
 * ready.
 */
export async function armSim(
  options: ShowRunOptions,
  log: (line: string) => void = () => undefined,
  opts: ArmSimOptions = {},
  deps: ArmSimDeps = {},
): Promise<ArmedSim> {
  const probe = deps.probePort ?? probePort;
  const serveStarter = deps.startServe ?? startServe;
  const seedTenant = deps.resetDemoDibSmallTenant ?? resetDemoDibSmallTenant;
  const aoStarter = deps.startAoGui ?? startAoGui;
  const stamperStarter = deps.startStamperGui ?? startStamperGui;
  const eoStarter = deps.startShowEoServer ?? startShowEoServer;
  const musterStarter = deps.startMusterPreview ?? startMusterPreview;
  const ready = deps.waitUntilReady ?? waitUntilReady;
  const makeRegistry = deps.createTenantRegistry ?? createTenantRegistry;
  const makeTenant = deps.createEphemeralSimTenant ?? createEphemeralSimTenant;
  const launchEnvFor = deps.getSimLaunchEnv ?? getSimLaunchEnv;
  const makeCert = deps.ensureSimCert ?? ensureSimCert;
  const authorRecord = deps.authorSimTenantRecord ?? authorSimTenantRecord;
  const psModules = deps.resolvePsHomeModules ?? resolvePsHomeModules;

  const runId = opts.runId ?? `show-${Date.now()}`;
  const runDir = path.join(options.testerRoot, 'runs', 'show', runId);
  const tenantRoot = path.join(runDir, 'tenant-root');
  const pipelineRoot = path.join(runDir, 'pipeline');
  const shimRoot = path.join(options.testerRoot, 'assets', 'psmodules-shim');
  const simUrl = opts.simUrl ?? DEFAULT_STACKSIM_SERVER_URL;
  const aoGuiPort = opts.aoGuiPort ?? AO_GUI_PORT;
  const eoPort = opts.eoPort ?? EO_PORT;
  const stamperGuiPort = opts.stamperGuiPort ?? STAMPER_GUI_PORT;
  const musterSpaPort = opts.musterSpaPort ?? MUSTER_SPA_PORT;
  const withAoGui = opts.withAoGui ?? true;
  const withEo = opts.withEo ?? true;
  const withStamperGui = opts.withStamperGui ?? false;
  const withMuster = opts.withMuster ?? false;
  // Not on `ShowRunOptions` (which `show-command.ts` builds and this slice may
  // not touch), so they follow VAULT.md's sibling layout unless overridden.
  const eoRoot = options.eoRoot ?? path.resolve(options.testerRoot, '..', 'ces-eo');
  const stamperRoot = options.stamperRoot ?? path.resolve(options.testerRoot, '..', 'ces-stamper');
  const musterRoot = options.musterRoot ?? path.resolve(options.testerRoot, '..', 'ces-muster');

  await fsp.mkdir(runDir, { recursive: true });
  await fsp.mkdir(pipelineRoot, { recursive: true });

  // Ports first: an orphaned listener is the failure mode that looks healthy.
  // Each is probed ONLY when it will be used — probing a port the deck has no
  // use for turns someone else's unrelated server into a refusal to start.
  const contested: string[] = [];
  if ((await probe(STACKSIM_PORT)) === 'occupied') contested.push(`${STACKSIM_PORT} (stacksim serve)`);
  if (withAoGui && (await probe(aoGuiPort)) === 'occupied') contested.push(`${aoGuiPort} (ao gui)`);
  if (withStamperGui && (await probe(stamperGuiPort)) === 'occupied') contested.push(`${stamperGuiPort} (stamper gui)`);
  if (withEo && (await probe(eoPort)) === 'occupied') contested.push(`${eoPort} (eo server)`);
  if (withMuster && (await probe(musterSpaPort)) === 'occupied') contested.push(`${musterSpaPort} (muster preview)`);
  if (contested.length > 0) {
    throw new Error(
      `cannot arm the demo — port(s) already in use: ${contested.join(', ')}. ` +
        'Free them (or run `ces-tester demo:reset`) before starting the show: an orphaned listener ' +
        'makes the drive silently target the wrong tenant.',
    );
  }

  let serve: ServeHandle | undefined;
  let aoGui: GuiServerHandle | undefined;
  let stamperGui: GuiServerHandle | undefined;
  let eoServer: EoServerHandle | undefined;
  let musterPreview: MusterPreviewHandle | undefined;
  let stopped = false;
  /** Reverse acquisition order: the consumers die before the sim they talk to. */
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (musterPreview) await musterPreview.stop().catch(() => undefined);
    if (eoServer) await eoServer.stop().catch(() => undefined);
    if (stamperGui) await stamperGui.stop().catch(() => undefined);
    if (aoGui) await aoGui.stop().catch(() => undefined);
    if (serve) await serve.stop().catch(() => undefined);
  };

  try {
    log(`  prep: seeding '${SHOW_SLUG}' to pristine`);
    await seedTenant(options.stacksimRoot, SHOW_SLUG);

    serve = await serveStarter({
      stacksimRoot: options.stacksimRoot,
      stance: 'm365_azure',
      slug: SHOW_SLUG,
      logPath: path.join(runDir, 'stacksim-serve.log'),
    });
    await ready({ serverUrl: simUrl, method: 'GET', uri: '/v1.0/policies/authorizationPolicy' });
    log(`  prep: stacksim serve ready on ${simUrl}`);

    const registry = makeRegistry({ registryRoot: tenantRoot, stacksimRoot: options.stacksimRoot });
    await makeTenant(registry, SHOW_SLUG, { stance: 'm365_azure' });
    const simLaunchEnv = await launchEnvFor(registry, SHOW_SLUG, { stacksimRoot: options.stacksimRoot });

    // The cert reaches AuthChain through an ABSOLUTE `auth.cert_path` in the
    // record — the same route `e2e-run.ts` proved; no relative placeholder is
    // written, which would have to land inside a sibling repo. The thumbprint
    // is cached across runs so a demo machine does not collect one certificate
    // per rehearsal in `Cert:\CurrentUser\My`.
    const certStatePath = path.join(options.testerRoot, 'runs', 'show', SHOW_CERT_STATE_FILE);
    let knownThumbprint: string | undefined;
    try {
      knownThumbprint = (JSON.parse(await fsp.readFile(certStatePath, 'utf8')) as { thumbprint?: string }).thumbprint;
    } catch {
      knownThumbprint = undefined; // first run on this machine
    }
    const cert = await makeCert({ outDir: runDir, knownThumbprint });
    try {
      await fsp.writeFile(certStatePath, JSON.stringify({ thumbprint: cert.thumbprint }, null, 2), 'utf8');
    } catch {
      /* remembering is an optimization; failing to remember is not fatal */
    }
    await authorRecord({
      registry,
      registryRoot: tenantRoot,
      slug: SHOW_SLUG,
      auth: { certThumbprint: cert.thumbprint, certPath: cert.pfxPath },
    });
    log(`  prep: sim cert ${cert.thumbprint} in place via '${cert.route}'`);

    if (withAoGui) {
      const env = buildGuiChildEnv({ simLaunchEnv, shimRoot, tenantRoot, pipelineRoot });
      aoGui = await aoStarter({
        aoRoot: options.aoRoot,
        env,
        port: aoGuiPort,
        logPath: path.join(runDir, 'ao-gui.log'),
      });
      log(`  prep: AO GUI up on ${aoGui.baseUrl}`);
    }

    if (withStamperGui) {
      // `storageRoot` is MANDATORY and run-scoped. `GuiChildEnvOptions` makes it
      // optional, so omitting it is not a compile error and no test would catch
      // it — and a Stamper GUI without a run-scoped STORAGE_ROOT writes its
      // execution reports to the default root, silently contaminating the very
      // artifact `stamper-execute` judges. Production Beat 3 passes it too.
      //
      // The pipelineRoot is the SAME one the AO GUI gets: Stamper's plan-data
      // lives at {pipelineRoot}/Stamper/plan-data/{slug}. Do not hand it EO's
      // `eo-pipeline` — one scope pointer per database
      // (REQ-EO-ASSESSMENT-SCOPE-POINTER-CRASH).
      const env = buildGuiChildEnv({
        simLaunchEnv,
        shimRoot,
        tenantRoot,
        pipelineRoot,
        storageRoot: path.join(runDir, 'stamper-storage'),
      });
      // Never `stamper gui --stacksim`: it calls `enableStacksimMode`, which
      // clobbers the shim this env just built (see `gui-servers.ts`'s header).
      stamperGui = await stamperStarter({
        stamperRoot,
        env,
        port: stamperGuiPort,
        logPath: path.join(runDir, 'stamper-gui.log'),
      });
      log(`  prep: Stamper Configuration GUI up on ${stamperGui.baseUrl} (driven BACKSTAGE, never on screen)`);
    }

    if (withEo) {
      // EO is armed AFTER the registry record exists: its `/api/tenants` reads
      // `sim/<slug>.json` out of the same run-scoped CES_TENANT_ROOT, and the
      // SPA's tenant `<option>` is what the op waits for.
      eoServer = await eoStarter({
        eoRoot,
        simRoot: options.stacksimRoot,
        stamperRegistry: stamperRegistryPath(stamperRoot),
        tenantRoot,
        storageRoot: path.join(runDir, 'eo-storage'),
        pipelineRoot: path.join(runDir, 'eo-pipeline'),
        logPath: path.join(runDir, 'eo-server.log'),
        slug: SHOW_SLUG,
        simUrl,
        port: eoPort,
        psHomeModules: await psModules(),
      });
      log(`  prep: EO server up on ${eoServer.baseUrl}`);
    }

    if (withMuster) {
      // The SPA is a static Vite build; it does not read the tenant record, so
      // it arms independently of the record/cert chain above. The CLI walk a
      // muster-gui act imports from reaches the sim separately.
      musterPreview = await musterStarter({
        musterRoot,
        logPath: path.join(runDir, 'muster-preview.log'),
        port: musterSpaPort,
      });
      log(`  prep: ces-muster preview up on ${musterPreview.baseUrl}`);
    }

    return {
      slug: SHOW_SLUG,
      simUrl,
      aoBaseUrl: aoGui?.baseUrl,
      eoBaseUrl: eoServer?.baseUrl,
      stamperBaseUrl: stamperGui?.baseUrl,
      musterBaseUrl: musterPreview?.baseUrl,
      runDir,
      stop,
    };
  } catch (err) {
    await stop();
    throw new Error(`demo arming failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
