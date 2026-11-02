// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GC-PKG-1 (gap closure, assessor package slice 1): POST /api/package/build refuses (409) unless the SSP, the
 * POA&M and the tenant's latest assessment snapshot share one snapshotId and each is within
 * EO_PACKAGE_MAX_AGE_HOURS (default 24). A DOCX export failure fails the build unless `allowPartial` is set,
 * which the cover sheet then shows. Drives the REAL evidence router over HTTP (express + listen(0) + fetch).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createEvidenceRouter, packageRefusalReason, packageMaxAgeHours } from '../../../src/eo/server/routers/evidence-router';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { PoamGenerator } from '../../../src/eo/poam/PoamGenerator';

const _require = createRequire(__filename);
const JSZip = _require('jszip');

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-30T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('GC-PKG-1 packageMaxAgeHours', () => {
  test('default 24; a positive number is used; anything else falls back to 24', () => {
    expect(packageMaxAgeHours({})).toBe(24);
    expect(packageMaxAgeHours({ EO_PACKAGE_MAX_AGE_HOURS: '6' })).toBe(6);
    expect(packageMaxAgeHours({ EO_PACKAGE_MAX_AGE_HOURS: '0.5' })).toBe(0.5);
    for (const bad of ['0', '-3', 'abc', '']) expect(packageMaxAgeHours({ EO_PACKAGE_MAX_AGE_HOURS: bad })).toBe(24);
  });
});

describe('GC-PKG-1 packageRefusalReason', () => {
  const snap = { snapshotId: 'snap-1', generatedAt: iso(NOW - HOUR) };
  const doc = (snapshotId: unknown, at = iso(NOW - HOUR)) => ({ snapshotId, generatedAt: at });
  const reason = (ssp: any, poam: any, maxAgeHours = 24, snapshot = snap) => packageRefusalReason({ snapshot, ssp, poam, maxAgeHours, now: NOW });

  test('one snapshot, all fresh: no refusal', () => {
    expect(reason(doc('snap-1'), doc('snap-1'))).toBeNull();
  });

  test('a missing SSP or POA&M is refused', () => {
    expect(reason(null, doc('snap-1'))).toMatch(/no readable SSP/);
    expect(reason(doc('snap-1'), null)).toMatch(/no POA&M/);
  });

  test('a mismatched or unrecorded snapshotId is refused, naming each id', () => {
    const r = reason(doc('snap-0'), doc(undefined));
    expect(r).toMatch(/^snapshot mismatch: the latest assessment snapshot is snap-1/);
    expect(r).toContain('the SSP records snapshot snap-0');
    expect(r).toContain('the POA&M records snapshot none');
  });

  test('any of the three older than the limit is refused; the boundary itself passes', () => {
    expect(reason(doc('snap-1', iso(NOW - 25 * HOUR)), doc('snap-1'))).toMatch(/the SSP was generated at .*older than EO_PACKAGE_MAX_AGE_HOURS=24/);
    expect(reason(doc('snap-1'), doc('snap-1', iso(NOW - 25 * HOUR)))).toMatch(/the POA&M was generated/);
    expect(reason(doc('snap-1'), doc('snap-1'), 24, { snapshotId: 'snap-1', generatedAt: iso(NOW - 25 * HOUR) })).toMatch(/the assessment snapshot was generated/);
    expect(reason(doc('snap-1', iso(NOW - 24 * HOUR)), doc('snap-1'))).toBeNull();
    expect(reason(doc('snap-1', iso(NOW - 3 * HOUR)), doc('snap-1'), 2)).toMatch(/EO_PACKAGE_MAX_AGE_HOURS=2/);
    expect(reason(doc('snap-1', 'not-a-date'), doc('snap-1'))).toMatch(/the SSP has no valid generatedAt/);
  });
});

describe('GC-PKG-1 PoamGenerator stamps the snapshotId (CONTRACT CHANGE)', () => {
  test('the POA&M records the snapshot it was generated from', () => {
    const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
    const weightsPath = _require.resolve('ces-shared/data/sprs-weights');
    const poam = new PoamGenerator(controlsRefPath, weightsPath, []).generate({
      assessment: { snapshotId: 'snap-poam', tenantId: 't', generatedAt: iso(NOW), controls: [] } as any,
    });
    expect(poam.snapshotId).toBe('snap-poam');
  });
});

