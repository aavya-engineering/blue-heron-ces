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
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { ecCatalogRef } from '../evidence/EcEvidenceReader.js';
import { adminOpsRowParts, packageAdminOpsRow, type AdminOpsRowInput } from '../adminops/adminopsViews.js';
import { buildEvidenceIndex, type IndexControl, type PolicyDocumentForCredit } from './EvidenceIndex.js';
import { assessmentApproachFor, objectiveEvidenceSources, type CesSource } from '../ssp/AssessorApproach.js';
import type { EvidenceStore } from '../evidence/store/EvidenceStore.js';
import type { EvidenceRecord } from '../evidence/store/types.js';
import {
  STAMPER_EVIDENCE_SOURCE,
  STAMPER_EVIDENCE_ENDPOINT,
  type StamperEvidenceFileItem,
  type StamperEvidenceIndexItem,
} from '../collect/StamperEvidenceCollector.js';
import {
  downloadBlob,
  listBlobs,
  type EvidenceStorageConfig,
} from 'ces-shared/blob';

interface ControlsReference {
  total_controls: number;
  controls: CmmcControl[];
}

/** GC-PKG-3: one Stamper evidence file of EO's chain (collector C11), ready for `stamper-evidence/`. */
export interface PackagedStamperFile {
  /** The C11 `file` record holding it. */
  recordId: string;
  /** Path below `plan-data/<slug>/evidence`, forward slashes. */
  relPath: string;
  /** sha256 the chain recorded for the file's bytes. */
  chainSha256: string;
  controlIds: string[];
  /** The file's bytes when they still hash to chainSha256; otherwise the chained document as JSON. */
  bytes: Buffer;
  matchesChain: boolean;
}

/** GC-PKG-3: the Stamper evidence of the last C11 index in EO's evidence store. */
export interface StamperChainForPackage {
  indexRecordId: string | null;
  files: PackagedStamperFile[];
  /** Index file ids with no record in the chain. */
  missing: string[];
  /** Why there is no index (no C11 record, store unreadable). */
  note?: string;
}

const sha256Bytes = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/**
 * GC-PKG-3: the Stamper evidence EO's chain holds, as of the last C11 index record (the last assess pass): each
 * indexed file's record and payload, with the file's bytes from `evidenceDir` when they still match the chained hash.
 */
export function readStamperChain(store: EvidenceStore, evidenceDir: string): StamperChainForPackage {
  const records = store.query({ sourceId: STAMPER_EVIDENCE_SOURCE }).filter(r => r.status === 'success');
  const indexRec = records.filter(r => r.endpoint === `${STAMPER_EVIDENCE_ENDPOINT}/index`).pop();
  if (!indexRec) return { indexRecordId: null, files: [], missing: [], note: 'no C11 (collect.stamperEvidence) index record in EO\'s evidence store' };
  const index = store.readPayload(indexRec) as StamperEvidenceIndexItem;
  const byQuery = new Map<string, EvidenceRecord>();
  for (const r of records) {
    if (r.endpoint === `${STAMPER_EVIDENCE_ENDPOINT}/file` && !byQuery.has(r.query)) byQuery.set(r.query, r);
  }
  const files: PackagedStamperFile[] = [];
  const missing: string[] = [];
  for (const id of index.fileIds) {
    const rec = byQuery.get(`${STAMPER_EVIDENCE_ENDPOINT}/${id}`);
    if (!rec) { missing.push(id); continue; }
    const item = store.readPayload(rec) as StamperEvidenceFileItem;
    const onDisk = path.join(evidenceDir, item.relPath);
    const disk = fs.existsSync(onDisk) ? fs.readFileSync(onDisk) : null;
    const matchesChain = disk !== null && sha256Bytes(disk) === item.fileSha256;
    files.push({
      recordId: rec.recordId,
      relPath: item.relPath,
      chainSha256: item.fileSha256,
      controlIds: [...(item.controlIds ?? [])],
      bytes: matchesChain && disk ? disk : Buffer.from(JSON.stringify(item.document, null, 2), 'utf-8'),
      matchesChain,
    });
  }
  return { indexRecordId: indexRec.recordId, files, missing };
}

/** GC-PKG-3: a zip file the objective rows of evidence-index.json may cite, hashed from its bytes. */
interface CatalogFile {
  file: string;
  sha256: string;
  kind: 'stamper' | 'policy' | 'adminops' | 'ec' | 'eo-artifact' | 'personnel-record' | 'personnel-training' | 'personnel-screening' | 'personnel-organisation';
  controlIds: string[];
}

