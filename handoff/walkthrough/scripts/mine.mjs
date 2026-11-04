// The launcher (PLAN.md section 12): the Demo Commander against Muster, Stamper, EvidenceOps, AdminOps, the Evidence
// Collector and the simulator started on this machine's kit ports from the built clone (C:\ces-nb\ces, or
// %WALKTHROUGH_ROOT%\ces when that variable is set). It reuses the module starter's code (scripts\fixture.mjs
// startStack) instead of a copy.
//
//   node scripts/mine.mjs start [--keep] [--no-open]
//        For each kit port: free -> start that module from the built clone; held by a process this launcher did not start
//        -> "attached": not started, not reseeded, never stopped (the health panel decides). Then the walkthrough
//        server on 4600 (refused when 4600 is held) and the default browser at http://127.0.0.1:4600/.
//        --fresh (the default) empties runs\mine's data folders and reseeds a simulator this launcher starts;
//        --keep keeps both. The modules and the server run in a background process ("the holder"), so this window may
//        close; the holder's log is runs\mine\mine.log, the server's runs\mine\server.log.
//   node scripts/mine.mjs stop      stops the server and only the processes start launched (never an attached one)
//   node scripts/mine.mjs status    one line per port: free / ours / someone else's
//   node scripts/mine.mjs hold ...  internal: the background holder that start launches
//
// Run-only values (the Muster operator login, the EvidenceOps operator token, the data folders) go into
// config.local.json (gitignored) on top of config.mine.json. Nothing here prints a secret.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { MODULES, PORTS, CES, portHeld, listenerPid, startStack, stopStarted } from './fixture.mjs';

const WT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SELF = path.join(WT, 'scripts', 'mine.mjs');
const MINE = path.join(WT, 'runs', 'mine');
const STATE = path.join(MINE, 'mine-state.json');
const STOP = path.join(MINE, 'STOP');
const HOLDER_LOG = path.join(MINE, 'mine.log');
const SERVER_LOG = path.join(MINE, 'server.log');
const LOCAL = path.join(WT, 'config.local.json');
const TEMPLATE = path.join(WT, 'config.mine.json');
const PAGE_PORT = 4600;
const PAGE = `http://127.0.0.1:${PAGE_PORT}/`;
const LABEL = { sim: 'simulator', ec: 'Evidence Collector', eo: 'EvidenceOps', musterApi: 'muster-api', stamper: 'Stamper', ao: 'AdminOps', musterSpa: 'Muster screens', walkthrough: 'walkthrough page' };
const ALL_PORTS = { ...PORTS, walkthrough: PAGE_PORT };

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => console.log(`[mine ${new Date().toISOString().slice(11, 19)}] ${line}`);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeState = (s) => { fs.mkdirSync(MINE, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); };

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/** Every process: pid -> { ppid, cmd }. Command lines stay in memory; they are never printed or written. */
function processTable() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'],
  { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const map = new Map();
  try {
    for (const p of JSON.parse(r.stdout)) map.set(p.ProcessId, { ppid: p.ParentProcessId, cmd: String(p.CommandLine ?? '') });
  } catch { /* empty table: nothing counts as ours */ }
  return map;
}
const descendantOf = (table, pid, root) => {
  for (let p = pid, n = 0; p && n < 64; n++) {
    if (p === root) return true;
    p = table.get(p)?.ppid;
  }
  return false;
};

/** The holder of the recorded state, when it is still running (its pid alive AND its command line is this script). */
function liveHolder(state, table = processTable()) {
  if (!state?.holderPid || !['starting', 'ready', 'stopping'].includes(state.status)) return null;
  const p = table.get(state.holderPid);
  return p && /mine\.mjs/i.test(p.cmd) && /\bhold\b/.test(p.cmd) ? state.holderPid : null;
}

/** One row per port: free, ours (this launcher started what listens there) or someone else's. */
function portRows() {
  const state = readJson(STATE);
  const table = processTable();
  const holder = liveHolder(state, table);
  return Object.entries(ALL_PORTS).map(([name, port]) => {
    const pid = listenerPid(port);
    let owner = 'free';
    if (pid) {
      const recorded = state?.ports?.[name];
      const ours = holder && recorded?.owner === 'ours' && (recorded.listenerPid === pid || descendantOf(table, pid, holder));
      owner = ours ? 'ours' : "someone else's";
      if (!ours && holder && recorded?.owner === 'attached') owner = "someone else's (attached)";
    }
    return { name, port, owner, pid };
  });
}
function printRows(rows) {
  for (const r of rows) console.log(`  ${String(r.port).padEnd(5)} ${LABEL[r.name].padEnd(19)} ${r.owner}${r.pid ? ` (pid ${r.pid})` : ''}`);
}

