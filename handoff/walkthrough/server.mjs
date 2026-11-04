// CES Demo Commander server (the walkthrough page; PLAN.md section 1 item 6, section 13). node:http only, no dependencies of its own.
//
//   node server.mjs --config config.local.json
//
// Routes: GET / (the page) | GET /app.js | GET /content/steps.json | GET /health | GET /state | POST /prepare |
//         POST /step/<id> | GET /events (SSE) | GET /mirror/<muster|stamper|ao|eo> | GET /out/<rel> |
//         GET /setup, POST /setup (shape B: the four values the page asks for; never echoed)
//
// Paced by the person at the page: nothing runs until a button is pressed, one step at a time, no auto-advance.
// It attaches to CES modules that are already running and never starts one.
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { loadConfig, createEngine, WINDOW_MODULES, WINDOW_LABEL } from './engine.mjs';
import { prepareSimstack } from './prepare.mjs';
import { prepareRemote } from './prepare.mjs';
import { STEPS, STEP_ORDER, NotDrivable } from './steps/index.mjs';
import { detectMode, testerRootOf, isUnset, tlsOf, makeHttp, startForwarders, remoteBase, bearerFor } from './remote.mjs';

const WT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
let configPath = path.resolve(argOf('--config', path.join(WT, 'config.local.json')));
let cfg = loadConfig(configPath, path.join(WT, 'config.schema.json'));
// The run shape (PLAN.md 11.2): "ports" = shape A, "remote" = shape B. Fixed for the life of the server.
const mode = detectMode(cfg);
const targetName = () => cfg.target?.name || (mode === 'ports' ? 'kit ports' : 'remote host');
const tls = mode === 'remote' ? tlsOf(cfg, path.dirname(configPath)) : { ca: undefined, ignoreErrors: false };
const httpClient = mode === 'remote' ? makeHttp(tls) : null;
const content = JSON.parse(fs.readFileSync(path.join(WT, 'content', 'steps.json'), 'utf8'));
const port = Number(argOf('--port', cfg.walkthroughPort ?? 4600));

// The run id, run folder and pass record: set at start and again by the page's reset (PLAN.md 14.2 item 2).
let runId;
let runDir;
let passFile;
let pass;
const writePass = () => fs.writeFileSync(passFile, JSON.stringify(pass, null, 2));
function beginRun() {
  runId = `wt-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')}`;
  runDir = path.join(WT, 'runs', runId);
  fs.mkdirSync(path.join(runDir, 'steps'), { recursive: true });
  passFile = path.join(runDir, 'walkthrough-pass.json');
  pass = { schema: 'ces-walkthrough/pass@2', runId, startedAt: new Date().toISOString(), shape: mode, target: targetName(), scenario: cfg.scenario, tenantSlug: cfg.tenantSlug, steps: [] };
  writePass();
}
beginRun();

const state = { prepared: false, running: null, engine: null, held: [], last: {}, shared: {}, forwarders: null, stopping: false };

