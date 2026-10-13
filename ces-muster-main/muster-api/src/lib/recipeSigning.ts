// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// recipeSigning.ts — recipe signature helpers.
//
// signRecipe(dir)  — computes SHA256 of the recipe script file and embeds it
//   in the manifest's sha256 field. Returns the updated manifest object plus
//   the SHA256 of the resulting manifest JSON. Does NOT write to disk; caller
//   is responsible for persisting if needed.
//
// verifyRecipe(dir | {script, manifest}) — recomputes SHA256 of the script
//   and compares it to manifest.sha256. Returns {valid, reason?}.
//
// RECIPES_DIR — resolved path to the recipes/ directory. Configurable via the
//   RECIPES_DIR environment variable; defaults to ../../../recipes relative to
//   this file (i.e., ces-muster/recipes/ from muster-api/src/lib/).

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// __dirname is available in CJS output (NodeNext without "type":"module" in package.json).
// Resolves to ces-muster/recipes/ from both src/ (vitest) and dist/ (compiled) contexts.
export const RECIPES_DIR: string =
  process.env.RECIPES_DIR ?? resolve(__dirname, '../../../recipes');

// ── Public types ──────────────────────────────────────────────────────────────

export interface RecipeManifest {
  name: string;
  version: string;
  description: string;
  output_maps_to: Array<{
    question_id: string;
    when: string;
  }>;
  read_only: boolean;
  sha256: string; // SHA256 hex digest of the recipe script file
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Computes SHA256 of content and returns the hex digest string.
 */
export function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Finds the recipe script file in a directory (recipe.ps1 first, then recipe.sh).
 * Throws if neither exists.
 */
export function findScriptFile(dir: string): string {
  const ps1 = join(dir, 'recipe.ps1');
  if (existsSync(ps1)) return ps1;
  const sh = join(dir, 'recipe.sh');
  if (existsSync(sh)) return sh;
  throw new Error(`No recipe script found in ${dir} (tried recipe.ps1, recipe.sh)`);
}

// ── signRecipe ────────────────────────────────────────────────────────────────

/**
 * Computes SHA256 of the recipe script file and embeds it in the manifest's
 * sha256 field. Also computes SHA256 of the resulting manifest JSON for use
 * in INDEX.json. Does NOT write to disk.
 *
 * @param dir - Directory containing recipe.ps1 (or .sh) and manifest.json.
 */
export function signRecipe(dir: string): { manifest: RecipeManifest; manifest_sha256: string } {
  const scriptPath = findScriptFile(dir);
  const scriptContent = readFileSync(scriptPath);
  const scriptHash = sha256Hex(scriptContent);

  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RecipeManifest;
  manifest.sha256 = scriptHash;

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestHash = sha256Hex(Buffer.from(manifestJson, 'utf-8'));

  return { manifest, manifest_sha256: manifestHash };
}

// ── verifyRecipe ──────────────────────────────────────────────────────────────

/**
 * Verifies that the recipe script's SHA256 matches the sha256 recorded in
 * the manifest.
 *
 * Accepts either:
 *   - a directory path string: reads recipe script and manifest from disk
 *   - an object `{script, manifest}`: uses provided bytes (for testing)
 *
 * Returns {valid: true} on match, or {valid: false, reason} on mismatch.
 */
export function verifyRecipe(
  input: string | { script: Buffer; manifest: RecipeManifest }
): VerifyResult {
  let scriptContent: Buffer;
  let manifest: RecipeManifest;

  if (typeof input === 'string') {
    const scriptPath = findScriptFile(input);
    scriptContent = readFileSync(scriptPath);
    const manifestPath = join(input, 'manifest.json');
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RecipeManifest;
  } else {
    scriptContent = input.script;
    manifest = input.manifest;
  }

  const computed = sha256Hex(scriptContent);
  if (computed !== manifest.sha256) {
    return {
      valid: false,
      reason: `sha256 mismatch: manifest records ${manifest.sha256}, script computed ${computed}`,
    };
  }
  return { valid: true };
}
