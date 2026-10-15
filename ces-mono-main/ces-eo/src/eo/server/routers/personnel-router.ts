// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import express, { type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import type { EoConfig } from '../../config/EoConfig.js';
import { PersonnelStore } from '../../personnel/PersonnelStore.js';
import { TrainingStore } from '../../personnel/TrainingStore.js';
import { TrainingEmailHelper } from '../../personnel/TrainingEmailHelper.js';
import { AttachmentHandler } from '../../personnel/AttachmentHandler.js';
import { OffboardingWizardStore } from '../../personnel/OffboardingWizardStore.js';
import type { OffboardingRun } from '../../personnel/offboarding.types.js';
import { ScreeningElementStore } from '../../personnel/ScreeningElementStore.js';
import { generateCuiAcknowledgmentPdf } from '../../screening/generateCuiAcknowledgmentPdf.js';
import { PersonnelBlobReplicator } from '../../personnel/PersonnelBlobReplicator.js';
import {
  SCREENING_TEMPLATE_TEXT,
  SCREENING_ELEMENT_TITLES,
  ELEMENT_ARTIFACT_TYPE_MAP,
  ELEMENT_TYPE_DISCRIMINANT,
} from '../../personnel/screening.types.js';
import type { ScreeningElementState } from '../../personnel/screening.types.js';
import { RiskAssessmentStore } from '../../risk-assessment/RiskAssessmentStore.js';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import {
  validateRequest,
  PersonnelCreateRequestSchema,
  PersonnelUpdateRequestSchema,
  LifecycleEventCreateSchema,
  PersonnelConfigSchema,
  OffboardingStepCompleteSchema,
  OffboardingFinalizeSchema,
  TrainingAssignRequestSchema,
  TrainingCompleteRequestSchema,
  TrainingEmailRequestSchema,
  TrainingCatalogSchema,
  ScreeningElementUpdateRequestSchema,
} from '../validation-schemas.js';
import {
  sendError,
  validateUuid,
  resolveTenantScope,
  requireTenantScope,
  getEvidenceStorageConfig,
  loadTimeline,
  saveTimeline,
} from '../eo-router-utils.js';

export interface PersonnelRouterDeps {
  config: EoConfig;
  upload: multer.Multer;
  personnelStore: PersonnelStore;
  trainingStore: TrainingStore;
  attachmentHandler: AttachmentHandler;
  offboardingWizardStore: OffboardingWizardStore;
  screeningElementStore: ScreeningElementStore;
  /** FX-EO7: replicator bound to the REQUESTED tenant's blob storage (default: built from that
   *  tenant's config). A single server-wide replicator wrote tenant B's personnel into the
   *  default tenant's blob account. */
  personnelBlobReplicatorFor?: (tenantJsonPath: string) => PersonnelBlobReplicator;
  riskAssessmentStore: RiskAssessmentStore;
  /** Stamper root for slug -> tenant resolution: FX-EO4 (AdminOps system evidence) and
   *  FX-EO7 (every route requires the requested tenant; no config.tenantSlug fallback). */
  stamperRoot: string;
}

