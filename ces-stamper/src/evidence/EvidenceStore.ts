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
import { EvidenceMetadata, ArtifactType, CesIdentity } from '../types/schema.types.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { HashingService } from './HashingService.js';
import { BHD_PROVENANCE } from '../config/provenance.js';
import { getCesRepository, type CesRepository, type CesScope } from 'ces-shared/persistence/node';
import type { CesIdentity as SharedCesIdentity } from 'ces-shared/config/ces';

// G2: evidence METADATA is persisted in the unified repository (the artifact CONTENT stays a file
// under evidenceDir — it is the artifact bytes, not domain JSON). See ADR-002.
const EVIDENCE_META_COLLECTION = 'stamper_evidence_metadata';

/**
 * Layer 3: Evidence Outputs — VFS-owned deliverables.
 * Artifacts carry BHD provenance metadata per engagement terms.
 */
export class EvidenceStore {
  private config: StamperConfig;
  private hashingService: HashingService;
  private planCes?: CesIdentity;
  private repo: CesRepository;
  private scope: CesScope;
  private identity: SharedCesIdentity;

  // G1/T2: optional `planCes` identity tags every collected artifact's metadata.
  constructor(config: StamperConfig, planCes?: CesIdentity) {
    this.config = config;
    this.hashingService = new HashingService();
    this.planCes = planCes;
    this.repo = getCesRepository(); // single unified DB at {CES_PIPELINE_ROOT}/ces.db
    this.scope = { tenantId: config.tenantId };
    this.identity = { ...(planCes ?? {}), tenantId: config.tenantId };
  }

  private metaId(planId: string, taskId: string, artifactId: string): string {
    return `${planId}:${taskId}:${artifactId}`;
  }

  async storeArtifact(
    planId: string,
    taskId: string,
    artifactId: string,
    artifactType: ArtifactType,
    controlIds: string[],
    collector: string,
    retentionDays: number,
    content: string | Buffer,
    mimeType?: string
  ): Promise<EvidenceMetadata> {
    const artifactDir = this.getArtifactDirectory(planId, taskId, artifactId);
    this.ensureDirectory(artifactDir);

    // Determine file extension based on mime type or artifact type
    const extension = this.getFileExtension(artifactType, mimeType);
    const contentPath = path.join(artifactDir, `content${extension}`);

    // Write content to file
    fs.writeFileSync(contentPath, content);

    // Compute hash
    const sha256Hash = await this.hashingService.computeFileHash(contentPath);

    // Get file stats
    const stats = fs.statSync(contentPath);

    // Create metadata
    const metadata: EvidenceMetadata = {
      artifact_id: artifactId,
      artifact_type: artifactType,
      task_id: taskId,
      control_ids: controlIds,
      collector: collector,
      collected_at: new Date().toISOString(),
      retention_days: retentionDays,
      storage_location: contentPath,
      sha256_hash: sha256Hash,
      file_size_bytes: stats.size,
      mime_type: mimeType,
      ...(this.planCes ? { ces: this.planCes } : {})
    };

    // G2: persist metadata to the unified repository (tenant-isolated); content stays a file.
    this.repo.put(EVIDENCE_META_COLLECTION, {
      id: this.metaId(planId, taskId, artifactId),
      ces: this.identity,
      data: { provenance: BHD_PROVENANCE, ...metadata },
    });

    return metadata;
  }

