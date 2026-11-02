#!/usr/bin/env node
// MX evidence bundle (Blue Heron Defense, CES team). Phase 3 / P3.1 + P3.3.
//   node bundle.mjs --root <WS> [--scenario muster-partial] [--out <dir>] [--ws <path>] [--scan 0|1]
// Assembles one run's evidence (the twelve items of PLAN Phase 3) into
//   <out>/<run-id>/evidence/raw/      the files as produced, plus raw/manifest.json (SHA-256 per file)
//   <out>/<run-id>/evidence/shared/   a copy with local paths rewritten (also inside DOCX parts),
//                                     re-hashed AFTER rewriting into shared/manifest.json
//   <out>/<run-id>/evidence/identity-scan.json   identity-scan.ps1 over shared/ (0 hits = clean)
// and writes <out>/latest.json {runId}. <out> defaults to <WS>/out/runs. --ws is the path rewritten to
// <WS> (default --root; a dry run on a copied root passes the original root here).
// Replaces capture-evidence.ps1 (which now calls this script).
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const root = path.resolve(a.root);
const slug = a.scenario ?? 'muster-partial';
const ws = path.resolve(a.ws ?? root);
const ces = path.join(root, 'ces');
const out = path.join(root, 'out');
const runsDir = path.resolve(a.out ?? path.join(out, 'runs'));
const tenantDir = path.join(root, 'pl', 'Stamper', 'plan-data', slug);
const doScan = (a.scan ?? '1') !== '0';

