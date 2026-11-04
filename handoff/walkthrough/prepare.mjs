// "Prepare simstack" (PLAN.md section 4). It checks and links; it never restarts, stops or reseeds a running
// simulator or module server. The engine seeds only before serving (simstack-create-op.ts header), so a reseed
// would mean a restart: when the served scenario is wrong, the card shows the manual instruction instead.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

async function getJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
  } catch (err) {
    return { status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(true));
    s.setTimeout(800, () => { s.destroy(); resolve(true); });
  });
}

/** Link `link` to `target` as a directory junction (or accept it when it already is that path). */
function junction(link, target) {
  fs.mkdirSync(target, { recursive: true });
  if (path.resolve(link).toLowerCase() === path.resolve(target).toLowerCase()) return 'same folder';
  try {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink() && path.resolve(fs.realpathSync(link)).toLowerCase() === path.resolve(fs.realpathSync(target)).toLowerCase()) return 'junction (already)';
    throw new Error(`${link} exists and is not a junction to ${target}`);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  fs.symlinkSync(target, link, 'junction');
  return 'junction (made)';
}

/** The served scenario, read from the simulator's own organisation answer (id sim-tenant-<slug>, default domain <slug>.*). */
export function servedScenario(org) {
  const o = org?.value?.[0];
  if (!o) return undefined;
  if (typeof o.id === 'string' && o.id.startsWith('sim-tenant-')) return o.id.slice('sim-tenant-'.length);
  const d = (o.verifiedDomains ?? []).find((x) => x.isDefault)?.name;
  return typeof d === 'string' ? d.split('.')[0] : undefined;
}

/**
 * Shape B (PLAN.md section 11.3 item 3): probe the simulator and read the scenario it serves. Nothing is written
 * anywhere but this run's own folder: no tenant record, no junctions. Whether each module knows the tenant is read
 * and reported (a contractor-side setup fact), never changed.
 */