// ---------------------------------------------------------------- start
async function start() {
  fs.mkdirSync(MINE, { recursive: true });
  const prior = readJson(STATE);
  if (liveHolder(prior)) {
    say(`already running (launcher pid ${prior.holderPid}); nothing started`);
    printRows(portRows());
    if (!has('--no-open')) openBrowser();
    return 0;
  }
  if (await portHeld(PAGE_PORT)) {
    say(`REFUSE: port ${PAGE_PORT} (walkthrough page) is held by a process this launcher did not start. Nothing was started or stopped.`);
    printRows(portRows());
    return 3;
  }
  const attach = [];
  for (const m of MODULES) if (await portHeld(PORTS[m])) attach.push(m);
  for (const m of MODULES) say(`${LABEL[m]} (${PORTS[m]}): ${attach.includes(m) ? 'held by a process this launcher did not start -> attached (left alone)' : `free -> start from ${CES}`}`);
  try { fs.rmSync(STOP, { force: true }); } catch { /* none */ }
  fs.writeFileSync(HOLDER_LOG, '');
  // Start-Process (ShellExecute) instead of child_process.spawn: a spawned child on Windows inherits this process's
  // inheritable handles, so a caller that reads this command's output through a pipe would wait for the holder to end.
  const args = [SELF, 'hold', has('--keep') ? '--keep' : '--fresh', '--attach', attach.join(',') || '-'];
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const ps = `$p = Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${args.map((a) => q(`"${a}"`)).join(',')} -WorkingDirectory ${q(WT)} -WindowStyle Hidden -PassThru; $p.Id`;
  const launched = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  const child = { pid: Number(String(launched.stdout ?? '').trim()) };
  if (!child.pid) { say(`could not launch the background process: ${String(launched.stderr ?? '').split(/\r?\n/)[0]}`); return 1; }
  say(`launcher started in the background (pid ${child.pid}); its log is ${path.relative(WT, HOLDER_LOG)}`);
  // Follow the holder's log until it reports ready or failed.
  let shown = 0;
  const deadline = Date.now() + 12 * 60 * 1000;
  for (;;) {
    await sleep(1000);
    const text = fs.existsSync(HOLDER_LOG) ? fs.readFileSync(HOLDER_LOG, 'utf8') : '';
    const lines = text.split(/\r?\n/);
    for (const l of lines.slice(shown, lines.length - 1)) console.log(`  ${l}`);
    shown = Math.max(shown, lines.length - 1);
    const s = readJson(STATE);
    if (s?.holderPid === child.pid && s.status === 'ready') break;
    if (s?.holderPid === child.pid && s.status === 'failed') { say(`start failed: ${s.error}`); return 1; }
    if (!alive(child.pid)) { say('the launcher stopped before it was ready; see runs\\mine\\mine.log'); return 1; }
    if (Date.now() > deadline) { say('not ready after 12 minutes; still starting in the background. Check: node scripts\\mine.mjs status'); return 1; }
  }
  const s = readJson(STATE);
  say(`READY: ${PAGE} (run ${s.runId}). Ports:`);
  printRows(portRows());
  if (s.attached?.length) say(`attached (not started, never stopped by this launcher): ${s.attached.map((a) => `${LABEL[a.module]} ${a.port} (${a.answer})`).join('; ')}. The page's Health panel decides whether they fit.`);
  say('stop with Stop-Mine.ps1 (or node scripts\\mine.mjs stop)');
  if (!has('--no-open')) openBrowser();
  return 0;
}

function openBrowser() {
  try {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', PAGE], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    say(`opened ${PAGE} in the default browser`);
  } catch (err) {
    say(`open ${PAGE} in a browser (${err instanceof Error ? err.message : String(err)})`);
  }
}

/**
 * Where the four module windows go (PLAN.md 13.2 item 3): four columns of floor(0.8 * W / 4) across the primary
 * screen's work area, full height, leaving the right fifth for the Demo Commander page; a 2 x 2 grid in the left
 * four fifths when the work area is under 3200 px wide. A failed measurement falls back to a 1920 x 1040 work area.
 */
