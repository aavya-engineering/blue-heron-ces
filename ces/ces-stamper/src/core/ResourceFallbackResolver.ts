// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Engine } from '../types/schema.types.js';
import { FALLBACK_SPECS, RESOLVABLE_VARIABLES } from '../shared/variable-map.js';

// Re-export for backward compatibility with existing import sites
export { FALLBACK_SPECS, RESOLVABLE_VARIABLES };

/** Function signature matching taskRunner.discoverSubCommandState / adapter.discoverSubCommand */
export type DiscoverFn = (
  engine: Engine,
  getCommand: string,
  captures: never[],
  variables: Record<string, any>
) => Promise<{ exists: boolean; captures: Record<string, string>; rawOutput: string; [key: string]: any }>;

export class ResourceFallbackResolver {
  constructor(
    private discoverFn: DiscoverFn,
    private variables: Record<string, any>,
    private send: (data: object) => void
  ) {}

  /**
   * For each missing variable that has a fallback spec, run the type-based list command.
   * Returns a map of newly resolved variables to merge into the plan.
   */
  async resolveByFallback(missingVars: string[]): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};
    const missingSet = new Set(missingVars);

    for (const spec of FALLBACK_SPECS) {
      // Only attempt if this variable is actually missing
      if (!missingSet.has(spec.variable)) continue;

      // Don't override variables already populated
      if (this.variables[spec.variable]) continue;

      // Azure specs require resourceGroup; mgraph specs don't
      const needsResourceGroup = spec.engine !== 'mgraph' && spec.listCommand.includes('{resourceGroup}');
      if (needsResourceGroup && !this.variables.resourceGroup) continue;

      try {
        const result = await this.discoverFn(
          spec.engine,
          spec.listCommand,
          [],
          this.variables
        );

        if (!result.exists || !result.rawOutput) {
          this.send({
            type: 'fallback_not_found',
            variable: spec.variable,
            resourceType: spec.resourceType,
          });
          continue;
        }

        // Parse the JSON output — may be a single object or an array
        const parsed = this.parseJsonOutput(result.rawOutput);
        if (!parsed || parsed.length === 0) {
          this.send({
            type: 'fallback_not_found',
            variable: spec.variable,
            resourceType: spec.resourceType,
          });
          continue;
        }

        if (parsed.length === 1) {
          // Exactly 1 result — auto-populate
          const item = parsed[0];
          const name = this.extractProperty(item, spec.nameProperty);
          if (name) {
            resolved[spec.variable] = name;

            // Extract additional captures
            if (spec.additionalCaptures) {
              for (const cap of spec.additionalCaptures) {
                const capValue = this.extractProperty(item, cap.property);
                if (capValue) {
                  resolved[cap.variable] = capValue;
                }
              }
            }

            this.send({
              type: 'fallback_resolved',
              variable: spec.variable,
              value: name,
              resourceType: spec.resourceType,
              additionalCaptures: spec.additionalCaptures
                ? Object.fromEntries(
                    spec.additionalCaptures
                      .filter(c => resolved[c.variable])
                      .map(c => [c.variable, resolved[c.variable]])
                  )
                : undefined,
            });
          }
        } else {
          // Multiple results — ambiguous, don't auto-populate
          const candidates = parsed
            .map(item => this.extractProperty(item, spec.nameProperty))
            .filter((n): n is string => !!n);

          this.send({
            type: 'fallback_ambiguous',
            variable: spec.variable,
            resourceType: spec.resourceType,
            count: parsed.length,
            candidates,
          });
        }
      } catch {
        // Best-effort: if the list command fails, skip silently
        this.send({
          type: 'fallback_not_found',
          variable: spec.variable,
          resourceType: spec.resourceType,
        });
      }
    }

    return resolved;
  }

  /**
   * Parse JSON output that may be a single object or an array.
   * ConvertTo-Json may return a bare object (1 result) or an array (multiple).
   */
  private parseJsonOutput(raw: string): Record<string, any>[] | null {
    try {
      const trimmed = raw.trim();
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object' && parsed !== null) return [parsed];
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract a property value from a parsed JSON object (case-insensitive key match).
   */
  private extractProperty(obj: Record<string, any>, property: string): string | null {
    // Try exact match first
    if (obj[property] !== undefined && obj[property] !== null) {
      return String(obj[property]);
    }

    // Case-insensitive fallback
    const lowerProp = property.toLowerCase();
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === lowerProp) {
        const val = obj[key];
        if (val !== undefined && val !== null) return String(val);
      }
    }

    return null;
  }
}
