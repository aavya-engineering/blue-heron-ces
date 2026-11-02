// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceReader } from '../../../src/eo/adminops/AdminOpsEvidenceReader';
import { makeRealShapeRow, loadAoGolden, AO_GOLDEN_PATH } from './helpers/makeRealShapeRow';

const TENANT_ID = 'realshape-test';
const COLLECTION = 'adminops_evidence';

describe('E1: AdminOpsEvidenceReader reads AO real persisted shape', () => {
  let tmpDir: string;
  let dbPath: string;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-realshape-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    dbPath = path.join(tmpDir, 'ces.db');
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  it('all 8 round-trip fields are present after parsing a real-shape row', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
      tenantSlug: 'my-tenant',
      tenantKind: 'gcch',
      correlationId: 'corr-abc',
      requestorUPN: 'admin@tenant.onmicrosoft.us',
      approverUPN: 'approver@tenant.onmicrosoft.us',
      approvalId: 'appr-123',
      contractVersion: '1.0.0',
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.parsed).toHaveLength(1);
    const ev = result.parsed[0];
    expect(ev.commandId).toBe('F-13');
    expect(ev.tenantSlug).toBe('my-tenant');
    expect(ev.tenantKind).toBe('gcch');
    expect(ev.correlationId).toBe('corr-abc');
    expect(ev.requestorUPN).toBe('admin@tenant.onmicrosoft.us');
    expect(ev.approverUPN).toBe('approver@tenant.onmicrosoft.us');
    expect(ev.approvalId).toBe('appr-123');
    expect(ev.contractVersion).toBe('1.0.0');
  });

  it('outer metadata wins over inner metadata for shared fields', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-14',
      timestamp: '2026-09-27T10:00:00Z',
      innerOverrides: { timestamp: '2026-09-27T09:59:00Z' },
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.parsed[0].timestamp).toBe('2026-09-27T10:00:00Z');
  });

  it('conflict: outer dryRun:false but inner mode:dry_run → excluded (sticky → F-4 strict-parse failure, logged)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
      mode: 'live',
      dryRun: false,
      outcome: 'automated_success',
      verdict: 'SAT',
      innerOverrides: { mode: 'dry_run', dryRun: true },
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    // Sticky dry-run forces mode:'dry_run'; the contract row still says outcome:'executed'.
    // The shared schema's F-4 refine rejects that — excluded, logged, never credited.
    expect(result.stats.unparsed).toBe(1);
    expect(result.stats.live).toBe(0);
    expect(result.parsed).toHaveLength(0);
    expect(result.sources.size).toBe(0);
    expect(warn.mock.calls.some(c => String(c[0]).includes('strict contract parse failed'))).toBe(true);
    warn.mockRestore();
  });

  it('reverse conflict: outer mode:dry_run but inner dryRun:false → stays excluded (sticky)', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
      mode: 'dry_run',
      dryRun: true,
      outcome: 'dry_run',
      innerOverrides: { dryRun: false, mode: 'live' },
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.stats.dryRun).toBe(1);
    expect(result.sources.size).toBe(0);
  });

  it('Tier-3 pending row (mode:dry_run, outcome:blocked_pending_approval) in parsed with correlationId', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'A-02',
      mode: 'dry_run',
      dryRun: true,
      outcome: 'blocked_pending_approval',
      verdict: 'NOT_APPLICABLE',
      correlationId: 'tier3-pending-001',
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    const result = reader.read();

    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0].correlationId).toBe('tier3-pending-001');
    expect(result.parsed[0].dryRun).toBe(true);
    expect(result.sources.size).toBe(0);
  });
});


// ─── E5: AO's committed golden, read-only, through the real reader ─────────────

