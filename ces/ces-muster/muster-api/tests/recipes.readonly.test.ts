// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * recipes.readonly.test.ts — DONE-WHEN #2: static assertion that every
 * CaptureRecipe script contains NO write, delete, or configuration-change
 * operations.
 *
 * The tokenizer is CONSERVATIVE (fail-closed): any non-comment line containing
 * a forbidden token causes the test to fail. Comment lines (trimmed start with
 * '#' or '//') are whitelisted.
 *
 * Forbidden token list (case-insensitive, as specified in DONE-WHEN #2):
 *   Set-, New-, Remove-, Add-, Update-, Disable-, Enable-,
 *   Install-, Uninstall-,
 *   Invoke-WebRequest with -Method Post/Put/Delete,
 *   Out-File, Set-Content, Add-Content,
 *   >> (append redirect), > (write redirect, not >=),
 *   rm , del , mkdir, reg add, netsh
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname_tests = dirname(__filename);

const RECIPES_DIR = process.env.RECIPES_DIR ?? resolve(__dirname_tests, '../../recipes');

// ── Forbidden token patterns ───────────────────────────────────────────────────

interface ForbiddenPattern {
  name: string;
  re: RegExp;
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  { name: 'Set-* cmdlet',       re: /\bSet-/i },
  { name: 'New-* cmdlet',       re: /\bNew-/i },
  { name: 'Remove-* cmdlet',    re: /\bRemove-/i },
  { name: 'Add-* cmdlet',       re: /\bAdd-/i },
  { name: 'Update-* cmdlet',    re: /\bUpdate-/i },
  { name: 'Disable-* cmdlet',   re: /\bDisable-/i },
  { name: 'Enable-* cmdlet',    re: /\bEnable-/i },
  { name: 'Install-* cmdlet',   re: /\bInstall-/i },
  { name: 'Uninstall-* cmdlet', re: /\bUninstall-/i },
  {
    name: 'Invoke-WebRequest -Method POST/PUT/DELETE',
    re: /\bInvoke-WebRequest\b[^\n]*-Method\s+(Post|Put|Delete)\b/i,
  },
  {
    // CRITIQUE_P2 D2: Invoke-RestMethod makes identical mutating HTTP
    // requests — ban it the same way (Patch included as extra caution).
    name: 'Invoke-RestMethod -Method POST/PUT/DELETE/PATCH',
    re: /\bInvoke-RestMethod\b[^\n]*-Method\s+(Post|Put|Delete|Patch)\b/i,
  },
  { name: 'Out-File',           re: /\bOut-File\b/i },
  { name: 'Set-Content',        re: /\bSet-Content\b/i },
  { name: 'Add-Content',        re: /\bAdd-Content\b/i },
  { name: '>> (append redirect)', re: />>/ },
  { name: '> (write redirect)',   re: />(?!>|=)/ },  // > not followed by > or =
  { name: 'rm command',          re: /\brm\s/i },
  { name: 'del command',         re: /\bdel\s/i },
  { name: 'mkdir command',       re: /\bmkdir\b/i },
  { name: 'reg add command',     re: /\breg\s+add\b/i },
  { name: 'netsh command',       re: /\bnetsh\b/i },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  // PowerShell: # and <# ... #> block comments; also skip blank lines
  return trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//');
}

interface Violation {
  lineNumber: number;
  lineText: string;
  pattern: string;
}

function checkScript(content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isCommentLine(line)) continue;

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.re.test(line)) {
        violations.push({
          lineNumber: i + 1,
          lineText: line.trimEnd(),
          pattern: pattern.name,
        });
        break; // Only report the first match per line (avoid duplicate entries)
      }
    }
  }
  return violations;
}

function collectRecipes(): Array<{ name: string; scriptPath: string }> {
  const entries = readdirSync(RECIPES_DIR, { withFileTypes: true });
  const recipes: Array<{ name: string; scriptPath: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'INDEX.json') continue;

    const dir = join(RECIPES_DIR, entry.name);

    // Try recipe.ps1, then recipe.sh
    for (const filename of ['recipe.ps1', 'recipe.sh']) {
      const scriptPath = join(dir, filename);
      try {
        const stat = statSync(scriptPath);
        if (stat.isFile()) {
          recipes.push({ name: entry.name, scriptPath });
          break;
        }
      } catch {
        // not found, try next
      }
    }
  }

  return recipes;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CaptureRecipe static read-only assertion (DONE-WHEN #2)', () => {
  it('recipes/ directory exists and contains at least 3 recipes', () => {
    const recipes = collectRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(3);
  });

  const recipes = collectRecipes();

  for (const { name, scriptPath } of recipes) {
    describe(`recipe: ${name}`, () => {
      it('script file is readable', () => {
        const content = readFileSync(scriptPath, 'utf-8');
        expect(content.length).toBeGreaterThan(0);
      });

      it('no forbidden write/delete/config-change tokens in non-comment lines', () => {
        const content = readFileSync(scriptPath, 'utf-8');
        const violations = checkScript(content);

        if (violations.length > 0) {
          const report = violations
            .map((v) => `  line ${v.lineNumber} [${v.pattern}]: ${v.lineText}`)
            .join('\n');
          throw new Error(
            `Recipe '${name}' contains forbidden tokens:\n${report}`
          );
        }

        expect(violations).toHaveLength(0);
      });
    });
  }
});