export function createPersonnelRouter(deps: PersonnelRouterDeps): express.Router {
  const {
    config, upload, personnelStore, trainingStore, attachmentHandler,
    offboardingWizardStore, screeningElementStore,
    riskAssessmentStore, stamperRoot,
  } = deps;
  const personnelBlobReplicatorFor = deps.personnelBlobReplicatorFor
    ?? ((tenantJsonPath: string) => new PersonnelBlobReplicator(getEvidenceStorageConfig(config, tenantJsonPath)));

  const router = express.Router();

  /**
   * FX-EO4: wizard step resolution — mark steps system-evidenced by live AdminOps rows whose
   * TARGET is this person (never the operator). Runs on start, read and step completion.
   */
  const refreshSystemEvidence = (slug: string, run: OffboardingRun): void => {
    if (!stamperRoot) return;
    const scope = resolveTenantScope(slug, stamperRoot);
    if (!scope.ok) return;
    const person = personnelStore.get(slug, run.personnelId);
    if (!person) return;
    const n = offboardingWizardStore.applyAdminOpsEvidence(run, scope.tenantId, {
      upn: person.email,
      objectId: person.entraObjectId,
    });
    if (n > 0) offboardingWizardStore.saveRun(run);
  };

  // ── Personnel Endpoints ──

  // GET /api/personnel — list all personnel records for tenant
  router.get('/api/personnel', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    try {
      const records = personnelStore.load(slug);
      res.json(records);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/personnel/readiness — PS control readiness status
  router.get('/api/personnel/readiness', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    try {
      const readiness = personnelStore.getReadiness(slug, screeningElementStore);

      // Compute AT readiness separately using TrainingStore (per Implementation Notes #5)
      const records = personnelStore.load(slug);
      const active = records
        .filter(r => r.screeningState !== 'offboarded')
        .map(r => ({ id: r.id, role: r.role, screeningState: r.screeningState }));

      if (active.length > 0) {
        readiness.at_3_2_1 = trainingStore.isControlMet(slug, 'AT.L2-3.2.1', active) ? 'met' : 'not_met';
        readiness.at_3_2_2 = trainingStore.isControlMet(slug, 'AT.L2-3.2.2', active) ? 'met' : 'not_met';
        readiness.at_3_2_3 = trainingStore.isControlMet(slug, 'AT.L2-3.2.3', active) ? 'met' : 'not_met';
      }

      res.json(readiness);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/risk-assessment/readiness — RA.L2-3.11.1 control readiness status
  router.get('/api/risk-assessment/readiness', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    try {
      const raConfig = riskAssessmentStore.loadConfig(slug, config.missionPlanPath, config.infraManifestPath);
      const register = riskAssessmentStore.loadRegister(slug);
      const snapshots = riskAssessmentStore.listSnapshots(slug);

      // Compute readiness criteria
      const procedure_registered = true; // VFS-POL-011 registered in Phase 7

      const now = Date.now();
      const annual_snapshot_current = snapshots.length > 0 &&
        (now - new Date(snapshots[0].signedOffDate).getTime()) < 365 * 24 * 60 * 60 * 1000;

      const register_recently_updated =
        (now - new Date(register.lastUpdated).getTime()) < 90 * 24 * 60 * 60 * 1000;

      const scope_references_cui = raConfig.scopeStatement.toLowerCase().includes('cui');

      const vulnSources = raConfig.vulnerabilitySources;
      const vulnerability_sources_connected =
        vulnSources.defender_for_cloud.enabled ||
        vulnSources.microsoft_secure_score.enabled ||
        vulnSources.plan_output_not_met.enabled ||
        vulnSources.sentinel_incidents.enabled;

      // Compute status
      const allCriteria = [procedure_registered, annual_snapshot_current, register_recently_updated, scope_references_cui, vulnerability_sources_connected];
      const allMet = allCriteria.every(c => c);
      const otherCriteria = [annual_snapshot_current, register_recently_updated, scope_references_cui, vulnerability_sources_connected];
      const someOtherMet = otherCriteria.some(c => c);

      let status: 'met' | 'partially_met' | 'not_met';
      if (allMet) {
        status = 'met';
      } else if (procedure_registered && someOtherMet) {
        status = 'partially_met';
      } else {
        status = 'not_met';
      }

      // Build summary from register
      const entries_by_risk_level: Record<string, number> = { very_high: 0, high: 0, moderate: 0, low: 0, very_low: 0 };
      for (const entry of register.entries) {
        if (entry.compositeRisk) entries_by_risk_level[entry.compositeRisk]++;
      }

      res.json({
        control_id: 'RA.L2-3.11.1',
        status,
        criteria: {
          procedure_registered,
          annual_snapshot_current,
          register_recently_updated,
          vulnerability_sources_connected,
          scope_references_cui,
        },
        summary: {
          total_entries: register.entries.length,
          entries_by_risk_level,
          last_review_date: register.lastFullReviewDate || null,
          next_review_due: register.nextReviewDue,
        },
      });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/personnel/config — get personnel config
  router.get('/api/personnel/config', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    try {
      const personnelConfig = personnelStore.loadConfig(slug);
      res.json(personnelConfig);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // PUT /api/personnel/config — update personnel config
  router.put('/api/personnel/config', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    const parsed = PersonnelConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'Validation failed', parsed.error.message);
      return;
    }
    try {
      personnelStore.saveConfig(slug, parsed.data);
      res.json(parsed.data);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/personnel/:id — single record detail
  router.get('/api/personnel/:id', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) {
      sendError(res, 400, 'Invalid personnel ID format');
      return;
    }
    const record = personnelStore.get(slug, req.params.id);
    if (!record) {
      sendError(res, 404, `Personnel record not found: ${req.params.id}`);
      return;
    }
    res.json(record);
  });

  // POST /api/personnel — create new record
  router.post('/api/personnel', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    const validation = validateRequest(PersonnelCreateRequestSchema, req.body);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.message);
      return;
    }
    try {
      const record = personnelStore.create(slug, validation.data);

      // Emit timeline event
      const timeline = loadTimeline(config.storageRoot, slug);
      timeline.events.push({
        eventId: `personnel-add-${Date.now()}`,
        type: 'custom',
        title: `Personnel added: ${validation.data.displayName}`,
        date: new Date().toISOString(),
        detail: `Role: ${validation.data.role}`,
      });
      saveTimeline(config.storageRoot, timeline);

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateRecord(slug, record).catch(err => console.warn('[blob-replicate] personnel create:', err));

      res.status(201).json(record);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // PUT /api/personnel/:id — update record
  router.put('/api/personnel/:id', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) {
      sendError(res, 400, 'Invalid personnel ID format');
      return;
    }
    const validation = validateRequest(PersonnelUpdateRequestSchema, req.body);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.message);
      return;
    }
    const record = personnelStore.get(slug, req.params.id);
    if (!record) {
      sendError(res, 404, `Personnel record not found: ${req.params.id}`);
      return;
    }
    try {
      const updates = validation.data;
      if (updates.screeningState !== undefined) {
        const oldState = record.screeningState;
        record.screeningState = updates.screeningState;
        record.lifecycleEvents.push({
          timestamp: new Date().toISOString(),
          event: `state-change:${oldState}>${updates.screeningState}`,
          actor: 'user',
          details: `State changed from ${oldState} to ${updates.screeningState}`,
        });
      }
      if (updates.displayName !== undefined) record.displayName = updates.displayName;
      if (updates.email !== undefined) record.email = updates.email;
      if (updates.role !== undefined) record.role = updates.role;
      if (updates.notes !== undefined) record.notes = updates.notes;
      if (updates.lastScreenedDate !== undefined) record.lastScreenedDate = updates.lastScreenedDate;
      if (updates.nextReviewDate !== undefined) record.nextReviewDate = updates.nextReviewDate;
      if (updates.offboardedDate !== undefined) record.offboardedDate = updates.offboardedDate;

      personnelStore.save(slug, record);

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateRecord(slug, record).catch(err => console.warn('[blob-replicate] personnel update:', err));

      res.json(record);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/personnel/:id/events — add lifecycle event
  router.post('/api/personnel/:id/events', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) {
      sendError(res, 400, 'Invalid personnel ID format');
      return;
    }
    const validation = validateRequest(LifecycleEventCreateSchema, req.body);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.message);
      return;
    }
    try {
      const updated = personnelStore.addEvent(slug, req.params.id, validation.data);
      if (!updated) {
        sendError(res, 404, `Personnel record not found: ${req.params.id}`);
        return;
      }

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateRecord(slug, updated).catch(err => console.warn('[blob-replicate] personnel event:', err));

      res.json({ success: true, event: updated.lifecycleEvents[updated.lifecycleEvents.length - 1] });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // DELETE /api/personnel/:id — mark offboarded
  router.delete('/api/personnel/:id', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) {
      sendError(res, 400, 'Invalid personnel ID format');
      return;
    }
    const record = personnelStore.get(slug, req.params.id);
    if (!record) {
      sendError(res, 404, `Personnel record not found: ${req.params.id}`);
      return;
    }
    try {
      record.screeningState = 'offboarded';
      record.offboardedDate = new Date().toISOString();
      record.lifecycleEvents.push({
        timestamp: new Date().toISOString(),
        event: 'offboarded',
        actor: 'user',
        details: 'Record marked as offboarded',
      });
      personnelStore.save(slug, record);

      // Emit timeline event
      const timeline = loadTimeline(config.storageRoot, slug);
      timeline.events.push({
        eventId: `personnel-offboard-${Date.now()}`,
        type: 'custom',
        title: `Personnel offboarded: ${record.displayName}`,
        date: new Date().toISOString(),
      });
      saveTimeline(config.storageRoot, timeline);

      res.json(record);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // DELETE /api/personnel/:id/record — hard delete personnel record
  router.delete('/api/personnel/:id/record', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) {
      sendError(res, 400, 'Invalid personnel ID format');
      return;
    }
    try {
      const deleted = personnelStore.delete(slug, req.params.id);
      if (!deleted) {
        sendError(res, 404, `Personnel record not found: ${req.params.id}`);
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // ── Personnel Attachment Endpoints ──

  // POST /api/personnel/:id/attachments — upload attachment
  router.post('/api/personnel/:id/attachments', upload.single('file') as unknown as express.RequestHandler, (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) {
      sendError(res, 400, 'Invalid personnel ID format');
      return;
    }
    const record = personnelStore.get(slug, req.params.id);
    if (!record) {
      sendError(res, 404, `Personnel record not found: ${req.params.id}`);
      return;
    }
    if (!req.file) {
      sendError(res, 400, 'No file uploaded');
      return;
    }
    const artifactType = req.body.type || 'other';
    const uploadedBy = req.body.uploadedBy || 'user';
    try {
      const artifact = attachmentHandler.saveAttachment(slug, req.params.id, req.file, {
        type: artifactType,
        uploadedBy,
      });
      personnelStore.addArtifact(slug, req.params.id, artifact);
      record.lifecycleEvents.push({
        timestamp: new Date().toISOString(),
        event: 'artifact-added',
        actor: uploadedBy,
        details: `Uploaded ${artifact.filename} (${artifactType})`,
      });
      personnelStore.save(slug, record);

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateAttachment(slug, req.params.id, artifact).catch(err => console.warn('[blob-replicate] attachment:', err));

      res.status(201).json(artifact);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/personnel/:id/attachments/:artifactId — download attachment
  router.get('/api/personnel/:id/attachments/:artifactId', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id) || !validateUuid(req.params.artifactId)) {
      sendError(res, 400, 'Invalid ID format');
      return;
    }
    const result = attachmentHandler.loadAttachment(slug, req.params.id, req.params.artifactId);
    if (!result) {
      sendError(res, 404, 'Attachment not found');
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  });

  // DELETE /api/personnel/:id/attachments/:artifactId — delete attachment
  router.delete('/api/personnel/:id/attachments/:artifactId', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id) || !validateUuid(req.params.artifactId)) {
      sendError(res, 400, 'Invalid ID format');
      return;
    }
    const record = personnelStore.get(slug, req.params.id);
    if (!record) {
      sendError(res, 404, `Personnel record not found: ${req.params.id}`);
      return;
    }
    try {
      attachmentHandler.deleteAttachment(slug, req.params.id, req.params.artifactId);
      personnelStore.removeArtifact(slug, req.params.id, req.params.artifactId);
      record.lifecycleEvents.push({
        timestamp: new Date().toISOString(),
        event: 'artifact-removed',
        actor: 'user',
        details: `Removed attachment ${req.params.artifactId}`,
      });
      personnelStore.save(slug, record);
      res.json({ success: true });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // ── Offboarding Wizard Endpoints ──

  // POST /api/personnel/:id/offboarding — start offboarding run
  router.post('/api/personnel/:id/offboarding', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    const record = personnelStore.get(slug, req.params.id);
    if (!record) { sendError(res, 404, `Personnel record not found: ${req.params.id}`); return; }

    const run = offboardingWizardStore.startRun(slug, req.params.id, record.displayName);
    refreshSystemEvidence(slug, run);

    record.screeningState = 'offboarding-in-progress';
    record.lifecycleEvents.push({
      timestamp: new Date().toISOString(),
      event: 'offboarding-started',
      actor: 'user',
      details: `Offboarding wizard started, run ${run.runId}`,
    });
    personnelStore.save(slug, record);

    res.status(201).json(run);
  });

  // GET /api/personnel/:id/offboarding — get current offboarding run
  router.get('/api/personnel/:id/offboarding', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    const run = offboardingWizardStore.loadRun(slug, req.params.id);
    if (!run) { sendError(res, 404, 'No active offboarding run'); return; }
    refreshSystemEvidence(slug, run);
    res.json(run);
  });

  // PUT /api/personnel/:id/offboarding/step/:stepId — complete a step
  router.put('/api/personnel/:id/offboarding/step/:stepId', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    const run = offboardingWizardStore.loadRun(slug, req.params.id);
    if (!run) { sendError(res, 404, 'No active offboarding run'); return; }

    const validation = validateRequest(OffboardingStepCompleteSchema, req.body);
    if (!validation.success) { sendError(res, 400, validation.error.issues[0]?.message ?? 'Invalid request'); return; }

    try {
      refreshSystemEvidence(slug, run);
      offboardingWizardStore.completeStep(run, req.params.stepId, validation.data.attestor, validation.data.notes, validation.data.evidenceArtifactId);
      offboardingWizardStore.saveRun(run);
      res.json(run);
    } catch (err) {
      sendError(res, 400, (err as Error).message);
    }
  });

  // POST /api/personnel/:id/offboarding/complete — finalize offboarding
  router.post('/api/personnel/:id/offboarding/complete', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    const run = offboardingWizardStore.loadRun(slug, req.params.id);
    if (!run) { sendError(res, 404, 'No active offboarding run'); return; }

    const allCompleted = run.steps.every(s => s.completed);
    if (!allCompleted) { sendError(res, 400, 'Not all steps are completed'); return; }

    const validation = validateRequest(OffboardingFinalizeSchema, req.body);
    if (!validation.success) { sendError(res, 400, validation.error.issues[0]?.message ?? 'Invalid request'); return; }

    const overlay = offboardingWizardStore.generateProceduralOverlay(run, validation.data.attestor);

    // Write overlay JSON to attachments directory
    const attachDir = path.join(config.storageRoot, 'personnel', slug, 'attachments', req.params.id);
    fs.mkdirSync(attachDir, { recursive: true });
    const overlayFilename = `${overlay.artifactId}-offboarding-overlay.json`;
    const overlayPath = path.join(attachDir, overlayFilename);
    writeJsonArtifact(overlayPath, overlay, { pretty: true });

    personnelBlobReplicatorFor(scope.tenantJsonPath).replicateOffboardingOverlay(slug, req.params.id, run.runId, overlay).catch(err => console.warn('[blob-replicate] offboarding overlay:', err));

    // Add artifact reference to personnel record
    const artifact = {
      id: overlay.artifactId,
      type: 'offboarding-procedural-overlay' as const,
      filename: overlayFilename,
      uploadDate: new Date().toISOString(),
      uploadedBy: validation.data.attestor,
      contentHash: createHash('sha256').update(JSON.stringify(overlay)).digest('hex'),
      storagePath: overlayPath,
      metadata: { runId: run.runId },
    };
    personnelStore.addArtifact(slug, req.params.id, artifact);

    // Update personnel record
    const record = personnelStore.get(slug, req.params.id);
    if (record) {
      record.screeningState = 'offboarded';
      record.offboardedDate = new Date().toISOString();
      record.lifecycleEvents.push({
        timestamp: new Date().toISOString(),
        event: 'offboarded',
        actor: validation.data.attestor,
        details: `Offboarding completed, overlay artifact ${overlay.artifactId}`,
      });
      personnelStore.save(slug, record);
    }

    // Delete in-progress run
    offboardingWizardStore.deleteRun(slug, req.params.id);

    res.json({ artifactId: overlay.artifactId, personnelRecord: personnelStore.get(slug, req.params.id) });
  });

  // DELETE /api/personnel/:id/offboarding — cancel offboarding
  router.delete('/api/personnel/:id/offboarding', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    const run = offboardingWizardStore.loadRun(slug, req.params.id);
    if (!run) { sendError(res, 404, 'No active offboarding run'); return; }

    offboardingWizardStore.deleteRun(slug, req.params.id);

    const record = personnelStore.get(slug, req.params.id);
    if (record) {
      record.screeningState = 'cleared';
      record.lifecycleEvents.push({
        timestamp: new Date().toISOString(),
        event: 'offboarding-cancelled',
        actor: 'user',
        details: `Offboarding cancelled at step ${run.currentStepIndex + 1} of ${run.steps.length}`,
      });
      personnelStore.save(slug, record);
    }

    res.status(204).send();
  });

  // ── Training Routes ──

  // GET /api/personnel/:id/training — load training state
  router.get('/api/personnel/:id/training', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const catalog = trainingStore.loadCatalog(slug);
      const state = trainingStore.loadTrainingState(slug, req.params.id);
      const requiredCourses = trainingStore.computeRequiredCourses(record.role, record.screeningState, catalog);
      const pConfig = personnelStore.loadConfig(slug);
      const status = trainingStore.getTrainingStatus(slug, req.params.id, record.role, record.screeningState, pConfig.trainingGracePeriodDays);

      res.json({
        state: state || { personnelId: req.params.id, requiredCourses, completions: [] },
        requiredCourses,
        status,
      });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/personnel/:id/training/assign — assign courses
  router.post('/api/personnel/:id/training/assign', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    const validation = validateRequest(TrainingAssignRequestSchema, req.body);
    if (!validation.success) { sendError(res, 400, validation.error.issues[0]?.message ?? 'Invalid request'); return; }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const catalog = trainingStore.loadCatalog(slug);
      const requiredCourses = trainingStore.computeRequiredCourses(record.role, record.screeningState, catalog);

      let state = trainingStore.loadTrainingState(slug, req.params.id);
      if (!state) {
        state = { personnelId: req.params.id, requiredCourses, completions: [] };
      }
      state.requiredCourses = requiredCourses;
      trainingStore.saveTrainingState(slug, state);

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateTrainingState(slug, state).catch(err => console.warn('[blob-replicate] training assign:', err));

      personnelStore.addEvent(slug, req.params.id, {
        event: 'training-assigned',
        actor: 'user',
        details: `Training courses assigned: ${validation.data.courseIds.join(', ')}`,
      });

      res.json(state);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/personnel/:id/training/complete — record completion
  router.post('/api/personnel/:id/training/complete', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    const validation = validateRequest(TrainingCompleteRequestSchema, req.body);
    if (!validation.success) { sendError(res, 400, validation.error.issues[0]?.message ?? 'Invalid request'); return; }

    // Validate completion date is not in the future
    const completedDate = new Date(validation.data.completedDate);
    if (isNaN(completedDate.getTime())) { sendError(res, 400, 'Invalid completedDate format'); return; }
    if (completedDate > new Date()) { sendError(res, 400, 'completedDate cannot be in the future'); return; }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const catalog = trainingStore.loadCatalog(slug);
      const course = catalog.courses.find(c => c.id === validation.data.courseId);
      const courseTitle = course ? course.title : validation.data.courseId;

      const state = trainingStore.addCompletion(slug, req.params.id, {
        courseId: validation.data.courseId,
        completedDate: validation.data.completedDate,
        expiryDate: validation.data.expiryDate,
      });

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateTrainingState(slug, state).catch(err => console.warn('[blob-replicate] training complete:', err));

      personnelStore.addEvent(slug, req.params.id, {
        event: `training-completed: ${courseTitle}`,
        actor: 'user',
        details: `Course ${courseTitle} completed on ${validation.data.completedDate}`,
      });

      res.json(state);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // DELETE /api/personnel/:id/training/complete/:courseId — remove completion
  router.delete('/api/personnel/:id/training/complete/:courseId', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const state = trainingStore.removeCompletion(slug, req.params.id, req.params.courseId);
      if (!state) { sendError(res, 404, 'No training state found'); return; }

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateTrainingState(slug, state).catch(err => console.warn('[blob-replicate] training remove:', err));

      personnelStore.addEvent(slug, req.params.id, {
        event: 'training-completion-removed',
        actor: 'user',
        details: `Completion record removed for course ${req.params.courseId}`,
      });

      res.json(state);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/personnel/:id/training/certificate — upload certificate
  router.post('/api/personnel/:id/training/certificate', upload.single('file') as unknown as express.RequestHandler, (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }
    if (!req.file) { sendError(res, 400, 'No file uploaded'); return; }
    const courseId = req.body?.courseId;
    if (!courseId) { sendError(res, 400, 'courseId is required'); return; }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const artifact = attachmentHandler.saveAttachment(slug, req.params.id, req.file, {
        type: 'training-certificate',
        uploadedBy: 'user',
      });
      personnelStore.addArtifact(slug, req.params.id, artifact);

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateAttachment(slug, req.params.id, artifact).catch(err => console.warn('[blob-replicate] training certificate:', err));

      // Link certificateArtifactId in completion record
      const state = trainingStore.loadTrainingState(slug, req.params.id);
      if (state) {
        const completion = state.completions.find(c => c.courseId === courseId);
        if (completion) {
          completion.certificateArtifactId = artifact.id;
          trainingStore.saveTrainingState(slug, state);
        }
      }

      personnelStore.addEvent(slug, req.params.id, {
        event: 'certificate-uploaded',
        actor: 'user',
        details: `Training certificate uploaded for course ${courseId}: ${artifact.filename}`,
      });

      res.json(artifact);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/personnel/:id/training/email — generate assignment email
  router.post('/api/personnel/:id/training/email', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid ID format'); return; }

    const validation = validateRequest(TrainingEmailRequestSchema, req.body);
    if (!validation.success) { sendError(res, 400, validation.error.issues[0]?.message ?? 'Invalid request'); return; }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const catalog = trainingStore.loadCatalog(slug);
      const courses = catalog.courses.filter(c => validation.data.courseIds.includes(c.id));

      const pConfig = personnelStore.loadConfig(slug);

      // Resolve tenant name from config or slug
      const tenantName = slug; // FX-EO7: the requested tenant, not the server default

      const emailText = TrainingEmailHelper.generateAssignmentEmail({
        displayName: record.displayName,
        courses,
        tenantName,
        config: pConfig,
      });

      // Update lastAssignmentEmailDate
      let state = trainingStore.loadTrainingState(slug, req.params.id);
      if (!state) {
        state = { personnelId: req.params.id, requiredCourses: [], completions: [] };
      }
      state.lastAssignmentEmailDate = new Date().toISOString();
      trainingStore.saveTrainingState(slug, state);

      personnelStore.addEvent(slug, req.params.id, {
        event: 'training-email-generated',
        actor: 'user',
        details: `Assignment email generated for courses: ${validation.data.courseIds.join(', ')}`,
      });

      res.json({ emailText });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/training/catalog — load catalog
  router.get('/api/training/catalog', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;

    try {
      const catalog = trainingStore.loadCatalog(slug);
      res.json(catalog);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // PUT /api/training/catalog — save catalog
  router.put('/api/training/catalog', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;

    const validation = validateRequest(TrainingCatalogSchema, req.body);
    if (!validation.success) { sendError(res, 400, validation.error.issues[0]?.message ?? 'Invalid request'); return; }

    try {
      trainingStore.saveCatalog(slug, validation.data);

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateCatalog(slug, validation.data).catch(err => console.warn('[blob-replicate] training catalog:', err));

      res.json(validation.data);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // ── Screening Element Routes ──

  // GET /api/screening/definitions — return element metadata for UI
  router.get('/api/screening/definitions', (_req: Request, res: Response) => {
    try {
      // Path depth: routers/ is one level deeper than server/, so use ../../../shared/data/
      const defsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/data/screening-element-definitions.json');
      const defs = JSON.parse(fs.readFileSync(defsPath, 'utf-8'));
      res.json(defs);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/screening/element6-form — generate fillable CUI Acknowledgment PDF
  router.get('/api/screening/element6-form', async (req: Request, res: Response) => {
    try {
      const personName = (req.query.name as string) || '';
      const orgName = (req.query.org as string) || '';
      const pdfBytes = await generateCuiAcknowledgmentPdf({ personName, organizationName: orgName });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="CUI-Acknowledgment-${personName || 'Form'}.pdf"`);
      res.send(Buffer.from(pdfBytes));
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/personnel/:id/screening — load all 7 element states
  router.get('/api/personnel/:id/screening', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid personnel ID format'); return; }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const elements = screeningElementStore.loadAll(slug, req.params.id);
      res.json({ personnelId: req.params.id, elements });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/personnel/:id/screening/readiness — return screening readiness summary
  router.get('/api/personnel/:id/screening/readiness', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid personnel ID format'); return; }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const readiness = screeningElementStore.getReadiness(slug, req.params.id);
      res.json(readiness);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/personnel/:id/screening/template/:elementNum — return template text with variable substitution
  router.get('/api/personnel/:id/screening/template/:elementNum', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid personnel ID format'); return; }

    const elementNum = parseInt(req.params.elementNum, 10);
    if (isNaN(elementNum) || elementNum < 1 || elementNum > 7) {
      sendError(res, 400, 'elementNum must be between 1 and 7');
      return;
    }

    const template = SCREENING_TEMPLATE_TEXT[elementNum];
    if (!template) {
      res.json({ elementNumber: elementNum, templateText: null, message: 'No template text for this element' });
      return;
    }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const pConfig = personnelStore.loadConfig(slug);
      const tenantName = slug; // FX-EO7: the requested tenant, not the server default

      // Substitute variables
      let text = template
        .replace(/\{person_name\}/g, record.displayName)
        .replace(/\{tenant_name\}/g, tenantName)
        .replace(/\{cui_source\}/g, pConfig.cuiAcknowledgmentSource || 'https://www.archives.gov/cui');

      res.json({ elementNumber: elementNum, templateText: text });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/personnel/:id/screening/:elementNum — load single element state
  router.get('/api/personnel/:id/screening/:elementNum', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid personnel ID format'); return; }

    const elementNum = parseInt(req.params.elementNum, 10);
    if (isNaN(elementNum) || elementNum < 1 || elementNum > 7) {
      sendError(res, 400, 'elementNum must be between 1 and 7');
      return;
    }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      const state = screeningElementStore.load(slug, req.params.id, elementNum);
      res.json(state || { elementNumber: elementNum, status: 'not_started', data: null });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // PUT /api/personnel/:id/screening/:elementNum — save element data
  router.put('/api/personnel/:id/screening/:elementNum', (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid personnel ID format'); return; }

    const elementNum = parseInt(req.params.elementNum, 10);
    if (isNaN(elementNum) || elementNum < 1 || elementNum > 7) {
      sendError(res, 400, 'elementNum must be between 1 and 7');
      return;
    }

    const validation = validateRequest(ScreeningElementUpdateRequestSchema, req.body);
    if (!validation.success) { sendError(res, 400, validation.error.issues[0]?.message ?? 'Invalid request'); return; }

    try {
      const record = personnelStore.get(slug, req.params.id);
      if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

      // Sequence enforcement: element 7 requires 1-6 to be completed
      if (elementNum === 7) {
        if (!screeningElementStore.areElementsOneToSixComplete(slug, req.params.id)) {
          sendError(res, 400, 'Elements 1-6 must be completed before element 7 (AO Sign-Off)');
          return;
        }

        // Segregation enforcement: AO cannot be the person being screened
        if (validation.data.data && typeof validation.data.data === 'object' && 'ao_email' in validation.data.data) {
          const aoEmail = (validation.data.data as { ao_email: string }).ao_email;
          if (aoEmail && aoEmail.toLowerCase() === record.email.toLowerCase()) {
            sendError(res, 400, 'Authorizing Official cannot be the person being screened');
            return;
          }
        }
      }

      // Build the element state
      const elementTypeDiscriminant = ELEMENT_TYPE_DISCRIMINANT[elementNum];
      let elementData = validation.data.data;
      if (elementData && typeof elementData === 'object') {
        if ('_elementType' in elementData && elementData._elementType !== elementTypeDiscriminant) {
          sendError(res, 400, `Element type mismatch: expected ${elementTypeDiscriminant} for element ${elementNum}`);
          return;
        }
        if (!('_elementType' in elementData)) {
          elementData = { ...elementData, _elementType: elementTypeDiscriminant };
        }
      }

      const state: ScreeningElementState = {
        elementNumber: elementNum,
        status: validation.data.status,
        data: elementData as ScreeningElementState['data'],
        updatedDate: new Date().toISOString(),
        ...(validation.data.status === 'completed' ? { completedDate: new Date().toISOString() } : {}),
      };

      screeningElementStore.save(slug, req.params.id, elementNum, state);

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateScreeningElement(slug, req.params.id, elementNum, state).catch(err => console.warn('[blob-replicate] screening element:', err));

      // Log lifecycle event
      const title = SCREENING_ELEMENT_TITLES[elementNum] || `Element ${elementNum}`;
      personnelStore.addEvent(slug, req.params.id, {
        event: `screening-element-${validation.data.status}`,
        actor: 'user',
        details: `Screening element ${elementNum} (${title}) set to ${validation.data.status}`,
      });

      res.json(state);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/personnel/:id/screening/:elementNum/artifact — upload artifact for element
  router.post('/api/personnel/:id/screening/:elementNum/artifact', upload.single('file') as unknown as express.RequestHandler, (req: Request, res: Response) => {
    // FX-EO7: the requested tenant only — missing -> 400, unknown -> 404, no server default.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) { sendError(res, 400, 'Invalid personnel ID format'); return; }

    const elementNum = parseInt(req.params.elementNum, 10);
    if (isNaN(elementNum) || elementNum < 1 || elementNum > 7) {
      sendError(res, 400, 'elementNum must be between 1 and 7');
      return;
    }

    const record = personnelStore.get(slug, req.params.id);
    if (!record) { sendError(res, 404, 'Personnel record not found'); return; }

    if (!req.file) {
      sendError(res, 400, 'No file uploaded');
      return;
    }

    const artifactType = ELEMENT_ARTIFACT_TYPE_MAP[elementNum] || 'other';
    const uploadedBy = req.body.uploadedBy || 'user';

    try {
      const artifact = attachmentHandler.saveAttachment(slug, req.params.id, req.file, {
        type: artifactType as any,
        uploadedBy,
      });
      // Tag artifact with screening element metadata
      artifact.metadata = { ...artifact.metadata, screeningElement: elementNum };
      personnelStore.addArtifact(slug, req.params.id, artifact);

      personnelBlobReplicatorFor(scope.tenantJsonPath).replicateAttachment(slug, req.params.id, artifact).catch(err => console.warn('[blob-replicate] screening artifact:', err));

      const title = SCREENING_ELEMENT_TITLES[elementNum] || `Element ${elementNum}`;
      personnelStore.addEvent(slug, req.params.id, {
        event: 'screening-artifact-added',
        actor: uploadedBy,
        details: `Uploaded ${artifact.filename} for screening element ${elementNum} (${title})`,
      });

      res.status(201).json(artifact);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  return router;
}
