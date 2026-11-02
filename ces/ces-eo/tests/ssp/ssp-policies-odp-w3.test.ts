// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W3.3b (B9) — the MG-12 policy envelopes reach the SSP as documentation only.
 *   - EoConfig.loadPolicyEnvelopes finds the profile and manifest by the MP's inputs refs and
 *     accepts an envelope only when canonicalSha256(artifact) matches the ref.
 *   - applyPolicyInputs fills odpValues (PI.ODP.001-015, each "defaulted" or "supplied"),
 *     relatedPolicies by family, and a policy + MP-step citation on every not_assessed control.
 *   - The SSP route applies them and never writes them to policyStore; statuses are unchanged.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { canonicalSha256 } from 'ces-shared/crypto';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { loadPolicyEnvelopes } from '../../src/eo/config/EoConfig';
import { applyPolicyInputs, POLICY_ODPS, FAMILY_POLICY_BASES } from '../../src/eo/ssp/OdpValueProvider';
import { createDocumentsRouter } from '../../src/eo/server/routers/documents-router';
import { AssessmentStore } from '../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../src/eo/poam/PoamStore';

const REGISTRY = path.resolve(__dirname, '../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const SLUG = 'w33b-policy';
const GUID = '00000000-0000-4000-8000-0000000033bb';
const SNAP = '33bbbbbb-0000-4000-8000-000000000001';
const TS = '2026-10-27T19-49-12-823Z';

const BASES = Object.values(FAMILY_POLICY_BASES).flat();

function profileArtifact(overrides: Record<string, string | number> = {}) {
  const odps: Record<string, string | number> = {};
  for (const def of Object.values(POLICY_ODPS)) odps[def.key] = def.recommended;
  return {
    ces: { artifact: 'policy_inputs_output', version: '1.0.0', generated_on: '2026-10-27', tool: 'policy_inputs', policy_bank_version: '1.0' },
    organization: { legal_name: 'Sim Org', address: { street: '', city: '', state: '', zip: '' }, org_type: 'prime' },
    personnel: [],
    odps: { ...odps, ...overrides },
    governance: { policy_effective_date: '2026-12-29', review_cycle_months: 12, fiscal_year_start_month: 1 },
  };
}

function manifestArtifact() {
  return {
    ces: { artifact: 'policy_set_manifest', version: '1.0.0', generated_on: '2026-10-27' },
    documents: BASES.map((b, i) => ({ name: `policies/${b}.md`, sha256: i.toString(16).padStart(64, 'a') })),
  };
}

function envelope(kind: string, artifact: unknown) {
  return { cesId: 'ces-sim', schema_id: `muster:${kind}`, artifact_id: `${kind}-id1`, version: '1.0.0', hash_sha256: canonicalSha256(artifact), artifact };
}

/** Writes an MP + both envelopes into dir; returns the MP path. */
function writePlans(dir: string, opts: { tamper?: boolean; noFileName?: boolean; profileOverrides?: Record<string, string | number> } = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const prof = envelope('policy-inputs-output', profileArtifact(opts.profileOverrides));
  const man = envelope('policy-set-manifest', manifestArtifact());
  const profName = `policy-inputs-profile-${SLUG}-${TS}.json`;
  const manName = `policy-set-manifest-${SLUG}-${TS}.json`;
  const writtenMan = opts.tamper ? { ...man, artifact: { ...man.artifact, documents: man.artifact.documents.slice(1) } } : man;
  fs.writeFileSync(path.join(dir, profName), JSON.stringify(prof, null, 2));
  fs.writeFileSync(path.join(dir, manName), JSON.stringify(writtenMan, null, 2));
  const ref = (e: { artifact_id: string; hash_sha256: string; schema_id: string }, file: string) => ({
    schema_id: e.schema_id, artifact_id: e.artifact_id, version: '1.0.0', hash_sha256: e.hash_sha256,
    ...(opts.noFileName ? {} : { file_name: file }),
  });
  const mp = {
    ces: { artifact: 'manual_mission_plan' },
    inputs: { policy_inputs_profile_ref: ref(prof, profName), policy_set_manifest_ref: ref(man, manName) },
    outputs: {
      human_readable_mission_plan: {
        steps: [
          { id: 'step_task_PE.L1-3.10.1_x', title: 'Physical Access Limitation (PE.L1-3.10.1)', owner_role: 'compliance_engineer', control_coverage: [{ control_id: 'PE.L1-3.10.1' }] },
          { id: 'step_task_IR.L2-3.6.2_x', title: 'Incident Tracking and Reporting (IR.L2-3.6.2)', owner_role: 'compliance_engineer', control_coverage: [{ control_id: 'IR.L2-3.6.2' }] },
        ],
        milestones: [],
      },
    },
  };
  const mpPath = path.join(dir, `manual-mission-plan-${SLUG}-${TS}.json`);
  fs.writeFileSync(mpPath, JSON.stringify(mp, null, 2));
  return mpPath;
}

describe('W3.3b loadPolicyEnvelopes: by MP ref, hash verified', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w33b-env-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('loads both envelopes named by the refs when the hashes match', () => {
    const env = loadPolicyEnvelopes(writePlans(tmp));
    expect(env.problems).toEqual([]);
    expect(path.basename(env.profilePath!)).toBe(`policy-inputs-profile-${SLUG}-${TS}.json`);
    expect(path.basename(env.manifestPath!)).toBe(`policy-set-manifest-${SLUG}-${TS}.json`);
    expect((env.profile as any).odps.account_lockout_threshold).toBe(3);
    expect((env.manifest as any).documents).toHaveLength(20);
  });

  it('refuses an envelope whose artifact no longer matches the ref hash', () => {
    const env = loadPolicyEnvelopes(writePlans(tmp, { tamper: true }));
    expect(env.manifest).toBeUndefined();
    expect(env.manifestPath).toBeUndefined();
    expect(env.profile).toBeDefined();
    expect(env.problems.join(' ')).toMatch(/policy-set-manifest-.*hash or id does not match inputs\.policy_set_manifest_ref/);
  });

  it('falls back to the latest file by prefix when a ref has no file_name', () => {
    const env = loadPolicyEnvelopes(writePlans(tmp, { noFileName: true }));
    expect(env.problems).toEqual([]);
    expect(env.profile).toBeDefined();
    expect(env.manifest).toBeDefined();
  });

  it('reports absent refs and a missing MP without throwing', () => {
    expect(loadPolicyEnvelopes(undefined).problems).toEqual(['no mission plan']);
    const mpPath = path.join(tmp, 'manual-mission-plan-x.json');
    fs.writeFileSync(mpPath, JSON.stringify({ inputs: {} }));
    const env = loadPolicyEnvelopes(mpPath);
    expect(env.profile).toBeUndefined();
    expect(env.problems).toEqual(['MP inputs.policy_inputs_profile_ref absent', 'MP inputs.policy_set_manifest_ref absent']);
  });
});

