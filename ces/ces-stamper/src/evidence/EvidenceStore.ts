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
import { createHash } from 'crypto';
import { EvidenceMetadata, ArtifactType, CesIdentity } from '../types/schema.types.js';
import { StamperConfig } from '../config/StamperConfig.js';
import { HashingService } from './HashingService.js';
import { BHD_PROVENANCE } from '../config/provenance.js';
import { getCesRepository, type CesRepository, type CesScope } from 'ces-shared/persistence/node';
import type { CesIdentity as SharedCesIdentity } from 'ces-shared/config/ces';

// G2: evidence METADATA is persisted in the unified repository (the artifact CONTENT stays a file
// under evidenceDir — it is the artifact bytes, not domain JSON). See ADR-002.
const EVIDENCE_META_COLLECTION = 'stamper_evidence_metadata';

// FLOW-2b: retention recorded on the row of an evidence file Stamper wrote itself (no plan artifact spec).
const WRITTEN_FILE_RETENTION_DAYS = 365;

/**
 * FLOW-2b: where a written evidence file's WORM row goes: the run's store, its plan, the task that
 * wrote the file. A writer given no ledger writes the file only (no row).
 */
export interface EvidenceFileLedger {
  store: EvidenceStore;
  planId: string;
  taskId: string;
}

/** Evidence-file row: the shared metadata plus the file's path relative to plan-data/<slug>/ and its attempt. */
export interface WrittenEvidenceMetadata extends EvidenceMetadata {
  relative_path: string;
  attempt: number;
}

/**
 * FLOW-2b: record one WORM row for an evidence file that was just written. A row failure is
 * reported and never fails the write (the file is already on disk, as before).
 */
export function recordWrittenEvidence(
  ledger: EvidenceFileLedger | undefined,
  evidenceDir: string,
  filePath: string,
  controlIds: string[],
  collector: string,
): void {
  if (!ledger) return;
  try {
    ledger.store.recordWrittenFile(ledger.planId, ledger.taskId, evidenceDir, filePath, controlIds, collector);
  } catch (err) {
    console.warn('[evidence-ledger] row not written for', filePath, '-', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Layer 3: Evidence Outputs — EDC-owned deliverables.
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

  // FLOW-2: the collection is WORM, so every store writes a NEW id `<metaId>#<attempt>`. The next
  // attempt is probed unscoped (findById), mirroring the repository's own WORM existence check.
  private nextAttemptId(planId: string, taskId: string, artifactId: string): string {
    const base = this.metaId(planId, taskId, artifactId);
    let attempt = 1;
    while (this.repo.findById(EVIDENCE_META_COLLECTION, `${base}#${attempt}`)) attempt++;
    return `${base}#${attempt}`;
  }

  // FLOW-2: attempt number of a row id (`#<n>` suffix); a legacy un-suffixed row counts as 0.
  private static attemptOf(id: string): number {
    const m = /#(\d+)$/.exec(id);
    return m ? Number(m[1]) : 0;
  }

  // FLOW-2: latest attempt per (task, artifact) among the scoped rows whose id starts with `prefix`.
  private latestRows(prefix: string): EvidenceMetadata[] {
    const latest = new Map<string, { attempt: number; data: EvidenceMetadata }>();
    for (const r of this.repo.list<EvidenceMetadata>(EVIDENCE_META_COLLECTION, this.scope)) {
      if (!r.id.startsWith(prefix)) continue;
      const attempt = EvidenceStore.attemptOf(r.id);
      const base = attempt > 0 ? r.id.slice(0, r.id.lastIndexOf('#')) : r.id;
      const cur = latest.get(base);
      if (!cur || attempt > cur.attempt) latest.set(base, { attempt, data: r.data });
    }
    return [...latest.values()].map((v) => v.data);
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
      id: this.nextAttemptId(planId, taskId, artifactId),
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
      id: this.nextAttemptId(planId, taskId, artifactId),
      ces: this.identity,
      data: { provenance: BHD_PROVENANCE, ...metadata },
    });

    return metadata;
  }

  /**
   * FLOW-2b: one WORM row for an evidence file Stamper wrote under plan-data/<slug>/ (evidence/ or
   * evidence-by-task/). Artifact id = the file's path relative to the parent of `evidenceDir`
   * (forward slashes), so the row id is `<plan>:<task>:<relative path>#<attempt>`. The hash is
   * the sha256 of the file's bytes on disk now. The file itself is not touched.
   */
  recordWrittenFile(
    planId: string,
    taskId: string,
    evidenceDir: string,
    filePath: string,
    controlIds: string[],
    collector: string,
  ): WrittenEvidenceMetadata {
    const relativePath = path.relative(path.dirname(evidenceDir), filePath).split(path.sep).join('/');
    const bytes = fs.readFileSync(filePath);
    const id = this.nextAttemptId(planId, taskId, relativePath);
    const ext = path.extname(filePath).toLowerCase();
    const metadata: WrittenEvidenceMetadata = {
      artifact_id: relativePath,
      artifact_type: 'other',
      task_id: taskId,
      control_ids: controlIds,
      collector,
      collected_at: new Date().toISOString(),
      retention_days: WRITTEN_FILE_RETENTION_DAYS,
      storage_location: filePath,
      sha256_hash: createHash('sha256').update(bytes).digest('hex'),
      file_size_bytes: bytes.length,
      mime_type: ext === '.json' ? 'application/json' : ext === '.txt' ? 'text/plain' : undefined,
      ...(this.planCes ? { ces: this.planCes } : {}),
      relative_path: relativePath,
      attempt: EvidenceStore.attemptOf(id),
    };
    this.repo.put(EVIDENCE_META_COLLECTION, {
      id,
      ces: this.identity,
      data: { provenance: BHD_PROVENANCE, ...metadata },
    });
    return metadata;
  }

  getArtifactMetadata(planId: string, taskId: string, artifactId: string): EvidenceMetadata | null {
    // FLOW-2: the latest attempt (or the legacy un-suffixed row when no attempt exists).
    const base = this.metaId(planId, taskId, artifactId);
    let best: { attempt: number; data: EvidenceMetadata } | null = null;
    for (const r of this.repo.list<EvidenceMetadata>(EVIDENCE_META_COLLECTION, this.scope)) {
      const n = EvidenceStore.attemptOf(r.id);
      const attempt = r.id === base ? 0 : n > 0 && r.id === `${base}#${n}` ? n : -1;
      if (attempt < 0) continue;
      if (!best || attempt > best.attempt) best = { attempt, data: r.data };
    }
    return best ? best.data : null;
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
    return this.latestRows(`${planId}:${taskId}:`);
  }

  listPlanArtifacts(planId: string): EvidenceMetadata[] {
    return this.latestRows(`${planId}:`);
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
