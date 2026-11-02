// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EVC.4 / K4: the Tenant Manifest (TM) reaches the SSP.
 *  - EoConfig finds Muster's timestamped TM (latest wins; the fixed name still works).
 *  - loadManifests unwraps `tenant_manifest`; the SSP's system name comes from the TM.
 *  - Every MG-08 definition appears in the SSP JSON and the DOCX, as a boundary fact (W2.5).
 *  - Statuses, SPRS and the quality scorecard (bar the diagram metric) are unchanged.
 * Fixtures: tests/fixtures/evc4-tm/tenant-manifest-run7.json (the last run's TM, no zones,
 * pre-MG-08) and tenant-manifest-two-zones.json (same TM + two definitions in the MG-08 shape
 * taken from Muster's fixture (a) golden TM).
 */
import { describe, test, expect, jest, beforeAll, beforeEach, afterEach } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { SystemSecurityPlan } from 'ces-shared/types/ssp';
import { buildGoldenAssessment, buildGoldenInfraManifest, buildGoldenMissionPlan } from './golden-fixtures.js';
import { loadEoConfig } from '../../src/eo/config/EoConfig';
import { SnippetDataResolver } from '../../src/eo/ssp/SnippetDataResolver';
import { SspQualityScorecard } from '../../src/eo/ssp/SspQualityScorecard';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter';
import { parseTmBoundary, unwrapTenantManifest } from '../../src/eo/ssp/TmBoundary';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const FIXTURES = path.resolve(__dirname, '../fixtures/evc4-tm');
const RUN7_TM = path.join(FIXTURES, 'tenant-manifest-run7.json');
const TWO_ZONE_TM = path.join(FIXTURES, 'tenant-manifest-two-zones.json');
const ZONES = ['cui_storage_locations', 'tenant_separation'];
const TM_NAME = 'Sim tenant muster-partial';

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;

describe('EVC.4 step 1: EoConfig discovers the TM under the name Muster writes', () => {
  const ENV_KEYS = ['REGISTRY_PATH', 'TENANT_SLUG', 'TENANT_CONFIG', 'ACTIVE_TENANT_SLUG', 'STORAGE_ROOT', 'STAMPER_PLAN_DATA_ROOT',
    'TENANT_MANIFEST_PATH', 'INFRA_MANIFEST_PATH', 'MISSION_PLAN_PATH', 'CES_TENANT_ROOT', 'CES_PIPELINE_ROOT'];
  const saved: Record<string, string | undefined> = {};
  let root: string;
  let plans: string;
  const slug = 'evc4-tenant';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-evc4-'));
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.CES_TENANT_ROOT = path.join(root, 'tenants');
    process.env.CES_PIPELINE_ROOT = path.join(root, 'pl');
    process.env.STORAGE_ROOT = path.join(root, 'eo');
    process.env.REGISTRY_PATH = path.join(root, 'registry.json');
    process.env.STAMPER_PLAN_DATA_ROOT = path.join(root, 'plan-data');
    process.env.TENANT_SLUG = slug;
    plans = path.join(root, 'plan-data', slug, 'plans');
    fs.mkdirSync(plans, { recursive: true });
  });

  afterEach(() => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('picks the latest tenant-manifest-<slug>-*.json over older ones and the fixed name', async () => {
    fs.writeFileSync(path.join(plans, `tenant-manifest-${slug}-2026-10-26T06-21-15-429Z.json`), '{}');
    fs.writeFileSync(path.join(plans, `tenant-manifest-${slug}-2026-10-27T06-21-15-429Z.json`), '{}');
    fs.writeFileSync(path.join(plans, 'tenant-manifest-other-tenant-2026-12-01T00-00-00-000Z.json'), '{}');
    fs.writeFileSync(path.join(root, 'plan-data', slug, 'tenant-manifest.json'), '{}');
    const config = await loadEoConfig();
    expect(config.tenantManifestPath).toBe(path.join(plans, `tenant-manifest-${slug}-2026-10-27T06-21-15-429Z.json`));
  });

  test('still accepts the fixed tenant-manifest.json when no timestamped TM exists', async () => {
    const fixed = path.join(root, 'plan-data', slug, 'tenant-manifest.json');
    fs.writeFileSync(fixed, '{}');
    const config = await loadEoConfig();
    expect(config.tenantManifestPath).toBe(fixed);
  });

  test('TENANT_MANIFEST_PATH still wins; no TM leaves the path unset', async () => {
    expect((await loadEoConfig()).tenantManifestPath).toBeUndefined();
    fs.writeFileSync(path.join(plans, `tenant-manifest-${slug}-2026-10-27T06-21-15-429Z.json`), '{}');
    process.env.TENANT_MANIFEST_PATH = path.join(root, 'explicit.json');
    expect((await loadEoConfig()).tenantManifestPath).toBe(path.join(root, 'explicit.json'));
  });
});