describe('W3.3b applyPolicyInputs', () => {
  const control = (control_id: string, nist_ref: string, family: string, status: string) => ({
    control_id, nist_ref, family, status, implementationNarrative: 'REQUIRES MANUAL INPUT', relatedPolicies: [] as any[], odpValues: [] as any[],
  });

  it('labels defaulted vs supplied, fills relatedPolicies by family, cites policy and MP step; idempotent', () => {
    const ssp = { controlImplementations: [
      control('AC.L2-3.1.8', '3.1.8', 'AC', 'met'),
      control('PE.L1-3.10.1', '3.10.1', 'PE', 'not_assessed'),
      control('ZZ.L2-9.9.9', '9.9.9', 'ZZ', 'not_assessed'),
    ] };
    const mp = { outputs: { human_readable_mission_plan: { steps: [{ id: 'step_task_PE.L1-3.10.1_x', title: 'Physical', control_coverage: [{ control_id: 'PE.L1-3.10.1' }] }] } } };
    applyPolicyInputs(ssp, profileArtifact({ account_lockout_threshold: 5 }), manifestArtifact(), mp);
    const [ac, pe, zz] = ssp.controlImplementations;
    expect(ac.odpValues.map((o) => o.parameter)).toEqual(['PI.ODP.001 account_lockout_threshold', 'PI.ODP.002 account_lockout_duration_minutes']);
    expect(ac.odpValues[0]).toMatchObject({ value: '5', source: 'policy-inputs profile: supplied' });
    expect(ac.odpValues[1].source).toMatch(/^policy-inputs profile: defaulted/);
    expect(ac.relatedPolicies.map((p: any) => p.title)).toEqual(['Access Control Policy']);
    expect(ac.implementationNarrative).toBe('REQUIRES MANUAL INPUT'); // met: no citation
    expect(pe.implementationNarrative).toContain('Governed by Physical Protection Policy (policies/physical-protection-policy.md).');
    expect(pe.implementationNarrative).toContain('Mission Plan step step_task_PE.L1-3.10.1_x (Physical)');
    expect(zz.implementationNarrative).toBe('REQUIRES MANUAL INPUT'); // no family policy, no step: nothing invented

    const before = JSON.stringify(ssp);
    applyPolicyInputs(ssp, profileArtifact({ account_lockout_threshold: 5 }), manifestArtifact(), mp);
    expect(JSON.stringify(ssp)).toBe(before);
  });

  it('adds nothing without envelopes', () => {
    const ssp = { controlImplementations: [control('AC.L2-3.1.8', '3.1.8', 'AC', 'not_assessed')] };
    const before = JSON.stringify(ssp);
    applyPolicyInputs(ssp, undefined, undefined, undefined);
    expect(JSON.stringify(ssp)).toBe(before);
  });
});

