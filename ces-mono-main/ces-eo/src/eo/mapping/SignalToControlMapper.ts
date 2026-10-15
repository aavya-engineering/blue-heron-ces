// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import type { SignalResult } from 'ces-shared/types/signal';
import type { ControlAssessment, ControlStatus } from 'ces-shared/types/controls';
import type { EvaluatorFn } from './evaluators/index.js';

interface SignalRule {
  type: 'graph' | 'powershell';
  endpoint: string;
  required?: boolean;
  filter?: string;
}

interface ControlSignalEntry {
  signals: SignalRule[];
  evaluator: string;
}

type ControlSignalRegistry = Record<string, ControlSignalEntry>;
type EvaluatorRegistry = Record<string, EvaluatorFn>;

/**
 * G4 — capability id of the Microsoft reference control→signal registry. The mapper binds this id
 * to the existing ces-shared/data/control-signal-registry asset (behavior unchanged).
 */
export const MICROSOFT_CONTROL_SIGNAL_REGISTRY_ID = 'cmmc-l2-control-signal-registry';

/**
 * Crosswalk engine that maps live API signals to CMMC L2 control assessments.
 * Loads control-signal-registry.json and applies evaluator functions.
 */
export class SignalToControlMapper {
  private readonly registry: ControlSignalRegistry;

  /**
   * @param registryPath explicit override path (back-compat / tests).
   * @param controlSignalRegistryId G4 stack capability id selecting which registry asset to load.
   *   'cmmc-l2-control-signal-registry' (Microsoft, default) ⇒ the existing shared asset (unchanged).
   *   Any other / unknown id (e.g. the proof stub's 'stub-empty') ⇒ an EMPTY registry: every control
   *   resolves to not_assessed downstream, with NO authored signal/control mappings.
   */
  constructor(registryPath?: string, controlSignalRegistryId?: string) {
    if (registryPath === undefined &&
        controlSignalRegistryId !== undefined &&
        controlSignalRegistryId !== MICROSOFT_CONTROL_SIGNAL_REGISTRY_ID) {
      // Non-Microsoft stack with no authored registry content → empty crosswalk.
      this.registry = {};
      return;
    }
    // Named `req` (not `require`): shadowing `require` puts it in the TDZ for the jest import.meta shim.
    const req = createRequire(import.meta.url);
    const defaultPath = req.resolve('ces-shared/data/control-signal-registry');
    const resolvedPath = registryPath ?? defaultPath;
    // FC-EO-H (2026-09-28): ces-shared 2.8.0 promoted the EO-owned overlay (6 controls) directly
    // into the shared Microsoft registry — the overlay merge is retired. The registry asset is
    // loaded exactly as given, shared or a custom path alike.
    this.registry = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as ControlSignalRegistry;
  }

  /** The control ids this mapper evaluates (read-only view, for coverage checks). */
  get controlIds(): string[] {
    return Object.keys(this.registry);
  }

  /** The registry entry for a control, if any. */
  entryFor(controlId: string): Readonly<ControlSignalEntry> | undefined {
    return this.registry[controlId];
  }

  mapSignalsToControls(
    signals: SignalResult[],
    evaluators: EvaluatorRegistry
  ): ControlAssessment[] {
    const now = new Date().toISOString();
    const assessments: ControlAssessment[] = [];

    for (const [controlId, entry] of Object.entries(this.registry)) {
      const evaluatorFn = evaluators[entry.evaluator];
      if (!evaluatorFn) {
        assessments.push({
          control_id: controlId,
          nist_ref: this.extractNistRef(controlId),
          status: 'not_assessed',
          classification: 'automated',
          sources: [{
            type: 'discovery',
            timestamp: now,
            detail: `No evaluator found: ${entry.evaluator}`,
            result: 'no_query',
          }],
          last_assessed: now,
          signals: [],
          evidenceArtifactIds: [],
          automationSource: 'graph',
          lastFetchedAt: now,
        });
        continue;
      }

      // Collect relevant signals for this control
      const relevantSignals = this.collectRelevantSignals(signals, entry.signals);

      // Run evaluator
      const result = evaluatorFn(relevantSignals);

      // Determine classification from signal types
      const hasGraph = entry.signals.some((s: any) => s.type === 'graph');
      const classification = hasGraph ? 'automated' as const : 'manual' as const;

      assessments.push({
        control_id: controlId,
        nist_ref: this.extractNistRef(controlId),
        status: result.status,
        classification,
        sources: [{
          type: 'discovery',
          timestamp: now,
          detail: result.evidence,
          result: result.status === 'met' ? 'exists' :
                  result.status === 'not_met' ? 'missing' :
                  result.status === 'partial' ? 'exists' :
                  'no_query',
        }],
        implementation_narrative: result.evidence,
        last_assessed: now,
        signals: relevantSignals,
        evidenceArtifactIds: [],
        automationSource: 'graph',
        lastFetchedAt: now,
      });
    }

    return assessments;
  }

  private static normalizePath(path: string | undefined | null): string {
    // Defensive: a single signal or rule with a missing endpoint must never
    // crash the whole evaluation pass (which would zero out ALL control
    // assessments). An absent endpoint normalizes to '' — it matches nothing,
    // which is the correct outcome for a signal that carries no path.
    // (Surfaced by the G-EO-STAB-1 M4 live-sim smoke: one of the fetched sim
    // signals arrived with an undefined endpoint, and the unguarded .replace
    // threw "Cannot read properties of undefined", aborting eval → 0/110.)
    if (!path) return '';
    return path.replace(/^\/+|\/+$/g, '').toLowerCase().split('?')[0];
  }

  private collectRelevantSignals(
    allSignals: SignalResult[],
    rules: SignalRule[]
  ): SignalResult[] {
    const collected: SignalResult[] = [];
    for (const rule of rules) {
      const normalizedRule = SignalToControlMapper.normalizePath(rule.endpoint);
      const matching = allSignals.filter(s => {
        if (rule.type !== s.source) return false;
        const normalizedSignal = SignalToControlMapper.normalizePath(s.endpoint);
        // Exact path comparison after normalization
        if (normalizedSignal === normalizedRule) return true;
        // Match v1.0 and beta variants
        if (normalizedSignal === `v1.0/${normalizedRule}` || normalizedSignal === `beta/${normalizedRule}`) return true;
        if (normalizedRule === `v1.0/${normalizedSignal}` || normalizedRule === `beta/${normalizedSignal}`) return true;
        return false;
      });
      collected.push(...matching);
    }
    // Deduplicate by signalId
    const seen = new Set<string>();
    return collected.filter(s => {
      if (seen.has(s.signalId)) return false;
      seen.add(s.signalId);
      return true;
    });
  }

  private extractNistRef(controlId: string): string {
    // "AC.L2-3.1.1" -> "3.1.1"
    const match = controlId.match(/\d+\.\d+\.\d+/);
    return match ? match[0] : controlId;
  }
}
