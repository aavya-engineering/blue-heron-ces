// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node
// P2C.1: the runner's document outputs, written from fixture (a)'s compile:
// policies/ (20 x .md + .docx) and reports/ (renderReports over the compile's
// own gap set + task catalog). Hand-off (a): the reports' task ids are the
// MP's step ids. Hand-off (b): the CUI-vs-discovery staleness warning is in
// the compile's warnings.
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/shared/db/schema';
import type { InterviewFact } from '@/shared/types/engagement';
import type { PlanCompileResult } from '../../planCompileService';
import { missionPlanDirectives } from '../../planCompileService';
import { PLANNING_DRAFT_BANNERS, renderPolicySet, resolvePolicySignatories, withApprovalBlock, withPlanningDraftBanner } from '../../policy/policyDocuments';
import { renderAllPolicies } from '@/features/plan/engine/mpt/services/policyRenderer';
import { renderReports, REPORT_FILES } from '../../reports/planReports';
import { buildSessionQuestionSet } from '../../reports/sessionReports';
import { writePolicyHandoffOutputs, writePolicyOutputs, writeReportOutputs } from '../planOutputFiles';
import { createHash } from 'node:crypto';
import {
  canonicalSha256,
  HANDOFF_ARTIFACT_TYPE,
  missionPlanRefs,
  MP_REF_KEY,
  POLICY_HANDOFF_KINDS,
  type PolicySetManifest,
} from '../../artifactRefs';
import { checkMissionPlanCore } from '../../missionPlanContract';

const PUBLIC = path.resolve(process.cwd(), 'public');
const realFetch = globalThis.fetch;
const { loadCustomer, reportBanks } = await import('../../__tests__/parityHarness');
const { freezeEntropy } = await import('../../__tests__/fixtureInputs');
const customer = loadCustomer('a');
const bank = load(fs.readFileSync(path.join(PUBLIC, 'knowledge', 'primed Policy Inputs Question Bank.yaml'), 'utf8'));

let compiled: PlanCompileResult;
let outDir: string;

