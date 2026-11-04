// Module starter for the launcher and the twin: brings up the kit stack on the kit's localhost ports, on the simulator
// only, the way the Demo Commander needs it. The page itself (server.mjs) never starts a CES module; scripts\mine.mjs
// (the launcher) imports this file, and `start --prefixed` runs the twin, a local copy of a path-prefixed proxy layout.
//
// Roots: the built clone is %WALKTHROUGH_ROOT%\ces and the run package %WALKTHROUGH_ROOT%\pkg\ces-muster-run;
// WALKTHROUGH_ROOT defaults to C:\ces-nb. A preset CES_EO_OPERATOR_SECRET is used as EvidenceOps' operator secret
// (otherwise a random one).
//
//   node scripts/fixture.mjs start [--fresh]   (--fresh empties the fixture data folders first) starts every module (refuses when a port is held), writes config.local.json,
//                                    then stays in the foreground holding the children until runs\fixture\STOP exists
//   node scripts/fixture.mjs stop    creates runs\fixture\STOP; the start process stops only the processes it started
//   node scripts/fixture.mjs start --prefixed [--fresh]
//                                    the same stack with CES_STAMPER_AUTH_TOKEN and CES_EO_AUTH_TOKEN SET, plus the
//                                    "twin": an HTTPS reverse proxy (self-signed certificate, no dependencies) on a free
//                                    port that copies the contractor's layout as PLAN.md 11.1 records it. It writes a
//                                    shape B config.local.json (mode remote, no roots, tls.caFile) with the four values.
//
// The start logic is also exported as startStack() (attach mode included): scripts\mine.mjs, the launcher
// (PLAN.md section 12), reuses it instead of a copy. The command line below runs only when this file is the entry script.
//
// Layout (kit ports, handoff README.md): simulator 4390, muster-api 4011, Muster SPA 4173, Stamper 3000, AO 3001,
// EO 4002, EC 4001. Scenario s1-mach. AO and Stamper token-less (KI-01). EO token-less as well: the engine's EO ops
// drive EO's legacy page, which sends no bearer token. Run secrets live in this process's memory and the children's
// environment only; the EO operator token (needed by EO's access screen) is written to config.local.json, which is
// gitignored.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const WT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ROOT = process.env.WALKTHROUGH_ROOT || 'C:\\ces-nb';
export const CES = path.join(ROOT, 'ces');
const PKG = path.join(ROOT, 'pkg', 'ces-muster-run');
const TESTER = path.join(CES, 'ces-tester');
const SIM_ROOT = path.join(CES, 'tenant-stacksim');
const SLUG = 's1-mach';
const STANCE = 'm365_azure';
const FIX = path.join(WT, 'runs', 'fixture');
const STOP_FILE = path.join(FIX, 'STOP');
const STATE_FILE = path.join(FIX, 'fixture-state.json');
let LOGS = path.join(FIX, 'logs');
export const PORTS = { sim: 4390, musterApi: 4011, musterSpa: 4173, stamper: 3000, ao: 3001, eo: 4002, ec: 4001 };
const TSX = path.join(CES, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const PREFIXED = process.argv.includes('--prefixed');
const TWIN_DIR = path.join(FIX, 'twin-cert');
const TWIN_LOG = path.join(FIX, 'twin-requests.jsonl');

const dist = (rel) => import(pathToFileURL(path.join(TESTER, 'dist', 'src', rel)).href);
const secret = () => crypto.randomBytes(24).toString('hex');
let LOG_TAG = 'fixture';
const log = (line) => console.log(`[${LOG_TAG} ${new Date().toISOString().slice(11, 19)}] ${line}`);

export function portHeld(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const s = net.connect({ port, host });
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
      s.setTimeout(800, () => { s.destroy(); resolve(false); });
    });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then(([a, b]) => a || b);
}

