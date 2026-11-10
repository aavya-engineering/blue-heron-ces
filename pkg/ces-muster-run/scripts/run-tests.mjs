#!/usr/bin/env node
// MX unit gate (Blue Heron Defense, CES team). Runs every suite in the nested
// workspace and passes when the failing tests are a subset of known-failures.json.
// Called by run-tests.ps1 (Windows) and run-tests.sh (Git Bash, Linux, macOS).
//
//   node run-tests.mjs --ces <ces-root> --out <dir> [--known <known-failures.json>]
// Writes <out>/unit-gate.json and <out>/unit/<suite>.json|.log. Exit 0 = gate passes.
//
// The live-sim suites (muster-api, ces-eo) need a seeded sim on 127.0.0.1:4390.
// If nothing answers there, this starts `stacksim up` for the run and stops it after.
// Off Windows those suites skip themselves (they need powershell.exe).
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const ces = path.resolve(a.ces ?? '');
const out = path.resolve(a.out ?? 'out');
const knownPath = path.resolve(a.known ?? path.join(here, '..', 'known-failures.json'));
const unitDir = path.join(out, 'unit');
fs.mkdirSync(unitDir, { recursive: true });

// [suite id, folder under ces, runner, extra args before the reporter flags]
const SUITES = [
  ['ces-tenant', 'ces-tenant', 'vitest', []],
  ['ces-shared', 'ces-shared', 'vitest', []],
  ['ces-stamper', 'ces-stamper', 'jest', []],
  ['ces-eo', 'ces-eo', 'jest', []],
  ['ces-ao', 'ces-ao', 'vitest', []],
  ['ces-ec', 'ces-ec', 'vitest', []],
  ['tenant-stacksim', 'tenant-stacksim', 'vitest', []],
  ['ces-tester', 'ces-tester', 'vitest', []],
  ['ces-muster', 'ces-muster', 'vitest', []],
  ['muster-api', path.join('ces-muster', 'muster-api'), 'vitest', []],
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Some suites write through ces-shared's storage root (default C:\CES_Pipeline on Windows) and
// ces-tenant's registry (default ~/.ces/tenants). Keep both inside the workspace.
const isolate = {
  CES_PIPELINE_ROOT: path.join(unitDir, 'pl'),
  CES_TENANT_ROOT: path.join(unitDir, 'tenants'),
};

async function simUp() {
  try {
    const r = await fetch('http://127.0.0.1:4390/ledger', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch { return false; }
}

function runSuite([id, dir, runner, extra]) {
  const json = path.join(unitDir, `${id}.json`);
  const log = path.join(unitDir, `${id}.log`);
  try { fs.rmSync(json, { force: true }); } catch { /* none */ }
  // npm.cmd needs a shell on Windows; quote the one argument that can hold spaces.
  const outArg = process.platform === 'win32' ? `--outputFile="${json}"` : `--outputFile=${json}`;
  const reporter = runner === 'jest'
    ? ['--json', outArg]
    : ['--reporter=default', '--reporter=json', outArg];
  const started = Date.now();
  // On Windows npm.cmd needs a shell; pass one command string (args with a shell are concatenated anyway).
  const args = ['test', '--', ...extra, ...reporter];
  const win = process.platform === 'win32';
  const r = spawnSync(win ? `${npm} ${args.join(' ')}` : npm, win ? [] : args, {
    cwd: path.join(ces, dir), encoding: 'utf8', shell: win,
    maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...isolate, CI: '1', FORCE_COLOR: '0' },
  });
  fs.writeFileSync(log, `${r.stdout ?? ''}\n--- stderr\n${r.stderr ?? ''}`);
  const failures = [];
  let passed = 0, failed = 0, skipped = 0;
  if (fs.existsSync(json)) {
    const rep = JSON.parse(fs.readFileSync(json, 'utf8'));
    for (const f of rep.testResults ?? []) {
      const file = path.relative(path.join(ces, dir), f.name ?? f.testFilePath ?? '').split(path.sep).join('/');
      const asserts = f.assertionResults ?? f.testResults ?? [];
      for (const t of asserts) {
        if (t.status === 'passed') passed++;
        else if (t.status === 'failed') { failed++; failures.push({ suite: id, file, test: t.fullName ?? t.title }); }
        else skipped++;
      }
      if (f.status === 'failed' && !asserts.some((t) => t.status === 'failed')) {
        failed++;
        failures.push({ suite: id, file, test: '(file failed to load or run)' });
      }
    }
  } else {
    failures.push({ suite: id, file: '(none)', test: `(no JSON report; exit ${r.status})` });
    failed++;
  }
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`${failed ? 'FAIL' : 'ok  '} ${id}: ${passed} passed, ${failed} failed, ${skipped} skipped (${secs}s)`);
  return { suite: id, exit: r.status, passed, failed, skipped, seconds: secs, failures };
}

function isKnown(f, known) {
  return known.some((k) => k.suite === f.suite && f.file === k.file && f.test.includes(k.test));
}

const known = JSON.parse(fs.readFileSync(knownPath, 'utf8')).failures;
let sim;
// v2: never reuse a sim that is already answering on 4390. It would belong to another build (or a
// stale process) and the live-sim suites would write into it. Fail instead; the caller frees the port.
if (await simUp()) {
  console.error('REFUSE: a simulator is already answering on 127.0.0.1:4390; this gate starts its own and never reuses one. Stop that process yourself and rerun.');
  process.exit(2);
}
if (process.platform === 'win32') {
  sim = spawn(process.execPath, ['bin/stacksim.mjs', 'up'], { cwd: path.join(ces, 'tenant-stacksim'), stdio: 'ignore', env: { ...process.env, ...isolate } });
  for (let i = 0; i < 30 && !(await simUp()); i++) await new Promise((r) => setTimeout(r, 1000));
  console.log(`started stacksim up for the live-sim suites: ${(await simUp()) ? 'ready' : 'NOT ready'}`);
}
const results = [];
try {
  for (const s of SUITES) results.push(runSuite(s));
} finally {
  if (sim?.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(sim.pid), '/T', '/F'], { stdio: 'ignore' });
    else sim.kill();
  }
}
const all = results.flatMap((r) => r.failures);
const unexpected = all.filter((f) => !isKnown(f, known));
const gate = {
  pass: unexpected.length === 0,
  known_failures_file: path.basename(knownPath),
  totals: {
    passed: results.reduce((n, r) => n + r.passed, 0),
    failed: results.reduce((n, r) => n + r.failed, 0),
    skipped: results.reduce((n, r) => n + r.skipped, 0),
  },
  failures: all,
  unexpected,
  suites: results.map(({ failures: _f, ...r }) => r),
};
fs.writeFileSync(path.join(out, 'unit-gate.json'), JSON.stringify(gate, null, 2));
console.log(`unit gate: ${gate.pass ? 'PASS' : 'FAIL'} (${all.length} failing, ${unexpected.length} not in ${path.basename(knownPath)})`);
for (const u of unexpected) console.log(`  unexpected: [${u.suite}] ${u.file} :: ${u.test}`);
process.exitCode = gate.pass ? 0 : 1;
