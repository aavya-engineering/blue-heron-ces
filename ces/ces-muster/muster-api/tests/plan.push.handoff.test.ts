// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-12 (persist-and-reference; MG-27 stays contractor-owned, D11): a plan
// pushed through muster-api's REAL app with the SPA's production push client
// carries the SI Baseline, TCP and Readiness Posture envelopes; muster-api
// stored them beside the MP/TM/IM as si-baseline-/tcp-/readiness-posture-
// <slug>-<ts>.json. FIN-35 S-1 (GD-e): those three now go to EO's intake only;
// the persisted MP still references each by id and ces-shared canonicalSha256.
// Stamper's REAL browse router (read-only sibling import, as
// plan.push.stamperBrowse) lists them by prefix, unchanged.
// Mismatched hashes, unreferenced artifacts and malformed envelopes are 400s;
// a push without the envelopes still lands (the run package's helper).
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-mg12-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;

const { createApp } = await import('../src/app.js');
const { mintToken } = await import('../src/lib/jwt.js');
const { canonicalSha256 } = await import('ces-shared/crypto');
const api = await import('../src/services/planHandoff.js');
const spa = await import('@/features/plan/artifactRefs');
const { pushPlanToStamper } = await import('@/features/plan/planPushService');
const { createUtilityRouter } = await import('../../../ces-stamper/src/server/routes/utility.routes');
// W7-MX2: Stamper's REAL CUI Boundary reference check (W7-CUI, note 39), read-only sibling import.
const { checkCuiBoundaryRef } = await import('../../../ces-stamper/src/translators/PlanTranslator');
type PlanCompileResult = import('@/features/plan/planCompileService').PlanCompileResult;

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const readFixture = (f: string) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8'));
const tm = readFixture('tenant-manifest.json');
const si = readFixture('si-baseline.json');
const tcp = readFixture('tenant-config-profile.json');
const posture = readFixture('customers/a/planner-golden/readiness-posture.json');
const cuiBoundary = readFixture('customers/a/planner-golden/cui-boundary.json');

const SLUG = 'mg12-tenant';
const TOKEN = mintToken({
  sub: 'mg12-operator',
  tenant_id: '00000000-0000-0000-0000-0000000a0012',
  party_id: null,
  role: 'bhd_operator',
});

let muster: http.Server;
let stamper: http.Server;
let musterBase: string;
let stamperBase: string;
const store = new Map<string, string>();

beforeAll(() => {
  muster = createApp().listen(0);
  musterBase = `http://127.0.0.1:${(muster.address() as { port: number }).port}`;
  const s = express();
  s.use(createUtilityRouter());
  stamper = s.listen(0);
  stamperBase = `http://127.0.0.1:${(stamper.address() as { port: number }).port}`;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  store.set('muster-api-url', `${musterBase}/api`);
  store.set('muster-jwt', TOKEN);
});

afterAll(() => {
  muster?.close();
  stamper?.close();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
});

/** A compile result as the Plan tab holds it: fresh MP copy, envelopes built and referenced. */
async function compiledResult(): Promise<PlanCompileResult> {
  const missionPlan = readFixture('manual-mission-plan.json');
  const handoff = await spa.buildHandoffArtifacts({ siBaseline: si, tenantConfig: tcp, posture }, 'mg12-ces');
  spa.referenceHandoffArtifacts(missionPlan, handoff);
  return {
    artifacts: { missionPlan, tenantManifest: tm },
    docs: [],
    tenantSlug: SLUG,
    defaultedInputs: [],
    siFieldSources: {},
    handoff,
  } as unknown as PlanCompileResult;
}

type PushReply = { status: number; body: { details?: string[]; warnings?: string[]; pushed?: string[] } };

