// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W2 plumbing, on the pushed run-19 inputs (scrubbed copies in tests/fixtures/ssp-uplift):
 *  - W2.1: the Infrastructure Manifest (IM) is read under `infrastructure.*`: 32 components in
 *    7 sections; network topology and interconnections from VNet, subnet, private-endpoint
 *    and NSG properties; Appendix D rows from the resources (version and EOL stay manual).
 *  - W2.2: Mission Plan (MP) steps keep `owner_role` and effort; responsible roles and §7 are
 *    filled; no "managed by ."; no `evidence_store` token anywhere in the SSP.
 *  - W2.5: zones come from the Tenant Manifest (TM) identity and assets and the IM network; the
 *    19 questionnaire answers are `authorizationBoundary.boundaryFacts[]`, never zones.
 * The generator is called as documents-router calls it: raw files plus resolved `manifests`.
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });
jest.mock('ces-shared/storage', () => ({
  getStamperPlanDataRoot: jest.fn(() => '/tmp/golden-plan-data'),
}), { virtual: true });

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { AllManifests } from 'ces-shared/types/ssp';
import type { EoSystemSecurityPlan, EoMissionPlanStep } from '../../src/shared/types/ssp.types.js';
import { SnippetDataResolver } from '../../src/eo/ssp/SnippetDataResolver.js';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter.js';
import { buildGoldenAssessment } from './golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const FIXTURES = path.resolve(__dirname, '../fixtures/ssp-uplift');
const IM = path.join(FIXTURES, 'im-run19.json');
const TM = path.join(FIXTURES, 'tm-run19.json');
const MP = path.join(FIXTURES, 'mp-run19.json');
const NOW = '2026-10-27T19:01:08.203Z';
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;

