// FIN-19 (finishing plan PH-1 harness): src/flow/fin19-steps.ts and its wiring in muster-e2e-run.ts / ui-e2e-run.ts /
// eo-intake.ts / mx-io.ts, with fake fetch and fake CLI runners. Temp folders only; nothing in the workspace is touched.
import { describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  NON_STACK_CONTROLS,
  PROBE_CONTROL_ID,
  PROBE_OTHER_TENANT,
  COST_PROBES,
  crossFileProbeBody,
  runPushProbes,
  runMuCompile,
  muCompileArgs,
  postEoRouteUpload,
  eoRouteUploadContent,
  runCliReviewPair,
  runCostTraversal,
  scanGateRecords,
  lastJson,
  type CliRunner,
} from '../src/flow/fin19-steps.js';
import { intakeRecordFromPush, manifestPolicyTexts, buildEoIntakeBody, EO_INTAKE_SCHEMA } from '../src/flow/eo-intake.js';
import { perRunArtefacts, runMusterE2e } from '../src/flow/muster-e2e-run.js';
import { loadMusterE2eFile } from '../src/scenarios/musterE2eFile.js';

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const S1 = path.resolve('scenarios', 'muster', 's1-mach-e2e.json');

function plansDir(): string {
  const d = tmp('fin19-plans-');
  fs.writeFileSync(path.join(d, 'manual-mission-plan-s-2026-10-31T00-00-00-000Z.json'), JSON.stringify({ mp: 1 }));
  fs.writeFileSync(
    path.join(d, 'tenant-manifest-s-2026-10-31T00-00-00-000Z.json'),
    JSON.stringify({ tenant_manifest: { normative_controls: [{ control_id: 'AC.L1-3.1.1', required: true }] } }),
  );
  return d;
}
const resp = (status: number, body: unknown): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('FIN-19 V114: push probes and mu compile', () => {
  it('the cross-file probe adds one uncovered, non-BTC normative control and drops any override; null without normative_controls', () => {
    const body = { tenant_slug: 's', validationOverride: { reason: 'x' }, tenantManifest: { tenant_manifest: { normative_controls: [{ control_id: 'AC.L1-3.1.1' }] } } };
    const p = crossFileProbeBody(body)!;
    expect(p.validationOverride).toBeUndefined();
    const nc = (p.tenantManifest as { tenant_manifest: { normative_controls: Array<{ control_id: string }> } }).tenant_manifest.normative_controls;
    expect(nc.map((c) => c.control_id)).toEqual(['AC.L1-3.1.1', PROBE_CONTROL_ID]);
    expect(PROBE_CONTROL_ID.startsWith('btc_gate_')).toBe(false);
    expect((body.tenantManifest.tenant_manifest.normative_controls as unknown[]).length).toBe(1); // the original is untouched
    expect(crossFileProbeBody({ tenantManifest: {} })).toBeNull();
  });

  it('runPushProbes sends the probe with the run token and the valid body with the second tenant\'s token; records statuses only', async () => {
    const calls: Array<{ auth: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const auth = (init.headers as Record<string, string>).Authorization;
      calls.push({ auth, body });
      return auth === 'Bearer run' ? resp(409, { code: 'PLAN_VALIDATION_BLOCKED', error: 'blocked' }) : resp(404, { error: 'not found' });
    }) as unknown as typeof fetch;
    const rec = await runPushProbes({ apiBase: 'http://x', token: 'run', otherTenantToken: 'other', plansDir: plansDir(), slug: 's', fetchImpl });
    expect(rec.cross_file).toMatchObject({ status: 409, code: 'PLAN_VALIDATION_BLOCKED' });
    expect(rec.other_tenant).toMatchObject({ status: 404, tenant_id: PROBE_OTHER_TENANT });
    expect(JSON.stringify(calls[1]!.body)).not.toContain(PROBE_CONTROL_ID);
    expect(JSON.stringify(rec)).not.toMatch(/Bearer|run"|other"/);
  });

  it('runMuCompile takes the files from --out, else from the printed files[]; rc 2 is recorded', async () => {
    const out = path.join(tmp('fin19-mu-'), 'plan-mu');
    const viaStdout: CliRunner = async () => ({ rc: 0, stdout: `log line\n${JSON.stringify({ files: [{ name: 'a.json', content: '{"x":1}' }, { name: 'p/b.md', content: 'aGk=', encoding: 'base64' }] })}\n`, stderr: '' });
    const a = await runMuCompile({ run: viaStdout, args: ['--slug', 's'], outDir: out, env: {} });
    expect(a.source).toBe('stdout');
    expect(a.files.map((f) => f.name).sort()).toEqual(['a.json', 'p/b.md']);
    expect(fs.readFileSync(path.join(out, 'p', 'b.md'), 'utf8')).toBe('hi');
    const viaDir: CliRunner = async (args) => {
      const dir = args[args.indexOf('--out') + 1]!;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'c.json'), '{}');
      return { rc: 0, stdout: '{}', stderr: '' };
    };
    expect((await runMuCompile({ run: viaDir, args: [], outDir: out, env: {} })).source).toBe('out-dir');
    const missing = await runMuCompile({ run: async () => ({ rc: 2, stdout: '', stderr: 'usage: unknown command plan' }), args: [], outDir: out, env: {} });
    expect(missing).toMatchObject({ rc: 2, files: [] });
    expect(missing.error).toMatch(/unknown command/);
    const escape: CliRunner = async () => ({ rc: 0, stdout: JSON.stringify({ files: [{ name: '../evil.json', content: '' }] }), stderr: '' });
    expect((await runMuCompile({ run: escape, args: [], outDir: out, env: {} })).error).toMatch(/refused file name/);
    expect(muCompileArgs({ slug: 's', discovery: 'd.json', answers: 'a.json' })).toEqual(['--slug', 's', '--discovery', 'd.json', '--answers', 'a.json', '--max-reads', '2']);
    expect(lastJson('a\n{\n  "k": 1\n}\n')).toEqual({ k: 1 });
  });
});

