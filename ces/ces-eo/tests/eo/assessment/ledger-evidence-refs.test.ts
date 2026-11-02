// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.5: the store side of the ledger's per-objective provenance. DeterminationLedger.ts
 * is not edited in W1 (another agent holds it); these functions are what its one-line call uses.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvidenceStore, evidenceRefsForObjective, evidenceRefsLookup } from '../../../src/eo/evidence/store/EvidenceStore';

const A = '00000000-0000-4000-8000-0000000005aa';
const B = '00000000-0000-4000-8000-0000000005bb';

describe('W1.5 evidence refs per objective', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-refs-'));
    const add = (tenant: string, sourceId: string, collectedAt: string, controlIds: string[], objectiveIds: string[]) =>
      EvidenceStore.forStorageRoot(tmp, tenant).append({
        tenantId: tenant, tenantSlug: 's', sourceId, collector: { name: 'n', version: 'v', identity: 'i' }, host: 'h',
        endpoint: `/${sourceId}`, query: 'q', window: { start: null, end: collectedAt }, collectedAt, status: 'success', itemCount: 1,
        payload: { sourceId, collectedAt }, controlIds, objectiveIds,
      });
    add(A, 'directoryAudits', '2026-10-27T01:00:00.000Z', ['AU.L2-3.3.2'], ['AU.L2-3.3.2[a]', 'AU.L2-3.3.2[b]']);
    add(A, 'signInLogs', '2026-10-27T01:00:00.000Z', ['AU.L2-3.3.2'], ['AU.L2-3.3.2[a]', 'AU.L2-3.3.2[b]']);
    add(A, 'directoryAudits', '2026-10-27T02:00:00.000Z', ['AU.L2-3.3.2'], ['AU.L2-3.3.2[a]', 'AU.L2-3.3.2[b]']);
    add(B, 'directoryAudits', '2026-10-27T03:00:00.000Z', ['AU.L2-3.3.2'], ['AU.L2-3.3.2[a]']);
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('names the newest record per source behind an objective, with tenant, sha256 and time', () => {
    const refs = evidenceRefsForObjective(tmp, A, 'AU.L2-3.3.2[a]');
    expect(refs.map((r) => [r.sourceId, r.collectedAt])).toEqual([
      ['directoryAudits', '2026-10-27T02:00:00.000Z'],
      ['signInLogs', '2026-10-27T01:00:00.000Z'],
    ]);
    const store = EvidenceStore.forStorageRoot(tmp, A);
    for (const ref of refs) {
      expect(ref.tenantId).toBe(A);
      const rec = store.get(ref.recordId)!;
      expect(ref.sha256).toBe(rec.payloadSha256);
    }
  });

  it('never returns another tenant\'s record; unknown objective, no store and a bad tenant id give []', () => {
    expect(evidenceRefsForObjective(tmp, B, 'AU.L2-3.3.2[a]').map((r) => r.tenantId)).toEqual([B]);
    expect(evidenceRefsForObjective(tmp, A, 'AC.L1-3.1.1[a]')).toEqual([]);
    expect(evidenceRefsForObjective(tmp, '00000000-0000-4000-8000-000000000000', 'AU.L2-3.3.2[a]')).toEqual([]);
    expect(evidenceRefsForObjective(tmp, '../x', 'AU.L2-3.3.2[a]')).toEqual([]);
  });

  it('the lookup reads the log once and answers many objectives the same way', () => {
    const lookup = evidenceRefsLookup(tmp, A);
    expect(lookup('AU.L2-3.3.2[b]')).toEqual(evidenceRefsForObjective(tmp, A, 'AU.L2-3.3.2[b]'));
    expect(lookup('AU.L2-3.3.2[b]')).toHaveLength(2);
  });
});