/** GC-PKG-3: one row of evidence-index.json `objectiveRows`: an objective of an assessed control and its zip files. */
export interface ObjectiveIndexRow {
  objectiveId: string;
  controlId: string;
  controlStatus: string;
  sources: Array<{ artifactType: string; cesSource: CesSource; files: string[] }>;
  files: Array<{ file: string; sha256: string }>;
}

const POLICY_NAME_RE = /policies\/([a-z0-9-]+\.md)/g;

/** GC-PKG-3: the zip files that evidence one matrix row of a control (the KB-1 row's `ces_source` decides where to look). */
function filesForSource(row: { ces_source: CesSource; notes: string }, controlId: string, catalog: readonly CatalogFile[]): CatalogFile[] {
  const ofControl = (kind: CatalogFile['kind']) => catalog.filter(f => f.kind === kind && f.controlIds.includes(controlId));
  const ofKind = (kind: CatalogFile['kind']) => catalog.filter(f => f.kind === kind);
  switch (row.ces_source) {
    case 'stamper_evidence': {
      const named = [...row.notes.matchAll(POLICY_NAME_RE)].map(m => m[1]);
      if (named.length > 0) return ofKind('policy').filter(f => named.includes(path.posix.basename(f.file)));
      return ofControl('stamper');
    }
    case 'ao_row':
      return ofControl('adminops');
    case 'ec_upload':
      return [...ofControl('ec'), ...(/personnel_(screening|lifecycle)/.test(row.notes) ? ofKind('personnel-organisation') : [])];
    case 'stack_signal':
      return ofControl('eo-artifact');
    case 'eo_store':
      if (/\bTrainingStore\b/.test(row.notes)) return ofKind('personnel-training');
      if (/\bScreeningElementStore\b/.test(row.notes)) return ofKind('personnel-screening');
      if (/\bPersonnelStore\b/.test(row.notes)) return [...ofKind('personnel-record'), ...ofKind('personnel-organisation')];
      return [];
    default:
      return [];
  }
}

/**
 * GC-PKG-3: a row per 800-171A objective of every assessed control (status not `not_assessed`), driven by the KB-1
 * evidence matrix (`objectiveEvidenceSources`): which zip files evidence it. File lists only; no status, score or
 * credit is read back from it.
 */
