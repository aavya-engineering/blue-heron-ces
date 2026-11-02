#!/usr/bin/env node
// Synthetic-customer W4 (PLAN.md §1, §4, §5 row W4): the assessor scorecard SC-1 ... SC-8 for one scenario's run.
//   node scorecard.mjs --scenario <slug> [--root <WS>] [--run <dir>] [--bundle <dir>] [--out <dir>]
//   --root   the workspace root (default: three levels above this script); ces-shared and ces-muster are read from it
//   --run    the run outputs folder in the <WS>\out layout (default <root>\out); its bundle is runs\latest.json's raw copy
//   --bundle an archived raw bundle folder (01-plans ... 12-evidence-index) read instead of --run; no plan-trace,
//            evidence store or EO package snapshot is in a bundle, so the rows that need them say so
//   --out    where scorecard-<slug>.json is written (default: the --run folder; with --bundle, required)
//   --exclude-honest-nulls <file>|off  (W7-PKG; PH-11 Q4, founder 2026-11-01: ON by default with scripts\honest-nulls-fq1.json)
//            applies founder question FQ-1's disposition: the file's controls
//            (honest nulls, each with its reason) leave SC-8a's denominator like ruling R-1's, stay GAPS unsure rows with
//            the reason, and are printed under the table. File: [{control, reason, scenarios?}] or {controls: [...]}.
//            A <file> replaces the shipped list; "off" turns the disposition off (SC-8a as before W7-PKG).
// Prints the table and writes <out>\scorecard-<slug>.json. Exit 0 when every row is within the scenario's thresholds.
// Thresholds: customers\<slug>\thresholds.json when present, else the PLAN.md §1 table (B21) encoded in DEFAULT_THRESHOLDS.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = path.dirname(SCRIPTS_DIR);

