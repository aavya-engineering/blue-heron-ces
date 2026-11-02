// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import express, { type Request, type Response } from 'express';
import type { EoConfig } from '../../config/EoConfig.js';
import { RiskAssessmentStore } from '../../risk-assessment/RiskAssessmentStore.js';
import { RiskAssessmentBlobReplicator } from '../../risk-assessment/RiskAssessmentBlobReplicator.js';
import { VulnerabilityIngestionService } from '../../risk-assessment/VulnerabilityIngestionService.js';
import type { FindingStoreAdapter } from '../../risk-assessment/VulnerabilityIngestionService.js';
import { autoScoreRegister } from '../../risk-assessment/SecureScoreAutoScorer.js';
import { AssessmentStore } from '../../assessment/AssessmentStore.js';
import { SessionManager } from '../../core/SessionManager.js';
import { isSessionBoundTo } from '../signalCapture.js';
import {
  validateRequest,
  RiskAssessmentConfigUpdateSchema,
  RiskEntryCreateSchema,
  RiskEntryUpdateSchema,
} from '../validation-schemas.js';
import {
  sendError,
  validateUuid,
  requireTenantScope,
  getEvidenceStorageConfig,
  loadTimeline,
  saveTimeline,
} from '../eo-router-utils.js';
import type { ResolverResponse, RenderContext, RenderDirective } from '../../../shared/types/render.types.js';

export interface RiskAssessmentRouterDeps {
  config: EoConfig;
  riskAssessmentStore: RiskAssessmentStore;
  /** FX-EO8: replicator bound to the REQUESTED tenant's blob storage (default: built from that
   *  tenant's config). A single server-wide replicator wrote tenant B's risk register into the
   *  default tenant's blob account. */
  riskBlobReplicatorFor?: (tenantJsonPath: string) => RiskAssessmentBlobReplicator;
  assessmentStore: AssessmentStore;
  /** FX-EO8: slug -> tenant resolution; every route requires ?tenant= (no config.tenantSlug fallback). */
  stamperRoot: string;
  /** FX2-EO1: the session opened for THIS tenant slug, or null — never another tenant's. */
  getSessionManager: (tenantSlug: string) => SessionManager | null;
}