describe('W3.3b SSP route: envelopes in, statuses unchanged, never into policyStore', () => {
  let tmp: string;
  let base: string;
  const servers: Server[] = [];
  const policyStoreCalls: string[] = [];
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  async function startRouter(missionPlanPath: string | undefined, storageRoot: string, stamperRoot: string, assessmentStore: AssessmentStore): Promise<string> {
    const app = express();
    app.use(express.json());
    app.use(createDocumentsRouter({
      config: { storageRoot, tenantSlug: SLUG, registryPath: REGISTRY, missionPlanPath } as any,
      stamperRoot,
      assessmentStore,
      poamStore: new PoamStore(storageRoot),
      policyStore: {
        load: (slug: string) => { policyStoreCalls.push(`load:${slug}`); return []; },
        save: () => { policyStoreCalls.push('save'); },
      } as any,
      personnelStore: { load: () => [], getReadiness: () => ({ ps_3_9_1: 'not_assessed', ps_3_9_2: 'not_assessed' }) } as any,
      trainingStore: {} as any,
      screeningElementStore: {} as any,
      riskAssessmentStore: { loadConfig: () => null, loadRegister: () => ({ entries: [] }), listSnapshots: () => [], loadSnapshot: () => null } as any,
      cleanupService: {} as any,
    }));
    const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  let baseWithout: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w33b-route-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', SLUG), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', SLUG, `${SLUG}.json`), JSON.stringify({ tenant: { tenant_id: GUID, domain: `${SLUG}.example.test` } }));
    const mpPath = writePlans(path.join(stamperRoot, 'plan-data', SLUG, 'plans'));
    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const assessmentStore = new AssessmentStore(storageRoot);
    assessmentStore.save({
      snapshotId: SNAP, tenantId: GUID, generatedAt: '2026-10-27T19:53:00Z', sprs_score: 33,
      controls: [
        { control_id: 'AC.L2-3.1.8', status: 'met', sources: [] },
        { control_id: 'AU.L2-3.3.1', status: 'not_met', sources: [] },
        { control_id: 'PE.L1-3.10.1', status: 'not_assessed', sources: [] },
        { control_id: 'IR.L2-3.6.2', status: 'not_assessed', sources: [] },
      ],
    } as any);
    base = await startRouter(mpPath, storageRoot, stamperRoot, assessmentStore);
    // The same tenant and snapshot with no MP (so no envelopes), for the status comparison.
    fs.mkdirSync(path.join(tmp, 'eo-storage-2'), { recursive: true });
    baseWithout = await startRouter(undefined, path.join(tmp, 'eo-storage-2'), stamperRoot, assessmentStore);
  });

  afterAll(async () => {
    for (const s of servers) { s.closeAllConnections(); await new Promise<void>(resolve => s.close(() => resolve())); }
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  const generate = async (b: string) => {
    const r = await fetch(`${b}/api/ssp/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantSlug: SLUG, assessmentId: SNAP }) });
    expect(r.status).toBe(200);
    return r.json();
  };

  it('fills 15 ODPs, related policies by family, and not-assessed citations; statuses identical', async () => {
    const withEnv = await generate(base);
    const without = await generate(baseWithout);

    const statuses = (s: any) => s.controlImplementations.map((c: any) => `${c.control_id}:${c.status}`);
    expect(statuses(withEnv)).toEqual(statuses(without));
    expect(withEnv.controlImplementations.find((c: any) => c.control_id === 'PE.L1-3.10.1').status).toBe('not_assessed');

    // §9 dedupes odpValues by parameter: exactly the 15 PI.ODP rows, all defaulted here.
    const params = new Map<string, string>();
    for (const c of withEnv.controlImplementations) for (const o of c.odpValues) if (o.parameter.startsWith('PI.ODP.')) params.set(o.parameter, o.source);
    expect([...params.keys()].map((p) => p.slice(0, 10)).sort()).toEqual(Object.keys(POLICY_ODPS).sort());
    expect([...params.values()].every((s) => s.startsWith('policy-inputs profile: defaulted'))).toBe(true);
    expect(without.controlImplementations.some((c: any) => c.odpValues.some((o: any) => o.parameter.startsWith('PI.ODP.')))).toBe(false);

    // relatedPolicies by family on every control whose family has a rendered policy.
    for (const c of withEnv.controlImplementations) {
      const expected = (FAMILY_POLICY_BASES[c.family] ?? []).length;
      expect(c.relatedPolicies.length).toBeGreaterThanOrEqual(expected);
      if (expected > 0) expect(c.relatedPolicies.some((p: any) => /^policies\/.+\.md \(Muster-rendered/.test(p.excerpt))).toBe(true);
    }

    // Every not_assessed control cites its family policy; the two with an MP step cite the step.
    const na = withEnv.controlImplementations.filter((c: any) => c.status === 'not_assessed');
    expect(na.length).toBeGreaterThan(0);
    for (const c of na) {
      if ((FAMILY_POLICY_BASES[c.family] ?? []).length > 0) expect(c.implementationNarrative).toContain('**Policy and plan reference:** Governed by');
    }
    const ir = withEnv.controlImplementations.find((c: any) => c.control_id === 'IR.L2-3.6.2');
    expect(ir.implementationNarrative).toContain('Incident Response Policy (policies/incident-response-policy.md), Incident Response Plan (policies/incident-response-plan.md)');
    expect(ir.implementationNarrative).toContain('Mission Plan step step_task_IR.L2-3.6.2_x');

    // Policies never reach the policy store (F7): only loads, no save.
    expect(policyStoreCalls.includes('save')).toBe(false);
  });
});
