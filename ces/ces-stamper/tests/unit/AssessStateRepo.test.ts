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
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';

// G2: assess-state migrated from per-tenant assess-state.json to the unified, tuple/tenant-keyed
// CesRepository. One record per tenant: collection 'stamper_assess_state', scope { tenantSlug },
// id = slug. Writers (GuiServer.saveAssessState, BaselineProvisioner.persistCaptures) and readers
// (GuiServer.loadAssessState → assess.routes / gaps.routes) all go through this contract. These
// tests pin the round-trip, the read-modify-write merge semantics, and tenant isolation.
const ASSESS_STATE_COLLECTION = 'stamper_assess_state';

describe('assess-state CesRepository round-trip (G2)', () => {
  let tmpDir: string;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-assess-state-'));
    process.env.CES_PIPELINE_ROOT = tmpDir; // unified DB lands at {tmpDir}/ces.db
  });

  afterEach(() => {
    closeAllCesRepositories(); // release SQLite handles before deleting the temp DB (Windows lock)
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  // Mirrors GuiServer.saveAssessState / loadAssessState (the single chokepoint shared by routes).
  function saveAssessState(slug: string, data: object): void {
    getCesRepository().put(ASSESS_STATE_COLLECTION, { id: slug, ces: { tenantSlug: slug }, data });
  }
  function loadAssessState(slug: string): Record<string, any> | null {
    const rec = getCesRepository().get<Record<string, any>>(ASSESS_STATE_COLLECTION, slug, {
      tenantSlug: slug,
    });
    return rec ? rec.data : null;
  }

  it('returns null for an unknown tenant', () => {
    expect(loadAssessState('acme')).toBeNull();
  });

  it('round-trips an assess-state object for a tenant', () => {
    const state = {
      discoveryResults: { 'AC.L2-3.1.1': { verdict: 'MET' } },
      infrastructureModel: 'm365_full_infra',
    };
    saveAssessState('acme', state);
    expect(loadAssessState('acme')).toEqual(state);
  });

  it('preserves existing keys on a read-modify-write merge (persistCaptures semantics)', () => {
    saveAssessState('acme', { discoveryResults: { x: 1 }, infrastructureModel: 'm365_only' });

    // Simulate BaselineProvisioner.persistCaptures: read, set baselineCaptures, write back.
    const existing = loadAssessState('acme') ?? {};
    const merged = {
      ...existing,
      baselineCaptures: { storageAccountName: 'sa1', lastUpdated: '2026-06-13T00:00:00.000Z' },
    };
    saveAssessState('acme', merged);

    const after = loadAssessState('acme');
    expect(after?.discoveryResults).toEqual({ x: 1 }); // pre-existing key survived
    expect(after?.infrastructureModel).toBe('m365_only');
    expect(after?.baselineCaptures).toEqual({
      storageAccountName: 'sa1',
      lastUpdated: '2026-06-13T00:00:00.000Z',
    });
  });

  it('isolates tenants — one tenant cannot read another tenant\'s state', () => {
    saveAssessState('acme', { secret: 'acme-only' });
    saveAssessState('globex', { secret: 'globex-only' });

    expect(loadAssessState('acme')).toEqual({ secret: 'acme-only' });
    expect(loadAssessState('globex')).toEqual({ secret: 'globex-only' });

    // A wrong-tenant scope on the same id must not leak the row.
    const leaked = getCesRepository().get(ASSESS_STATE_COLLECTION, 'acme', { tenantSlug: 'globex' });
    expect(leaked).toBeUndefined();
  });
});
