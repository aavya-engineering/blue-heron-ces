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
 * migrate-evidence-to-json.ts
 *
 * Migration utility to convert existing .txt evidence files to .json structured format.
 *
 * Usage:
 *   npm run migrate-evidence          // Convert .txt to .json, keep originals
 *   npm run migrate-evidence --delete-originals  // Convert and delete .txt files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { StructuredEvidence, EvidenceOutcome } from '../src/types/schema.types';

const deleteOriginals = process.argv.includes('--delete-originals');

interface MigrationStats {
  total: number;
  converted: number;
  skipped: number;
  deleted: number;
}

function getTenantDirectories(): string[] {
  const tenantsDir = path.join(os.homedir(), '.stamper', 'tenants');
  if (!fs.existsSync(tenantsDir)) {
    return [];
  }

  const entries = fs.readdirSync(tenantsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

function migrateTxtToJson(filePath: string): { success: boolean; reason?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const stat = fs.statSync(filePath);

    // Validate UTF-8 encoding (heuristic: check for null bytes)
    if (content.includes('\0')) {
      return { success: false, reason: 'corrupted (contains null bytes)' };
    }

    // Build StructuredEvidence envelope with outcome=unknown_legacy
    const sha256Hash = createHash('sha256').update(content, 'utf8').digest('hex');
    const evidence: StructuredEvidence = {
      rawResponse: content,
      outcome: 'unknown_legacy' as EvidenceOutcome,
      outcomeRationale: 'Migrated from legacy .txt evidence',
      metadata: {
        controlIds: [],
        timestamp: stat.mtime.toISOString(),
        executorIdentity: 'unknown',
        commandExecuted: 'unknown',
        sha256Hash
      }
    };

    // Write .json file
    const jsonPath = filePath.replace(/\.txt$/, '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf-8');

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, reason: msg };
  }
}

function migrateEvidenceDirectory(evidenceDir: string, stats: MigrationStats): void {
  if (!fs.existsSync(evidenceDir)) {
    return;
  }

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.txt')) {
        stats.total++;
        const result = migrateTxtToJson(fullPath);
        if (result.success) {
          stats.converted++;
          console.log(`✓ Converted: ${fullPath}`);

          // Delete original if --delete-originals flag is set
          if (deleteOriginals) {
            try {
              fs.unlinkSync(fullPath);
              stats.deleted++;
              console.log(`  → Deleted original: ${fullPath}`);
            } catch {
              console.warn(`  ⚠ Could not delete original: ${fullPath}`);
            }
          }
        } else {
          stats.skipped++;
          console.warn(`✗ Skipping corrupted file: ${fullPath} (${result.reason})`);
        }
      }
    }
  };

  walk(evidenceDir);
}

function main(): void {
  console.log('='.repeat(60));
  console.log('Evidence Migration: .txt → .json (Structured Evidence)');
  console.log('='.repeat(60));
  console.log(`Delete originals: ${deleteOriginals ? 'YES' : 'NO'}`);
  console.log('');

  const stats: MigrationStats = { total: 0, converted: 0, skipped: 0, deleted: 0 };

  // Migrate tenant evidence directories
  const tenants = getTenantDirectories();
  console.log(`Found ${tenants.length} tenant(s)`);
  console.log('');

  for (const tenant of tenants) {
    const evidenceDir = path.join(os.homedir(), '.stamper', 'tenants', tenant, 'evidence');
    console.log(`[${tenant}] Scanning ${evidenceDir}...`);
    migrateEvidenceDirectory(evidenceDir, stats);
    console.log('');
  }

  // Also migrate dev evidence directory
  const devEvidenceDir = path.join(os.homedir(), '.stamper', 'evidence');
  if (fs.existsSync(devEvidenceDir)) {
    console.log('[dev] Scanning legacy evidence directory...');
    migrateEvidenceDirectory(devEvidenceDir, stats);
    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));
  console.log(`Total .txt files:  ${stats.total}`);
  console.log(`Converted to .json: ${stats.converted}`);
  console.log(`Skipped (corrupt):  ${stats.skipped}`);
  console.log(`Deleted originals:  ${stats.deleted}`);
  console.log('');

  if (stats.total === 0) {
    console.log('No .txt evidence files found.');
  } else if (stats.converted === stats.total) {
    console.log('✓ Migration complete!');
  } else {
    console.log(`⚠ Migration completed with ${stats.skipped} skipped files.`);
  }
}

main();
