// The walkthrough's bridge to ces-tester's compiled demo engine (PLAN.md section 1, items 1-5; section 13.2 item 1).
// - Loads the engine from <testerRoot>\dist\src\demo\show\ (no install of its own; playwright resolves from ces-tester).
// - Builds synthetic decks in code (the act harness pattern, act-run.ts syntheticSlide), one slide per op-backed step.
// - Opens four module windows (Muster, Stamper, AdminOps, EvidenceOps) that stay open from Prepare until Stop, plus a
//   headless readout pane for Stamper's result cards (PLAN.md 13.2 item 1).
// - Calls makeShowOps once per module window, with deps.arm returning an ArmedSim filled from config (attach, never
//   spawn; no-op stop); the Stamper runner's deps.openBackstage returns the Stamper window.
// - Streams each module window as MJPEG (PaneMirror) for the page's live view.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectMode, testerRootOf, KEY_HEADER } from './remote.mjs';

/** Read and check config.local.json against config.schema.json (required fields, recursively). */
export function loadConfig(configPath, schemaPath) {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const missing = [];
  const walk = (value, node, at) => {
    if (!node || node.type !== 'object') return;
    for (const key of node.required ?? []) {
      if (value === null || typeof value !== 'object' || !(key in value)) missing.push(`${at}${key}`);
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      if (value && typeof value === 'object' && key in value) walk(value[key], child, `${at}${key}.`);
    }
  };
  walk(cfg, schema, '');
  // Shape A (ports) also needs the module folders it links; shape B (remote) needs only the engine's folder.
  if (detectMode(cfg) === 'ports') {
    for (const key of ['testerRoot', 'musterRoot', 'stamperRoot', 'stacksimRoot', 'tenantRoot', 'pipelineRoot', 'storageRoot']) {
      if (!cfg.roots || !(key in cfg.roots)) missing.push(`roots.${key}`);
    }
  } else if (!testerRootOf(cfg)) missing.push('testerRoot');
  if (missing.length) throw new Error(`config ${configPath} is missing: ${missing.join(', ')} (see config.schema.json)`);
  return cfg;
}

/** The op-backed steps: step id -> engine op id and its params (PLAN.md section 3, kind "op"). */
export const OP_STEPS = {
  'sim-readout': { opId: 'simstack-create', params: {} },
  'mu-finish': { opId: 'muster-generate-sprs-mp', params: {} },
  'st-translate': { opId: 'stamper-translate', params: {} },
  'st-execute': { opId: 'stamper-execute', params: {} },
  'eo-baseline': { opId: 'eo-review', params: { land: 'sprs', family: 'AC' } },
  'ao-lockdown': { opId: 'ao-make-change', params: { command: 'A-18' } },
  'eo-change': { opId: 'eo-show-change-captured', params: { control: 'AC.L1-3.1.2', family: 'AC' } },
  'eo-explorer': { opId: 'eo-review', params: { land: 'evidence', family: 'AC' } },
};

/** The four module windows (PLAN.md 13.2 item 1) and their labels. */
export const WINDOW_MODULES = ['muster', 'stamper', 'ao', 'eo'];
export const WINDOW_LABEL = { muster: 'Muster', stamper: 'Stamper', ao: 'AdminOps', eo: 'EvidenceOps' };
/** One engine runner per module window; each deck holds that module's op-backed steps (PLAN.md 13.2 item 1). */
export const RUNNER_DECKS = {
  muster: ['sim-readout', 'mu-finish'],
  stamper: ['st-translate', 'st-execute'],
  ao: ['ao-lockdown'],
  eo: ['eo-baseline', 'eo-change', 'eo-explorer'],
};
const runnerOf = (stepId) => Object.keys(RUNNER_DECKS).find((m) => RUNNER_DECKS[m].includes(stepId));