function windowLayout() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.Windows.Forms; $a = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; "$($a.X) $($a.Y) $($a.Width) $($a.Height)"'],
  { encoding: 'utf8', windowsHide: true });
  let [X, Y, W, H] = String(r.stdout ?? '').trim().split(/\s+/).map(Number);
  if (![X, Y, W, H].every(Number.isFinite) || W <= 0 || H <= 0) [X, Y, W, H] = [0, 0, 1920, 1040];
  const order = ['muster', 'stamper', 'ao', 'eo'];
  if (W >= 3200) {
    const w = Math.floor((0.8 * W) / 4);
    return Object.fromEntries(order.map((m, i) => [m, { x: X + i * w, y: Y, width: w, height: H }]));
  }
  const w = Math.floor((0.8 * W) / 2);
  const h = Math.floor(H / 2);
  return Object.fromEntries(order.map((m, i) => [m, { x: X + (i % 2) * w, y: Y + Math.floor(i / 2) * h, width: w, height: h }]));
}

// ---------------------------------------------------------------- hold (background)
async function hold() {
  // The holder has no console: everything it says goes to runs\mine\mine.log.
  const logOut = fs.createWriteStream(HOLDER_LOG, { flags: 'a' });
  const toLog = (...a) => logOut.write(`${a.map(String).join(' ')}\n`);
  console.log = toLog;
  console.error = toLog;
  process.on('uncaughtException', (err) => toLog(`[mine] uncaught: ${err instanceof Error ? err.stack : String(err)}`));
  const fresh = !has('--keep');
  const i = argv.indexOf('--attach');
  const attach = new Set((i >= 0 ? argv[i + 1] : '').split(',').filter((x) => x && x !== '-'));
  const state = { schema: 'ces-walkthrough/mine@1', status: 'starting', holderPid: process.pid, startedAt: new Date().toISOString(), fresh, attached: [], ports: {} };
  writeState(state);
  let stack = null;
  let server = null;
  let stopping = false;

  /**
   * PLAN.md 14.2 item 3 (a): ask the page to close its four module windows first (POST /stop), then wait until it
   * reports them closed and itself stopping (bounded, 45 s), so the page shows the module stop that follows.
   */
  const stopPage = async () => {
    if (!server || server.exitCode !== null) return;
    try {
      await fetch(`${PAGE}stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ by: 'launcher' }), signal: AbortSignal.timeout(5000) });
    } catch { /* the page may be gone: the modules stop anyway */ }
    const until = Date.now() + 45000;
    while (Date.now() < until && server.exitCode === null) {
      try {
        const s = await (await fetch(`${PAGE}state`, { signal: AbortSignal.timeout(3000) })).json();
        if (s.prepared === false && s.stopping === true) { say('  page: module windows closed'); return; }
      } catch { /* not answering: try again */ }
      await sleep(500);
    }
    say('  page: did not report its windows closed within 45 s; stopping the modules anyway');
  };
  const stopServer = async () => {
    if (!server || server.exitCode !== null) return;
    // Let this log reach the disk and the page relay it (500 ms poll) before STOP-SERVER ends the relay.
    await new Promise((resolve) => logOut.write('', resolve));
    await sleep(1000);
    // The server's own clean stop: closes the browser windows it opened and removes its run folder links.
    fs.writeFileSync(path.join(WT, 'runs', 'STOP-SERVER'), new Date().toISOString());
    const until = Date.now() + 30000;
    while (server.exitCode === null && Date.now() < until) await sleep(500);
    if (server.exitCode === null) {
      say('walkthrough server did not stop in 30 s; stopping its process tree (it was started by this launcher)');
      spawnSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
    say('  stopped walkthrough server');
  };
  const shutdown = async (why, code = 0) => {
    if (stopping) return;
    stopping = true;
    say(`stopping (${why}): only the processes this launcher started`);
    writeState({ ...readJson(STATE), status: 'stopping' });
    // The graceful order (PLAN.md 14.2 item 3): the page's windows, then the modules, then the page server.
    await stopPage();
    if (stack) await stack.stop(); else await stopStarted();
    await stopServer();
    try { fs.rmSync(STOP, { force: true }); } catch { /* none */ }
    writeState({ ...readJson(STATE), status: code ? 'failed' : 'stopped', stoppedAt: new Date().toISOString() });
    say('stopped');
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    stack = await startStack({ dir: MINE, fresh, keepSim: !fresh, attach, reuse: readJson(LOCAL), tag: 'mine' });
    // config.local.json = config.mine.json plus this run's values (roots, operator login, operator token, people).
    const t = readJson(TEMPLATE);
    if (!t) throw new Error('config.mine.json is missing or not JSON');
    const c = stack.config;
    const config = {
      ...t,
      roots: c.roots,
      tokens: { ...t.tokens, eoOperator: c.tokens.eoOperator },
      musterOperator: c.musterOperator,
      eoPeople: c.eoPeople,
      aoNewUser: c.aoNewUser,
      customerDir: c.customerDir,
    };
    if (!config.pane?.windows) {
      config.pane = { ...config.pane, windows: windowLayout() };
      say(`module windows placed on the primary screen's work area: ${Object.entries(config.pane.windows).map(([m, g]) => `${m} ${g.width}x${g.height}+${g.x}+${g.y}`).join(', ')}`);
    }
    fs.writeFileSync(LOCAL, JSON.stringify(config, null, 2));
    say('config.local.json written from config.mine.json and this run\'s values');

    if (await portHeld(PAGE_PORT)) throw new Error(`port ${PAGE_PORT} became held while the modules started; the walkthrough server was not started`);
    const out = fs.openSync(SERVER_LOG, 'w');
    server = spawn(process.execPath, [path.join(WT, 'server.mjs'), '--config', LOCAL], { cwd: WT, stdio: ['ignore', out, out], windowsHide: true });
    fs.closeSync(out);
    server.on('exit', (code) => { if (!stopping) say(`walkthrough server exited (code ${code}); the modules stay up until stop`); });
    let runId = null;
    const until = Date.now() + 90000;
    while (!runId) {
      try { runId = (await (await fetch(`${PAGE}state`, { signal: AbortSignal.timeout(3000) })).json()).runId; } catch { /* not yet */ }
      if (!runId) {
        if (server.exitCode !== null) throw new Error(`the walkthrough server exited (code ${server.exitCode}); see runs\\mine\\server.log`);
        if (Date.now() > until) throw new Error('the walkthrough server did not answer within 90 s');
        await sleep(1000);
      }
    }
    say(`walkthrough server: up on ${PAGE_PORT} (run ${runId}; target ${config.target?.name ?? ''})`);
    const ports = {};
    for (const m of MODULES) ports[m] = attach.has(m) ? { port: PORTS[m], owner: 'attached' } : { port: PORTS[m], owner: 'ours', listenerPid: stack.listeners[m] ?? null };
    ports.walkthrough = { port: PAGE_PORT, owner: 'ours', listenerPid: listenerPid(PAGE_PORT) ?? server.pid };
    writeState({ ...state, status: 'ready', readyAt: new Date().toISOString(), runId, url: PAGE, serverPid: server.pid, attached: stack.attached, ports });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    say(`start failed: ${message}`);
    writeState({ ...readJson(STATE), error: message.slice(0, 600) });
    await shutdown('start failed', 1);
    return;
  }
  setInterval(() => { if (fs.existsSync(STOP)) void shutdown('stop requested'); }, 1000);
}

// ---------------------------------------------------------------- stop
async function stop() {
  const state = readJson(STATE);
  const holder = liveHolder(state);
  if (holder) {
    say(`asking the launcher (pid ${holder}) to stop what it started`);
    fs.writeFileSync(STOP, new Date().toISOString());
    const until = Date.now() + 180000;
    while (alive(holder) && Date.now() < until) await sleep(1000);
    if (alive(holder)) { say('the launcher has not stopped after 3 minutes; see runs\\mine\\mine.log'); printRows(portRows()); return 1; }
    say('stopped');
  } else if (state && ['starting', 'ready', 'stopping'].includes(state.status)) {
    // The launcher died without cleaning up. Stop only what it recorded as its own, and only while that pid still runs
    // a C:\ces-nb program (a recycled pid belongs to someone else and is left alone).
    const table = processTable();
    const pids = [state.serverPid, ...Object.values(state.ports ?? {}).filter((p) => p.owner === 'ours').map((p) => p.listenerPid)].filter(Boolean);
    for (const pid of [...new Set(pids)]) {
      const p = table.get(pid);
      if (p && /c:\\ces-nb\\/i.test(p.cmd)) {
        spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        say(`stopped pid ${pid} (recorded as started by the launcher)`);
      }
    }
    writeState({ ...state, status: 'stopped', stoppedAt: new Date().toISOString(), note: 'launcher was gone; recorded processes stopped' });
  } else {
    say('nothing to stop: no launcher of ours is running');
  }
  printRows(portRows());
  return 0;
}

// ---------------------------------------------------------------- status
function status() {
  const state = readJson(STATE);
  const holder = liveHolder(state);
  say(holder ? `running (launcher pid ${holder}, run ${state.runId ?? 'starting'}, ${PAGE})` : 'not running');
  printRows(portRows());
  return 0;
}

const cmd = argv[0];
if (cmd === 'start') process.exit(await start());
else if (cmd === 'stop') process.exit(await stop());
else if (cmd === 'status') process.exit(status());
else if (cmd === 'hold') await hold();
else {
  console.error('usage: node scripts/mine.mjs start [--keep] [--no-open] | stop | status');
  process.exit(2);
}
