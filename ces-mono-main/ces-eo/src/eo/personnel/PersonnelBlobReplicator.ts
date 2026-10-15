// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { uploadEvidenceBlob } from 'ces-shared/blob';
import type { EvidenceStorageConfig } from 'ces-shared/blob';
import type { PersonnelRecord, PersonnelTrainingState, TrainingCatalog, PersonnelEvidenceArtifact } from '../../shared/types/personnel.types.js';
import type { ScreeningElementState } from './screening.types.js';
import type { OffboardingProceduralOverlay } from './offboarding.types.js';

export class PersonnelBlobReplicator {
  private readonly config: EvidenceStorageConfig | null;

  constructor(config: EvidenceStorageConfig | null) {
    this.config = config;
  }

  async replicateRecord(tenantSlug: string, record: PersonnelRecord): Promise<void> {
    if (!this.config) return;
    try {
      const content = JSON.stringify(record, null, 2);
      const hash = createHash('sha256').update(content).digest('hex');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const blobPath = `personnel/${tenantSlug}/${record.id}-${timestamp}.json`;
      const envelope = JSON.stringify({ data: record, sha256: hash, writtenAt: new Date().toISOString() }, null, 2);
      await uploadEvidenceBlob(this.config, blobPath, envelope);
    } catch (err) {
      console.warn(`[PersonnelBlobReplicator] Failed to replicate record ${record.id}:`, err instanceof Error ? err.message : String(err));
    }
  }

  async replicateScreeningElement(tenantSlug: string, personnelId: string, elementNum: number, state: ScreeningElementState): Promise<void> {
    if (!this.config) return;
    try {
      const content = JSON.stringify(state, null, 2);
      const hash = createHash('sha256').update(content).digest('hex');
      const blobPath = `personnel/${tenantSlug}/screening/${personnelId}/element-${elementNum}.json`;
      const envelope = JSON.stringify({ data: state, sha256: hash, writtenAt: new Date().toISOString() }, null, 2);
      await uploadEvidenceBlob(this.config, blobPath, envelope);
    } catch (err) {
      console.warn(`[PersonnelBlobReplicator] Failed to replicate screening element ${elementNum} for ${personnelId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  async replicateTrainingState(tenantSlug: string, state: PersonnelTrainingState): Promise<void> {
    if (!this.config) return;
    try {
      const content = JSON.stringify(state, null, 2);
      const hash = createHash('sha256').update(content).digest('hex');
      const blobPath = `personnel/${tenantSlug}/training/${state.personnelId}.json`;
      const envelope = JSON.stringify({ data: state, sha256: hash, writtenAt: new Date().toISOString() }, null, 2);
      await uploadEvidenceBlob(this.config, blobPath, envelope);
    } catch (err) {
      console.warn(`[PersonnelBlobReplicator] Failed to replicate training state for ${state.personnelId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  async replicateCatalog(tenantSlug: string, catalog: TrainingCatalog): Promise<void> {
    if (!this.config) return;
    try {
      const content = JSON.stringify(catalog, null, 2);
      const hash = createHash('sha256').update(content).digest('hex');
      const blobPath = `personnel/${tenantSlug}/training/_catalog.json`;
      const envelope = JSON.stringify({ data: catalog, sha256: hash, writtenAt: new Date().toISOString() }, null, 2);
      await uploadEvidenceBlob(this.config, blobPath, envelope);
    } catch (err) {
      console.warn(`[PersonnelBlobReplicator] Failed to replicate training catalog for ${tenantSlug}:`, err instanceof Error ? err.message : String(err));
    }
  }

  async replicateOffboardingOverlay(tenantSlug: string, personnelId: string, runId: string, overlay: OffboardingProceduralOverlay): Promise<void> {
    if (!this.config) return;
    try {
      const content = JSON.stringify(overlay, null, 2);
      const hash = createHash('sha256').update(content).digest('hex');
      const blobPath = `personnel/${tenantSlug}/offboarding/${personnelId}/${runId}-overlay.json`;
      const envelope = JSON.stringify({ data: overlay, sha256: hash, writtenAt: new Date().toISOString() }, null, 2);
      await uploadEvidenceBlob(this.config, blobPath, envelope);
    } catch (err) {
      console.warn(`[PersonnelBlobReplicator] Failed to replicate offboarding overlay for ${personnelId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  async replicateAttachment(tenantSlug: string, personnelId: string, artifact: PersonnelEvidenceArtifact): Promise<void> {
    if (!this.config) return;
    try {
      const fileBuffer = fs.readFileSync(artifact.storagePath);
      const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
      const base64Content = fileBuffer.toString('base64');
      const blobPath = `personnel/${tenantSlug}/attachments/${personnelId}/${artifact.id}-${artifact.filename}.b64`;
      await uploadEvidenceBlob(this.config, blobPath, base64Content);

      const meta = {
        artifactId: artifact.id,
        originalFilename: artifact.filename,
        contentType: artifact.type,
        sha256: fileHash,
        uploadDate: artifact.uploadDate,
        uploadedBy: artifact.uploadedBy,
        writtenAt: new Date().toISOString(),
      };
      const metaBlobPath = `personnel/${tenantSlug}/attachments/${personnelId}/${artifact.id}-${artifact.filename}.meta.json`;
      await uploadEvidenceBlob(this.config, metaBlobPath, JSON.stringify(meta, null, 2));
    } catch (err) {
      console.warn(`[PersonnelBlobReplicator] Failed to replicate attachment ${artifact.id} for ${personnelId}:`, err instanceof Error ? err.message : String(err));
    }
  }
}