describe('E5: every AO golden row parses through AdminOpsEvidenceReader (shared contract)', () => {
  const GOLDEN_TENANT = 'golden-sim-tenant';
  let tmpDir: string;
  let dbPath: string;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-golden-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    dbPath = path.join(tmpDir, 'ces.db');
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  function seedGolden(): Record<string, any> {
    const golden = loadAoGolden();
    const repo = getCesRepository(dbPath);
    for (const [key, data] of Object.entries(golden)) {
      // Seed exactly as AO persists: { id, ces, data } with the golden `data` verbatim.
      repo.put(COLLECTION, { id: `golden:${key}`, ces: { tenantId: data.metadata.tenantId }, data });
    }
    return golden;
  }

  it('golden is read from ces-ao by path (not copied into ces-eo)', () => {
    expect(AO_GOLDEN_PATH.split(path.sep).join('/')).toMatch(/\/ces-ao\/test\/fixtures\/contract\/adminops-evidence-rows\.golden\.json$/);
    expect(Object.keys(loadAoGolden())).toHaveLength(9);
  });

  it('all 9 golden rows strict-parse; none legacy; only the live executed SAT row credits', () => {
    const golden = seedGolden();
    const result = new AdminOpsEvidenceReader(GOLDEN_TENANT, dbPath).read();

    expect(result.stats.total).toBe(9);
    expect(result.stats.unparsed).toBe(0);
    expect(result.stats.legacy).toBe(0);
    expect(result.parsed).toHaveLength(9);
    expect(result.stats.live).toBe(1);
    expect(result.stats.dryRun).toBe(2);   // dry_run, dry_run+deny
    expect(result.stats.denied).toBe(3);   // denied_cmmc, denied_cui, sim-only refusal
    expect(result.stats.blocked).toBe(2);  // pending, rejected
    expect(result.stats.failed).toBe(1);   // failure

    // Exactly one credited source: the golden success row's control, typed adminops_execution.
    expect([...result.sources.keys()]).toEqual(golden.success.metadata.controlIds);
    const src = result.sources.get(golden.success.metadata.controlIds[0])!;
    expect(src).toHaveLength(1);
    expect(src[0].type).toBe('adminops_execution');
    expect(src[0].result).toBe('imported');
    expect(src[0].detail).toContain('GOLD-SUCCESS');
  });

  it('each golden row round-trips its contract fields (incl. approval fields on rejected)', () => {
    const golden = seedGolden();
    const result = new AdminOpsEvidenceReader(GOLDEN_TENANT, dbPath).read();
    for (const data of Object.values(golden)) {
      const m = data.metadata;
      const ev = result.parsed.find(p => p.commandId === m.commandId)!;
      expect(ev).toBeDefined();
      expect(ev.contractVersion).toBe(m.contractVersion);
      expect(ev.tenantSlug).toBe(m.tenantSlug);
      expect(ev.tenantKind).toBe(m.tenantKind);
      expect(ev.correlationId).toBe(m.correlationId);
      expect(ev.requestorUPN).toBe(m.requestorUPN);
      expect(ev.approverUPN).toBe(m.approverUPN);
      expect(ev.approvalId).toBe(m.approvalId);
      expect(ev.outcome).toBe(m.outcome);
      expect(ev.mode).toBe(m.mode);
      expect(ev.verdict).toBe(m.verdict);
    }
    const rejected = result.parsed.find(p => p.commandId === 'GOLD-REJECTED')!;
    expect(rejected.approverUPN).toBeDefined();
    expect(rejected.approvalId).toBeDefined();
  });

  it('golden dry-run rows are listed (findable by correlationId) but never credit', () => {
    seedGolden();
    const result = new AdminOpsEvidenceReader(GOLDEN_TENANT, dbPath).read();
    const dry = result.parsed.find(p => p.correlationId === 'golden-corr-gold-dry-run')!;
    expect(dry.dryRun).toBe(true);
    const dryDeny = result.parsed.find(p => p.correlationId === 'golden-corr-gold-dry-run-deny')!;
    expect(dryDeny.outcome).toBe('denied_cmmc');
    expect(dryDeny.mode).toBe('dry_run');
    // AC.L2-3.1.5 is only carried by non-live rows (dry_run+deny, denied_cmmc, rejected).
    expect(result.sources.has('AC.L2-3.1.5')).toBe(false);
  });

  it('a deliberately corrupted golden row is excluded and logged, never credited', () => {
    const golden = loadAoGolden();
    const corrupt = structuredClone(golden.success);
    corrupt.metadata.contractVersion = '9.9.9';
    corrupt.metadata.controlIds = ['AU.L2-3.3.1'];
    corrupt.evidence.metadata.controlIds = ['AU.L2-3.3.1'];
    getCesRepository(dbPath).put(COLLECTION, { id: 'golden:corrupt', ces: { tenantId: GOLDEN_TENANT }, data: corrupt });

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = new AdminOpsEvidenceReader(GOLDEN_TENANT, dbPath).read();
    expect(result.stats.unparsed).toBe(1);
    expect(result.parsed).toHaveLength(0);
    expect(result.sources.size).toBe(0);
    const logged = warn.mock.calls.map(c => String(c[0])).find(l => l.includes('strict contract parse failed'));
    expect(logged).toBeDefined();
    expect(logged).toContain('contractVersion');
    expect(logged).not.toContain('requestor@'); // no UPNs in logs
    warn.mockRestore();
  });

  it('SAT smuggled onto a golden dry-run row fails strict parse (SPRS-integrity refine)', () => {
    const golden = loadAoGolden();
    const bad = structuredClone(golden.dry_run);
    bad.metadata.verdict = 'SAT';
    bad.evidence.complianceVerdict = 'SAT';
    getCesRepository(dbPath).put(COLLECTION, { id: 'golden:dry-sat', ces: { tenantId: GOLDEN_TENANT }, data: bad });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = new AdminOpsEvidenceReader(GOLDEN_TENANT, dbPath).read();
    expect(result.stats.unparsed).toBe(1);
    expect(result.sources.size).toBe(0);
    warn.mockRestore();
  });
});