  async storeArtifactFromFile(
    planId: string,
    taskId: string,
    artifactId: string,
    artifactType: ArtifactType,
    controlIds: string[],
    collector: string,
    retentionDays: number,
    sourceFilePath: string,
    mimeType?: string
  ): Promise<EvidenceMetadata> {
    const artifactDir = this.getArtifactDirectory(planId, taskId, artifactId);
    this.ensureDirectory(artifactDir);

    const extension = this.getFileExtension(artifactType, mimeType);
    const destPath = path.join(artifactDir, `content${extension}`);

    // Copy file
    fs.copyFileSync(sourceFilePath, destPath);

    // Compute hash
    const sha256Hash = await this.hashingService.computeFileHash(destPath);

    // Get file stats
    const stats = fs.statSync(destPath);

    // Create metadata
    const metadata: EvidenceMetadata = {
      artifact_id: artifactId,
      artifact_type: artifactType,
      task_id: taskId,
      control_ids: controlIds,
      collector: collector,
      collected_at: new Date().toISOString(),
      retention_days: retentionDays,
      storage_location: destPath,
      sha256_hash: sha256Hash,
      file_size_bytes: stats.size,
      mime_type: mimeType,
      ...(this.planCes ? { ces: this.planCes } : {})
    };

    // G2: persist metadata to the unified repository (tenant-isolated); content stays a file.
    this.repo.put(EVIDENCE_META_COLLECTION, {
      id: this.metaId(planId, taskId, artifactId),
      ces: this.identity,
      data: { provenance: BHD_PROVENANCE, ...metadata },
    });

    return metadata;
  }

  getArtifactMetadata(planId: string, taskId: string, artifactId: string): EvidenceMetadata | null {
    const rec = this.repo.get<EvidenceMetadata>(
      EVIDENCE_META_COLLECTION,
      this.metaId(planId, taskId, artifactId),
      this.scope,
    );
    return rec ? rec.data : null;
  }

  getArtifactContent(planId: string, taskId: string, artifactId: string): Buffer | null {
    const metadata = this.getArtifactMetadata(planId, taskId, artifactId);
    if (!metadata) {
      return null;
    }

    if (!fs.existsSync(metadata.storage_location)) {
      return null;
    }

    return fs.readFileSync(metadata.storage_location);
  }

  async verifyArtifactIntegrity(
    planId: string,
    taskId: string,
    artifactId: string
  ): Promise<boolean> {
    const metadata = this.getArtifactMetadata(planId, taskId, artifactId);
    if (!metadata) {
      return false;
    }

    if (!fs.existsSync(metadata.storage_location)) {
      return false;
    }

    return await this.hashingService.verifyFileHash(
      metadata.storage_location,
      metadata.sha256_hash
    );
  }

  listTaskArtifacts(planId: string, taskId: string): EvidenceMetadata[] {
    const prefix = `${planId}:${taskId}:`;
    return this.repo
      .list<EvidenceMetadata>(EVIDENCE_META_COLLECTION, this.scope)
      .filter((r) => r.id.startsWith(prefix))
      .map((r) => r.data);
  }

  listPlanArtifacts(planId: string): EvidenceMetadata[] {
    const prefix = `${planId}:`;
    return this.repo
      .list<EvidenceMetadata>(EVIDENCE_META_COLLECTION, this.scope)
      .filter((r) => r.id.startsWith(prefix))
      .map((r) => r.data);
  }

  private getArtifactDirectory(planId: string, taskId: string, artifactId: string): string {
    return path.join(this.config.evidenceDir, planId, taskId, artifactId);
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private getFileExtension(artifactType: ArtifactType, mimeType?: string): string {
    if (mimeType) {
      const mimeExtensions: Record<string, string> = {
        'application/json': '.json',
        'text/plain': '.txt',
        'text/csv': '.csv',
        'text/html': '.html',
        'application/xml': '.xml',
        'application/pdf': '.pdf'
      };
      return mimeExtensions[mimeType] || '.dat';
    }

    const typeExtensions: Record<ArtifactType, string> = {
      policy: '.pdf',
      procedure: '.pdf',
      ssp: '.pdf',
      diagram: '.png',
      config_export: '.json',
      log_export: '.json',
      ticket_export: '.json',
      training_record: '.pdf',
      scan_report: '.json',
      attestation: '.pdf',
      other: '.dat'
    };

    return typeExtensions[artifactType] || '.dat';
  }
}
