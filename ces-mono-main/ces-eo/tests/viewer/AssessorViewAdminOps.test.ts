// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W4-EO1 (AE-R5) — AdminOps section in the assessor view.
 *
 * Seeds AO's committed golden rows (ces-ao/test/fixtures/contract/adminops-evidence-rows.golden.json,
 * read-only by path) into a temp ces.db exactly as AO persists them, for tenant A, plus the same 9
 * rows retagged to tenant B. Then:
 *   1. real AdminOpsEvidenceReader(A) -> composeAssessorView -> renderAssessorHtml: every golden row
 *      type renders with the right kind and evidence flag, and no tenant B row appears;
 *   2. the composer itself drops another tenant's rows when handed a mixed list (defence in depth);
 *   3. the real /assessor and /api/assessor-view routes, for two tenants, each show only their own rows.
 * Sim only: no network.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceReader } from '../../src/eo/adminops/AdminOpsEvidenceReader';
import { composeAssessorView, composeAdminOpsSection, classifyAdminOpsRow, type AdminOpsRowKind } from '../../src/eo/viewer/AssessorViewComposer';
import { renderAssessorHtml } from '../../src/eo/viewer/AssessorViewHtml';
import { loadAoGolden } from '../eo/adminops/helpers/makeRealShapeRow';
import { createAssessmentRouter } from '../../src/eo/server/routers/assessment-router';
import { AssessmentStore } from '../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../src/eo/poam/PoamStore';
import { PoamLedgerStore } from '../../src/eo/poam/PoamLedgerStore';
import { PolicyStore } from '../../src/eo/policies/PolicyStore';
import { PersonnelStore } from '../../src/eo/personnel/PersonnelStore';
import { TrainingStore } from '../../src/eo/personnel/TrainingStore';
import { ScreeningElementStore } from '../../src/eo/personnel/ScreeningElementStore';
import type { DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger';

jest.mock('../../src/eo/rendering/RenderOrchestrator', () => ({
  RenderOrchestrator: class { setAdminOpsData() {} async orchestrateRenders() { return new Map(); } },
}));

const COLLECTION = 'adminops_evidence';
const TENANT_A = 'golden-sim-tenant';           // the golden's own tenant id
const TENANT_B = 'w4eo1-other-tenant-guid';

/** Expected kind per golden key. The dry_run+deny row is the discriminating case: preview, never a denial. */
const EXPECTED: Record<string, AdminOpsRowKind> = {
  success: 'executed',
  failure: 'failed',
  denied_cmmc: 'denied',
  denied_cui: 'denied',
  dry_run: 'preview',
  'dry_run+deny': 'preview',
  pending: 'pending',
  rejected: 'rejected',
  'sim-only refusal': 'denied',
};

function retag(data: any, tenantId: string, slug: string): any {
  const d = JSON.parse(JSON.stringify(data));
  d.metadata.tenantId = tenantId;
  d.metadata.tenantSlug = slug;
  d.metadata.commandId = `B-${d.metadata.commandId}`;
  d.metadata.correlationId = `b-${d.metadata.correlationId}`;
  d.ces = { ...(d.ces ?? {}), tenantId };
  return d;
}

function seed(dbPath: string, tenantBId = TENANT_B, tenantBSlug = 'w4eo1-b') {
  const golden = loadAoGolden() as Record<string, any>;
  const repo = getCesRepository(dbPath);
  for (const [key, data] of Object.entries(golden)) {
    repo.put(COLLECTION, { id: `golden:A:${key}`, ces: { tenantId: data.metadata.tenantId }, data });
    const b = retag(data, tenantBId, tenantBSlug);
    repo.put(COLLECTION, { id: `golden:B:${key}`, ces: { tenantId: tenantBId }, data: b });
  }
  return golden;
}

function ledgerFor(tenantId: string): DeterminationLedger {
  const ctl = (controlId: string) => ({
    controlId, status: 'not_met', weight: 5, noPoam: false, disposition: undefined,
    objectives: [{ objectiveId: `${controlId}[a]` }],
  });
  return {
    tenantId, generatedAt: '2026-09-27T12:00:00Z',
    objectives: [],
    controls: [ctl('AC.L1-3.1.1'), ctl('AC.L2-3.1.5'), ctl('SC.L2-3.13.16')],
    deficiencies: [],
    summary: {
      objectivesTotal: 0, objectivesSatisfied: 0, objectivesOther: 0, objectivesNotAssessed: 0,
      deficiencies: 0, certificationBlockers: 0, controlsMet: 0, controlsNotMet: 3, controlsPartial: 0, controlsNotAssessed: 0,
    },
  } as unknown as DeterminationLedger;
}

function aoRowsInHtml(html: string): Array<{ kind: string; evidence: string; command: string }> {
  const out: Array<{ kind: string; evidence: string; command: string }> = [];
  const re = /<tr class="ao-row[^"]*" data-ao-kind="([^"]+)" data-ao-evidence="([^"]+)" data-command="([^"]+)">/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ kind: m[1], evidence: m[2], command: m[3] });
  return out;
}