describe('EVC.4 step 2-3: TM unwrap and zone parsing', () => {
  test('loadManifests unwraps tenant_manifest from the real run TM', async () => {
    const m = await new SnippetDataResolver().loadManifests('muster-partial', { tenantManifestPath: RUN7_TM });
    expect(m.tenantManifest?.tenant_identity?.display_name).toBe(TM_NAME);
    const inner = unwrapTenantManifest(readJson(RUN7_TM))!;
    expect((inner.tenant_identity as Record<string, unknown>).display_name).toBe(TM_NAME);
    expect(unwrapTenantManifest(inner)).toBe(inner);
  });

  // W2.5: MG-08 definitions are questionnaire answers, so they are boundary facts, not zones.
  test('BoundaryZonesSchema shape: one fact per definition; the run-7 TM has none', () => {
    const b = parseTmBoundary(readJson(TWO_ZONE_TM));
    expect(b.cuiBoundaryVersion).toBe('2026-01-15');
    expect(b.facts.map(f => f.key)).toEqual(ZONES);
    expect(b.facts[0].value).toBe('SharePoint Online (GCC High), OneDrive (GCC High), Exchange mailboxes, Teams file libraries');
    expect(b.facts[1].value).toBe('Yes – fully isolated tenant');
    for (const z of ZONES) expect(b.zones.map(x => x.name)).not.toContain(z);
    expect(parseTmBoundary(readJson(RUN7_TM)).facts).toEqual([]);
    expect(parseTmBoundary({ boundary_zones: ['M365 GCC High'] }).zones.map(z => z.name)).toEqual(['M365 GCC High']);
  });
});