describe('W2 plumbing on the run-19 inputs', () => {
  let manifests: AllManifests;
  let ssp: EoSystemSecurityPlan;
  let json: string;
  let xml: string;

  beforeAll(async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const resolver = new SnippetDataResolver();
    manifests = await resolver.loadManifests('muster-partial', { tenantManifestPath: TM, infraManifestPath: IM, missionPlanPath: MP });
    const assessment = buildGoldenAssessment(controlsRefPath);
    // Every control takes the snippet-template path, where the role tokens live.
    for (const c of assessment.controls) {
      c.signals = [{ signalId: 'w2-stub', source: 'graph', endpoint: '/w2', timestamp: NOW, rawData: {}, status: 'success' }] as typeof c.signals;
    }
    ssp = new SspGenerator(controlsRefPath, sprsWeightsPath, resolver).generate({
      assessment,
      missionPlan: readJson(MP),
      tenantManifest: readJson(TM),
      infraManifest: readJson(IM),
      manifests,
      variables: {},
    });
    json = JSON.stringify(ssp);
    const buf = await new SspDocxExporter().export(ssp);
    xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
  });

  test('W2.1: loadManifests unwraps infrastructure.*', () => {
    const im = manifests.infraManifest as unknown as Record<string, unknown>;
    expect(Array.isArray(im.network)).toBe(true);
    expect(im.infrastructure_model).toBe('m365_azure');
  });

  test('W2.1: 32 components in 7 sections', () => {
    const sections = ssp.systemComponents.sections;
    expect(sections.map(s => s.name)).toEqual(['identity', 'logging', 'security', 'storage', 'network', 'automation', 'diagnostics']);
    expect(sections.reduce((n, s) => n + s.components.length, 0)).toBe(32);
    expect(sections.find(s => s.name === 'storage')!.components).toContain('cmmc-kv-prod (key_vault)');
  });

  test('W2.1: network topology and interconnections from VNet, subnet, endpoint and NSG properties', () => {
    const topo = ssp.networkTopology.topology;
    expect(topo).toContain('VNet: cmmc-vnet-eo (10.0.0.0/16)');
    expect(topo).toContain('Subnet: snet-pe (10.0.1.0/27) in cmmc-vnet-eo');
    expect(topo.filter(t => t.startsWith('Subnet: '))).toHaveLength(4);
    expect(topo.filter(t => t.startsWith('Private endpoint: '))).toHaveLength(2);
    expect(topo.some(t => t.startsWith('NSG: cmmc-nsg-pe: DenyInternetInbound Inbound Deny from Internet'))).toBe(true);
    const ic = ssp.interconnections;
    expect(ic.filter(i => i.type === 'private_endpoint').map(i => i.name)).toEqual(['cmmc-pe-kv', 'cmmc-pe-blob']);
    expect(ic.find(i => i.name === 'cmmc-pe-kv')!.description).toBe('Private link from subnet snet-pe to cmmc-kv-prod (vault) via privatelink.vaultcore.usgovcloudapi.net');
    expect(ic.filter(i => i.type === 'nsg_rule')).toHaveLength(1);
  });

  test('W2.1: Appendix D lists the 32 resources; version and EOL stay manual', () => {
    const d = ssp.appendices!.find(a => a.title === 'Hardware and Software Inventory')!;
    const rows = d.summary.split('\n').slice(2);
    expect(rows).toHaveLength(32);
    expect(rows.find(r => r.startsWith('| cmmc-vnet-eo |'))).toBe('| cmmc-vnet-eo | virtual_network | Provider-managed (cloud service) | N/A | Network | Provider-managed (cloud service) | See CM policy |');
  });

  test('W2.2: MP steps keep owner_role and effort', () => {
    const step = manifests.missionPlan!.steps[0] as EoMissionPlanStep;
    expect(step.owner_role).toBe('compliance_engineer');
    expect(step.estimated_effort_hours).toBe(11);
    expect(step.effort_estimate).toBeDefined();
  });

  test('W2.2: responsible roles and §7 are filled', () => {
    for (const c of ssp.controlImplementations) expect(c.responsibleRole).toBe('compliance_engineer');
    expect(ssp.rolesAndResponsibilities).toHaveLength(1);
    expect(ssp.rolesAndResponsibilities[0].role).toBe('compliance_engineer');
    expect(ssp.rolesAndResponsibilities[0].controlIds.length).toBeGreaterThanOrEqual(110);
  });

  test('W2.2: no "managed by ." and no evidence_store token', () => {
    expect(json).not.toContain('managed by .');
    expect(json).toContain('managed by the Compliance Engineer role');
    expect((json.match(/evidence_store/g) ?? []).length).toBe(0);
    expect(xml).not.toContain('evidence_store');
  });

  test('W2.5: zones from TM identity, assets and the IM network; 19 questionnaire facts', () => {
    const b = ssp.authorizationBoundary;
    expect(b.zones).toEqual(['Microsoft 365 GCC High tenant', 'CUI data boundary', 'Azure virtual network cmmc-vnet-eo']);
    expect(b.boundaryFacts).toHaveLength(19);
    const keys = b.boundaryFacts!.map(f => f.key);
    expect(keys).toContain('cui_user_count');
    for (const z of b.zones) expect(keys).not.toContain(z);
    expect(b.boundaryFacts!.find(f => f.key === 'cui_user_count')!.value).toBe('0');
    const cui = b.zoneDetails!.find(z => z.name === 'CUI data boundary')!;
    expect(cui.components).toEqual(['cui-sharepoint: https://muster-partial.sharepoint.us/sites/CUI', 'cui-teams: CUI Operations', 'cui-teams: CMMC Compliance']);
    expect(b.cuiBoundaryVersion).toBe('2026-10-27');
  });

  test('W2.5: the DOCX lists the zones with components and a boundary-facts table', () => {
    expect(xml).toContain('Azure virtual network cmmc-vnet-eo');
    expect(xml).toContain('Private endpoint cmmc-pe-kv to cmmc-kv-prod (vault)');
    expect(xml).toContain('Boundary facts (CUI boundary questionnaire):');
    expect(xml).toContain('cui_user_count');
  });

  test('W2: the continuous-monitoring section appears from the IM logging resources', () => {
    expect(ssp.continuousMonitoring?.tools).toEqual(['Log Analytics Workspace (muster-partial-law-prod)', 'Microsoft Sentinel (sentinel)']);
  });
});
