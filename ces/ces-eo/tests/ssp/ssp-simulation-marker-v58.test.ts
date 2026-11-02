// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer V58 — a simulated (fictional) customer's SSP, SSP DOCX cover and POA&M carry
 * "SIMULATED CUSTOMER (FICTIONAL): <legal name>". The signal is the `simulation` block on the
 * policy_inputs_profile MG-12 envelope (from the customer's organisation content, via Muster).
 * No block -> nothing changes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import JSZip from 'jszip';
import { canonicalSha256 } from 'ces-shared/crypto';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { applyPolicyInputs, applySimulationMarker, simulationMarkingOf } from '../../src/eo/ssp/OdpValueProvider';
import { createDocumentsRouter } from '../../src/eo/server/routers/documents-router';
import { AssessmentStore } from '../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../src/eo/poam/PoamStore';

const REGISTRY = path.resolve(__dirname, '../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const SLUG = 'v58-sim';
const GUID = '00000000-0000-4000-8000-000000005858';
const SNAP = '58585858-0000-4000-8000-000000000001';
const TS = '2026-10-28T10-00-00-000Z';
const SIM = { simulated: true, legalName: 'Testfield Widgets LLC (FICTIONAL)', disclaimer: 'Invented for the simulator; no real company.' };
const MARK = 'SIMULATED CUSTOMER (FICTIONAL): Testfield Widgets LLC (FICTIONAL)';

function profileArtifact(simulation?: unknown) {
  return {
    ces: { artifact: 'policy_inputs_output', version: '1.0.0', generated_on: '2026-10-28', tool: 'policy_inputs', policy_bank_version: '1.0' },
    organization: { legal_name: SIM.legalName, address: { street: '', city: '', state: '', zip: '' }, org_type: 'prime' },
    personnel: [],
    odps: {},
    governance: { policy_effective_date: '2026-12-29', review_cycle_months: 12, fiscal_year_start_month: 1 },
    ...(simulation ? { simulation } : {}),
  };
}

function envelope(kind: string, artifact: unknown) {
  return { cesId: 'ces-sim', schema_id: `muster:${kind}`, artifact_id: `${kind}-id1`, version: '1.0.0', hash_sha256: canonicalSha256(artifact), artifact };
}

/** An MP + the profile envelope (with or without the simulation block) in dir; returns the MP path. */
function writePlans(dir: string, simulation?: unknown): string {
  fs.mkdirSync(dir, { recursive: true });
  const prof = envelope('policy-inputs-output', profileArtifact(simulation));
  const profName = `policy-inputs-profile-${SLUG}-${TS}.json`;
  fs.writeFileSync(path.join(dir, profName), JSON.stringify(prof, null, 2));
  const mp = {
    ces: { artifact: 'manual_mission_plan' },
    inputs: { policy_inputs_profile_ref: { schema_id: prof.schema_id, artifact_id: prof.artifact_id, version: '1.0.0', hash_sha256: prof.hash_sha256, file_name: profName } },
    outputs: { human_readable_mission_plan: { steps: [], milestones: [] } },
  };
  const mpPath = path.join(dir, `manual-mission-plan-${SLUG}-${TS}.json`);
  fs.writeFileSync(mpPath, JSON.stringify(mp, null, 2));
  return mpPath;
}

describe('V58 simulationMarkingOf / applySimulationMarker', () => {
  it('reads the block only when simulated === true with a legal name', () => {
    expect(simulationMarkingOf({ simulation: SIM })).toEqual({ simulated: true, fictional: true, legalName: SIM.legalName, marker: MARK, disclaimer: SIM.disclaimer });
    for (const p of [undefined, null, {}, { simulation: { simulated: false, legalName: 'X' } }, { simulation: { simulated: true, legalName: ' ' } }]) {
      expect(simulationMarkingOf(p as any)).toBeNull();
    }
  });

  it('applyPolicyInputs sets ssp.simulation and prefixes systemName once; without the block the SSP is unchanged', () => {
    const ssp = { systemName: 'Enclave', controlImplementations: [] as any[] };
    applyPolicyInputs(ssp, { simulation: SIM }, null);
    expect(ssp.systemName).toBe(`${MARK} - Enclave`);
    expect((ssp as any).simulation).toMatchObject({ fictional: true, simulated: true, marker: MARK });
    applyPolicyInputs(ssp, { simulation: SIM }, null);
    expect(ssp.systemName).toBe(`${MARK} - Enclave`);
    const plain = { systemName: 'Enclave', controlImplementations: [] as any[] };
    const before = JSON.stringify(plain);
    applyPolicyInputs(plain, { odps: {} }, null);
    applyPolicyInputs(plain, null, null);
    expect(JSON.stringify(plain)).toBe(before);
  });

  it('GC-PKG-2: a systemName equal to the legal name gives the marker alone (no "X - X")', () => {
    const ssp = { systemName: SIM.legalName, controlImplementations: [] as any[] };
    applyPolicyInputs(ssp, { simulation: SIM }, null);
    expect(ssp.systemName).toBe(MARK);
  });

  it('a POA&M (no systemName) gets the simulation object carrying the marker text, and no systemName', () => {
    const poam = { poamId: 'p', items: [] };
    applySimulationMarker(poam, { simulation: SIM });
    expect((poam as any).simulation.fictional).toBe(true);
    expect('systemName' in poam).toBe(false);
    expect(JSON.stringify(poam)).toContain(MARK);
    const plain = { poamId: 'p', items: [] };
    expect(applySimulationMarker(plain, { odps: {} })).toEqual({ poamId: 'p', items: [] });
  });
});

describe('V58 routes: POA&M, SSP and SSP DOCX cover of a simulated customer carry the marker', () => {
  let tmp: string;
  const servers: Server[] = [];
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;
  let simBase: string;
  let plainBase: string;

  async function startRouter(missionPlanPath: string, storageRoot: string, stamperRoot: string, assessmentStore: AssessmentStore): Promise<string> {
    const app = express();
    app.use(express.json());
    app.use(createDocumentsRouter({
      config: { storageRoot, tenantSlug: SLUG, registryPath: REGISTRY, missionPlanPath } as any,
      stamperRoot,
      assessmentStore,
      poamStore: new PoamStore(storageRoot),
      policyStore: { load: () => [], save: () => {} } as any,
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

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v58-route-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', SLUG), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', SLUG, `${SLUG}.json`), JSON.stringify({ tenant: { tenant_id: GUID, domain: `${SLUG}.example.test` } }));
    const snapshot = {
      snapshotId: SNAP, tenantId: GUID, generatedAt: '2026-10-28T10:00:00Z', sprs_score: 33,
      controls: [
        { control_id: 'AC.L2-3.1.8', status: 'met', sources: [] },
        { control_id: 'AU.L2-3.3.1', status: 'not_met', sources: [] },
        { control_id: 'PE.L1-3.10.1', status: 'not_assessed', sources: [] },
      ],
    } as any;
    for (const [name, simulation] of [['sim', SIM], ['plain', undefined]] as const) {
      const storageRoot = path.join(tmp, `eo-storage-${name}`);
      fs.mkdirSync(storageRoot, { recursive: true });
      const store = new AssessmentStore(storageRoot);
      store.save(snapshot);
      const base = await startRouter(writePlans(path.join(tmp, `plans-${name}`), simulation), storageRoot, stamperRoot, store);
      if (name === 'sim') simBase = base; else plainBase = base;
    }
  });

  afterAll(async () => {
    for (const s of servers) { s.closeAllConnections(); await new Promise<void>(resolve => s.close(() => resolve())); }
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  const post = async (b: string, route: string) => {
    const r = await fetch(`${b}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantSlug: SLUG, assessmentId: SNAP }) });
    expect(r.status).toBe(200);
    return r.json();
  };
  const coverText = async (b: string, sspId: string) => {
    const r = await fetch(`${b}/api/ssp/export/${sspId}?tenant=${SLUG}`);
    expect(r.status).toBe(200);
    const xml = await (await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()))).file('word/document.xml')!.async('string');
    return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => `${m.replace(/<[^>]+>/g, '')}\n`).replace(/<[^>]+>/g, '').slice(0, 3000);
  };

  it('simulated: POA&M simulation object, SSP systemName prefix + simulation, DOCX cover line', async () => {
    const poam = await post(simBase, '/api/poam/generate');
    expect(poam.simulation).toMatchObject({ fictional: true, marker: MARK });
    const ssp = await post(simBase, '/api/ssp/generate');
    expect(ssp.systemName.startsWith(`${MARK} - `)).toBe(true);
    expect(ssp.simulation).toMatchObject({ fictional: true, marker: MARK, disclaimer: SIM.disclaimer });
    const cover = await coverText(simBase, ssp.sspId);
    expect(cover).toContain(MARK);
    expect(cover).toContain(SIM.disclaimer);
  });

  it('not simulated: no simulation key, no marker anywhere', async () => {
    const poam = await post(plainBase, '/api/poam/generate');
    expect('simulation' in poam).toBe(false);
    expect(JSON.stringify(poam)).not.toContain('SIMULATED CUSTOMER');
    const ssp = await post(plainBase, '/api/ssp/generate');
    expect('simulation' in ssp).toBe(false);
    expect(JSON.stringify(ssp)).not.toContain('SIMULATED CUSTOMER');
    expect(await coverText(plainBase, ssp.sspId)).not.toContain('SIMULATED CUSTOMER');
  });
});
