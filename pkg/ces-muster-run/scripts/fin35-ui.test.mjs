// FIN-35 (finishing plan PH-3 harness): V123-V125 judges (scripts/verify-fin35.mjs) over fictional records, and the hub
// over a temp out/ folder. The tester's ces-tester tests/fin35-ui-console.test.ts pins the same clauses on its side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { judgeV123, judgeV124, judgeV125, recordGate, compareAo, answersNotSent, pushedList, runFin35Checks, FIN35_SCHEMA, V123_SCENARIOS } from './verify-fin35.mjs';

const SLUG = 's1-mach';
const call = (k, extra = {}) => ({ call: k, ok: true, mode: k === 'dry_run' ? 'dry_run' : 'live', outcome: 'success', verdict: 'SAT', state_changed: k === 'apply', evidence_persisted: true, ...extra });
const op = (id, extra = {}) => ({ op: id, ok: true, calls: [call('dry_run'), call('apply', { evidence_row_id: `r-${id}`, evidence_objectives: ['AC.L1-3.1.1[a]'] })], confirm: { pass: true, actual: 'on' }, ...extra });
const variant = (facts, pass, files = { video: 'v.webm', trace: 't.zip' }) => ({ variant: 'kit', base_path: '/app/', ran: true, pass, headed: false, facts, files });
const rec = (surface, variants) => ({ schema: FIN35_SCHEMA, slug: SLUG, surface, variants });

test('recordGate: absent, stale, other scenario, nothing ran; a not-built variant is a note', () => {
  assert.match(recordGate({ record: null, slug: SLUG, file: 'x.json' }).stop, /no out\/x\.json/);
  assert.match(recordGate({ record: rec('ao', []), stale: 'older than steps', slug: SLUG, file: 'x' }).stop, /older/);
  assert.match(recordGate({ record: { ...rec('ao', []), slug: 's2-eng' }, slug: SLUG, file: 'x' }).stop, /is for s2-eng/);
  assert.match(recordGate({ record: rec('ao', [{ variant: 'kit', ran: false, reason: 'not run: /app/ is not built' }]), slug: SLUG, file: 'x' }).stop, /no variant ran/);
});

