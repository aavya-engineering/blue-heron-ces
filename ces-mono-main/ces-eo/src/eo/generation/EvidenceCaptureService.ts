// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SignalResult } from 'ces-shared/types/signal';
import type { ControlAssessment } from 'ces-shared/types/controls';
import { uploadEvidenceBlob, type EvidenceStorageConfig } from 'ces-shared/blob';
import { canonicalSha256 } from 'ces-shared/crypto';
import { v4 as uuidv4 } from 'uuid';

/** Maps CMMC control family prefix to Stamper blob folder name */
const CONTROL_FAMILY_FOLDERS: Record<string, string> = {
  AC: 'access_control',
  AT: 'awareness_training',
  AU: 'audit_accountability',
  CA: 'security_assessment',
  CM: 'configuration_management',
  IA: 'identification_authentication',
  IR: 'incident_response',
  MA: 'maintenance',
  MP: 'media_protection',
  PE: 'physical_protection',
  PS: 'personnel_security',
  RA: 'risk_assessment',
  SC: 'system_communications',
  SI: 'system_information',
};

/**
 * Automatic artifact downloader.
 * When a control is assessed as 'met', captures the signal data as evidence artifacts
 * and uploads to blob storage.
 * Executes in fire-and-forget mode with error collection.
 */
export class EvidenceCaptureService {
  private readonly evidenceStorage: EvidenceStorageConfig | null;
  private readonly errors: Array<{ controlId: string; error: string }> = [];

  constructor(evidenceStorage: EvidenceStorageConfig | null) {
    this.evidenceStorage = evidenceStorage;
  }

  async captureForAssessment(assessment: ControlAssessment): Promise<string[]> {
    if (!this.evidenceStorage) {
      return [];
    }

    if (assessment.status !== 'met') {
      return [];
    }

    const artifactIds: string[] = [];
    const signals = assessment.signals ?? [];

    for (const signal of signals) {
      if (signal.status !== 'success' || !signal.rawData) continue;

      try {
        const artifactId = await this.captureSignal(assessment.control_id, signal);
        if (artifactId) {
          artifactIds.push(artifactId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[EvidenceCaptureService] Failed to capture ${assessment.control_id}/${signal.signalId}: ${msg}`);
        this.errors.push({ controlId: assessment.control_id, error: msg });
      }
    }

    return artifactIds;
  }

  private async captureSignal(controlId: string, signal: SignalResult): Promise<string | null> {
    if (!this.evidenceStorage) return null;

    const artifactId = uuidv4();
    const timestamp = new Date().toISOString();
    // G8: canonical (key-order-stable) SHA-256 of the evidence payload, so the same logical
    // evidence hashes identically regardless of property order returned by the source API.
    const sha256 = canonicalSha256(signal.rawData);

    const artifact = {
      artifactId,
      controlId,
      signalId: signal.signalId,
      source: signal.source,
      endpoint: signal.endpoint,
      capturedAt: timestamp,
      sha256,
      rawValue: signal.rawData,
    };

    // Convention: {family_folder}/{controlId}.{signalId}_{ISO_timestamp}.json
    const familyPrefix = controlId.split('.')[0];
    const familyFolder = CONTROL_FAMILY_FOLDERS[familyPrefix];
    if (!familyFolder) {
      throw new Error(`Unknown control family '${familyPrefix}' from controlId '${controlId}'`);
    }
    const blobPath = `${familyFolder}/${controlId.toLowerCase()}.${signal.signalId}_${timestamp.replace(/[:.]/g, '-')}.json`;
    await uploadEvidenceBlob(
      this.evidenceStorage,
      blobPath,
      JSON.stringify(artifact, null, 2)
    );

    return artifactId;
  }

  getErrors(): Array<{ controlId: string; error: string }> {
    return [...this.errors];
  }
}
