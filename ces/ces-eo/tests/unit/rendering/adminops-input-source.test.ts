// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-EO3 — the `adminops` InputSourceResolver provider honours the requested path
 * (tenant, control, command …) instead of returning every loaded row. Rows come from
 * AO's committed golden via the production AdminOpsEvidenceReader (temp ces.db).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceReader } from '../../../src/eo/adminops/AdminOpsEvidenceReader';
import { InputSourceResolver } from '../../../src/eo/rendering/InputSourceResolver';
import { makeRealShapeRow } from '../../eo/adminops/helpers/makeRealShapeRow';

const TENANT = 'fxeo3-tenant-guid';

describe('FX-EO3: adminops input source filters by path', () => {
  let tmp: string;
  let resolver: InputSourceResolver;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-eo3-'));
    const dbPath = path.join(tmp, 'ces.db');
    const repo = getCesRepository(dbPath);
    repo.put('adminops_evidence', makeRealShapeRow({ tenantId: TENANT, id: 'r1', commandId: 'F-13', controlIds: ['SC.L2-3.13.1'], correlationId: 'c-1' }));
    repo.put('adminops_evidence', makeRealShapeRow({ tenantId: TENANT, id: 'r2', commandId: 'A-02', controlIds: ['AC.L2-3.1.1', 'PS.L2-3.9.2'], correlationId: 'c-2' }));
    repo.put('adminops_evidence', makeRealShapeRow({ tenantId: TENANT, id: 'r3', commandId: 'A-02', controlIds: ['PS.L2-3.9.2'], mode: 'dry_run', dryRun: true, outcome: 'dry_run', correlationId: 'c-3' }));
    resolver = new InputSourceResolver();
    resolver.setAdminOpsData(new AdminOpsEvidenceReader(TENANT, dbPath).read());
  });

  afterAll(() => {
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ids = (r: any) => (r.data as any[]).map(ev => `${ev.commandId}/${ev.correlationId}`).sort();

  it('two different command paths return only their own rows', () => {
    const f13 = resolver.resolveInputSource('adminops.evidence[command=F-13]');
    const a02 = resolver.resolveInputSource('adminops.evidence[command=A-02]');
    expect(f13.resolved).toBe(true);
    expect(a02.resolved).toBe(true);
    expect((f13 as any).data.map((e: any) => e.commandId)).toEqual(['F-13']);
    expect((a02 as any).data.every((e: any) => e.commandId === 'A-02')).toBe(true);
    expect((a02 as any).data).toHaveLength(2);
  });

  it('control filter (dotted control id) returns only rows covering that control', () => {
    const sc = resolver.resolveInputSource('adminops.evidence[control=SC.L2-3.13.1]');
    const ps = resolver.resolveInputSource('adminops.evidence[control=PS.L2-3.9.2]');
    expect(ids(sc)).toEqual(['F-13/c-1']);
    expect(ids(ps)).toEqual(['A-02/c-2', 'A-02/c-3']);
  });

  it('combined filters (command + mode, tenant + control) intersect', () => {
    expect(ids(resolver.resolveInputSource('adminops.evidence[command=A-02,mode=live]'))).toEqual(['A-02/c-2']);
    expect(ids(resolver.resolveInputSource(`adminops.evidence[tenant=${TENANT}][control=AC.L2-3.1.1]`))).toEqual(['A-02/c-2']);
  });

  it('a path matching nothing, another tenant, an unknown key or an unknown collection never returns rows', () => {
    expect(resolver.resolveInputSource('adminops.evidence[command=Z-99]').resolved).toBe(false);
    expect(resolver.resolveInputSource('adminops.evidence[tenant=other-tenant]').resolved).toBe(false);
    expect(resolver.resolveInputSource('adminops.evidence[user=x]').resolved).toBe(false);
    expect(resolver.resolveInputSource('adminops.change_log').resolved).toBe(false);
    expect(resolver.resolveInputSource('adminops.evidence[command]').resolved).toBe(false);
  });

  it('the bare collection path returns all loaded rows for the (already tenant-scoped) read', () => {
    const all = resolver.resolveInputSource('adminops.evidence');
    expect(all.resolved).toBe(true);
    expect((all as any).data).toHaveLength(3);
  });
});