async function rawPush(body: Record<string, unknown>): Promise<PushReply> {
  const res = await fetch(`${musterBase}/api/plan/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ tenant_slug: SLUG, ...body }),
  });
  return { status: res.status, body: await res.json() };
}

const plansDir = () => path.join(tmpRoot, 'Stamper', 'plan-data', SLUG, 'plans');

describe('MG-12: SI Baseline, TCP and posture pushed, persisted and hash-referenced from the MP', () => {
  test('SPA and muster-api agree on names, types, MP keys and the hash function', async () => {
    expect(api.HANDOFF_KINDS).toEqual(spa.HANDOFF_KINDS);
    expect(api.HANDOFF_FILE_PREFIX).toEqual(spa.HANDOFF_FILE_PREFIX);
    expect(api.HANDOFF_ARTIFACT_TYPE).toEqual(spa.HANDOFF_ARTIFACT_TYPE);
    expect(api.MP_REF_KEY).toEqual(spa.MP_REF_KEY);
    expect(api.POLICY_HANDOFF_KINDS).toEqual(spa.POLICY_HANDOFF_KINDS);
    // W7-MX2: the sixth kind.
    expect(api.HANDOFF_KINDS).toContain('cui_boundary');
    expect(api.HANDOFF_FILE_PREFIX.cui_boundary).toBe('cui-boundary');
    for (const v of [si, tcp, posture]) expect(await spa.canonicalSha256(v)).toBe(canonicalSha256(v));
  });

  test('FIN-28 (GD-e): Stamper reads only the CUI Boundary and policy-set manifest; the other four are EO-only', () => {
    expect([...api.STAMPER_READ_KINDS].sort()).toEqual(['cui_boundary', 'policy_set_manifest']);
    expect([...api.EO_ONLY_KINDS].sort()).toEqual(['policy_inputs_profile', 'readiness_posture', 'si_baseline', 'tcp']);
    expect([...api.STAMPER_READ_KINDS, ...api.EO_ONLY_KINDS].sort()).toEqual([...api.HANDOFF_KINDS].sort());
    // Interim: the profile stays in plans\ until EO reads it from its intake (LOG-FIN-28.md S-1).
    expect([...api.STAMPER_PLANS_KINDS].sort()).toEqual(['cui_boundary', 'policy_inputs_profile', 'policy_set_manifest']);
    for (const k of api.HANDOFF_KINDS) expect(api.storedForStamper(k), k).toBe(api.STAMPER_PLANS_KINDS.includes(k));
    // Guard: Stamper's source names no EO-only file prefix or MP ref key (so it never reads them).
    const stamperSrc = path.resolve(__dirname, '..', '..', '..', 'ces-stamper', 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(f);
      }
    };
    walk(stamperSrc);
    expect(files.length).toBeGreaterThan(0);
    const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const k of api.EO_ONLY_KINDS) {
      expect(text.includes(`${api.HANDOFF_FILE_PREFIX[k]}-`), `${k} prefix`).toBe(false);
      expect(text.includes(api.MP_REF_KEY[k]), `${k} ref key`).toBe(false);
    }
    for (const k of api.STAMPER_READ_KINDS) expect(text.includes(api.HANDOFF_FILE_PREFIX[k]), `${k} read`).toBe(true);
  });

  test('FIN-35 S-1 (GD-e): the push keeps the three EO-only envelopes out of plans; the persisted MP refs still carry their hashes', async () => {
    const c = await compiledResult();
    const outcome = await pushPlanToStamper(c);
    if (!outcome.ok) console.error('push failed:', outcome);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const ts = outcome.pushed[0].replace(`manual-mission-plan-${SLUG}-`, '').replace(/\.json$/, '');
    // FIN-35 S-1: Stamper never reads si_baseline, tcp or readiness_posture, so they go to EO's intake only.
    expect(outcome.pushed).toEqual([`manual-mission-plan-${SLUG}-${ts}.json`, `tenant-manifest-${SLUG}-${ts}.json`]);
    expect(fs.readdirSync(outcome.plansDir).filter((f) => /^(si-baseline|tcp|readiness-posture)-/.test(f))).toEqual([]);

    const persistedMp = JSON.parse(fs.readFileSync(path.join(outcome.plansDir, outcome.pushed[0]), 'utf8'));
    // The MP still references each EO-only envelope by id and hash (EO resolves them from its intake receipt).
    for (const kind of api.EO_ONLY_KINDS.filter((k) => !api.POLICY_HANDOFF_KINDS.includes(k))) {
      const ref = persistedMp.inputs[api.MP_REF_KEY[kind]];
      const sent = c.handoff[kind as keyof typeof c.handoff] as { artifact_id: string; hash_sha256: string; artifact: unknown; cesId: unknown };
      expect(ref.hash_sha256, kind).toMatch(/^[0-9a-f]{64}$/);
      expect(ref.hash_sha256, kind).toBe(sent.hash_sha256);
      expect(ref.artifact_id, kind).toBe(sent.artifact_id);
      expect(canonicalSha256(sent.artifact), kind).toBe(ref.hash_sha256);
      expect(typeof sent.cesId, kind).toBe('string');
    }

    // Stamper's browse (unchanged) lists none of them.
    for (const pattern of ['si-baseline', 'tcp', 'readiness-posture']) {
      const r = await fetch(`${stamperBase}/api/browse?tenant=${SLUG}&pattern=${pattern}`);
      expect(r.status, pattern).toBe(200);
      const names = ((await r.json()).files ?? []).map((f: { name: string }) => f.name);
      expect(names.filter((n: string) => n.startsWith(`${pattern}-`)), pattern).toEqual([]);
    }
  });

  test('a hash that does not match the artifact is refused, nothing written', async () => {
    const before = fs.readdirSync(plansDir()).length;
    const c = await compiledResult();
    const r = await rawPush({
      missionPlan: c.artifacts.missionPlan,
      tenantManifest: tm,
      ...c.handoff,
      si_baseline: { ...c.handoff.si_baseline!, artifact: { ...si, si_baseline: {} } },
    });
    expect(r.status).toBe(400);
    expect(r.body.details).toEqual(['si_baseline: hash_sha256 does not match the artifact']);
    expect(fs.readdirSync(plansDir()).length).toBe(before);
  });

  test('an artifact the MP does not reference, or a malformed envelope, is refused', async () => {
    const c = await compiledResult();
    const unreferenced = readFixture('manual-mission-plan.json');
    const r1 = await rawPush({ missionPlan: unreferenced, tenantManifest: tm, readiness_posture: c.handoff.readiness_posture });
    expect(r1.status).toBe(400);
    expect(r1.body.details).toEqual(['readiness_posture: the Mission Plan does not reference it (inputs.readiness_posture_ref)']);

    const r2 = await rawPush({ missionPlan: c.artifacts.missionPlan, tenantManifest: tm, tcp: { ...c.handoff.tcp!, artifact: si } });
    expect(r2.status).toBe(400);
    expect(r2.body.details?.[0]).toMatch(/^tcp: must be/);
  });

  test('an MP whose references were not sent still lands, with a warning per missing artifact', async () => {
    const c = await compiledResult();
    const r = await rawPush({ missionPlan: c.artifacts.missionPlan, tenantManifest: tm });
    expect(r.status).toBe(201);
    expect(r.body.pushed).toHaveLength(2);
    expect((r.body.warnings ?? []).filter((w) => w.startsWith('MG-12:'))).toHaveLength(3);
  });
});

/** W3.3a: a minimal policy-inputs profile output and 20 rendered documents. */
const POLICY_BASES = Array.from({ length: 20 }, (_, i) => `policy-doc-${String(i + 1).padStart(2, '0')}`);
function policyInputs() {
  const odps: Record<string, string> = {};
  for (let i = 1; i <= 15; i++) odps[`odp_${String(i).padStart(3, '0')}`] = `value ${i}`;
  return {
    profileOutput: {
      ces: {
        artifact: 'policy_inputs_output',
        version: '1.0.0',
        generated_on: '2026-10-27T00:00:00.000Z',
        tool: 'policy_inputs',
        policy_bank_version: 'test',
      },
      organization: { legal_name: 'Fixture Org', address: { street: '', city: '', state: '', zip: '' }, org_type: 'prime' },
      personnel: [],
      odps,
      governance: { policy_effective_date: '2026-11-01', review_cycle_months: 12, fiscal_year_start_month: 10 },
    },
    documents: Object.fromEntries(POLICY_BASES.map((b) => [b, `# ${b}\n\nRendered text.\n`])),
  };
}