describe('FIN-19 V112: EO route upload and the eo review supersede pair', () => {
  it('postEoRouteUpload posts multipart to /api/ec/ingest with the principal header beside the bearer; the token is not recorded', async () => {
    let seen: { url: string; headers: Record<string, string>; form: FormData } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, form: init.body as FormData };
      return resp(201, { itemId: 'eci-1', uploadedBy: { upn: 'u@t' } });
    }) as unknown as typeof fetch;
    const rec = await postEoRouteUpload({ eoUrl: 'http://eo', slug: 's1-mach', headers: { Authorization: 'Bearer b' }, principalToken: 'secret-token', uploaderUpn: 'u@t', submittedByRole: 'isso', formId: 'f', emxIds: ['EMX-1', 'EMX-2'], fetchImpl });
    expect(seen!.url).toBe('http://eo/api/ec/ingest');
    expect(seen!.headers).toMatchObject({ Authorization: 'Bearer b', 'x-ces-principal': 'secret-token' });
    expect(seen!.form.get('controlIds')).toBe('PE.L2-3.10.2');
    expect(seen!.form.get('emx_ids')).toBe('EMX-1,EMX-2');
    expect(seen!.form.get('source')).toBe('manual_upload');
    expect(rec).toMatchObject({ http_status: 201, item_id: 'eci-1', uploaded_by: 'u@t', form_id: 'f' });
    expect(rec.sha256).toBe(crypto.createHash('sha256').update(eoRouteUploadContent('s1-mach')).digest('hex'));
    expect(eoRouteUploadContent('s1-mach').toString()).toMatch(/FICTIONAL/);
    expect(JSON.stringify(rec)).not.toContain('secret-token');
    const none = await postEoRouteUpload({ eoUrl: 'http://eo', slug: 's', headers: {}, principalToken: null, uploaderUpn: null, submittedByRole: 'x', fetchImpl });
    expect(none.http_status).toBeNull();
    expect(none.note).toMatch(/not run/);
  });

  it('runCliReviewPair mints, reviews twice with the token in the env (never argv), lists the history', async () => {
    const fetchImpl = (async () => resp(201, { token: 'approver-tok', mintId: 'm1' })) as unknown as typeof fetch;
    const seen: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    let n = 0;
    const run: CliRunner = async (args, env) => {
      seen.push({ args, env });
      if (args[1] === 'list') return { rc: 0, stdout: JSON.stringify({ reviews: [{ reviewId: 'r2', objectiveId: 'PE.L2-3.10.2[b]' }], history: [{ reviewId: 'r1', objectiveId: 'PE.L2-3.10.2[b]', supersededBy: 'r2' }] }), stderr: '' };
      n++;
      return { rc: 0, stdout: JSON.stringify({ reviewId: `r${n}`, supersedes: n === 2 ? ['r1'] : [] }), stderr: '' };
    };
    const { rc, record } = await runCliReviewPair({ eoUrl: 'http://eo', slug: 's', reviewerUpn: 'rev@t', artifactSha256: 'a'.repeat(64), baseHeaders: {}, operatorToken: 'op', run, env: {}, fetchImpl });
    expect(rc).toBe(0);
    expect(record.calls.map((c) => [c.review_id, c.supersedes])).toEqual([['r1', []], ['r2', ['r1']]]);
    expect(record.list!.history[0]).toEqual({ review_id: 'r1', objective_id: 'PE.L2-3.10.2[b]', superseded_by: 'r2' });
    for (const s of seen) {
      expect(s.args.join(' ')).not.toContain('approver-tok');
      expect(s.env.CES_EO_APPROVER_TOKEN).toBe('approver-tok');
    }
    expect(seen[0]!.args).toEqual(expect.arrayContaining(['review', '--objective', 'PE.L2-3.10.2[b]', '--verdict', 'met']));
    expect(JSON.stringify(record)).not.toContain('approver-tok');
    expect((await runCliReviewPair({ eoUrl: 'x', slug: 's', reviewerUpn: null, artifactSha256: null, baseHeaders: {}, operatorToken: '', run, env: {} })).rc).toBe(0);
    expect((await runCliReviewPair({ eoUrl: 'x', slug: 's', reviewerUpn: 'r', artifactSha256: null, baseHeaders: {}, operatorToken: '', run, env: {} })).rc).toBe(1);
  });
});

