// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import fs from 'fs/promises';
import path from 'path';

export class StorageCleanupService {
  constructor(private storageRoot: string) {}

  /**
   * Prune assessment snapshots older than retentionDays.
   * Deletes entire assessment directory (snapshot.json + any related files).
   * @returns Number of assessment directories deleted
   */
  async cleanAssessmentSnapshots(retentionDays: number = 30): Promise<number> {
    const assessmentsDir = path.join(this.storageRoot, 'assessments');
    if (!await this.exists(assessmentsDir)) return 0;

    const cutoffDate = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const assessmentDirs = await fs.readdir(assessmentsDir);
    let deletedCount = 0;

    for (const dir of assessmentDirs) {
      const dirPath = path.join(assessmentsDir, dir);
      const snapshotPath = path.join(dirPath, 'snapshot.json');

      if (await this.exists(snapshotPath)) {
        const stats = await fs.stat(snapshotPath);
        if (stats.mtimeMs < cutoffDate) {
          await fs.rm(dirPath, { recursive: true, force: true });
          deletedCount++;
        }
      }
    }

    return deletedCount;
  }

  /**
   * Prune temp files older than retentionDays.
   * Deletes individual files only (no recursive directory deletion).
   * @returns Number of temp files deleted
   */
  async cleanTempFiles(retentionDays: number = 7): Promise<number> {
    const tempDir = path.join(this.storageRoot, 'temp');
    if (!await this.exists(tempDir)) return 0;

    const cutoffDate = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const files = await fs.readdir(tempDir);
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = await fs.stat(filePath);

      if (stats.isFile() && stats.mtimeMs < cutoffDate) {
        await fs.unlink(filePath);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Delete a specific assessment snapshot by ID.
   * Deletes the entire assessment directory.
   * @returns true if deleted, false if not found
   */
  async deleteSnapshot(snapshotId: string): Promise<boolean> {
    const snapshotDir = path.join(this.storageRoot, 'assessments', snapshotId);
    if (!await this.exists(snapshotDir)) return false;

    await fs.rm(snapshotDir, { recursive: true, force: true });
    return true;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
