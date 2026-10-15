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
import { createHash, randomUUID } from 'node:crypto';
import type { PersonnelEvidenceArtifact } from '../../shared/types/personnel.types.js';

/**
 * Handles file storage for personnel evidence artifacts.
 *
 * Storage layout: {storageRoot}/personnel/{tenantSlug}/attachments/{personnelId}/{artifactId}-{filename}
 */
export class AttachmentHandler {
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  private attachmentDir(tenantSlug: string, personnelId: string): string {
    return path.join(this.storageRoot, 'personnel', tenantSlug, 'attachments', personnelId);
  }

  /**
   * Save an uploaded file to disk and return artifact metadata.
   */
  saveAttachment(
    tenantSlug: string,
    personnelId: string,
    file: { originalname: string; path: string },
    metadata: { type: PersonnelEvidenceArtifact['type']; uploadedBy: string },
  ): PersonnelEvidenceArtifact {
    const artifactId = randomUUID();
    const dir = this.attachmentDir(tenantSlug, personnelId);
    fs.mkdirSync(dir, { recursive: true });

    const destFilename = `${artifactId}-${file.originalname}`;
    const destPath = path.join(dir, destFilename);

    // Read uploaded temp file, compute hash, write to final location
    const fileBuffer = fs.readFileSync(file.path);
    const contentHash = createHash('sha256').update(fileBuffer).digest('hex');
    fs.writeFileSync(destPath, fileBuffer);

    // Clean up temp file
    try {
      fs.unlinkSync(file.path);
    } catch {
      // ignore cleanup errors
    }

    return {
      id: artifactId,
      type: metadata.type,
      filename: file.originalname,
      uploadDate: new Date().toISOString(),
      uploadedBy: metadata.uploadedBy,
      contentHash,
      storagePath: destPath,
      metadata: {},
    };
  }

  /**
   * Read an attachment file from disk.
   */
  loadAttachment(tenantSlug: string, personnelId: string, artifactId: string): { buffer: Buffer; filename: string } | null {
    const dir = this.attachmentDir(tenantSlug, personnelId);
    if (!fs.existsSync(dir)) return null;

    const files = fs.readdirSync(dir);
    const match = files.find(f => f.startsWith(artifactId + '-'));
    if (!match) return null;

    const filePath = path.join(dir, match);
    const buffer = fs.readFileSync(filePath);
    const filename = match.substring(artifactId.length + 1);
    return { buffer, filename };
  }

  /**
   * Delete an attachment file from disk.
   */
  deleteAttachment(tenantSlug: string, personnelId: string, artifactId: string): boolean {
    const dir = this.attachmentDir(tenantSlug, personnelId);
    if (!fs.existsSync(dir)) return false;

    const files = fs.readdirSync(dir);
    const match = files.find(f => f.startsWith(artifactId + '-'));
    if (!match) return false;

    fs.unlinkSync(path.join(dir, match));
    return true;
  }
}
