// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Atomic write module for appending eo_render_status to Stamper evidence
 * JSON files at stamper/plan-data/{slug}/evidence/ (filesystem writes only).
 * Read existing JSON, append eo_render_status, write to .tmp file, rename atomically.
 * Preserve 2-space indent.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeTextArtifact } from 'ces-shared/persistence/files';
import type { RenderStatus } from '../../shared/types/render.types.js';

export class EvidenceFileWriter {
  private readonly evidenceDir: string;

  constructor(stamperRoot: string, tenantSlug: string) {
    this.evidenceDir = path.join(stamperRoot, 'plan-data', tenantSlug, 'evidence');
  }

  /**
   * Append eo_render_status to an evidence file.
   * Reads existing JSON, adds/updates the eo_render_status block,
   * writes atomically via .tmp + rename.
   */
  appendRenderStatus(evidenceFilePath: string, status: RenderStatus): void {
    const fullPath = path.isAbsolute(evidenceFilePath)
      ? evidenceFilePath
      : path.join(this.evidenceDir, evidenceFilePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Evidence file not found: ${fullPath}`);
    }

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Append eo_render_status (does not overwrite existing Stamper content)
    if (!parsed.eo_render_status) {
      parsed.eo_render_status = {};
    }
    parsed.eo_render_status[status.directive_code] = {
      state: status.state,
      artifact_path: status.artifact_path,
      failure_reason: status.failure_reason,
      rendered_at: status.rendered_at,
      artifact_version: status.artifact_version,
    };

    this.atomicWrite(fullPath, JSON.stringify(parsed, null, 2));
  }

  /**
   * Write content to a .tmp file, then rename atomically.
   */
  private atomicWrite(targetPath: string, content: string): void {
    const tmpPath = targetPath + '.tmp';
    writeTextArtifact(tmpPath, content);
    fs.renameSync(tmpPath, targetPath);
  }

  /**
   * Create a backup of the original file before modification.
   */
  backupOriginal(filePath: string): string {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.evidenceDir, filePath);

    const backupPath = fullPath + '.bak';
    fs.copyFileSync(fullPath, backupPath);
    return backupPath;
  }
}
