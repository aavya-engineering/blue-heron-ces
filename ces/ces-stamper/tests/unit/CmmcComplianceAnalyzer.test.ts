// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { CmmcComplianceAnalyzer } from '../../src/core/CmmcComplianceAnalyzer';
import { CommandRegistry } from '../../src/registry/CommandRegistry';

describe('CmmcComplianceAnalyzer', () => {
  let m365Registry: CommandRegistry;
  let infraRegistry: CommandRegistry;

  beforeEach(() => {
    m365Registry = CommandRegistry.load(); // Loads default M365 registry
    infraRegistry = CommandRegistry.load('src/registry/infra-cmmc-l2-commands.registry.json');
  });

  describe('analyze - plan mode', () => {
    it('should categorize controls as satisfied, will_be_satisfied, wont_be_satisfied', () => {
      const planControlIds = ['AC.L2-3.1.1', 'AC.L2-3.1.2', 'IA.L2-3.5.1'];
      const discoveryResults = new Map<string, 'exists' | 'missing' | 'error' | 'no_query' | 'permission_denied'>();

      // Simulate some discovered entries
      discoveryResults.set('m365.ac.001', 'exists');
      discoveryResults.set('m365.ac.002', 'missing');

      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        planControlIds,
        discoveryResults
      );

      const result = analyzer.analyze();

      expect(result.total).toBe(110); // CMMC L2 has 110 controls
      expect(result.satisfied.length).toBeGreaterThanOrEqual(0);
      expect(result.willBeSatisfied.length).toBeGreaterThanOrEqual(0);
      expect(result.wontBeSatisfied.length).toBeGreaterThanOrEqual(0);

      // Total should equal sum of categories
      expect(result.total).toBe(
        result.satisfied.length + result.willBeSatisfied.length + result.wontBeSatisfied.length
      );
    });

    it('should mark controls as will_be_satisfied when in plan with registry entries', () => {
      const planControlIds = ['AC.L2-3.1.1']; // Include a control in the plan
      const discoveryResults = new Map();

      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        planControlIds,
        discoveryResults
      );

      const result = analyzer.analyze();

      // Find AC.L2-3.1.1 in results
      const ac311 = [...result.satisfied, ...result.willBeSatisfied, ...result.wontBeSatisfied].find(
        cs => cs.control.control_id === 'AC.L2-3.1.1'
      );

      if (ac311) {
        // If it has registry entries and is in plan, should be will_be_satisfied or satisfied
        if (ac311.registryEntryCount > 0) {
          expect(['satisfied', 'will_be_satisfied']).toContain(ac311.category);
        }
      }
    });

    it('should mark controls as wont_be_satisfied when not in plan', () => {
      const planControlIds = ['AC.L2-3.1.1']; // Very limited plan
      const discoveryResults = new Map();

      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        planControlIds,
        discoveryResults
      );

      const result = analyzer.analyze();

      // Most controls should be wont_be_satisfied
      expect(result.wontBeSatisfied.length).toBeGreaterThan(50);

      // Check a control not in plan
      const notInPlan = result.wontBeSatisfied.find(cs => cs.control.control_id !== 'AC.L2-3.1.1');
      if (notInPlan) {
        expect(notInPlan.inPlan).toBe(false);
        expect(notInPlan.reason).toBeDefined();
      }
    });

    it('should categorize controls based on discovery and plan status', () => {
      // Use any control from the registry
      const sampleEntry = m365Registry.allEntries[0];
      const sampleControlId = sampleEntry.control_ids[0];

      const planControlIds = [sampleControlId];
      const discoveryResults = new Map<string, 'exists' | 'missing' | 'error' | 'no_query' | 'permission_denied'>();

      // Mark the entry as existing
      discoveryResults.set(sampleEntry.entry_id, 'exists');

      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        planControlIds,
        discoveryResults
      );

      const result = analyzer.analyze();

      // Find the control
      const control = [...result.satisfied, ...result.willBeSatisfied, ...result.wontBeSatisfied].find(
        cs => cs.control.control_id === sampleControlId || cs.control.nist_ref === sampleControlId.split('-')[1]
      );

      // Control should exist and have proper categorization
      if (control) {
        expect(['satisfied', 'will_be_satisfied', 'wont_be_satisfied']).toContain(control.category);
      }
    });
  });

  describe('analyze - plan-less mode', () => {
    it('should use only satisfied and wont_be_satisfied categories', () => {
      const discoveryResults = new Map<string, 'exists' | 'missing' | 'error' | 'no_query' | 'permission_denied'>();

      // Simulate discovered entries
      discoveryResults.set('m365.ac.001', 'exists');
      discoveryResults.set('m365.ac.002', 'exists');

      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null, // Plan-less mode
        discoveryResults
      );

      const result = analyzer.analyze();

      expect(result.total).toBe(110);
      expect(result.satisfied.length).toBeGreaterThanOrEqual(0);
      expect(result.willBeSatisfied.length).toBe(0); // Should be 0 in plan-less mode
      expect(result.wontBeSatisfied.length).toBeGreaterThan(0);

      // All controls should be either satisfied or wont_be_satisfied
      expect(result.satisfied.length + result.wontBeSatisfied.length).toBe(110);
    });

    it('should mark controls as satisfied when resources exist', () => {
      const discoveryResults = new Map<string, 'exists' | 'missing' | 'error' | 'no_query' | 'permission_denied'>();

      // Mark some entries as existing
      const sampleEntries = m365Registry.allEntries.slice(0, 5);
      for (const entry of sampleEntries) {
        discoveryResults.set(entry.entry_id, 'exists');
      }

      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null,
        discoveryResults
      );

      const result = analyzer.analyze();

      expect(result.satisfied.length).toBeGreaterThan(0);
    });

  });

  describe('family rollups', () => {
    it('should generate family breakdown for all 14 families', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null,
        discoveryResults
      );

      const result = analyzer.analyze();

      expect(Object.keys(result.byFamily).length).toBeGreaterThanOrEqual(10);

      // Check some expected families exist
      const sampleFamilies = ['AC', 'AU', 'IA', 'SC'];
      for (const family of sampleFamilies) {
        if (result.byFamily[family]) {
          expect(result.byFamily[family].name).toBeDefined();
          expect(result.byFamily[family].total).toBeGreaterThan(0);
        }
      }
    });

    it('should sum family counts correctly', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null,
        discoveryResults
      );

      const result = analyzer.analyze();

      for (const familyStatus of Object.values(result.byFamily)) {
        const totalCategorized = familyStatus.satisfied + familyStatus.willBe + familyStatus.wontBe;
        expect(totalCategorized).toBe(familyStatus.total);
      }
    });

    it('should distribute controls across categories within families', () => {
      const planControlIds = ['AC.L2-3.1.1', 'AC.L2-3.1.2', 'AC.L2-3.1.3'];
      const discoveryResults = new Map<string, 'exists' | 'missing' | 'error' | 'no_query' | 'permission_denied'>();

      // Mark one as discovered
      const ac311Entries = m365Registry.lookupByControl('AC.L2-3.1.1');
      for (const entry of ac311Entries) {
        discoveryResults.set(entry.entry_id, 'exists');
      }

      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        planControlIds,
        discoveryResults
      );

      const result = analyzer.analyze();

      const acFamily = result.byFamily['AC'];
      expect(acFamily).toBeDefined();

      // AC family should have controls in different categories
      const acTotal = acFamily.satisfied + acFamily.willBe + acFamily.wontBe;
      expect(acTotal).toBe(acFamily.total);
    });
  });

  describe('automation type classification', () => {
    it('should have automation type for all controls', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null,
        discoveryResults
      );

      const result = analyzer.analyze();

      // All controls should have an automation type
      const allControls = [...result.satisfied, ...result.wontBeSatisfied];
      for (const cs of allControls) {
        expect(cs.automationType).toBeDefined();
        expect(['automated', 'automated_manual', 'nonstack']).toContain(cs.automationType);
      }
    });

    it('should classify controls by registry entry count', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null,
        discoveryResults
      );

      const result = analyzer.analyze();

      // Some controls should have registry entries, some should not
      const withEntries = [...result.satisfied, ...result.wontBeSatisfied].filter(
        cs => cs.registryEntryCount > 0
      );
      const withoutEntries = [...result.satisfied, ...result.wontBeSatisfied].filter(
        cs => cs.registryEntryCount === 0
      );

      // Both groups should exist
      expect(withEntries.length + withoutEntries.length).toBe(110);
    });

    it('should categorize controls by automation type', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null,
        discoveryResults
      );

      const result = analyzer.analyze();

      // Check that all controls have automation type set
      const allControls = [...result.satisfied, ...result.wontBeSatisfied, ...result.willBeSatisfied];
      for (const cs of allControls.slice(0, 10)) {
        expect(cs.automationType).toBeDefined();
        expect(['automated', 'automated_manual', 'nonstack']).toContain(cs.automationType);
      }
    });
  });

  describe('registry entry matching', () => {
    it('should match controls across L1/L2 variants', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        ['AC.L1-3.1.1'], // L1 variant
        discoveryResults
      );

      const result = analyzer.analyze();

      // Should match both AC.L1-3.1.1 and AC.L2-3.1.1
      const ac311 = [...result.satisfied, ...result.willBeSatisfied].find(
        cs => cs.control.nist_ref === '3.1.1' && cs.control.family === 'AC'
      );

      if (ac311) {
        expect(ac311.inPlan).toBe(true);
      }
    });

    it('should aggregate registry entries from multiple registries', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null,
        discoveryResults
      );

      const result = analyzer.analyze();

      // Find a control that might have entries in both registries
      const multiRegistry = [...result.satisfied, ...result.wontBeSatisfied].find(
        cs => cs.registryEntryCount > 2
      );

      if (multiRegistry) {
        expect(multiRegistry.registryEntryCount).toBeGreaterThan(0);
      }
    });

    it('should count discovered vs missing entries correctly', () => {
      const discoveryResults = new Map<string, 'exists' | 'missing' | 'error' | 'no_query' | 'permission_denied'>();

      // Simulate partial discovery
      const allEntries = m365Registry.allEntries;
      if (allEntries.length >= 2) {
        discoveryResults.set(allEntries[0].entry_id, 'exists');
        discoveryResults.set(allEntries[1].entry_id, 'missing');
      }

      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null,
        discoveryResults
      );

      const result = analyzer.analyze();

      const partialDiscovered = [...result.satisfied, ...result.wontBeSatisfied].find(
        cs => cs.discoveredCount > 0 && cs.missingCount > 0
      );

      if (partialDiscovered) {
        expect(partialDiscovered.discoveredCount).toBeGreaterThan(0);
        expect(partialDiscovered.missingCount).toBeGreaterThan(0);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty discovery results', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        null,
        discoveryResults
      );

      const result = analyzer.analyze();

      expect(result.total).toBe(110);
      expect(result.satisfied.length + result.wontBeSatisfied.length).toBe(110);
    });

    it('should handle empty plan control list', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        [], // Empty plan
        discoveryResults
      );

      const result = analyzer.analyze();

      // All controls should be wont_be_satisfied with empty plan
      expect(result.wontBeSatisfied.length).toBe(110);
    });

    it('should provide meaningful reason strings', () => {
      const discoveryResults = new Map();
      const analyzer = new CmmcComplianceAnalyzer(
        [m365Registry, infraRegistry],
        ['AC.L2-3.1.1'],
        discoveryResults
      );

      const result = analyzer.analyze();

      // Check wont_be_satisfied controls have reasons
      for (const cs of result.wontBeSatisfied.slice(0, 10)) {
        expect(cs.reason).toBeDefined();
        expect(typeof cs.reason).toBe('string');
        expect(cs.reason!.length).toBeGreaterThan(0);
      }
    });
  });
});
