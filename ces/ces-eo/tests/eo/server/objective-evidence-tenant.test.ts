// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W0.1 (EO-collection plan; REVIEW P0 #1): the ledger's tenant-suite objectives come only from a
 * test-suite run file for THIS tenant (its `tenant` slug field, plus `tenantId` when the file
 * carries one) that is no older than 30 days. Run 17/19 took objectives from a `edcgov` file for
 * the `muster-partial` ledger.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { selectTenantSuiteRun, loadObjectiveEvidenceFromSuite } from '../../../src/eo/server/eo-router-utils';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('W0.1 selectTenantSuiteRun: tenant-scoped, age-limited', () => {
  let dir: string;
  const write = (file: string, body: Record<string, unknown>) =>
    fs.writeFileSync(path.join(dir, file), JSON.stringify({ summary: {}, results: [], ...body }));

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w01-suite-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('a newer foreign-tenant file never wins over an older file for this tenant', () => {
    write('run-2026-10-20-100000.json', { tenant: 'muster-partial', startedAt: iso(NOW - 7 * DAY) });
    write('run-2026-10-26-100000.json', { tenant: 'edcgov', startedAt: iso(NOW - 1 * DAY) });
    const sel = selectTenantSuiteRun(dir, 'muster-partial', 'guid-mp', 30, NOW);
    expect(sel?.file).toBe('run-2026-10-20-100000.json');
    expect(sel?.run.tenant).toBe('muster-partial');
  });

  it('only foreign-tenant files: undefined (no tenant-suite objectives)', () => {
    write('run-2026-10-26-100000.json', { tenant: 'edcgov', startedAt: iso(NOW - 1 * DAY) });
    expect(selectTenantSuiteRun(dir, 'muster-partial', 'guid-mp', 30, NOW)).toBeUndefined();
  });

  it('only a stale file for this tenant (older than 30 days): undefined', () => {
    write('run-2026-09-01-100000.json', { tenant: 'muster-partial', startedAt: iso(NOW - 31 * DAY) });
    expect(selectTenantSuiteRun(dir, 'muster-partial', 'guid-mp', 30, NOW)).toBeUndefined();
  });

  it('a file without a parseable startedAt is not used', () => {
    write('run-2026-10-26-100000.json', { tenant: 'muster-partial' });
    expect(selectTenantSuiteRun(dir, 'muster-partial', 'guid-mp', 30, NOW)).toBeUndefined();
  });

  it('when the file carries a tenantId it must equal this tenant\'s id too', () => {
    write('run-2026-10-26-100000.json', { tenant: 'muster-partial', tenantId: 'guid-other', startedAt: iso(NOW - DAY) });
    write('run-2026-10-25-100000.json', { tenant: 'muster-partial', tenantId: 'guid-mp', startedAt: iso(NOW - 2 * DAY) });
    expect(selectTenantSuiteRun(dir, 'muster-partial', 'guid-mp', 30, NOW)?.file).toBe('run-2026-10-25-100000.json');
  });

  it('the newest qualifying file wins', () => {
    write('run-2026-10-20-100000.json', { tenant: 'muster-partial', startedAt: iso(NOW - 7 * DAY) });
    write('run-2026-10-25-100000.json', { tenant: 'muster-partial', startedAt: iso(NOW - 2 * DAY) });
    expect(selectTenantSuiteRun(dir, 'muster-partial', 'guid-mp', 30, NOW)?.file).toBe('run-2026-10-25-100000.json');
  });

  it('no slug, or no results directory: undefined', () => {
    expect(selectTenantSuiteRun(dir, '', 'guid-mp', 30, NOW)).toBeUndefined();
    expect(selectTenantSuiteRun(path.join(dir, 'missing'), 'muster-partial', 'guid-mp', 30, NOW)).toBeUndefined();
  });
});

describe('W0.1 loadObjectiveEvidenceFromSuite on the shipped results', () => {
  it('muster-partial gets no objectives from the edcgov run files', () => {
    // Every shipped docs/tenant-tests/results/run-*.json is tenant 'edcgov' (and months old).
    expect(loadObjectiveEvidenceFromSuite('muster-partial', '00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });
});