describe('W3.3a (B9): policy-inputs profile and policy-set manifest through the MG-12 envelopes', () => {
  async function withPolicy() {
    const c = await compiledResult();
    const policy = await spa.buildPolicyHandoffArtifacts(policyInputs(), 'mg12-ces');
    // The headless names (another <ts>); the route re-points file_name at what it stores.
    spa.referenceHandoffArtifacts(c.artifacts.missionPlan, policy, {
      policy_inputs_profile: `policy-inputs-profile-${SLUG}-headless.json`,
      policy_set_manifest: `policy-set-manifest-${SLUG}-headless.json`,
    });
    return { c, policy };
  }

  test('the push stores both envelopes in plans; the stored MP refs name them and the hashes match', async () => {
    const { c, policy } = await withPolicy();
    const r = await rawPush({ missionPlan: c.artifacts.missionPlan, tenantManifest: tm, ...c.handoff, ...policy });
    expect(r.status).toBe(201);
    const pushed = r.body.pushed!;
    const ts = pushed[0].replace(`manual-mission-plan-${SLUG}-`, '').replace(/\.json$/, '');
    expect(pushed).toEqual([
      `manual-mission-plan-${SLUG}-${ts}.json`,
      `tenant-manifest-${SLUG}-${ts}.json`,
      // FIN-35 S-1: the three EO-only envelopes are not stored in plans; the profile stays (interim, LOG-FIN-28 §3 S-1).
      `policy-inputs-profile-${SLUG}-${ts}.json`,
      `policy-set-manifest-${SLUG}-${ts}.json`,
    ]);
    expect((r.body.warnings ?? []).filter((w) => w.startsWith('MG-12:'))).toEqual([]);

    const storedMp = JSON.parse(fs.readFileSync(path.join(plansDir(), pushed[0]), 'utf8'));
    for (const kind of api.POLICY_HANDOFF_KINDS) {
      const ref = storedMp.inputs[api.MP_REF_KEY[kind]];
      expect(ref.file_name, kind).toBe(`${api.HANDOFF_FILE_PREFIX[kind]}-${SLUG}-${ts}.json`);
      const env = JSON.parse(fs.readFileSync(path.join(plansDir(), ref.file_name), 'utf8'));
      // Recomputed with ces-shared's function from the stored file.
      expect(canonicalSha256(env.artifact), kind).toBe(ref.hash_sha256);
      expect(env.artifact_id, kind).toBe(ref.artifact_id);
      expect(env.artifact.ces.artifact, kind).toBe(api.HANDOFF_ARTIFACT_TYPE[kind]);
    }
    // The pushed (request) MP is not mutated: its refs keep the headless names.
    expect((c.artifacts.missionPlan as { inputs: Record<string, { file_name: string }> }).inputs.policy_set_manifest_ref.file_name).toBe(
      `policy-set-manifest-${SLUG}-headless.json`
    );

    const manifest = JSON.parse(fs.readFileSync(path.join(plansDir(), pushed[3]), 'utf8')).artifact;
    expect(manifest.documents).toHaveLength(20);
    expect(manifest.documents.map((d: { name: string }) => d.name)).toEqual(POLICY_BASES.map((b) => `policies/${b}.md`));
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(plansDir(), pushed[2]), 'utf8')).artifact.odps)).toHaveLength(15);

    // Stamper's browse (unchanged) lists each new prefix.
    for (const [pattern, file] of [
      ['policy-inputs-profile', pushed[2]],
      ['policy-set-manifest', pushed[3]],
    ] as const) {
      const b = await fetch(`${stamperBase}/api/browse?tenant=${SLUG}&pattern=${pattern}`);
      expect(b.status, pattern).toBe(200);
      const names = ((await b.json()).files ?? []).map((f: { name: string }) => f.name);
      expect(names, pattern).toContain(file);
    }
  });

  test('a manifest whose hash does not match, or a profile the MP does not reference, is refused', async () => {
    const before = fs.readdirSync(plansDir()).length;
    const { c, policy } = await withPolicy();
    const env = policy.policy_set_manifest!;
    const tampered = { ...env, artifact: { ...(env.artifact as object), documents: [] } };
    const r1 = await rawPush({ missionPlan: c.artifacts.missionPlan, tenantManifest: tm, policy_set_manifest: tampered });
    expect(r1.status).toBe(400);
    expect(r1.body.details).toEqual(['policy_set_manifest: hash_sha256 does not match the artifact']);

    const r2 = await rawPush({
      missionPlan: readFixture('manual-mission-plan.json'),
      tenantManifest: tm,
      policy_inputs_profile: policy.policy_inputs_profile,
    });
    expect(r2.status).toBe(400);
    expect(r2.body.details).toEqual([
      'policy_inputs_profile: the Mission Plan does not reference it (inputs.policy_inputs_profile_ref)',
    ]);
    expect(fs.readdirSync(plansDir()).length).toBe(before);
  });
});