describe('FIN-19 V113: the cost traversal', () => {
  const aoOut = (o: Record<string, unknown>): string => `noise\n${JSON.stringify(o, null, 2)}\n`;
  it('dry run -> no DP-1 -> wrong DP-2 -> DP-1 + DP-2; DP-1 comes from the dry run notice; S1 only', async () => {
    expect(COST_PROBES).toEqual({ 's1-mach': { op: 'E-01' } });
    const argvs: string[][] = [];
    const runCli = async (args: string[]) => {
      argvs.push(args);
      const cg = { monthlyUsd: 12.5, priceDate: '2026-10-31', ackHash: 'h', outcome: 'notice' };
      if (!args.includes('--apply')) return { rc: 0, stdout: aoOut({ success: true, evidencePath: 'adminops_evidence/r0', evidence: { metadata: { costGate: cg } } }), stderr: '' };
      if (!args.includes('--cost-ack')) return { rc: 0, stdout: aoOut({ success: false, evidencePath: 'adminops_evidence/r1', evidence: { metadata: { costGate: { ...cg, outcome: 'refused', reason: 'dp1_missing: x' } } } }), stderr: '' };
      const typed = args[args.indexOf('--confirm-cost') + 1];
      if (typed !== 'E-01 12.50') return { rc: 0, stdout: aoOut({ success: false, evidencePath: 'adminops_evidence/r2', evidence: { metadata: { costGate: { ...cg, outcome: 'refused', reason: 'dp2_mismatch: x' } } } }), stderr: '' };
      return { rc: 0, stdout: aoOut({ success: true, evidencePath: 'adminops_evidence/r3', evidence: { metadata: { costGate: { ...cg, outcome: 'enabled' } } } }), stderr: '' };
    };
    const rec = await runCostTraversal({ op: 'E-01', slug: 's1-mach', requestor: 'op@t', env: {}, runCli });
    expect(rec.ok).toBe(true);
    expect(rec.calls.map((c) => [c.call, c.cost_outcome, c.evidence_row_id])).toEqual([
      ['dry_run', 'notice', 'r0'], ['apply_no_dp1', 'refused', 'r1'], ['apply_wrong_dp2', 'refused', 'r2'], ['apply_dp1_dp2', 'enabled', 'r3'],
    ]);
    const ack = JSON.parse(argvs[2]![argvs[2]!.indexOf('--cost-ack') + 1]!);
    expect(ack).toMatchObject({ opId: 'E-01', ackHash: 'h', monthlyUsd: 12.5, priceDate: '2026-10-31' });
    const noPrice = await runCostTraversal({ op: 'E-01', slug: 's', requestor: 'op@t', env: {}, runCli: async () => ({ rc: 0, stdout: aoOut({ success: true, evidence: { metadata: { costGate: { outcome: 'notice', monthlyUsd: null } } } }), stderr: '' }) });
    expect(noPrice.ok).toBe(false);
    expect(noPrice.calls).toHaveLength(1);
    expect(noPrice.note).toMatch(/DP-1 cannot be built/);
    expect((await runCostTraversal({ op: 'E-01', slug: 's', requestor: null, env: {}, runCli })).note).toMatch(/operator_upn/);
  });
});

