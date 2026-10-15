// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import type { CmmcControl, ControlAssessment, ControlClassification, AssessmentSource, AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DirectiveMetadata } from 'ces-shared/types/evidence';
import type { PolicyDocument } from 'ces-shared/types/policy';
import type { CommandEntry, CommandRegistryFile } from 'ces-shared/types/registry';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { resolveCesIdentity } from 'ces-shared/config/ces';
import { loadCesConfig } from 'ces-shared/config/ces/node';
import { PolicyControlMapper } from '../policies/PolicyControlMapper.js';
import { POLICY_COMPLETENESS_THRESHOLD } from '../policies/constants.js';
import { ecItemsToSources } from '../evidence/EcEvidenceReader.js';

interface ControlsReference {
  total_controls: number;
  controls: CmmcControl[];
}

/** Blob artifact captured to Azure Blob Storage by EO's own signal-capture service (EvidenceCaptureService). */
export interface BlobArtifact {
  artifactId: string;
  runId: string;
  capturedAt: string;
  source: string;
  checkId: string;
  controlIds: string[];
  sha256: string;
}

export class ControlAssessor {
  private readonly controls: CmmcControl[];
  private readonly controlsRefPath: string;
  private readonly entriesByControl: Map<string, CommandEntry[]>;

  constructor(controlsRefPath: string, registries: CommandRegistryFile[] = []) {
    this.controlsRefPath = controlsRefPath;
    const raw = fs.readFileSync(controlsRefPath, 'utf-8');
    const ref: ControlsReference = JSON.parse(raw);
    this.controls = ref.controls;

    // Build per-control entry lookup from command registries (same source as Stamper)
    this.entriesByControl = new Map();
    for (const reg of registries) {
      for (const entry of reg.entries) {
        for (const cid of entry.control_ids) {
          if (!this.entriesByControl.has(cid)) {
            this.entriesByControl.set(cid, []);
          }
          this.entriesByControl.get(cid)!.push(entry);
        }
      }
    }
  }

  /**
   * Classify a control using command registry entries (matches Stamper's classifyAutomation).
   * - All entries have set_command and are not manual_gate/manual_only → 'automated'
   * - All entries are manual_gate or manual_only or lack set_command → 'nonstack'
   * - No entries at all → 'manual' (excluded from registry)
   * - Mix of automated and manual → 'automated'
   */
  private classify(controlId: string): ControlClassification {
    const entries = this.entriesByControl.get(controlId);
    if (!entries || entries.length === 0) return 'manual';

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
    return 'automated';
  }