describe('EVC.4: SSP from the TM', () => {
  let generator: any;
  const generate = (tmPath: string | undefined, withManifests: boolean, manifests?: any): SystemSecurityPlan => generator.generate({
    assessment: buildGoldenAssessment(controlsRefPath),
    missionPlan: buildGoldenMissionPlan(),
    tenantManifest: tmPath ? readJson(tmPath) : undefined,
    infraManifest: buildGoldenInfraManifest(),
    ...(withManifests ? { manifests } : {}),
    variables: {},
  });

  let zoned: SystemSecurityPlan;
  let zonedOld: SystemSecurityPlan;
  let run7: SystemSecurityPlan;
  let none: SystemSecurityPlan;

  beforeAll(async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const resolver = new SnippetDataResolver();
    generator = new SspGenerator(controlsRefPath, sprsWeightsPath, resolver);
    const zm = await resolver.loadManifests('muster-partial', { tenantManifestPath: TWO_ZONE_TM });
    const rm = await resolver.loadManifests('muster-partial', { tenantManifestPath: RUN7_TM });
    zoned = generate(TWO_ZONE_TM, true, zm);
    zonedOld = generate(TWO_ZONE_TM, false);
    run7 = generate(RUN7_TM, true, rm);
    none = generate(undefined, false);
  });

  test('system name comes from the TM and the source is recorded in the SSP JSON', () => {
    for (const s of [zoned, run7]) {
      const json = JSON.parse(JSON.stringify(s));
      expect(json.systemName).toBe(TM_NAME);
      expect(json.systemNameSource).toBe('tenant_manifest');
      expect(json.systemName).not.toBe(`${json.tenantId} System`);
    }
  });

  // W2.5: zones now also come from the IM network and the TM identity/assets, so a run without TM zones still has a boundary.
  test('fallback still works when no TM exists', () => {
    expect(none.systemName).toBe(`${none.tenantId} System`);
    expect((none as any).systemNameSource).toBe('fallback');
    expect(none.authorizationBoundary.zones).toEqual(['Azure virtual network vnet-cui-prod']);
    expect((none.authorizationBoundary as any).boundaryFacts).toBeUndefined();
    expect(run7.authorizationBoundary.zones).toEqual(['Microsoft 365 GCC High tenant', 'CUI data boundary', 'Azure virtual network vnet-cui-prod']);
  });

  // W2.5: the MG-08 keys move from zones to authorizationBoundary.boundaryFacts; zones are real boundary parts.
  test('every TM definition is a boundary fact, never a zone; zones are in the templated text and the diagram', () => {
    const b = JSON.parse(JSON.stringify(zoned.authorizationBoundary));
    for (const z of ZONES) {
      expect(b.zones).not.toContain(z);
      expect(b.boundaryFacts.map((f: any) => f.key)).toContain(z);
    }
    expect(b.boundaryFacts[0].value).toContain('SharePoint Online (GCC High)');
    expect(b.zoneDetails.map((z: any) => z.name)).toEqual(b.zones);
    expect(b.description).toContain(TM_NAME);
    for (const z of b.zones) expect(b.description).toContain(z);
    const diagram = zoned.appendices!.find(a => a.title === 'System Authorization Boundary Diagram')!;
    for (const z of b.zones) expect(diagram.summary).toContain(`Zone: ${z}`);
  });

  test('every TM zone is in the DOCX', async () => {
    const buf = await new SspDocxExporter().export(zoned);
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
    for (const z of ZONES) expect(xml).toContain(z);
    expect(xml).toContain('SharePoint Online (GCC High)');
    expect(xml).toContain('Yes – fully isolated tenant');
  });

  test('statuses, SPRS and the quality scorecard are unchanged beyond the boundary', () => {
    const pick = (s: SystemSecurityPlan) => s.controlImplementations.map((c: any) => [c.control_id, c.status, c.sprsValue, c.sprsRationale]);
    expect(pick(zoned)).toEqual(pick(zonedOld));
    const card = new SspQualityScorecard();
    const scores = (s: SystemSecurityPlan) => card.validate(s, (s as any)._tenantManifest, (s as any)._infraManifest, undefined).metrics;
    // Excluded: 4 (diagram readiness: the boundary diagram is now generated) and 5 (ODP documentation:
    // passing `manifests` lets no-signal controls take their narrative from the TM's normative_controls,
    // a pre-existing SspGenerator branch; logged as a deviation in LOG-EVC.4).
    const rest = (s: SystemSecurityPlan) => scores(s).filter(m => m.metricId !== 4 && m.metricId !== 5).map(m => [m.metricId, m.score, m.passed]);
    expect(rest(zoned)).toEqual(rest(zonedOld));
    const reloaded = (s: SystemSecurityPlan) => JSON.parse(JSON.stringify(s)) as SystemSecurityPlan;
    expect(rest(reloaded(zoned))).toEqual(rest(reloaded(zonedOld)));
    const odp = (s: SystemSecurityPlan) => scores(s).find(m => m.metricId === 5)!.score;
    expect(odp(zoned)).toBeGreaterThanOrEqual(odp(zonedOld));
  });
});