describe('FIN-19 V110 and V114 helpers', () => {
  it('scanGateRecords finds the GUI manual-gate records (metadata.gate manual) with their controls and action', () => {
    const d = tmp('fin19-gates-');
    fs.mkdirSync(path.join(d, 'physical'), { recursive: true });
    fs.writeFileSync(path.join(d, 'physical', 'pe.json'), JSON.stringify({ complianceVerdict: 'SAT', registryEntry: { entry_id: 'PE.L1-3.10.1.x', control_ids: ['PE.L1-3.10.1'] }, metadata: { gate: 'manual', gateAction: 'approved', controlIds: ['PE.L1-3.10.1'] } }));
    fs.writeFileSync(path.join(d, 'physical', 'other.json'), JSON.stringify({ metadata: { controlIds: ['AC.L1-3.1.1'] } }));
    expect(scanGateRecords([d, path.join(d, 'absent')])).toEqual([{ file: 'physical/pe.json', task_id: null, entry_id: 'PE.L1-3.10.1.x', controls: ['PE.L1-3.10.1'], gate_action: 'approved', verdict: 'SAT' }]);
    expect(NON_STACK_CONTROLS).toHaveLength(28);
  });

  it('intakeRecordFromPush turns muster-api\'s delivered eo_intake into the eo-intake@1 record; null when not delivered', () => {
    const d = plansDir();
    const built = buildEoIntakeBody(d, 's', path.join(d, 'policies'));
    const rec = intakeRecordFromPush({ eo_intake: { status: 'delivered', http: 201, receipt: { receipt_id: 'rc' } } }, 'http://eo', built)!;
    expect(rec).toMatchObject({ schema: EO_INTAKE_SCHEMA, status: 'delivered', http: 201, receipt: { receipt_id: 'rc' } });
    expect(rec.by).toMatch(/muster-api at E4/);
    expect(intakeRecordFromPush({ eo_intake: { status: 'not_configured' } }, 'http://eo', built)).toBeNull();
    expect(intakeRecordFromPush(null, 'http://eo', built)).toBeNull();
  });

  it('manifestPolicyTexts reads the manifest\'s documents from the policies folder and names the missing ones', () => {
    const d = tmp('fin19-pol-');
    fs.writeFileSync(path.join(d, 'a.md'), '# A');
    const r = manifestPolicyTexts({ artifact: { documents: [{ name: 'policies/a.md' }, { name: 'policies/b.md' }] } }, d);
    expect(r).toEqual({ policies: [{ name: 'policies/a.md', markdown: '# A' }], missing: ['policies/b.md'] });
  });

  it('the per-run cleanup removes the FIN-19 records and folders', () => {
    const ws = tmp('fin19-clean-');
    const out = path.join(ws, 'out');
    fs.mkdirSync(path.join(out, 'plan-mu'), { recursive: true });
    fs.mkdirSync(path.join(out, 'eo-package-cli'), { recursive: true });
    for (const f of ['plan-compile-mu.json', 'muster-probes.json', 'ec-upload-eo-route.json', 'eo-review-cli.json', 'adminops-cost.json', 'eo-package-cli.zip', 'eo-package-cli.json']) fs.writeFileSync(path.join(out, f), '{}');
    const found = perRunArtefacts(out, path.join(ws, 'pl'), 's').map((p) => path.basename(p)).sort();
    expect(found).toEqual(['adminops-cost.json', 'ec-upload-eo-route.json', 'eo-package-cli', 'eo-package-cli.json', 'eo-package-cli.zip', 'eo-review-cli.json', 'muster-probes.json', 'plan-compile-mu.json', 'plan-mu']);
  });

  it('the dry run lists E3\'s early EO and mu compile, E4\'s probes, E8.5b, E8.6b, E8\'s eo package build and E7C; no token in any command', async () => {
    const ws = tmp('fin19-dry-');
    const rec = await runMusterE2e({ scenario: await loadMusterE2eFile(S1), scenarioPath: S1, wsRoot: ws, packageRoot: path.join(ws, 'pkg'), dryRun: true, log: () => {} });
    const cmd = (id: string) => rec.steps.find((s) => s.id === id)!.commands.join('\n');
    expect(cmd('E3')).toMatch(/src\/eo\/index\.ts \(EO up before E3\/E4/);
    expect(cmd('E3')).toMatch(/CES_EO_URL=http:\/\/127\.0\.0\.1:4002 CES_EO_AUTH_TOKEN=<run-only>/);
    expect(cmd('E3')).toMatch(/dist\/cli\/bin\.js plan compile --slug s1-mach --discovery .* --max-reads 2 --out/);
    expect(cmd('E4')).toMatch(/want 409.*want 404/);
    expect(cmd('E8.5b')).toMatch(/\/api\/ec\/ingest multipart/);
    expect(cmd('E8.6b')).toMatch(/CES_EO_APPROVER_TOKEN=<minted>.*review --tenant s1-mach --control PE\.L2-3\.10\.2 --objective PE\.L2-3\.10\.2\[b\]/);
    expect(cmd('E8')).toMatch(/package build --tenant s1-mach --out/);
    expect(cmd('E7C')).toMatch(/exec E-01 --tenant s1-mach/);
    expect(rec.steps.find((s) => s.id === 'E7C')!.status).toBe('planned');
    const all = rec.steps.flatMap((s) => s.commands).join('\n');
    expect(all).not.toMatch(/Bearer [A-Za-z0-9]/);
    expect(fs.existsSync(path.join(ws, 'out'))).toBe(false);
  });

  it('muster-e2e-run.ts starts EO before muster-api at E3 and restarts it at E7; ui-e2e-run.ts probes EO after the ledger snapshot', () => {
    const src = fs.readFileSync(path.resolve('src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    const e3 = src.indexOf("id: 'E3',");
    expect(src.indexOf("startBg('E3-eo'", e3)).toBeGreaterThan(e3);
    expect(src.indexOf("startBg('E3-eo'", e3)).toBeLessThan(src.indexOf("startBg('E3-muster-api'", e3));
    const e7 = src.indexOf("id: 'E7',");
    expect(src.indexOf('stopTree(eoProc);', e7)).toBeLessThan(src.indexOf("startBg('E7-eo'", e7));
    const ui = fs.readFileSync(path.resolve('src', 'flow', 'ui-e2e-run.ts'), 'utf8');
    expect(ui.indexOf('runEuEoProbe({')).toBeGreaterThan(ui.indexOf('fs.writeFileSync(V.ledger'));
    expect(ui.indexOf('runEuEoProbe({')).toBeLessThan(ui.indexOf('await serve.stop().catch(() => undefined);\n    serve = undefined;'));
  });
});
