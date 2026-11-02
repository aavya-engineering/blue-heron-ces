// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-12 (persist-and-reference): for fixture (a), the compile's SI Baseline,
// TCP and Readiness Posture become hand-off envelopes; the MP references each
// by id and hash; the headless writer persists them under muster-api's push
// names; read back from disk, every MP reference resolves to its file and the
// hash matches; the persisted artifacts pass the copied Planner schemas (only
// reviewed allow-list findings); the push body carries the same envelopes.
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { db } from '@/shared/db/schema';
import type { InterviewSession } from '@/shared/types/engagement';

vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('./planTestSupport');
  const banks = loadBanks();
  return { loadCompilerBanks: async () => banks, _resetCompilerBanksCache: () => {} };
});

const { compilePlanForSession, attachPolicyHandoff } = await import('../planCompileService');
const { loadCustomer } = await import('./parityHarness');
const { loadBanks } = await import('./planTestSupport');
const { checkInputSchemas, schemaValidatorsFor } = await import('../planValidation');
const { planPushBody, attachPolicyHandoffWithTexts } = await import('../planPushService');
const { writeHandoffOutputs } = await import('../headless/planOutputFiles');
const { canonicalSha256, missionPlanRefs, HANDOFF_KINDS: ALL_KINDS, POLICY_HANDOFF_KINDS } = await import('../artifactRefs');
// W3.3a: the compile builds the first three kinds; the two policy kinds come from the rendered set.
// W7-MX2: the compile also builds cui_boundary (fixture (a) has a CUI Boundary).
const HANDOFF_KINDS = ALL_KINDS.filter((k) => !POLICY_HANDOFF_KINDS.includes(k));
const { checkMissionPlanCore } = await import('../missionPlanContract');

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
});

async function compileFixtureA() {
  const { musterSession } = loadCustomer('a');
  await db.engagements.put(musterSession.engagement);
  await db.assessed_parties.put(musterSession.party);
  const session: InterviewSession = {
    ...musterSession.session,
    readiness_manifest: musterSession.session.readiness_manifest ?? {
      mode: 'independent',
      auth_tier: 'lite',
      tenant_slug: 'fixture-a',
      tenant_kind: 'sim',
      operator_name: 'Test Operator',
      operator_role: 'assessor',
    },
  };
  await db.interview_sessions.put(session);
  return { compiled: await compilePlanForSession(session.id), engagementId: musterSession.engagement.id };
}

