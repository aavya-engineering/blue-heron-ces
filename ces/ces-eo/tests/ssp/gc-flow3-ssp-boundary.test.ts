// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GC-FLOW-3: the SSP boundary section reads the CUI Boundary envelope EO received through its Muster intake
 * (<storageRoot>/intake/<slug>/<receipt>/cui_boundary.json) and cites its hash. On the run-19 inputs: with an intake
 * whose envelope matches the Mission Plan's reference the facts come from the envelope (values equal to the TM's
 * definitions, the TM's types kept) and authorizationBoundary.cuiBoundarySource names the artifact and hash; with no
 * intake, or a reference with another hash, the TM facts stay (fallback) and nothing is cited.
 */
import { describe, test, expect, jest, beforeAll, afterAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });
jest.mock('ces-shared/storage', () => ({
  getStamperPlanDataRoot: jest.fn(() => '/tmp/golden-plan-data'),
}), { virtual: true });

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { canonicalSha256 } from 'ces-shared/crypto';
import type { AllManifests } from 'ces-shared/types/ssp';
import { SnippetDataResolver } from '../../src/eo/ssp/SnippetDataResolver.js';
import { buildGoldenAssessment } from './golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const FIXTURES = path.resolve(__dirname, '../fixtures/ssp-uplift');
const IM = path.join(FIXTURES, 'im-run19.json');
const TM = path.join(FIXTURES, 'tm-run19.json');
const MP = path.join(FIXTURES, 'mp-run19.json');
const SLUG = 'gcflow3-ssp';
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;

describe('GC-FLOW-3: SSP boundary from the intake CUI Boundary envelope', () => {
  let tmp: string;
  let manifests: AllManifests;
  let generate: (storageRoot: string | undefined, missionPlan: Record<string, unknown>) => any;
  const tmDefs = ((readJson(TM).tenant_manifest as Record<string, unknown>).boundary_zones as { definitions: Array<{ key: string; value: unknown; type: string }> }).definitions;
  const artifact = { ces: { artifact: 'cui_boundary_output', version: '1.0' }, cui_boundary: Object.fromEntries(tmDefs.map(d => [d.key, d.value])) };
  const envelope = { cesId: 'ces-run19', artifact_id: 'cui-boundary-ces-run19', hash_sha256: canonicalSha256(artifact), artifact };
  const mpWithRef = (hash: string) => ({ ...readJson(MP), inputs: { ...(readJson(MP).inputs as object), cui_boundary_ref: { artifact_id: envelope.artifact_id, hash_sha256: hash } } });

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-flow3-ssp-'));
    const dir = path.join(tmp, 'intake', SLUG, 'intake-2026-10-30T12-00-00-000Z');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cui_boundary.json'), JSON.stringify(envelope, null, 2));
    fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify({
      receipt_id: 'intake-2026-10-30T12-00-00-000Z', received_at: '2026-10-30T12:00:00.000Z',
      items: [{ kind: 'cui_boundary', stored_as: 'cui_boundary.json', artifact_id: envelope.artifact_id, hash_sha256: envelope.hash_sha256 }],
    }));
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const resolver = new SnippetDataResolver();
    manifests = await resolver.loadManifests('muster-partial', { tenantManifestPath: TM, infraManifestPath: IM, missionPlanPath: MP });
    generate = (storageRoot, missionPlan) => new SspGenerator(controlsRefPath, sprsWeightsPath, resolver).generate({
      assessment: buildGoldenAssessment(controlsRefPath),
      missionPlan,
      tenantManifest: readJson(TM),
      infraManifest: readJson(IM),
      manifests,
      variables: {},
      tenantSlug: SLUG,
      storageRoot,
    });
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('the envelope (hash = the MP reference) supplies the facts and is cited by hash', () => {
    const b = generate(tmp, mpWithRef(envelope.hash_sha256)).authorizationBoundary;
    expect(b.cuiBoundarySource).toEqual({
      source: 'cui_boundary_envelope', artifact_id: envelope.artifact_id, hash_sha256: envelope.hash_sha256,
      intake_receipt_id: 'intake-2026-10-30T12-00-00-000Z', received_at: '2026-10-30T12:00:00.000Z',
    });
    expect(b.description).toContain(`CUI Boundary ${envelope.artifact_id} (sha256 ${envelope.hash_sha256})`);
    expect(b.boundaryFacts.map((f: any) => f.key)).toEqual(tmDefs.map(d => d.key));
    expect(b.boundaryFacts.map((f: any) => f.type)).toEqual(tmDefs.map(d => d.type));
    expect(b.boundaryFacts.find((f: any) => f.key === 'cui_user_count').value).toBe('0');
  });

  test('fallback: no intake, or an MP reference with another hash, keeps the TM facts and cites nothing', () => {
    const tmOnly = generate(undefined, readJson(MP)).authorizationBoundary;
    expect(tmOnly.cuiBoundarySource).toBeUndefined();
    expect(tmOnly.boundaryFacts).toHaveLength(19);
    const mismatch = generate(tmp, mpWithRef('d'.repeat(64))).authorizationBoundary;
    expect(mismatch.cuiBoundarySource).toBeUndefined();
    expect(mismatch.boundaryFacts).toEqual(tmOnly.boundaryFacts);
    expect(mismatch.description).toBe(tmOnly.description);
    // Same values either way on these inputs: the envelope changes the citation, not the facts.
    expect(generate(tmp, mpWithRef(envelope.hash_sha256)).authorizationBoundary.boundaryFacts).toEqual(tmOnly.boundaryFacts);
  });
});