describe('GC-PKG-1 POST /api/package/build', () => {
  let tmp: string;
  let storageRoot: string;
  let server: Server;
  let base: string;
  const poams: Record<string, unknown> = {};
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;
  const prevMaxAge = process.env.EO_PACKAGE_MAX_AGE_HOURS;

  // Tenant cases: [slug, guid, latest snapshot, SSP's snapshot (null = no SSP), POA&M's snapshot, SSP age in hours]
  const CASES = {
    ok: ['gcpkg-ok', '00000000-0000-4000-8000-0000000001aa', 'snap-ok', 'snap-ok', 'snap-ok', 1],
    mismatch: ['gcpkg-mismatch', '00000000-0000-4000-8000-0000000001bb', 'snap-mismatch', 'snap-old', 'snap-mismatch', 1],
    stale: ['gcpkg-stale', '00000000-0000-4000-8000-0000000001cc', 'snap-stale', 'snap-stale', 'snap-stale', 30],
    nossp: ['gcpkg-nossp', '00000000-0000-4000-8000-0000000001dd', 'snap-nossp', null, 'snap-nossp', 1],
  } as const;

  beforeAll(async () => {
    delete process.env.EO_PACKAGE_MAX_AGE_HOURS;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-pkg1-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(path.join(storageRoot, 'ssp'), { recursive: true });
    const assessmentStore = new AssessmentStore(storageRoot);
    const now = Date.now();
    for (const [slug, guid, latestSnap, sspSnap, poamSnap, sspAgeH] of Object.values(CASES)) {
      const dir = path.join(stamperRoot, 'plan-data', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ tenant: { tenant_id: guid, domain: `${slug}.example.test` } }));
      assessmentStore.save({ snapshotId: latestSnap, tenantId: guid, generatedAt: iso(now - HOUR), sprs_score: 110, controls: [{ control_id: 'SC.L2-3.13.1', status: 'met', sources: [] }] } as any);
      // Minimal SSP / POA&M: valid for the gate; the POA&M is not DOCX-exportable, so the DOCX path fails deterministically.
      if (sspSnap) fs.writeFileSync(path.join(storageRoot, 'ssp', `latest-${slug}.json`), JSON.stringify({ sspId: `ssp-${slug}`, tenantId: guid, snapshotId: sspSnap, generatedAt: iso(now - sspAgeH * HOUR), controlImplementations: [] }));
      poams[slug] = { poamId: `poam-${slug}`, tenantId: guid, snapshotId: poamSnap, generatedAt: iso(now - HOUR), sprsScore: 110, items: [], summary: { totalItems: 0, openItems: 0, totalWeightOnPoam: 0, projectedScoreAfterPoam: 110 }, eligibility: { eligible: true, certificationPath: 'full' } };
    }

    const emptyStore = { load: () => [], loadRegister: () => ({ entries: [] }), loadLatest: () => null } as any;
    const app = express();
    app.use(express.json());
    app.use(createEvidenceRouter({
      config: { storageRoot } as any,
      stamperRoot,
      assessmentStore,
      personnelStore: emptyStore,
      riskAssessmentStore: emptyStore,
      policyStore: emptyStore,
      poamStore: { ...emptyStore, loadLatest: (slug: string) => poams[slug] ?? null } as any,
      getSessionManager: () => null,
      captureSignals: async () => ({ capturedCount: 0, errors: [] }),
      getLastCaptureRun: () => null,
    }));
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
    if (prevMaxAge === undefined) delete process.env.EO_PACKAGE_MAX_AGE_HOURS; else process.env.EO_PACKAGE_MAX_AGE_HOURS = prevMaxAge;
  });

  const build = (body: Record<string, unknown>) => fetch(base + '/api/package/build', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const zipsOf = (slug: string) => {
    const dir = path.join(storageRoot, 'packages', slug);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.zip')) : [];
  };

  test('an SSP from an older snapshot than the latest: 409 naming the ids, no package', async () => {
    const r = await build({ tenant: CASES.mismatch[0], allowPartial: true });
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).toMatch(/Package build refused: snapshot mismatch: the latest assessment snapshot is snap-mismatch, but the SSP records snapshot snap-old/);
    expect(zipsOf(CASES.mismatch[0])).toEqual([]);
  });

  test('an SSP older than 24 hours: 409', async () => {
    const r = await build({ tenant: CASES.stale[0], allowPartial: true });
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).toMatch(/the SSP was generated at .*older than EO_PACKAGE_MAX_AGE_HOURS=24/);
  });

  test('EO_PACKAGE_MAX_AGE_HOURS raises the limit', async () => {
    process.env.EO_PACKAGE_MAX_AGE_HOURS = '48';
    try {
      expect((await build({ tenant: CASES.stale[0], allowPartial: true })).status).toBe(200);
    } finally {
      delete process.env.EO_PACKAGE_MAX_AGE_HOURS;
    }
  });

  test('no SSP: 409', async () => {
    const r = await build({ tenant: CASES.nossp[0], allowPartial: true });
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).toMatch(/no readable SSP/);
  });

  test('a DOCX export failure without allowPartial fails the build (500) and writes no package', async () => {
    const r = await build({ tenant: CASES.ok[0] });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).toMatch(/(SSP|POA&M) DOCX export failed: .*the package was not built \(set allowPartial to build without it\)/);
    expect(zipsOf(CASES.ok[0])).toEqual([]);
  });

  test('with allowPartial the package builds and the cover sheet says it is partial, and why', async () => {
    const r = await build({ tenant: CASES.ok[0], allowPartial: true });
    expect(r.status).toBe(200);
    const { filePath } = await r.json();
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const coverName = Object.keys(zip.files).find((n: string) => n.endsWith('/cover-sheet.json'))!;
    const cover = JSON.parse(await zip.file(coverName).async('string'));
    expect(cover.snapshotId).toBe('snap-ok');
    expect(cover.allowPartial).toBe(true);
    expect(cover.partialFailures.length).toBeGreaterThanOrEqual(1);
    expect(cover.partialFailures[0]).toMatch(/^(SSP|POA&M) DOCX export failed: /);
  });
});