describe('MG-12: SI Baseline, TCP and posture persisted and hash-referenced from the MP', () => {
  test('fixture (a): MP refs resolve to the persisted files and the hashes match', async () => {
    const { compiled, engagementId } = await compileFixtureA();
    const a = compiled.artifacts;
    expect(a.tenantConfig).not.toBeNull(); // non-vacuous: all three kinds present
    expect(Object.keys(compiled.handoff).sort()).toEqual([...HANDOFF_KINDS].sort());

    // The envelopes wrap the very objects the compile read.
    expect(compiled.handoff.si_baseline!.artifact).toBe(a.siBaseline);
    expect(compiled.handoff.tcp!.artifact).toBe(a.tenantConfig);
    expect(compiled.handoff.readiness_posture!.artifact).toBe(compiled.posture);
    expect(compiled.handoff.cui_boundary!.artifact).toBe(a.cuiBoundary);
    for (const kind of HANDOFF_KINDS) expect(compiled.handoff[kind]!.cesId, kind).toBe(engagementId);

    // The MP references all three and stays valid under the shared contract.
    const refs = missionPlanRefs(a.missionPlan);
    expect(Object.keys(refs).sort()).toEqual([...HANDOFF_KINDS].sort());
    expect(checkMissionPlanCore(a.missionPlan).ok).toBe(true);
    // tcp_ref keeps the generator's own fields.
    const tcpRef = (a.missionPlan as unknown as { inputs: { tcp_ref: Record<string, unknown> } }).inputs.tcp_ref;
    expect(tcpRef.artifact).toBe('tenant_config_profile');
    expect(tcpRef.tcp_bank_version).toBeDefined();
    // W7-MX2: cui_boundary_ref keeps the generator's block and gains the hash reference (no file_name).
    const cuiRef = (a.missionPlan as unknown as { inputs: { cui_boundary_ref: Record<string, unknown> } }).inputs
      .cui_boundary_ref;
    expect(cuiRef.artifact).toBe('cui_boundary_output');
    expect(cuiRef.cui_bank_version).toBe(a.cuiBoundary!.ces.cui_bank_version);
    expect(cuiRef.generated_on).toBe(a.cuiBoundary!.ces.generated_on);
    expect(cuiRef.artifact_id).toBe(`cui-boundary-${engagementId}`);
    expect(cuiRef.schema_id).toBe('muster:cui-boundary-output');
    expect(cuiRef.hash_sha256).toBe(await canonicalSha256(a.cuiBoundary));
    expect(cuiRef.file_name).toBeUndefined();
    // The hash is not duplicated in the Tenant Manifest.
    expect(JSON.stringify(a.tenantManifest)).not.toContain(cuiRef.hash_sha256 as string);

    // Persist (the headless runner's writer) and resolve from disk.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg12-handoff-'));
    try {
      const ts = '2026-10-27T00-00-00-000Z';
      const written = writeHandoffOutputs(dir, 'fixture-a', ts, compiled.handoff);
      expect(Object.values(written).map((p) => path.basename(p!)).sort()).toEqual([
        `cui-boundary-fixture-a-${ts}.json`,
        `readiness-posture-fixture-a-${ts}.json`,
        `si-baseline-fixture-a-${ts}.json`,
        `tcp-fixture-a-${ts}.json`,
      ]);
      const onDisk = fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      const persisted: Record<string, unknown> = {};
      for (const kind of HANDOFF_KINDS) {
        const ref = refs[kind]!;
        const hits = onDisk.filter((e) => e.artifact_id === ref.artifact_id && e.hash_sha256 === ref.hash_sha256);
        expect(hits, kind).toHaveLength(1);
        // Recomputed from the file's content, not read off the envelope.
        expect(await canonicalSha256(hits[0].artifact), kind).toBe(ref.hash_sha256);
        expect(hits[0].cesId, kind).toBe(engagementId);
        persisted[kind] = hits[0].artifact;
      }

      // The persisted artifacts against the copied Planner schemas: no unreviewed findings.
      const check = checkInputSchemas(schemaValidatorsFor(loadBanks().inputSchemas!), {
        'si-baseline': persisted.si_baseline,
        'tenant-config-profile': persisted.tcp,
        'readiness-posture': persisted.readiness_posture,
      });
      expect(check.warnings).toEqual([]);
      expect(check).toEqual(compiled.validation.schema);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // The SPA push body carries the same envelopes.
    const body = planPushBody(compiled);
    expect(body.si_baseline).toBe(compiled.handoff.si_baseline);
    expect(body.tcp).toBe(compiled.handoff.tcp);
    expect(body.readiness_posture).toBe(compiled.handoff.readiness_posture);
    expect(body.cui_boundary).toBe(compiled.handoff.cui_boundary);
  });

  test('W7-MX2: a skipped CUI Boundary gives no envelope and no reference fields', async () => {
    const { compiled } = await compileFixtureA();
    // Fixture (a) builds a boundary; the skip path is the artifactRefs builder with no boundary.
    const { buildHandoffArtifacts, referenceHandoffArtifacts } = await import('../artifactRefs');
    const handoff = await buildHandoffArtifacts(
      { siBaseline: compiled.artifacts.siBaseline, tenantConfig: null, posture: compiled.posture, cuiBoundary: null },
      'w7-mx2-ces'
    );
    expect(handoff.cui_boundary).toBeUndefined();
    const mp = { inputs: {} as Record<string, unknown> };
    referenceHandoffArtifacts(mp, handoff);
    expect(mp.inputs.cui_boundary_ref).toBeUndefined();
    expect(planPushBody({ ...compiled, handoff }).cui_boundary).toBeUndefined();
  });

  test('W7-MX2 (GOAL item 1): the Plan tab compile carries both policy envelopes, referenced from the MP', async () => {
    const { compiled, engagementId } = await compileFixtureA();
    // The SPA's static /knowledge assets (the Policy Inputs bank), served from public/.
    vi.stubGlobal('fetch', async (url: string) => {
      const file = path.resolve(process.cwd(), 'public', decodeURI(String(url)).replace(/^\//, ''));
      const text = fs.readFileSync(file, 'utf8');
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
    });
    try {
      const sessionId = loadCustomer('a').musterSession.session.id;
      await attachPolicyHandoff(compiled, sessionId);
    } finally {
      vi.unstubAllGlobals();
    }
    const refs = missionPlanRefs(compiled.artifacts.missionPlan);
    expect(Object.keys(refs).sort()).toEqual([...ALL_KINDS].sort());
    for (const kind of POLICY_HANDOFF_KINDS) {
      const env = compiled.handoff[kind]!;
      expect(env.cesId, kind).toBe(engagementId);
      expect(await canonicalSha256(env.artifact), kind).toBe(refs[kind]!.hash_sha256);
      expect(env.artifact_id, kind).toBe(refs[kind]!.artifact_id);
      expect(refs[kind]!.file_name, kind).toBeUndefined();
    }
    expect((compiled.handoff.policy_set_manifest!.artifact as { documents: unknown[] }).documents.length).toBeGreaterThan(0);
    expect(checkMissionPlanCore(compiled.artifacts.missionPlan).ok).toBe(true);
    // The push body carries all six.
    const body = planPushBody(compiled);
    for (const kind of ALL_KINDS) expect(body[kind], kind).toBe(compiled.handoff[kind]);
  });

  test('FIN-28 (V122): the Plan tab render returns the texts the policy-set manifest hashes; the push carries them', async () => {
    const { compiled } = await compileFixtureA();
    vi.stubGlobal('fetch', async (url: string) => {
      const file = path.resolve(process.cwd(), 'public', decodeURI(String(url)).replace(/^\//, ''));
      const text = fs.readFileSync(file, 'utf8');
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
    });
    let texts: Awaited<ReturnType<typeof attachPolicyHandoffWithTexts>>;
    try {
      texts = await attachPolicyHandoffWithTexts(compiled, loadCustomer('a').musterSession.session.id);
    } finally {
      vi.unstubAllGlobals();
    }
    // Same envelopes as attachPolicyHandoff: all six kinds referenced from the MP.
    const refs = missionPlanRefs(compiled.artifacts.missionPlan);
    expect(Object.keys(refs).sort()).toEqual([...ALL_KINDS].sort());
    for (const kind of POLICY_HANDOFF_KINDS) {
      expect(await canonicalSha256(compiled.handoff[kind]!.artifact), kind).toBe(refs[kind]!.hash_sha256);
    }
    // EO's intake rule: each text is named in the manifest and sha256(markdown, utf8) equals its entry.
    const docs = (compiled.handoff.policy_set_manifest!.artifact as { documents: Array<{ name: string; sha256: string }> }).documents;
    expect(texts.map((t) => t.name)).toEqual(docs.map((d) => d.name));
    for (const t of texts) {
      const sha = createHash('sha256').update(t.markdown, 'utf8').digest('hex');
      expect(sha, t.name).toBe(docs.find((d) => d.name === t.name)!.sha256);
    }
    expect(texts.length).toBeGreaterThan(0);
    // The SPA push body: the six envelopes plus the texts (the API push's FIN-19 extra field).
    const body = planPushBody(compiled, undefined, texts);
    for (const kind of ALL_KINDS) expect(body[kind], kind).toBe(compiled.handoff[kind]);
    expect(body.policies).toBe(texts);
    // No manifest, no texts: EO would reject texts it cannot check.
    expect(planPushBody({ ...compiled, handoff: { ...compiled.handoff, policy_set_manifest: undefined } }, undefined, texts).policies).toBeUndefined();
  });
});
