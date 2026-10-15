// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadCmmcControlCodes,
  validateRegistryCmmcPractices,
  validateRegistryAtLoad,
} from '../src/registry/RegistryBridge.js';
import { makeAoCommand } from './fixtures.js';

/** Recursively walk a directory, returning absolute file paths (no shell-out, Windows-portable). */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe('validateRegistryCmmcPractices', () => {
  it('(e) detects an invalid practice code in a synthetic registry', () => {
    const validCodes = new Set(['AC.L2-3.1.5', 'IA.L2-3.5.3']);
    const commands = [
      makeAoCommand({ id: 'X-01', cmmcPractices: ['AC.L2-3.1.5'] }),
      makeAoCommand({ id: 'X-02', cmmcPractices: ['ZZ.L2-9.9.9'] }),
    ];

    const result = validateRegistryCmmcPractices(commands, validCodes);

    expect(result.valid).toBe(false);
    expect(result.violations).toContainEqual({ commandId: 'X-02', practiceCode: 'ZZ.L2-9.9.9' });
  });

  it('reports valid: true and an empty violations array for an all-valid registry', () => {
    const validCodes = new Set(['AC.L2-3.1.5', 'IA.L2-3.5.3']);
    const commands = [
      makeAoCommand({ id: 'X-01', cmmcPractices: ['AC.L2-3.1.5'] }),
      makeAoCommand({ id: 'X-02', cmmcPractices: ['IA.L2-3.5.3'] }),
    ];

    const result = validateRegistryCmmcPractices(commands, validCodes);

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('loadCmmcControlCodes', () => {
  it('reads the real sibling reference file and contains a known control_id', () => {
    const codes = loadCmmcControlCodes();
    expect(codes.has('AC.L2-3.1.5')).toBe(true);
  });
});

describe('(f) G6 closure — dead-field grep test', () => {
  it('finds zero references to infrastructure_model/excluded_entries in src/execution and src/server', () => {
    const executionDir = path.resolve(__dirname, '..', 'src', 'execution');
    const serverDir = path.resolve(__dirname, '..', 'src', 'server');
    const files = [...walk(executionDir), ...walk(serverDir)];

    const matches: { file: string; needle: string }[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const needle of ['infrastructure_model', 'excluded_entries']) {
        if (content.includes(needle)) {
          matches.push({ file, needle });
        }
      }
    }

    expect(matches).toEqual([]);
  });
});

// GP-AO-BOUND-1 M2 — strict flip (founder-confirmed): load-time validation
// THROWS on an unresolvable practice code, and the live registry is clean.
describe('validateRegistryAtLoad — strict mode', () => {
  it('throws on a registry containing an unresolvable practice code', () => {
    const commands = [makeAoCommand({ id: 'X-99', cmmcPractices: ['ZZ.L2-9.9.9'] })];
    expect(() => validateRegistryAtLoad(commands)).toThrow(/ZZ\.L2-9\.9\.9/);
  });

  it('accepts the LIVE ao-commands registry (0 violations after the M2a data fix)', () => {
    const regPath = path.resolve(__dirname, '..', 'src', 'registry', 'ao-commands.registry.json');
    const commands = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
    expect(() => validateRegistryAtLoad(commands)).not.toThrow();
  });
});
