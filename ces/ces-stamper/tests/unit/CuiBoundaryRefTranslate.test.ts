// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W7-CUI (note 39): translateFile verifies the Mission Plan's inputs.cui_boundary_ref against
// the pushed CUI Boundary envelope in the plan-data folder (the Mission Plan's own folder).
// Fixtures: Stamper's synthetic Mission Plan + Tenant Manifest, copied into a temp folder;
// the CUI Boundary is a fictional envelope in muster-api's push shape.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { canonicalSha256 } from 'ces-shared/crypto';
import { PlanTranslator, CUI_BOUNDARY_PREFIX } from '../../src/translators/PlanTranslator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '..', 'fixtures');

const ARTIFACT_ID = 'cui-boundary-fictional-co-001';
const FILE_NAME = 'cui-boundary-fictional-co-2026-10-29T00-00-00-000Z.json';
const boundary = {
  ces: { artifact: 'cui_boundary_output', version: '1.0', generated_on: '2026-10-29', cui_bank_version: '1.0' },
  cui_boundary: { zones: [{ id: 'zone-1', name: 'Fictional enclave' }] },
};
const envelope = (artifact: unknown = boundary, artifact_id = ARTIFACT_ID) => ({
  cesId: 'ces-fictional-001',
  schema_id: 'muster:cui-boundary-output',
  artifact_id,
  version: '1.0.0',
  hash_sha256: canonicalSha256(artifact),
  artifact,
});
const legacyBlock = boundary.ces;

describe('W7-CUI CUI Boundary reference check (translateFile)', () => {
  let tmp: string;
  let mpPath: string;
  let tmPath: string;
  const baseMp = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'synthetic-mission-plan.json'), 'utf-8'));

  const writeMp = (cuiRef: unknown) => {
    const mp = JSON.parse(JSON.stringify(baseMp));
    if (cuiRef !== undefined) mp.inputs.cui_boundary_ref = cuiRef;
    fs.writeFileSync(mpPath, JSON.stringify(mp));
  };
  const writeEnvelope = (file: string, env: unknown) => fs.writeFileSync(path.join(tmp, file), JSON.stringify(env, null, 2));
  const translate = () => new PlanTranslator().translateFile(mpPath, tmPath);
  const fullRef = (over: Record<string, unknown> = {}) => ({
    ...legacyBlock,
    artifact_id: ARTIFACT_ID,
    hash_sha256: canonicalSha256(boundary),
    file_name: FILE_NAME,
    schema_id: 'muster:cui-boundary-output',
    ...over,
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-cui-'));
    mpPath = path.join(tmp, 'manual-mission-plan-fictional-co-2026-10-29T00-00-00-000Z.json');
    tmPath = path.join(tmp, 'tenant-manifest-fictional-co-2026-10-29T00-00-00-000Z.json');
    fs.copyFileSync(path.join(fixturesDir, 'synthetic-tenant-manifest.json'), tmPath);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('match (by file_name): records verified true, no warning', () => {
    writeEnvelope(FILE_NAME, envelope());
    writeMp(fullRef());
    const result = translate();
    const expected = { artifact_id: ARTIFACT_ID, hash_sha256: canonicalSha256(boundary), verified: true };
    expect(result.cuiBoundaryRef).toEqual(expected);
    expect(result.plan.variables._cui_boundary_ref).toEqual(expected);
    expect(result.warnings.some((w) => w.startsWith(CUI_BOUNDARY_PREFIX))).toBe(false);
  });

  it('match without file_name: located by artifact_id among cui-boundary-*.json (hash match wins)', () => {
    const older = { ...boundary, cui_boundary: { zones: [] } };
    writeEnvelope('cui-boundary-fictional-co-2026-10-28T00-00-00-000Z.json', envelope(older));
    writeEnvelope(FILE_NAME, envelope());
    writeEnvelope('cui-boundary-other-co-2026-10-29T00-00-00-000Z.json', envelope(boundary, 'cui-boundary-other-co-001'));
    const { file_name: _drop, ...noFile } = fullRef();
    writeMp(noFile);
    const result = translate();
    expect(result.cuiBoundaryRef).toEqual({ artifact_id: ARTIFACT_ID, hash_sha256: canonicalSha256(boundary), verified: true });
  });

  it('mismatch: translation fails with a clear message naming both hashes', () => {
    const tampered = { ...boundary, cui_boundary: { zones: [{ id: 'zone-1', name: 'Changed' }] } };
    writeEnvelope(FILE_NAME, envelope(tampered));
    writeMp(fullRef());
    expect(() => translate()).toThrow(CUI_BOUNDARY_PREFIX);
    expect(() => translate()).toThrow(canonicalSha256(boundary));
    expect(() => translate()).toThrow(canonicalSha256(tampered));
  });

  it('mismatch on artifact_id: translation fails', () => {
    writeEnvelope(FILE_NAME, envelope(boundary, 'cui-boundary-someone-else'));
    writeMp(fullRef());
    expect(() => translate()).toThrow(/does not match the pushed CUI Boundary/);
  });

  it('missing file: warns, records verified false with a reason, translation succeeds', () => {
    writeMp(fullRef());
    const result = translate();
    expect(result.cuiBoundaryRef).toMatchObject({ artifact_id: ARTIFACT_ID, hash_sha256: canonicalSha256(boundary), verified: false });
    expect(result.cuiBoundaryRef?.reason).toContain(FILE_NAME);
    expect(result.plan.variables._cui_boundary_ref).toEqual(result.cuiBoundaryRef);
    expect(result.warnings.some((w) => w.startsWith(CUI_BOUNDARY_PREFIX) && w.includes('not found'))).toBe(true);
    expect(result.plan.execution_graph.length).toBeGreaterThan(0);
  });

  it("no hash = no reference: the generator's legacy block, or no ref at all, records nothing", () => {
    for (const ref of [legacyBlock, undefined]) {
      writeMp(ref);
      const result = translate();
      expect(result.cuiBoundaryRef).toBeUndefined();
      expect(result.plan.variables._cui_boundary_ref).toBeUndefined();
      expect(result.warnings.some((w) => w.startsWith(CUI_BOUNDARY_PREFIX))).toBe(false);
    }
  });
});