export async function prepareRemote({ cfg, runDir, log, http }) {
  const facts = { at: new Date().toISOString(), shape: 'remote', scenario: cfg.scenario, slug: cfg.tenantSlug, checks: [] };
  const check = (name, ok, detail) => {
    facts.checks.push({ name, ok, detail });
    log(`  prepare: ${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
    return ok;
  };
  const sim = cfg.urls.stacksim.replace(/\/+$/, '');
  const policy = await http.request(`${sim}/v1.0/policies/authorizationPolicy`, { headers: { 'x-walkthrough-module': 'stacksim' } });
  if (!check('simulator answers', policy.status === 200, `${sim}/v1.0/policies/authorizationPolicy -> HTTP ${policy.status || `no answer (${policy.error ?? ''})`}`)) {
    facts.manual = 'The simulator does not answer at the configured address. Ask the module owner to start it (RUNBOOK.md, "Start and stop each server") and to forward its prefix.';
    return { ok: false, notDrivable: true, facts };
  }
  const org = await http.request(`${sim}/v1.0/organization`, { headers: { 'x-walkthrough-module': 'stacksim' } });
  let body = null;
  try { body = org.json(); } catch { body = null; }
  const served = servedScenario(body);
  if (!check('served scenario', served === cfg.scenario, `the simulator serves "${served ?? 'unknown'}"; the walkthrough expects "${cfg.scenario}"`)) {
    facts.manual = `The simulator serves another scenario. The walkthrough never reseeds a simulator. Ask the module owner to stop "stacksim serve", run "node bin/stacksim.mjs scenario ${cfg.scenario}", then serve again (RUNBOOK.md line 27).`;
    return { ok: false, notDrivable: true, facts };
  }
  check('no shared folders', true, 'shape B: no tenant record is written and no folder is linked; every output comes from the browser or a module answer');
  const out = path.join(runDir, 'prepare.json');
  fs.writeFileSync(out, JSON.stringify(facts, null, 2));
  return { ok: true, facts, file: out };
}

export async function prepareSimstack({ cfg, runDir, log, held }) {
  const facts = { at: new Date().toISOString(), scenario: cfg.scenario, slug: cfg.tenantSlug, checks: [] };
  const check = (name, ok, detail) => {
    facts.checks.push({ name, ok, detail });
    log(`  prepare: ${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
    return ok;
  };
  const sim = cfg.urls.stacksim.replace(/\/+$/, '');
  const d = (rel) => import(pathToFileURL(path.join(cfg.roots.testerRoot, 'dist', 'src', rel)).href);

  // (1) The simulator answers and serves the configured scenario.
  let policy = await getJson(`${sim}/v1.0/policies/authorizationPolicy`);
  if (policy.status !== 200 && cfg.simulator.managedByWalkthrough === true) {
    const port = Number(new URL(sim).port || 80);
    if (port === 4390 && (await portFree(4390))) {
      log('  prepare: simulator not answering and port 4390 is free; managedByWalkthrough is on, so seeding and serving it here');
      const seed = spawnSync(process.execPath, ['bin/stacksim.mjs', 'scenario', cfg.scenario], { cwd: cfg.roots.stacksimRoot, encoding: 'utf8', windowsHide: true });
      if (seed.status !== 0) check('simulator seed', false, `stacksim scenario ${cfg.scenario} failed (rc ${seed.status})`);
      else {
        const { startServe } = await d('stacksim-client/serve-lifecycle.js');
        const serve = await startServe({ stacksimRoot: cfg.roots.stacksimRoot, stance: 'm365_azure', slug: cfg.scenario, port: 4390, logPath: path.join(runDir, 'stacksim-serve.log') });
        held.push(() => serve.stop());
        policy = await getJson(`${sim}/v1.0/policies/authorizationPolicy`);
      }
    }
  }
  if (!check('simulator answers', policy.status === 200, `${sim}/v1.0/policies/authorizationPolicy -> HTTP ${policy.status || 'no answer'}`)) {
    facts.manual = 'Start the simulator first: cd tenant-stacksim; node bin/stacksim.mjs scenario <slug>; node bin/stacksim.mjs serve m365_azure --slug <slug> --port 4390 (RUNBOOK.md, "Start and stop each server").';
    return { ok: false, notDrivable: true, facts };
  }
  const org = await getJson(`${sim}/v1.0/organization`);
  const served = servedScenario(org.body);
  if (!check('served scenario', served === cfg.scenario, `the simulator serves "${served ?? 'unknown'}"; the walkthrough expects "${cfg.scenario}"`)) {
    facts.manual = `The simulator serves another scenario. Prepare never reseeds a running simulator. Stop your "stacksim serve", run "node bin/stacksim.mjs scenario ${cfg.scenario}", then serve again (RUNBOOK.md line 27).`;
    return { ok: false, notDrivable: true, facts };
  }

  // (2) The sim tenant record under the configured tenant root: link it when usable, author it when absent.
  const rec = await d('demo/sim-tenant-record.js');
  const recordPath = rec.simRecordPath(cfg.roots.tenantRoot, cfg.tenantSlug);
  let usable = false;
  if (fs.existsSync(recordPath)) {
    try {
      usable = rec.missingSimTenantAuthFields(rec.readSimTenantAuthFields(JSON.parse(fs.readFileSync(recordPath, 'utf8')))).length === 0;
    } catch {
      usable = false;
    }
  }
  if (usable) {
    check('sim tenant record', true, `present and usable (sim\\${cfg.tenantSlug}.json under the tenant root)`);
  } else {
    const { createTenantRegistry } = await d('tenant-registry/index.js');
    const { ensureSimCert } = await d('demo/stamper-prereqs.js');
    const stateFile = path.join(WT, 'runs', 'sim-cert-state.json');
    const readThumb = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).thumbprint; } catch { return undefined; } };
    const knownThumbprint = readThumb(stateFile) ?? readThumb(path.join(cfg.roots.testerRoot, 'runs', 'show', 'sim-cert-state.json'));
    const certDir = path.join(WT, 'runs', 'cert');
    fs.mkdirSync(certDir, { recursive: true });
    const cert = await ensureSimCert({ outDir: certDir, knownThumbprint });
    fs.writeFileSync(stateFile, JSON.stringify({ thumbprint: cert.thumbprint }, null, 2));
    const registry = createTenantRegistry({ registryRoot: cfg.roots.tenantRoot, stacksimRoot: cfg.roots.stacksimRoot });
    await rec.authorSimTenantRecord({ registry, registryRoot: cfg.roots.tenantRoot, slug: cfg.tenantSlug, auth: { certThumbprint: cert.thumbprint, certPath: cert.pfxPath }, seedRef: { scenario: cfg.scenario, stance: 'm365_azure' } });
    check('sim tenant record', true, `authored (cert ${cert.route}); restart nothing: modules read the record on each request`);
  }

  // (3) The run folder's junctions, so the engine's runDir\tenant-root and runDir\pipeline are the configured roots.
  fs.mkdirSync(runDir, { recursive: true });
  check('tenant-root junction', true, junction(path.join(runDir, 'tenant-root'), cfg.roots.tenantRoot));
  check('pipeline junction', true, junction(path.join(runDir, 'pipeline'), cfg.roots.pipelineRoot));
  check('storage junction', true, junction(path.join(runDir, 'storage'), cfg.roots.storageRoot));

  // (4) prepare.json.
  const out = path.join(runDir, 'prepare.json');
  fs.writeFileSync(out, JSON.stringify(facts, null, 2));
  return { ok: true, facts, file: out };
}
