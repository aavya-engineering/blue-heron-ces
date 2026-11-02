// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { CommandRegistry } from '../registry/CommandRegistry.js';
import { CommandEntry } from '../registry/command-registry.types.js';
import { DiscoveryResult } from '../types/schema.types.js';
import {
  CmmcComplianceAnalyzer,
  ControlEntryDetail,
  CmmcStatus,
} from './CmmcComplianceAnalyzer.js';
import {
  GapEntry,
  GapControl,
  GapRemediationPlan,
  GapSummary,
  ImpactMatrix,
  Priority,
} from '../types/gap-remediation.types.js';

/**
 * Priority mapping based on CMMC family codes.
 */
const PRIORITY_MAP: Record<string, Priority> = {
  AC: 'critical',
  SC: 'critical',
  AU: 'high',
  CM: 'medium',
  SI: 'medium',
};

/**
 * Reason strings for different gap statuses.
 */
const REASON_MAP: Record<string, string> = {
  missing: 'Resource not found on tenant',
  error: 'Discovery query failed',
  no_query: 'No get_command defined',
  not_checked: 'Missing required variables',
  exists_not_sat: 'Resource exists but configuration verification failed',
};

/**
 * GapAnalyzer enriches CMMC compliance analysis with per-entry gap details,
 * priority ranking, dependency ordering, and impact analysis.
 */
export class GapAnalyzer {
  private registries: CommandRegistry[];
  private discoveryResults: Map<string, DiscoveryResult>;
  private infrastructureModel: string;
  private entryMap: Map<string, CommandEntry>;

  constructor(
    registries: CommandRegistry[],
    discoveryResults: Map<string, DiscoveryResult>,
    infrastructureModel: string
  ) {
    this.registries = registries;
    this.discoveryResults = discoveryResults;
    this.infrastructureModel = infrastructureModel;

    // Build entry lookup map
    this.entryMap = new Map();
    for (const registry of registries) {
      for (const entry of registry.allEntries) {
        this.entryMap.set(entry.entry_id, entry);
      }
    }
  }

  /**
   * Analyze gaps and generate remediation plan.
   */
  analyze(tenantSlug: string): GapRemediationPlan {
    // Instantiate CmmcComplianceAnalyzer with plan-less mode (planControlIds=null)
    const analyzer = new CmmcComplianceAnalyzer(
      this.registries,
      null,
      this.discoveryResults
    );

    const cmmcStatus: CmmcStatus = analyzer.analyze();

    // Build gap controls from wontBeSatisfied array
    const gapControls: GapControl[] = [];
    for (const controlStatus of cmmcStatus.wontBeSatisfied) {
      const gapEntries = this.buildGapEntries(controlStatus.registryEntryDetails);
      if (gapEntries.length === 0) continue;

      const priority = this.assignPriority(controlStatus.control.family);
      gapControls.push({
        control_id: controlStatus.control.control_id,
        family: controlStatus.control.family,
        cmmc_level: controlStatus.control.cmmc_level,
        nist_ref: controlStatus.control.nist_ref,
        practice: controlStatus.control.practice,
        priority,
        automation_type: controlStatus.automationType,
        gap_entries: gapEntries,
      });
    }

    // Sort gap controls by priority (critical first)
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    gapControls.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Compute execution order
    const executionOrder = this.computeExecutionOrder(gapControls);

    // Build impact matrix
    const impactMatrix = this.buildImpactMatrix(gapControls);

    // Build summary
    const summary = this.buildSummary(gapControls);

    // Generate timestamp in ISO8601 format with dashes
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '-000Z');

