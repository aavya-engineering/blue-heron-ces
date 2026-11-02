// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2.0: runCollectors runs C1a, C2, C3, C4 once, one read at a time, and yields one
 * windowed-view signal per collector under its registry endpoint. The real mapper (B15 registry)
 * routes those views to AU.L2-3.3.1, 3.3.2, 3.3.6 and AC.L2-3.1.7, whose evaluators test conditions
 * on the rows. A second run appends zero new rows and yields identical views and verdicts (V14).
 * W2 part 2 registers eight more (C5a, C5b, C6a, C6b, C7a, C7b, C8, C9) after C4; their views reach
 * IR.L2-3.6.1, SI.L2-3.14.6, SI.L2-3.14.7 and RA.L2-3.11.3 (and 3.3.5, 3.11.2, whose evaluators use the
 * real clock and are tested in security-evaluators.test.ts).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ComplianceSignalFetcher } from '../../../src/eo/ingestion/ComplianceSignalFetcher';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { collectorInfo } from '../../../src/eo/evidence/store/collectorIdentity';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index';
import { runCollectors, summarizeCollectRun, REGISTERED_COLLECTORS, COLLECTED } from '../../../src/eo/collect/index';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { ScriptedTenant, CLIENT } from './scriptedTenant';

const TENANT = '00000000-0000-4000-8000-0000000000c0';
const NOW = Date.parse('2026-10-27T12:00:00.000Z');