export function buildObjectiveRows(controls: ReadonlyArray<{ control_id: string; status: string }>, catalog: readonly CatalogFile[]): ObjectiveIndexRow[] {
  const rows: ObjectiveIndexRow[] = [];
  for (const c of controls) {
    if (c.status === 'not_assessed') continue;
    for (const o of assessmentApproachFor(c.control_id)?.objectives ?? []) {
      const sources = objectiveEvidenceSources(o.objectiveId).map(r => ({
        artifactType: r.artifact_type,
        cesSource: r.ces_source,
        files: filesForSource(r, c.control_id, catalog).map(f => f.file),
      }));
      const cited = new Set(sources.flatMap(s => s.files));
      rows.push({
        objectiveId: o.objectiveId,
        controlId: c.control_id,
        controlStatus: c.status,
        sources,
        files: catalog.filter(f => cited.has(f.file)).map(f => ({ file: f.file, sha256: f.sha256 })),
      });
    }
  }
  return rows;
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
    /** FIN-14 (V76): parsed rows, or reader entries carrying AO's objective ids (written into each row file). */
    adminOpsRows?: AdminOpsRowInput[];
    /** M4a: EC evidence items (manual uploads/attestations) with their fetched bytes. */
    ecEvidenceItems?: Array<{ item: EcEvidenceItem; content: Buffer }>;
    outputDir: string;
    /** GC-PKG-1: allowPartial was set and these exports failed; the cover sheet states both. */
    partial?: { allowPartial: boolean; failures: string[] };
    /** GC-PKG-3: the Stamper evidence of EO's chain (readStamperChain), for stamper-evidence/. */
    stamperChain?: StamperChainForPackage;
    /** GC-PKG-3: training state per person (TrainingStore), for personnel/training/. */
    personnelTraining?: Array<{ personnelId: string; state: unknown }>;
    /** GC-PKG-3: the stored screening elements per person (ScreeningElementStore), for personnel/screening/. */
    personnelScreening?: Array<{ personnelId: string; elements: unknown[] }>;
    /** GC-PKG-3: the organisation's uploaded personnel records (PersonnelStore), for personnel/organisation-records.json. */
    organisationPersonnel?: unknown;
    /** GC-PKG-3: inputs of evidence-index.json's Appendix P part (the SSP's controls, the store records, the policy documents). */
    evidenceIndex?: {
      ssp: { sspId?: string | null; generatedAt?: string; controlImplementations?: IndexControl[] } | null;
      storeRecords: EvidenceRecord[];
      policyDocuments: PolicyDocumentForCredit[];
      tenantSlug: string | null;
    };
  }): Promise<PackageBuildResult> {
    const { assessment, sspPath, sprsPath, poamPath, sspDocxPath, poamDocxPath, evidenceStorage, policies, personnelRecords, adminOpsRows, ecEvidenceItems, outputDir, partial } = params;
    const { stamperChain, personnelTraining, personnelScreening, organisationPersonnel, evidenceIndex } = params;
    const packageId = uuidv4();
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const zipName = `evidence-package-${dateStr}.zip`;
    const zipPath = path.join(outputDir, zipName);

    fs.mkdirSync(outputDir, { recursive: true });

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const integrityEntries: { file: string; sha256: string }[] = [];
    let fileCount = 0;
    // GC-PKG-3: the files evidence-index.json's objective rows may cite, hashed from their bytes.
    const catalog: CatalogFile[] = [];

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
      // GC-PKG-1: a partial package (a DOCX export failed and allowPartial was set) says so here.
      allowPartial: partial?.allowPartial === true,
      partialFailures: partial?.failures ?? [],
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
          catalog.push({ file: `evidence/by-family/${family}/${controlDir}/${fileName}`, sha256: this.hashStr(content), kind: 'eo-artifact', controlIds });
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
        catalog.push({ file: relPath, sha256: this.hashStr(policy.markdown), kind: 'policy', controlIds: [...(policy.nist_controls ?? [])] });
        fileCount++;
      }
    } else {
      // GC-PKG-3: the folder is always present; it stays empty until policies reach EO's policy store (FLOW-3).
      this.addText(archive, `${prefix}/policies/README.md`,
        '# Policies\n\nNo policies imported: EO\'s policy store holds no policy documents for this tenant (policies arrive with FLOW-3).\n',
        integrityEntries);
      fileCount++;
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
        catalog.push({ file: recordRelPath, sha256: this.hashStr(recordJson), kind: 'personnel-record', controlIds: [] });
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

    // GC-PKG-3: training state, stored screening elements and the organisation's uploaded personnel records.
    let personnelFiles = personnelRecords?.length ?? 0;
    for (const { personnelId, state } of personnelTraining ?? []) {
      const rel = `personnel/training/${personnelId}.json`;
      catalog.push({ file: rel, sha256: this.addText(archive, `${prefix}/${rel}`, JSON.stringify(state, null, 2), integrityEntries), kind: 'personnel-training', controlIds: [] });
      fileCount++; personnelFiles++;
    }
    for (const { personnelId, elements } of personnelScreening ?? []) {
      const rel = `personnel/screening/${personnelId}.json`;
      catalog.push({ file: rel, sha256: this.addText(archive, `${prefix}/${rel}`, JSON.stringify(elements, null, 2), integrityEntries), kind: 'personnel-screening', controlIds: [] });
      fileCount++; personnelFiles++;
    }
    if (organisationPersonnel !== undefined && organisationPersonnel !== null) {
      const rel = 'personnel/organisation-records.json';
      catalog.push({ file: rel, sha256: this.addText(archive, `${prefix}/${rel}`, JSON.stringify(organisationPersonnel, null, 2), integrityEntries), kind: 'personnel-organisation', controlIds: [] });
      fileCount++; personnelFiles++;
    }
    if (personnelFiles === 0) {
      this.addText(archive, `${prefix}/personnel/README.md`,
        '# Personnel\n\nNo personnel, screening or training records: EO\'s personnel, screening and training stores hold none for this tenant.\n',
        integrityEntries);
      fileCount++;
    }

    // GC-PKG-3: the Stamper evidence in EO's hash chain (collector C11, its last index), with the hashes.
    const chainFiles = stamperChain?.files ?? [];
    for (const f of chainFiles) {
      const rel = `stamper-evidence/${f.relPath}`;
      archive.append(f.bytes, { name: `${prefix}/${rel}` });
      const sha = sha256Bytes(f.bytes);
      integrityEntries.push({ file: rel, sha256: sha });
      catalog.push({ file: rel, sha256: sha, kind: 'stamper', controlIds: f.controlIds });
      fileCount++;
    }
    if (chainFiles.length > 0) {
      this.addText(archive, `${prefix}/stamper-evidence/chain.json`, JSON.stringify({
        source: STAMPER_EVIDENCE_SOURCE,
        indexRecordId: stamperChain?.indexRecordId ?? null,
        files: chainFiles.map(f => ({
          file: `stamper-evidence/${f.relPath}`, relPath: f.relPath, recordId: f.recordId,
          chainSha256: f.chainSha256, zipSha256: sha256Bytes(f.bytes), matchesChain: f.matchesChain,
        })),
        missing: stamperChain?.missing ?? [],
      }, null, 2), integrityEntries);
      fileCount++;
    } else {
      this.addText(archive, `${prefix}/stamper-evidence/README.md`,
        `# Stamper evidence\n\nNo Stamper evidence in EO's hash chain: ${stamperChain?.note ?? (stamperChain ? 'the last C11 index lists no files' : 'the chain was not read')}.\n`,
        integrityEntries);
      fileCount++;
    }

    // AdminOps evidence rows
    if (adminOpsRows && adminOpsRows.length > 0) {
      for (const input of adminOpsRows) {
        const ev = adminOpsRowParts(input).evidence;
        const { fileName, json: evJson } = packageAdminOpsRow(input);
        const zipEntryPath = `${prefix}/adminops/${fileName}`;
        const relPath = `adminops/${fileName}`;
        archive.append(evJson, { name: zipEntryPath });
        integrityEntries.push({ file: relPath, sha256: this.hashStr(evJson) });
        catalog.push({ file: relPath, sha256: this.hashStr(evJson), kind: 'adminops', controlIds: [...(ev.controlIds ?? [])] });
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
        catalog.push({ file: relPath, sha256: sha256Bytes(content), kind: 'ec', controlIds: [...item.controlIds] });
        fileCount++;
        // EVC.5: items carrying catalog ids (form_id, emx_ids) get a per-item metadata JSON
        // next to their bytes. Items without them are packaged exactly as before.
        if (ecCatalogRef(item)) {
          const metaJson = JSON.stringify(item, null, 2);
          archive.append(metaJson, { name: `${prefix}/evidence/ec/${controlDir}/${item.itemId}.json` });
          integrityEntries.push({ file: `evidence/ec/${controlDir}/${item.itemId}.json`, sha256: this.hashStr(metaJson) });
          fileCount++;
        }
      }
    }

    // GC-PKG-3: evidence-index.json, built here (moved from the run harness's bundle.mjs): the SSP Appendix P index
    // (buildEvidenceIndex) plus objectiveRows, a row per objective of every assessed control naming the zip files
    // that evidence it (KB-1 evidence matrix), each with the sha256 of its bytes.
    const appendixP = buildEvidenceIndex({
      controls: evidenceIndex?.ssp?.controlImplementations ?? [],
      records: evidenceIndex?.storeRecords ?? [],
      tenantId: assessment.tenantId ?? null,
      tenantSlug: evidenceIndex?.tenantSlug ?? null,
      sspId: evidenceIndex?.ssp?.sspId ?? null,
      generatedAt: evidenceIndex?.ssp?.generatedAt ?? assessment.generatedAt,
      policyDocuments: evidenceIndex?.policyDocuments ?? [],
    });
    const assessed = assessment.controls ?? [];
    const objectiveRows = buildObjectiveRows(assessed, catalog);
    const rowControls = new Set(objectiveRows.map(r => r.controlId));
    const indexDoc = {
      ...appendixP,
      snapshotId: assessment.snapshotId,
      objectiveSource: 'ces-shared/data/assessor-evidence-matrix (KB-1)',
      objectiveRows,
      objectiveSummary: {
        rows: objectiveRows.length,
        controls: rowControls.size,
        metControls: assessed.filter(c => c.status === 'met').length,
        metControlsWithRow: assessed.filter(c => c.status === 'met' && rowControls.has(c.control_id)).length,
        rowsWithFiles: objectiveRows.filter(r => r.files.length > 0).length,
        filesCited: new Set(objectiveRows.flatMap(r => r.files.map(f => f.file))).size,
      },
    };
    this.addText(archive, `${prefix}/evidence-index.json`, JSON.stringify(indexDoc, null, 2), integrityEntries);
    fileCount++;

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

  /** GC-PKG-3: append a text file and its integrity entry (sha256 of its UTF-8 bytes); returns that hash. */
  private addText(archive: archiver.Archiver, name: string, content: string, integrity: { file: string; sha256: string }[]): string {
    archive.append(content, { name });
    const sha = this.hashStr(content);
    integrity.push({ file: name.split('/').slice(1).join('/'), sha256: sha });
    return sha;
  }

  private hashStr(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }
}
