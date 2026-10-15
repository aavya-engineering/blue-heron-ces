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
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import archiver from 'archiver';
import type { AssessmentSnapshot, CmmcControl } from 'ces-shared/types/controls';
import type { PolicyDocument } from 'ces-shared/types/policy';
import type { PersonnelRecord } from '../../shared/types/personnel.types.js';
import type { AdminOpsEvidence } from 'ces-shared/types/adminops-evidence';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { packageAdminOpsRow } from '../adminops/adminopsViews.js';
import {
  downloadBlob,
  listBlobs,
  type EvidenceStorageConfig,
} from 'ces-shared/blob';

interface ControlsReference {
  total_controls: number;
  controls: CmmcControl[];
}

interface PackageBuildResult {
  packageId: string;
  filePath: string;
  fileCount: number;
  sizeBytes: number;
}

/**
 * Builds a .zip evidence package for C3PAO assessment.
 * Reads artifacts and manifests from Azure Blob Storage.
 */
export class EvidencePackager {
  private readonly controls: CmmcControl[];

  constructor(controlsRefPath: string) {
    const ref: ControlsReference = JSON.parse(fs.readFileSync(controlsRefPath, 'utf-8'));
    this.controls = ref.controls;
  }

  async build(params: {
    assessment: AssessmentSnapshot;
    sspPath?: string;
    sprsPath?: string;
    poamPath?: string;
    sspDocxPath?: string;
    poamDocxPath?: string;
    evidenceStorage?: EvidenceStorageConfig;
    policies?: PolicyDocument[];
    personnelRecords?: PersonnelRecord[];
    adminOpsRows?: AdminOpsEvidence[];
    /** M4a: EC evidence items (manual uploads/attestations) with their fetched bytes. */
    ecEvidenceItems?: Array<{ item: EcEvidenceItem; content: Buffer }>;
    outputDir: string;
  }): Promise<PackageBuildResult> {
    const { assessment, sspPath, sprsPath, poamPath, sspDocxPath, poamDocxPath, evidenceStorage, policies, personnelRecords, adminOpsRows, ecEvidenceItems, outputDir } = params;
    const packageId = uuidv4();
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const zipName = `evidence-package-${dateStr}.zip`;
    const zipPath = path.join(outputDir, zipName);

    fs.mkdirSync(outputDir, { recursive: true });

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const integrityEntries: { file: string; sha256: string }[] = [];
    let fileCount = 0;

    const archiveComplete = new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));
    });

    archive.pipe(output);

    const prefix = `evidence-package-${dateStr}`;

    // Cover sheet
    const coverSheet = {
      packageId,
      tenantId: assessment.tenantId,
      generatedAt: new Date().toISOString(),
      snapshotId: assessment.snapshotId,
      controls_met: assessment.controls_met,
      controls_not_met: assessment.controls_not_met,
      sprs_score: assessment.sprs_score,
    };
    this.addJson(archive, `${prefix}/cover-sheet.json`, coverSheet, integrityEntries);
    fileCount++;

    // SSP
    if (sspPath && fs.existsSync(sspPath)) {
      const content = fs.readFileSync(sspPath, 'utf-8');
      archive.append(content, { name: `${prefix}/ssp/system-security-plan.json` });
      integrityEntries.push({ file: 'ssp/system-security-plan.json', sha256: this.hashStr(content) });
      fileCount++;
    }

    // SPRS
    if (sprsPath && fs.existsSync(sprsPath)) {
      const content = fs.readFileSync(sprsPath, 'utf-8');
      archive.append(content, { name: `${prefix}/sprs/sprs-worksheet.json` });
      integrityEntries.push({ file: 'sprs/sprs-worksheet.json', sha256: this.hashStr(content) });
      fileCount++;
    }

    // POA&M
    if (poamPath && fs.existsSync(poamPath)) {
      const content = fs.readFileSync(poamPath, 'utf-8');
      archive.append(content, { name: `${prefix}/poam/plan-of-action.json` });
      integrityEntries.push({ file: 'poam/plan-of-action.json', sha256: this.hashStr(content) });
      fileCount++;
    }

    // SSP DOCX
    if (sspDocxPath && fs.existsSync(sspDocxPath)) {
      const buffer = fs.readFileSync(sspDocxPath);
      archive.append(buffer, { name: `${prefix}/ssp/system-security-plan.docx` });
      integrityEntries.push({ file: 'ssp/system-security-plan.docx', sha256: this.hashStr(buffer.toString('utf-8')) });
      fileCount++;
    }

    // POA&M DOCX
    if (poamDocxPath && fs.existsSync(poamDocxPath)) {
      const buffer = fs.readFileSync(poamDocxPath);
      archive.append(buffer, { name: `${prefix}/poam/plan-of-action.docx` });
      integrityEntries.push({ file: 'poam/plan-of-action.docx', sha256: this.hashStr(buffer.toString('utf-8')) });
      fileCount++;
    }

    // Assessment snapshot
    const snapContent = JSON.stringify(assessment, null, 2);
    archive.append(snapContent, { name: `${prefix}/assessments/latest-snapshot.json` });
    integrityEntries.push({ file: 'assessments/latest-snapshot.json', sha256: this.hashStr(snapContent) });
    fileCount++;

    // Evidence artifacts and manifests from blob storage
    if (evidenceStorage) {
      const controlFamilyMap = new Map<string, string>();
      for (const ctrl of this.controls) {
        controlFamilyMap.set(ctrl.control_id, ctrl.family);
      }

      // Artifacts
      const artifactBlobs = await listBlobs(evidenceStorage, 'artifacts/');
      for (const entry of artifactBlobs) {
        if (!entry.name.endsWith('.json')) continue;
        try {
          const content = await downloadBlob(evidenceStorage, entry.name);
          if (!content) continue;
          const artifact = JSON.parse(content);
          const controlIds: string[] = artifact.controlIds ?? [];
          const family = controlIds.length > 0
            ? (controlFamilyMap.get(controlIds[0]) ?? 'UNKNOWN')
            : 'UNKNOWN';

          const controlDir = controlIds[0] ?? 'unlinked';
          const fileName = entry.name.split('/').pop() ?? 'artifact.json';
          const zipEntryPath = `${prefix}/evidence/by-family/${family}/${controlDir}/${fileName}`;
          archive.append(content, { name: zipEntryPath });
          integrityEntries.push({ file: `evidence/by-family/${family}/${controlDir}/${fileName}`, sha256: this.hashStr(content) });
          fileCount++;
        } catch { /* skip bad blobs */ }
      }

      // Manifests
      const manifestBlobs = await listBlobs(evidenceStorage, 'manifests/');
      for (const entry of manifestBlobs) {
        if (!entry.name.endsWith('.json')) continue;
        try {
          const content = await downloadBlob(evidenceStorage, entry.name);
          if (!content) continue;
          const fileName = entry.name.split('/').pop() ?? 'manifest.json';
          archive.append(content, { name: `${prefix}/evidence/manifests/${fileName}` });
          integrityEntries.push({ file: `evidence/manifests/${fileName}`, sha256: this.hashStr(content) });
          fileCount++;
        } catch { /* skip */ }
      }
    }

    // Policy documents as markdown
    if (policies && policies.length > 0) {
      const specialDocNames: Record<string, string> = {
        SSP: 'system-security-plan.md',
        POAM: 'plan-of-action.md',
        IRP: 'incident-response-plan.md',
      };

      for (const policy of policies) {
        const domain = policy.domain.toUpperCase();
        const isSpecial = domain in specialDocNames;
        const dirName = isSpecial ? domain : domain;
        const fileName = isSpecial
          ? specialDocNames[domain]
          : `${policy.title.toLowerCase().replace(/\s+/g, '-')}.md`;

        const zipEntryPath = `${prefix}/policies/${dirName}/${fileName}`;
        const relPath = `policies/${dirName}/${fileName}`;

        archive.append(policy.markdown, { name: zipEntryPath });
        integrityEntries.push({
          file: relPath,
          sha256: this.hashStr(policy.markdown),
        });
        fileCount++;
      }
    }

    // Personnel records and attachments
    if (personnelRecords && personnelRecords.length > 0) {
      for (const record of personnelRecords) {
        // Add personnel record JSON metadata
        const recordJson = JSON.stringify(record, null, 2);
        const recordZipPath = `${prefix}/personnel/${record.id}.json`;
        const recordRelPath = `personnel/${record.id}.json`;
        archive.append(recordJson, { name: recordZipPath });
        integrityEntries.push({ file: recordRelPath, sha256: this.hashStr(recordJson) });
        fileCount++;

        // Add each attachment file
        for (const artifact of record.evidenceArtifacts ?? []) {
          if (artifact.storagePath && fs.existsSync(artifact.storagePath)) {
            const buffer = fs.readFileSync(artifact.storagePath);
            const attachZipPath = `${prefix}/personnel/attachments/${record.id}/${artifact.id}-${artifact.filename}`;
            const attachRelPath = `personnel/attachments/${record.id}/${artifact.id}-${artifact.filename}`;
            archive.append(buffer, { name: attachZipPath });
            integrityEntries.push({ file: attachRelPath, sha256: artifact.contentHash });
            fileCount++;
          }
        }
      }
    }

    // AdminOps evidence rows
    if (adminOpsRows && adminOpsRows.length > 0) {
      for (const ev of adminOpsRows) {
        const { fileName, json: evJson } = packageAdminOpsRow(ev);
        const zipEntryPath = `${prefix}/adminops/${fileName}`;
        const relPath = `adminops/${fileName}`;
        archive.append(evJson, { name: zipEntryPath });
        integrityEntries.push({ file: relPath, sha256: this.hashStr(evJson) });
        fileCount++;
      }
    }

    // EC evidence items (manual uploads / attestations, M4a) — present for review only;
    // verdicts are computed before these are merged in (ControlAssessor.merge).
    if (ecEvidenceItems && ecEvidenceItems.length > 0) {
      for (const { item, content } of ecEvidenceItems) {
        const controlDir = item.controlIds[0] ?? 'unlinked';
        const zipEntryPath = `${prefix}/evidence/ec/${controlDir}/${item.itemId}-${item.filename}`;
        const relPath = `evidence/ec/${controlDir}/${item.itemId}-${item.filename}`;
        archive.append(content, { name: zipEntryPath });
        integrityEntries.push({ file: relPath, sha256: item.sha256 });
        fileCount++;
      }
    }

    // Integrity manifest
    const integrityManifest = JSON.stringify({
      packageId,
      generatedAt: new Date().toISOString(),
      files: integrityEntries,
    }, null, 2);
    archive.append(integrityManifest, { name: `${prefix}/integrity-manifest.json` });
    fileCount++;

    await archive.finalize();
    await archiveComplete;

    return {
      packageId,
      filePath: zipPath,
      fileCount,
      sizeBytes: archive.pointer(),
    };
  }

  private addJson(archive: archiver.Archiver, name: string, data: unknown, integrity: { file: string; sha256: string }[]): void {
    const content = JSON.stringify(data, null, 2);
    archive.append(content, { name });
    integrity.push({ file: name.split('/').slice(1).join('/'), sha256: this.hashStr(content) });
  }

  private hashStr(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }
}
