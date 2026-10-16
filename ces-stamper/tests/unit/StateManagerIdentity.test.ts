// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StateManager } from '../../src/state/StateManager';
import { StamperConfig } from '../../src/config/StamperConfig';
import { CesIdentity } from '../../src/types/schema.types';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';

// G1/T2 identity propagation onto PlanExecutionState — now persisted via the unified
// CesRepository (G2) instead of execution-state.json. Behavioral assertions are unchanged.
describe('StateManager CES identity propagation', () => {
  let tmpDir: string;
  let config: StamperConfig;
  const TENANT = 'guid-tenant-1';
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  const ces: CesIdentity = {
    cesId: 'ces-abc',
    customerId: 42,
    siBaselineId: 7,
    customerName: 'Acme Corp',
    tenantSlug: 'acme',
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-sm-ces-'));
    process.env.CES_PIPELINE_ROOT = tmpDir; // unified DB lands at {tmpDir}/ces.db
    config = StamperConfig.fromTenantConfig({
      dryRun: true,
      tenantId: TENANT,
      storageRoot: tmpDir,
      stateDir: path.join(tmpDir, 'state'),
      evidenceDir: path.join(tmpDir, 'evidence'),
      logDir: path.join(tmpDir, 'logs'),
    });
  });

  afterEach(() => {
    closeAllCesRepositories(); // release SQLite handles before deleting the temp DB (Windows lock)
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  // Seed an execution-state record the way StateManager stores it (tenant-scoped by tenantId).
  function seedState(planId: string, data: Record<string, unknown>) {
    getCesRepository().put('stamper_execution_state', {
      id: planId,
      ces: { tenantId: TENANT },
      data,
    });
  }

  it('carries `ces` on freshly initialized state when provided', () => {
    const sm = new StateManager(config, 'plan-with-ces', ces);
    expect(sm.getState().ces).toEqual(ces);
  });

  it('leaves `ces` undefined when none provided and does not throw', () => {
    const sm = new StateManager(config, 'plan-without-ces');
    expect(sm.getState().ces).toBeUndefined();
  });

  it('backfills `ces` on resume when stored state lacks it', () => {
    const planId = 'plan-resume-backfill';
    seedState(planId, { plan_id: planId, status: 'pending', started_at: 'x', tasks: {}, prechecks_passed: false });
    const sm = new StateManager(config, planId, ces);
    expect(sm.getState().ces).toEqual(ces);
  });

  it('preserves stored `ces` over the provided one on resume', () => {
    const planId = 'plan-resume-preserve';
    const onDiskCes: CesIdentity = { cesId: 'ces-original', customerId: 1 };
    seedState(planId, {
      plan_id: planId, status: 'pending', started_at: 'x', tasks: {}, prechecks_passed: false, ces: onDiskCes,
    });
    const sm = new StateManager(config, planId, ces);
    expect(sm.getState().ces).toEqual(onDiskCes);
  });

  it('round-trips state mutations through the repository', () => {
    const planId = 'plan-roundtrip';
    const sm = new StateManager(config, planId, ces);
    sm.startTask('t1');
    sm.completeTask('t1', { ok: true });
    // A fresh manager for the same plan resumes the persisted state.
    const resumed = new StateManager(config, planId, ces);
    expect(resumed.getTaskStatus('t1')).toBe('completed');
  });
});