describe('W4-EO1: AdminOps section in the assessor view (AO golden rows, tenant-scoped)', () => {
  let tmp: string;
  let dbPath: string;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w4eo1-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    dbPath = path.join(tmp, 'ces.db');
  });
  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  it('renders every golden row type with the right label and evidence flag; no other-tenant row appears', () => {
    const golden = seed(dbPath);
    const parsed = new AdminOpsEvidenceReader(TENANT_A, dbPath).read().parsed;
    expect(parsed).toHaveLength(Object.keys(golden).length);

    const view = composeAssessorView({ ledger: ledgerFor(TENANT_A), adminOps: parsed, adminOpsTenantId: TENANT_A });
    const html = renderAssessorHtml(view);
    const rows = aoRowsInHtml(html);

    expect(rows).toHaveLength(Object.keys(golden).length);
    for (const [key, data] of Object.entries(golden)) {
      const row = rows.find(r => r.command === data.metadata.commandId);
      expect({ key, kind: row?.kind }).toEqual({ key, kind: EXPECTED[key] });
      // Only the live executed SAT row is evidence; dry runs, denials, pending, rejected, failed are not.
      expect({ key, evidence: row?.evidence }).toEqual({ key, evidence: EXPECTED[key] === 'executed' ? 'true' : 'false' });
    }
    // Labels a C3PAO reads.
    expect(html).toContain('Dry run — preview only, not evidence');
    expect(html).toContain('Denied — not evidence');
    expect(html).toContain('Pending approval — not evidence');
    expect(html).toContain('Approval rejected — not evidence');
    expect(html).toContain('Executed (live) — evidence');
    // Row details: correlation id, timestamp, approver (on the rejected row).
    expect(html).toContain(golden.success.metadata.correlationId);
    expect(html).toContain(golden.success.metadata.timestamp);
    expect(html).toContain(golden.rejected.metadata.approverUPN);
    // Tenant B: never.
    expect(html).not.toMatch(/B-GOLD-/);
    expect(html).not.toContain('b-golden-corr');
    expect(html).not.toContain(TENANT_B);
  });

  it('attaches rows to controls by practice number (AO says AC.L2-3.1.1, the ledger AC.L1-3.1.1)', () => {
    seed(dbPath);
    const parsed = new AdminOpsEvidenceReader(TENANT_A, dbPath).read().parsed;
    const view = composeAssessorView({ ledger: ledgerFor(TENANT_A), adminOps: parsed, adminOpsTenantId: TENANT_A });
    const c311 = view.controls.find(c => c.controlId === 'AC.L1-3.1.1')!;
    expect(c311.adminOps!.map(r => r.commandId).sort()).toEqual(
      ['GOLD-DRY-RUN', 'GOLD-FAILURE', 'GOLD-PENDING', 'GOLD-SIM-ONLY-REFUSAL', 'GOLD-SUCCESS']);
    const c3116 = view.controls.find(c => c.controlId === 'SC.L2-3.13.16')!;
    expect(c3116.adminOps!.map(r => r.kind)).toEqual(['denied']);
  });

  it('composer drops another tenant\'s rows when handed a mixed list', () => {
    seed(dbPath);
    const a = new AdminOpsEvidenceReader(TENANT_A, dbPath).read().parsed;
    const b = new AdminOpsEvidenceReader(TENANT_B, dbPath).read().parsed;
    expect(b).toHaveLength(a.length);
    const section = composeAdminOpsSection([...a, ...b], TENANT_A);
    expect(section.rows).toHaveLength(a.length);
    expect(section.excludedOtherTenant).toBe(b.length);
    expect(section.rows.every(r => !r.commandId.startsWith('B-'))).toBe(true);
    expect(section.counts).toEqual({ executed: 1, executed_not_sat: 0, failed: 1, denied: 3, pending: 1, rejected: 1, preview: 2 });
  });

  it('classification: a sticky dry run is a preview whatever its outcome', () => {
    const golden = loadAoGolden() as Record<string, any>;
    seed(dbPath);
    const parsed = new AdminOpsEvidenceReader(TENANT_A, dbPath).read().parsed;
    const dryDeny = parsed.find(p => p.commandId === golden['dry_run+deny'].metadata.commandId)!;
    expect(dryDeny.outcome).toBe('denied_cmmc');
    expect(classifyAdminOpsRow(dryDeny)).toBe('preview');
  });

  it('no AdminOps input: the section is absent (never faked)', () => {
    const html = renderAssessorHtml(composeAssessorView({ ledger: ledgerFor(TENANT_A) }));
    expect(html).not.toContain('id="adminops"');
  });
});