// ---------- helpers ----------
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const exists = (p) => !!p && fs.existsSync(p);
const tryJson = (p) => { try { return exists(p) ? readJson(p) : null; } catch { return null; } };
const listFiles = (dir) => (exists(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((p) => fs.statSync(p).isFile()) : []);
const latestIn = (dir, prefix, ext = '.json') => {
  if (!exists(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith(ext)).sort().pop();
  return f ? path.join(dir, f) : null;
};
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const countOf = (s, re) => (String(s).match(re) ?? []).length;

// ---------- zip / DOCX (no dependency: central directory + raw inflate) ----------
export function readZipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < entries; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const ename = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (ename === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}
const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// Same text rule as verify.mjs (V31): one line per <w:p>, tags removed, entities decoded.
export function docxText(file) {
  if (!exists(file)) return null;
  const xml = readZipEntry(fs.readFileSync(file), 'word/document.xml');
  if (!xml) return null;
  return decodeXml(xml.toString('utf8').replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => `${m.replace(/<[^>]+>/g, '')}\n`).replace(/<[^>]+>/g, ''));
}

// ---------- scenario and thresholds (PLAN.md §1 per-scenario table, B21) ----------
export const SCENARIO_OF_SLUG = { 's1-mach': 'S1', 's2-eng': 'S2', 's3-def': 'S3' };
const S1 = {
  'SC-1': { minPassed: 7 }, 'SC-2': { minPassed: 9 },
  'SC-3a': { minPct: 75 }, 'SC-3b': { all: true }, 'SC-4': { maxPct: 25 },
  'SC-5': { maxJson: 10, maxDocx: 10 }, 'SC-6': { minPolicies: 22, minOdps: 15 },
  'SC-7': { exact: true }, 'SC-8a': { maxPct: 15 }, 'SC-8b': { maxTcp: 5 },
};
export const DEFAULT_THRESHOLDS = {
  S1,
  S2: { ...S1, 'SC-3a': { minPct: 65 }, 'SC-8a': { maxPct: 20 } },
  // S3 is deficient by design: SC-1 rows 1, 2, 5 only (truthfulness); SC-2, SC-3a, SC-5, SC-6, SC-8b not required.
  S3: {
    'SC-1': { rows: [1, 2, 5] }, 'SC-2': { exempt: true }, 'SC-3a': { exempt: true }, 'SC-3b': { all: true },
    'SC-4': { maxPct: 25 }, 'SC-5': { exempt: true }, 'SC-6': { exempt: true }, 'SC-7': { exact: true },
    'SC-8a': { maxPct: 15 }, 'SC-8b': { exempt: true },
  },
};
export function thresholdsFor(slug, pkgDir = PKG_DIR) {
  const file = path.join(pkgDir, 'customers', slug, 'thresholds.json');
  const scenario = SCENARIO_OF_SLUG[slug] ?? 'S1';
  if (exists(file)) return { scenario, source: path.relative(pkgDir, file), thresholds: { ...DEFAULT_THRESHOLDS[scenario], ...readJson(file) } };
  return { scenario, source: SCENARIO_OF_SLUG[slug] ? `PLAN.md §1 table (${scenario})` : 'PLAN.md §1 table (S1 column; slug is not a synthetic customer)', thresholds: DEFAULT_THRESHOLDS[scenario] };
}

// ---------- the authoritative assessed SPRS (W6 follow-up, S3 run 60) ----------
// The documents (POA&M, SSP section 14) are generated after E7B's re-assessment, so the assessed SPRS they must carry is
// the latest assessment in the run: E7B's when the scenario has expected_improvements (E7A's record), or when E7B's
// counts differ from E7 pass 3 by nothing but those improvements; else the three E7 passes' value. The three E7 passes
// must agree among themselves either way. Shared by SC-7, SC-2 row 15 and verify.mjs V36.
//   passes: [{ file, summary }] (E7 passes 1-3, assess_summary events); e7b: { file, summary } | null;
//   improvements: [{ controlId, op, from, to }]; weightOf(controlId) -> SPRS weight (E7B ledger) or undefined.
const SUMMARY_KEY = { met: 'controls_met', not_met: 'controls_not_met', partial: 'controls_partial', not_assessed: 'controls_not_assessed' };
export const summaryOf = (events) => (Array.isArray(events) ? events.find((e) => e.type === 'assess_summary') ?? null : null);
export function sprsAuthority({ passes, e7b, improvements = [], weightOf = () => undefined }) {
  const problems = [];
  const e7 = [...new Set(passes.map((p) => p.summary.sprs_score))];
  if (e7.length > 1) problems.push(`the E7 passes disagree: ${passes.map((p) => `${p.file}=${p.summary.sprs_score}`).join(', ')}`);
  const p3 = passes.length ? passes[passes.length - 1].summary : null;
  const imp = improvements.map((i) => ({ ...i, weight: weightOf(i.controlId) }));
  const explain = imp.map((i) => `${i.controlId} ${i.from} -> ${i.to}${i.op ? ` (${i.op})` : ''}, weight ${i.weight ?? '?'}`).join('; ');
  let value = e7.length === 1 ? e7[0] : null, source = 'E7 passes';
  if (e7b && p3) {
    const exp = Object.fromEntries(Object.values(SUMMARY_KEY).map((k) => [k, p3[k]]));
    for (const i of imp) {
      if (exp[SUMMARY_KEY[i.from]] !== undefined) exp[SUMMARY_KEY[i.from]]--;
      if (exp[SUMMARY_KEY[i.to]] !== undefined) exp[SUMMARY_KEY[i.to]]++;
    }
    const countsOk = Object.entries(exp).every(([k, v]) => v === undefined || e7b.summary[k] === v);
    const dSprs = imp.every((i) => typeof i.weight === 'number')
      ? imp.reduce((n, i) => n + (i.to === 'met' && i.from !== 'met' ? i.weight : i.from === 'met' && i.to !== 'met' ? -i.weight : 0), 0) : null;
    const sprsOk = dSprs === null || e7b.summary.sprs_score - p3.sprs_score === dSprs;
    if (countsOk && sprsOk) { value = e7b.summary.sprs_score; source = 'E7B'; }
    else if (imp.length) {
      value = e7b.summary.sprs_score; source = 'E7B';
      problems.push(`E7B (${e7b.summary.sprs_score}) differs from E7 pass 3 (${p3.sprs_score}) by more than the expected improvements (${explain})`);
    }
  }
  const detail = `authoritative ${value ?? '?'} (${source}); E7 passes ${e7.join('/') || 'none'}${e7b ? `, E7B ${e7b.summary.sprs_score}` : ''}${source === 'E7B' && imp.length ? ` (E7B improvement: ${explain})` : ''}`;
  const snapshotId = (source === 'E7B' ? e7b?.summary.snapshotId : p3?.snapshotId) ?? null;
  return { value, source, snapshotId, e7, e7b: e7b?.summary.sprs_score ?? null, explain, problems, detail };
}
// The run's inputs to sprsAuthority (an E7A record of another scenario is never this run's).
export function sprsInputs(inp) {
  const passes = inp.assess.map((a) => ({ file: a.file, summary: summaryOf(a.events) })).filter((p) => p.summary);
  const s7 = summaryOf(inp.assess7b);
  const e7a = inp.adminOpsE7a && (!inp.adminOpsE7a.tenant_slug || inp.adminOpsE7a.tenant_slug === inp.slug) ? inp.adminOpsE7a : null;
  const w = new Map([...(inp.ssp?.controlImplementations ?? []).map((c) => [c.control_id, Number(c.weight)]), ...(inp.eoLedger?.controls ?? []).map((c) => [c.controlId, Number(c.weight)])]);
  return { passes, e7b: s7 ? { file: 'eo-assess-7b.json', summary: s7 } : null, improvements: e7a?.expected_improvements ?? [], weightOf: (id) => (Number.isFinite(w.get(id)) ? w.get(id) : undefined) };
}

// ---------- inputs ----------
// One reader for both layouts: a run folder (<WS>\out) with its bundle, or an archived raw bundle alone.
// W7-PKG (FQ-1): the honest-null file of --exclude-honest-nulls, read for one slug: Map control -> reason. An entry's
// optional `scenarios` (slugs) limits it; every entry needs a control and a reason (an unreadable or reasonless file throws).
export function loadHonestNulls(file, slug) {
  const j = readJson(file);
  const list = Array.isArray(j) ? j : j?.controls;
  if (!Array.isArray(list)) throw new Error(`${file}: expected [{control, reason}] or {controls: [...]}`);
  const m = new Map();
  for (const e of list) {
    if (!e?.control || !String(e.reason ?? '').trim()) throw new Error(`${file}: every honest null needs a control and a reason (${JSON.stringify(e)})`);
    if (!Array.isArray(e.scenarios) || e.scenarios.includes(slug)) m.set(e.control, String(e.reason).trim());
  }
  return { file, controls: m };
}

export function loadInputs({ root, slug, runDir = null, bundleDir = null, pkgDir = PKG_DIR, honestNullsFile = null }) {
  const notes = [];
  let bundle = bundleDir;
  const run = bundleDir ? null : (runDir ?? path.join(root, 'out'));
  if (!bundle && run) {
    const latest = tryJson(path.join(run, 'runs', 'latest.json'));
    if (latest?.evidence) bundle = path.join(run, 'runs', latest.evidence, 'raw');
    else notes.push('no runs\\latest.json: bundle items (evidence index, Stamper records, pushed IM) not read');
  }
  const b = (rel) => (bundle ? path.join(bundle, rel) : null);
  const r = (rel) => (run ? path.join(run, rel) : null);
  const pick = (...ps) => ps.find((p) => exists(p)) ?? null;
  const manifest = tryJson(b('manifest.json'));
  const files = {
    ssp: pick(r('ssp.json'), b('02-ssp/ssp.json')),
    docx: pick(r('ssp.docx'), b('02-ssp/ssp.docx')),
    poam: pick(r('poam.json'), b('03-poam/poam.json')),
    eoLedger: pick(r('eo-ledger.json'), b('07-eo-assessment/eo-ledger.json')),
    readiness: pick(r(`plan/readiness-result-${slug}.json`), b(`10-readiness/readiness-result-${slug}.json`)),
    planTrace: pick(r('plan/plan-trace.json')),
    policiesDir: pick(r('plan/policies'), b('04-policies')),
    policyProfile: pick(latestIn(r('plan'), 'policy-inputs-profile-'), latestIn(b('01-plans/pushed'), 'policy-inputs-profile-')),
    im: pick(latestIn(b('01-plans/pushed'), 'infrastructure-manifest-')),
    evidenceIndex: pick(b('12-evidence-index/evidence-index.json')),
    stamperEvidence: pick(b('06-execution/evidence')),
    stamperByTask: pick(b('06-execution/evidence-by-task')),
  };
  // Per-run cleanup follow-up (run 61): a run-folder assessment written before this run's E1 start (steps.json) is a
  // stale artefact from an earlier run; it is left out (with a note), never read as this run's.
  const e1Ms = Date.parse(tryJson(r('steps.json'))?.E1?.started ?? '');
  const stale = (p) => !!p && !!run && Number.isFinite(e1Ms) && path.resolve(p).startsWith(path.resolve(run)) && fs.statSync(p).mtimeMs < e1Ms;
  const freshPick = (f, bundleRel) => { const p = pick(r(f), b(bundleRel)); if (stale(p)) { notes.push(`${f}: stale artefact from an earlier run (written before this run's E1 start); not read`); return null; } return p; };
  const assess = ['eo-assess.json', 'eo-assess-2.json', 'eo-assess-3.json'].map((f) => [f, freshPick(f, `07-eo-assessment/${f}`)]).filter(([, p]) => p);
  // EO package snapshot (statusRationale carries the deciding tier) and the evidence store: run-folder layout only.
  let snapshot = null;
  if (run && exists(path.join(run, 'eo-package'))) {
    const d = fs.readdirSync(path.join(run, 'eo-package')).filter((x) => x.startsWith('evidence-package-')).sort().pop();
    snapshot = d ? tryJson(path.join(run, 'eo-package', d, 'assessments', 'latest-snapshot.json')) : null;
  }
  let storeRecords = null;
  const storeRoot = run ? path.join(run, 'eo', 'evidence-store') : null;
  if (exists(storeRoot)) {
    const dirs = fs.readdirSync(storeRoot).map((d) => path.join(storeRoot, d)).filter((d) => exists(path.join(d, 'manifest.json')));
    const dir = dirs.find((d) => readJson(path.join(d, 'manifest.json')).tenantSlug === slug) ?? (dirs.length === 1 ? dirs[0] : null);
    if (dir && exists(path.join(dir, 'records.jsonl'))) storeRecords = fs.readFileSync(path.join(dir, 'records.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  }
  const loadRecs = (dir) => listFiles(dir).filter((p) => p.endsWith('.json')).map((p) => ({ p, rec: tryJson(p) })).filter((x) => x.rec);
  const policies = files.policiesDir ? fs.readdirSync(files.policiesDir).filter((f) => f.endsWith('.md')).sort().map((f) => ({ file: f, text: fs.readFileSync(path.join(files.policiesDir, f), 'utf8') })) : [];
  let docx = null;
  try { docx = files.docx ? docxText(files.docx) : null; } catch (e) { notes.push(`DOCX unreadable: ${e.message}`); }
  const objRef = tryJson(path.join(root ?? '', 'ces', 'ces-shared', 'src', 'data', 'assessment-objectives.reference.json'))
    ?? tryJson(path.join(root ?? '', 'ces', 'ces-shared', 'dist', 'data', 'assessment-objectives.reference.json'));
  const bankFile = path.join(root ?? '', 'ces', 'ces-muster', 'public', 'knowledge', 'primed TCP Question Bank.yaml');
  const tcpBankCount = exists(bankFile) ? new Set(fs.readFileSync(bankFile, 'utf8').match(/TCP\.[A-Z]+\.\d+/g) ?? []).size : 39;
  // SC-8a (ruling R-1): the discovery observations (entry ids per control) and the Stamper registry the package pins
  // (<root>\ces\ces-stamper\src\registry, the two registries discovery-result.json provenance.registry_versions names).
  // discovery-result.json is used when it is this scenario's; else the readiness file's observations (the same array).
  const readiness = tryJson(files.readiness);
  const disc = tryJson(r('discovery-result.json'));
  const discoveryObservations = disc?.manifest?.tenant?.slug === slug ? (disc.observations ?? null) : (readiness?.observations ?? null);
  const regs = REGISTRY_FILES.map((n) => tryJson(path.join(root ?? '', 'ces', 'ces-stamper', 'src', 'registry', `${n}.registry.json`)));
  const registry = regs.some(Boolean) ? regs.flatMap((x) => x?.entries ?? []) : null;
  if (!registry) notes.push('Stamper registry not found (ces\\ces-stamper\\src\\registry): SC-8a excludes nothing');
  return {
    slug, root, run, bundle, notes, files,
    runId: manifest?.runId ?? null,
    ssp: tryJson(files.ssp), docxText: docx, poam: tryJson(files.poam), eoLedger: tryJson(files.eoLedger),
    readiness, planTrace: tryJson(files.planTrace), policies, discoveryObservations, registry,
    policyProfile: tryJson(files.policyProfile)?.artifact ?? null, im: tryJson(files.im),
    evidenceIndex: tryJson(files.evidenceIndex),
    assess: assess.map(([f, p]) => ({ file: f, events: tryJson(p), text: fs.readFileSync(p, 'utf8') })),
    stamperRecords: files.stamperEvidence ? loadRecs(files.stamperEvidence).filter((x) => x.rec.registryEntry) : [],
    stamperTaskFiles: files.stamperByTask ? loadRecs(files.stamperByTask) : [],
    snapshot, storeRecords,
    answers: tryJson(path.join(pkgDir, 'customers', slug, 'interview-answers.json')),
    // W6 (S3): the scenario's seeded deficiencies (customers\<slug>\deficiencies.json) and the tester's E7A record (run folder only).
    deficiencies: tryJson(path.join(pkgDir, 'customers', slug, 'deficiencies.json')),
    adminOpsE7a: tryJson(r('adminops-e7a.json')),
    // W6 follow-up (post-E7B SPRS): E7B's re-assessment, the latest in the run (POA&M and SSP section 14 are generated after it).
    assess7b: tryJson(freshPick('eo-assess-7b.json', '07-eo-assessment/eo-assess-7b.json')),
    lexicon: tryJson(path.join(pkgDir, 'scripts', 'negation-lexicon.json'))?.phrases ?? null,
    objectiveRef: objRef?.objectives ?? null,
    tcpBankCount,
    // W7-PKG: FQ-1's honest nulls, only when the caller names a file (PH-11 Q4: parseArgs and verify.mjs pass the shipped
    // DEFAULT_HONEST_NULLS_FILE unless "--exclude-honest-nulls off"; a direct loadInputs call without one applies none).
    honestNulls: honestNullsFile ? loadHonestNulls(honestNullsFile, slug) : null,
  };
}

// ---------- shared rules ----------
export const MANUAL_MARKERS = [/\[MANUAL INPUT REQUIRED\]/g, /REQUIRES MANUAL INPUT/g];
export const MARKER_LABELS = ['[MANUAL INPUT REQUIRED]', 'REQUIRES MANUAL INPUT'];
// W5 cycle 1: the sentence EO writes where the organisation supplied no content. Copied from ces-eo
// src\eo\ssp\ContentGap.ts (NOT_SUPPLIED); keep the two identical. Counted as a content gap, apart from the two markers.
export const NOT_SUPPLIED = 'Not supplied by the organisation (content gap)';
const NOT_SUPPLIED_RE = new RegExp(NOT_SUPPLIED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
export const contentGapCount = (s) => countOf(s, NOT_SUPPLIED_RE);
// The appended disclosures the W1.4 guard does not see (V30's rule).
export const stripDisclosures = (n) => String(n ?? '').replace(/\n\n(Evidence disagreement|Presence only): [\s\S]*?(?=\n\n(Evidence disagreement|Presence only): |$)/g, '');
const lexPattern = (p) => new RegExp((/^[A-Za-z0-9]/.test(p) ? '(?<![A-Za-z0-9])' : '') + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
// RR-ACT-AC_L1_3_1_1 -> AC.L1-3.1.1
export const controlOfQuestion = (qid) => { const m = /^RR-ACT-([A-Z]{2})_(L\d)_(\d+)_(\d+)_(\d+)/.exec(qid); return m ? `${m[1]}.${m[2]}-${m[3]}.${m[4]}.${m[5]}` : null; };
// SC-8a's denominator: discovery-sourced readiness answers to the RR-ACT activity questions (REVIEW-A: "104 discovery-sourced
// RR-ACT answers" on run 25). Interview answers are excluded (PLAN §1), and the readiness file is read, not the merged session
// facts (LOG-W1-muster §2).
export const discoveryFacts = (readiness) => (readiness?.facts ?? []).filter((f) => /^RR-ACT-/.test(f.question_id) && ['auto_detected', 'discovery'].includes(f.provenance));
// Ruling R-1 (LOG-W5c3-muster.md §5): SC-8a leaves out of its denominator the answers of controls discovery can never read.
// Derived from run outputs: the entries discovery ran for the control (observations' ran_entry_ids) and their registry rows.
//   manual-only       = every ran entry is manual_only or has no get_command (discovery runs no read);
//   platform-inherited = every ran entry is a registry "(Platform Inherited)" entry (AU.L2-3.3.7, SC.L2-3.13.11 today).
// A control with no observation, or a ran entry the registry does not hold, is never excluded.
export const REGISTRY_FILES = ['cmmc-l2-commands', 'infra-cmmc-l2-commands'];
export const UNDISCOVERABLE_REASON = { 'manual-only': 'not discoverable: manual-only control', 'platform-inherited': 'not discoverable: platform-inherited control' };
export const registryReadable = (e) => !e.manual_only && String(e.get_command ?? '').trim() !== '';
export function undiscoverableControls(inp) {
  const out = new Map();
  if (!inp.registry || !inp.discoveryObservations) return out;
  const byId = new Map(inp.registry.map((e) => [e.entry_id, e]));
  const ran = new Map();
  for (const o of inp.discoveryObservations) ran.set(o.control_id, new Set([...(ran.get(o.control_id) ?? []), ...(o.ran_entry_ids ?? [])]));
  for (const [cid, ids] of ran) {
    const es = [...ids].map((id) => byId.get(id));
    if (!es.length || es.some((e) => !e)) continue;
    if (!es.some(registryReadable)) out.set(cid, 'manual-only');
    else if (es.every((e) => /\(Platform Inherited\)/.test(e.label ?? ''))) out.set(cid, 'platform-inherited');
  }
  return out;
}
// SC-8a's split. An answers-file (interview) RR-ACT answer replaces the discovery answer of the same question and keeps it in
// the denominator (never excluded); it counts as unsure only when the interview answer is itself unsure.
// W7-PKG (FQ-1, only with --exclude-honest-nulls): an honest null without an interview answer is excluded the same way,
// with the reason "honest null (FQ-1): <reason>" and honestNull: true.
export const HONEST_NULL_PREFIX = 'honest null (FQ-1): ';
export function sc8aSplit(inp) {
  const nd = undiscoverableControls(inp);
  const hn = inp.honestNulls?.controls ?? null;
  const interview = new Map((inp.answers ?? []).filter((f) => /^RR-ACT-/.test(f.question_id)).map((f) => [f.question_id, f]));
  const counted = [], excluded = [];
  for (const f of discoveryFacts(inp.readiness)) {
    const cid = controlOfQuestion(f.question_id);
    const iv = interview.get(f.question_id);
    if (!iv && nd.has(cid)) excluded.push({ ...f, control: cid, reason: UNDISCOVERABLE_REASON[nd.get(cid)] });
    else if (!iv && hn?.has(cid)) excluded.push({ ...f, control: cid, reason: `${HONEST_NULL_PREFIX}${hn.get(cid)}`, honestNull: true });
    else counted.push({ ...f, control: cid, answer: iv ? iv.answer : f.answer, replacedByInterview: !!iv });
  }
  return { counted, excluded };
}
// The 15 ODPs in bank order (PI.ODP.001 ... 015) as the policy-inputs profile names them.
export const ODP_KEYS = ['account_lockout_threshold', 'account_lockout_duration_minutes', 'session_timeout_minutes', 'min_password_length', 'password_history_count', 'max_password_age_days', 'audit_log_retention_days', 'vuln_scan_frequency', 'critical_patch_timeline_days', 'high_patch_timeline_days', 'training_frequency', 'incident_reporting_hours', 'access_review_frequency', 'backup_frequency', 'media_sanitization_standard'];
// Placeholder occurrences in the SSP JSON with their JSON paths.
export function placeholderHits(obj) {
  const hits = [];
  const walk = (v, p) => {
    if (typeof v === 'string') {
      MANUAL_MARKERS.forEach((re, k) => { const n = countOf(v, re); for (let i = 0; i < n; i++) hits.push({ path: p, marker: MARKER_LABELS[k], occurrence: i + 1 }); });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
  };
  walk(obj, '');
  return hits;
}
// Content-gap sentences (NOT_SUPPLIED) in the SSP JSON with their JSON paths and, when the sentence form is used, what is missing.
export function contentGapHits(obj) {
  const hits = [];
  const tail = new RegExp(`${NOT_SUPPLIED_RE.source}(?:: ([^\\n]*?)\\.(?=\\s|$))?`, 'g');
  const walk = (v, p) => {
    if (typeof v === 'string') {
      let i = 0;
      for (const m of v.matchAll(tail)) hits.push({ path: p, what: m[1] ?? null, occurrence: ++i });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
  };
  walk(obj, '');
  return hits;
}
// The examine items of the evidence index (bundle item 12), split as PLAN §1 does: documentary (SC-3b), the SSP/POA&M items any
// SSP covers (excluded), and the automatable rest (SC-3a).
export function examineItems(index) {
  const out = { automatable: [], documentary: [], sspPoam: [] };
  for (const c of index?.examineCoverage ?? []) for (const it of c.items ?? []) {
    const row = { controlId: c.controlId, requirementId: c.requirementId, kindsPresent: c.kindsPresent ?? [], ...it };
    if (it.category === 'documentary') out.documentary.push(row);
    else if (it.category === 'ssp' || it.category === 'poam') out.sspPoam.push(row);
    else out.automatable.push(row);
  }
  return out;
}
// SC-3b credit (W5): a documentary item that EO's evidence index credits to a hashed Muster policy (creditedTo {document,
// sha256}, set by ces-eo creditDocumentaryItem). Only documentary items count; SC-3a's automatable items are bucketed by
// category first, so a credit can never move SC-3a.
export const creditedDocumentary = (inputs) => examineItems(inputs.evidenceIndex).documentary.filter((x) => x.creditedTo?.document && x.creditedTo?.sha256);
// The documentary items that become GAPS rows (every one not credited). gaps.mjs emits exactly this list.
export function documentaryItems(inputs) {
  const credited = new Set(creditedDocumentary(inputs).map((x) => `${x.controlId}#${x.index}`));
  return examineItems(inputs.evidenceIndex).documentary.filter((x) => !credited.has(`${x.controlId}#${x.index}`));
}
// Policy-document completeness (SC-6): owner named, an approver named, and no unfilled name, title or placeholder.
const BLANK = /^(|not specified|tbd|n\/a|none|designated official|\[.*\]|_+)$/i;
export function policyCompleteness(doc) {
  const t = doc.text;
  const owner = (/\*\*(?:Policy|Plan|Document) Owner:\*\*[ \t]*([^\n]*)/.exec(t)?.[1] ?? '').trim();
  const approver = ((/\|\s*\*\*Approved By\*\*\s*\|\s*([^|\n]*)\|/.exec(t) ?? /\*\*Approved By:\*\*[ \t]*([^\n]*)/.exec(t) ?? (/##\s*Attestation[\s\S]*?\*\*Name:\*\*[ \t]*([^\n]*)/.exec(t)))?.[1] ?? '').trim();
  const blanks = [['[Name]', /\[Name\]/g], ['[Title]', /\[Title\]/g], ['Not specified', /\bNot specified\b/g], ['TBD', /\bTBD\b/g], ['[MANUAL INPUT REQUIRED]', MANUAL_MARKERS[0]], ['REQUIRES MANUAL INPUT', MANUAL_MARKERS[1]]]
    .map(([label, re]) => [label, countOf(t, re)]).filter(([, n]) => n > 0);
  const problems = [];
  if (BLANK.test(owner)) problems.push('no named owner');
  if (BLANK.test(approver)) problems.push('no named approver');
  for (const [k, n] of blanks) problems.push(`${n} × ${k}`);
  return { file: doc.file, complete: problems.length === 0, problems };
}
export function odpAnswers(inputs) {
  const odps = inputs.policyProfile?.odps ?? {};
  const byId = new Map((inputs.answers ?? []).filter((f) => /^PI\.ODP\.\d{3}$/.test(f.question_id)).map((f) => [f.question_id, f]));
  return ODP_KEYS.map((key, i) => {
    const id = `PI.ODP.${String(i + 1).padStart(3, '0')}`;
    const a = byId.get(id);
    const value = odps[key];
    const answered = !!a && value !== undefined && String(value).trim().toLowerCase() === String(a.answer).trim().toLowerCase();
    return { id, key, answered, reason: answered ? 'profile value = answers file' : a ? 'profile value differs from the answers file' : 'no answer in the answers file (bank default)' };
  });
}
const sspDate = (ssp) => String(ssp?.generatedAt ?? '').slice(0, 10);

// ---------- SC-1 / SC-2 predicates (ssp-uplift/REVIEW.md §2 rows 1-18) ----------
// Each returns { row, pri, title, pass, detail }. A missing input is a failure with its reason, never "not computed".
export function sspReviewPredicates(inp) {
  const s = inp.ssp;
  const ctl = s?.controlImplementations ?? [];
  const met = ctl.filter((c) => c.status === 'met');
  const na = ctl.filter((c) => c.status === 'not_assessed');
  const P = [];
  const add = (row, pri, title, fn) => {
    let r;
    try { r = s ? fn() : { pass: false, detail: 'no SSP JSON' }; } catch (e) { r = { pass: false, detail: `error: ${e.message}` }; }
    P.push({ row, pri, title, pass: !!r.pass, detail: r.detail });
  };
  add(1, 'P0', 'Status agrees with narrative: no met control narrative hits the negation lexicon or carries a manual-input marker', () => {
    if (!inp.lexicon) return { pass: false, detail: 'negation lexicon not found (scripts\\negation-lexicon.json)' };
    const bad = met.filter((c) => inp.lexicon.some((p) => lexPattern(p).test(stripDisclosures(c.implementationNarrative))) || MANUAL_MARKERS.some((re) => countOf(c.implementationNarrative, re)));
    return { pass: bad.length === 0, detail: `${bad.length} of ${met.length} met controls contradict their status${bad.length ? ` (e.g. ${bad.slice(0, 5).map((c) => c.control_id).join(', ')})` : ''}` };
  });
  add(2, 'P0', 'DOCX status vocabulary (V31 rule): every not-assessed block checks "Not Yet Assessed" and never says Not Applicable', () => {
    if (!inp.docxText) return { pass: false, detail: 'DOCX text unreadable or absent' };
    const lines = inp.docxText.split('\n');
    const heading = /^([A-Z]{2}\.L[123]-\d+\.\d+\.\d+) — \d+\.\d+\.\d+$/;
    const starts = new Map();
    lines.forEach((l, i) => { const m = l.trim().match(heading); if (m && !starts.has(m[1])) starts.set(m[1], i); });
    const order = [...starts.entries()].sort((x, y) => x[1] - y[1]);
    const block = (id) => { const k = order.findIndex(([c]) => c === id); return k < 0 ? null : lines.slice(order[k][1], k + 1 < order.length ? order[k + 1][1] : lines.length).join('\n'); };
    const problems = [];
    for (const c of na) {
      const blk = block(c.control_id);
      if (blk === null) problems.push(`${c.control_id}: no heading`);
      else if (/Not Applicable|\bN\/A\b/.test(blk) || !/☒ Not Yet Assessed/.test(blk)) problems.push(`${c.control_id}: wrong status line`);
    }
    const checked = countOf(inp.docxText, /☒ Not Yet Assessed/g);
    if (checked !== na.length) problems.push(`"☒ Not Yet Assessed" ${checked} != ${na.length}`);
    const wrong = countOf(inp.docxText, /☒ (Not Applicable|Planned)/g);
    if (wrong) problems.push(`${wrong} checked Not Applicable / Planned`);
    return { pass: problems.length === 0, detail: problems.length ? problems.slice(0, 5).join('; ') : `${na.length} not-assessed controls render "Not Yet Assessed"` };
  });
  add(3, 'P0', 'Boundary is a boundary: >= 1 zone, no zone is a question key (snake_case or a boundary-fact key), the tenant is named', () => {
    const ab = s.authorizationBoundary ?? {};
    const zones = [...(ab.zones ?? []), ...(ab.zoneDetails ?? []).map((z) => z.name)];
    const factKeys = new Set((ab.boundaryFacts ?? []).map((f) => f.key));
    const bad = zones.filter((z) => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(z) || factKeys.has(z));
    const named = !!s.tenantId && JSON.stringify(ab).includes(s.tenantId);
    return { pass: zones.length > 0 && bad.length === 0 && named, detail: `${(ab.zones ?? []).length} zones; question-key zones ${bad.length}; tenant id ${named ? 'named' : 'not named'} in the boundary` };
  });
  add(4, 'P0', 'Inventory (V34 rule): SSP components = the pushed IM resources', () => {
    if (!inp.im) return { pass: false, detail: 'no pushed IM in the bundle' };
    const inner = inp.im.infrastructure ?? inp.im.infrastructure_manifest ?? inp.im;
    const want = [];
    for (const [section, v] of Object.entries(inner)) if (Array.isArray(v)) for (const x of v) if (x && x.resource_type) want.push(`${section}|${`${x.name ?? ''} (${x.resource_type})`.trim()}`);
    const got = (s.systemComponents?.sections ?? []).flatMap((x) => (x.components ?? []).map((c) => `${x.name}|${c}`));
    const cnt = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
    const w = cnt(want), g = cnt(got);
    const missing = [...w].filter(([k, n]) => (g.get(k) ?? 0) < n).length, extra = [...g].filter(([k, n]) => (w.get(k) ?? 0) < n).length;
    return { pass: want.length > 0 && !missing && !extra, detail: `${got.length} components vs ${want.length} IM resources; missing ${missing}, extra ${extra}` };
  });
  add(5, 'P0', 'POA&M chapter (V35 rule): §14 = poam.json and every ledger-deficient control is an item, a blocker or no_poam', () => {
    const pm = inp.poam, sm = s.poamSummary;
    if (!pm) return { pass: false, detail: 'no poam.json' };
    if (!sm) return { pass: false, detail: 'no §14 (poamSummary)' };
    const ids = (xs) => [...new Set((xs ?? []).map((x) => x.control_id))].sort().join(',');
    const problems = [];
    if (sm.poamId !== pm.poamId) problems.push('poamId differs');
    if (ids(sm.items) !== ids(pm.items)) problems.push('items differ');
    if (ids(sm.blockers) !== ids(pm.eligibility?.blockers)) problems.push('blockers differ');
    if (sm.sprsScore !== pm.sprsScore) problems.push('SPRS differs');
    if (sm.projectedScoreAfterPoam !== pm.summary?.projectedScoreAfterPoam) problems.push('projection differs');
    if (!inp.eoLedger) problems.push('no eo-ledger.json');
    else {
      const items = new Set((pm.items ?? []).map((i) => i.control_id)), blk = new Set((pm.eligibility?.blockers ?? []).map((x) => x.control_id));
      const noPoam = new Set((sm.ledgerReconciliation?.controls ?? []).filter((c) => c.disposition === 'no_poam' && c.noPoamReason).map((c) => c.controlId));
      const lost = [...new Set((inp.eoLedger.deficiencies ?? []).map((d) => d.controlId))].filter((c) => !items.has(c) && !blk.has(c) && !noPoam.has(c));
      if (lost.length) problems.push(`${lost.length} deficient controls uncovered`);
    }
    return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `§14 = poam.json (${(pm.items ?? []).filter((i) => i.poamEligible !== false).length} POA&M items + ${(pm.items ?? []).filter((i) => i.poamEligible === false).length} tracked not-eligible, ${(pm.eligibility?.blockers ?? []).length} blockers)` };
  });
  add(6, 'P0', 'Inheritance (V33 rule + content): §2.4 Shared set = the CRM Shared set, and the CRM is not all-customer', () => {
    const t = s.inheritanceTable, crm = s.sharedResponsibilityMatrix;
    if (!t?.rows || !crm?.controlDetails) return { pass: false, detail: 'inheritanceTable or CRM missing' };
    const sh = (rows) => [...new Set(rows.filter((x) => x.responsibility === 'Shared').map((x) => x.controlId))].sort().join(',');
    const same = sh(t.rows) === sh(crm.controlDetails);
    const nonCustomer = (crm.inherited ?? 0) + (crm.shared ?? 0);
    return { pass: same && nonCustomer > 0, detail: `§2.4 ${t.rows.length} rows; Shared sets ${same ? 'equal' : 'differ'}; CRM inherited ${crm.inherited ?? 0}, shared ${crm.shared ?? 0}` };
  });
  add(7, 'P0', 'No assertion-only narrative: every control narrative >= 200 characters and none is the bare "implemented and continuously verified" line', () => {
    const short = ctl.filter((c) => stripDisclosures(c.implementationNarrative).trim().length < 200);
    const bare = ctl.filter((c) => /^[^\n]{0,160}implemented and continuously verified\.?$/i.test(stripDisclosures(c.implementationNarrative).trim()));
    const bad = [...new Set([...short, ...bare].map((c) => c.control_id))];
    return { pass: bad.length === 0, detail: `${bad.length} assertion-only narratives${bad.length ? ` (${bad.slice(0, 5).join(', ')})` : ''}` };
  });
  add(8, 'P1', 'Per-objective statements: >= 90 % of ledger objectives carry their own rationale, not "inherited from control assessment"', () => {
    const objs = inp.eoLedger?.objectives ?? [];
    if (!objs.length) return { pass: false, detail: 'no ledger objectives' };
    const own = objs.filter((o) => !/^inherited from control assessment/i.test(String(o.rationale ?? ''))).length;
    return { pass: own / objs.length >= 0.9, detail: `${own} of ${objs.length} objectives have their own rationale (${pct(own, objs.length)} %)` };
  });
  add(9, 'P1', 'ODPs: >= 1 control carries odpValues, every entry has a parameter and a value, none is a bank default, §9 is not empty', () => {
    const withOdp = ctl.filter((c) => (c.odpValues ?? []).length);
    const malformed = withOdp.flatMap((c) => c.odpValues).filter((o) => !o.parameter || o.value === undefined || o.value === '').length;
    const defaulted = withOdp.flatMap((c) => c.odpValues).filter((o) => /default/i.test(String(o.source ?? ''))).length;
    const empty = JSON.stringify(s).includes('No organization-defined parameters have been configured');
    return { pass: withOdp.length > 0 && !malformed && !defaulted && !empty, detail: `${withOdp.length} controls with odpValues; malformed ${malformed}; defaulted ${defaulted}; §9 empty statement ${empty ? 'present' : 'absent'}` };
  });
  add(10, 'P1', 'Responsible role: every control names one, and no narrative has a dangling "managed by ."', () => {
    const empty = ctl.filter((c) => !String(c.responsibleRole ?? '').trim()).map((c) => c.control_id);
    const dangling = ctl.filter((c) => /managed by \./.test(c.implementationNarrative ?? '')).length;
    return { pass: !empty.length && !dangling, detail: `${empty.length} controls without a responsible role${empty.length ? ` (${empty.slice(0, 5).join(', ')})` : ''}; ${dangling} dangling tokens` };
  });
  add(11, 'P1', 'Evidence pointers (metric 6 rule): >= 80 % of assessed controls carry an evidenceDetails entry with a SHA-256', () => {
    const assessed = ctl.filter((c) => c.status !== 'not_assessed');
    const ok = assessed.filter((c) => (c.evidenceDetails ?? []).some((d) => /^[0-9a-f]{64}$/.test(String(d.sha256 ?? '')))).length;
    return { pass: assessed.length > 0 && ok / assessed.length >= 0.8, detail: `${ok} of ${assessed.length} assessed controls (${pct(ok, assessed.length)} %)` };
  });
  add(12, 'P1', 'Not-assessed controls: no "REQUIRES MANUAL INPUT" narrative and each names a related policy', () => {
    const marker = na.filter((c) => /REQUIRES MANUAL INPUT/.test(c.implementationNarrative ?? '')).length;
    const noPol = na.filter((c) => !(c.relatedPolicies ?? []).length).length;
    return { pass: !marker && !noPol, detail: `${na.length} not-assessed: ${marker} with a manual-input narrative, ${noPol} without a related policy` };
  });
  add(13, 'P1', 'Data flows and interconnections: >= 1 CUI flow row, >= 1 interconnection, no "[CUI data flows not configured]"', () => {
    const flows = (s.cuiDataFlowRows ?? []).length, ic = (s.interconnections ?? []).length;
    const stub = JSON.stringify(s).includes('[CUI data flows not configured]');
    return { pass: flows > 0 && ic > 0 && !stub, detail: `${flows} flow rows, ${ic} interconnections, stub ${stub ? 'present' : 'absent'}` };
  });
  add(14, 'P1', 'Posture counts: the reconciliation block exists and its EO row equals the SSP status counts', () => {
    const rows = s.postureReconciliation?.rows ?? [];
    const eo = rows.find((x) => x.id === 'eo-assessed');
    const st = ctl.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
    const eq = eo && eo.counts?.met === (st.met ?? 0) && eo.counts?.notMet === (st.not_met ?? 0) && eo.counts?.notAssessed === (st.not_assessed ?? 0) && (eo.counts?.partial ?? 0) === (st.partial ?? 0);
    return { pass: rows.length >= 2 && !!eq, detail: `${rows.length} reconciliation rows; EO row ${eo ? JSON.stringify(eo.counts) : 'absent'} vs SSP ${JSON.stringify(st)}` };
  });
  add(15, 'P1', 'SPRS (V36 (a)+(c) rule): one assessed SPRS (the latest assessment: E7B after its expected improvements, else the E7 passes) carried by poam.json and §14; no "Cannot determine SPRS" beside it', () => {
    const A = sprsAuthority(sprsInputs(inp));
    const docs = [...(inp.poam ? [['poam.json', inp.poam.sprsScore]] : []), ...(s.poamSummary ? [['SSP §14', s.poamSummary.sprsScore]] : [])];
    const off = docs.filter(([, v]) => v !== A.value);
    const cannot = inp.assess.filter((a) => /Cannot determine SPRS/i.test(a.text)).length;
    return { pass: A.value !== null && !A.problems.length && !off.length && !cannot, detail: `${A.detail}; documents ${docs.map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}${A.problems.length ? `; ${A.problems.join('; ')}` : ''}; "Cannot determine SPRS" in ${cannot} assess files` };
  });
  add(16, 'P1', 'Dates: no policy effective date after the SSP date, and a revision history exists', () => {
    const d = sspDate(s);
    const future = inp.policies.map((p) => [p.file, /\*\*Effective Date:\*\*\s*(\d{4}-\d{2}-\d{2})/.exec(p.text)?.[1]]).filter(([, e]) => e && e > d);
    const rev = (s.revisionHistory ?? []).length;
    return { pass: !future.length && rev > 0, detail: `${future.length} of ${inp.policies.length} policies effective after ${d || '(no SSP date)'}${future.length ? ` (e.g. ${future[0][1]})` : ''}; ${rev} revision rows` };
  });
  add(17, 'P1', 'Counts agree: no count conflict across the inputs and no met narrative states zero users, devices or methods', () => {
    const conflicts = (s.countConflicts ?? []).length;
    const zero = met.filter((c) => /\b0 (managed devices|authentication methods|users)\b/i.test(c.implementationNarrative ?? '')).length;
    return { pass: !conflicts && !zero, detail: `${conflicts} count conflicts (${(s.countConflicts ?? []).map((c) => c.quantity).join(', ') || 'none'}); ${zero} met narratives state a zero count` };
  });
  return P;
}

// ---------- the scorecard ----------
export function computeScorecard(inp, pkgDir = PKG_DIR) {
  const { scenario, source: thresholdSource, thresholds } = thresholdsFor(inp.slug, pkgDir);
  const ssp = inp.ssp;
  const ctl = ssp?.controlImplementations ?? [];
  const met = ctl.filter((c) => c.status === 'met');
  const rows = [];
  const row = (id, title, value, detail, judge) => {
    const th = thresholds[id] ?? {};
    let status;
    if (th.exempt) status = 'exempt';
    else if (value === null) status = 'not computed';
    else status = judge(th) ? 'pass' : 'fail';
    rows.push({ id, title, value, detail, threshold: th, status });
  };
  const preds = sspReviewPredicates(inp);
  const p0 = preds.filter((p) => p.pri === 'P0'), p1 = preds.filter((p) => p.pri === 'P1');
  // Row 18 of REVIEW.md ("the scorecard does not measure what an assessor checks") is met when every other row is computed.
  row('SC-1', 'SSP-review P0 rows passing (REVIEW.md rows 1-7)', ssp ? { passed: p0.filter((p) => p.pass).length, of: p0.length, rows: p0 } : null,
    `${p0.filter((p) => p.pass).length}/${p0.length}: ${p0.map((p) => `${p.row}${p.pass ? '✓' : '✗'}`).join(' ')}`,
    (th) => (th.rows ? th.rows.every((n) => p0.find((p) => p.row === n)?.pass) : p0.filter((p) => p.pass).length >= th.minPassed));

  const ex = examineItems(inp.evidenceIndex);
  const cov = ex.automatable.filter((x) => x.status === 'covered').length;
  row('SC-3a', 'Evidence coverage of automatable examine items (865 - documentary - SSP/POA&M)', inp.evidenceIndex ? { covered: cov, of: ex.automatable.length, pct: pct(cov, ex.automatable.length) } : null,
    inp.evidenceIndex ? `${cov}/${ex.automatable.length} = ${pct(cov, ex.automatable.length)} % (documentary ${ex.documentary.length}, SSP/POA&M ${ex.sspPoam.length}, examine items ${ex.automatable.length + ex.documentary.length + ex.sspPoam.length})` : 'no evidence index in the bundle',
    (th) => pct(cov, ex.automatable.length) >= th.minPct);
  const listed = documentaryItems(inp).length, credited = creditedDocumentary(inp).length;
  row('SC-3b', 'Documentary examine items listed in GAPS or credited to a hashed Muster policy', inp.evidenceIndex ? { listed, credited, of: ex.documentary.length } : null,
    inp.evidenceIndex ? `${listed + credited}/${ex.documentary.length} (GAPS rows ${listed}, credited to a hashed policy ${credited}${credited ? '' : '; the index carries no creditedTo (built without policy documents, or before W5)'})` : 'no evidence index in the bundle',
    () => listed + credited === ex.documentary.length);

  const po = met.filter((c) => c.presenceOnly === true).length;
  row('SC-4', 'Met controls whose deciding evaluator is presence-only', ssp ? { presenceOnly: po, met: met.length, pct: pct(po, met.length) } : null,
    `${po}/${met.length} = ${pct(po, met.length)} %`, (th) => pct(po, met.length) <= th.maxPct);

  const jsonHits = ssp ? placeholderHits(ssp).length : null;
  const docxHits = inp.docxText ? MANUAL_MARKERS.reduce((n, re) => n + countOf(inp.docxText, re), 0) : null;
  // W5 cycle 1: the content-gap sentence (NOT_SUPPLIED) is a placeholder of its own kind. It is tallied apart from the two
  // markers and counts toward the totals the threshold judges (a renamed token is still missing organisation content).
  const gapJson = ssp ? contentGapHits(ssp).length : null;
  const gapDocx = inp.docxText ? contentGapCount(inp.docxText) : null;
  const totJson = jsonHits === null ? null : jsonHits + gapJson;
  const totDocx = docxHits === null ? null : docxHits + gapDocx;
  row('SC-5', 'Placeholders, SSP JSON / DOCX: the two markers ("[MANUAL INPUT REQUIRED]" + "REQUIRES MANUAL INPUT") + content-gap sentences', ssp ? { json: totJson, docx: totDocx, markers: { json: jsonHits, docx: docxHits }, contentGap: { json: gapJson, docx: gapDocx } } : null,
    `${totJson ?? '?'} / ${totDocx ?? 'DOCX unreadable'} (markers ${jsonHits ?? '?'} / ${docxHits ?? '?'}; content gaps "${NOT_SUPPLIED}" ${gapJson ?? '?'} / ${gapDocx ?? '?'})`, (th) => totJson <= th.maxJson && totDocx !== null && totDocx <= th.maxDocx);

  const pc = inp.policies.map(policyCompleteness);
  const odps = odpAnswers(inp);
  row('SC-6', 'Policy documents complete (owner and approver named, no [Name]) / 22; ODPs answered / 15', inp.policies.length ? { policies: pc.filter((x) => x.complete).length, policyDocs: pc.length, odps: odps.filter((o) => o.answered).length, odpTotal: 15, docs: pc, odpRows: odps } : null,
    `${pc.filter((x) => x.complete).length}/${pc.length} documents; ${odps.filter((o) => o.answered).length}/15 ODPs (answers file ${inp.answers ? 'present' : 'absent'})`,
    (th) => pc.filter((x) => x.complete).length >= th.minPolicies && odps.filter((o) => o.answered).length >= th.minOdps);

  // W6 follow-ups (post-E7B SPRS; SC-7 source, run 61c): 110 - weights is recomputed from the authoritative assessment's
  // control statuses: the EO package snapshot whose snapshotId is the authoritative assessment's (E7B's when sprsAuthority
  // makes it authoritative, else E7 pass 3's), else the SSP's control statuses. Never the ledger: its personnel readiness
  // rows may be decided by organisation records (ruling), which never set an assessment status. The recomputed value
  // must equal the authoritative assessed SPRS and the documents; the E7 passes must agree.
  const auth = sprsAuthority(sprsInputs(inp));
  const sspWeight = new Map(ctl.map((c) => [c.control_id, Number(c.weight)]));
  const snapCtl = auth.snapshotId && inp.snapshot?.snapshotId === auth.snapshotId && inp.snapshot.controls?.length
    ? inp.snapshot.controls.map((c) => ({ status: c.status, weight: c.weight ?? sspWeight.get(c.control_id) })) : null;
  const statusSource = snapCtl ? `the ${auth.source === 'E7B' ? 'E7B' : 'E7 pass 3'} assessment snapshot ${auth.snapshotId}` : 'the SSP control statuses';
  const deductions = (snapCtl ?? ctl).filter((c) => c.status !== 'met').reduce((n, c) => n + (Number(c.weight) || 0), 0);
  const recomputed = 110 - deductions;
  const assessed = [];
  for (const a of inp.assess) { const sum = summaryOf(a.events); if (sum) assessed.push([a.file, sum.sprs_score]); }
  if (auth.e7b !== null) assessed.push(['eo-assess-7b.json', auth.e7b]);
  const docs = [...(inp.poam ? [['poam.json', inp.poam.sprsScore]] : []), ...(ssp?.poamSummary ? [['SSP §14', ssp.poamSummary.sprsScore]] : [])];
  row('SC-7', 'SPRS arithmetic: 110 - weights of the controls not met (authoritative assessment statuses) = the authoritative assessed SPRS = the documents; the E7 passes agree', ssp && assessed.length ? { recomputed, statusSource, authoritative: auth.value, authoritySource: auth.source, assessed: Object.fromEntries([...assessed, ...docs]), improvement: auth.explain || null } : null,
    `110 - ${deductions} = ${recomputed} (statuses from ${statusSource}); ${auth.detail}; documents ${docs.map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}${auth.problems.length ? `; ${auth.problems.join('; ')}` : ''}`,
    () => !auth.problems.length && auth.value === recomputed && docs.every(([, v]) => v === recomputed));

  const { counted: df, excluded: dxAll } = sc8aSplit(inp);
  // W7-PKG: R-1's exclusions and FQ-1's honest nulls (--exclude-honest-nulls only) are reported apart.
  const dx = dxAll.filter((f) => !f.honestNull), hx = dxAll.filter((f) => f.honestNull);
  const unsure = df.filter((f) => f.answer === 'unsure').length;
  const replaced = df.filter((f) => f.replacedByInterview).length;
  const exclIds = dx.map((f) => f.control);
  const honest = inp.honestNulls ? { file: inp.honestNulls.file, count: hx.length, applied: hx.map((f) => ({ control: f.control, reason: f.reason.slice(HONEST_NULL_PREFIX.length), answer: f.answer })) } : null;
  row('SC-8a', '"unsure" share among discovery-sourced RR-ACT readiness answers, without the controls discovery can never read (R-1)', inp.readiness ? { unsure, of: df.length, pct: pct(unsure, df.length), excluded: { count: dx.length, ids: exclIds }, ...(honest ? { honestNulls: honest } : {}) } : null,
    inp.readiness ? `${unsure}/${df.length} = ${pct(unsure, df.length)} %; excluded ${dx.length} not discoverable (${dx.filter((f) => f.answer === 'unsure').length} unsure; manual-only ${dx.filter((f) => f.reason === UNDISCOVERABLE_REASON['manual-only']).length}, platform-inherited ${dx.filter((f) => f.reason === UNDISCOVERABLE_REASON['platform-inherited']).length}${exclIds.length ? `: ${exclIds.join(', ')}` : ''}); interview-replaced ${replaced}${inp.registry ? '' : '; Stamper registry not found, nothing excluded'}${honest ? `; FQ-1 honest nulls excluded ${hx.length} (${hx.filter((f) => f.answer === 'unsure').length} unsure${hx.length ? `: ${honest.applied.map((h) => `${h.control} (${h.reason})`).join('; ')}` : ''})` : ''}` : 'no readiness result',
    (th) => pct(unsure, df.length) <= th.maxPct);
  const di = inp.planTrace?.defaulted_inputs ?? null;
  const tcpDefaulted = di ? di.filter((x) => /^TCP /.test(x)).length : null;
  row('SC-8b', 'Defaulted TCP fields / TCP bank; all defaulted inputs (plan-trace.json)', di ? { tcp: tcpDefaulted, of: inp.tcpBankCount, all: di.length } : null,
    di ? `${tcpDefaulted}/${inp.tcpBankCount}; ${di.length} defaulted inputs` : 'plan-trace.json not in this input (bundle replay): not computed', (th) => tcpDefaulted <= th.maxTcp);

  const computedOthers = rows.every((r) => r.value !== null || r.status === 'exempt');
  const p1All = [...p1, { row: 18, pri: 'P1', title: 'Scorecard measures what an assessor checks: every SC row is computed on this input', pass: computedOthers, detail: computedOthers ? 'all rows computed' : `not computed: ${rows.filter((r) => r.value === null).map((r) => r.id).join(', ')}` }];
  row('SC-2', 'SSP-review P1 rows passing (REVIEW.md rows 8-18)', ssp ? { passed: p1All.filter((p) => p.pass).length, of: p1All.length, rows: p1All } : null,
    `${p1All.filter((p) => p.pass).length}/${p1All.length}: ${p1All.map((p) => `${p.row}${p.pass ? '✓' : '✗'}`).join(' ')}`,
    (th) => p1All.filter((p) => p.pass).length >= th.minPassed);
  const order = ['SC-1', 'SC-2', 'SC-3a', 'SC-3b', 'SC-4', 'SC-5', 'SC-6', 'SC-7', 'SC-8a', 'SC-8b'];
  rows.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
  return {
    schema: 'ces-muster-run/scorecard@1',
    scenario: inp.slug, scenarioCode: scenario, runId: inp.runId, sspId: ssp?.sspId ?? null,
    generatedAt: ssp?.generatedAt ?? null,
    input: inp.bundle && !inp.run ? 'bundle' : 'run',
    thresholdSource,
    pass: rows.every((r) => r.status === 'pass' || r.status === 'exempt'),
    rows,
    notes: inp.notes,
  };
}

export function renderTable(sc) {
  const lines = [`Scorecard ${sc.scenario} (${sc.scenarioCode}; thresholds: ${sc.thresholdSource}) run ${sc.runId ?? '?'}`];
  for (const r of sc.rows) lines.push(`${r.status.toUpperCase().padEnd(12)} ${r.id.padEnd(6)} ${r.detail}   [threshold ${JSON.stringify(r.threshold)}]`);
  // W7-PKG: with --exclude-honest-nulls, the honest-null list FQ-1's disposition applied (each control with its reason).
  const hn = sc.rows.find((r) => r.id === 'SC-8a')?.value?.honestNulls;
  if (hn) {
    lines.push(`SC-8a honest nulls excluded (FQ-1, ${hn.file}): ${hn.count}`);
    for (const h of hn.applied) lines.push(`  ${h.control.padEnd(14)} ${h.answer.padEnd(7)} ${h.reason}`);
  }
  lines.push(`scorecard: ${sc.pass ? 'ALL ROWS WITHIN THRESHOLD' : 'OUTSIDE THRESHOLD'}`);
  return lines.join('\n');
}
export function writeScorecard(sc, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `scorecard-${sc.scenario}.json`);
  fs.writeFileSync(file, `${JSON.stringify(sc, null, 2)}\n`);
  return file;
}

export function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  const root = path.resolve(a.root ?? path.join(PKG_DIR, '..', '..'));
  const slug = a.scenario ?? 'muster-partial';
  const bundleDir = a.bundle ? path.resolve(a.bundle) : null;
  const runDir = a.run ? path.resolve(a.run) : null;
  const outDir = a.out ? path.resolve(a.out) : bundleDir ? null : (runDir ?? path.join(root, 'out'));
  if (!outDir) throw new Error('--out is required with --bundle');
  const honestNullsFile = resolveHonestNullsArg(a['exclude-honest-nulls']);
  return { root, slug, bundleDir, runDir, outDir, honestNullsFile };
}
// PH-11 Q4 (founder 2026-11-01): FQ-1's disposition applies by default. The honest-null list is a judgement per read
// (LOG-W7-MX1 groups A and C), not derivable from the run's discovery answers, so it ships as this file.
// --exclude-honest-nulls absent -> the shipped file; "off" -> null (not applied); any other value -> that file.
export const DEFAULT_HONEST_NULLS_FILE = path.join(SCRIPTS_DIR, 'honest-nulls-fq1.json');
export const resolveHonestNullsArg = (v) => (v === undefined || v === '' ? DEFAULT_HONEST_NULLS_FILE : String(v).toLowerCase() === 'off' ? null : path.resolve(v));

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const o = parseArgs(process.argv.slice(2));
  const sc = computeScorecard(loadInputs(o));
  const file = writeScorecard(sc, o.outDir);
  console.log(renderTable(sc));
  console.log(`written: ${file}`);
  process.exitCode = sc.pass ? 0 : 1;
}
