// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FLOW-2 (gap closure): Stamper evidence-metadata ids carry an attempt suffix so a retry never
// overwrites; stamper_evidence_metadata and stamper_change_log are WORM; execution state stays
// mutable. Covers the execute, resume, retry and rollback paths at the store level.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EvidenceStore } from '../../src/evidence/EvidenceStore';
import { EvidenceCollector } from '../../src/evidence/EvidenceCollector';
import { StateManager, ChangeLogEntry } from '../../src/state/StateManager';
import { StamperConfig } from '../../src/config/StamperConfig';
import { RollbackHandler } from '../../src/rollback/RollbackHandler';
import { deriveInverseOp } from '../../src/rollback/InverseOps';
import { getCesRepository, closeAllCesRepositories, CesWormError, type CesRepository } from 'ces-shared/persistence/node';

const META = 'stamper_evidence_metadata';
const CHANGELOG = 'stamper_change_log';
const STATE = 'stamper_execution_state';
const FIDO2_SET = "Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2' -Body (@{state='enabled'} | ConvertTo-Json) -ContentType 'application/json'";

describe('FLOW-2: Stamper WORM evidence metadata and change log', () => {
  let tmpDir: string;
  let config: StamperConfig;
  let repo: CesRepository;
  let puts: Array<{ collection: string; id: string }>;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-flow2-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    // Enforce WORM on the FLOW-2 collections explicitly, so this test does not depend on whether the
    // ces-shared dist has been rebuilt with the new DEFAULT_WORM_COLLECTIONS. The stores share this
    // memoized instance (same {CES_PIPELINE_ROOT}/ces.db key).
    repo = getCesRepository(undefined, { wormCollections: ['adminops_evidence', 'eo_approver_token_mints', META, CHANGELOG] });
    puts = [];
    const realPut = repo.put.bind(repo);
    repo.put = ((collection: string, input: any) => {
      puts.push({ collection, id: input.id });
      return realPut(collection, input);
    }) as CesRepository['put'];
    config = StamperConfig.fromTenantConfig({
      dryRun: true,
      tenantId: 'tenant-a',
      storageRoot: tmpDir,
      stateDir: path.join(tmpDir, 'state'),
      evidenceDir: path.join(tmpDir, 'evidence'),
      logDir: path.join(tmpDir, 'logs'),
    } as any);
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  const wormIds = (coll: string) => puts.filter((p) => p.collection === coll).map((p) => p.id);
  const expectNoDoubleWrite = () => {
    for (const coll of [META, CHANGELOG]) {
      const ids = wormIds(coll);
      expect(new Set(ids).size).toBe(ids.length);
    }
  };
  const store = (es: EvidenceStore, task: string, artifact: string, content: string) =>
    es.storeArtifact('plan-1', task, artifact, 'config_export', ['AC.L2-3.1.1'], 'stamper', 365, content, 'application/json');
  const entry = (task: string, n: number): ChangeLogEntry => ({
    control_id: 'AC.L2-3.1.1', task_id: task, timestamp: new Date().toISOString(), operator: 'x',
    before: { n }, after: { n: n + 1 }, dry_run: true,
  });
  const scope = { tenantId: 'tenant-a' };

  it('execute: first store writes `<plan>:<task>:<artifact>#1`; one change-log row per entry', async () => {
    const es = new EvidenceStore(config);
    const sm = new StateManager(config, 'plan-1');
    sm.startTask('t1');
    await store(es, 't1', 'a1', '{"v":1}');
    sm.writeChangeLog(entry('t1', 0));
    sm.completeTask('t1');

    expect(wormIds(META)).toEqual(['plan-1:t1:a1#1']);
    expect(wormIds(CHANGELOG)).toEqual(['plan-1:0']);
    expect(es.getArtifactMetadata('plan-1', 't1', 'a1')?.sha256_hash).toBeDefined();
    expectNoDoubleWrite();
  });

  it('retry: a second store of the same artifact writes #2, keeps #1 intact, and readers see the latest', async () => {
    const es = new EvidenceStore(config);
    const first = await store(es, 't1', 'a1', '{"v":1}');
    await store(es, 't1', 'a2', '{"other":true}');
    const second = await store(es, 't1', 'a1', '{"v":2}');

    expect(wormIds(META)).toEqual(['plan-1:t1:a1#1', 'plan-1:t1:a2#1', 'plan-1:t1:a1#2']);
    expect(first.sha256_hash).not.toBe(second.sha256_hash);
    // attempt 1 untouched
    expect((repo.get<any>(META, 'plan-1:t1:a1#1', scope)?.data).sha256_hash).toBe(first.sha256_hash);
    // readers: latest attempt per artifact
    expect(es.getArtifactMetadata('plan-1', 't1', 'a1')?.sha256_hash).toBe(second.sha256_hash);
    expect(await es.verifyArtifactIntegrity('plan-1', 't1', 'a1')).toBe(true);
    expect(es.getArtifactContent('plan-1', 't1', 'a1')?.toString()).toBe('{"v":2}');
    const collector = new EvidenceCollector(config, es);
    expect(collector.getTaskEvidence('plan-1', 't1').map((m) => m.sha256_hash).sort())
      .toEqual([second.sha256_hash, (es.getArtifactMetadata('plan-1', 't1', 'a2'))!.sha256_hash].sort());
    // execution-report evidence count stays one per artifact
    expect(collector.getPlanEvidence('plan-1')).toHaveLength(2);
    expectNoDoubleWrite();
  });

  it('resume: fresh StateManager / EvidenceStore instances on the same plan never reuse an id', async () => {
    const es1 = new EvidenceStore(config);
    const sm1 = new StateManager(config, 'plan-1');
    sm1.startTask('t1');
    await store(es1, 't1', 'a1', '{"v":1}');
    sm1.writeChangeLog(entry('t1', 0));
    sm1.writeChangeLog(entry('t1', 1));
    sm1.failTask('t1', 'boom');
    sm1.updatePlanStatus('failed');

    // Resume (new process-equivalent instances), plus a stale instance still alive.
    const es2 = new EvidenceStore(config);
    const sm2 = new StateManager(config, 'plan-1');
    expect(sm2.canResume()).toBe(true);
    sm2.startTask('t1');
    await store(es2, 't1', 'a1', '{"v":2}');
    sm2.writeChangeLog(entry('t1', 2));
    sm1.writeChangeLog(entry('t1', 3)); // stale instance: its counter is behind, must skip ahead
    sm2.completeTask('t1');
    sm2.updatePlanStatus('completed');

    expect(wormIds(META)).toEqual(['plan-1:t1:a1#1', 'plan-1:t1:a1#2']);
    expect(wormIds(CHANGELOG)).toEqual(['plan-1:0', 'plan-1:1', 'plan-1:2', 'plan-1:3']);
    expect(repo.list<any>(CHANGELOG, scope).map((r) => r.data.before.n)).toEqual([0, 1, 2, 3]);
    // execution state is mutable: same id rewritten, status moved on
    expect(repo.get<any>(STATE, 'plan-1', scope)?.data.status).toBe('completed');
    expect(es2.getArtifactMetadata('plan-1', 't1', 'a1')).toEqual(
      expect.objectContaining({ sha256_hash: (repo.get<any>(META, 'plan-1:t1:a1#2', scope)!.data).sha256_hash }),
    );
    expectNoDoubleWrite();
  });

  it('rollback: reversing applied ops mutates execution state only; WORM rows unchanged', async () => {
    const es = new EvidenceStore(config);
    const sm = new StateManager(config, 'plan-1');
    sm.startTask('t1');
    await store(es, 't1', 'a1', '{"v":1}');
    sm.writeChangeLog(entry('t1', 0));
    sm.recordAppliedOps('t1', [deriveInverseOp({
      sub_command_id: 'IA.L2-3.5.3.fido2-enable', engine: 'mgraph', applied_command: FIDO2_SET,
      pre_state: '{"id":"Fido2","state":"disabled"}', post_state: '{"id":"Fido2","state":"enabled"}',
    })]);
    sm.completeTask('t1');
    const before = {
      meta: repo.list(META, scope).map((r) => [r.id, JSON.stringify(r.data), r.updatedAt]),
      log: repo.list(CHANGELOG, scope).map((r) => [r.id, JSON.stringify(r.data), r.updatedAt]),
    };

    const handler = new RollbackHandler(config, sm);
    const report = await handler.rollbackAppliedOps(
      async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      { STACKSIM_SERVER_URL: 'http://127.0.0.1:4390' },
    );
    expect(report.reversed).toHaveLength(1);
    expect(repo.get<any>(STATE, 'plan-1', scope)?.data.applied_ops[0].reversed_at).toBeDefined();
    expect(repo.list(META, scope).map((r) => [r.id, JSON.stringify(r.data), r.updatedAt])).toEqual(before.meta);
    expect(repo.list(CHANGELOG, scope).map((r) => [r.id, JSON.stringify(r.data), r.updatedAt])).toEqual(before.log);
    expectNoDoubleWrite();
  });

  it('an overwrite probe on either WORM collection is refused', async () => {
    const es = new EvidenceStore(config);
    const sm = new StateManager(config, 'plan-1');
    await store(es, 't1', 'a1', '{"v":1}');
    sm.writeChangeLog(entry('t1', 0));
    const ces = { tenantId: 'tenant-a' };
    expect(() => repo.put(META, { id: 'plan-1:t1:a1#1', ces, data: { sha256_hash: 'x' } })).toThrow(CesWormError);
    expect(() => repo.update(META, 'plan-1:t1:a1#1', scope, { sha256_hash: 'x' })).toThrow(CesWormError);
    expect(() => repo.delete(CHANGELOG, 'plan-1:0', scope)).toThrow(CesWormError);
    expect(() => repo.put(CHANGELOG, { id: 'plan-1:0', ces, data: {} })).toThrow(CesWormError);
  });

  it('a legacy un-suffixed row is still found, and a newer attempt supersedes it', async () => {
    repo.put(META, { id: 'plan-1:t1:a1', ces: { tenantId: 'tenant-a' }, data: { artifact_id: 'a1', sha256_hash: 'legacy' } });
    const es = new EvidenceStore(config);
    expect(es.getArtifactMetadata('plan-1', 't1', 'a1')?.sha256_hash).toBe('legacy');
    expect(es.listPlanArtifacts('plan-1')).toHaveLength(1);
    const next = await store(es, 't1', 'a1', '{"v":2}');
    expect(wormIds(META)).toContain('plan-1:t1:a1#1');
    expect(es.getArtifactMetadata('plan-1', 't1', 'a1')?.sha256_hash).toBe(next.sha256_hash);
    expect(es.listPlanArtifacts('plan-1').map((m) => m.sha256_hash)).toEqual([next.sha256_hash]);
  });
});
