#!/usr/bin/env node
// DEPTH-0 (ces-strategy docs/context/depth/DEPTH-REPORT-AND-PLAN.md §4): objective-level depth baseline.
//   node scripts/depth-coverage.mjs [--plan <executable-plan.json>]... [--out <path>]
// Per scenario plan, per assessment objective: verdict (S1 family-report verdicts, scripts/depth-verdicts.s1.json),
// the registry entry ids that ran for the objective's control (sub_commands) and the tasks carrying it (controls[]).
// Also lists the registry commands tenant-stacksim has no resolver for (simulator_unanswered).
// Uncovered = none + unrelated + read_only: the floor for check V91.
// Reads only; writes only the output file.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const WS = 'C:\\ces-nb';

export const DEFAULTS = {
  plans: [
    path.join(WS, 'evidence', 'w8-s1-eu-5', 'ui', 'spa', 'executable-plan.json'),
    path.join(WS, 'evidence', 'gc-w9r1b-s1-mach', 'executable-plan.json'),
    path.join(WS, 'evidence', 'gc-w9r1b-s2-eng', 'executable-plan.json'),
    path.join(WS, 'evidence', 'gc-w9r1b-s3-def', 'executable-plan.json'),
    path.join(WS, 'evidence', 'gc-w9r1b-muster-partial', 'executable-plan.json'),
  ],
  objectives: path.join(WS, 'ces', 'ces-shared', 'src', 'data', 'assessment-objectives.reference.json'),
  registries: [
    path.join(WS, 'ces', 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json'),
    path.join(WS, 'ces', 'ces-stamper', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json'),
  ],
  verdicts: path.join(HERE, 'depth-verdicts.s1.json'),
  stacksim: path.join(WS, 'ces', 'tenant-stacksim'),
  out: path.join(PKG, 'out', 'depth-coverage.json'),
};

export const VERDICTS = ['configured', 'partial', 'read_only', 'manual_or_document', 'unrelated', 'none', 'definitional'];
export const UNCOVERED = ['none', 'unrelated', 'read_only'];

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

// ---------------------------------------------------------------------------------------------------------------
// Plan side

const PRIMARY_RE = /^(?:step_task_|manual-|prohibition-|renderable-|absence-)([A-Z]{2}\.L[12]-\d+\.\d+\.\d+)(?:_|$)/;

/** The control a task was compiled for (from its id), falling back to its first controls[] entry. */
export function primaryControl(task) {
  const m = PRIMARY_RE.exec(task.id ?? '');
  return m ? m[1] : (task.controls ?? [])[0];
}

const isWrite = (sub) => typeof sub.set_command === 'string' && sub.set_command.trim() !== '';

/**
 * Sub-commands that ran for `control`: every `_sub_commands` entry of a task whose controls[] includes the control,
 * kept when the entry's control_ids include the control, or when the entry has no control_ids (manual-gate
 * pseudo-entries) and the task was compiled for that control.
 */
export function controlView(plan) {
  const view = new Map();
  const get = (c) => {
    if (!view.has(c)) view.set(c, { tasks: [], subs: new Map(), directives: new Set() });
    return view.get(c);
  };
  for (const task of plan.execution_graph ?? []) {
    const args = task.action?.args ?? {};
    const primary = primaryControl(task);
    for (const c of task.controls ?? []) {
      const v = get(c);
      v.tasks.push({ id: task.id, controls: [...(task.controls ?? [])] });
      v.directives.add(args._directive ?? 'unknown');
      for (const sub of args._sub_commands ?? []) {
        const ids = Array.isArray(sub.control_ids) ? sub.control_ids : null;
        if (ids ? ids.includes(c) : primary === c) {
          const prev = v.subs.get(sub.id);
          v.subs.set(sub.id, { id: sub.id, write: (prev?.write ?? false) || isWrite(sub), objective_ids: sub.objective_ids });
        }
      }
    }
  }
  return view;
}

/** Comparable summary of what a control got: sub-command ids with write/read flag, plus task directives. */
export function fingerprint(v) {
  if (!v) return '';
  const subs = [...v.subs.values()].map((s) => `${s.id}:${s.write ? 'w' : 'r'}`).sort();
  return [...subs, ...[...v.directives].sort().map((d) => `dir:${d}`)].join(',');
}

// ---------------------------------------------------------------------------------------------------------------
// Registry side

export function loadRegistries(paths) {
  const entries = [];
  for (const p of paths) {
    const r = readJson(p);
    for (const e of Array.isArray(r) ? r : (r.entries ?? [])) entries.push({ ...e, _registry: path.basename(p) });
  }
  return entries;
}

/** objective_ids of an entry: the plan copy's field if present, else the registry's; null when neither has it. */
function entryObjectiveIds(sub, byId) {
  if (Array.isArray(sub.objective_ids)) return sub.objective_ids;
  const e = byId.get(sub.id);
  return e && Array.isArray(e.objective_ids) ? e.objective_ids : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Coverage

export function computeScenario({ label, planPath, plan, objectives, registry, verdicts, baselineView }) {
  const byId = new Map(registry.map((e) => [e.entry_id, e]));
  const claims = new Map();
  for (const e of registry) {
    if (!Array.isArray(e.objective_ids)) continue;
    for (const o of e.objective_ids) (claims.get(o) ?? claims.set(o, []).get(o)).push(e.entry_id);
  }
  const view = controlView(plan);
  const counts = Object.fromEntries([...VERDICTS, 'unrated'].map((k) => [k, 0]));
  const differs = [];
  const seenDiff = new Set();
  const rows = [];
  for (const o of objectives) {
    const v = view.get(o.controlId);
    const fp = fingerprint(v);
    const baseFp = baselineView ? fingerprint(baselineView.get(o.controlId)) : fp;
    const changed = fp !== baseFp;
    if (changed && !seenDiff.has(o.controlId)) {
      seenDiff.add(o.controlId);
      differs.push({ control_id: o.controlId, s1: baseFp, scenario: fp });
    }
    const subs = v ? [...v.subs.values()].filter((s) => {
      const ids = entryObjectiveIds(s, byId);
      return ids === null || ids.includes(o.objectiveId);
    }) : [];
    const rec = verdicts[o.objectiveId];
    const verdict = rec ? rec.verdict : 'unrated';
    counts[verdict] = (counts[verdict] ?? 0) + 1;
    rows.push({
      objective_id: o.objectiveId,
      control_id: o.controlId,
      verdict,
      verdict_basis: rec ? 's1-report' : 'none',
      differs_from_s1: changed,
      sub_commands: subs.map((s) => s.id),
      tasks: v ? v.tasks : [],
      registry_claims: claims.get(o.objectiveId) ?? [],
    });
  }
  return {
    label,
    plan: planPath,
    total_objectives: rows.length,
    counts,
    uncovered_floor: UNCOVERED.reduce((n, k) => n + counts[k], 0),
    differs_from_s1_controls: differs,
    objectives: rows,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Simulator side (tenant-stacksim, read only: src/resolvers/*.ts, coverage/inventory.json, azshim/az-shim.ps1)

// Copied from tenant-stacksim src/codegen/deriveResolversFromInventory.ts (BUILTIN_EXCLUDE, APPROVED_VERBS subset
// test, stripQuotedStrings) so the derived resolver set is reproduced without executing simulator code.
const BUILTIN_EXCLUDE = new Set([
  'ConvertTo-Json', 'ConvertFrom-Json', 'ConvertTo-SecureString', 'ConvertTo-Html', 'ForEach-Object', 'Where-Object',
  'Select-Object', 'Sort-Object', 'Group-Object', 'Measure-Object', 'Tee-Object', 'Write-Output', 'Write-Host',
  'Write-Error', 'Write-Warning', 'Write-Verbose', 'New-Object', 'New-Guid', 'New-TimeSpan', 'New-Item', 'Get-Date',
  'Get-Content', 'Get-ChildItem', 'Set-Content', 'Start-Sleep', 'Out-Null', 'Out-String', 'Import-Csv', 'Export-Csv',
  'Test-Path', 'Select-String', 'Format-List', 'Format-Table', 'Join-Path', 'Split-Path', 'Copy-Item', 'Remove-Item',
  'Invoke-MgGraphRequest', 'Invoke-RestMethod', 'Invoke-Expression', 'Invoke-Command',
  // PH12-R5 (LOG-PH12-R5 §7 D; applied by P12-INT): PowerShell built-ins registry commands use; no simulator answers them and none needs to.
  'Remove-Variable', 'Add-Type',
]);
const SIM_ENGINES = new Set(['graph-cmdlet', 'invoke-mggraphrequest', 'az-cmdlet', 'exo-cmdlet', 'ipps-cmdlet', 'spo-cmdlet', 'other']);

function approvedVerbs(deriveSrc) {
  const m = /const APPROVED_VERBS = new Set\(\[([\s\S]*?)\]\)/.exec(deriveSrc);
  return new Set(m ? [...m[1].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]) : []);
}
const stripQuoted = (t) => t.replace(/'(?:[^']|'')*'/g, ' ').replace(/"(?:[^"\\]|\\.)*"/g, ' ');
const stripComments = (t) => t.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');

function cmdletTokens(text, verbs) {
  const out = new Set();
  for (const m of stripQuoted(text).matchAll(/\b([A-Z][a-zA-Z]*)-([A-Z][a-zA-Z0-9]*)\b/g)) {
    const full = `${m[1]}-${m[2]}`;
    if (!BUILTIN_EXCLUDE.has(full) && verbs.has(m[1])) out.add(full);
  }
  return out;
}

/** Path part of a URI with host/query removed and template or PowerShell variables turned into one literal segment. */
function normalizeUri(uri) {
  return uri.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    .replace(/\$\([^)]*\)/g, 'x').replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, 'x').replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, 'x');
}
const patternMatches = (pattern, uri) => {
  const p = pattern.split('/');
  const u = uri.split('/');
  return p.length === u.length && p.every((s, i) => s === '*' || s === u[i]);
};

function graphCalls(text) {
  const calls = [];
  const marker = 'Invoke-MgGraphRequest';
  let idx = text.indexOf(marker);
  while (idx !== -1) {
    const next = text.indexOf(marker, idx + marker.length);
    const chunk = text.slice(idx, next === -1 ? text.length : next);
    const u = /-Uri\s+['"]([^'"]+)['"]/.exec(chunk);
    const m = /-Method\s+['"]?([A-Za-z]+)/.exec(chunk);
    calls.push({ uri: u ? u[1] : null, method: m ? m[1].toUpperCase() : 'GET' });
    idx = next;
  }
  return calls;
}
function azRestMethodCalls(text) {
  const calls = [];
  for (const m of text.matchAll(/Invoke-AzRestMethod\b([^|;\n]*)/g)) {
    const p = /-Path\s+['"]([^'"]+)['"]/.exec(m[1]);
    const meth = /-Method\s+['"]?([A-Za-z]+)/.exec(m[1]);
    calls.push({ path: p ? p[1] : null, method: meth ? meth[1].toUpperCase() : 'GET' });
  }
  return calls;
}
function azCliCalls(text) {
  const calls = [];
  for (const m of text.matchAll(/(?:^|[;|&({\n]\s*)az\s+([^|;\n]+)/g)) {
    const toks = m[1].trim().split(/\s+/);
    const verb = [];
    for (const t of toks) { if (t.startsWith('-')) break; verb.push(t); }
    const url = /--url\s+['"]?([^'"\s]+)/.exec(m[1]);
    calls.push({ verbPath: verb.join(' '), url: url ? url[1] : null });
  }
  return calls;
}

/** What tenant-stacksim can answer, read from its source and inventory (no simulator code is run). */
export function loadResolverInfo(stacksimRoot) {
  const rdir = path.join(stacksimRoot, 'src', 'resolvers');
  const files = fs.readdirSync(rdir).filter((f) => /Resolvers\.ts$/.test(f) && !/\.test\.ts$/.test(f));   // PH-12 (LOG-PH12-R2 STOP-3): every resolver file, incl. depthInfra and depth10*
  const handCmdlets = new Set();
  const handPatterns = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(rdir, f), 'utf8');
    for (const m of src.matchAll(/\bcmdlet:\s*'([^']+)'/g)) handCmdlets.add(m[1]);
    for (const m of src.matchAll(/\bpattern:\s*'([^']+)'/g)) handPatterns.add(m[1]);
    // PH-12 (LOG-PH12-R4 D2): entries built by a helper call, cmdlet('Get-X', ...) / exoCmdlet('Get-X', ...)
    for (const m of src.matchAll(/\b[A-Za-z]*[cC]mdlet\(\s*'([A-Z][A-Za-z]*-[A-Z][A-Za-z0-9]*)'/g)) handCmdlets.add(m[1]);
  }
  const azRestSrc = fs.readFileSync(path.join(rdir, 'azureResolvers.ts'), 'utf8');
  const azRestBlock = /export const azRestMethodPathResolvers[\s\S]*?\n\];/.exec(azRestSrc)?.[0] ?? '';
  const azRestPatterns = new Set([...azRestBlock.matchAll(/\bpattern:\s*'([^']+)'/g)].map((m) => m[1]));
  // Special-cased URIs handled in code by ResolverTable.ts (regex literals and exact-path comparisons).
  const tableSrc = fs.readFileSync(path.join(rdir, 'ResolverTable.ts'), 'utf8');
  const specialRegexes = [];
  for (const m of tableSrc.matchAll(/\/(\^\\\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\\/\n[])*)\/([gimsuy]*)/g)) {
    try { specialRegexes.push(new RegExp(m[1], m[2].replace('g', ''))); } catch { /* not a regex literal */ }
  }
  const specialPaths = new Set([...tableSrc.matchAll(/normalized === '(\/[^']+)'/g)].map((m) => m[1]));
  // PH12-R5 (LOG-PH12-R5 §7 D; applied by P12-INT): a whole-path regex (anchored ^...$) a resolver file exports for
  // ResolverTable to route, such as depth10R5Resolvers.ts GUEST_CONFIG_PATH. Prefix regexes elsewhere (id parsing) are not routes.
  for (const f of files.filter((x) => x !== 'ResolverTable.ts')) {
    const fsrc = fs.readFileSync(path.join(rdir, f), 'utf8');
    for (const m of fsrc.matchAll(/export const [A-Z0-9_]+ = \/(\^\\\/[^\n]*\$)\/([gimsuy]*);/g)) {
      try { specialRegexes.push(new RegExp(m[1], m[2].replace('g', ''))); } catch { /* not a regex literal */ }
    }
  }

  const deriveSrc = fs.readFileSync(path.join(stacksimRoot, 'src', 'codegen', 'deriveResolversFromInventory.ts'), 'utf8');
  const verbs = approvedVerbs(deriveSrc);
  const invPath = path.join(stacksimRoot, 'coverage', 'inventory.json');
  const items = fs.existsSync(invPath) ? (readJson(invPath).items ?? []) : [];
  const derivedCmdlets = new Set();
  const derivedPatterns = new Set();
  for (const it of items) {
    if (it.excluded || !SIM_ENGINES.has(it.engine)) continue;
    for (const c of cmdletTokens(it.commandText ?? '', verbs)) derivedCmdlets.add(c);
    if (it.engine === 'invoke-mggraphrequest') {
      for (const c of graphCalls(it.commandText ?? '')) {
        if (c.uri) derivedPatterns.add(c.uri.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, '*'));
      }
    }
  }
  const shimPath = path.join(stacksimRoot, 'azshim', 'az-shim.ps1');
  const azVerbPaths = new Set(fs.existsSync(shimPath)
    ? [...fs.readFileSync(shimPath, 'utf8').matchAll(/^\s*'([a-z][a-z -]*)'\s*\{/gm)].map((m) => m[1]) : []);
  return { handCmdlets, handPatterns, azRestPatterns, specialRegexes, specialPaths, derivedCmdlets, derivedPatterns, azVerbPaths, verbs, inventoryItems: items.length };
}

function uriLevel(info, norm) {
  if ([...info.handPatterns].some((p) => patternMatches(p, norm))) return 'modelled';
  if (info.specialPaths.has(norm) || info.specialRegexes.some((r) => r.test(norm))) return 'modelled';
  if ([...info.derivedPatterns].some((p) => patternMatches(p, norm))) return 'generic';
  return 'unanswered';
}

/** Classify every simulator call one command text makes: modelled, generic (inventory-derived) or unanswered. */
export function classifyCommand(text, info) {
  const body = stripComments(text);
  const calls = [];
  for (const c of cmdletTokens(body, info.verbs)) {
    if (c === 'Invoke-AzRestMethod') continue;
    const level = info.handCmdlets.has(c) ? 'modelled' : info.derivedCmdlets.has(c) ? 'generic' : 'unanswered';
    calls.push({ kind: 'cmdlet', token: c, level });
  }
  for (const g of graphCalls(body)) {
    if (!g.uri) { calls.push({ kind: 'graph-uri', token: 'Invoke-MgGraphRequest (no literal -Uri)', level: 'unanswered' }); continue; }
    const norm = normalizeUri(g.uri);
    calls.push({ kind: 'graph-uri', token: `${g.method} ${norm}`, level: uriLevel(info, norm) });
  }
  for (const a of azRestMethodCalls(body)) {
    const norm = a.path ? normalizeUri(a.path) : null;
    const hit = norm && ([...info.azRestPatterns].some((p) => patternMatches(p, norm)) || info.specialRegexes.some((r) => r.test(norm)));
    calls.push({ kind: 'az-rest-method', token: `${a.method} ${norm ?? '(no literal -Path)'}`, level: hit ? 'modelled' : (a.method === 'GET' ? 'unanswered' : 'generic') });
  }
  for (const z of azCliCalls(body)) {
    if (z.verbPath === 'rest') {
      const norm = z.url ? normalizeUri(z.url) : null;
      calls.push({ kind: 'az-cli', token: `az rest ${norm ?? '(no literal --url)'}`, level: norm ? uriLevel(info, norm) : 'unanswered' });
    } else {
      calls.push({ kind: 'az-cli', token: `az ${z.verbPath}`, level: info.azVerbPaths.has(z.verbPath) ? 'modelled' : 'unanswered' });
    }
  }
  return calls;
}

const ENTRY_FIELDS = (e) => [
  ['get_command', e.get_command],
  ['set_command', e.set_command],
  ...(e.evidence_commands ?? []).map((c, i) => [`evidence_commands[${i}]`, c]),
];

export function simulatorCoverage(registry, info, plannedIn = new Map()) {
  const unanswered = [];
  const genericOnly = [];
  let checked = 0;
  for (const e of registry) {
    if (e.manual_only || /manual/.test(e.engine ?? '')) continue;
    const calls = [];
    for (const [field, text] of ENTRY_FIELDS(e)) {
      if (typeof text !== 'string' || text.trim() === '') continue;
      for (const c of classifyCommand(text, info)) calls.push({ field, ...c });
    }
    if (calls.length === 0) continue;
    checked++;
    const base = { entry_id: e.entry_id, registry: e._registry, engine: e.engine, control_ids: e.control_ids ?? [], planned_in: plannedIn.get(e.entry_id) ?? [] };
    const bad = calls.filter((c) => c.level === 'unanswered');
    if (bad.length) unanswered.push({ ...base, calls: bad });
    else if (calls.some((c) => c.level === 'generic')) genericOnly.push({ ...base, calls: calls.filter((c) => c.level === 'generic') });
  }
  return { checked, unanswered, genericOnly };
}

// ---------------------------------------------------------------------------------------------------------------

export function scenarioLabel(planPath) {
  const dir = path.basename(path.dirname(planPath));
  const m = /^gc-w9r1b?-(.+)$/.exec(dir);
  if (m) return m[1];
  const ev = /evidence[\\/]([^\\/]+)/.exec(planPath);
  return ev ? ev[1] : dir;
}

export function run(opts) {
  const o = { ...DEFAULTS, ...opts };
  const objectives = readJson(o.objectives).objectives;
  const registry = loadRegistries(o.registries);
  const vdoc = readJson(o.verdicts);
  const baselinePath = o.baseline ?? vdoc.source_plan;
  const baselineView = baselinePath && fs.existsSync(baselinePath) ? controlView(readJson(baselinePath)) : null;
  const plannedIn = new Map();
  const scenarios = o.plans.map((p) => {
    const plan = readJson(p);
    const label = scenarioLabel(p);
    for (const t of plan.execution_graph ?? []) {
      for (const s of t.action?.args?._sub_commands ?? []) {
        const l = plannedIn.get(s.id) ?? plannedIn.set(s.id, []).get(s.id);
        if (!l.includes(label)) l.push(label);
      }
    }
    return computeScenario({ label, planPath: p, plan, objectives, registry, verdicts: vdoc.verdicts, baselineView });
  });
  const info = loadResolverInfo(o.stacksim);
  const sim = simulatorCoverage(registry, info, plannedIn);
  return {
    schema: 'ces-muster-run/depth-coverage@1',
    generated_at: new Date().toISOString(),
    inputs: { plans: o.plans, objectives: o.objectives, registries: o.registries, verdicts: o.verdicts, baseline_plan: baselinePath, stacksim: o.stacksim },
    definitions: {
      verdicts: VERDICTS,
      uncovered_floor: 'none + unrelated + read_only (baseline floor for V91)',
      verdict_basis: 's1-report = verdict transcribed from the S1 family reports; carried to other plans unchanged. differs_from_s1 = the control\'s sub-commands (id + write flag) or directives differ from the baseline S1 plan, so the carried verdict needs review.',
      sub_commands: '_sub_commands ids of tasks whose controls[] include the control, kept when the entry\'s control_ids include the control (or, with no control_ids, the task was compiled for it); narrowed by objective_ids when the entry carries that field.',
      registry_claims: 'registry entries whose objective_ids name the objective (empty while no entry carries the field).',
      simulator_levels: 'modelled = a hand-authored resolver (src/resolvers/*.ts cmdlet/pattern, ResolverTable.ts special path, az-shim.ps1 route); generic = only the inventory-derived resolver (reads a store collection by noun; empty when unseeded); unanswered = no resolver.',
    },
    scenarios: scenarios.map((s) => ({ ...s })),
    summary: scenarios.map((s) => ({ label: s.label, counts: s.counts, uncovered_floor: s.uncovered_floor, differs_from_s1_controls: s.differs_from_s1_controls.length })),
    simulator: {
      resolver_source: 'tenant-stacksim src/resolvers/*.ts + coverage/inventory.json (derivation replicated) + azshim/az-shim.ps1; read as text',
      inventory_items: info.inventoryItems,
      hand_cmdlets: info.handCmdlets.size,
      derived_cmdlets: info.derivedCmdlets.size,
      registry_entries_checked: sim.checked,
      unanswered_entries: sim.unanswered.length,
      generic_only_entries: sim.genericOnly.length,
      generic_only: sim.genericOnly,
    },
    simulator_unanswered: sim.unanswered,
  };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--plan') { (o.plans ??= []).push(path.resolve(v)); i++; }
    else if (a === '--out') { o.out = path.resolve(v); i++; }
    else if (a === '--objectives') { o.objectives = path.resolve(v); i++; }
    else if (a === '--registry') { (o.registries ??= []).push(path.resolve(v)); i++; }
    else if (a === '--verdicts') { o.verdicts = path.resolve(v); i++; }
    else if (a === '--baseline') { o.baseline = path.resolve(v); i++; }
    else if (a === '--stacksim') { o.stacksim = path.resolve(v); i++; }
    else throw new Error(`depth-coverage: unknown argument ${a}`);
  }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const opts = parseArgs(process.argv.slice(2));
  const result = run(opts);
  const out = opts.out ?? DEFAULTS.out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  for (const s of result.summary) {
    const c = s.counts;
    console.log(`${s.label}: configured ${c.configured} / partial ${c.partial} / read_only ${c.read_only} / manual_or_document ${c.manual_or_document} / unrelated ${c.unrelated} / none ${c.none} / definitional ${c.definitional}${c.unrated ? ` / unrated ${c.unrated}` : ''}; uncovered ${s.uncovered_floor}; controls differing from S1 ${s.differs_from_s1_controls}`);
  }
  console.log(`simulator: ${result.simulator.registry_entries_checked} entries checked, ${result.simulator.unanswered_entries} unanswered, ${result.simulator.generic_only_entries} generic-only`);
  console.log(`wrote ${out}`);
}
