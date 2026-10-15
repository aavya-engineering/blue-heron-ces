// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssessmentSource, AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DirectiveMetadata } from 'ces-shared/types/evidence';
import type { ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import { isValidDirective, toExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import { RenderDirectiveSchema } from '../../shared/types/render.types.js';
import type { RenderDirective } from '../../shared/types/render.types.js';
import { getStamperTenantRoot } from 'ces-shared/storage/node';

export interface StamperEvidence {
  complianceVerdict: string;
  sha256Hash: string;
  timestamp: string;
  controlIds: string[];
  entryId: string;
  label: string;
  directiveMetadata?: DirectiveMetadata;
  renderDirective?: RenderDirective;
  evidenceFilePath?: string;
}

export class StamperEvidenceLoader {
  private readonly evidenceDir: string;

  constructor(tenantSlug: string) {
    this.evidenceDir = path.join(getStamperTenantRoot(tenantSlug), 'evidence');
  }

  /**
   * Scan plan-data/{slug}/evidence/**\/*.json and parse each file into StamperEvidence.
   * Returns empty array if evidence directory does not exist.
   */
  loadEvidenceForTenant(): StamperEvidence[] {
    if (!fs.existsSync(this.evidenceDir)) {
      return [];
    }

    const results: StamperEvidence[] = [];

    let files: string[];
    try {
      files = fs.readdirSync(this.evidenceDir, { recursive: true }) as string[];
    } catch {
      return [];
    }

    for (const relPath of files) {
      const normalized = String(relPath).replace(/\\/g, '/');
      if (!normalized.endsWith('.json')) continue;

      const fullPath = path.join(this.evidenceDir, String(relPath));

      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw);

        const controlIds: string[] = parsed.metadata?.controlIds;
        if (!controlIds || !Array.isArray(controlIds) || controlIds.length === 0) {
          continue;
        }

        const verdict: string = parsed.complianceVerdict ?? '';
        const sha256Hash: string = parsed.metadata?.sha256Hash ?? '';
        const timestamp: string = parsed.metadata?.timestamp ?? '';
        const entryId: string = parsed.registryEntry?.entry_id ?? path.basename(fullPath, '.json');
        const label: string = parsed.registryEntry?.label ?? entryId;

        // Parse optional directiveMetadata block
        const rawDm = parsed.directiveMetadata;
        const directiveMetadata: DirectiveMetadata | undefined =
          rawDm && typeof rawDm === 'object' && typeof rawDm.directive === 'string'
            ? {
                control_id: String(rawDm.control_id ?? ''),
                directive: String(rawDm.directive),
                readiness: String(rawDm.readiness ?? 'unknown'),
                platform_inherited: Boolean(rawDm.platform_inherited),
                enforcement_verified: Boolean(rawDm.enforcement_verified),
                narrative_stub: String(rawDm.narrative_stub ?? ''),
                reasoning_trace: String(rawDm.reasoning_trace ?? ''),
                evidence_artifacts: Array.isArray(rawDm.evidence_artifacts)
                  ? rawDm.evidence_artifacts.map(String)
                  : [],
              }
            : undefined;

        // Parse optional eo_render_directive block using Zod schema
        let renderDirective: RenderDirective | undefined;
        const rawRd = parsed.eo_render_directive;
        if (rawRd && typeof rawRd === 'object') {
          const rdResult = RenderDirectiveSchema.safeParse(rawRd);
          if (rdResult.success) {
            renderDirective = rdResult.data;
          } else {
            console.warn(
              `[StamperEvidenceLoader] Invalid eo_render_directive in ${normalized}: ` +
              rdResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
            );
          }
        }

        results.push({
          complianceVerdict: verdict,
          sha256Hash,
          timestamp,
          controlIds,
          entryId,
          label,
          directiveMetadata,
          renderDirective,
          evidenceFilePath: fullPath,
        });
      } catch {
        // Skip malformed JSON files
      }
    }

    return results;
  }

  /**
   * Convert StamperEvidence[] to Map<controlId, AssessmentSource[]>.
   * SAT -> result='imported', NOT_SAT -> result='missing'.
   */
  toAssessmentSources(evidence: StamperEvidence[]): Map<string, AssessmentSource[]> {
    const map = new Map<string, AssessmentSource[]>();

    for (const ev of evidence) {
      const result: AssessmentSource['result'] = ev.complianceVerdict === 'SAT' ? 'imported' : 'missing';

      const source: AssessmentSource = {
        type: 'evidence_import',
        timestamp: ev.timestamp,
        detail: ev.label,
        result,
      };

      for (const controlId of ev.controlIds) {
        const existing = map.get(controlId);
        if (existing) {
          existing.push(source);
        } else {
          map.set(controlId, [source]);
        }
      }
    }

    return map;
  }

  /**
   * Build a Map<controlId, DirectiveMetadata> from evidence that carries directive provenance.
   * First-write-wins per controlId (earlier evidence file takes priority).
   */
  toDirectiveMetadataMap(evidence: StamperEvidence[]): Map<string, DirectiveMetadata> {
    const map = new Map<string, DirectiveMetadata>();

    for (const ev of evidence) {
      if (!ev.directiveMetadata) continue;
      for (const controlId of ev.controlIds) {
        if (!map.has(controlId)) {
          map.set(controlId, ev.directiveMetadata);
        }
      }
    }

    return map;
  }

  /**
   * Load directive metadata for a single control from already-loaded evidence.
   * Validates the directive value and returns an ExtendedDirectiveMetadata or null.
   * Throws on invalid directive values.
   */
  loadDirectiveMetadata(controlId: string, evidence: StamperEvidence[]): ExtendedDirectiveMetadata | null {
    for (const ev of evidence) {
      if (!ev.directiveMetadata) continue;
      if (!ev.controlIds.includes(controlId)) continue;

      const raw = ev.directiveMetadata as unknown as Record<string, unknown>;
      if (!raw.directive || typeof raw.directive !== 'string') {
        console.warn(`[StamperEvidenceLoader] Missing directive_metadata for control ${controlId}`);
        return null;
      }

      if (!isValidDirective(raw.directive as string)) {
        throw new Error(
          `Invalid directive value '${raw.directive}' for control ${controlId}. ` +
          `Valid values: implement, validate, manual, document-absence, document-prohibition, skip.`
        );
      }

      return toExtendedDirectiveMetadata(raw as { directive: string; readiness: string; [key: string]: unknown });
    }

    // No evidence with directive metadata found for this control
    return null;
  }

  /**
   * Enrich an AssessmentSnapshot's controls with extended directive metadata.
   * Iterates controls, calls loadDirectiveMetadata() for each, and attaches
   * the result to the control's directiveMetadata field.
   * Accumulates and logs warnings for controls missing directive metadata.
   */
  enrichAssessmentWithDirectives(
    assessment: AssessmentSnapshot,
    evidence: StamperEvidence[]
  ): { enrichedCount: number; missingControls: string[] } {
    let enrichedCount = 0;
    const missingControls: string[] = [];

    for (const ctrl of assessment.controls) {
      try {
        const extended = this.loadDirectiveMetadata(ctrl.control_id, evidence);
        if (extended) {
          // Assign extended metadata back to the control record
          (ctrl as unknown as Record<string, unknown>).extendedDirectiveMetadata = extended;
          enrichedCount++;
        } else {
          missingControls.push(ctrl.control_id);
        }
      } catch (err) {
        // Invalid directive — propagate the error (halt on invalid per plan)
        throw err;
      }
    }

    if (missingControls.length > 0) {
      console.warn(
        `[StamperEvidenceLoader] ${missingControls.length} controls missing directive metadata. ` +
        `Fallback to existing assessment logic will be used.`
      );
    }

    return { enrichedCount, missingControls };
  }
}