describe('W4-EO1: /assessor and /api/assessor-view show only the requested tenant\'s AdminOps rows', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;
  const REGISTRY = path.resolve(__dirname, '../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
  const T = {
    A: { slug: 'w4eo1-a', guid: TENANT_A, snap: 'a4e01aaa-0000-4000-8000-000000000001' },
    B: { slug: 'w4eo1-b', guid: TENANT_B, snap: 'b4e01bbb-0000-4000-8000-000000000001' },
  };

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w4eo1-route-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    // Default ces.db under the pipeline root — the path the production reader uses.
    seed(path.join(process.env.CES_PIPELINE_ROOT, 'ces.db'), T.B.guid, T.B.slug);
    closeAllCesRepositories();

    const stamperRoot = path.join(tmp, 'stamper');
    for (const t of [T.A, T.B]) {
      const dir = path.join(stamperRoot, 'plan-data', t.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${t.slug}.json`), JSON.stringify({ tenant: { tenant_id: t.guid } }));
    }
    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const assessmentStore = new AssessmentStore(storageRoot);
    for (const t of [T.A, T.B]) {
      assessmentStore.save({
        snapshotId: t.snap, tenantId: t.guid, generatedAt: '2026-09-27T10:00:00Z', sprs_score: 100,
        controls_met: 0, controls_not_met: 1, controls_partial: 0, controls_not_assessed: 0,
        controls: [{ control_id: 'AC.L1-3.1.1', nist_ref: '3.1.1', status: 'not_met', sources: [], evidenceArtifactIds: [] }],
      } as any);
    }
    const config = { storageRoot, tenantSlug: T.A.slug, registryPath: REGISTRY } as any;
    const app = express();
    app.use(express.json());
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: () => null,
      assessmentStore, poamStore: new PoamStore(storageRoot), poamLedgerStore: new PoamLedgerStore(storageRoot),
      policyStore: new PolicyStore(storageRoot), personnelStore: new PersonnelStore(storageRoot),
      screeningElementStore: new ScreeningElementStore(storageRoot),
      trainingStore: new TrainingStore(storageRoot),
    } as any));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  it('each tenant sees its own 9 golden rows and none of the other tenant\'s', async () => {
    for (const t of [T.A, T.B]) {
      const r = await fetch(`${base}/assessor?tenant=${t.slug}`);
      expect(r.status).toBe(200);
      const rows = aoRowsInHtml(await r.text());
      expect(rows).toHaveLength(9);
      const isB = (c: string) => c.startsWith('B-');
      expect({ t: t.slug, allOwn: rows.every(x => (t === T.B) === isB(x.command)) }).toEqual({ t: t.slug, allOwn: true });
      expect(rows.filter(x => x.evidence === 'true')).toHaveLength(1);

      const view = await (await fetch(`${base}/api/assessor-view?tenant=${t.slug}`)).json();
      expect(view.adminOps.rows).toHaveLength(9);
      expect(view.adminOps.excludedOtherTenant).toBe(0);
    }
  });
});
