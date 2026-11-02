// Gap closure NS-4 + V78 (stale-build clause) tests: node --test scripts/gap-ns4.test.mjs
// The review plans of customers/<slug>/document-reviews.json (build-customer-records.mjs loadDocumentReviews), their
// predicted GD-b outcome against the W9-R2b proof SSPs, the V78 stale-build judge (loaded from verify.mjs by its
// "GC-NS-4 judges" markers; verify.mjs runs on import) and the mx-e2e.ps1 wiring of E8.5 / E8.6 / E8F (by text, CRLF kept).
// Reads package files and the ces-shared dist objectives reference (read only); writes only under the OS temp folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDocumentReviews, reviewOutcome, REVIEW_PLAN_SCHEMA } from './build-customer-records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const WS = path.resolve(HERE, '..', '..', '..');
const OBJ = path.join(WS, 'ces', 'ces-shared', 'dist', 'data', 'assessment-objectives.reference.json');
const objectivesRef = fs.existsSync(OBJ) ? JSON.parse(fs.readFileSync(OBJ, 'utf8')) : null;
const skipObj = objectivesRef ? false : `absent: ${OBJ}`;
const SLUGS = ['s1-mach', 's2-eng', 's3-def', 'muster-partial'];
const PROOF = {
  's1-mach': 'expected-outputs/s1-mach/proof-runs/gc-w9r2b-s1/ssp.json',
  's2-eng': 'expected-outputs/s2-eng/proof-runs/gc-w9r2b-s2/ssp.json',
  's3-def': 'expected-outputs/s3-def/proof-runs/gc-w9r2b-s3/ssp.json',
  'muster-partial': 'expected-outputs/proof-runs/gc-w9r2b-mp/ssp.json',
};
// The predicted effect written in LOG-GC-NS-4.md (AR5): controls that move from not_assessed, and the SPRS weight gained.
// FIN-29 (FD-17, LOG-FIN-29.md AR5 table): S1 adds CA.L2-3.12.4 (weight 0), CM.L2-3.4.4 (1), PE.L2-3.10.2 (5) and PE.L2-3.10.6 (1)
// = +7; S2 the same minus CA.L2-3.12.4 = +7. S1's V80 probe moved to MP.L1-3.8.3 (PROBE_OF).
const PREDICTED = {
  's1-mach': { met: ['AU.L2-3.3.9', 'CA.L2-3.12.4', 'CM.L2-3.4.4', 'IR.L2-3.6.3', 'MA.L2-3.7.3', 'MA.L2-3.7.6', 'PE.L1-3.10.1', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5', 'PE.L2-3.10.2', 'PE.L2-3.10.6', 'RA.L2-3.11.1'], notMet: [], gain: 22 },
  's2-eng': { met: ['AU.L2-3.3.9', 'CM.L2-3.4.4', 'IR.L2-3.6.3', 'MA.L2-3.7.3', 'MA.L2-3.7.6', 'MP.L1-3.8.3', 'PE.L1-3.10.1', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5', 'PE.L2-3.10.2', 'PE.L2-3.10.6', 'RA.L2-3.11.1'], notMet: [], gain: 27 },
  's3-def': { met: [], notMet: ['AT.L2-3.2.2'], gain: 0 },
  'muster-partial': { met: [], notMet: [], gain: 0 },
};
// FIN-35 (LOG-DEPTH-11.md open item 5): S1 and S2 also review MA.L2-3.7.1, MA.L2-3.7.2, MP.L2-3.8.4 and MP.L2-3.8.9 (8
// reviews). In the W9-R2b proof SSP those four were met by Stamper proxies that DEPTH-11 no longer counts, so they are
// not not_assessed there; GD-b keeps them met (net 0 against the proof SSP: -10 from DEPTH-11, +10 from the reviews).
const DEPTH11_REVIEWED = { 's1-mach': ['MA.L2-3.7.1', 'MA.L2-3.7.2', 'MP.L2-3.8.4', 'MP.L2-3.8.9'], 's2-eng': ['MA.L2-3.7.1', 'MA.L2-3.7.2', 'MP.L2-3.8.4', 'MP.L2-3.8.9'], 's3-def': [], 'muster-partial': [] };
// FIN-29 (FD-17): each scenario's V80 probe control.
const PROBE_OF = { 's1-mach': 'MP.L1-3.8.3', 's2-eng': 'CA.L2-3.12.4', 's3-def': 'CA.L2-3.12.4', 'muster-partial': 'CA.L2-3.12.4' };

test('every scenario has a valid review plan: UPNs distinct, objectives of the control, probe unreviewed, record bytes = catalog', { skip: skipObj }, () => {
  for (const slug of SLUGS) {
    const plan = loadDocumentReviews(PKG, slug, { objectivesRef });
    assert.ok(plan, slug);
    assert.equal(plan.schema, REVIEW_PLAN_SCHEMA);
    if (plan.reviews.length) {
      assert.notEqual(plan.reviewer.upn.toLowerCase(), plan.uploader.upn.toLowerCase(), `${slug}: reviewer is the uploader`);
      assert.notEqual(plan.reviewer.upn.toLowerCase(), plan.operatorUpn.toLowerCase(), `${slug}: reviewer is the operator`);
    }
    assert.equal(plan.probe.control_id, PROBE_OF[slug]);
    assert.ok(!plan.reviews.some((r) => r.control_id === plan.probe.control_id || r.artifact === plan.probe.artifact), slug);
    for (const u of plan.uploads) {
      assert.equal(Buffer.from(u.body.contentBase64, 'base64').length > 0, true);
      assert.deepEqual(u.body.controlIds, u.control_ids);
      assert.equal(u.body.tenantSlug, slug);
      assert.equal(u.body.source, 'manual_upload');
    }
    for (const r of plan.reviews) assert.ok(plan.uploads.find((u) => u.id === r.artifact).control_ids.includes(r.control_id), `${slug} ${r.objective_id}`);
  }
});

test('AR5 prediction: the GD-b outcome of each plan moves exactly the logged controls, all not_assessed in the W9-R2b proof SSP', { skip: skipObj }, () => {
  for (const slug of SLUGS) {
    const plan = loadDocumentReviews(PKG, slug, { objectivesRef });
    const out = reviewOutcome(plan, objectivesRef);
    const d11 = DEPTH11_REVIEWED[slug];
    assert.deepEqual(out.met.filter((c) => !d11.includes(c)), PREDICTED[slug].met, `${slug} met`);
    assert.deepEqual(out.met.filter((c) => d11.includes(c)), d11, `${slug} DEPTH-11 reviewed controls met by GD-b`);
    assert.deepEqual(out.notMet, PREDICTED[slug].notMet, `${slug} not_met`);
    const ssp = JSON.parse(fs.readFileSync(path.join(PKG, PROOF[slug]), 'utf8'));
    const by = new Map(ssp.controlImplementations.map((c) => [c.control_id, c]));
    for (const c of [...out.met, ...out.notMet, ...out.partial].filter((x) => !d11.includes(x))) assert.equal(by.get(c)?.status, 'not_assessed', `${slug} ${c} is not not_assessed in the proof SSP`);
    for (const c of d11) assert.equal(by.get(c)?.status, 'met', `${slug} ${c}: met by a Stamper proxy in the proof SSP (DEPTH-11 removes it)`);
    assert.equal(out.met.filter((c) => !d11.includes(c)).reduce((n, c) => n + by.get(c).weight, 0), PREDICTED[slug].gain, `${slug} SPRS gain`);
    assert.equal(d11.reduce((n, c) => n + by.get(c).weight, 0), d11.length ? 10 : 0, `${slug} DEPTH-11 weight kept by the reviews`);
    assert.equal(by.get(PROBE_OF[slug]).status, 'not_assessed', `${slug} probe control`);
  }
});

test('a partially reviewed control lists every unreviewed objective under not_reviewed', { skip: skipObj }, () => {
  const objectivesOf = new Map();
  for (const o of objectivesRef.objectives) objectivesOf.set(o.controlId, [...(objectivesOf.get(o.controlId) ?? []), o.objectiveId]);
  for (const slug of SLUGS) {
    const plan = loadDocumentReviews(PKG, slug, { objectivesRef });
    for (const c of reviewOutcome(plan, objectivesRef).partial) {
      const missing = objectivesOf.get(c).filter((o) => !plan.reviews.some((r) => r.objective_id === o));
      assert.ok(missing.length > 0);
      for (const o of missing) assert.ok(plan.notReviewed.some((n) => n.objective_id === o && n.reason), `${slug} ${o} has no not_reviewed reason`);
    }
  }
});

test('the loader refuses a reviewer who is the uploader, an untagged control, a tampered record and a reviewed probe', { skip: skipObj }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ns4-'));
  try {
    const src = path.join(PKG, 'customers', 's1-mach');
    const dst = path.join(tmp, 'customers', 's1-mach');
    fs.cpSync(path.join(src, 'records'), path.join(dst, 'records'), { recursive: true });
    fs.cpSync(path.join(src, 'review-artifacts'), path.join(dst, 'review-artifacts'), { recursive: true });
    const base = JSON.parse(fs.readFileSync(path.join(src, 'document-reviews.json'), 'utf8'));
    const tryDoc = (doc) => { fs.writeFileSync(path.join(dst, 'document-reviews.json'), JSON.stringify(doc)); return () => loadDocumentReviews(tmp, 's1-mach', { objectivesRef }); };
    assert.ok(tryDoc(base)());
    assert.throws(tryDoc({ ...base, reviewer: { ...base.reviewer, upn: base.uploader.upn.toUpperCase() } }), /reviewer is the uploader/);
    assert.throws(tryDoc({ ...base, reviewer: { ...base.reviewer, upn: base.operator_upn } }), /minting operator/);
    assert.throws(tryDoc({ ...base, reviews: [...base.reviews, { control_id: 'AC.L1-3.1.1', objective_id: 'AC.L1-3.1.1[a]', artifact: 'visitor-log', verdict: 'met', notes: 'x' }] }), /not tagged AC\.L1-3\.1\.1/);
    assert.throws(tryDoc({ ...base, reviews: [...base.reviews, { control_id: 'PE.L1-3.10.4', objective_id: 'PE.L1-3.10.4[z]', artifact: 'visitor-log', verdict: 'met', notes: 'x' }] }), /not an objective/);
    assert.throws(tryDoc({ ...base, reviews: [...base.reviews, { control_id: 'CA.L2-3.12.4', objective_id: 'CA.L2-3.12.4[a]', artifact: 'probe-unreviewed-upload', verdict: 'met', notes: 'x' }] }), /probe/);
    assert.throws(tryDoc({ ...base, reviews: [{ ...base.reviews[0], verdict: 'partial' }] }), /verdict partial/);
    fs.appendFileSync(path.join(dst, 'records', 'visitor-log.json'), ' ');
    assert.throws(tryDoc(base), /differs from the catalog/);
    fs.rmSync(path.join(dst, 'document-reviews.json'));
    assert.equal(loadDocumentReviews(tmp, 's1-mach', { objectivesRef }), null);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the new customer files are denylist clean, carry the fictional marker, have no workstation path and are CRLF-only', async () => {
  const { loadDenylist, scanStrings } = await import(pathToFileURL(path.join(PKG, 'customers', 's1-mach', 'gen-customer.mjs')).href);
  const rx = loadDenylist();
  const pathRx = /[A-Za-z]:[\\/]|\\\\[A-Za-z]|[\\/]Users[\\/]|[\\/]home[\\/]/;
  for (const slug of SLUGS) {
    const dir = path.join(PKG, 'customers', slug);
    const files = ['document-reviews.json', ...fs.readdirSync(path.join(dir, 'review-artifacts')).map((f) => `review-artifacts/${f}`)];
    for (const f of files) {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.deepEqual(scanStrings(JSON.parse(raw), rx), [], `${slug}/${f}`);
      assert.ok(!pathRx.test(raw), `${slug}/${f} workstation path`);
      assert.match(raw, /FICTIONAL/, `${slug}/${f}`);
      assert.equal((raw.match(/\r\n/g) ?? []).length, (raw.match(/\n/g) ?? []).length, `${slug}/${f} not CRLF-only`);
    }
  }
});

// ---------- V78 stale-build judge (verify.mjs block) ----------
const VERIFY = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
const BEGIN = '// ---------- GC-NS-4 judges (begin)';
const END = '// ---------- GC-NS-4 judges (end) ----------';
const block = VERIFY.slice(VERIFY.indexOf(BEGIN), VERIFY.indexOf(END));
const { judgeV78Stale } = await import(`data:text/javascript,${encodeURIComponent(`${block}\nexport { judgeV78Stale };`)}`);

test('V78 stale-build judge: 409 "Package build refused" passes; 200, another status or no attempt fails; tester judged like mx (NS-4t); no E8F not run', () => {
  const step = { rc: 0 };
  const refused = { stale_build_status: 409, stale_build_reason: 'Package build refused: snapshot mismatch: the latest assessment snapshot is f-1, but the SSP records snapshot b-7' };
  const ok = judgeV78Stale({ harness: 'mx', e8fStep: step, forced: refused });
  assert.equal(ok.pass, true); assert.match(ok.detail, /^E8F's stale build was refused: HTTP 409/);
  const gate = judgeV78Stale({ harness: 'mx', e8fStep: step, forced: { stale_build_status: 200, stale_build_zip_removed: true } });
  assert.equal(gate.pass, false); assert.match(gate.detail, /NOT refused \(HTTP 200.*zip was removed/);
  assert.equal(judgeV78Stale({ harness: 'mx', e8fStep: step, forced: { stale_build_status: 500, stale_build_reason: 'boom' } }).pass, false);
  assert.equal(judgeV78Stale({ harness: 'mx', e8fStep: step, forced: { stale_build_status: 409, stale_build_reason: 'other' } }).pass, false);
  assert.match(judgeV78Stale({ harness: 'mx', e8fStep: step, forced: { assess_rc: 1 } }).detail, /no stale-build attempt/);
  assert.equal(judgeV78Stale({ harness: 'mx', e8fStep: step, forced: null }).pass, false);
  assert.equal(judgeV78Stale({ harness: 'mx', e8fStep: step, forced: refused, forcedStale: 'stale artefact from an earlier run: forced.json' }).pass, false);
  assert.equal(judgeV78Stale({ harness: 'tester', e8fStep: step, forced: null }).pass, false);
  assert.equal(judgeV78Stale({ harness: 'tester', e8fStep: step, forced: refused }).pass, true);
  const s = judgeV78Stale({ harness: 'mx', e8fStep: null, forced: null });
  assert.equal(s.pass, true); assert.match(s.detail, /^not run: this run has no E8F step/);
  assert.match(ok.detail, /stale-build clause only/);
});

test('verify.mjs: V1 wants E8.6 under both harnesses (NS-4t); V78 reads out/runs/forced/forced.json and steps.E8F', () => {
  assert.ok(VERIFY.includes("'E8.5', 'E8.6', 'E7',"));
  assert.ok(VERIFY.includes("check('V78'"));
  assert.ok(VERIFY.includes("path.join(forcedDir, 'forced.json')") && VERIFY.includes('e8fStep: steps.E8F ?? null'));
  assert.ok(!VERIFY.includes('\r'), 'verify.mjs is LF-only (keep it so)');
});

// ---------- mx-e2e.ps1 wiring (by text) ----------
const RAW = fs.readFileSync(path.join(HERE, 'mx-e2e.ps1'), 'utf8');
const PS1 = RAW.replace(/\r\n/g, '\n');
const between = (a, b) => { const i = PS1.indexOf(a); const j = PS1.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, `${a} .. ${b}`); return PS1.slice(i, j); };

test('mx-e2e.ps1 stays CRLF-only, no BOM', () => {
  const b = fs.readFileSync(path.join(HERE, 'mx-e2e.ps1'));
  assert.notEqual(b[0], 0xef);
  assert.equal((RAW.match(/\r\n/g) ?? []).length, (RAW.match(/\n/g) ?? []).length);
  assert.equal((RAW.match(/\r(?!\n)/g) ?? []).length, 0);
});

test('mx-e2e.ps1 E8.6: in the order after E8.5, run inside E7 after /api/health and before the first connect/assess', () => {
  assert.match(PS1, /\$Order = @\('E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E8\.5', 'E8\.6', 'E7', 'E7B',/);
  assert.match(PS1, /\[ValidateSet\('E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E8\.5', 'E8\.6', 'E7',/);
  const e7 = between('# ---------- E7: EO assessment', '# ---------- E7B');
  const h = e7.indexOf("if (Wait-Http \"$eoUrl/api/health\" 'GET' 120) {");
  const r = e7.indexOf("if (Want 'E8.6') { Invoke-ReviewStep $eoUrl }");
  const c = e7.indexOf("Invoke-Logged 'E7-connect'");
  assert.ok(h >= 0 && r > h && c > r, 'E8.6 must sit between the health wait and E7-connect');
  // EO gets the approver-token secrets (dev operator fallback) and they are removed from this process right after the start.
  assert.ok(e7.includes("$env:CES_AO_PRINCIPAL_SECRET = $AoPrincipalSecret; $env:CES_EO_OPERATOR_SECRET = $EoOperatorSecret; $env:CES_EO_OPERATOR_DEV_FALLBACK = '1'"));
  assert.ok(e7.indexOf('Remove-Item Env:CES_AO_PRINCIPAL_SECRET, Env:CES_EO_OPERATOR_SECRET, Env:CES_EO_OPERATOR_DEV_FALLBACK') > e7.indexOf("Start-Bg 'E7-eo'"));
  const fn = between('function Invoke-ReviewStep', 'function Snapshot-Outside');
  assert.ok(fn.includes('/api/approver-tokens?tenant=$Scenario') && fn.includes('/api/reviews'));
  assert.ok(fn.includes("@('bhd-operator') $EoOperatorSecret"));
  assert.ok(fn.includes('approverUpn = $plan.uploader.upn') && fn.includes('-eq 403'), 'self-review probe expected 403');
  assert.ok(!/\$rec\.[a-z_]*token[a-z_]*\s*=/i.test(fn), 'eo-reviews.json must never carry a token');
  assert.ok(fn.includes("Record 'E8.6' $rc $t"));
});

test('mx-e2e.ps1 E8.5: EC gets CES_EC_PRINCIPAL_SECRET; review artifacts go up with x-ces-principal; V27 upload unchanged', () => {
  const ec = between("  if (Want 'E7') {\n    # A run's EC items", "  if (Want 'E8.5') {");
  assert.ok(ec.includes('$env:CES_EC_PRINCIPAL_SECRET = $EcPrincipalSecret'));
  assert.ok(ec.includes('Env:CES_EC_PRINCIPAL_SECRET -ErrorAction SilentlyContinue'));
  const e85 = between("  if (Want 'E8.5') {", '# ---------- E7: EO assessment');
  assert.ok(e85.includes("'--review-plan', '--slug', $Scenario, '--out', $ReviewPlanFile"));
  assert.ok(e85.includes("'x-ces-principal' = $upTok"));
  assert.ok(e85.includes("(Join-Path $OUT 'ec-upload-reviews.json')"));
  assert.ok(e85.includes("Set-Content -Encoding utf8 (Join-Path $OUT 'ec-upload.json') $r.Content"), 'V27 upload record kept');
  assert.ok(e85.includes('review_uploads = $planNote'));
  // FIN-35 appends the console records and the E7A / E7B sim-store snapshots after sim-store-e6.
  assert.match(PS1, /\|eo-reviews\\\.json\|ui-e2e-stamper\\\.json\|sim-store-e6\\\.json\|ui-e2e-\(ao\|eo\|muster\)\\\.json\|sim-store-e7a-pre\\\.json\|sim-store-e7b\\\.json\)\$'/);
});

test('mx-e2e.ps1 E8F: the stale build is attempted after the forced assess and before the forced ssp/generate; status and reason recorded', () => {
  const f = between('# ---------- E8F: forced-failure run', '$euReady = Want');
  const a = f.indexOf('$extra.assessment_id = $faid');
  const s = f.indexOf('Invoke-JsonCall \'POST\' "$eoUrl/api/package/build" @{ tenant = $Scenario }');
  const g = f.indexOf('"$eoUrl/api/ssp/generate"');
  assert.ok(a >= 0 && s > a && g > s, 'stale build must sit between the forced assess id and the forced ssp/generate');
  assert.ok(f.includes('$extra.stale_build_status = $stale.status') && f.includes('$extra.stale_build_reason ='));
  assert.ok(f.includes("($extra | ConvertTo-Json) | Set-Content -Encoding utf8 (Join-Path $FD 'forced.json')"));
});
