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
import { CommandRegistry } from '../registry/CommandRegistry.js';
import { CommandEntry } from '../registry/command-registry.types.js';
import { DiscoveryResult } from '../types/schema.types.js';
import { evidenceFileForEntry } from './EvidenceReadinessAnalyzer.js';
import { EnrichedScopeExclusion, CESControlDirective, MPControl, normalizeStamperAction } from '../types/ces-artifacts.types.js';
import { loadSprsWeights } from './ScopeExclusionValidator.js';
import { resolveSharedDataPath } from './sharedData.js';

// ---- Types ----


export type AutomationType = 'automated' | 'automated_manual' | 'nonstack' | 'document-absence' | 'document-prohibition' | 'document-renderable' | 'inherit-fedramp' | 'eo-tooled';

export interface CmmcControl {
  control_id: string;   // "AC.L1-3.1.1"
  family: string;       // "AC"
  cmmc_level: number;   // 1 or 2
  nist_ref: string;     // "3.1.1"
  practice: string;     // requirement text
}

/**
 * Represents detailed status of a registry entry associated with a CMMC control.
 * @property status - Entry readiness status:
 *   - 'exists': Entry found in tenant environment
 *   - 'missing': Entry not found (should exist)
 *   - 'error': Query execution failed
 *   - 'no_query': Entry lacks get_command definition
 *   - 'not_checked': Entry has missing required variables, query skipped
 */
export interface ControlEntryDetail {
  entry_id: string;
  label: string;
  engine: string;
  status: 'exists' | 'missing' | 'error' | 'no_query' | 'not_checked';
  manual_only: boolean;
}

export interface ControlStatus {
  control: CmmcControl;
  /**
   * FX2-ST2: `not_verified` = planned for configuration (plan directive) but no real
   * tenant read or recorded real post-state proves it. Never SAT; deducts its SPRS weight.
   */
  category: 'satisfied' | 'provisional' | 'will_be_satisfied' | 'wont_be_satisfied' | 'not_verified' | 'out_of_scope';
  automationType: AutomationType;
  registryEntryCount: number;
  discoveredCount: number;
  missingCount: number;
  inPlan: boolean;
  reason?: string;
  registryEntryDetails: ControlEntryDetail[];
  sprsWeight: number;
}

export interface FamilyStatus {
  name: string;
  total: number;
  satisfied: number;
  provisional: number;
  excluded: number;
  nonsStackOos: number;
  willBe: number;
  wontBe: number;
  notVerified: number;
  outOfScope: number;
}

export interface CmmcStatus {
  total: number;
  satisfied: ControlStatus[];
  provisional: ControlStatus[];
  willBeSatisfied: ControlStatus[];
  wontBeSatisfied: ControlStatus[];
  /** FX2-ST2: planned (directive) but not proven by a tenant read — never SAT. */
  notVerified: ControlStatus[];
  outOfScope: ControlStatus[];
  byFamily: Record<string, FamilyStatus>;
}

interface CmmcReferenceData {
  total_controls: number;
  families: Array<{ abbreviation: string; name: string; control_count: number }>;
  controls: CmmcControl[];
}

// ---- Analyzer ----

export class CmmcComplianceAnalyzer {
  private reference: CmmcReferenceData;
  private registries: CommandRegistry[];
  private planControlIds: Set<string> | null;
  private discoveryResults: Map<string, DiscoveryResult | string>;
  private excludedEntryIds: Set<string>;
  private evidenceDir: string | undefined;
  private scopeExclusions: Map<string, EnrichedScopeExclusion>;
  private controlDirectives: Map<string, CESControlDirective>;
  private mpControls: MPControl[] | null;
  private sprsWeights: Map<string, { weight: 1 | 3 | 5; poam_allowed: boolean }>;