    return {
      timestamp,
      tenant_slug: tenantSlug,
      infrastructure_model: this.infrastructureModel,
      summary,
      gap_controls: gapControls,
      execution_order: executionOrder,
      impact_matrix: impactMatrix,
    };
  }

  /**
   * Build GapEntry objects from ControlEntryDetail array.
   */
  private buildGapEntries(details: ControlEntryDetail[]): GapEntry[] {
    const entries: GapEntry[] = [];

    for (const detail of details) {
      // Only include non-exists entries as gaps
      if (detail.status === 'exists') {
        // Check if verdict is NOT_SAT (exists but misconfigured)
        const discoveryResult = this.discoveryResults.get(detail.entry_id);
        if (discoveryResult && discoveryResult.verdict === 'NOT_SAT') {
          entries.push(this.buildGapEntry(detail, 'exists_not_sat'));
        }
        continue;
      }

      entries.push(this.buildGapEntry(detail, detail.status));
    }

    return entries;
  }

  /**
   * Build a single GapEntry from ControlEntryDetail.
   */
  private buildGapEntry(
    detail: ControlEntryDetail,
    status: 'missing' | 'error' | 'no_query' | 'not_checked' | 'exists_not_sat'
  ): GapEntry {
    const registryEntry = this.entryMap.get(detail.entry_id);
    const discoveryResult = this.discoveryResults.get(detail.entry_id);

    return {
      entry_id: detail.entry_id,
      label: detail.label,
      engine: detail.engine,
      status,
      verdict: discoveryResult?.verdict,
      reason: REASON_MAP[status] || 'Unknown gap reason',
      manual_only: detail.manual_only,
      layer_hint: registryEntry?.layer_hint ?? 0,
      variables_required: registryEntry?.variables_required ?? [],
      captures: registryEntry?.captures.map((c) => c.variable) ?? [],
      control_ids: registryEntry?.control_ids ?? [],
    };
  }

  /**
   * Assign priority based on CMMC family code.
   */
  private assignPriority(family: string): Priority {
    return PRIORITY_MAP[family] || 'low';
  }

  /**
   * Compute execution order by sorting entries by layer_hint, then by dependency.
   */
  private computeExecutionOrder(gapControls: GapControl[]): string[] {
    // Collect all gap entries
    const allEntries: GapEntry[] = [];
    for (const control of gapControls) {
      allEntries.push(...control.gap_entries);
    }

    // Remove duplicates (same entry may appear in multiple controls)
    const uniqueEntries = new Map<string, GapEntry>();
    for (const entry of allEntries) {
      if (!uniqueEntries.has(entry.entry_id)) {
        uniqueEntries.set(entry.entry_id, entry);
      }
    }

    // Sort by layer_hint ascending
    const sorted = Array.from(uniqueEntries.values()).sort((a, b) => a.layer_hint - b.layer_hint);

    // Within each layer, check for simple variable dependencies
    // Entry B depends on Entry A if B.variables_required includes any of A.captures
    const ordered: GapEntry[] = [];
    const layers = new Map<number, GapEntry[]>();

    for (const entry of sorted) {
      const layer = entry.layer_hint;
      if (!layers.has(layer)) {
        layers.set(layer, []);
      }
      layers.get(layer)!.push(entry);
    }

    // Process each layer and order by dependencies
    for (const [, entries] of Array.from(layers.entries()).sort((a, b) => a[0] - b[0])) {
      const layerOrdered = this.orderByDependencies(entries);
      ordered.push(...layerOrdered);
    }

    return ordered.map((e) => e.entry_id);
  }

  /**
   * Order entries within a layer by variable dependencies.
   */
  private orderByDependencies(entries: GapEntry[]): GapEntry[] {
    const result: GapEntry[] = [];
    const remaining = [...entries];

    while (remaining.length > 0) {
      let addedAny = false;

      for (let i = 0; i < remaining.length; i++) {
        const entry = remaining[i];

        // Check if all dependencies are already in result
        const dependencies = entry.variables_required;
        const allDependenciesMet = dependencies.every((dep) => {
          // Check if any entry in result produces this variable
          return result.some((e) => e.captures.includes(dep));
        });

        // If no dependencies or all met, add to result
        if (dependencies.length === 0 || allDependenciesMet) {
          result.push(entry);
          remaining.splice(i, 1);
          addedAny = true;
          break;
        }
      }

      // If we couldn't add any entry, break to avoid infinite loop
      // (This means there are circular dependencies or missing dependencies)
      if (!addedAny) {
        result.push(...remaining);
        break;
      }
    }

    return result;
  }

  /**
   * Build impact matrix: entry_id -> control_ids it satisfies.
   */
  private buildImpactMatrix(gapControls: GapControl[]): ImpactMatrix {
    const matrix: ImpactMatrix = {};

    for (const control of gapControls) {
      for (const entry of control.gap_entries) {
        if (!matrix[entry.entry_id]) {
          matrix[entry.entry_id] = [];
        }
        // Use entry.control_ids directly (from registry)
        for (const controlId of entry.control_ids) {
          if (!matrix[entry.entry_id].includes(controlId)) {
            matrix[entry.entry_id].push(controlId);
          }
        }
      }
    }

    return matrix;
  }

  /**
   * Build summary statistics.
   */
  private buildSummary(gapControls: GapControl[]): GapSummary {
    const summary: GapSummary = {
      total_controls_with_gaps: gapControls.length,
      total_gap_entries: 0,
      by_priority: { critical: 0, high: 0, medium: 0, low: 0 },
      by_status: { missing: 0, error: 0, no_query: 0, not_checked: 0, exists_not_sat: 0 },
      manual_only_count: 0,
      automated_count: 0,
    };

    const uniqueEntries = new Map<string, GapEntry>();

    for (const control of gapControls) {
      summary.by_priority[control.priority]++;

      for (const entry of control.gap_entries) {
        if (!uniqueEntries.has(entry.entry_id)) {
          uniqueEntries.set(entry.entry_id, entry);
          summary.total_gap_entries++;
          summary.by_status[entry.status]++;
          if (entry.manual_only) {
            summary.manual_only_count++;
          } else {
            summary.automated_count++;
          }
        }
      }
    }

    return summary;
  }
}
