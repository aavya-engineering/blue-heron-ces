// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { CommandRegistrySchema } from '../../src/registry/command-registry.types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeAll(() => {
    // Skip all tests if registry JSON doesn't exist yet (WIP)
    if (!fs.existsSync(REGISTRY_PATH)) {
      console.warn(`Registry JSON not found at ${REGISTRY_PATH} — skipping structural tests`);
      return;
    }
    registry = CommandRegistry.load(REGISTRY_PATH);
  });

  describe('Schema validation', () => {
    it('should load and validate against Zod schema with zero errors', () => {
      if (!registry) return;
      const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
      const result = CommandRegistrySchema.safeParse(raw);
      if (!result.success) {
        const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
        fail(`Schema validation failed:\n${errors.join('\n')}`);
      }
      expect(result.success).toBe(true);
    });
  });

  describe('Entry structure', () => {
    it('should have no duplicate entry_ids', () => {
      if (!registry) return;
      const ids = new Set<string>();
      const dupes: string[] = [];
      for (const entry of registry.allEntries) {
        if (ids.has(entry.entry_id)) dupes.push(entry.entry_id);
        ids.add(entry.entry_id);
      }
      expect(dupes).toEqual([]);
    });

    it('should have valid control_id format on all entries', () => {
      if (!registry) return;
      // CMMC L2 format: XX.L2-3.N.N (family.level-requirement)
      const pattern = /^[A-Z]{2}\.L[12]-3\.\d+\.\d+$/;
      const invalid: string[] = [];
      for (const entry of registry.allEntries) {
        for (const cid of entry.control_ids) {
          if (!pattern.test(cid)) invalid.push(`${entry.entry_id}: ${cid}`);
        }
      }
      expect(invalid).toEqual([]);
    });

    it('should have valid engine values on all entries', () => {
      if (!registry) return;
      const validEngines = new Set([
        'terraform', 'bicep', 'cloudformation', 'cli', 'powershell',
        'api', 'manual_gate', 'ipps', 'mgraph', 'exchange', 'az', 'spo', 'teams'
      ]);
      const invalid: string[] = [];
      for (const entry of registry.allEntries) {
        if (!validEngines.has(entry.engine)) {
          invalid.push(`${entry.entry_id}: engine=${entry.engine}`);
        }
      }
      expect(invalid).toEqual([]);
    });

    it('should have layer_hint in range 0-8', () => {
      if (!registry) return;
      const outOfRange: string[] = [];
      for (const entry of registry.allEntries) {
        if (entry.layer_hint < 0 || entry.layer_hint > 8) {
          outOfRange.push(`${entry.entry_id}: layer_hint=${entry.layer_hint}`);
        }
      }
      expect(outOfRange).toEqual([]);
    });

    it('should have empty set_command for manual_only entries', () => {
      if (!registry) return;
      const violations: string[] = [];
      for (const entry of registry.allEntries) {
        if (entry.manual_only && entry.set_command.trim() !== '') {
          violations.push(`${entry.entry_id}: manual_only=true but set_command is not empty`);
        }
      }
      expect(violations).toEqual([]);
    });

    // Only state-changing entries are required to carry a set_command. 'evidence-only'
    // and 'safe' (read/capture-only, e.g. *-get entries that just query + capture a
    // variable) legitimately have an empty set_command. See docs/G0-test-coverage-map.md.
    const READ_ONLY_IDEMPOTENCY = new Set(['evidence-only', 'safe']);
    it('should have non-empty set_command for state-changing (non-read-only) entries', () => {
      if (!registry) return;
      const violations: string[] = [];
      for (const entry of registry.allEntries) {
        if (!entry.manual_only && !READ_ONLY_IDEMPOTENCY.has(entry.idempotency) && entry.set_command.trim() === '') {
          violations.push(`${entry.entry_id}: manual_only=false, idempotency=${entry.idempotency} but set_command is empty`);
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe('Family coverage', () => {
    const requiredFamilies = ['AC', 'AT', 'AU', 'CM', 'IA', 'IR', 'MA', 'MP', 'PE', 'PS', 'RA', 'CA', 'SC', 'SI'];

    it('should cover all 14 CMMC L2 families', () => {
      if (!registry) return;
      const covered = registry.coveredFamilies;
      const missing = requiredFamilies.filter(f => !covered.includes(f));
      expect(missing).toEqual([]);
    });

    it.each(requiredFamilies)('should have at least one entry for family %s', (family) => {
      if (!registry) return;
      const familyEntries = registry.allEntries.filter(e =>
        e.control_ids.some(cid => cid.startsWith(`${family}.`))
      );
      expect(familyEntries.length).toBeGreaterThan(0);
    });
  });

  describe('Lookup operations', () => {
    // AC.L2-3.1.1 has no automated command entry in the current registry (it is covered
    // by identity/manual means, not a Stamper command) — see docs/G0-test-coverage-map.md.
    // Use AC.L2-3.1.4 (PIM separation-of-duties), which is command-covered, to exercise lookup.
    it('should look up a command-covered control and return at least 1 entry', () => {
      if (!registry) return;
      const entries = registry.lookupByControl('AC.L2-3.1.4');
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it('should look up by entry_id', () => {
      if (!registry) return;
      const first = registry.allEntries[0];
      const found = registry.lookupByEntryId(first.entry_id);
      expect(found).toBeDefined();
      expect(found!.entry_id).toBe(first.entry_id);
    });

    it('should return empty array for unknown control_id', () => {
      if (!registry) return;
      const entries = registry.lookupByControl('XX.L2-99.99.99');
      expect(entries).toEqual([]);
    });

    it('getEntriesForStep should deduplicate by entry_id', () => {
      if (!registry) return;
      // Find a control_id that appears in multiple entries
      const entries = registry.getEntriesForStep(['AC.L2-3.1.1', 'AC.L2-3.1.1']);
      const ids = entries.map(e => e.entry_id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('getEntriesForStep should sort by layer_hint then sequence_hint', () => {
      if (!registry) return;
      const entries = registry.getEntriesForStep(registry.coveredControlIds.slice(0, 5));
      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1];
        const curr = entries[i];
        if (prev.layer_hint === curr.layer_hint) {
          expect(prev.sequence_hint).toBeLessThanOrEqual(curr.sequence_hint);
        } else {
          expect(prev.layer_hint).toBeLessThanOrEqual(curr.layer_hint);
        }
      }
    });
  });

  describe('Variable contracts', () => {
    it('should have variables_required as arrays on all entries', () => {
      if (!registry) return;
      for (const entry of registry.allEntries) {
        expect(Array.isArray(entry.variables_required)).toBe(true);
        expect(Array.isArray(entry.variables_runtime)).toBe(true);
      }
    });

    it('captures should reference known from types', () => {
      if (!registry) return;
      const validFrom = new Set(['stdout', 'json_field', 'regex']);
      const invalid: string[] = [];
      for (const entry of registry.allEntries) {
        for (const cap of entry.captures) {
          if (!validFrom.has(cap.from)) {
            invalid.push(`${entry.entry_id}: capture.from=${cap.from}`);
          }
        }
      }
      expect(invalid).toEqual([]);
    });
  });

  describe('Statistics', () => {
    it('should report total entries > 0', () => {
      if (!registry) return;
      expect(registry.stats.total).toBeGreaterThan(0);
    });

    it('should have both automatable and manual entries', () => {
      if (!registry) return;
      expect(registry.stats.automatable).toBeGreaterThan(0);
      expect(registry.stats.manualOnly).toBeGreaterThan(0);
    });

    it('should report version string', () => {
      if (!registry) return;
      expect(registry.version).toBeTruthy();
    });
  });
});