  constructor(
    registries: CommandRegistry[],
    planControlIds: string[] | null,
    discoveryResults: Map<string, DiscoveryResult | string>,
    excludedEntryIds?: Set<string>,
    evidenceDir?: string,
    scopeExclusions?: EnrichedScopeExclusion[],
    controlDirectives?: CESControlDirective[],
    mpControls?: MPControl[]
  ) {
    this.reference = this.loadReference();
    this.registries = registries;
    this.planControlIds = planControlIds ? new Set(planControlIds) : null;
    this.discoveryResults = discoveryResults;
    this.excludedEntryIds = excludedEntryIds || new Set();
    this.evidenceDir = evidenceDir;
    this.scopeExclusions = new Map();
    if (scopeExclusions) {
      for (const exclusion of scopeExclusions) {
        this.scopeExclusions.set(exclusion.requirement_id, exclusion);
      }
    }
    this.controlDirectives = new Map();
    if (controlDirectives) {
      for (const d of controlDirectives) {
        this.controlDirectives.set(d.control_id, d);
      }
    }
    this.mpControls = mpControls ?? null;

    // Load SPRS weights with error handling
    try {
      this.sprsWeights = loadSprsWeights();
    } catch (err) {
      console.warn('Failed to load SPRS weights, using fallback weight=0:', err);
      this.sprsWeights = new Map();
    }
  }

  private loadReference(): CmmcReferenceData {
    // FX2-ST1: canonical ces-shared control reference (no local copy)
    return JSON.parse(fs.readFileSync(resolveSharedDataPath('cmmc-l2-controls.reference.json'), 'utf-8'));
  }

  /**
   * Find all registry entries that map to a given CMMC control's nist_ref.
   * Tries multiple control_id formats: family.L1-ref, family.L2-ref
   */
  private findRegistryEntries(control: CmmcControl): CommandEntry[] {
    const seen = new Set<string>();
    const entries: CommandEntry[] = [];
    const nistRef = control.nist_ref;
    const family = control.family;

    const addEntry = (entry: CommandEntry) => {
      if (!seen.has(entry.entry_id)) {
        seen.add(entry.entry_id);
        entries.push(entry);
      }
    };

    // Try the exact control_id from the reference
    for (const reg of this.registries) {
      for (const entry of reg.lookupByControl(control.control_id)) {
        addEntry(entry);
      }
    }

    // Also try the L2 variant (registries label everything as L2)
    const l2Id = `${family}.L2-${nistRef}`;
    if (l2Id !== control.control_id) {
      for (const reg of this.registries) {
        for (const entry of reg.lookupByControl(l2Id)) {
          addEntry(entry);
        }
      }
    }

    return entries.filter(e => !this.excludedEntryIds.has(e.entry_id));
  }

  /**
   * Classify a control's automation type based on its registry entries.
   */
  private classifyAutomation(entries: CommandEntry[]): AutomationType {
    if (entries.length === 0) return 'nonstack';

    let automatedCount = 0;
    let manualCount = 0;

    for (const entry of entries) {
      if (entry.engine === 'manual_gate' || entry.manual_only || !entry.set_command) {
        manualCount++;
      } else {
        automatedCount++;
      }
    }

    if (manualCount === 0) return 'automated';
    if (automatedCount === 0) return 'nonstack';
    return 'automated_manual';
  }

  /**
   * Classify a control's automation type based on MP control data.
   * Falls back to registry-based classification if no MP match found.
   */
  private classifyFromMPControl(entries: CommandEntry[], mpControls: MPControl[], controlId: string): AutomationType {
    // Match on L2 requirement_id only (filter out L1 controls)
    const mpControl = mpControls.find(mp =>
      mp.level === 'L2' && mp.requirement_id === controlId
    );

    if (!mpControl) {
      // Fallback to registry-based classification
      return this.classifyAutomation(entries);
    }

    const { stamper_action } = mpControl;

    // Mapping rules (using shared normalization). FX2-ST3: an invalid action on one
    // control falls back to registry classification instead of aborting Assess.
    let normalized: ReturnType<typeof normalizeStamperAction>;
    try {
      normalized = normalizeStamperAction(stamper_action);
    } catch {
      return this.classifyAutomation(entries);
    }
    if (normalized === 'automated') {
      return 'automated';
    } else if (normalized === 'document-absence') {
      return 'document-absence';
    } else if (normalized === 'document-prohibition') {
      return 'document-prohibition';
    } else if (normalized === 'document-renderable') {
      return 'document-renderable';
    } else if (normalized === 'inherit-fedramp') {
      return 'inherit-fedramp';
    } else if (normalized === 'eo-tooled') {
      return 'eo-tooled';
    } else if (normalized === 'nonstack') {
      // Check if any registry entries exist for this control
      return entries.length > 0 ? 'automated_manual' : 'nonstack';
    }

    // Default fallback
    return this.classifyAutomation(entries);
  }

