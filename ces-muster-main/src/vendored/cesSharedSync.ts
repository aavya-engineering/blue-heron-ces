// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * cesSharedSync.ts — FX2-MU2: keep Muster's vendored ces-shared copies byte-identical
 * to the canonical files in the sibling ces-shared repo.
 *
 * Why copies at all (HONEST-OPEN for a direct import, see docs/FLOW-THROUGH-REPORT-2026-09.md
 * "2026-09-27 fix round 2"):
 *   - the SPA's CI (.github/workflows/ci.yml) checks out ces-muster ALONE, so a
 *     `../ces-shared` import would break the CI build;
 *   - muster-api already depends on `ces-shared` (file:), but ces-shared's built
 *     dist has no data/sprs-weights.json even though its exports map names it
 *     (REQ-ces-shared-dist-sprs-weights.md).
 *
 * Usage:
 *   npx tsx src/vendored/cesSharedSync.ts          # check: exit 1 on drift (npm run check:ces-shared)
 *   npx tsx src/vendored/cesSharedSync.ts --write  # copy canonical → vendored, re-pin vendor-manifest.json
 *
 * The canonical root defaults to <repo>/../ces-shared; override with CES_SHARED_ROOT.
 *
 * Not synced (ADAPTED copies, documented in their headers, cannot be byte-parity'd):
 *   muster-api/src/vendored/ces-shared/config/TenantConfig.ts
 *   muster-api/src/vendored/ces-shared/storage/contract.ts
 *   muster-api/src/vendored/ces-shared/storage/node.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface SyncEntry {
  /** Vendored copy, relative to the ces-muster repo root. */
  copy: string;
  /** Canonical file, relative to the ces-shared repo root. */
  canonical: string;
}

/** Every verbatim vendored ces-shared file in ces-muster. */
export const SYNC_ENTRIES: readonly SyncEntry[] = [
  { copy: 'src/vendored/ces-shared/data/sprs-weights.json', canonical: 'src/data/sprs-weights.json' },
  { copy: 'muster-api/src/vendored/ces-shared/data/sprs-weights.json', canonical: 'src/data/sprs-weights.json' },
  { copy: 'muster-api/src/vendored/ces-shared/config/secretRef.ts', canonical: 'src/config/secretRef.ts' },
  { copy: 'muster-api/src/vendored/ces-shared/stack/index.ts', canonical: 'src/stack/index.ts' },
  { copy: 'muster-api/src/vendored/ces-shared/stack/StackProvider.ts', canonical: 'src/stack/StackProvider.ts' },
  {
    copy: 'muster-api/src/vendored/ces-shared/stack/providers/exampleStub.ts',
    canonical: 'src/stack/providers/exampleStub.ts',
  },
  {
    copy: 'muster-api/src/vendored/ces-shared/stack/providers/googleWorkspaceCloud.ts',
    canonical: 'src/stack/providers/googleWorkspaceCloud.ts',
  },
  {
    copy: 'muster-api/src/vendored/ces-shared/stack/providers/microsoftGccHigh.ts',
    canonical: 'src/stack/providers/microsoftGccHigh.ts',
  },
];

export type ParityStatus = 'match' | 'drift' | 'missing-copy' | 'missing-canonical';

export interface ParityResult extends SyncEntry {
  status: ParityStatus;
}

export interface ParityReport {
  repoRoot: string;
  canonicalRoot: string;
  /** False when the canonical ces-shared checkout is not present at all. */
  canonicalAvailable: boolean;
  results: ParityResult[];
  ok: boolean;
}

export interface SyncOptions {
  repoRoot?: string;
  canonicalRoot?: string;
  entries?: readonly SyncEntry[];
}

/** ces-muster repo root (this file lives in <root>/src/vendored; node-only, never imported by app code). */
export const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function resolveCanonicalRoot(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.CES_SHARED_ROOT?.trim();
  return path.resolve(fromEnv || path.join(repoRoot, '..', 'ces-shared'));
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function roots(opts: SyncOptions) {
  const repoRoot = path.resolve(opts.repoRoot ?? DEFAULT_REPO_ROOT);
  const canonicalRoot = path.resolve(opts.canonicalRoot ?? resolveCanonicalRoot(repoRoot));
  return { repoRoot, canonicalRoot, entries: opts.entries ?? SYNC_ENTRIES };
}

/** Byte-compare every vendored copy against its canonical file. */
export function checkParity(opts: SyncOptions = {}): ParityReport {
  const { repoRoot, canonicalRoot, entries } = roots(opts);
  const canonicalAvailable = fs.existsSync(path.join(canonicalRoot, 'package.json'));
  const results: ParityResult[] = entries.map((e) => {
    const canonPath = path.join(canonicalRoot, e.canonical);
    const copyPath = path.join(repoRoot, e.copy);
    if (!fs.existsSync(canonPath)) return { ...e, status: 'missing-canonical' };
    if (!fs.existsSync(copyPath)) return { ...e, status: 'missing-copy' };
    const same = fs.readFileSync(canonPath).equals(fs.readFileSync(copyPath));
    return { ...e, status: same ? 'match' : 'drift' };
  });
  return { repoRoot, canonicalRoot, canonicalAvailable, results, ok: results.every((r) => r.status === 'match') };
}

/**
 * Copy every canonical file over its vendored copy and re-pin the copy's hash in
 * vendor-manifest.json (only for paths already pinned there), so `check:drift`
 * and the parity check agree after a legitimate sync. Returns the copies changed.
 */
export function syncCopies(opts: SyncOptions = {}): string[] {
  const { repoRoot, canonicalRoot, entries } = roots(opts);
  const changed: string[] = [];
  const hashes: Record<string, string> = {};
  for (const e of entries) {
    const canonPath = path.join(canonicalRoot, e.canonical);
    if (!fs.existsSync(canonPath)) throw new Error(`canonical file missing: ${canonPath}`);
    const bytes = fs.readFileSync(canonPath);
    const copyPath = path.join(repoRoot, e.copy);
    if (!fs.existsSync(copyPath) || !fs.readFileSync(copyPath).equals(bytes)) {
      fs.mkdirSync(path.dirname(copyPath), { recursive: true });
      fs.writeFileSync(copyPath, bytes);
      changed.push(e.copy);
    }
    hashes[e.copy] = sha256(bytes);
  }
  const manifestPath = path.join(repoRoot, 'vendor-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    let next = raw;
    // Surgical: replace only the pinned hash strings, keep the file's formatting.
    for (const [copy, hash] of Object.entries(hashes)) {
      const key = JSON.stringify(copy);
      const re = new RegExp(`(${key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*:\\s*")[0-9a-f]{64}(")`);
      next = next.replace(re, `$1${hash}$2`);
    }
    if (next !== raw) fs.writeFileSync(manifestPath, next, 'utf-8');
  }
  return changed;
}

function main(argv: string[]): number {
  if (argv.includes('--write')) {
    const changed = syncCopies();
    console.log(changed.length ? `Synced ${changed.length} file(s):\n  ${changed.join('\n  ')}` : 'All copies already canonical.');
    return 0;
  }
  const report = checkParity();
  console.log(`ces-shared parity — canonical: ${report.canonicalRoot}`);
  for (const r of report.results) console.log(`  ${r.status.padEnd(17)} ${r.copy}`);
  if (!report.canonicalAvailable) {
    console.error('Canonical ces-shared checkout not found (set CES_SHARED_ROOT).');
    return 1;
  }
  if (!report.ok) {
    console.error('DRIFT: run `npx tsx src/vendored/cesSharedSync.ts --write` after checking which side is right.');
    return 1;
  }
  console.log('All vendored ces-shared copies match canonical.');
  return 0;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  !!process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