const JSZip = createRequire(path.join(ces, 'package.json'))('jszip');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const exists = (p) => !!p && fs.existsSync(p);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const latest = (dir, prefix) => {
  if (!exists(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort().pop();
  return f ? path.join(dir, f) : null;
};
const walk = (dir) => (exists(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).filter((p) => fs.statSync(p).isFile()) : []);
const posix = (p) => p.split(path.sep).join('/');

const report = readJson(path.join(out, 'execution-report.json'));
const runId = `run-${String(report.started_at).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
const evDir = path.join(runsDir, runId, 'evidence');
const rawDir = path.join(evDir, 'raw');
const sharedDir = path.join(evDir, 'shared');
fs.rmSync(evDir, { recursive: true, force: true });
fs.mkdirSync(rawDir, { recursive: true });

// ---------- raw: the twelve items ----------
const items = [];
const missing = [];
function item(id, name, entries, note) {
  // entries: [src, destRelUnderItemFolder]
  const folder = `${String(id).padStart(2, '0')}-${name}`;
  const files = [];
  for (const [src, rel] of entries) {
    if (!exists(src)) { missing.push(`${folder}/${rel}`); continue; }
    const dst = path.join(rawDir, folder, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    files.push(posix(path.join(folder, rel)));
  }
  items.push({ id, name, folder, files, ...(note ? { note } : {}) });
}
const dirEntries = (dir, prefix = '', filter = () => true) => walk(dir).filter(filter).map((p) => [p, path.join(prefix, path.relative(dir, p))]);

const planDir = path.join(out, 'plan');
const plansPushed = path.join(tenantDir, 'plans');
const pMP = latest(plansPushed, 'manual-mission-plan-');
const mp = exists(pMP) ? readJson(pMP) : null;
const mpText = exists(pMP) ? fs.readFileSync(pMP, 'utf8') : '';
// MG-12: si-baseline-/tcp-/readiness-posture- are hand-off envelopes {cesId, schema_id, artifact_id, version, hash_sha256, artifact}
// that the MP references (inputs.*_ref.hash_sha256); tenant-config-profile- is the retired pre-2D name (older runs only).
// W7-PKG: cui-boundary- is the sixth envelope (W7-MX2: pushed, inputs.cui_boundary_ref); btc-confirmation- (the bare vendored
// BTC Confirmation, W7-MX2) is persisted only; the MP carries its gate_summary, not a hash, so its mp_hash_references entry is null.
const HANDOFF = { 'si-baseline-': 'si_baseline_ref', 'tcp-': 'tcp_ref', 'readiness-posture-': 'readiness_posture_ref', 'policy-inputs-profile-': 'policy_inputs_profile_ref', 'policy-set-manifest-': 'policy_set_manifest_ref', 'cui-boundary-': 'cui_boundary_ref' };
const persisted = [...Object.keys(HANDOFF), 'tenant-config-profile-', 'btc-confirmation-'].map((pfx) => latest(planDir, pfx)).filter(Boolean);
const hashRefs = Object.fromEntries(persisted.map((p) => {
  if (path.basename(p).startsWith('btc-confirmation-')) return [path.basename(p), null];
  const pfx = Object.keys(HANDOFF).find((k) => path.basename(p).startsWith(k));
  const env = pfx ? readJson(p) : null;
  if (env?.hash_sha256) return [path.basename(p), mp?.inputs?.[HANDOFF[pfx]]?.hash_sha256 === env.hash_sha256];
  return [path.basename(p), mpText.includes(sha(fs.readFileSync(p)))];
}));
item(1, 'plans', [
  ...['manual-mission-plan-', 'tenant-manifest-', 'infrastructure-manifest-', ...Object.keys(HANDOFF)].map((pfx) => latest(plansPushed, pfx)).filter(Boolean).map((p) => [p, path.join('pushed', path.basename(p))]),
  ...persisted.map((p) => [p, path.join('persisted', path.basename(p))]),
], 'MP/TM/IM and the MG-12 hand-off envelopes (SI Baseline, TCP, Readiness Posture, the two policy envelopes, the CUI Boundary) as pushed; the same envelopes and the BTC Confirmation as persisted by the runner; mp_hash_references says whether the MP references each by hash (null: the BTC Confirmation, which the MP references by gate_summary).');
item(2, 'ssp', [[path.join(out, 'ssp.json'), 'ssp.json'], [path.join(out, 'ssp.docx'), 'ssp.docx']]);
item(3, 'poam', [[path.join(out, 'poam.json'), 'poam.json']]);
item(4, 'policies', dirEntries(path.join(planDir, 'policies')));
item(5, 'reports', dirEntries(path.join(planDir, 'reports')));
const exePlan = exists(path.join(out, 'executable-plan.json')) ? readJson(path.join(out, 'executable-plan.json')) : null;
const taskIds = new Set((exePlan?.execution_graph ?? []).map((t) => t.id));
const byTask = path.join(tenantDir, 'evidence-by-task');
const taskDirs = exists(byTask) ? fs.readdirSync(byTask).filter((d) => taskIds.has(d)) : [];
const resultsManifest = path.join(tenantDir, 'state', `execution-results-${report.plan_id}.json`);
item(6, 'execution', [
  [path.join(out, 'execution-report.json'), 'execution-report.json'],
  [resultsManifest, path.basename(resultsManifest)],
  ...taskDirs.flatMap((d) => dirEntries(path.join(byTask, d), path.join('evidence-by-task', d))),
  ...dirEntries(path.join(tenantDir, 'evidence'), 'evidence'),
], `per-task evidence for the ${taskIds.size} task ids of this run's executable plan (${taskDirs.length} with a folder)`);
item(7, 'eo-assessment', ['eo-connect.json', 'eo-assess.json', 'eo-assess-2.json', 'eo-assess-3.json', 'eo-ledger.json'].map((f) => [path.join(out, f), f]));
item(8, 'question-register', [[path.join(ces, 'ces-muster', 'src', 'features', 'interview', 'questionRegister.json'), 'questionRegister.json']]);
// Item 9: the sim ledger plus the tester's run record and comparison (Phase 4, `-Harness tester`). Under the `mx`
// harness no tester record exists, so a labelled placeholder stands in and the manifest says which it was.
const testerRecord = path.join(out, 'tester-run.json');
const aoReport = path.join(out, 'coverage-ao.json');
const item9 = [[path.join(out, 'ledger.json'), 'ledger.json']];
let placeholder = null;
if (fs.existsSync(testerRecord)) {
  item9.push([testerRecord, 'tester-run.json']);
  if (fs.existsSync(aoReport)) item9.push([aoReport, 'coverage-ao.json']);
} else {
  placeholder = path.join(evDir, 'tester-comparison.placeholder.json');
  fs.writeFileSync(placeholder, JSON.stringify({ status: 'placeholder', reason: 'this run used the mx harness; the ces-tester run record and ledger comparison exist only under -Harness tester (V23)' }, null, 2));
  item9.push([placeholder, 'tester-comparison.placeholder.json']);
}
item(9, 'ledger', item9, fs.existsSync(testerRecord) ? 'the sim ledger, the ces-tester run record (steps, exit codes, ledger/state comparison) and the AO coverage report' : 'the sim ledger; tester record absent under the mx harness');
item(10, 'readiness', [[path.join(planDir, `readiness-result-${slug}.json`), `readiness-result-${slug}.json`]],
  'the collect column and gap rows (derived.gaps[] with evidence_source catalog | placeholder)');
const pkgDir = path.join(out, 'eo-package');
item(11, 'ec-upload', [
  [path.join(out, 'ec-upload-request.json'), 'ec-upload-request.json'],
  [path.join(out, 'ec-upload.json'), 'ec-upload.json'],
  ...dirEntries(pkgDir, 'eo-package', (p) => /[\\/]evidence[\\/]ec[\\/]/.test(p) || path.basename(p) === 'integrity-manifest.json'),
], 'EC record of the E8.5 upload and the EO package entries under evidence/ec/<control>/');
if (placeholder) fs.rmSync(placeholder, { force: true });
// Item 12 (EO-collection W4.3; GC-PKG-3): the evidence index. evidence-index.json is built by EO into its package
// (ces-eo EvidencePackager: the SSP Appendix P index from the SSP's evidenceDetails, the store records and the
// vendored 800-171A examine lists, plus objectiveRows, a row per objective of every assessed control naming the
// zip files that evidence it, from the KB-1 evidence matrix). The bundle copies the one in the newest package
// extracted under out/eo-package/ (E8) instead of building its own; beside it the store's manifest.json and
// watermarks.json, and the drift.json of the last assess pass (absent on runs before EO-collection W3, noted,
// not counted missing). A package built before GC-PKG-3 has no index: item 12 then counts it missing.
const storeRoot = path.join(out, 'eo', 'evidence-store');
const storeDirs = exists(storeRoot) ? fs.readdirSync(storeRoot).map((d) => path.join(storeRoot, d)).filter((d) => exists(path.join(d, 'manifest.json'))) : [];
const storeDir = storeDirs.find((d) => readJson(path.join(d, 'manifest.json')).tenantSlug === slug) ?? (storeDirs.length === 1 ? storeDirs[0] : null);
const pkgIndexDir = exists(pkgDir) ? fs.readdirSync(pkgDir).filter((d) => exists(path.join(pkgDir, d, 'evidence-index.json'))).sort().pop() : null;
const indexSrc = pkgIndexDir ? path.join(pkgDir, pkgIndexDir, 'evidence-index.json') : path.join(pkgDir, 'evidence-index.json');
const indexNotes = [];
if (pkgIndexDir) {
  const index = readJson(indexSrc);
  const creditedItems = (index.examineCoverage ?? []).reduce((n, c) => n + (c.items ?? []).filter((it) => it.creditedTo).length, 0);
  const ob = index.objectiveSummary ?? {};
  indexNotes.push(`evidence-index.json (EO, eo-package/${pkgIndexDir}): ${index.summary?.entries} entries (examine ${index.summary?.byMethod?.examine}, test ${index.summary?.byMethod?.test}, interview ${index.summary?.byMethod?.interview}), ${(index.samplingWindows ?? []).length} family windows, examine items covered ${index.summary?.examineCovered} of ${index.summary?.examineItems}, ${index.summary?.unresolvedStoreRefs} unresolved store refs; documentary items credited ${creditedItems}; objective rows ${ob.rows ?? 'none'} over ${ob.controls ?? 0} controls (${ob.rowsWithFiles ?? 0} citing zip files), met controls with a row ${ob.metControlsWithRow ?? 0} of ${ob.metControls ?? 0}`);
} else {
  indexNotes.push('evidence-index.json: none in out/eo-package (EO package built before GC-PKG-3, or E8 did not run)');
}
const driftFiles = walk(path.join(out, 'eo', 'assessments')).filter((p) => path.basename(p) === 'drift.json')
  .map((p) => ({ p, at: Date.parse(readJson(p).generatedAt ?? '') || 0 })).sort((x, y) => x.at - y.at);
const lastDrift = driftFiles.length ? driftFiles[driftFiles.length - 1].p : null;
if (!lastDrift) indexNotes.push('drift.json: none under out/eo/assessments (run predates EO-collection W3)');
if (!storeDir) indexNotes.push(`evidence store: none for ${slug} under out/eo/evidence-store`);
item(12, 'evidence-index', [
  [indexSrc, 'evidence-index.json'],
  ...(storeDir ? [[path.join(storeDir, 'manifest.json'), path.join('evidence-store', 'manifest.json')], [path.join(storeDir, 'watermarks.json'), path.join('evidence-store', 'watermarks.json')]] : []),
  ...(lastDrift ? [[lastDrift, 'drift.json']] : []),
], `the EO package's evidence index (SSP Appendix P and objective rows) as JSON, the evidence store manifest and watermarks, and the last pass's drift record. ${indexNotes.join('; ')}`);

const results = exists(resultsManifest) ? readJson(resultsManifest) : null;
function manifest(dir, kind) {
  const list = items.map((it) => ({
    id: it.id, name: it.name, folder: it.folder, ...(it.note ? { note: it.note } : {}),
    files: it.files.map((f) => { const b = fs.readFileSync(path.join(dir, f)); return { path: f, sha256: sha(b), bytes: b.length }; }),
  }));
  list.push({ id: 13, name: 'manifest', folder: '.', files: [{ path: 'manifest.json', sha256: null, note: 'this file' }] });
  return {
    kind, runId, scenario: slug, generatedAt: new Date().toISOString(),
    cesId: mp?.ces?.cesId ?? null,
    cesId_matches_execution_results: results ? results.cesId === mp?.ces?.cesId : null,
    plan_id: report.plan_id,
    mp_hash_references: hashRefs,
    missing,
    items: list,
  };
}
fs.writeFileSync(path.join(rawDir, 'manifest.json'), JSON.stringify(manifest(rawDir, 'raw'), null, 2));

// ---------- shared: rewritten copy, hashed after rewriting ----------
const sep = '(?:\\\\\\\\|\\\\|/)'; // "\\" (JSON-escaped), "\" or "/"
const segs = (p) => p.replace(/^[A-Za-z]:/, '').split(/[\\/]+/).filter(Boolean).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const wsSegs = segs(ws);
const drive = ws.slice(0, 1);
// Markers are placed as sentinels first (so the temp rule can follow the profile rule), then written as
// <WS>/<HOME>/<TMP>, or escaped (&lt;WS&gt;) in XML parts and HTML so those documents stay well-formed.
const M = (n) => `\u0001${n}\u0002`;
const rules = [
  [new RegExp(`${drive}:${sep}${wsSegs.join(sep)}`, 'gi'), M('WS')],
  [new RegExp(`/${drive.toLowerCase()}/${wsSegs.join('/')}`, 'gi'), M('WS')],
  [new RegExp(`[A-Za-z]:${sep}Users${sep}[^\\\\/"'\\s;<>]+`, 'gi'), M('HOME')],
  [new RegExp(`/[a-z]/Users/[^/"'\\s;<>]+`, 'gi'), M('HOME')],
  [new RegExp(`${M('HOME')}${sep}AppData${sep}Local${sep}Temp(?:${sep}[^\\\\/"'\\s;<>]+)*`, 'gi'), M('TMP')],
];
const rewrite = (t, markup = false) => rules.reduce((s, [re, to]) => s.replace(re, to), t)
  .replace(/\u0001(WS|HOME|TMP)\u0002/g, (_, n) => (markup ? `&lt;${n}&gt;` : `<${n}>`));
const ZIP_EXT = new Set(['.docx', '.xlsx', '.pptx']);
const isText = (buf) => !buf.subarray(0, 8192).includes(0);
let rewrittenFiles = 0, rewrittenParts = 0;
async function copyShared(src, dst) {
  const buf = fs.readFileSync(src);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (ZIP_EXT.has(path.extname(src).toLowerCase())) {
    const zip = await JSZip.loadAsync(buf);
    let changed = false;
    for (const name of Object.keys(zip.files)) {
      const e = zip.files[name];
      if (e.dir || !/\.(xml|rels)$/i.test(name)) continue;
      const text = await e.async('string');
      const next = rewrite(text, true);
      if (next !== text) { zip.file(name, next); changed = true; rewrittenParts++; }
    }
    if (changed) { rewrittenFiles++; fs.writeFileSync(dst, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })); }
    else fs.writeFileSync(dst, buf);
    return;
  }
  if (!isText(buf)) { fs.writeFileSync(dst, buf); return; }
  const text = buf.toString('utf8');
  const next = rewrite(text, /\.(html?|xml)$/i.test(src));
  if (next !== text) rewrittenFiles++;
  fs.writeFileSync(dst, next, 'utf8');
}
for (const it of items) for (const f of it.files) await copyShared(path.join(rawDir, f), path.join(sharedDir, f));
fs.writeFileSync(path.join(sharedDir, 'manifest.json'), JSON.stringify(manifest(sharedDir, 'shared'), null, 2));

