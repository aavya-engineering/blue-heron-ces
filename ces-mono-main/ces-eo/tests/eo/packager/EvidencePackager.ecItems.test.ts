// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-F (M4a) — an EC evidence item's bytes must land in the built evidence package
 * (REQ-ces-eo-ec-wiring acceptance: "an upload ... appears ... in the built package, with
 * the verdict unchanged"). Drives the real `EvidencePackager.build`, not a re-implementation.
 *
 * Zip entry filenames/paths are stored as plain text in both the local file header and the
 * central directory regardless of the entry's own compression (ZIP spec) — so asserting the
 * expected archive path is present in the raw zip bytes is a real, non-mocked proof that
 * `archive.append` was called with that path, without pulling in a zip-reading dependency
 * this project doesn't otherwise have.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EC_CONTRACT_VERSION, type EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EvidencePackager } from '../../../src/eo/packager/EvidencePackager';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');

function baseSnapshot(): AssessmentSnapshot {
  return {
    snapshotId: 'snap-1',
    tenantId: 'tenant-1',
    generatedAt: '2026-09-28T00:00:00.000Z',
    controls: [],
    sources_merged: [],
    sprs_score: 100,
    controls_met: 0,
    controls_not_met: 0,
    controls_partial: 0,
    controls_not_assessed: 0,
    liveAssessmentCount: 0,
  } as unknown as AssessmentSnapshot;
}

function ecItem(overrides: Partial<EcEvidenceItem> = {}): EcEvidenceItem {
  return {
    contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
    itemId: 'eci-pkg-1',
    tenantSlug: 'acme-sim',
    controlIds: ['AC.L1-3.1.1'],
    source: 'manual_upload',
    filename: 'training-roster.pdf',
    mediaType: 'application/pdf',
    sha256: 'c'.repeat(64),
    sizeBytes: 7,
    collectedAt: '2026-09-28T00:00:00.000Z',
    submittedByRole: 'compliance_officer',
    mode: 'sim',
    ...overrides,
  };
}

describe('EvidencePackager: EC evidence items', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-pkg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes the EC item bytes into the zip under evidence/ec/<controlId>/<itemId>-<filename>', async () => {
    const packager = new EvidencePackager(controlsRefPath);
    const item = ecItem();
    const content = Buffer.from('roster!');

    const result = await packager.build({
      assessment: baseSnapshot(),
      ecEvidenceItems: [{ item, content }],
      outputDir: tmpDir,
    });

    expect(fs.existsSync(result.filePath)).toBe(true);
    const zipBytes = fs.readFileSync(result.filePath);
    const expectedPath = `evidence/ec/AC.L1-3.1.1/eci-pkg-1-training-roster.pdf`;
    expect(zipBytes.includes(Buffer.from(expectedPath))).toBe(true);
  });

  it('uses the item\'s first controlId as the zip directory (an out-of-reference id is still archived, not dropped)', async () => {
    const packager = new EvidencePackager(controlsRefPath);
    const item = ecItem({ itemId: 'eci-pkg-2', controlIds: ['ZZ.L1-9.9.9'] });

    const result = await packager.build({
      assessment: baseSnapshot(),
      ecEvidenceItems: [{ item, content: Buffer.from('x') }],
      outputDir: tmpDir,
    });

    const zipBytes = fs.readFileSync(result.filePath);
    expect(zipBytes.includes(Buffer.from('evidence/ec/ZZ.L1-9.9.9/eci-pkg-2'))).toBe(true);
  });

  it('omitting ecEvidenceItems never adds an evidence/ec/ path (no regression for tenants with no EC uploads)', async () => {
    const packager = new EvidencePackager(controlsRefPath);
    const result = await packager.build({ assessment: baseSnapshot(), outputDir: tmpDir });
    const zipBytes = fs.readFileSync(result.filePath);
    expect(zipBytes.includes(Buffer.from('evidence/ec/'))).toBe(false);
  });
});
