// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX2-MU2: the vendored ces-shared copies (both sprs-weights.json copies plus the
// verbatim muster-api stack/secretRef files) must be byte-identical to canonical
// ces-shared. Calls the production sync module (src/vendored/cesSharedSync.ts).
//
// CI note: the SPA CI checks out ces-muster alone, so the sibling ces-shared is
// absent there. Only in that case (canonical missing AND process.env.CI set) is
// the live-repo parity check skipped; locally a missing canonical FAILS.
import { describe, test, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  checkParity,
  syncCopies,
  SYNC_ENTRIES,
  DEFAULT_REPO_ROOT,
  resolveCanonicalRoot,
} from '../cesSharedSync';

const canonicalRoot = resolveCanonicalRoot(DEFAULT_REPO_ROOT);
const canonicalPresent = fs.existsSync(path.join(canonicalRoot, 'package.json'));
const skipLive = !canonicalPresent && !!process.env.CI;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A throwaway ces-muster tree holding copies of the real vendored files + manifest. */
function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-shared-parity-'));
  tmpDirs.push(dir);
  for (const e of SYNC_ENTRIES) {
    const dst = path.join(dir, e.copy);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(DEFAULT_REPO_ROOT, e.copy), dst);
  }
  fs.copyFileSync(path.join(DEFAULT_REPO_ROOT, 'vendor-manifest.json'), path.join(dir, 'vendor-manifest.json'));
  return dir;
}

function flipOneByte(file: string) {
  const buf = fs.readFileSync(file);
  const i = buf.indexOf(Buffer.from('"'), 10);
  buf[i + 1] = buf[i + 1] ^ 0x01;
  fs.writeFileSync(file, buf);
}

describe('FX2-MU2: vendored ces-shared copies match canonical', () => {
  test.skipIf(skipLive)('every vendored copy in this repo is byte-identical to canonical ces-shared', () => {
    const report = checkParity();
    expect(report.canonicalAvailable, `canonical ces-shared not found at ${report.canonicalRoot}`).toBe(true);
    const bad = report.results.filter((r) => r.status !== 'match');
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('both sprs-weights.json copies are covered', () => {
    const copies = SYNC_ENTRIES.filter((e) => e.canonical === 'src/data/sprs-weights.json').map((e) => e.copy);
    expect(copies).toEqual([
      'src/vendored/ces-shared/data/sprs-weights.json',
      'muster-api/src/vendored/ces-shared/data/sprs-weights.json',
    ]);
  });

  test.skipIf(skipLive)('altering ONE byte of a copy is reported as drift, and --write repairs it + re-pins the manifest', () => {
    const repo = scratchRepo();
    const target = 'muster-api/src/vendored/ces-shared/data/sprs-weights.json';
    flipOneByte(path.join(repo, target));
    // Stale pin in the scratch manifest, so the re-pin assertion below only passes
    // if syncCopies actually rewrites the hash.
    const manifestPath = path.join(repo, 'vendor-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.files[target] = '0'.repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const drifted = checkParity({ repoRoot: repo, canonicalRoot });
    expect(drifted.ok).toBe(false);
    expect(drifted.results.filter((r) => r.status === 'drift').map((r) => r.copy)).toEqual([target]);

    const changed = syncCopies({ repoRoot: repo, canonicalRoot });
    expect(changed).toEqual([target]);
    expect(checkParity({ repoRoot: repo, canonicalRoot }).ok).toBe(true);

    const pinned = JSON.parse(fs.readFileSync(path.join(repo, 'vendor-manifest.json'), 'utf-8')).files[target];
    const actual = createHash('sha256').update(fs.readFileSync(path.join(repo, target))).digest('hex');
    expect(pinned).toBe(actual);
  });

  test('a missing canonical file is reported, not silently passed', () => {
    const repo = scratchRepo();
    const emptyCanon = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-shared-empty-'));
    tmpDirs.push(emptyCanon);
    const report = checkParity({ repoRoot: repo, canonicalRoot: emptyCanon });
    expect(report.canonicalAvailable).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.results.every((r) => r.status === 'missing-canonical')).toBe(true);
  });
});