  merge(
    tenantId: string,
    discoveryResults: never[],
    blobArtifacts: BlobArtifact[],
    ecFindings: unknown[],
    policies: PolicyDocument[] = [],
    stamperEvidenceSources?: Map<string, AssessmentSource[]>,
    signalAssessments?: Map<string, ControlAssessment>,
    directiveMetadataMap?: Map<string, DirectiveMetadata>,
    /** M4a: EC evidence items (manual uploads / attestations) fed by EcEvidenceReader. */
    ecItems: EcEvidenceItem[] = []
  ): AssessmentSnapshot {
    const now = new Date().toISOString();
    const sourcesMerged: string[] = [];
    const ecItemSources = ecItemsToSources(ecItems);

    // Build per-control source map
    const controlSources = new Map<string, AssessmentSource[]>();
    const controlArtifacts = new Map<string, string[]>();
    const controlHasBlobArtifact = new Map<string, boolean>();
    const controlHasEvidenceImport = new Map<string, boolean>();

    // Initialize all controls
    for (const ctrl of this.controls) {
      controlSources.set(ctrl.control_id, []);
      controlArtifacts.set(ctrl.control_id, []);
      controlHasBlobArtifact.set(ctrl.control_id, false);
      controlHasEvidenceImport.set(ctrl.control_id, false);
    }

    // Phase 1.5: Stamper manual gate evidence
    if (stamperEvidenceSources && stamperEvidenceSources.size > 0) {
      sourcesMerged.push('evidence_import');
      for (const [controlId, sources] of stamperEvidenceSources) {
        const existing = controlSources.get(controlId);
        if (existing) {
          existing.push(...sources);
          const hasImported = sources.some(s => s.result === 'imported');
          if (hasImported) {
            controlHasEvidenceImport.set(controlId, true);
          }
        }
      }
    }

    // Phase 2: Blob artifacts from Azure Blob Storage
    if (blobArtifacts.length > 0) {
      sourcesMerged.push('blob_artifact');

      for (const artifact of blobArtifacts) {
        const source: AssessmentSource = {
          type: 'blob_artifact',
          timestamp: artifact.capturedAt || now,
          detail: `${artifact.checkId} (${artifact.source})`,
          result: 'exists',
        };

        for (const controlId of artifact.controlIds) {
          const sources = controlSources.get(controlId);
          if (sources) {
            sources.push(source);
            controlHasBlobArtifact.set(controlId, true);
          }
          // Track artifact IDs per control
          const arts = controlArtifacts.get(controlId);
          if (arts) {
            arts.push(artifact.artifactId);
          }
        }
      }
    }

    // Phase 2.5: Policy document merge
    if (policies.length > 0) {
      sourcesMerged.push('policy_doc');
      const mapper = new PolicyControlMapper(this.controlsRefPath);

      for (const policy of policies) {
        if (policy.completeness < POLICY_COMPLETENESS_THRESHOLD) {
          continue;
        }

        const cmmcControlIds = mapper.mapNistArrayToCmmc(policy.nist_controls);

        for (const controlId of cmmcControlIds) {
          const sources = controlSources.get(controlId);
          if (sources) {
            const policySource: AssessmentSource = {
              type: 'policy_doc',
              timestamp: now,
              detail: `${policy.domain} Policy`,
              result: 'imported',
            };
            sources.push(policySource);
          }
        }
      }
    }

    // Phase 3: EC evidence items (manual uploads / attestations, M4a). `ecFindings` (EC's
    // integrity-ledger findings, /api/findings) is not yet wired into per-control merging —
    // it is accepted here for forward compatibility but unused; the label below now reflects
    // real EC evidence-item data instead of always being pushed on an empty array.
    if (ecItems.length > 0) {
      sourcesMerged.push('ec_capture');
    }
    void ecFindings;

    // Phase 4: Signal evaluations
    if (signalAssessments && signalAssessments.size > 0) {
      sourcesMerged.push('signal_evaluation');
    }

    // Build control assessments
    const assessments: ControlAssessment[] = this.controls.map(ctrl => {
      let sources = controlSources.get(ctrl.control_id) || [];
      const artifacts = controlArtifacts.get(ctrl.control_id) || [];
      const hasBlobArtifact = controlHasBlobArtifact.get(ctrl.control_id) || false;
      const hasEvidenceImport = controlHasEvidenceImport.get(ctrl.control_id) || false;

      // Tenant evidence (blob) takes priority — drop local Stamper evidence when blobs exist
      if (hasBlobArtifact) {
        sources = sources.filter(s => s.type !== 'evidence_import');
      }

      // Merge signal assessment data when available
      const signalAssessment = signalAssessments?.get(ctrl.control_id);
      let controlSignals: ControlAssessment['signals'] = [];
      if (signalAssessment) {
        controlSignals = signalAssessment.signals;
        // Add the evaluator's evidence as a discovery source
        for (const sigSource of signalAssessment.sources) {
          sources.push(sigSource);
        }
      }

      // Status is computed BEFORE EC evidence items are appended (structural guarantee, not
      // just a convention of result:'no_query'): a manual upload can never flip a verdict.
      const sourceStatus = this.determineStatus(sources);

      // Append EC evidence items to `sources` only, for control-detail display — NEVER into
      // `evidenceArtifactIds`. That array also feeds SspGenerator's directive-SPRS "verified
      // artifact" check (DirectiveSprsCalculator, via SspGenerator.ts's `verifiedArtifactIds`)
      // and its narrative "Evidence:" line (SnippetTemplateEngine.ts): both would read an EC
      // upload as a *verified* artifact, a claim EO can't back for evidence nobody has
      // reviewed. `sources` is a strictly display-only structure with no SPRS/SSP consumer, so
      // it's the only place an EC item is safe to appear outside `ControlAssessor` itself; the
      // evidence package takes EC items directly (ecEvidenceItems on EvidencePackager.build),
      // not through this array either.
      const ecSourcesForControl = ecItemSources.get(ctrl.control_id) ?? [];
      const allSources = ecSourcesForControl.length > 0 ? [...sources, ...ecSourcesForControl] : sources;

      return {
        control_id: ctrl.control_id,
        nist_ref: ctrl.nist_ref,
        family: ctrl.family,
        practice: ctrl.practice,
        status: sourceStatus,
        classification: this.classify(ctrl.control_id),
        sources: allSources,
        implementation_narrative: signalAssessment?.implementation_narrative,
        last_assessed: now,
        signals: controlSignals,
        evidenceArtifactIds: artifacts,
        automationSource: signalAssessment ? 'graph' as const :
                          hasBlobArtifact || hasEvidenceImport ? 'imported' as const :
                          'manual' as const,
        lastFetchedAt: now,
        directiveMetadata: directiveMetadataMap?.get(ctrl.control_id),
      };
    });

    // Compute counts
    let met = 0, notMet = 0, partial = 0, notAssessed = 0;
    for (const a of assessments) {
      switch (a.status) {
        case 'met': met++; break;
        case 'not_met': notMet++; break;
        case 'partial': partial++; break;
        case 'not_assessed': notAssessed++; break;
      }
    }

    const liveAssessmentCount = assessments.filter(
      a => a.automationSource === 'graph'
    ).length;

    return {
      snapshotId: uuidv4(),
      tenantId,
      ces: resolveCesIdentity(loadCesConfig(), { tenantId }),
      generatedAt: now,
      controls: assessments,
      sources_merged: sourcesMerged,
      sprs_score: 0, // Calculated by SprsCalculator
      controls_met: met,
      controls_not_met: notMet,
      controls_partial: partial,
      controls_not_assessed: notAssessed,
      liveAssessmentCount,
    };
  }

  /**
   * Single-source status determination (aligns with Stamper):
   * - Any 'exists' or 'imported' source -> 'met'
   * - No positive sources -> 'not_met' or 'not_assessed'
   */
  private determineStatus(
    sources: AssessmentSource[]
  ): ControlAssessment['status'] {
    if (sources.length === 0) return 'not_assessed';

    // All sources are no_query -> not_assessed
    const allNoQuery = sources.every(s => s.result === 'no_query');
    if (allNoQuery) return 'not_assessed';

    // Single-source logic (aligns with Stamper)
    const hasPositive = sources.some(s => s.result === 'exists' || s.result === 'imported');
    if (hasPositive) return 'met';

    return 'not_met';
  }
}