// ---------- identity scan over shared/ ----------
function scanTokens(wsRoot) {
  const tokens = [];
  const file = path.join(wsRoot, 'nb-tools', 'scan-tokens.txt');
  if (exists(file)) tokens.push(...fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  const user = os.userInfo().username;
  if (user && user.length >= 3) tokens.push(`(?i)${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  return { tokens, tokenFile: exists(file) ? 'present' : 'absent' };
}
let scan = { ran: false };
if (doScan) {
  const { tokens, tokenFile } = scanTokens(ws);
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const cmd = `& ${q(path.join(path.dirname(fileURLToPath(import.meta.url)), 'identity-scan.ps1'))} -Path ${q(sharedDir)}${tokens.length ? ` -Extra @(${tokens.map(q).join(',')})` : ''}; exit $LASTEXITCODE`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = (r.stdout ?? '').split(/\r?\n/).filter(Boolean);
  scan = { ran: true, exit: r.status, hits: lines.filter((l) => l.startsWith('  ')).length, summary: lines.find((l) => l.startsWith('identity scan:')) ?? r.stderr?.trim(), token_file: tokenFile, extra_tokens: tokens.length, hit_lines: lines.filter((l) => l.startsWith('  ')).slice(0, 50) };
  fs.writeFileSync(path.join(evDir, 'identity-scan.json'), JSON.stringify(scan, null, 2));
}
fs.writeFileSync(path.join(runsDir, 'latest.json'), JSON.stringify({ runId, evidence: posix(path.relative(runsDir, evDir)) }, null, 2));

const nFiles = items.reduce((n, it) => n + it.files.length, 0);
for (const it of items) console.log(`  item ${String(it.id).padStart(2)} ${it.name}: ${it.files.length} files`);
console.log(`bundle ${runId}: ${nFiles} files in 12 items + manifest; missing ${missing.length}${missing.length ? ` (${missing.slice(0, 5).join(', ')})` : ''}; shared rewrites: ${rewrittenFiles} files (${rewrittenParts} DOCX parts); cesId ${mp?.ces?.cesId ?? 'n/a'}`);
console.log(`identity scan: ${scan.ran ? `${scan.hits} hits (exit ${scan.exit}); token file ${scan.token_file}` : 'skipped'}`);
process.exitCode = missing.length === 0 && (!scan.ran || scan.exit === 0) ? 0 : 1;