test('V123: equal to the twin passes; a call difference fails; mp is out of scope; the tester flag is cross-checked', () => {
  const e7a = { ops: [op('A-11'), op('A-02')] };
  const ok = judgeV123({ slug: SLUG, record: rec('ao', [variant({ ops: [op('A-11'), op('A-02')] }, true)]), e7a, twinRowObjectives: () => ['AC.L1-3.1.1[a]'] });
  assert.equal(ok.pass, true, ok.detail);
  const diff = judgeV123({ slug: SLUG, record: rec('ao', [variant({ ops: [op('A-11'), op('A-02', { calls: [call('dry_run'), call('apply', { verdict: 'NOT_SAT' })] })] }, false)]), e7a });
  assert.equal(diff.pass, false);
  assert.match(diff.detail, /\(b_calls\) A-02: calls twin/);
  const liar = judgeV123({ slug: SLUG, record: rec('ao', [variant({ ops: [op('A-11'), op('A-02')] }, false)]), e7a });
  assert.match(liar.detail, /tester's record says differs, verify recomputed equal/);
  assert.equal(judgeV123({ slug: 'muster-partial' }).pass, true);
  assert.deepEqual(V123_SCENARIOS, ['s1-mach', 's2-eng', 's3-def']);
  assert.equal(judgeV124({ slug: 'muster-partial' }).pass, true);
  assert.equal(judgeV125({ slug: 'muster-partial' }).pass, true);
  assert.equal(compareAo(null, []).a_ops.pass, false);
});

test('V124: the SSP JSON is recomputed from its file; the five clauses gate', () => {
  const twin = { snapStatuses: { 'PE.L2-3.10.2': 'met' }, sspStatuses: { 'PE.L2-3.10.2': 'met' }, sprs: 92, docx: true };
  const facts = { assessStatuses: { 'PE.L2-3.10.2': 'met' }, sprs: 92, sspStatuses: null, docxName: 'SSP-1.docx', upload: { status: 201, uploader: 'up@x.invalid', catalog_ids: [] }, review: { status: 201, control_id: 'PE.L2-3.10.2', reviewer: 'rv@x.invalid', uploader: 'up@x.invalid', counted: true, status_after: 'met' }, assessor: { rendered: true } };
  const sspFile = { controlImplementations: [{ control_id: 'PE.L2-3.10.2', status: 'met' }] };
  const r = judgeV124({ slug: SLUG, record: rec('eo', [variant(facts, true, { video: 'v', trace: 't', ssp_json: 'ui/eo/kit/ssp.json' })]), twin, readUiFile: () => sspFile });
  assert.equal(r.pass, true, r.detail);
  const self = judgeV124({ slug: SLUG, record: rec('eo', [variant({ ...facts, review: { ...facts.review, reviewer: 'up@x.invalid' } }, false)]), twin, readUiFile: () => sspFile });
  assert.match(self.detail, /\(d_review\) reviewer up@x\.invalid is the uploader \(GD-b\)/);
  const noFile = judgeV124({ slug: SLUG, record: rec('eo', [variant(facts, false)]), twin });
  assert.match(noFile.detail, /\(b_ssp_docx\) the UI generated no SSP JSON/);
});

test('V125: the plan comparison, push set, typing and boundary gate; the not-sent rows only report', () => {
  const run = { typed: ['bnd-001'], kept_discovery: [], not_shown: [], defaulted: [], boundary: [], pushed: 'manual-mission-plan-s1-mach-2026-10-31T10-00-00-000Z.json' };
  const files = { video: 'v', trace: 't', flow7: 'f.json', answers_sent: 'a.json', ui_plans: 'u', api_plan: 'p' };
  const readUi = (rel) => (rel === 'f.json' ? run : rel === 'a.json' ? [{ question_id: 'bnd-001' }] : null);
  const base = { slug: SLUG, twinPushed: ['manual-mission-plan-s1-mach-2026-10-30T09-00-00-000Z.json'], answersFile: [{ question_id: 'bnd-001' }, { question_id: 'PI.ODP.001' }], readUi, hashOf: () => null };
  const ok = judgeV125({ ...base, record: rec('muster', [variant({}, true, files)]), planCompareOf: () => ({ compared: 1, onlyApi: [], onlyScript: [], differing: [] }) });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /report only: 1 answers-file row\(s\) the UI did not send \(PI\.ODP\.001\)/);
  const diff = judgeV125({ ...base, record: rec('muster', [variant({}, true, files)]), planCompareOf: () => ({ compared: 1, onlyApi: [], onlyScript: [], differing: [{ name: 'manual-mission-plan-s1-mach-<ts>.json', where: '$.x' }] }) });
  assert.equal(diff.pass, false);
  assert.match(diff.detail, /\(a_plan\) UI-pushed plan differs from the API compile/);
  assert.deepEqual(answersNotSent([{ question_id: 'a' }, { question_id: 'b' }], { answers: [{ question_id: 'a' }] }), ['b']);
  assert.deepEqual(pushedList('a.json, b.json'), ['a.json', 'b.json']);
});

test('the hub over an empty out/ gives three red rows with reasons, never a throw', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fin35-hub-'));
  const rows = await runFin35Checks({ out, slug: SLUG, pkg: out, readJson: (f) => JSON.parse(fs.readFileSync(f, 'utf8')), exists: (f) => !!f && fs.existsSync(f), staleOf: () => null, ssp: null, summary: null, snapshot: null, plansDir: path.join(out, 'none'), aoRow: () => null });
  assert.deepEqual(rows.map((r) => r.id), ['V123', 'V124', 'V125']);
  for (const r of rows) { assert.equal(r.pass, false); assert.match(r.detail, /no out\/ui-e2e-(ao|eo|muster)\.json/); }
});
