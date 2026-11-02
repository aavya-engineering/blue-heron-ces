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

describe('CLI infra manifest dual-prefix heuristic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-infra-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runHeuristic(manifestOption: string): string | undefined {
    const infraCandidates = [
      manifestOption.replace(/tenant-manifest/i, 'infrastructure-manifest'),
      manifestOption.replace(/tenant-manifest/i, 'infra-manifest'),
    ].filter(p => p !== manifestOption);
    return infraCandidates.find(p => fs.existsSync(path.resolve(p)));
  }

  it('finds legacy infrastructure-manifest prefix', () => {
    const tmPath = path.join(tmpDir, 'tenant-manifest_slug_2026.json');
    const infraPath = path.join(tmpDir, 'infrastructure-manifest_slug_2026.json');
    fs.writeFileSync(tmPath, '{}');
    fs.writeFileSync(infraPath, '{"infrastructure_manifest":{}}');

    const found = runHeuristic(tmPath);
    expect(found).toBe(infraPath);
  });

  it('finds Muster infra-manifest prefix', () => {
    const tmPath = path.join(tmpDir, 'tenant-manifest_slug_2026.json');
    const infraPath = path.join(tmpDir, 'infra-manifest_slug_2026.json');
    fs.writeFileSync(tmPath, '{}');
    fs.writeFileSync(infraPath, '{"infrastructure_manifest":{}}');

    const found = runHeuristic(tmPath);
    expect(found).toBe(infraPath);
  });

  it('prefers infrastructure-manifest when both exist', () => {
    const tmPath = path.join(tmpDir, 'tenant-manifest_slug_2026.json');
    const legacyPath = path.join(tmpDir, 'infrastructure-manifest_slug_2026.json');
    const musterPath = path.join(tmpDir, 'infra-manifest_slug_2026.json');
    fs.writeFileSync(tmPath, '{}');
    fs.writeFileSync(legacyPath, '{"infrastructure_manifest":{}}');
    fs.writeFileSync(musterPath, '{"infrastructure_manifest":{}}');

    const found = runHeuristic(tmPath);
    expect(found).toBe(legacyPath);
  });

  it('returns undefined when no infra manifest exists', () => {
    const tmPath = path.join(tmpDir, 'tenant-manifest_slug_2026.json');
    fs.writeFileSync(tmPath, '{}');

    const found = runHeuristic(tmPath);
    expect(found).toBeUndefined();
  });
});