describe('W7-MX2: the CUI Boundary pushed as the sixth MG-12 envelope, hash-referenced from the MP', () => {
  /** A compile result whose handoff includes the CUI Boundary (fixture (a)'s golden). */
  async function withCui(): Promise<PlanCompileResult> {
    const missionPlan = readFixture('manual-mission-plan.json');
    // The generator's existing block, as manualPlanGenerator writes it.
    missionPlan.inputs = {
      ...(missionPlan.inputs ?? {}),
      cui_boundary_ref: {
        artifact: cuiBoundary.ces.artifact,
        version: cuiBoundary.ces.version,
        generated_on: cuiBoundary.ces.generated_on,
        cui_bank_version: cuiBoundary.ces.cui_bank_version,
      },
    };
    const handoff = await spa.buildHandoffArtifacts({ siBaseline: si, tenantConfig: tcp, posture, cuiBoundary }, 'mg12-ces');
    spa.referenceHandoffArtifacts(missionPlan, handoff);
    return {
      artifacts: { missionPlan, tenantManifest: tm, cuiBoundary },
      docs: [],
      tenantSlug: SLUG,
      defaultedInputs: [],
      siFieldSources: {},
      handoff,
    } as unknown as PlanCompileResult;
  }

  test('the SPA push stores cui-boundary-<slug>-<ts>.json; the MP ref keeps the block, the hash matches, Stamper verifies it', async () => {
    const c = await withCui();
    const outcome = await pushPlanToStamper(c);
    if (!outcome.ok) console.error('push failed:', outcome);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const ts = outcome.pushed[0].replace(`manual-mission-plan-${SLUG}-`, '').replace(/\.json$/, '');
    expect(outcome.pushed).toEqual([
      `manual-mission-plan-${SLUG}-${ts}.json`,
      `tenant-manifest-${SLUG}-${ts}.json`,
      // FIN-35 S-1: Stamper reads the CUI Boundary, so it stays in plans; the three EO-only envelopes do not.
      `cui-boundary-${SLUG}-${ts}.json`,
    ]);
    const storedMp = JSON.parse(fs.readFileSync(path.join(outcome.plansDir, outcome.pushed[0]), 'utf8'));
    const ref = storedMp.inputs.cui_boundary_ref;
    // The generator's block is kept; the three reference fields are added; no file_name (the route sets it only for the policy kinds).
    expect(ref).toMatchObject({
      artifact: 'cui_boundary_output',
      cui_bank_version: cuiBoundary.ces.cui_bank_version,
      generated_on: cuiBoundary.ces.generated_on,
      artifact_id: 'cui-boundary-mg12-ces',
      schema_id: 'muster:cui-boundary-output',
    });
    expect(ref.file_name).toBeUndefined();
    const env = JSON.parse(fs.readFileSync(path.join(outcome.plansDir, outcome.pushed[2]), 'utf8'));
    expect(Object.keys(env).sort()).toEqual(['artifact', 'artifact_id', 'cesId', 'hash_sha256', 'schema_id', 'version']);
    expect(canonicalSha256(env.artifact)).toBe(ref.hash_sha256);
    expect(env.artifact_id).toBe(ref.artifact_id);
    // The hash is not in the stored Tenant Manifest.
    expect(fs.readFileSync(path.join(outcome.plansDir, outcome.pushed[1]), 'utf8')).not.toContain(ref.hash_sha256);

    // Stamper's check (located by artifact_id among cui-boundary-*.json; the hash match wins).
    expect(checkCuiBoundaryRef(storedMp, outcome.plansDir)).toEqual({
      artifact_id: ref.artifact_id,
      hash_sha256: ref.hash_sha256,
      verified: true,
    });

    // Stamper's browse (unchanged) lists it by prefix.
    const b = await fetch(`${stamperBase}/api/browse?tenant=${SLUG}&pattern=cui-boundary`);
    expect(b.status).toBe(200);
    expect(((await b.json()).files ?? []).map((f: { name: string }) => f.name)).toContain(outcome.pushed[2]);
  });

  test('a tampered CUI Boundary, or one the MP does not reference, is refused, nothing written', async () => {
    const before = fs.readdirSync(plansDir()).length;
    const c = await withCui();
    const env = c.handoff.cui_boundary!;
    const tampered = { ...env, artifact: { ...(env.artifact as object), cui_boundary: {} } };
    const r1 = await rawPush({ missionPlan: c.artifacts.missionPlan, tenantManifest: tm, cui_boundary: tampered });
    expect(r1.status).toBe(400);
    expect(r1.body.details).toEqual(['cui_boundary: hash_sha256 does not match the artifact']);

    const r2 = await rawPush({ missionPlan: readFixture('manual-mission-plan.json'), tenantManifest: tm, cui_boundary: env });
    expect(r2.status).toBe(400);
    expect(r2.body.details).toEqual(['cui_boundary: the Mission Plan does not reference it (inputs.cui_boundary_ref)']);
    expect(fs.readdirSync(plansDir()).length).toBe(before);
  });

  test('a skipped boundary: no envelope, no reference fields, the push lands without a cui-boundary file', async () => {
    const c = await compiledResult();
    expect(c.handoff.cui_boundary).toBeUndefined();
    const ref = (c.artifacts.missionPlan as { inputs?: { cui_boundary_ref?: { hash_sha256?: string } } }).inputs?.cui_boundary_ref;
    expect(ref?.hash_sha256).toBeUndefined();
    const outcome = await pushPlanToStamper(c);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.pushed.some((f) => f.startsWith('cui-boundary-'))).toBe(false);
  });
});
