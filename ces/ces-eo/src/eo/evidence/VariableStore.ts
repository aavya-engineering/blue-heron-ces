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
import {
  uploadEvidenceBlob,
  downloadBlob,
  type EvidenceStorageConfig,
} from 'ces-shared/blob';
import { getStamperPlanDataRoot } from 'ces-shared/storage';

/**
 * Persists resolved variable maps from Stamper stamp captures.
 * Used by drift checks to resolve {variable} placeholders in get_commands.
 */
export class VariableStore {
  private readonly config: EvidenceStorageConfig;

  constructor(evidenceStorage: EvidenceStorageConfig) {
    this.config = evidenceStorage;
  }

  async save(tenantId: string, variables: Record<string, string>): Promise<string> {
    const blobPath = `variables/${tenantId}/latest.json`;
    const data = {
      tenantId,
      savedAt: new Date().toISOString(),
      variables,
    };
    const result = await uploadEvidenceBlob(this.config, blobPath, JSON.stringify(data, null, 2));
    if (!result.success) {
      throw new Error(`Blob upload failed for ${blobPath}: ${result.error}`);
    }
    return result.url;
  }

  async load(tenantId: string): Promise<Record<string, string> | null> {
    const blobPath = `variables/${tenantId}/latest.json`;
    const content = await downloadBlob(this.config, blobPath);
    if (!content) return null;
    const data = JSON.parse(content);
    return data.variables as Record<string, string>;
  }

  /**
   * Load variables.json from Stamper plan-data on disk.
   * Fallback when Azure Blob Storage is unavailable (offline template validation).
   * Path: STAMPER_PLAN_DATA_ROOT/{slug}/variables.json
   */
  loadFromDisk(tenantSlug: string): Record<string, string> | null {
    const root = process.env.STAMPER_PLAN_DATA_ROOT ?? getStamperPlanDataRoot();
    const filePath = path.join(root, tenantSlug, 'variables.json');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, string>;
      return data;
    } catch {
      return null;
    }
  }
}