export function createRiskAssessmentRouter(deps: RiskAssessmentRouterDeps): express.Router {
  const { config, riskAssessmentStore, assessmentStore, getSessionManager, stamperRoot } = deps;
  const riskBlobReplicatorFor = deps.riskBlobReplicatorFor
    ?? ((tenantJsonPath: string) => new RiskAssessmentBlobReplicator(getEvidenceStorageConfig(config, tenantJsonPath)));
  const router = express.Router();

  // FX2-EO1: Defender/Secure Score/Sentinel ingestion uses the requested tenant's own session;
  // with none, VulnerabilityIngestionService skips live sources (null session) — never borrows.
  const boundSession = (slug: string, tenantId: string): SessionManager | null => {
    const sm = getSessionManager(slug);
    return isSessionBoundTo(sm, slug, tenantId) ? sm : null;
  };

  // ── Risk Assessment Endpoints ──

  // GET /api/risk-assessment/config — load risk assessment config
  router.get('/api/risk-assessment/config', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const cfg = riskAssessmentStore.loadConfig(slug, config.missionPlanPath, config.infraManifestPath);
      res.json(cfg);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // PUT /api/risk-assessment/config — update risk assessment config
  router.put('/api/risk-assessment/config', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    const validation = validateRequest(RiskAssessmentConfigUpdateSchema, req.body);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.message);
      return;
    }
    try {
      const existing = riskAssessmentStore.loadConfig(slug);
      const updates = validation.data;
      if (updates.scopeStatement !== undefined) existing.scopeStatement = updates.scopeStatement;
      if (updates.frequencyMonths !== undefined) existing.frequencyMonths = updates.frequencyMonths;
      if (updates.methodology !== undefined) existing.methodology = updates.methodology;
      if (updates.authorizingOfficial !== undefined) existing.authorizingOfficial = updates.authorizingOfficial;
      if (updates.threatCatalog) {
        if (updates.threatCatalog.adversarial) existing.threatCatalog.adversarial = updates.threatCatalog.adversarial;
        if (updates.threatCatalog.non_adversarial) existing.threatCatalog.non_adversarial = updates.threatCatalog.non_adversarial;
      }
      if (updates.vulnerabilitySources) {
        if (updates.vulnerabilitySources.defender_for_cloud) {
          existing.vulnerabilitySources.defender_for_cloud = { ...existing.vulnerabilitySources.defender_for_cloud, ...updates.vulnerabilitySources.defender_for_cloud };
        }
        if (updates.vulnerabilitySources.microsoft_secure_score) {
          existing.vulnerabilitySources.microsoft_secure_score = { ...existing.vulnerabilitySources.microsoft_secure_score, ...updates.vulnerabilitySources.microsoft_secure_score };
        }
        if (updates.vulnerabilitySources.plan_output_not_met) {
          existing.vulnerabilitySources.plan_output_not_met = { ...existing.vulnerabilitySources.plan_output_not_met, ...updates.vulnerabilitySources.plan_output_not_met };
        }
        if (updates.vulnerabilitySources.sentinel_incidents) {
          existing.vulnerabilitySources.sentinel_incidents = { ...existing.vulnerabilitySources.sentinel_incidents, ...updates.vulnerabilitySources.sentinel_incidents };
        }
      }
      riskAssessmentStore.saveConfig(slug, existing);
      riskBlobReplicatorFor(scope.tenantJsonPath).replicateConfig(slug, existing).catch(err => console.warn('[risk-blob-replicate]', err instanceof Error ? err.message : String(err)));
      res.json(existing);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/risk-assessment/register — load full risk register
  router.get('/api/risk-assessment/register', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const register = riskAssessmentStore.loadRegister(slug);
      res.json(register);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/risk-assessment/register/entries — create a new risk entry
  router.post('/api/risk-assessment/register/entries', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    const validation = validateRequest(RiskEntryCreateSchema, req.body);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.message);
      return;
    }
    try {
      const entryData = {
        ...validation.data,
        affectedAssets: validation.data.affectedAssets ?? [],
        affectedOperations: validation.data.affectedOperations ?? [],
      };
      const entry = riskAssessmentStore.addEntry(slug, entryData);
      riskBlobReplicatorFor(scope.tenantJsonPath).replicateRegister(slug, riskAssessmentStore.loadRegister(slug)).catch(err => console.warn('[risk-blob-replicate]', err instanceof Error ? err.message : String(err)));
      res.status(201).json(entry);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/risk-assessment/register/entries/:id — get single risk entry
  router.get('/api/risk-assessment/register/entries/:id', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) {
      sendError(res, 400, 'Invalid entry ID format');
      return;
    }
    try {
      const entry = riskAssessmentStore.getEntry(slug, req.params.id);
      if (!entry) {
        sendError(res, 404, `Risk entry not found: ${req.params.id}`);
        return;
      }
      res.json(entry);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // PUT /api/risk-assessment/register/entries/:id — update a risk entry
  router.put('/api/risk-assessment/register/entries/:id', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) {
      sendError(res, 400, 'Invalid entry ID format');
      return;
    }
    const validation = validateRequest(RiskEntryUpdateSchema, req.body);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.message);
      return;
    }
    try {
      const updated = riskAssessmentStore.updateEntry(slug, req.params.id, validation.data);
      if (!updated) {
        sendError(res, 404, `Risk entry not found: ${req.params.id}`);
        return;
      }
      riskBlobReplicatorFor(scope.tenantJsonPath).replicateRegister(slug, riskAssessmentStore.loadRegister(slug)).catch(err => console.warn('[risk-blob-replicate]', err instanceof Error ? err.message : String(err)));
      res.json(updated);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // DELETE /api/risk-assessment/register/entries/:id — delete a risk entry
  router.delete('/api/risk-assessment/register/entries/:id', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    if (!validateUuid(req.params.id)) {
      sendError(res, 400, 'Invalid entry ID format');
      return;
    }
    try {
      const deleted = riskAssessmentStore.deleteEntry(slug, req.params.id);
      if (!deleted) {
        sendError(res, 404, `Risk entry not found: ${req.params.id}`);
        return;
      }
      riskBlobReplicatorFor(scope.tenantJsonPath).replicateRegister(slug, riskAssessmentStore.loadRegister(slug)).catch(err => console.warn('[risk-blob-replicate]', err instanceof Error ? err.message : String(err)));
      res.status(204).send();
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/risk-assessment/ingest — run vulnerability ingestion
  router.post('/api/risk-assessment/ingest', async (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const riskConfig = riskAssessmentStore.loadConfig(slug, config.missionPlanPath, config.infraManifestPath);
      const findingStoreAdapter: FindingStoreAdapter = {
        loadLatest(tenantSlug: string) {
          const snapshot = assessmentStore.loadLatestForTenant(scope.tenantId); // FX-EO8
          if (!snapshot) return null;
          return snapshot.controls.map(c => ({
            controlId: c.control_id,
            status: c.status,
            narrative: c.implementation_narrative || '',
          }));
        }
      };
      const ingestionService = new VulnerabilityIngestionService(riskAssessmentStore, riskConfig, boundSession(scope.slug, scope.tenantId), findingStoreAdapter);
      const startTime = Date.now();
      const report = await ingestionService.ingestAll(slug);
      const durationMs = Date.now() - startTime;

      // Persist run log for audit evidence
      riskAssessmentStore.saveIngestionRun(slug, { ...report, trigger: 'manual', durationMs });

      // Auto-score newly ingested entries
      const scoreResult = autoScoreRegister(riskAssessmentStore, slug);
      console.log(`[EoServer] Auto-scored ${scoreResult.scored} entries (${scoreResult.skipped} skipped, ${scoreResult.errors.length} errors)`);

      // Emit timeline event
      const timeline = loadTimeline(config.storageRoot, slug);
      timeline.events.push({
        eventId: `ra-ingestion-${Date.now()}`,
        type: 'assessment',
        title: 'Vulnerability ingestion completed',
        date: report.timestamp,
        detail: `New: ${report.totalNew}, Updated: ${report.totalUpdated}, Errors: ${report.totalErrors}`,
      });
      saveTimeline(config.storageRoot, timeline);

      res.json(report);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/risk-assessment/ingestion-runs — list past ingestion runs
  router.get('/api/risk-assessment/ingestion-runs', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(riskAssessmentStore.listIngestionRuns(slug, limit));
  });

  // GET /api/risk-assessment/ingestion-runs/:timestamp — load single run detail
  router.get('/api/risk-assessment/ingestion-runs/:timestamp', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    const run = riskAssessmentStore.loadIngestionRun(slug, req.params.timestamp);
    if (!run) { sendError(res, 404, 'Run not found'); return; }
    res.json(run);
  });

  // POST /api/risk-assessment/auto-score — apply recommended scoring to unscored entries
  router.post('/api/risk-assessment/auto-score', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const result = autoScoreRegister(riskAssessmentStore, slug);
      res.json(result);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/risk-assessment/snapshots — list snapshots
  router.get('/api/risk-assessment/snapshots', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const snapshots = riskAssessmentStore.listSnapshots(slug);
      res.json(snapshots);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/risk-assessment/snapshots/:year — get snapshot detail
  router.get('/api/risk-assessment/snapshots/:year', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    const year = parseInt(req.params.year, 10);
    if (isNaN(year)) {
      sendError(res, 400, 'year must be a number');
      return;
    }
    try {
      const snapshot = riskAssessmentStore.loadSnapshot(slug, year);
      if (!snapshot) {
        sendError(res, 404, 'Snapshot not found');
        return;
      }
      res.json(snapshot);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // ── Annual Review Wizard Endpoints ──

  // POST /api/risk-assessment/annual-review/start — start new annual review
  router.post('/api/risk-assessment/annual-review/start', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const existing = riskAssessmentStore.loadAnnualReviewState(slug);
      if (existing) {
        res.json(existing);
        return;
      }
      const state = {
        currentStep: 1,
        startedAt: new Date().toISOString(),
        startedBy: req.body?.startedBy || 'unknown',
        stepData: {},
      };
      riskAssessmentStore.saveAnnualReviewState(slug, state);
      res.status(201).json(state);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/risk-assessment/annual-review/state — get current review state
  router.get('/api/risk-assessment/annual-review/state', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const state = riskAssessmentStore.loadAnnualReviewState(slug);
      if (!state) {
        sendError(res, 404, 'No annual review in progress');
        return;
      }
      res.json(state);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // PUT /api/risk-assessment/annual-review/step/:stepNum — save step data
  router.put('/api/risk-assessment/annual-review/step/:stepNum', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    const stepNum = parseInt(req.params.stepNum, 10);
    if (isNaN(stepNum) || stepNum < 1 || stepNum > 6) {
      sendError(res, 400, 'stepNum must be between 1 and 6');
      return;
    }
    try {
      const state = riskAssessmentStore.loadAnnualReviewState(slug);
      if (!state) {
        sendError(res, 404, 'No annual review in progress');
        return;
      }
      state.stepData[String(stepNum)] = req.body;
      if (stepNum >= state.currentStep && stepNum < 6) {
        state.currentStep = stepNum + 1;
      }
      riskAssessmentStore.saveAnnualReviewState(slug, state);
      res.json(state);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/risk-assessment/annual-review/complete — finalize annual review
  router.post('/api/risk-assessment/annual-review/complete', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const state = riskAssessmentStore.loadAnnualReviewState(slug);
      if (!state) {
        sendError(res, 404, 'No annual review in progress');
        return;
      }
      const register = riskAssessmentStore.loadRegister(slug);
      const riskConfig = riskAssessmentStore.loadConfig(slug, config.missionPlanPath, config.infraManifestPath);
      const now = new Date();
      const year = now.getFullYear();

      const snapshot = riskAssessmentStore.createSnapshot(slug, {
        assessmentYear: year,
        reviewedDate: now.toISOString(),
        reviewedBy: state.startedBy,
        signedOffBy: req.body?.signedOffBy || state.startedBy,
        signedOffDate: now.toISOString(),
        registerSnapshot: register,
        reportArtifactPath: `snapshots/${year}.json`,
        reviewNotes: req.body?.reviewNotes || undefined,
      });

      // Update register review dates
      register.lastFullReviewDate = now.toISOString();
      const nextReview = new Date(now);
      nextReview.setUTCMonth(nextReview.getUTCMonth() + (riskConfig.frequencyMonths || 12));
      register.nextReviewDue = nextReview.toISOString();
      register.lastUpdated = now.toISOString();
      riskAssessmentStore.saveRegister(slug, register);
      riskBlobReplicatorFor(scope.tenantJsonPath).replicateRegister(slug, register).catch(err => console.warn('[risk-blob-replicate]', err instanceof Error ? err.message : String(err)));
      riskBlobReplicatorFor(scope.tenantJsonPath).replicateSnapshot(slug, snapshot.assessmentYear, snapshot).catch(err => console.warn('[risk-blob-replicate]', err instanceof Error ? err.message : String(err)));

      // Delete in-progress state
      riskAssessmentStore.deleteAnnualReviewState(slug);

      res.json(snapshot);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // DELETE /api/risk-assessment/annual-review/state — cancel/delete review state
  router.delete('/api/risk-assessment/annual-review/state', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      riskAssessmentStore.deleteAnnualReviewState(slug);
      res.status(204).send();
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/risk-assessment/annual-review/one-click — complete annual review in one step
  router.post('/api/risk-assessment/annual-review/one-click', async (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const now = new Date();
      const year = now.getFullYear();
      const riskConfig = riskAssessmentStore.loadConfig(slug, config.missionPlanPath, config.infraManifestPath);

      // Step 1: Run vulnerability ingestion
      const findingStoreAdapter: FindingStoreAdapter = {
        loadLatest(tenantSlug: string) {
          const snapshot = assessmentStore.loadLatestForTenant(scope.tenantId); // FX-EO8
          if (!snapshot) return null;
          return snapshot.controls.map(c => ({
            controlId: c.control_id,
            status: c.status,
            narrative: c.implementation_narrative || '',
          }));
        }
      };
      const ingestionService = new VulnerabilityIngestionService(riskAssessmentStore, riskConfig, boundSession(scope.slug, scope.tenantId), findingStoreAdapter);
      const ingestionStartTime = Date.now();
      const ingestionReport = await ingestionService.ingestAll(slug);
      const ingestionDurationMs = Date.now() - ingestionStartTime;
      riskAssessmentStore.saveIngestionRun(slug, { ...ingestionReport, trigger: 'annual-review', durationMs: ingestionDurationMs });

      // Step 2: Auto-score all unscored entries
      const scoreResult = autoScoreRegister(riskAssessmentStore, slug);

      // Step 3: Bulk mark all entries as reviewed
      const register = riskAssessmentStore.loadRegister(slug);
      for (const entry of register.entries) {
        entry.lastReviewed = now.toISOString();
      }
      register.lastUpdated = now.toISOString();
      riskAssessmentStore.saveRegister(slug, register);

      // Step 4: Create immutable annual snapshot
      const reviewedBy = req.body?.reviewedBy || 'system';
      const signedOffBy = req.body?.signedOffBy || reviewedBy;
      const snapshot = riskAssessmentStore.createSnapshot(slug, {
        assessmentYear: year,
        reviewedDate: now.toISOString(),
        reviewedBy,
        signedOffBy,
        signedOffDate: now.toISOString(),
        registerSnapshot: register,
        reportArtifactPath: `snapshots/${year}.json`,
        reviewNotes: req.body?.reviewNotes || `One-click annual review completed. Ingested ${ingestionReport.totalNew} new, ${ingestionReport.totalUpdated} updated. Auto-scored ${scoreResult.scored} entries.`,
      });

      // Step 5: Update register review dates
      register.lastFullReviewDate = now.toISOString();
      const nextReview = new Date(now);
      nextReview.setUTCMonth(nextReview.getUTCMonth() + (riskConfig.frequencyMonths || 12));
      register.nextReviewDue = nextReview.toISOString();
      riskAssessmentStore.saveRegister(slug, register);

      // Step 6: Replicate to Azure Blob
      riskBlobReplicatorFor(scope.tenantJsonPath).replicateRegister(slug, register).catch(err => console.warn('[risk-blob-replicate]', err instanceof Error ? err.message : String(err)));
      riskBlobReplicatorFor(scope.tenantJsonPath).replicateSnapshot(slug, snapshot.assessmentYear, snapshot).catch(err => console.warn('[risk-blob-replicate]', err instanceof Error ? err.message : String(err)));

      // Step 7: Emit timeline event
      const timeline = loadTimeline(config.storageRoot, slug);
      timeline.events.push({
        eventId: `ra-annual-review-${Date.now()}`,
        type: 'assessment',
        title: `Annual Risk Assessment Review (FY${year})`,
        date: now.toISOString(),
        detail: `One-click review: ${register.entries.length} entries reviewed, ${scoreResult.scored} auto-scored, ${ingestionReport.totalNew} new vulnerabilities ingested. Snapshot created.`,
      });
      saveTimeline(config.storageRoot, timeline);

      // Clean up any leftover wizard state
      riskAssessmentStore.deleteAnnualReviewState(slug);

      console.log(`[EoServer] Annual review one-click complete for ${slug}: ${register.entries.length} entries, snapshot ${snapshot.snapshotId}`);

      res.json({
        success: true,
        snapshot,
        summary: {
          totalEntries: register.entries.length,
          ingested: { new: ingestionReport.totalNew, updated: ingestionReport.totalUpdated, errors: ingestionReport.totalErrors },
          scored: scoreResult.scored,
          nextReviewDue: register.nextReviewDue,
        },
      });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/risk-assessment/render/:type — render risk assessment documents
  router.post('/api/risk-assessment/render/:type', async (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    const docType = req.params.type;
    if (docType !== 'procedure' && docType !== 'report') {
      sendError(res, 400, 'type must be "procedure" or "report"');
      return;
    }
    try {
      const { RiskAssessmentRenderer } = await import('../../rendering/templates/RiskAssessmentRenderer.js');
      const { DIRECTIVE_CODES } = await import('../../../shared/types/render.types.js');
      const renderer = new RiskAssessmentRenderer();
      const directiveCode = docType === 'procedure'
        ? DIRECTIVE_CODES.RISK_ASSESSMENT_POLICY
        : DIRECTIVE_CODES.RISK_ASSESSMENT_REPORT;

      const resolvedInputs = new Map<string, ResolverResponse>();
      const yearParam = req.query.year as string | undefined;
      if (yearParam) {
        resolvedInputs.set('year', { resolved: true, data: yearParam });
      }

      const tenantName = slug;
      const renderContext: RenderContext = {
        tenantSlug: slug,
        tenantName,
        complianceRepoPath: config.storageRoot,
        assessmentSnapshot: null,
        renderedArtifacts: new Map(),
        date: new Date().toISOString().split('T')[0],
      };

      const directive: RenderDirective = {
        directive_code: directiveCode,
        artifact_version: '1.0',
        input_sources: [],
        output_target: '',
        depends_on: [],
      };

      const result = await renderer.render(directive, resolvedInputs, renderContext);
      if (result.state === 'rendered') {
        res.json({ state: result.state, artifact_path: result.artifact_path });
      } else {
        sendError(res, 500, result.failure_reason || 'Render failed');
      }
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  return router;
}