  /**
   * Check if a control_id appears in ANY registry entry's control_ids array.
   * This detects controls that have no primary entries but are indirectly satisfied
   * by entries tagged with multiple control_ids (e.g., AC.L2-3.1.7 appears in
   * AC.L2-3.1.1.operator-discover and AC.L2-3.1.5.pim-eligible).
   */
  private hasIndirectEntries(controlId: string): boolean {
    for (const reg of this.registries) {
      for (const entry of reg.allEntries) {
        if (entry.control_ids && entry.control_ids.includes(controlId)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if a CMMC control is referenced in the plan's controls.
   * Matches by nist_ref across L1/L2 variants.
   */
  private isInPlan(control: CmmcControl, hasRegistryEntries: boolean): boolean {
    // Plan-less mode: treat any control with registry entries as "in scope"
    if (this.planControlIds === null) return hasRegistryEntries;

    // Direct match
    if (this.planControlIds.has(control.control_id)) return true;

    // Try L2 variant
    const l2Id = `${control.family}.L2-${control.nist_ref}`;
    if (this.planControlIds.has(l2Id)) return true;

    // Try L1 variant
    const l1Id = `${control.family}.L1-${control.nist_ref}`;
    if (this.planControlIds.has(l1Id)) return true;

    return false;
  }

  /**
   * Read the complianceVerdict from an evidence JSON file on disk.
   * Returns 'SAT', 'NOT_SAT', or undefined if file missing/malformed/no verdict field.
   */
  private readEvidenceVerdict(entryId: string, label: string): 'SAT' | 'NOT_SAT' | undefined {
    if (!this.evidenceDir) return undefined;
    const evidFile = evidenceFileForEntry(entryId, label);
    const fullPath = path.join(this.evidenceDir, evidFile);
    try {
      if (!fs.existsSync(fullPath)) return undefined;
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(raw);
      // FX2-ST2: a dry-run record is not a real post-state — never SAT.
      if (isDryRunRecord(parsed)) return undefined;
      const verdict = parsed.complianceVerdict;
      if (verdict === 'SAT' || verdict === 'NOT_SAT') return verdict;
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Build the registryEntryDetails array for a control's associated registry entries.
   * Maps each entry against discovery results to determine its individual status.
   */
  private buildEntryDetails(registryEntries: CommandEntry[]): ControlEntryDetail[] {
    return registryEntries.map(e => {
      const disc = this.discoveryResults.get(e.entry_id);
      const statusVal = typeof disc === 'string' ? disc : disc?.status;
      const status: ControlEntryDetail['status'] = statusVal === 'exists' ? 'exists'
        : statusVal === 'missing' ? 'missing'
        : statusVal === 'error' || statusVal === 'permission_denied' ? 'error'
        : statusVal === 'no_query' ? 'no_query'
        : 'not_checked';
      return {
        entry_id: e.entry_id,
        label: e.label,
        engine: e.engine,
        status,
        manual_only: !!(e.manual_only || e.engine === 'manual_gate'),
      };
    });
  }

  /**
   * FX2-ST2: classify a control the plan intends to configure from what was actually
   * read. SAT only when every matching registry entry was read from the tenant
   * (`exists`) and no read or recorded post-state says NOT_SAT. An empty read
   * (`missing`) or a NOT_SAT verdict is NOT_SAT. Anything unread is `not_verified`.
   */
  private classifyPlannedControl(control: CmmcControl, directiveWord: string): ControlStatus {
    const registryEntries = this.findRegistryEntries(control);
    const registryEntryDetails = this.buildEntryDetails(registryEntries);
    let discoveredCount = 0;
    let missingCount = 0;
    let notSat = false;
    for (const entry of registryEntries) {
      const disc = this.discoveryResults.get(entry.entry_id);
      const statusVal = typeof disc === 'string' ? disc : disc?.status;
      if (statusVal === 'exists') {
        discoveredCount++;
        let verdict = typeof disc === 'object' ? disc.verdict : undefined;
        if (!verdict) verdict = this.readEvidenceVerdict(entry.entry_id, entry.label);
        if (verdict === 'NOT_SAT') notSat = true;
      } else if (statusVal === 'missing') {
        missingCount++;
      } else {
        // Not read live: a recorded real post-state on disk (execution evidence) can prove it.
        const recorded = this.readEvidenceVerdict(entry.entry_id, entry.label);
        if (recorded === 'SAT') discoveredCount++;
        else if (recorded === 'NOT_SAT') notSat = true;
      }
    }
    const base = {
      control,
      automationType: 'automated' as AutomationType,
      registryEntryCount: registryEntries.length,
      discoveredCount,
      missingCount,
      inPlan: true,
      registryEntryDetails,
      sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
    };
    if (missingCount > 0 || notSat) {
      return {
        ...base,
        category: 'wont_be_satisfied',
        reason: missingCount > 0
          ? `Tenant read: ${missingCount} of ${registryEntries.length} not configured`
          : 'Tenant read: configuration verification failed',
      };
    }
    if (registryEntries.length > 0 && discoveredCount === registryEntries.length) {
      return { ...base, category: 'satisfied', reason: 'Verified by tenant read' };
    }
    return {
      ...base,
      category: 'not_verified',
      reason: registryEntries.length === 0
        ? `Planned (${directiveWord}) — no registry read can verify it`
        : `Planned (${directiveWord}) — not verified: ${registryEntries.length - discoveredCount} of ${registryEntries.length} not read from the tenant`,
    };
  }

  analyze(): CmmcStatus {
    const satisfied: ControlStatus[] = [];
    const provisional: ControlStatus[] = [];
    const willBeSatisfied: ControlStatus[] = [];
    const wontBeSatisfied: ControlStatus[] = [];
    const outOfScope: ControlStatus[] = [];
    const notVerified: ControlStatus[] = [];
    const pushPlanned = (cs: ControlStatus) => {
      if (cs.category === 'satisfied') satisfied.push(cs);
      else if (cs.category === 'wont_be_satisfied') wontBeSatisfied.push(cs);
      else notVerified.push(cs);
    };

    const familyNameMap = new Map<string, string>();
    for (const f of this.reference.families) {
      familyNameMap.set(f.abbreviation, f.name);
    }

    // Track skip directive control_ids to exclude from total
    const skipControlIds = new Set<string>();
    for (const [cid, d] of this.controlDirectives) {
      if (d.directive === 'skip') skipControlIds.add(cid);
    }

    for (const control of this.reference.controls) {
      // Directive-mode: if control_directives are present, use them for categorization
      const directive = this.controlDirectives.get(control.control_id);
      if (directive) {
        const registryEntries = this.findRegistryEntries(control);
        const registryEntryDetails = this.buildEntryDetails(registryEntries);

        switch (directive.directive) {
          case 'implement':
          case 'validate': {
            // FX2-ST2: plan intent is not evidence — verify against tenant reads.
            pushPlanned(this.classifyPlannedControl(control, directive.directive));
            continue;
          }
          case 'manual': {
            provisional.push({
              control,
              category: 'provisional',
              automationType: 'nonstack',
              registryEntryCount: registryEntries.length,
              discoveredCount: 0,
              missingCount: 0,
              inPlan: true,
              reason: 'Non-Stack (manual directive)',
              registryEntryDetails,
              sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
            });
            continue;
          }
          case 'document-absence': {
            satisfied.push({
              control,
              category: 'satisfied',
              automationType: 'document-absence',
              registryEntryCount: 0,
              discoveredCount: 0,
              missingCount: 0,
              inPlan: false,
              reason: directive.justification || 'Capability absent from CUI boundary',
              registryEntryDetails: [],
              sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
            });
            continue;
          }
          case 'document-prohibition': {
            satisfied.push({
              control,
              category: 'satisfied',
              automationType: 'document-prohibition',
              registryEntryCount: registryEntries.length,
              discoveredCount: registryEntries.length,
              missingCount: 0,
              inPlan: true,
              reason: directive.justification || 'Capability prohibited by design',
              registryEntryDetails,
              sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
            });
            continue;
          }
          case 'document-renderable': {
            satisfied.push({
              control,
              category: 'satisfied',
              automationType: 'document-renderable',
              registryEntryCount: registryEntries.length,
              discoveredCount: registryEntries.length,
              missingCount: 0,
              inPlan: true,
              reason: directive.justification || 'Document-renderable signal verification',
              registryEntryDetails,
              sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
            });
            continue;
          }
          case 'inherit-fedramp': {
            satisfied.push({
              control,
              category: 'satisfied',
              automationType: 'inherit-fedramp',
              registryEntryCount: 0,
              discoveredCount: 0,
              missingCount: 0,
              inPlan: true,
              reason: directive.justification || 'FedRAMP High inheritance from CSP',
              registryEntryDetails: [],
              sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
            });
            continue;
          }
          case 'eo-tooled': {
            provisional.push({
              control,
              category: 'provisional',
              automationType: 'eo-tooled',
              registryEntryCount: 0,
              discoveredCount: 0,
              missingCount: 0,
              inPlan: true,
              reason: 'EO-tooled (evidence managed in sibling app)',
              registryEntryDetails: [],
              sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
            });
            continue;
          }
          case 'skip': {
            // skip = invisible, not counted in any category
            continue;
          }
        }
      }

      // If control_directives are loaded but this control is NOT listed, default to implement (automated/satisfied)
      if (this.controlDirectives.size > 0 && !directive) {
        // FX2-ST2: the implicit default is still only intent — verify it.
        pushPlanned(this.classifyPlannedControl(control, 'implement (default)'));
        continue;
      }

      // Scope exclusions take precedence over registry-entry exclusions
      const scopeExclusion = this.scopeExclusions.get(control.control_id);
      if (scopeExclusion) {
        outOfScope.push({
          control,
          category: 'out_of_scope',
          reason: `SI scope exclusion: ${scopeExclusion.justification}`,
          automationType: 'nonstack',
          registryEntryCount: 0,
          discoveredCount: 0,
          missingCount: 0,
          inPlan: false,
          registryEntryDetails: [],
          sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
        });
        continue;
      }

      const registryEntries = this.findRegistryEntries(control);

      // Check if all entries were excluded by enclave filter
      if (registryEntries.length === 0 && this.excludedEntryIds.size > 0) {
        // Control has no entries after filtering — out of scope for this enclave
        const status: ControlStatus = {
          control,
          category: 'out_of_scope',
          automationType: 'nonstack',
          registryEntryCount: 0,
          discoveredCount: 0,
          missingCount: 0,
          inPlan: false,
          reason: 'Infrastructure tier excluded by tenant enclave model',
          registryEntryDetails: [],
          sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
        };
        outOfScope.push(status);
        continue;
      }

      const registryEntryIds = registryEntries.map(e => e.entry_id);
      const automationType = this.mpControls
        ? this.classifyFromMPControl(registryEntries, this.mpControls, control.control_id)
        : this.classifyAutomation(registryEntries) === 'nonstack' && this.hasIndirectEntries(control.control_id)
          ? 'automated'
          : this.classifyAutomation(registryEntries);
      const inPlan = this.isInPlan(control, registryEntryIds.length > 0);

      // Count discovery statuses for matching entry_ids
      let discoveredCount = 0;
      let missingCount = 0;
      let checkedCount = 0;

      for (const entryId of registryEntryIds) {
        // Discovery results are keyed by sub.id which matches entry_id in the registry
        const statusValue = this.discoveryResults.get(entryId);
        const statusVal = typeof statusValue === 'string' ? statusValue : statusValue?.status;
        if (statusVal === 'exists') {
          discoveredCount++;
          checkedCount++;
        } else if (statusVal === 'missing') {
          missingCount++;
          checkedCount++;
        } else if (statusVal === 'error') {
          checkedCount++;
        }
        // no_query or undefined = not checked
      }

      let category: ControlStatus['category'];
      let reason: string | undefined;

      if (this.planControlIds === null) {
        // Plan-less mode (Assess): satisfied or wont_be_satisfied only
        if (registryEntryIds.length === 0) {
          category = 'wont_be_satisfied';
          reason = 'No registry entries';
        } else if (checkedCount > 0 && missingCount === 0 && discoveredCount === checkedCount) {
          // All checked entries exist — check verdicts
          let hasNotSatVerdict = false;

          for (const entryId of registryEntryIds) {
            const statusValue = this.discoveryResults.get(entryId);
            let verdict = typeof statusValue === 'object' ? statusValue.verdict : undefined;
            if (!verdict) {
              const entry = registryEntries.find(e => e.entry_id === entryId);
              const fileVerdict = this.readEvidenceVerdict(entryId, entry?.label || '');
              if (fileVerdict) verdict = fileVerdict;
            }
            if (verdict === 'NOT_SAT') {
              hasNotSatVerdict = true;
              break;
            }
          }

          if (hasNotSatVerdict) {
            category = 'wont_be_satisfied';
            reason = 'Configuration verification failed';
          } else {
            category = 'satisfied';
          }
        } else {
          category = 'wont_be_satisfied';
          reason = missingCount > 0 ? `${missingCount} of ${registryEntryIds.length} not configured` : 'Not yet verified';
        }
      } else if (!inPlan && registryEntryIds.length === 0) {
        category = 'wont_be_satisfied';
        reason = 'No registry entries and not in plan';
      } else if (!inPlan) {
        category = 'wont_be_satisfied';
        reason = 'Not in plan';
      } else if (registryEntryIds.length === 0) {
        category = 'wont_be_satisfied';
        reason = 'In plan but no registry entries';
      } else if (checkedCount > 0 && missingCount === 0 && discoveredCount === checkedCount) {
        // All checked entries exist on the tenant — verify verdicts from evidence files
        let hasNotSatVerdict = false;
        for (const entryId of registryEntryIds) {
          const statusValue = this.discoveryResults.get(entryId);
          let verdict = typeof statusValue === 'object' ? statusValue.verdict : undefined;
          if (!verdict) {
            const entry = registryEntries.find(e => e.entry_id === entryId);
            const fileVerdict = this.readEvidenceVerdict(entryId, entry?.label || '');
            if (fileVerdict) verdict = fileVerdict;
          }
          if (verdict === 'NOT_SAT') {
            hasNotSatVerdict = true;
            break;
          }
        }
        category = hasNotSatVerdict ? 'wont_be_satisfied' : 'satisfied';
        if (hasNotSatVerdict) reason = 'Configuration verification failed';
      } else {
        // In plan with registry entries, but some/all are missing or unchecked
        category = 'will_be_satisfied';
      }

      const registryEntryDetails = this.buildEntryDetails(registryEntries);

      const cs: ControlStatus = {
        control,
        category,
        automationType,
        registryEntryCount: registryEntryIds.length,
        discoveredCount,
        missingCount,
        inPlan,
        reason,
        registryEntryDetails,
        sprsWeight: this.sprsWeights.get(control.nist_ref)?.weight ?? 0,
      };

      if (category === 'satisfied') satisfied.push(cs);
      else if (category === 'will_be_satisfied') willBeSatisfied.push(cs);
      else wontBeSatisfied.push(cs);
    }

    // Build family breakdown
    const byFamily: Record<string, FamilyStatus> = {};
    for (const f of this.reference.families) {
      byFamily[f.abbreviation] = {
        name: f.name,
        total: f.control_count,
        satisfied: 0,
        provisional: 0,
        excluded: 0,
        nonsStackOos: 0,
        willBe: 0,
        wontBe: 0,
        notVerified: 0,
        outOfScope: 0,
      };
    }

    for (const cs of satisfied) {
      if (byFamily[cs.control.family]) {
        if (cs.automationType === 'document-absence') {
          byFamily[cs.control.family].excluded++;
        } else {
          byFamily[cs.control.family].satisfied++;
        }
      }
    }
    for (const cs of provisional) {
      if (byFamily[cs.control.family]) byFamily[cs.control.family].provisional++;
    }
    for (const cs of willBeSatisfied) {
      if (byFamily[cs.control.family]) byFamily[cs.control.family].willBe++;
    }
    for (const cs of wontBeSatisfied) {
      if (byFamily[cs.control.family]) byFamily[cs.control.family].wontBe++;
    }
    for (const cs of notVerified) {
      if (byFamily[cs.control.family]) byFamily[cs.control.family].notVerified++;
    }
    for (const cs of outOfScope) {
      if (byFamily[cs.control.family]) {
        byFamily[cs.control.family].outOfScope++;
        if (cs.reason?.startsWith('SI scope exclusion')) {
          byFamily[cs.control.family].excluded++;
        } else {
          byFamily[cs.control.family].nonsStackOos++;
        }
      }
    }

    return {
      total: this.reference.total_controls - skipControlIds.size,
      satisfied,
      provisional,
      willBeSatisfied,
      wontBeSatisfied,
      notVerified,
      outOfScope,
      byFamily,
    };
  }

}

/** SPRS roll-up of an Assess result — points-off semantics (max 110). */
export interface SprsByCategory {
  satisfied: number;      // SAT controls cost 0 points off
  provisional: number;    // PROV controls cost 0 points off
  not_satisfied: number;  // canonical weights deducted for every control not proven met
                          // (NOT SAT + planned-but-unverified + will-be) — FX2-ST2
  not_verified: number;   // the planned-but-unverified share of not_satisfied
  total: number;          // max SPRS score (constant 110)
  score: number;          // total - not_satisfied
}

/**
 * FX2-ST1: the one production SPRS roll-up for Assess (the route sends this to the GUI).
 * Weights are the canonical ces-shared ones carried on each ControlStatus.
 */
export function computeSprsByCategory(status: CmmcStatus): SprsByCategory {
  const sum = (list: ControlStatus[]) => list.reduce((acc, cs) => acc + (cs.sprsWeight ?? 0), 0);
  const notVerified = sum(status.notVerified);
  // Only a proven control earns its points: NOT SAT, planned-unverified and will-be all deduct.
  const notSatisfied = sum(status.wontBeSatisfied) + notVerified + sum(status.willBeSatisfied);
  return { satisfied: 0, provisional: 0, not_satisfied: notSatisfied, not_verified: notVerified, total: 110, score: 110 - notSatisfied };
}

/** FX2-ST2: an evidence/execution record produced by a dry run (never a real post-state). */
export function isDryRunRecord(rec: any): boolean {
  if (!rec || typeof rec !== 'object') return false;
  const flag = (o: any) => !!o && typeof o === 'object' && (o.dry_run === true || o.dryRun === true);
  return flag(rec) || flag(rec.metadata) || flag(rec.post_state) || flag(rec.postState) || flag(rec.pre_state);
}
