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
import { SprsCalculator } from '../../../src/eo/sprs/SprsCalculator';
import { ControlAssessor } from '../../../src/eo/assessment/ControlAssessor';
import type { ControlAssessment } from 'ces-shared/types/controls';
import { makeRealShapeRow } from './helpers/makeRealShapeRow';

const TENANT_ID = 'sprs-test';
const COLLECTION = 'adminops_evidence';
// Real reference id (NIST 3.13.1 is an L1 practice). The pre-FX-EO5 test used 'SC.L2-3.13.1',
// which is not in the controls reference — its local status copy hid that.
const CONTROL_ID = 'SC.L1-3.13.1';

// FX-EO5: statuses come from the PRODUCTION ControlAssessor.merge (the same call /api/assess
// makes with the AdminOps sources merged into the evidence-source map) — no local copy of the
// "positive source => met" rule.
const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');

function buildAssessments(
  sources: Map<string, any[]>,
): ControlAssessment[] {
  return new ControlAssessor(controlsRefPath, []).merge(TENANT_ID, [], [], [], [], sources).controls;
}

function statusOf(assessments: ControlAssessment[]): ControlAssessment['status'] | undefined {
  return assessments.find(c => c.control_id === CONTROL_ID)?.status;
}

describe('EXIT-7: non-crediting rows never move SPRS', () => {
  let tmpDir: string;
  let dbPath: string;
  let sprs: SprsCalculator;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprs-integrity-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    dbPath = path.join(tmpDir, 'ces.db');
    sprs = new SprsCalculator();
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  function readSources(): Map<string, any[]> {
    const reader = new AdminOpsEvidenceReader(TENANT_ID, dbPath);
    return reader.read().sources;
  }

  function scoreFromSources(sources: Map<string, any[]>): number {
    const assessments = buildAssessments(sources);
    return sprs.calculate(assessments).score;
  }

  it('live-only baseline: control is met, producing a specific SPRS score', () => {
    const row = makeRealShapeRow({
      tenantId: TENANT_ID,
      commandId: 'F-13',
      controlIds: [CONTROL_ID],
    });
    getCesRepository(dbPath).put(COLLECTION, row);

    const sources = readSources();
    const assessments = buildAssessments(sources);
    expect(statusOf(assessments)).toBe('met');
    const score = sprs.calculate(assessments).score;
    expect(typeof score).toBe('number');
  });

  it('adding a legacy row does NOT change the score', () => {
    const repo = getCesRepository(dbPath);
    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-13', id: 'F-13:live',
      controlIds: [CONTROL_ID],
    }));

    const baseScore = scoreFromSources(readSources());

    repo.put(COLLECTION, {
      id: 'legacy-row',
      ces: { tenantId: TENANT_ID },
      data: {
        evidence: {
          metadata: { timestamp: '2026-01-01T00:00:00Z', controlIds: [CONTROL_ID], sha256Hash: 'old' },
          outcome: 'automated_success',
          complianceVerdict: 'SAT',
        },
        metadata: { commandId: 'F-99', tenantId: TENANT_ID },
      },
    });
    closeAllCesRepositories();

    const afterScore = scoreFromSources(readSources());
    expect(afterScore).toBe(baseScore);
  });

  it('adding a denied row does NOT change the score', () => {
    const repo = getCesRepository(dbPath);
    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-13', id: 'F-13:live',
      controlIds: [CONTROL_ID],
    }));

    const baseScore = scoreFromSources(readSources());

    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-13', id: 'F-13:denied',
      outcome: 'denied_cmmc', verdict: 'NOT_APPLICABLE',
      controlIds: [CONTROL_ID], executionId: 'exec-denied',
    }));
    closeAllCesRepositories();

    const afterScore = scoreFromSources(readSources());
    expect(afterScore).toBe(baseScore);
  });

  it('adding a dry-run row does NOT change the score', () => {
    const repo = getCesRepository(dbPath);
    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-13', id: 'F-13:live',
      controlIds: [CONTROL_ID],
    }));

    const baseScore = scoreFromSources(readSources());

    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-13', id: 'F-13:dryrun',
      mode: 'dry_run', dryRun: true, outcome: 'dry_run',
      controlIds: [CONTROL_ID], executionId: 'exec-dry',
    }));
    closeAllCesRepositories();

    const afterScore = scoreFromSources(readSources());
    expect(afterScore).toBe(baseScore);
  });

  it('adding a failed row does NOT change the score', () => {
    const repo = getCesRepository(dbPath);
    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-13', id: 'F-13:live',
      controlIds: [CONTROL_ID],
    }));

    const baseScore = scoreFromSources(readSources());

    repo.put(COLLECTION, makeRealShapeRow({
      tenantId: TENANT_ID, commandId: 'F-13', id: 'F-13:failed',
      outcome: 'failed_no_remediation', verdict: 'NOT_APPLICABLE',
      controlIds: [CONTROL_ID], executionId: 'exec-fail',
    }));
    closeAllCesRepositories();

    const afterScore = scoreFromSources(readSources());
    expect(afterScore).toBe(baseScore);
  });

  // E5/EXIT-7 (stronger form): each non-crediting row ALONE leaves the control unmet and the
  // score identical to an empty store — the "add next to a live row" cases above cannot
  // distinguish a non-crediting row from a redundant crediting one.
  const legacyRow = () => ({
    id: 'legacy-alone',
    ces: { tenantId: TENANT_ID },
    data: {
      evidence: {
        metadata: { timestamp: '2026-01-01T00:00:00Z', controlIds: [CONTROL_ID], sha256Hash: 'old' },
        outcome: 'automated_success',
        complianceVerdict: 'SAT',
      },
      metadata: { commandId: 'F-99', tenantId: TENANT_ID },
    },
  });
  const cases: Array<[string, () => any]> = [
    ['legacy SAT (no mode/contractVersion)', legacyRow],
    ['dry-run', () => makeRealShapeRow({ tenantId: TENANT_ID, controlIds: [CONTROL_ID], mode: 'dry_run', dryRun: true, outcome: 'dry_run' })],
    ['failed', () => makeRealShapeRow({ tenantId: TENANT_ID, controlIds: [CONTROL_ID], outcome: 'failed_no_remediation' })],
    ['denied_cmmc', () => makeRealShapeRow({ tenantId: TENANT_ID, controlIds: [CONTROL_ID], outcome: 'denied_cmmc' })],
    ['denied_cui', () => makeRealShapeRow({ tenantId: TENANT_ID, controlIds: [CONTROL_ID], outcome: 'denied_cui' })],
    ['blocked_pending_approval', () => makeRealShapeRow({ tenantId: TENANT_ID, controlIds: [CONTROL_ID], outcome: 'blocked_pending_approval' })],
    ['strict-parse-failed (unknown contractVersion, SAT)', () => makeRealShapeRow({ tenantId: TENANT_ID, controlIds: [CONTROL_ID], contractVersion: '9.9.9' })],
    ['strict-parse-failed (sticky dry-run + executed/SAT)', () => makeRealShapeRow({ tenantId: TENANT_ID, controlIds: [CONTROL_ID], innerOverrides: { mode: 'dry_run', dryRun: true } })],
  ];

  it.each(cases)('%s row alone: control not met, score equals empty-store score', (_label, make) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const emptyScore = scoreFromSources(new Map());
    const liveScore = scoreFromSources(new Map([[CONTROL_ID, [{ type: 'adminops_execution', timestamp: 't', detail: 'x', result: 'imported' }]]]));
    expect(liveScore).not.toBe(emptyScore); // the control's weight is visible to SPRS

    getCesRepository(dbPath).put(COLLECTION, make());
    const sources = readSources();
    expect(sources.has(CONTROL_ID)).toBe(false);
    expect(statusOf(buildAssessments(sources))).not.toBe('met');
    expect(scoreFromSources(sources)).toBe(emptyScore);
    warn.mockRestore();
  });
});
