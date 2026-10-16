// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { createHash } from 'crypto';
import { ExeTask, EvidenceArtifact, EvidenceMetadata } from '../types/schema.types.js';
import { EvidenceStore } from './EvidenceStore.js';
import { ExecutionResult } from '../types/schema.types.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { buildStructuredEvidence } from '../utils/structuredEvidence.js';

export class EvidenceCollector {
  private evidenceStore: EvidenceStore;

  constructor(_config: StamperConfig, evidenceStore: EvidenceStore) {
    this.evidenceStore = evidenceStore;
  }

  async collectTaskEvidence(
    planId: string,
    task: ExeTask,
    executionResult: ExecutionResult
  ): Promise<string[]> {
    const collectedArtifacts: string[] = [];

    if (!task.evidence_emit || task.evidence_emit.length === 0) {
      return collectedArtifacts;
    }

    for (const artifact of task.evidence_emit) {
      // Only collect evidence if collector is 'stamper'
      if (artifact.collector.toLowerCase() === 'stamper') {
        try {
          const artifactId = await this.collectArtifact(
            planId,
            task,
            artifact,
            executionResult
          );
          collectedArtifacts.push(artifactId);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to collect evidence artifact ${artifact.artifact_id}: ${errorMsg}`
          );
        }
      } else {
        // For non-stamper collectors, just log that collection is needed
        // Evidence Logger or admin will handle these
        collectedArtifacts.push(`${artifact.artifact_id}[pending:${artifact.collector}]`);
      }
    }

    return collectedArtifacts;
  }

  private async collectArtifact(
    planId: string,
    task: ExeTask,
    artifact: EvidenceArtifact,
    executionResult: ExecutionResult
  ): Promise<string> {
    let content: string;
    let mimeType: string;

    const taskDirective = task.action.args._directive as string | undefined;

    // document-absence: narrative-only evidence with outcome not_applicable
    if (taskDirective === 'document-absence') {
      const justification = (task.action.args._justification as string) || 'Capability absent from CUI boundary';
      const absenceEvidence = {
        rawResponse: justification,
        outcome: 'not_applicable',
        outcomeRationale: justification,
        metadata: {
          controlIds: task.controls || [],
          timestamp: new Date().toISOString(),
          executorIdentity: 'stamper',
          commandExecuted: '',
          sha256Hash: createHash('sha256').update(justification, 'utf8').digest('hex'),
        }
      };
      content = JSON.stringify(absenceEvidence, null, 2);
      mimeType = 'application/json';

      const metadata = await this.evidenceStore.storeArtifact(
        planId, task.id, artifact.artifact_id, artifact.artifact_type,
        task.controls, 'stamper', artifact.retention_days, content, mimeType
      );
      return metadata.artifact_id;
    }

    // document-prohibition: policy + enforcement evidence with outcome policy_compliance
    if (taskDirective === 'document-prohibition') {
      const justification = (task.action.args._justification as string) || 'Capability prohibited by design';
      const rawOutput = executionResult.stdout || executionResult.output?.toString() || '';
      const enforcementFailed = !!(executionResult.error || (executionResult.exit_code && executionResult.exit_code !== 0));

      const prohibRawCol = JSON.stringify({
        policy_text: justification,
        enforcement_config: rawOutput || 'No enforcement query result',
      });
      const prohibitionEvidence = {
        rawResponse: prohibRawCol,
        outcome: 'policy_compliance',
        outcomeRationale: enforcementFailed
          ? `Prohibition enforcement verification failed: ${executionResult.error || 'Non-zero exit code'}`
          : `Prohibition enforced: ${justification}`,
        complianceVerdict: enforcementFailed ? 'NOT_SAT' : 'SAT',
        verdictRationale: enforcementFailed
          ? 'Enforcement verification failed — prohibition not confirmed'
          : 'Enforcement artifacts confirm prohibition is actively enforced',
        metadata: {
          controlIds: task.controls || [],
          timestamp: new Date().toISOString(),
          executorIdentity: 'stamper',
          commandExecuted: (task.action.args._get_command as string) || '',
          sha256Hash: createHash('sha256').update(prohibRawCol, 'utf8').digest('hex'),
        }
      };
      content = JSON.stringify(prohibitionEvidence, null, 2);
      mimeType = 'application/json';

      const metadata = await this.evidenceStore.storeArtifact(
        planId, task.id, artifact.artifact_id, artifact.artifact_type,
        task.controls, 'stamper', artifact.retention_days, content, mimeType
      );
      return metadata.artifact_id;
    }

    // Build StructuredEvidence for evidence_emit artifacts (default path)
    const rawOutput = executionResult.stdout || executionResult.output?.toString() || '';
    const subCommand: any = {
      id: artifact.artifact_id,
      label: artifact.description,
      set_command: '',
      get_command: '',
      engine: task.action.engine,
      sequence_hint: 0,
      idempotency: 'safe' as any,
      variables_required: [],
      variables_runtime: [],
      captures: [],
      on_failure: 'warn_continue' as any,
      evidence_commands: []
    };

    const structuredEvidence = buildStructuredEvidence(
      rawOutput,
      executionResult.exit_code || 0,
      executionResult.stderr || '',
      executionResult.error ? new Error(executionResult.error) : null,
      subCommand,
      task,
      {},
      undefined
    );

    // Determine what content to capture based on artifact type
    switch (artifact.artifact_type) {
      case 'config_export':
      case 'scan_report':
      case 'log_export':
        content = JSON.stringify(structuredEvidence, null, 2);
        mimeType = 'application/json';
        break;

      default:
        content = JSON.stringify(structuredEvidence, null, 2);
        mimeType = 'application/json';
    }

    // Store the artifact
    const metadata = await this.evidenceStore.storeArtifact(
      planId,
      task.id,
      artifact.artifact_id,
      artifact.artifact_type,
      task.controls,
      'stamper',
      artifact.retention_days,
      content,
      mimeType
    );

    return metadata.artifact_id;
  }

  async collectManualEvidence(
    planId: string,
    taskId: string,
    artifact: EvidenceArtifact,
    controlIds: string[],
    filePath: string
  ): Promise<EvidenceMetadata> {
    return await this.evidenceStore.storeArtifactFromFile(
      planId,
      taskId,
      artifact.artifact_id,
      artifact.artifact_type,
      controlIds,
      'admin',
      artifact.retention_days,
      filePath
    );
  }

  async verifyEvidenceIntegrity(
    planId: string,
    taskId: string,
    artifactId: string
  ): Promise<boolean> {
    return await this.evidenceStore.verifyArtifactIntegrity(planId, taskId, artifactId);
  }

  getTaskEvidence(planId: string, taskId: string): EvidenceMetadata[] {
    return this.evidenceStore.listTaskArtifacts(planId, taskId);
  }

  getPlanEvidence(planId: string): EvidenceMetadata[] {
    return this.evidenceStore.listPlanArtifacts(planId);
  }
}