beforeAll(async () => {
  globalThis.fetch = (async (url: string) => {
    const file = path.join(PUBLIC, decodeURI(String(url)).replace(/^\//, ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
  }) as typeof fetch;
  const s = customer.musterSession;
  await db.engagements.put(s.engagement);
  await db.assessed_parties.put(s.party);
  await db.interview_sessions.put(s.session);
  const entropy = freezeEntropy();
  try {
    const { compilePlanForSession } = await import('../../planCompileService');
    compiled = await compilePlanForSession(s.session.id);
  } finally {
    entropy.restore();
  }
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-outputs-'));
}, 120_000);

afterAll(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('P2C.1: runner outputs', () => {
  test('policies/: 22 markdown + 22 DOCX (Planner 20 + Muster 2, W5c2), zero unresolved tokens', async () => {
    const s = customer.musterSession;
    const set = await renderPolicySet({ compile: compiled, facts: s.session.facts as InterviewFact[], party: s.party, bank });
    const summary = await writePolicyOutputs(outDir, set);
    expect(summary.documents).toBe(22);
    expect(summary.files).toHaveLength(44);
    expect(summary.unresolved).toEqual({});
    const onDisk = fs.readdirSync(path.join(outDir, 'policies')).sort();
    expect(onDisk).toEqual(summary.files.map((f) => f.slice('policies/'.length)).sort());
    expect(onDisk).toContain('system-security-plan.docx');
    expect(onDisk).toContain('poam.md');
    expect(onDisk).toContain('continuous-monitoring-plan.docx');
    expect(onDisk).toContain('acceptable-use-policy.md');
    expect(fs.readFileSync(path.join(outDir, 'policies', 'incident-response-plan.docx')).subarray(0, 2).toString()).toBe('PK');
    // W5c7: +1 defaulted (PI.ODP.016, the time source, unanswered here); FIN-26b: +1 (PI.ODP.017, sign-in frequency).
    expect(summary.sources).toMatchObject({ defaulted: 19, discovered: 4 });
  });

  test("reports/: the three assessor reports and the tech-ref guide, over the compile's own task catalog", async () => {
    const banks = reportBanks();
    const s = customer.musterSession;
    const qs = await buildSessionQuestionSet(s.session.facts as InterviewFact[], s.session.selected_stacks ?? [], banks.rrQuestionBank, banks);
    const names = writeReportOutputs(outDir, renderReports(compiled, banks, qs));
    expect(names.sort()).toEqual(Object.values(REPORT_FILES).map((f) => `reports/${f}`).sort());
    // Hand-off (a): every task the traceability report traces is an MP step.
    const trace = fs.readFileSync(path.join(outDir, 'reports', REPORT_FILES.traceabilityJson), 'utf8');
    const traced = [...trace.matchAll(/"task_id": "([^"]+)"/g)].map((m) => m[1]);
    const catalog = new Set(compiled.artifacts.taskCatalog.tasks.map((t) => t.task_id));
    const mpText = JSON.stringify(compiled.artifacts.missionPlan);
    expect(traced.length).toBeGreaterThan(0);
    expect(traced.filter((id) => !catalog.has(id))).toEqual([]);
    // ... and the MP carries the same ids (milestone phase_tasks / control directive step_ids).
    expect(traced.filter((id) => !mpText.includes(`"${id}"`))).toEqual([]);
    const steps = missionPlanDirectives(compiled.artifacts.missionPlan).flatMap((d) => d.step_ids);
    expect(steps.filter((id) => !catalog.has(id))).toEqual([]);
    expect(compiled.artifacts.taskCatalog.tasks).toHaveLength(compiled.artifacts.taskCount);
  });
});

describe('W3.3a (B9): policy-inputs profile and policy-set manifest as MG-12 envelopes', () => {
  test('envelopes written beside the plan files; the MP refs (hash + file name) resolve and the hashes match', async () => {
    const s = customer.musterSession;
    const set = await renderPolicySet({ compile: compiled, facts: s.session.facts as InterviewFact[], party: s.party, bank });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w33a-policy-handoff-'));
    try {
      await writePolicyOutputs(dir, set);
      const mp = structuredClone(compiled.artifacts.missionPlan);
      const ts = '2026-10-27T00-00-00-000Z';
      const written = await writePolicyHandoffOutputs(dir, 'fixture-a', ts, set, mp, 'w33a-ces');
      expect(Object.values(written).map((p) => path.basename(p!)).sort()).toEqual([
        `policy-inputs-profile-fixture-a-${ts}.json`,
        `policy-set-manifest-fixture-a-${ts}.json`,
      ]);

      // The MP references both (plus the compile's three and, W7-MX2, the CUI Boundary) and stays valid.
      expect(Object.keys(missionPlanRefs(mp)).sort()).toEqual(
        ['cui_boundary', 'policy_inputs_profile', 'policy_set_manifest', 'readiness_posture', 'si_baseline', 'tcp']
      );
      expect(checkMissionPlanCore(mp).ok).toBe(true);
      const inputs = (mp as unknown as { inputs: Record<string, Record<string, string>> }).inputs;
      const envelopes: Record<string, { artifact_id: string; hash_sha256: string; cesId: string; artifact: Record<string, unknown> }> = {};
      for (const kind of POLICY_HANDOFF_KINDS) {
        const ref = inputs[MP_REF_KEY[kind]];
        expect(ref.file_name, kind).toBe(path.basename(written[kind]!));
        const env = JSON.parse(fs.readFileSync(path.join(dir, ref.file_name), 'utf8'));
        // Recomputed from the file's content, not read off the envelope.
        expect(await canonicalSha256(env.artifact), kind).toBe(ref.hash_sha256);
        expect(env.hash_sha256, kind).toBe(ref.hash_sha256);
        expect(env.artifact_id, kind).toBe(ref.artifact_id);
        expect(env.cesId, kind).toBe('w33a-ces');
        expect((env.artifact.ces as { artifact: string }).artifact, kind).toBe(HANDOFF_ARTIFACT_TYPE[kind]);
        envelopes[kind] = env;
      }

      // The profile envelope carries the profile output the policies were rendered from.
      expect(envelopes.policy_inputs_profile.artifact).toEqual(JSON.parse(JSON.stringify(set.profile.output)));
      expect(Object.keys(envelopes.policy_inputs_profile.artifact.odps as object).length).toBeGreaterThan(0);

      // The manifest: 22 documents (W5c2: Planner 20 + Muster 2), relative names only, each hash = SHA-256 of the written markdown.
      const manifest = envelopes.policy_set_manifest.artifact as unknown as PolicySetManifest;
      expect(manifest.documents).toHaveLength(22);
      expect(manifest.documents.map((d) => d.name)).toEqual(
        expect.arrayContaining(['policies/continuous-monitoring-plan.md', 'policies/acceptable-use-policy.md'])
      );
      for (const d of manifest.documents) {
        expect(d.name, d.name).toMatch(/^policies\/[a-z0-9-]+\.md$/);
        const bytes = fs.readFileSync(path.join(dir, d.name));
        expect(createHash('sha256').update(bytes).digest('hex'), d.name).toBe(d.sha256);
      }
      // W4 banner: the SSP and POA&M hashes cover the rendered markdown with its
      // planning-draft banner (so both differ from the template-only render).
      // W5: every hash covers the approval block a document without a named approver (or owner) gains.
      const signatories = resolvePolicySignatories(set.context);
      const templateOnly = (await renderAllPolicies(set.context)).map((d) => withApprovalBlock(d, signatories));
      const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
      for (const doc of templateOnly) {
        const entry = manifest.documents.find((d) => d.name === `policies/${doc.template_id.replace(/_/g, '-')}.md`)!;
        if (doc.template_id in PLANNING_DRAFT_BANNERS) {
          expect(fs.readFileSync(path.join(dir, entry.name), 'utf8').includes(PLANNING_DRAFT_BANNERS[doc.template_id]), entry.name).toBe(true);
          expect(sha(doc.markdown), entry.name).not.toBe(entry.sha256);
          expect(sha(withPlanningDraftBanner(doc).markdown), entry.name).toBe(entry.sha256);
        } else {
          expect(sha(doc.markdown), entry.name).toBe(entry.sha256);
        }
      }
      // No absolute or workstation paths anywhere in the manifest.
      const text = JSON.stringify(manifest);
      expect(text).not.toContain(dir.replace(/\\/g, '\\\\'));
      expect(manifest.documents.filter((d) => d.name.includes(':') || d.name.includes('\\') || d.name.startsWith('/'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('MG-22 hand-off (b): staleness in the compile warnings', () => {
  test('a discovery fact newer than the CUI answers adds CONSISTENCY_CUI_STALE_VS_DISCOVERY', async () => {
    const s = customer.musterSession;
    expect(compiled.validation.warnings.some((w) => w.startsWith('CONSISTENCY_CUI_STALE_VS_DISCOVERY'))).toBe(false);
    const facts = (s.session.facts as InterviewFact[]).map((f) => ({ ...f }));
    const cuiAnswer = facts.find((f) => f.question_id.startsWith('CUI.') && f.provenance !== 'auto_detected' && f.provenance !== 'discovery');
    const disc = facts.find((f) => f.provenance === 'auto_detected' || f.provenance === 'discovery');
    expect(cuiAnswer && disc).toBeTruthy();
    disc!.recorded_at = '2026-02-01T00:00:00.000Z';
    await db.interview_sessions.put({ ...s.session, id: 'sess-stale', facts });
    const entropy = freezeEntropy();
    try {
      const { compilePlanForSession } = await import('../../planCompileService');
      const stale = await compilePlanForSession('sess-stale');
      expect(stale.validation.warnings.filter((w) => w.startsWith('CONSISTENCY_CUI_STALE_VS_DISCOVERY'))).toHaveLength(1);
      expect(stale.validation.blocking).toEqual(compiled.validation.blocking);
    } finally {
      entropy.restore();
    }
  });
});