describe('runCollectors (W2.0 frame)', () => {
  let tmp: string;
  let tenant: ScriptedTenant;
  // Synthetic-customer W2: C10 reads {CES_PIPELINE_ROOT}\ces.db; point it at the temp root (no DB there, so C10 is empty).
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-runner-')); tenant = new ScriptedTenant(); process.env.CES_PIPELINE_ROOT = tmp; });
  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
  });

  const ctx = (nowMs: number) => ({
    storageRoot: tmp, tenantId: TENANT, tenantSlug: 'runner-test', nowMs,
    reader: new ComplianceSignalFetcher(tenant as any, {} as any), identity: collectorInfo(CLIENT),
  });
  const statuses = (signals: any[]) => {
    const byId = new Map(new SignalToControlMapper().mapSignalsToControls(signals, evaluatorRegistry).map((a) => [a.control_id, a]));
    return Object.fromEntries(['AU.L2-3.3.1', 'AU.L2-3.3.2', 'AU.L2-3.3.6', 'AC.L2-3.1.7', 'IR.L2-3.6.1', 'SI.L2-3.14.3', 'SI.L2-3.14.6', 'SI.L2-3.14.7', 'RA.L2-3.11.3']
      .map((id) => [id, byId.get(id)!.status]));
  };

  // W2 part 3 (B15 extension): C8b (Secure Score control profiles) runs after C8; thirteen collectors.
  it('registers C1a, C2, C3, C4, then C5a–C9 (W2 part 2, C8b from part 3), in that order with their cadences', () => {
    expect(REGISTERED_COLLECTORS.map((c) => [c.planId, c.sourceId, c.cadenceMinutes])).toEqual([
      ['C1a', COLLECTED.UNIFIED_AUDIT_LOG, 60],
      ['C2', COLLECTED.DIRECTORY_AUDITS, 15],
      ['C3', COLLECTED.SIGN_INS, 15],
      ['C4', COLLECTED.PIM_ACTIVATIONS, 15],
      ['C5a', COLLECTED.RISK_DETECTIONS, 60],
      ['C5b', COLLECTED.RISKY_USERS, 60],
      ['C6a', COLLECTED.SECURITY_ALERTS, 15],
      ['C6b', COLLECTED.SECURITY_INCIDENTS, 15],
      ['C7a', COLLECTED.TVM_RECENCY, 1440],
      ['C7b', COLLECTED.TVM_VULNERABILITIES, 1440],
      ['C8', COLLECTED.SECURE_SCORES, 1440],
      ['C8b', COLLECTED.SECURE_SCORE_PROFILES, 1440],
      ['C9', COLLECTED.DEVICE_COMPLIANCE, 1440],
      ['C10', COLLECTED.ADMIN_OPS, 15],
    ]);
  });

  it('runs every collector sequentially, records each window, and the mapper routes the views to their controls', async () => {
    const out = await runCollectors(ctx(NOW));
    expect(out.errors).toEqual([]);
    expect(out.results.map((r) => [r.planId, r.status, r.newItems])).toEqual([
      ['C1a', 'success', 5], ['C2', 'success', 4], ['C3', 'success', 2], ['C4', 'success', 2],
      ['C5a', 'success', 2], ['C5b', 'success', 1], ['C6a', 'success', 3], ['C6b', 'success', 2],
      ['C7a', 'success', 2], ['C7b', 'success', 3], ['C8', 'success', 2], ['C8b', 'success', 3], ['C9', 'success', 3],
      ['C10', 'empty', 0],
    ]);
    expect(out.recorded).toBe(7 + 12 + 1); // seven 24-hour UAL windows plus one record per other collector (C10: one empty record)
    // one command in flight at a time, in registration order: Exchange first, then Graph
    expect(tenant.calls.map((c) => c.engine)).toEqual([...Array(7).fill('exchange'), ...Array(12).fill('mgraph')]);
    expect(out.signals.map((s) => [s.signalId, s.source, s.endpoint, s.status])).toEqual([
      ['collect.unifiedAuditLog', 'powershell', 'Search-UnifiedAuditLog', 'success'],
      ['collect.directoryAudits', 'graph', '/auditLogs/directoryAudits', 'success'],
      ['collect.signIns', 'graph', '/auditLogs/signIns', 'success'],
      ['collect.pimActivations', 'graph', '/roleManagement/directory/roleAssignmentScheduleRequests', 'success'],
      ['collect.riskDetections', 'graph', '/identityProtection/riskDetections', 'success'],
      ['collect.riskyUsers', 'graph', '/identityProtection/riskyUsers', 'success'],
      ['collect.securityAlerts', 'graph', '/security/alerts_v2', 'success'],
      ['collect.securityIncidents', 'graph', '/security/incidents', 'success'],
      ['collect.tvmAssessmentRecency', 'graph', '/security/runHuntingQuery', 'success'],
      ['collect.tvmVulnerabilities', 'graph', '/security/runHuntingQuery', 'success'],
      ['collect.secureScores', 'graph', '/security/secureScores', 'success'],
      ['collect.secureScoreControlProfiles', 'graph', '/security/secureScores', 'success'],
      ['collect.deviceCompliance', 'graph', '/deviceManagement/managedDevices', 'success'],
    ]);
    expect(statuses(out.signals)).toEqual({
      'AU.L2-3.3.1': 'met', 'AU.L2-3.3.2': 'met', 'AU.L2-3.3.6': 'met', 'AC.L2-3.1.7': 'met',
      'IR.L2-3.6.1': 'met', 'SI.L2-3.14.3': 'met', 'SI.L2-3.14.6': 'met', 'SI.L2-3.14.7': 'met', 'RA.L2-3.11.3': 'met',
    });

    const store = EvidenceStore.forStorageRoot(tmp, TENANT);
    expect(store.verify().ok).toBe(true);
    expect(store.readManifest()!.recordCount).toBe(20);
    expect(fs.existsSync(path.join(tmp, 'ces.db'))).toBe(false); // C10 never creates the shared DB
  });

  it('a second run appends one empty record per collector, and the views and verdicts are identical (V14)', async () => {
    const first = await runCollectors(ctx(NOW));
    const second = await runCollectors(ctx(NOW + 5 * 60_000));
    expect(second.results.map((r) => [r.planId, r.status, r.newItems, r.records.length])).toEqual(
      REGISTERED_COLLECTORS.map((c) => [c.planId, 'empty', 0, 1]),
    );
    expect(second.signals.map((s) => s.rawData)).toEqual(first.signals.map((s) => s.rawData));
    expect(statuses(second.signals)).toEqual(statuses(first.signals));
    for (const r of second.results) {
      const before = first.results.find((x) => x.planId === r.planId)!.watermarkAfter!;
      expect(Date.parse(r.watermarkAfter!.lastWindowEnd!)).toBeGreaterThan(Date.parse(before.lastWindowEnd!));
      // Snapshot sources (C7b, C8b, C9) date each row by its observation, so their last event time is the
      // new window end; every other source holds its last event time when nothing is new.
      expect(r.watermarkAfter!.lastEventTime).toBe(['C7b', 'C8b', 'C9'].includes(r.planId) ? r.watermarkAfter!.lastWindowEnd : before.lastEventTime);
    }
    expect(EvidenceStore.forStorageRoot(tmp, TENANT).records()).toHaveLength(20 + 14);
  });

  it('summary carries counts and watermarks only (no rows)', async () => {
    const s = summarizeCollectRun(await runCollectors(ctx(NOW)));
    expect(s.collectors[1]).toEqual({
      planId: 'C2', sourceId: 'collect.directoryAudits', status: 'success', windows: 1, newItems: 4, records: 1,
      lastEventTime: '2026-10-27T08:00:00.000Z', lastWindowEnd: '2026-10-27T12:00:00.000Z',
    });
    expect(JSON.stringify(s)).not.toContain('example.test');
  });

  it('an unwritable store is reported, not thrown', async () => {
    const out = await runCollectors({ ...ctx(NOW), tenantId: '../escape' });
    expect(out.errors[0].sourceId).toBe('_store');
    expect(out.signals).toEqual([]);
  });
});