async function waitHttp(url, timeoutMs, ok = (s) => s < 500, headers = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      if (ok(r.status)) return r.status;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`${url} did not answer within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const children = [];
function startChild(name, args, cwd, env, module) {
  fs.mkdirSync(LOGS, { recursive: true });
  const o = fs.openSync(path.join(LOGS, `${name}.out`), 'w');
  const e = fs.openSync(path.join(LOGS, `${name}.err`), 'w');
  const c = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', o, e], windowsHide: true });
  fs.closeSync(o);
  fs.closeSync(e);
  children.push({ name, module, stop: async () => killTree(c.pid), pid: c.pid });
  return c;
}
function killTree(pid) {
  if (pid) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
}

function cleanBaseEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(CES_.*_AUTH_TOKEN|CES_TWO_PERSON_APPROVAL|TENANT_MANIFEST_PATH|CES_MUSTER_SECRETS_.*|JWT_SECRET)$/i.test(k)) delete env[k];
  }
  return env;
}


/** The stack's modules in start order (the keys of PORTS). startStack's `attach` names those whose port was already held. */
export const MODULES = ['sim', 'ec', 'eo', 'musterApi', 'stamper', 'ao', 'musterSpa'];

/** The process id listening on a TCP port, from `netstat -ano` (null when nothing listens). */
export function listenerPid(port) {
  const r = spawnSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
  const r6 = spawnSync('netstat.exe', ['-ano', '-p', 'TCPv6'], { encoding: 'utf8', windowsHide: true });
  for (const line of `${r.stdout ?? ''}\n${r6.stdout ?? ''}`.split(/\r?\n/)) {
    const m = line.trim().split(/\s+/);
    if (m.length >= 5 && /LISTEN/i.test(m[3]) && m[1].endsWith(`:${port}`)) return Number(m[4]);
  }
  return null;
}

/**
 * Bring up the kit stack from the built clone (CES above) on the kit ports (this module starter, and the launcher
 * through scripts\mine.mjs). Options:
 *   dir      data, logs and state folder (default runs\fixture)
 *   fresh    empty the data folders first and reseed the simulator (only a simulator this call starts)
 *   prefixed tokens on Stamper and EvidenceOps plus the twin (fixture only)
 *   attach   a Set of module names (MODULES) whose port is already held by a process this call did not start: that
 *            module is not started, not reseeded, never stopped; it is probed and reported "attached"
 *   reuse    an earlier config (object) whose run-only values are kept for attached modules (operator login, tokens)
 * Returns the walkthrough config for this stack and a stop() that stops only the processes this call started.
 */
export async function startStack(opts = {}) {
  const dir = opts.dir ?? FIX;
  const prefixed = opts.prefixed ?? PREFIXED;
  const attach = opts.attach ?? new Set();
  const reuse = opts.reuse ?? null;
  LOGS = path.join(dir, 'logs');
  LOG_TAG = opts.tag ?? 'fixture';
  const ours = (m) => !attach.has(m);
  const startedAt = new Date().toISOString();
  const notes = [];
  const roots = {
    tenantRoot: path.join(dir, 'tenants'),
    pipelineRoot: path.join(dir, 'pl'),
    storageRoot: path.join(dir, 'eo-storage'),
    stamperStorage: path.join(dir, 'stamper-storage'),
    eoRepo: path.join(dir, 'eo-repo'),
    certDir: path.join(dir, 'cert'),
  };
  if (opts.fresh) {
    // A clean stack, as a contractor starts from: drop the stack's own data folders (plain folders, no links).
    for (const d of Object.values(roots)) {
      if (fs.existsSync(d) && !fs.lstatSync(d).isSymbolicLink()) fs.rmSync(d, { recursive: true, force: true });
    }
    log('fresh: the data folders were emptied');
  }
  for (const d of Object.values(roots)) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  const base = cleanBaseEnv();
  /** An attached module: probe once, report, never wait long and never touch it. */
  const attached = async (name, url, ok = (s) => s < 500) => {
    let answer = 'no answer';
    try {
      const st = await waitHttp(url, 5000, ok);
      answer = `answers HTTP ${st}`;
    } catch { /* reported below */ }
    log(`${name}: port ${PORTS[name]} already held by a process this launcher did not start: ATTACHED (${answer}); not started, not stopped`);
    notes.push({ module: name, port: PORTS[name], attached: true, answer });
  };

  const { startServe } = await dist('stacksim-client/serve-lifecycle.js');
  const { createTenantRegistry, getSimLaunchEnv } = await dist('tenant-registry/index.js');
  const { mergeSimLaunchEnv } = await dist('stamper-launcher/env.js');
  const { ensureSimCert } = await dist('demo/stamper-prereqs.js');
  const { authorSimTenantRecord } = await dist('demo/sim-tenant-record.js');
  const { buildGuiChildEnv, startAoGui, startStamperGui } = await dist('demo/gui-servers.js');
  const { startMusterPreview } = await dist('demo/show/arm-muster.js');
  const { buildAoEnv, mintPrincipalSecret } = await dist('flow/ao-step.js');
  const { loadPrincipalSigner, operatorClaims } = await dist('flow/eo-reviews.js');

  // 1. Simulator: reset the scenario, then serve it (RUNBOOK.md "Start and stop each server"). An attached simulator
  // is never reseeded or restarted (PLAN.md section 4): Prepare reads which scenario it serves.
  const simUrl = `http://127.0.0.1:${PORTS.sim}`;
  if (ours('sim')) {
    if (opts.fresh || !opts.keepSim) {
      log(`simulator: stacksim scenario ${SLUG}`);
      const seed = spawnSync(process.execPath, ['bin/stacksim.mjs', 'scenario', SLUG], { cwd: SIM_ROOT, encoding: 'utf8', windowsHide: true });
      fs.writeFileSync(path.join(LOGS, 'sim-scenario.out'), `${seed.stdout ?? ''}\n${seed.stderr ?? ''}`);
      if (seed.status !== 0) throw new Error(`stacksim scenario ${SLUG} failed (rc ${seed.status})`);
    } else log('simulator: --keep, the scenario is not reseeded');
    const serve = await startServe({ stacksimRoot: SIM_ROOT, stance: STANCE, slug: SLUG, port: PORTS.sim, logPath: path.join(LOGS, 'sim-serve.out') });
    children.push({ name: 'simulator', module: 'sim', stop: () => serve.stop(), pid: serve.process.pid });
    await waitHttp(`${simUrl}/v1.0/policies/authorizationPolicy`, 60000, (s) => s === 200);
    log(`simulator: serving ${SLUG} on ${simUrl}`);
  } else {
    await attached('sim', `${simUrl}/v1.0/policies/authorizationPolicy`, (s) => s === 200);
  }

  // 2. The sim tenant record under CES_TENANT_ROOT (the modules list tenants from it). Needs no running simulator.
  const registry = createTenantRegistry({ registryRoot: roots.tenantRoot, stacksimRoot: SIM_ROOT });
  const ownState = path.join(WT, 'runs', 'sim-cert-state.json');
  const readThumb = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).thumbprint; } catch { return undefined; } };
  const knownThumbprint = readThumb(ownState) ?? readThumb(path.join(TESTER, 'runs', 'e2e', 'sim-cert.json'));
  const cert = await ensureSimCert({ outDir: roots.certDir, knownThumbprint });
  fs.writeFileSync(ownState, JSON.stringify({ thumbprint: cert.thumbprint }, null, 2));
  await authorSimTenantRecord({ registry, registryRoot: roots.tenantRoot, slug: SLUG, auth: { certThumbprint: cert.thumbprint, certPath: cert.pfxPath }, seedRef: { scenario: SLUG, stance: STANCE } });
  const launch = await getSimLaunchEnv(registry, SLUG, { stacksimRoot: SIM_ROOT });
  const simEnv = mergeSimLaunchEnv({ simLaunchEnv: launch, baseEnv: base });
  log(`record: sim\\${SLUG}.json authored (cert route ${cert.route})`);

  // Run-only secrets (memory and child environments only).
  const sec = { ec: secret(), ecPrincipal: secret(), eoAoPrincipal: secret(), eoOperator: process.env.CES_EO_OPERATOR_SECRET || secret(), jwt: secret(), eoIntake: secret(), stamperToken: secret(), eoToken: secret() };
  // --prefixed: Stamper and EO run with their bearer tokens SET (PLAN.md 11.4 item 1); with a token set, loopback
  // callers must send it too, as the contractor's proxy must.
  const eoBearer = prefixed ? { Authorization: `Bearer ${sec.eoToken}` } : {};
  if (!ours('ec') && ours('eo')) log('note: Evidence Collector is attached, so its shared secret is not the one this EvidenceOps gets; uploads (step 19) may be refused');

  // 3. EC (Evidence Collector).
  if (ours('ec')) {
    startChild('ec', [TSX, 'src/index.ts'], path.join(CES, 'ces-ec'), {
      ...simEnv, CES_PIPELINE_ROOT: roots.pipelineRoot, CES_TENANT_ROOT: roots.tenantRoot, EC_PORT: String(PORTS.ec),
      EVIDENCE_OPS_SECRET: sec.ec, CES_EC_PRINCIPAL_SECRET: sec.ecPrincipal,
      CES_EVIDENCE_CATALOG_PATH: path.join(CES, 'ces-muster', 'src', 'features', 'plan', 'engine', 'data', 'evidence-catalog', 'evidence-catalog-release-0.json'),
    }, 'ec');
    await waitHttp(`http://127.0.0.1:${PORTS.ec}/api/health`, 90000);
    log(`EC: up on ${PORTS.ec}`);
  } else await attached('ec', `http://127.0.0.1:${PORTS.ec}/api/health`);

  // 4. EO (token-less on loopback; operator dev fallback for the access screen's mints, simulator only: KI-15).
  if (ours('eo')) {
    const eoEnv = {
      ...simEnv, CES_EO_ADMINOPS_SINCE: startedAt,
      CES_PIPELINE_ROOT: roots.pipelineRoot, CES_TENANT_ROOT: roots.tenantRoot,
      REGISTRY_PATH: path.join(CES, 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json'),
      STORAGE_ROOT: roots.storageRoot, TENANT_SLUG: SLUG, EO_PORT: String(PORTS.eo), COMPLIANCE_REPO_PATH: roots.eoRepo,
      EC_URL: `http://127.0.0.1:${PORTS.ec}`, EVIDENCE_OPS_SECRET: sec.ec, CES_EC_PRINCIPAL_SECRET: sec.ecPrincipal,
      CES_AO_PRINCIPAL_SECRET: sec.eoAoPrincipal, CES_EO_OPERATOR_SECRET: sec.eoOperator, CES_EO_OPERATOR_DEV_FALLBACK: '1',
      ...(prefixed ? { CES_EO_AUTH_TOKEN: sec.eoToken } : {}),
    };
    startChild('eo', [TSX, 'src/eo/index.ts'], path.join(CES, 'ces-eo'), eoEnv, 'eo');
    await waitHttp(`http://127.0.0.1:${PORTS.eo}/api/health`, 180000, (s) => s === 200, eoBearer);
    log(`EO: up on ${PORTS.eo}`);
  } else await attached('eo', `http://127.0.0.1:${PORTS.eo}/api/health`, (s) => s === 200);

  // 5. muster-api: seed a fictional operator, start, mint the Stamper secrets-resolution token (KI-02).
  const musterApi = path.join(CES, 'ces-muster', 'muster-api');
  const domain = (() => {
    try {
      const dr = JSON.parse(fs.readFileSync(path.join(PKG, 'customers', SLUG, 'document-reviews.json'), 'utf8'));
      return String(dr.uploader.upn).split('@')[1];
    } catch {
      return `${SLUG}.simtenant.onmicrosoft.us`;
    }
  })();
  let operatorLogin = ['walkthrough.operator', 'ces.invalid'].join('@');
  let operatorPassword = secret();
  let secretsToken = null;
  if (ours('musterApi')) {
    const apiEnv = {
      ...simEnv, JWT_SECRET: sec.jwt, PORT: String(PORTS.musterApi), CES_PIPELINE_ROOT: roots.pipelineRoot, CES_TENANT_ROOT: roots.tenantRoot,
      STACKSIM_SERVER_URL: simUrl, CES_EO_URL: `http://127.0.0.1:${PORTS.eo}`, CES_EO_AUTH_TOKEN: prefixed ? sec.eoToken : sec.eoIntake,
    };
    const seeded = spawnSync(process.execPath, [TSX, 'scripts/seed.ts', '--email', operatorLogin, '--password', operatorPassword], { cwd: musterApi, env: apiEnv, encoding: 'utf8', windowsHide: true });
    if (seeded.status !== 0) throw new Error(`seeding the muster-api operator failed (rc ${seeded.status}): ${(seeded.stderr ?? '').split(/\r?\n/)[0]}`);
    const musterTenantId = JSON.parse(seeded.stdout.slice(seeded.stdout.indexOf('{'))).tenant.id;
    startChild('muster-api', ['dist/server.js'], musterApi, apiEnv, 'musterApi');
    await waitHttp(`http://127.0.0.1:${PORTS.musterApi}/`, 60000, () => true);
    const jwt = createRequire(path.join(musterApi, 'package.json'))('jsonwebtoken');
    secretsToken = jwt.sign({ sub: 'walkthrough-fixture', tenant_id: musterTenantId, party_id: null, role: 'bhd_operator' }, sec.jwt, { expiresIn: '8h' });
    log(`muster-api: up on ${PORTS.musterApi} (operator seeded)`);
  } else {
    await attached('musterApi', `http://127.0.0.1:${PORTS.musterApi}/`, (s) => s > 0);
    // Its operator account is not this launcher's to create; keep the login of the last config if there is one.
    operatorLogin = reuse?.musterOperator?.login ?? '';
    operatorPassword = reuse?.musterOperator?.password ?? '';
    log(`note: muster-api is attached: the operator login ${operatorLogin ? 'is kept from the last config.local.json' : 'is unknown (put it in config.local.json)'}; Stamper gets no secrets-resolution token from this launcher`);
  }

  // 6. Stamper GUI (token-less; never --stacksim, see gui-servers.ts), resolving plan secrets from muster-api.
  const shimRoot = path.join(TESTER, 'assets', 'psmodules-shim');
  if (ours('stamper')) {
    const stEnv = buildGuiChildEnv({ simLaunchEnv: launch, baseEnv: base, shimRoot, tenantRoot: roots.tenantRoot, pipelineRoot: roots.pipelineRoot, storageRoot: roots.stamperStorage });
    stEnv.CES_MUSTER_SECRETS_URL = `http://127.0.0.1:${PORTS.musterApi}`;
    if (secretsToken) stEnv.CES_MUSTER_SECRETS_TOKEN = secretsToken;
    if (prefixed) {
      // startStamperGui polls /api/tenants without a bearer, which a tokened Stamper answers 401: start it here instead.
      stEnv.CES_STAMPER_AUTH_TOKEN = sec.stamperToken;
      const stRoot = path.join(CES, 'ces-stamper');
      startChild('stamper', [path.join(stRoot, 'dist', 'cli', 'index.js'), 'gui', '--port', String(PORTS.stamper)], stRoot, stEnv, 'stamper');
      await waitHttp(`http://127.0.0.1:${PORTS.stamper}/api/tenants`, 120000, (s) => s === 200, { Authorization: `Bearer ${sec.stamperToken}` });
    } else {
      const st = await startStamperGui({ stamperRoot: path.join(CES, 'ces-stamper'), env: stEnv, port: PORTS.stamper, logPath: path.join(LOGS, 'stamper-gui.log') });
      children.push({ name: 'stamper', module: 'stamper', stop: () => st.stop(), pid: st.process.pid });
    }
    log(`Stamper: up on ${PORTS.stamper}`);
  } else await attached('stamper', `http://127.0.0.1:${PORTS.stamper}/api/tenants`);

  // 7. AO GUI (token-less, simulator only).
  if (ours('ao')) {
    const aoEnv = { ...buildAoEnv(simEnv, { pipelineRoot: roots.pipelineRoot, tenantRoot: roots.tenantRoot, simUrl, secret: mintPrincipalSecret() }), CES_NO_OPEN: '1', BROWSER: 'none' };
    aoEnv.PSModulePath = `${aoEnv.PSModulePath ?? ''};${shimRoot}`;
    delete aoEnv.CES_TWO_PERSON_APPROVAL;
    delete aoEnv.CES_AO_AUTH_TOKEN;
    const ao = await startAoGui({ aoRoot: path.join(CES, 'ces-ao'), env: aoEnv, port: PORTS.ao, logPath: path.join(LOGS, 'ao-gui.log') });
    children.push({ name: 'ao', module: 'ao', stop: () => ao.stop(), pid: ao.process.pid });
    log(`AO: up on ${PORTS.ao}`);
  } else await attached('ao', `http://127.0.0.1:${PORTS.ao}/api/health`);

  // 8. Muster SPA (Vite preview of the built dist).
  if (ours('musterSpa')) {
    const preview = await startMusterPreview({ musterRoot: path.join(CES, 'ces-muster'), logPath: path.join(LOGS, 'muster-preview.log'), port: PORTS.musterSpa });
    children.push({ name: 'muster-spa', module: 'musterSpa', stop: () => preview.stop() });
    log(`Muster SPA: up on ${PORTS.musterSpa}`);
  } else await attached('musterSpa', `http://127.0.0.1:${PORTS.musterSpa}/`);

  // 8b. --prefixed: the twin of the contractor's reverse proxy (HTTPS, self-signed, one free port).
  const twin = prefixed ? await startTwin() : null;
  if (twin) {
    children.push({ name: 'twin-proxy', stop: () => twin.stop() });
    log(`twin: contractor layout on https://127.0.0.1:${twin.port} (request log ${path.relative(WT, TWIN_LOG)})`);
  }

  // 9. The walkthrough's config for this stack (gitignored). Fictional people from the scenario's review plan.
  const dr = JSON.parse(fs.readFileSync(path.join(PKG, 'customers', SLUG, 'document-reviews.json'), 'utf8'));
  let eoOperatorToken = reuse?.tokens?.eoOperator ?? '';
  if (ours('eo')) {
    const sign = await loadPrincipalSigner(CES);
    eoOperatorToken = sign(operatorClaims(dr.operator_upn), sec.eoOperator);
  } else {
    log(`note: EvidenceOps is attached: its operator token ${eoOperatorToken ? 'is kept from the last config.local.json' : 'is unknown (put it in config.local.json)'}`);
  }
  const loc = (p) => `http://127.0.0.1:${p}`;
  const config = {
    scenario: SLUG,
    tenantSlug: SLUG,
    roots: {
      testerRoot: TESTER, musterRoot: path.join(CES, 'ces-muster'), stamperRoot: path.join(CES, 'ces-stamper'), stacksimRoot: SIM_ROOT,
      tenantRoot: roots.tenantRoot, pipelineRoot: roots.pipelineRoot, storageRoot: roots.storageRoot,
    },
    urls: { musterSpa: `http://localhost:${PORTS.musterSpa}`, musterApi: loc(PORTS.musterApi), stamper: loc(PORTS.stamper), stamperBasePath: '', ao: loc(PORTS.ao), eo: loc(PORTS.eo), ec: loc(PORTS.ec), stacksim: loc(PORTS.sim) },
    crossModule: { CES_EO_URL: loc(PORTS.eo), EC_URL: loc(PORTS.ec), STACKSIM_SERVER_URL: simUrl },
    tokens: { ao: '', eo: '', eoOperator: eoOperatorToken, stamper: '' },
    musterOperator: { login: operatorLogin, password: operatorPassword },
    eoPeople: { uploaderUpn: dr.uploader.upn, reviewerUpn: dr.reviewer.upn, controlId: 'PE.L2-3.10.2', objectiveId: 'PE.L2-3.10.2[b]' },
    aoNewUser: { upn: `walkthrough.joiner@${domain}`, displayName: 'Walkthrough Joiner (fictional)' },
    customerDir: path.join(PKG, 'customers', SLUG),
    pane: { headed: true, slowMoMs: 250 },
    simulator: { managedByWalkthrough: false },
    walkthroughPort: 4600,
  };
  if (twin) {
    // Shape B: the page reaches every module through the twin's prefixes only. No roots, no shared folders.
    const t = `https://127.0.0.1:${twin.port}`;
    delete config.roots;
    Object.assign(config, {
      mode: 'remote',
      target: { name: 'local twin (contractor layout)' },
      testerRoot: TESTER,
      tls: { caFile: path.relative(WT, path.join(TWIN_DIR, 'twin-cert.pem')) },
      urls: { musterSpa: `${t}/muster`, musterApi: `${t}/muster-api`, stamper: t, stamperBasePath: '/stamper', ao: `${t}/ao`, eo: `${t}/eo`, ec: `${t}/ec`, stacksim: `${t}/stacksim` },
      tokens: { ao: '', eo: sec.eoToken, eoOperator: eoOperatorToken, stamper: sec.stamperToken },
    });
  }
  // The pid that listens on each port this call started (the Muster screens' Vite is a grandchild of npm, so the pid
  // spawn returned is not the listener). Used by scripts\mine.mjs status: "ours" means the same pid still listens.
  const listeners = Object.fromEntries(MODULES.filter(ours).map((m) => [m, listenerPid(PORTS[m])]));
  const stop = async () => {
    for (const c of [...children].reverse()) {
      try { await c.stop(); } catch { /* already gone */ }
      log(`  stopped ${c.name}`);
    }
    children.length = 0;
    try { fs.rmSync(path.join(roots.certDir), { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(path.join(TWIN_DIR, 'twin-key.pem'), { force: true }); } catch { /* best effort */ }
  };
  return { startedAt, config, twin, attached: notes, listeners, children, stop };
}

/** Stop what a startStack call started before it failed (only processes this process started). */
export async function stopStarted() {
  for (const c of [...children].reverse()) { try { await c.stop(); } catch { /* gone */ } }
  children.length = 0;
}

async function start() {
  if (fs.existsSync(STOP_FILE)) fs.rmSync(STOP_FILE);
  const held = [];
  for (const [name, port] of Object.entries(PORTS)) if (await portHeld(port)) held.push(`${port} (${name})`);
  if (held.length) {
    console.error(`REFUSE: port(s) held: ${held.join(', ')}. This fixture never stops a process it did not start.`);
    process.exit(3);
  }
  const stack = await startStack({ dir: FIX, fresh: process.argv.includes('--fresh'), prefixed: PREFIXED });
  const { startedAt, config, twin } = stack;
  fs.writeFileSync(path.join(WT, 'config.local.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(STATE_FILE, JSON.stringify({ startedAt, pid: process.pid, children: children.map((c) => ({ name: c.name, pid: c.pid ?? null })), ports: PORTS, twinPort: twin?.port ?? null }, null, 2));
  log(`READY: all modules up; config.local.json written; create ${STOP_FILE} (node scripts/fixture.mjs stop) to tear down`);

  let stopping = false;
  const shutdown = async (why) => {
    if (stopping) return;
    stopping = true;
    log(`stopping (${why}): only the processes this fixture started`);
    await stack.stop();
    try { fs.rmSync(STOP_FILE, { force: true }); } catch { /* best effort */ }
    fs.writeFileSync(STATE_FILE, JSON.stringify({ startedAt, stoppedAt: new Date().toISOString(), children: [] }, null, 2));
    log('stopped');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  setInterval(() => { if (fs.existsSync(STOP_FILE)) void shutdown('STOP file'); }, 1000);
}


// ---------------------------------------------------------------- the twin (--prefixed)
/** The openssl that ships with Git for Windows (test fixture only). */
function opensslExe() {
  const candidates = [
    ...String(process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, 'openssl.exe')),
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  ];
  const found = candidates.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } });
  if (!found) throw new Error('no openssl.exe found for the twin certificate (Git for Windows ships one)');
  return found;
}

/** A self-signed certificate with a subject alternative name, so the walkthrough's tls.caFile path is really used. */
function twinCertificate() {
  fs.rmSync(TWIN_DIR, { recursive: true, force: true });
  fs.mkdirSync(TWIN_DIR, { recursive: true });
  const key = path.join(TWIN_DIR, 'twin-key.pem');
  const cert = path.join(TWIN_DIR, 'twin-cert.pem');
  const r = spawnSync(opensslExe(), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '3',
    '-subj', '/CN=127.0.0.1/O=CES walkthrough twin (test only)', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`openssl could not make the twin certificate: ${(r.stderr ?? '').split(/\r?\n/)[0]}`);
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const TWIN_ROUTES = [
  // Longest names first: /muster-api must not be read as /muster.
  { prefix: '/muster-api', module: 'muster-api', port: PORTS.musterApi },
  { prefix: '/muster', module: 'muster', port: PORTS.musterSpa },
  { prefix: '/stamper', module: 'stamper', port: PORTS.stamper },
  { prefix: '/stacksim', module: 'stacksim', port: PORTS.sim },
  { prefix: '/ao', module: 'ao', port: PORTS.ao },
  { prefix: '/eo', module: 'eo', port: PORTS.eo },
];

const PORTAL_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Portal dashboard (twin stub)</title></head><body><h1>Portal dashboard</h1><p>Stand-in for the page the contractor serves at /. Not a CES module.</p><script type="module" src="/assets/index-portal.js"></script></body></html>';

/**
 * The twin: what PLAN.md 11.1 recorded at the contractor's address. "/" and every other root path = a stub portal;
 * root /api/* = muster-api; root /assets/* = 403 (their portal's Vite host check); /muster, /muster-api, /stamper,
 * /ao, /eo, /stacksim = the modules with the prefix stripped; /ec = 404. Host is set to the module's own address
 * (nginx's default), X-Forwarded-For and X-Forwarded-Proto are added. Bodies stream both ways (Server-Sent Events).
 * Each request is logged: method, path (no query), where it went, status, and the module the caller meant
 * (x-walkthrough-module), never other headers.
 */
async function startTwin() {
  const { key, cert } = twinCertificate();
  fs.writeFileSync(TWIN_LOG, '');
  const out = fs.createWriteStream(TWIN_LOG, { flags: 'a' });
  const agent = new http.Agent({ keepAlive: true });
  const server = https.createServer({ key, cert }, (req, res) => {
    const t0 = Date.now();
    const u = new URL(req.url ?? '/', 'https://twin');
    const p = u.pathname;
    const from = req.headers['x-walkthrough-module'] ?? null;
    const note = (route, status) => out.write(`${JSON.stringify({ at: new Date().toISOString(), method: req.method, path: p, route, status, from, ms: Date.now() - t0 })}\n`);
    const hit = TWIN_ROUTES.find((r) => p === r.prefix || p.startsWith(`${r.prefix}/`));
    if (!hit) {
      if (p === '/ec' || p.startsWith('/ec/')) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body><pre>Cannot GET ${p}</pre></body></html>`);
        return note('ec-404', 404);
      }
      if (p.startsWith('/assets/')) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Blocked request. This host ("127.0.0.1") is not allowed.');
        return note('root-assets-403', 403);
      }
      if (p !== '/api' && !p.startsWith('/api/')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PORTAL_HTML);
        return note('portal', 200);
      }
    }
    const route = hit ?? { prefix: '', module: 'root-api', port: PORTS.musterApi };
    const rest = hit ? p.slice(hit.prefix.length) || '/' : p;
    const headers = { ...req.headers, host: `127.0.0.1:${route.port}`, 'x-forwarded-for': req.socket.remoteAddress ?? '', 'x-forwarded-proto': 'https' };
    delete headers['x-walkthrough-module'];
    delete headers.connection;
    const up = http.request({ host: '127.0.0.1', port: route.port, method: req.method, path: `${rest}${u.search}`, headers, agent }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
      upRes.on('end', () => note(route.module, upRes.statusCode));
    });
    up.on('error', (err) => {
      note(route.module, 502);
      if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(`twin: ${route.module} did not answer (${err.message})`); } else res.destroy();
    });
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    req.pipe(up);
  });
  server.requestTimeout = 0;
  server.timeout = 0;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    port: server.address().port,
    stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(() => r())); out.end(); agent.destroy(); },
  };
}


// The command line runs only when this file is the entry script; scripts\mine.mjs imports startStack from it.
const isEntry = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).toLowerCase();
const cmd = isEntry ? process.argv[2] : null;
if (!isEntry) {
  /* imported */
} else if (cmd === 'start') {
  start().catch(async (err) => {
    console.error(`fixture start failed: ${err instanceof Error ? err.message : String(err)}`);
    for (const c of [...children].reverse()) { try { await c.stop(); } catch { /* gone */ } }
    process.exit(1);
  });
} else if (cmd === 'stop') {
  fs.mkdirSync(FIX, { recursive: true });
  fs.writeFileSync(STOP_FILE, new Date().toISOString());
  console.log(`stop requested (${STOP_FILE}); the start process tears down its own children`);
} else {
  console.error('usage: node scripts/fixture.mjs start|stop');
  process.exit(2);
}
