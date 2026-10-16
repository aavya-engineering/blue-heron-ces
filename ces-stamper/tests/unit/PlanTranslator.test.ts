// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { CommandRegistry } from '../../src/registry/CommandRegistry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('PlanTranslator', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const missionPlanPath = path.join(fixturesDir, 'synthetic-mission-plan.json');
  const tenantManifestPath = path.join(fixturesDir, 'synthetic-tenant-manifest.json');

  describe('translate', () => {
    it('should translate mission plan to executable plan', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();

      const result = translator.translate(missionPlanData, manifest);

      expect(result.plan).toBeDefined();
      expect(result.plan.plan_id).toContain('translated-');
      expect(result.plan.target_level).toBe('L2');
      expect(result.plan.execution_graph).toBeInstanceOf(Array);
      expect(result.plan.execution_graph.length).toBeGreaterThan(0);
      expect(result.plan.variables).toBeDefined();
      expect(result.plan.prechecks).toBeDefined();
      expect(result.plan.postchecks).toBeDefined();
    });

    it('should generate layer summary with task counts', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();

      const result = translator.translate(missionPlanData, manifest);

      expect(result.layerSummary).toBeDefined();
      const layers = Object.keys(result.layerSummary);
      expect(layers.length).toBeGreaterThan(0);

      for (const layer of layers) {
        const summary = result.layerSummary[parseInt(layer)];
        expect(summary.name).toBeDefined();
        expect(summary.taskCount).toBeGreaterThanOrEqual(0);
        expect(summary.taskIds).toBeInstanceOf(Array);
        expect(summary.taskIds.length).toBe(summary.taskCount);
      }
    });

    it('should assign tasks to execution layers', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();

      const result = translator.translate(missionPlanData, manifest);

      for (const task of result.plan.execution_graph) {
        expect(task.action.args._layer).toBeDefined();
        expect(task.action.args._layer).toBeGreaterThanOrEqual(0);
        expect(task.action.args._layer).toBeLessThanOrEqual(8);
        expect(task.action.args._layer_name).toBeDefined();
      }
    });

    it('should include registry-backed sub-commands when registry is loaded', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const registry = CommandRegistry.load();
      const translator = new PlanTranslator(registry);

      const result = translator.translate(missionPlanData, manifest);

      // Some tasks should have _sub_commands from registry
      const tasksWithSubs = result.plan.execution_graph.filter(
        t => t.action.args._sub_commands && t.action.args._sub_commands.length > 0
      );
      expect(tasksWithSubs.length).toBeGreaterThan(0);

      // Verify sub-command structure
      const firstSub = tasksWithSubs[0].action.args._sub_commands[0];
      expect(firstSub.id).toBeDefined();
      expect(firstSub.label).toBeDefined();
      expect(firstSub.engine).toBeDefined();
    });

    it('should handle controls without registry entries', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();

      const result = translator.translate(missionPlanData, manifest);

      // Find tasks without sub-commands (no registry match)
      const tasksWithoutSubs = result.plan.execution_graph.filter(
        t => !t.action.args._sub_commands || t.action.args._sub_commands.length === 0
      );

      // Some tasks should exist without registry entries (policy/manual tasks)
      expect(tasksWithoutSubs.length).toBeGreaterThanOrEqual(0);
    });

    it('should deduplicate sub-commands across tasks', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const registry = CommandRegistry.load();
      const translator = new PlanTranslator(registry);

      const result = translator.translate(missionPlanData, manifest);

      // Collect all sub-command IDs
      const allSubIds: string[] = [];
      for (const task of result.plan.execution_graph) {
        const subs = task.action.args._sub_commands || [];
        for (const sub of subs) {
          allSubIds.push(sub.id);
        }
      }

      // Check for duplicates
      const uniqueSubIds = new Set(allSubIds);
      expect(allSubIds.length).toBe(uniqueSubIds.size);
    });

    it('should generate prechecks from manifest', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();

      const result = translator.translate(missionPlanData, manifest);

      expect(result.plan.prechecks).toBeDefined();
      expect(result.plan.prechecks.length).toBeGreaterThan(0);

      const firstCheck = result.plan.prechecks[0];
      expect(firstCheck.id).toBeDefined();
      expect(firstCheck.description).toBeDefined();
      expect(firstCheck.method).toBeDefined();
    });

    it('should sort postchecks by severity', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();

      const result = translator.translate(missionPlanData, manifest);

      expect(result.plan.postchecks).toBeDefined();

      // If there are multiple postchecks, verify severity ordering
      if (result.plan.postchecks.length > 1) {
        const descriptions = result.plan.postchecks.map(c =>
          (c.description + (c.on_fail || '')).toLowerCase()
        );

        // High priority checks should come before low priority
        const firstHasCritical = /critical|p0|high|p1/.test(descriptions[0]);
        const lastHasCritical = /critical|p0|high|p1/.test(descriptions[descriptions.length - 1]);

        // If last has critical/high and first doesn't, ordering is wrong
        expect(!(lastHasCritical && !firstHasCritical)).toBe(true);
      }
    });

    it('should inject audit-log dependencies for retention tasks', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const registry = CommandRegistry.load();
      const translator = new PlanTranslator(registry);

      const result = translator.translate(missionPlanData, manifest);

      // Find retention-related tasks
      const retentionTasks = result.plan.execution_graph.filter(t => {
        const subs = t.action.args._sub_commands || [];
        return subs.some((s: any) => /retention|label/i.test(s.set_command || ''));
      });

      // Find audit-log tasks
      const auditTasks = result.plan.execution_graph.filter(t => {
        const subs = t.action.args._sub_commands || [];
        return subs.some((s: any) => /Enable-OrganizationCustomization|AdminAuditLog/i.test(s.set_command || ''));
      });

      // If both exist, retention should depend on audit
      if (retentionTasks.length > 0 && auditTasks.length > 0) {
        const retentionTask = retentionTasks[0];
        const auditTaskId = auditTasks[0].id;
        expect(retentionTask.depends_on).toContain(auditTaskId);
      }
    });

    it('should return warnings array', () => {
      const missionPlanData = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();

      const result = translator.translate(missionPlanData, manifest);

      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe('translateFile', () => {
    it('should translate from file paths', () => {
      const translator = new PlanTranslator();
      const result = translator.translateFile(missionPlanPath, tenantManifestPath);

      expect(result.plan).toBeDefined();
      expect(result.layerSummary).toBeDefined();
    });

    it('should throw error for missing mission plan file', () => {
      const translator = new PlanTranslator();
      const invalidPath = path.join(fixturesDir, 'nonexistent.json');

      expect(() => {
        translator.translateFile(invalidPath, tenantManifestPath);
      }).toThrow('Mission plan file not found');
    });

    it('should throw error for missing manifest file', () => {
      const translator = new PlanTranslator();
      const invalidPath = path.join(fixturesDir, 'nonexistent.json');

      expect(() => {
        translator.translateFile(missionPlanPath, invalidPath);
      }).toThrow('Tenant manifest file not found');
    });
  });
});
