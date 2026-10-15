#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * migrate-artifacts.mjs
 * Migrates workspace-local artifact directories to the unified CES pipeline root.
 *
 * Default mode: --dry-run (lists planned moves, writes docs/context/MIGRATION_REPORT.json)
 * --apply: copy → verify (size + SHA-256 hash) → unlink source; idempotent
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const isDryRun = !process.argv.includes('--apply');

// Resolve CES_PIPELINE_ROOT with same logic as node.ts
const DEFAULT_ROOT =
  process.platform === 'win32' ? 'C:\\CES_Pipeline' : path.join(process.cwd(), 'ces-pipeline');
const CES_PIPELINE_ROOT = path.resolve(process.env.CES_PIPELINE_ROOT || DEFAULT_ROOT);

/**
 * Source-to-destination mapping rules.
 * Each entry describes a glob-like source pattern and its destination root.
 * Expansion is done by walkDir below.
 */
const MAPPING_RULES = [
  {
    label: 'Stamper run logs',
    srcGlob: path.join(REPO_ROOT, 'stamper'),
    pattern: /^run-log-.+\.json$/,
    destRoot: path.join(CES_PIPELINE_ROOT, 'Stamper', 'plan-data', 'dev', 'logs'),
    flatDest: true,
  },
  {
    label: 'Stamper plan-data',
    srcGlob: path.join(REPO_ROOT, 'stamper', 'plan-data'),
    destRoot: path.join(CES_PIPELINE_ROOT, 'Stamper', 'plan-data'),
    flatDest: false,
  },
  {
    label: 'Stamper storage',
    srcGlob: path.join(REPO_ROOT, 'stamper', 'storage'),
    destRoot: path.join(CES_PIPELINE_ROOT, 'Stamper', 'storage'),
    flatDest: false,
  },
  {
    label: 'Planner customers',
    srcGlob: path.join(REPO_ROOT, 'cse-fe-v2', 'customers'),
    destRoot: path.join(CES_PIPELINE_ROOT, 'Planner', 'customers'),
    flatDest: false,
  },
  {
    label: 'EvidenceOps storage (cse-eo-recover)',
    srcGlob: path.join(REPO_ROOT, 'cse-eo-recover', 'storage'),
    destRoot: path.join(CES_PIPELINE_ROOT, 'EvidenceOps', 'storage'),
    flatDest: false,
  },
  {
    label: 'AdminOps storage',
    srcGlob: path.join(REPO_ROOT, 'cse-ao', 'storage'),
    destRoot: path.join(CES_PIPELINE_ROOT, 'AdminOps', 'storage'),
    flatDest: false,
  },
];

/** Recursively walk a directory and yield absolute file paths. */
async function* walkDir(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return; // directory does not exist — skip silently
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full);
    } else {
      yield full;
    }
  }
}

/** Compute SHA-256 hash of a file, returned as hex string. */
async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function buildMoves() {
  const moves = [];

  for (const rule of MAPPING_RULES) {
    if (rule.pattern) {
      // Flat-dest rule: scan srcGlob directory for files matching pattern
      const srcDir = rule.srcGlob;
      let entries;
      try {
        entries = await fsp.readdir(srcDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !rule.pattern.test(entry.name)) continue;
        const src = path.join(srcDir, entry.name);
        const dest = path.join(rule.destRoot, entry.name);
        moves.push({ label: rule.label, src, dest });
      }
    } else {
      // Tree rule: walk srcGlob and mirror structure under destRoot
      const srcRoot = rule.srcGlob;
      for await (const src of walkDir(srcRoot)) {
        const rel = path.relative(srcRoot, src);
        const dest = path.join(rule.destRoot, rel);
        moves.push({ label: rule.label, src, dest });
      }
    }
  }

  return moves;
}

async function applyMove(src, dest) {
  const destDir = path.dirname(dest);
  await fsp.mkdir(destDir, { recursive: true });

  // Idempotency: skip if dest exists with same size and hash
  let srcStat;
  try {
    srcStat = await fsp.stat(src);
  } catch {
    return { status: 'src_missing', src, dest };
  }

  try {
    const destStat = await fsp.stat(dest);
    if (destStat.size === srcStat.size) {
      const [srcHash, destHash] = await Promise.all([sha256File(src), sha256File(dest)]);
      if (srcHash === destHash) {
        return { status: 'skipped_idempotent', src, dest };
      }
    }
  } catch {
    // dest does not exist — proceed with copy
  }

  // Copy
  await fsp.copyFile(src, dest);

  // Verify
  const destStat = await fsp.stat(dest);
  if (destStat.size !== srcStat.size) {
    return { status: 'verify_size_mismatch', src, dest };
  }
  const [srcHash, destHash] = await Promise.all([sha256File(src), sha256File(dest)]);
  if (srcHash !== destHash) {
    return { status: 'verify_hash_mismatch', src, dest };
  }

  // Unlink source
  await fsp.unlink(src);
  return { status: 'moved', src, dest };
}

async function main() {
  console.log(`CES Artifact Migration — mode: ${isDryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Pipeline root: ${CES_PIPELINE_ROOT}\n`);

  const moves = await buildMoves();

  if (moves.length === 0) {
    console.log('No source artifacts found to migrate.');
  } else {
    console.log(`Found ${moves.length} file(s) to migrate:`);
    for (const m of moves) {
      console.log(`  [${m.label}] ${m.src}\n    → ${m.dest}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: isDryRun ? 'dry-run' : 'apply',
    pipelineRoot: CES_PIPELINE_ROOT,
    totalFiles: moves.length,
    moves: [],
    errors: [],
  };

  if (!isDryRun) {
    console.log('\nApplying moves...');
    for (const m of moves) {
      const result = await applyMove(m.src, m.dest);
      console.log(`  ${result.status}: ${path.basename(m.src)}`);
      if (result.status === 'verify_size_mismatch' || result.status === 'verify_hash_mismatch') {
        report.errors.push(result);
      } else {
        report.moves.push(result);
      }
    }
    if (report.errors.length > 0) {
      console.error(`\n${report.errors.length} verification error(s) — check MIGRATION_REPORT.json`);
      process.exitCode = 1;
    } else {
      console.log(`\nDone. ${report.moves.length} file(s) processed.`);
    }
  } else {
    report.moves = moves.map((m) => ({ status: 'planned', src: m.src, dest: m.dest }));
  }

  const reportPath = path.join(REPO_ROOT, 'docs', 'context', 'MIGRATION_REPORT.json');
  await fsp.mkdir(path.dirname(reportPath), { recursive: true });
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport written to: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