// ---------------------------------------------------------------- the launcher ("mine", PLAN.md section 12)
const MINE_DIR = path.join(WT, 'runs', 'mine');
const MINE_STATE = path.join(MINE_DIR, 'mine-state.json');
const MINE_STOP = path.join(MINE_DIR, 'STOP');
const MINE_LOG = path.join(MINE_DIR, 'mine.log');
const MINE_LABEL = { sim: 'simulator', ec: 'Evidence Collector', eo: 'EvidenceOps', musterApi: 'muster-api', stamper: 'Stamper', ao: 'AdminOps', musterSpa: 'Muster screens' };
const readMineState = () => { try { return JSON.parse(fs.readFileSync(MINE_STATE, 'utf8')); } catch { return null; } };
const pidAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };
/** 'mine' when the launcher started this server and still runs (PLAN.md 14.1 fact 3), else null. */
function launcherOf() {
  const s = readMineState();
  return s && s.serverPid === process.pid && ['ready', 'stopping'].includes(s.status) && pidAlive(s.holderPid) ? 'mine' : null;
}
/** Labels of the modules the launcher recorded as its own, in its stop order (newest first). */
function mineModules() {
  const ports = readMineState()?.ports ?? {};
  return Object.keys(ports).filter((k) => k !== 'walkthrough' && ports[k].owner === 'ours').reverse().map((k) => MINE_LABEL[k] ?? k);
}
const clients = new Set();
const emit = (event) => {
  const line = `data: ${JSON.stringify({ at: new Date().toISOString(), ...event })}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { /* client gone */ }
  }
};
const log = (line) => {
  console.log(line);
  emit({ type: 'log', step: state.running, line: String(line).slice(0, 2000) });
};

// ---------------------------------------------------------------- health
async function probe(url, { headers = {}, ok = (s) => s === 200, method = 'GET', body } = {}) {
  try {
    const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(5000) });
    const text = await r.text().catch(() => '');
    return { status: r.status, pass: ok(r.status, text), text };
  } catch (err) {
    return { status: 0, pass: false, text: '', error: err instanceof Error ? err.message : String(err) };
  }
}
const bearer = (t) => (t ? { Authorization: `Bearer ${t}` } : {});
const trim = (u) => String(u ?? '').replace(/\/+$/, '');

async function healthPorts() {
  const u = cfg.urls;
  const checks = [];
  const add = (id, label, required, r, detail) => checks.push({ id, label, required, status: r === 'unknown' ? 'unknown' : r ? 'green' : 'red', detail });
  const [sim, spa, api, st, ao, eo, ec] = await Promise.all([
    probe(`${trim(u.stacksim)}/v1.0/policies/authorizationPolicy`),
    probe(`${trim(u.musterSpa)}/`),
    probe(`${trim(u.musterApi)}/`, { ok: (s) => s > 0 }),
    probe(`${trim(u.stamper)}${u.stamperBasePath ?? ''}/api/tenants`, { headers: bearer(cfg.tokens.stamper) }),
    probe(`${trim(u.ao)}/api/health`, { headers: bearer(cfg.tokens.ao) }),
    probe(`${trim(u.eo)}/api/health`, { headers: bearer(cfg.tokens.eo) }),
    probe(`${trim(u.ec)}/api/health`, { ok: (s) => s > 0 && s < 500 }),
  ]);
  const why = (r) => (r.status ? `HTTP ${r.status}` : `no answer${r.error ? ` (${r.error.slice(0, 80)})` : ''}`);
  add('stacksim', 'Simulator (tenant-stacksim)', true, sim.pass, why(sim));
  add('musterSpa', 'Muster screens', true, spa.pass, why(spa));
  add('musterApi', 'muster-api', true, api.pass, why(api));
  // The Muster screens call muster-api from another origin; muster-api answers only origins in MUSTER_CORS_ORIGINS
  // (default http://localhost:5173 and http://localhost:4173, ces-muster\muster-api\src\app.ts).
  let spaOrigin = '';
  try { spaOrigin = new URL(u.musterSpa).origin; } catch { spaOrigin = ''; }
  const cors = await probe(`${trim(u.musterApi)}/api/auth/login`, {
    method: 'OPTIONS',
    headers: { Origin: spaOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    ok: (s) => s === 204,
  });
  add('musterCors', 'muster-api accepts the Muster screens (CORS)', true, cors.pass, cors.pass ? `allows ${spaOrigin}` : `does not allow ${spaOrigin}: start muster-api with MUSTER_CORS_ORIGINS=${spaOrigin}`);
  let stSlug = false;
  try { stSlug = JSON.parse(st.text).some((t) => t.slug === cfg.tenantSlug); } catch { stSlug = false; }
  add('stamper', 'Stamper (Configuration)', true, st.pass, why(st));
  add('stamperSlug', `Stamper lists tenant ${cfg.tenantSlug}`, false, st.pass && stSlug, st.pass ? (stSlug ? 'listed' : 'not listed yet (Prepare authors the record)') : 'Stamper not answering');
  add('ao', 'AdminOps', true, ao.pass, why(ao));
  add('eo', 'EvidenceOps', true, eo.pass, why(eo));
  add('ec', 'Evidence Collector', true, ec.pass, why(ec));
  const recordPath = path.join(cfg.roots.tenantRoot, 'sim', `${cfg.tenantSlug}.json`);
  add('record', `Sim tenant record for ${cfg.tenantSlug}`, false, fs.existsSync(recordPath), fs.existsSync(recordPath) ? 'present under the tenant root' : 'absent (Prepare authors it)');
  const distOk = fs.existsSync(path.join(cfg.roots.testerRoot, 'dist', 'src', 'demo', 'show', 'op-registry.js'));
  add('engine', 'ces-tester built (dist)', true, distOk, distOk ? 'present' : 'run npm run build in ces-tester');
  const custOk = ['interview-answers.json', 'org-content.json'].every((f) => fs.existsSync(path.join(cfg.customerDir, f)));
  add('customer', 'Scenario answer files', true, custOk, custOk ? 'present' : `missing under ${cfg.customerDir}`);
  add('pushTarget', "muster-api's CES_EO_URL (push precondition)", false, 'unknown', 'unknown, confirm manually: muster-api must be started with CES_EO_URL and CES_EO_AUTH_TOKEN, or the push skips EvidenceOps');
  const green = checks.filter((c) => c.required).every((c) => c.status === 'green');
  return { green, checks, at: new Date().toISOString() };
}

// ---------------------------------------------------------------- shape B: health, the four values, per-step needs
/** The four values shape B asks for (PLAN.md 11.6 item 1). `owner` tells the contractor where each one comes from. */
const SETUP_FIELDS = [
  { id: 'stamperToken', label: 'Stamper bearer token', path: ['tokens', 'stamper'],
    owner: 'Whoever runs Stamper sets CES_STAMPER_AUTH_TOKEN in its environment (and restarts it); paste that same value. If Stamper answers "network access to stamper requires a bearer token", the variable is not set yet.' },
  { id: 'eoToken', label: 'EvidenceOps bearer token', path: ['tokens', 'eo'],
    owner: 'Whoever runs EvidenceOps sets CES_EO_AUTH_TOKEN in its environment (and restarts it); paste that same value. If EvidenceOps answers "network access to evidenceops requires a bearer token", the variable is not set yet.' },
  { id: 'musterLogin', label: 'Muster operator login', path: ['musterOperator', 'login'],
    owner: 'An operator account on your muster-api. Whoever runs it creates one with "npx tsx scripts/seed.ts --email <login> --password <password>" in ces-muster\\muster-api.' },
  { id: 'musterPassword', label: 'Muster operator password', path: ['musterOperator', 'password'], owner: 'The password of that operator account.' },
  { id: 'eoOperator', label: 'EvidenceOps operator token (access screen, step 17)', path: ['tokens', 'eoOperator'],
    owner: 'Signed by whoever runs EvidenceOps with its CES_EO_OPERATOR_SECRET for a named operator; paste the token. It mints the uploader and approver tokens on the access screen.' },
];
const fieldValue = (f) => f.path.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), cfg);
function setupStatus() {
  return SETUP_FIELDS.map((f) => ({ id: f.id, label: f.label, owner: f.owner, set: !isUnset(fieldValue(f)) }));
}

/** What each step needs in shape B (health item ids, setup items included). Shape A gates on every required item. */
const STEP_NEEDS = {
  prepare: ['tls', 'engine', 'stacksim'],
  'sim-readout': ['tls', 'engine', 'stacksim'],
  ...Object.fromEntries(['mu-signin', 'mu-discovery', 'mu-boundary', 'mu-intent', 'mu-interview', 'mu-finish', 'mu-compile', 'mu-push']
    .map((id) => [id, ['tls', 'engine', 'customer', 'musterSpa', 'musterApi', 'musterLogin']])),
  'st-translate': ['tls', 'engine', 'stamperToken', 'stamper'],
  'st-execute': ['tls', 'engine', 'stamperToken', 'stamper'],
  'eo-baseline': ['tls', 'engine', 'eoToken', 'eo'],
  'ao-add-user': ['tls', 'engine', 'ao'],
  'ao-lockdown': ['tls', 'engine', 'ao'],
  'ao-evidence': ['tls', 'engine', 'ao'],
  'eo-change': ['tls', 'engine', 'eoToken', 'eo'],
  ...Object.fromEntries(['eo-access', 'eo-ssp', 'eo-upload', 'eo-review', 'eo-assessor'].map((id) => [id, ['tls', 'engine', 'eoToken', 'eo', 'eoOperator']])),
  'eo-explorer': ['tls', 'engine', 'eoToken', 'eo'],
};

async function healthRemote() {
  const checks = [];
  const add = (id, label, required, r, detail) => checks.push({ id, label, required, status: r === 'unknown' ? 'unknown' : r ? 'green' : 'red', detail });
  const h = httpClient;
  const tag = (m) => ({ 'x-walkthrough-module': m });
  const say = (url, r) => `${url} -> ${r.status ? `HTTP ${r.status}` : `no answer${r.error ? ` (${r.error.slice(0, 120)})` : ''}`}${r.status >= 300 && r.text ? `: ${r.text.replace(/\s+/g, ' ').slice(0, 180)}` : ''}`;
  const withBearer = (m) => { const t = bearerFor(cfg, m); return t ? { authorization: `Bearer ${t}` } : {}; };
  const anyHttps = Object.values(cfg.urls).some((x) => /^https:/.test(String(x)));
  if (tls.error) add('tls', 'Certificate of the module host', true, false, tls.error);
  else if (tls.ca) add('tls', 'Certificate of the module host', true, true, `trusted from tls.caFile (${path.basename(tls.caFile)})`);
  else if (tls.ignoreErrors) add('tls', 'Certificate of the module host', true, 'unknown', 'tls.ignoreErrors is on: certificate checks are skipped for the module host (set tls.caFile instead)');
  else add('tls', 'Certificate of the module host', true, true, anyHttps ? "the system's certificate store (no tls.caFile)" : 'plain HTTP addresses');
  const urls = {
    stacksim: `${remoteBase(cfg, 'stacksim')}/v1.0/policies/authorizationPolicy`,
    musterSpa: `${remoteBase(cfg, 'muster')}/`,
    musterApi: `${remoteBase(cfg, 'muster-api')}/api/engagements`,
    stamper: `${remoteBase(cfg, 'stamper')}/api/tenants`,
    ao: `${remoteBase(cfg, 'ao')}/api/health`,
    eo: `${remoteBase(cfg, 'eo')}/api/health`,
  };
  const [sim, spa, api, st, ao, eo] = await Promise.all([
    h.request(urls.stacksim, { headers: tag('stacksim'), timeoutMs: 8000 }),
    h.request(urls.musterSpa, { headers: tag('muster'), timeoutMs: 8000 }),
    h.request(urls.musterApi, { headers: tag('muster'), timeoutMs: 8000 }),
    h.request(urls.stamper, { headers: { ...tag('stamper'), ...withBearer('stamper') }, timeoutMs: 8000 }),
    h.request(urls.ao, { headers: { ...tag('ao'), ...withBearer('ao') }, timeoutMs: 8000 }),
    h.request(urls.eo, { headers: { ...tag('eo'), ...withBearer('eo') }, timeoutMs: 8000 }),
  ]);
  add('stacksim', 'Simulator (tenant-stacksim)', true, sim.status === 200, say(urls.stacksim, sim));
  add('musterSpa', 'Muster screens', true, spa.status === 200, say(urls.musterSpa, spa));
  const apiUp = api.status > 0 && api.status < 500;
  add('musterApi', 'muster-api', true, apiUp, apiUp ? `${urls.musterApi} answers (HTTP ${api.status}; 401 until signed in is expected)` : say(urls.musterApi, api));
  const set = Object.fromEntries(setupStatus().map((f) => [f.id, f.set]));
  add('musterLogin', 'Setup: Muster operator login and password', true, set.musterLogin && set.musterPassword, set.musterLogin && set.musterPassword ? 'set in config' : 'needed: an operator account on the muster-api (Setup panel)');
  add('stamperToken', 'Setup: Stamper bearer token', true, set.stamperToken, set.stamperToken ? 'set in config' : 'token needed from the module owner: CES_STAMPER_AUTH_TOKEN (Setup panel)');
  add('stamper', 'Stamper (Configuration)', true, st.status === 200, say(urls.stamper, st));
  let stSlug = false;
  try { stSlug = st.status === 200 && st.json().some((t) => t.slug === cfg.tenantSlug); } catch { stSlug = false; }
  add('stamperSlug', `Stamper lists tenant ${cfg.tenantSlug}`, false, st.status === 200 ? stSlug : 'unknown', st.status === 200 ? (stSlug ? 'listed' : 'not listed: the module owner registers the tenant') : 'not readable until Stamper answers');
  add('ao', 'AdminOps', true, ao.status === 200, say(urls.ao, ao));
  add('eoToken', 'Setup: EvidenceOps bearer token', true, set.eoToken, set.eoToken ? 'set in config' : 'token needed from the module owner: CES_EO_AUTH_TOKEN (Setup panel)');
  add('eo', 'EvidenceOps', true, eo.status === 200, say(urls.eo, eo));
  add('eoOperator', 'Setup: EvidenceOps operator token', true, set.eoOperator, set.eoOperator ? 'set in config' : 'needed for the access screen, step 17 (Setup panel)');
  const tr = testerRootOf(cfg);
  const distOk = Boolean(tr) && fs.existsSync(path.join(tr, 'dist', 'src', 'demo', 'show', 'op-registry.js'));
  add('engine', 'ces-tester built (dist) on this machine', true, distOk, distOk ? 'present' : `run npm run build in ${tr ?? 'ces-tester (testerRoot)'}`);
  const custOk = ['interview-answers.json', 'org-content.json'].every((f) => fs.existsSync(path.join(cfg.customerDir, f)));
  add('customer', 'Scenario answer files (typed into Muster)', true, custOk, custOk ? 'present' : `missing under ${cfg.customerDir}`);
  add('pushTarget', "muster-api's CES_EO_URL (push precondition)", false, 'unknown', 'unknown, confirm with the module owner: muster-api must be started with CES_EO_URL and CES_EO_AUTH_TOKEN, or the push skips EvidenceOps');
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  const done = (id) => ['ok', 'not yet drivable'].includes(state.last[id]?.status);
  const unmet = (id) => (STEP_NEEDS[id] ?? []).map((n) => byId[n]).filter((c) => c && c.status === 'red');
  const steps = {};
  STEP_ORDER.forEach((id, i) => {
    const own = unmet(id);
    // The flow runs in order (PLAN.md section 3): a step also waits on what any unfinished earlier step waits on.
    const open = STEP_ORDER.slice(0, i).filter((p) => !done(p));
    const inherited = open.flatMap(unmet);
    const values = [...new Map([...own, ...inherited].map((c) => [c.id, c])).values()];
    const waitsOn = values.map((c) => `${c.label}: ${c.detail}`);
    if (open.length) waitsOn.push(`step ${STEP_ORDER.indexOf(open[0])} first (${open[0]})`);
    steps[id] = {
      ready: own.length === 0 && open.length === 0,
      kind: own.some((c) => c.label.startsWith('Setup:')) ? 'setup' : own.length ? 'health' : open.length ? 'order' : null,
      waitsOnValues: values.map((c) => c.id),
      waitsOn,
    };
  });
  const green = checks.filter((c) => c.required).every((c) => c.status === 'green');
  return { green, shape: mode, target: targetName(), setup: setupStatus(), checks, steps, at: new Date().toISOString() };
}

async function health() {
  if (mode === 'remote') return healthRemote();
  const h = await healthPorts();
  return { ...h, shape: mode, target: targetName(), steps: Object.fromEntries(STEP_ORDER.map((id) => [id, { ready: h.green, kind: h.green ? null : 'health', waitsOn: [] }])) };
}

// ---------------------------------------------------------------- steps
function stepText(id) {
  return content.steps.find((s) => s.id === id) ?? { id, title: id };
}

/** The module window a step drives (content/steps.json "module"; "sim" uses the Muster window); none for Prepare. */
function windowOf(id) {
  if (id === 'prepare') return null;
  const m = stepText(id).module;
  return m === 'sim' ? 'muster' : WINDOW_MODULES.includes(m) ? m : null;
}

function makeCtx(id) {
  const workDir = path.join(runDir, 'steps', id);
  fs.mkdirSync(workDir, { recursive: true });
  const artifacts = [];
  const windowShots = new Set();
  const engine = state.engine;
  const win = windowOf(id);
  const pane = engine && win ? engine.windows[win] : null;
  return {
    id,
    cfg,
    runDir,
    workDir,
    engine,
    window: win,
    raw: pane?.session.raw,
    page: pane?.page,
    state: state.shared,
    http: httpClient,
    emitCaption: (text) => emit({ type: 'caption', step: id, text }),
    artifacts,
    windowShots,
    artifact: (p) => { if (p && !artifacts.includes(p)) artifacts.push(p); },
    log: (line) => log(line),
    caption: async (text) => {
      emit({ type: 'caption', step: id, text });
      if (engine) await engine.caption(text, win ?? 'muster').catch(() => undefined);
    },
  };
}

/** Copy every artifact into runs\<runId>\steps\<id>\ and give it an HTTP link under /out/. */
function publishArtifacts(id, list, windowShots = new Set(), win = null) {
  const dir = path.join(runDir, 'steps', id);
  const out = [];
  const used = new Set();
  for (const p of list) {
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
    let dest = p;
    if (path.resolve(path.dirname(p)).toLowerCase() !== path.resolve(dir).toLowerCase()) {
      let name = path.basename(p);
      while (used.has(name.toLowerCase()) || fs.existsSync(path.join(dir, name))) name = `copy-${name}`;
      dest = path.join(dir, name);
      fs.copyFileSync(p, dest);
    }
    used.add(path.basename(dest).toLowerCase());
    out.push({ path: dest, url: `/out/steps/${encodeURIComponent(id)}/${encodeURIComponent(path.basename(dest))}`, source: p === dest ? undefined : p, ...(windowShots.has(p) && win ? { window: win } : {}) });
  }
  return out;
}

async function runStep(id) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  state.running = id;
  const win = windowOf(id);
  emit({ type: 'step', id, status: 'running', title: stepText(id).title, window: win });
  let result;
  const ctx = makeCtx(id);
  if (win && state.engine) await state.engine.windows[win].session.raw.bringToFront().catch(() => undefined);
  try {
    if (id === 'prepare') {
      const r = mode === 'remote'
        ? await prepareRemote({ cfg, runDir, log, http: httpClient })
        : await prepareSimstack({ cfg, runDir, log, held: state.held });
      if (r.file) ctx.artifact(r.file);
      else {
        const f = path.join(ctx.workDir, 'prepare.json');
        fs.writeFileSync(f, JSON.stringify(r.facts, null, 2));
        ctx.artifact(f);
      }
      if (r.ok) {
        if (!state.engine) {
          log('  prepare: opening the four module windows (Muster, Stamper, AdminOps, EvidenceOps) and the live view');
          state.engine = await createEngine({ cfg, runDir, runId, log, onCaption: (text) => emit({ type: 'caption', step: state.running, text }), remote: state.forwarders ?? undefined });
          pass.windowOrigins = state.engine.homeOrigins;
        }
        state.prepared = true;
        result = { ok: true };
      } else {
        result = { ok: false, status: 'not yet drivable', error: r.facts.manual ?? 'prepare checks failed' };
      }
    } else {
      result = await STEPS[id](ctx);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = err instanceof NotDrivable
      ? { ok: false, status: 'not yet drivable', error: message, pointer: err.pointer }
      : { ok: false, status: 'failed', error: message.slice(0, 4000) };
  }
  const status = result.ok ? 'ok' : result.status ?? 'failed';
  let windows = null;
  if (state.engine && win) {
    // The step's window as the step left it (DONE 13); "when-it-stopped" when the step did not finish.
    const f = path.join(ctx.workDir, result.ok ? `${id}-${win}-window.png` : 'when-it-stopped.png');
    await ctx.raw.screenshot({ path: f, fullPage: true }).then(() => { ctx.artifact(f); ctx.windowShots.add(f); }).catch(() => undefined);
    if (result.ok && id.startsWith('st-')) {
      // Stamper's result card, rendered in the headless readout pane so the Stamper console stays on screen.
      const fc = path.join(ctx.workDir, `${id}-result-card.png`);
      await state.engine.readout.session.raw.screenshot({ path: fc, fullPage: true }).then(() => ctx.artifact(fc)).catch(() => undefined);
    }
    // The window is a real browser: say where the next action comes from, so nobody presses the screen's own buttons.
    await state.engine.label(win, `last step: ${stepText(id).title} (${status}) · next: press Next step on the Demo Commander page`);
  }
  if (state.engine) windows = state.engine.windowsState();
  const artifacts = publishArtifacts(id, ctx.artifacts, ctx.windowShots, win);
  const row = { id, title: stepText(id).title, startedAt, ms: Date.now() - t0, status, window: win, windows, artifacts, error: result.ok ? null : result.error ?? 'failed', ...(result.pointer ? { pointer: result.pointer } : {}), ...(result.findings ? { findings: result.findings } : {}) };
  pass.steps.push(row);
  writePass();
  state.last[id] = row;
  state.running = null;
  log(`step ${id}: ${status}${row.error ? ` (${row.error.split('\n')[0].slice(0, 300)})` : ''} in ${(row.ms / 1000).toFixed(1)} s`);
  emit({ type: 'step', ...row });
  return row;
}

// ---------------------------------------------------------------- http
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.zip': 'application/zip', '.pdf': 'application/pdf', '.log': 'text/plain; charset=utf-8' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const sendFile = (res, file) => {
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
};

/** Read a small JSON request body (the Setup form). */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= 64 * 1024) chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/**
 * Save the Setup panel's values into config.local.json on this machine (PLAN.md 11.6 item 1), reload the config and
 * answer with which values are set. Values are never echoed, logged or written anywhere else.
 */
function saveSetup(body) {
  const given = SETUP_FIELDS.filter((f) => typeof body?.[f.id] === 'string' && body[f.id].trim() !== '');
  if (given.length === 0) return [400, { error: 'no value given' }];
  const local = path.join(WT, 'config.local.json');
  const activeIsLocal = path.resolve(configPath).toLowerCase() === path.resolve(local).toLowerCase();
  if (!activeIsLocal && fs.existsSync(local)) {
    return [409, { error: `config.local.json already exists in ${WT}; start the server with --config config.local.json so the Setup panel saves there` }];
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  for (const f of given) {
    let o = raw;
    for (const k of f.path.slice(0, -1)) o = o[k] ??= {};
    o[f.path[f.path.length - 1]] = body[f.id].trim();
  }
  fs.writeFileSync(local, JSON.stringify(raw, null, 2));
  configPath = local;
  cfg = loadConfig(configPath, path.join(WT, 'config.schema.json'));
  log(`setup: saved ${given.length} value(s) to config.local.json (${given.map((f) => f.label).join(', ')}); values are not shown`);
  return [200, { saved: given.map((f) => f.id), fields: setupStatus() }];
}

function publicState() {
  return {
    runId,
    prepared: state.prepared,
    running: state.running,
    launcher: launcherOf(),
    stopping: state.stopping,
    order: STEP_ORDER,
    tenantSlug: cfg.tenantSlug,
    scenario: cfg.scenario,
    shape: mode,
    target: targetName(),
    headed: cfg.pane.headed === true,
    windows: WINDOW_MODULES.map((m) => ({ id: m, label: WINDOW_LABEL[m] })),
    steps: Object.fromEntries(STEP_ORDER.map((id) => [id, state.last[id] ?? null])),
  };
}

// ---------------------------------------------------------------- stop (PLAN.md 14.2 item 2)
let relay = null;
/** Relay every new line of runs\mine\mine.log to the feed, from `relay.offset` on. */
function relayMineLog() {
  if (!relay) return;
  let size = 0;
  try { size = fs.statSync(MINE_LOG).size; } catch { return; }
  if (size <= relay.offset) return;
  const buf = Buffer.alloc(size - relay.offset);
  const fd = fs.openSync(MINE_LOG, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, relay.offset); } finally { fs.closeSync(fd); }
  relay.offset = size;
  const lines = (relay.rest + buf.toString('utf8')).split(/\r?\n/);
  relay.rest = lines.pop();
  for (const l of lines) {
    const text = l.replace(/^\[mine \d\d:\d\d:\d\d\]\s*/, '').trim();
    if (text) log(`stop: ${text}`);
  }
}

async function stopRun(by) {
  const launcher = launcherOf();
  const modules = launcher ? mineModules() : [];
  emit({ type: 'stopping', launcher, modules });
  if (state.engine) await state.engine.dispose().catch(() => undefined);
  for (const stop of state.held) await Promise.resolve(stop()).catch(() => undefined);
  state.held = [];
  removeJunctions([runDir]);
  state.engine = null;
  state.prepared = false;
  pass.stoppedAt = new Date().toISOString();
  writePass();
  if (launcher) {
    // The launcher stops the modules; its log lines come to the feed until it sends STOP-SERVER.
    relay = { offset: 0, rest: '', modules };
    try { relay.offset = fs.statSync(MINE_LOG).size; } catch { relay.offset = 0; }
    if (by !== 'launcher') {
      log('stop: asking the launcher to stop the modules it started');
      fs.writeFileSync(MINE_STOP, new Date().toISOString());
    }
    setInterval(relayMineLog, 500).unref();
    return;
  }
  log('stop: the modules were left running: this page did not start them');
  log(`stop: the output links of run ${runId} no longer resolve on this page`);
  beginRun();
  state.last = {};
  state.shared = {};
  state.held = [];
  state.running = null;
  state.stopping = false;
  log(`stop: new run ${runId}`);
  emit({ type: 'reset', runId });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return sendFile(res, path.join(WT, 'public', 'index.html'));
    if (req.method === 'GET' && p === '/app.js') return sendFile(res, path.join(WT, 'public', 'app.js'));
    if (req.method === 'GET' && p === '/content/steps.json') return sendFile(res, path.join(WT, 'content', 'steps.json'));
    if (req.method === 'GET' && p === '/health') return send(res, 200, await health());
    if (req.method === 'GET' && p === '/state') return send(res, 200, publicState());
    if (req.method === 'GET' && p === '/setup') return send(res, 200, { shape: mode, fields: setupStatus() });
    if (req.method === 'POST' && p === '/setup') {
      if (mode !== 'remote') return send(res, 409, { error: 'the Setup panel is for shape B (remote); shape A reads config.local.json' });
      if (state.running) return send(res, 409, { error: `step ${state.running} is still running; save the values when it has finished` });
      const body = await readBody(req);
      return send(res, ...saveSetup(body));
    }
    if (req.method === 'GET' && p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', ...publicState() })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 15000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return undefined;
    }
    if (req.method === 'GET' && p.startsWith('/mirror/')) {
      const module = p.slice('/mirror/'.length);
      if (!WINDOW_MODULES.includes(module)) return send(res, 404, { error: `no window ${module}` });
      const m = state.engine ? state.engine.mirrors[module] : null;
      if (!m) return send(res, 503, 'The live view starts after "Prepare".', 'text/plain; charset=utf-8');
      m.subscribe(res);
      req.on('close', () => m.unsubscribe(res));
      return undefined;
    }
    if (req.method === 'GET' && p.startsWith('/out/')) {
      const rel = decodeURIComponent(p.slice('/out/'.length));
      const file = path.resolve(runDir, rel);
      const stepsRoot = path.resolve(runDir, 'steps');
      const allowed = file.toLowerCase().startsWith(stepsRoot.toLowerCase() + path.sep);
      if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
      const real = fs.realpathSync(file);
      if (!real.toLowerCase().startsWith(fs.realpathSync(stepsRoot).toLowerCase() + path.sep)) return send(res, 404, { error: 'not found' });
      return sendFile(res, real);
    }
    if (req.method === 'POST' && p === '/stop') {
      const body = await readBody(req);
      if (state.stopping) return send(res, 200, { stopping: true });
      if (state.running) return send(res, 409, { error: `step ${state.running} is still running; wait for it to finish, then stop` });
      state.stopping = true;
      void stopRun(body?.by === 'launcher' ? 'launcher' : 'page');
      return send(res, 202, { stopping: true });
    }
    if (req.method === 'POST' && p === '/dev/click') {
      // Proof tool only (WALKTHROUGH_DEV=1): act in a module window the way a person at that window would, to test
      // how a step copes with a hand action between steps (DC-FAILURES.md, 2026-11-04 step 7). Off otherwise.
      if (process.env.WALKTHROUGH_DEV !== '1') return send(res, 404, { error: 'not found' });
      const body = await readBody(req);
      const pane = state.engine && WINDOW_MODULES.includes(body.window) ? state.engine.windows[body.window] : null;
      if (!pane || typeof body.testid !== 'string') return send(res, 400, { error: 'window and testid needed, after Prepare' });
      if (state.running) return send(res, 409, { error: `step ${state.running} is still running` });
      await pane.session.raw.locator(`[data-testid="${body.testid.replace(/"/g, '')}"]`).first().click({ timeout: 10000 });
      log(`  dev: clicked ${body.testid} in the ${WINDOW_LABEL[body.window]} window (a hand action between steps)`);
      return send(res, 200, { clicked: body.testid, window: body.window });
    }
    if (req.method === 'POST' && (p === '/prepare' || p.startsWith('/step/'))) {
      const id = p === '/prepare' ? 'prepare' : decodeURIComponent(p.slice('/step/'.length));
      if (id !== 'prepare' && !STEPS[id]) return send(res, 404, { error: `no step ${id}` });
      if (state.stopping) return send(res, 409, { error: 'the page is stopping' });
      if (state.running) return send(res, 409, { error: `step ${state.running} is still running; wait for it to finish` });
      if (id !== 'prepare' && !state.prepared) return send(res, 409, { error: 'press "Prepare simstack" first' });
      const h = await health();
      if (mode === 'remote') {
        const need = h.steps[id];
        if (!need.ready) return send(res, 412, { error: `step ${id} waits on setup or health`, kind: need.kind, waitsOnValues: need.waitsOnValues, red: need.waitsOn });
      } else if (!h.green) {
        return send(res, 412, { error: 'health is red', kind: 'health', red: h.checks.filter((c) => c.required && c.status !== 'green').map((c) => `${c.label}: ${c.detail}`) });
      }
      if (state.running) return send(res, 409, { error: `step ${state.running} is still running` });
      if (state.stopping) return send(res, 409, { error: 'the page is stopping' });
      state.running = id;
      void runStep(id);
      return send(res, 202, { started: id, runId });
    }
    return send(res, 404, { error: 'not found' });
  } catch (err) {
    return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

// Shape B: one forwarder per module on this machine (remote.mjs), started before the page is served.
if (mode === 'remote') {
  state.forwarders = await startForwarders({ getCfg: () => cfg, httpClient, log: (l) => console.log(l), logFile: path.join(runDir, 'forwarder-requests.jsonl') });
}

// Every interface by default, like the CES modules (no module is meant to be loopback-only); --host names one.
const host = argOf('--host', '0.0.0.0');
server.listen(port, host, () => {
  console.log(`CES Demo Commander on http://127.0.0.1:${port}/ (bound to ${host}; shape ${mode === 'remote' ? 'B, remote' : 'A, ports'}; target ${targetName()}; run ${runId}; outputs under ${runDir})`);
});

/**
 * Remove the run folders' junctions (tenant-root, pipeline, storage). They point INTO your module folders: removing
 * the link only (never a recursive delete) means a later clean-up of runs\ can never reach your data.
 */
function removeJunctions(dirs) {
  for (const dir of dirs) {
    for (const name of ['tenant-root', 'pipeline', 'storage']) {
      const link = path.join(dir, name);
      try {
        if (fs.lstatSync(link).isSymbolicLink()) fs.rmdirSync(link);
      } catch { /* absent */ }
    }
  }
}
// Junctions left by a run that was killed instead of stopped.
try {
  const runsRoot = path.join(WT, 'runs');
  removeJunctions(fs.readdirSync(runsRoot).filter((n) => n.startsWith('wt-') && n !== runId).map((n) => path.join(runsRoot, n)));
} catch { /* first run */ }

/** End every event stream and wait for each to finish (bounded, 2 s), so the last event is never lost. */
async function closeStreams() {
  await Promise.all([...clients].map((res) => Promise.race([
    new Promise((resolve) => { try { res.end(resolve); } catch { resolve(); } }),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])));
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('Demo Commander: closing the four module windows and the readout pane, and removing the run folder links');
  await closeStreams();
  if (state.engine) await state.engine.dispose().catch(() => undefined);
  for (const stop of state.held) await Promise.resolve(stop()).catch(() => undefined);
  if (state.forwarders) await state.forwarders.stop().catch(() => undefined);
  httpClient?.close();
  removeJunctions([runDir]);
  server.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
// `node scripts/stop-server.mjs` (or creating runs\STOP-SERVER) stops this server cleanly, as Ctrl+C does.
const stopFile = path.join(WT, 'runs', 'STOP-SERVER');
try { fs.rmSync(stopFile, { force: true }); } catch { /* none */ }
setInterval(() => {
  if (!fs.existsSync(stopFile)) return;
  fs.rmSync(stopFile, { force: true });
  if (relay) {
    // The launcher's stop (PLAN.md 14.2 item 2): its last lines, then "stopped", before the streams close.
    relayMineLog();
    emit({ type: 'stopped', modules: relay.modules, restart: 'Start-Mine.ps1' });
  }
  void shutdown();
}, 1000).unref();
