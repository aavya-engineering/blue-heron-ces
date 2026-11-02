// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { createHash } from 'node:crypto';
import { uploadEvidenceBlob } from 'ces-shared/blob';
import type { EvidenceStorageConfig } from 'ces-shared/blob';
import type { RiskAssessmentConfig, RiskRegister, AnnualSnapshot } from '../../shared/types/risk-assessment.types.js';

export class RiskAssessmentBlobReplicator {
  private readonly config: EvidenceStorageConfig | null;

  constructor(config: EvidenceStorageConfig | null) {
    this.config = config;
  }

  async replicateConfig(tenantSlug: string, riskConfig: RiskAssessmentConfig): Promise<void> {
    if (!this.config) return;
    try {
      const content = JSON.stringify(riskConfig, null, 2);
      const hash = createHash('sha256').update(content).digest('hex');
      const blobPath = `risk-assessment/${tenantSlug}/config.json`;
      const envelope = JSON.stringify({ data: riskConfig, sha256: hash, writtenAt: new Date().toISOString() }, null, 2);
      await uploadEvidenceBlob(this.config, blobPath, envelope);
    } catch (err) {
      console.warn('[RiskAssessmentBlobReplicator] Failed to replicate config:', err instanceof Error ? err.message : String(err));
    }
  }

  async replicateRegister(tenantSlug: string, register: RiskRegister): Promise<void> {
    if (!this.config) return;
    try {
      const content = JSON.stringify(register, null, 2);
      const hash = createHash('sha256').update(content).digest('hex');
      const blobPath = `risk-assessment/${tenantSlug}/register.json`;
      const envelope = JSON.stringify({ data: register, sha256: hash, writtenAt: new Date().toISOString() }, null, 2);
      await uploadEvidenceBlob(this.config, blobPath, envelope);
    } catch (err) {
      console.warn('[RiskAssessmentBlobReplicator] Failed to replicate register:', err instanceof Error ? err.message : String(err));
    }
  }

  async replicateSnapshot(tenantSlug: string, year: number, snapshot: AnnualSnapshot): Promise<void> {
    if (!this.config) return;
    try {
      const content = JSON.stringify(snapshot, null, 2);
      const hash = createHash('sha256').update(content).digest('hex');
      const blobPath = `risk-assessment/${tenantSlug}/snapshots/${year}.json`;
      const envelope = JSON.stringify({ data: snapshot, sha256: hash, writtenAt: new Date().toISOString() }, null, 2);
      await uploadEvidenceBlob(this.config, blobPath, envelope);
    } catch (err) {
      console.warn('[RiskAssessmentBlobReplicator] Failed to replicate snapshot:', err instanceof Error ? err.message : String(err));
    }
  }
}