export async function createEngine({ cfg, runDir, runId, log, onCaption, remote }) {
  const testerRoot = testerRootOf(cfg);
  const d = (rel) => import(pathToFileURL(path.join(testerRoot, 'dist', 'src', rel)).href);
  const registry = await d('demo/show/op-registry.js');
  const catalog = await d('demo/show/op-catalog.js');
  const appPane = await d('demo/show/app-pane.js');
  const mirrorMod = await d('demo/show/screencast-mirror.js');
  const theatre = await d('demo/show/theatrical-page.js');

  const cesRoot = path.resolve(testerRoot, '..');
  const options = {
    deckPath: path.join(runDir, '<synthetic:walkthrough>'),
    slidesPort: 0,
    defaultDwellSec: 30,
    auto: false,
    presenter: false,
    slidesGeometry: appPane.DEFAULT_SLIDES_GEOMETRY,
    appGeometry: appPane.DEFAULT_APP_GEOMETRY,
    testerRoot,
    stacksimRoot: cfg.roots?.stacksimRoot,
    aoRoot: path.join(cesRoot, 'ces-ao'),
    eoRoot: path.join(cesRoot, 'ces-eo'),
    stamperRoot: cfg.roots?.stamperRoot,
    musterRoot: cfg.roots?.musterRoot,
    runId,
    report: false,
  };

  const ids = Object.keys(OP_STEPS);
  const slideFor = (stepId, extraParams = {}) => {
    const { opId, params } = OP_STEPS[stepId];
    const index = ids.indexOf(stepId);
    const declared = new Set(catalog.OP_CATALOG[opId].params.map((p) => p.key));
    const toValidate = {};
    const passThrough = {};
    for (const [k, v] of Object.entries({ ...params, ...extraParams })) (declared.has(k) ? toValidate : passThrough)[k] = String(v);
    const v = catalog.validateParams(opId, toValidate);
    if (v.errors.length) throw new Error(`params for ${opId}: ${v.errors.join('; ')}`);
    return {
      slideNumber: index + 1,
      rows: [{ sheetRow: index + 2, slideNumber: index + 1, feature: stepId }],
      op: { mode: 'live', opId, tools: [catalog.OP_CATALOG[opId].target], images: [], params: { ...v.resolved, ...passThrough } },
    };
  };
  const deckOf = (stepIds) => ({
    sourcePath: options.deckPath,
    baseDir: testerRoot,
    title: 'CES Demo Commander',
    slides: stepIds.map((id) => slideFor(id)),
    assets: [],
    warnings: [],
  });

  const headed = cfg.pane.headed === true;
  const slowMo = Number(cfg.pane.slowMoMs ?? 250);
  // PLAN.md 13.2 item 3: each window placed from config pane.windows (scripts\mine.mjs measures the screen when it is
  // absent). This fallback is four 1024-wide columns from the left edge.
  const fallback = {
    muster: { x: 0, y: 0, width: 1024, height: 1000 },
    stamper: { x: 1024, y: 0, width: 1024, height: 1000 },
    ao: { x: 2048, y: 0, width: 1024, height: 1000 },
    eo: { x: 3072, y: 0, width: 1024, height: 1000 },
  };
  const geometryOf = (m) => ({ ...fallback[m], ...(cfg.pane.windows?.[m] ?? {}) });
  const openPane = async (geometry, { visible = headed, theatre: withTheatre = true } = {}) => {
    const p = await appPane.openAppPane({ geometry, slowMo: visible ? slowMo : 0, headless: !visible, theatre: withTheatre });
    // Shape B: the run key the Stamper and EvidenceOps forwarders require (remote.mjs). Sent on every request of this
    // window, page.request included; it opens nothing beyond this machine's own forwarders.
    if (remote) await p.session.raw.context().setExtraHTTPHeaders({ [KEY_HEADER]: remote.key });
    return p;
  };

  const windows = {};
  const mirrors = {};
  for (const m of WINDOW_MODULES) {
    windows[m] = await openPane(geometryOf(m));
    mirrors[m] = new mirrorMod.PaneMirror({ screencast: mirrorMod.BACKSTAGE_SCREENCAST, log });
    await mirrors[m].attach(windows[m].session.raw);
  }
  // The readout pane: headless, never placed, never displayed. Stamper's result cards render here (PLAN.md 13.1 item 3).
  const readout = await openPane({ width: 1280, height: 900, x: 0, y: 0 }, { visible: false, theatre: false });
  // The Stamper window is the Stamper runner's backstage; that runner's dispose closes it, so it closes once only.
  let stamperClosed = false;
  const stamperClose = windows.stamper.close;
  windows.stamper.close = async () => {
    if (stamperClosed) return;
    stamperClosed = true;
    await stamperClose();
  };

  const stamperBase = `${cfg.urls.stamper.replace(/\/+$/, '')}${cfg.urls.stamperBasePath ?? ''}`;
  // Shape B: the engine's acts reach each module through its forwarder, at the root of an origin as on the kit ports.
  const armed = {
    slug: cfg.tenantSlug,
    simUrl: cfg.urls.stacksim,
    aoBaseUrl: remote ? remote.origins.ao : cfg.urls.ao,
    eoBaseUrl: remote ? remote.origins.eo : cfg.urls.eo,
    stamperBaseUrl: remote ? remote.origins.stamper : stamperBase,
    musterBaseUrl: remote ? remote.origins.muster : cfg.urls.musterSpa,
    runDir,
    stop: async () => undefined,
  };
  const homeOf = { muster: armed.musterBaseUrl, stamper: armed.stamperBaseUrl, ao: armed.aoBaseUrl, eo: armed.eoBaseUrl };
  const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

  // PLAN.md 13.1 item 2: makeShowOps pins captions on its closure pane, so each module window gets its own runner.
  // The Stamper runner's closure pane is the readout pane; its backstage is the Stamper window.
  const runnerLog = (line) =>
    log(/backstage session up/.test(line)
      ? `  prep: Stamper window ready (${headed ? 'a visible browser window' : 'headless'}, streamed on the Stamper live view)`
      : line);
  const runners = {};
  for (const [module, stepIds] of Object.entries(RUNNER_DECKS)) {
    runners[module] = registry.makeShowOps(module === 'stamper' ? readout : windows[module], deckOf(stepIds), options, {
      arm: async () => armed,
      openBackstage: async () => windows.stamper,
      log: runnerLog,
    });
    await runners[module].prepare();
  }

  const label = async (module, detail) => {
    await theatre.paneHud.show(appPane.hudSurfaceOf(windows[module]), WINDOW_LABEL[module], detail).catch(() => undefined);
  };
  // Every window opens on its own module and is labelled, so the four can be told apart from Prepare on.
  for (const m of WINDOW_MODULES) {
    await windows[m].session.raw.goto(homeOf[m], { waitUntil: 'domcontentloaded' })
      .catch((err) => log(`  prep: the ${WINDOW_LABEL[m]} window did not open ${homeOf[m]}: ${err instanceof Error ? err.message : String(err)}`));
    await label(m, 'ready');
  }

  const windowFor = (module) => windows[module === 'sim' ? 'muster' : module] ?? null;
  return {
    remote,
    windows,
    mirrors,
    readout,
    /** The Stamper window (the Stamper runner's backstage). */
    backstage: () => windows.stamper,
    /** The window a step's module drives ("sim" uses the Muster window). */
    windowFor,
    /** The origin each window should end on (DONE 12). */
    homeOrigins: Object.fromEntries(WINDOW_MODULES.map((m) => [m, originOf(homeOf[m])])),
    /** For each window: open or not, and the origin of its current page. */
    windowsState: () => Object.fromEntries(WINDOW_MODULES.map((m) => {
      const raw = windows[m].session.raw;
      const open = !raw.isClosed() && raw.context().browser()?.isConnected() !== false;
      return [m, { open, origin: open ? originOf(raw.url()) : null }];
    })),
    /** Re-pin a window's label (a page load wipes it, and the engine's acts replace it while they run). */
    label,
    /** Pin a caption on a module's window (the same band the engine's acts use). */
    caption: async (text, module = 'muster') => {
      const w = windowFor(module);
      if (w) await theatre.paneCaption.show(appPane.hudSurfaceOf(w), text);
    },
    /** Run one op-backed step through its module's runner. */
    runOp: async (stepId, sctx, extraParams = {}) => {
      const module = runnerOf(stepId);
      const slide = slideFor(stepId, extraParams);
      const opLog = (line) => {
        const m = /^\s*caption:\s*(.*)$/.exec(line);
        if (m) onCaption(m[1]);
        else sctx.log(line.replace('BACKSTAGE (headless, never displayed)', 'in the Stamper window'));
      };
      const pane = module === 'stamper' ? readout : windows[module];
      await runners[module].run({ pane, slide, index: slide.slideNumber - 1, options, log: opLog, artifact: sctx.artifact });
    },
    dispose: async () => {
      for (const m of WINDOW_MODULES) await mirrors[m].dispose().catch(() => undefined);
      // One feed line per window (PLAN.md 14.2 item 2). The windows close before the runners' dispose, so the Stamper
      // window (the Stamper runner's backstage, guarded) closes here, in label order.
      for (const m of WINDOW_MODULES) {
        log(`stop: closing the ${WINDOW_LABEL[m]} window`);
        await windows[m].close().catch(() => undefined);
      }
      for (const r of Object.values(runners)) await r.dispose?.().catch(() => undefined);
      log('stop: closing the readout pane');
      await readout.close().catch(() => undefined);
    },
  };
}
