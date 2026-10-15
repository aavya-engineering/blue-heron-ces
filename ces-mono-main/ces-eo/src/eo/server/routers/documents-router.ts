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
import * as os from 'node:os';
import type { EoConfig } from '../../config/EoConfig.js';
import { writeTextArtifact } from 'ces-shared/persistence/files';
import { AssessmentStore } from '../../assessment/AssessmentStore.js';
import { PoamStore } from '../../poam/PoamStore.js';
import { PoamGenerator } from '../../poam/PoamGenerator.js';
import { PoamDocxExporter } from '../../poam/PoamDocxExporter.js';
import { SspGenerator } from '../../ssp/SspGenerator.js';
import { SspDocxExporter } from '../../ssp/SspDocxExporter.js';
import { AdminOpsDataProvider } from '../../ssp/AdminOpsDataProvider.js';
import { AdminOpsEvidenceReader } from '../../adminops/AdminOpsEvidenceReader.js';
import { liveSatAdminOpsControls } from '../../adminops/adminopsViews.js';
import { OdpValueProvider } from '../../ssp/OdpValueProvider.js';
import { SnippetDataResolver } from '../../ssp/SnippetDataResolver.js';
import { SharedResponsibilityMatrixGenerator } from '../../ssp/SharedResponsibilityMatrixGenerator.js';
import { DiagramRenderer } from '../../ssp/DiagramRenderer.js';
import { SspQualityScorecard } from '../../ssp/SspQualityScorecard.js';
import { loadTenantConfig } from 'ces-shared/config';
import type { SystemSecurityPlan } from 'ces-shared/types/ssp';
import { getActiveStackProvider } from 'ces-shared/stack';
import { PolicyStore } from '../../policies/PolicyStore.js';
import { PersonnelStore } from '../../personnel/PersonnelStore.js';
import { TrainingStore } from '../../personnel/TrainingStore.js';
import { ScreeningElementStore } from '../../personnel/ScreeningElementStore.js';
import { RiskAssessmentStore } from '../../risk-assessment/RiskAssessmentStore.js';
import { VariableStore } from '../../evidence/VariableStore.js';
import { StorageCleanupService } from '../StorageCleanupService.js';
import {
  validateRequest,
  SspGenerateRequestSchema,
  PoamGenerateRequestSchema,
} from '../validation-schemas.js';
import {
  sendError,
  validateUuid,
  resolveTenantJsonPath,
  resolveDataPath,
  loadOptionalJson,
  loadObjectiveEvidenceFromSuite,
  loadRegistry,
  getEvidenceStorageConfig,
  resolveTenantScope,
  requireTenantScope,
} from '../eo-router-utils.js';
import { sspLatestPath, loadLatestSsp } from '../../ssp/sspLatest.js';

export interface DocumentsRouterDeps {
  config: EoConfig;
  stamperRoot: string;
  assessmentStore: AssessmentStore;
  poamStore: PoamStore;
  policyStore: PolicyStore;
  personnelStore: PersonnelStore;
  trainingStore: TrainingStore;
  screeningElementStore: ScreeningElementStore;
  riskAssessmentStore: RiskAssessmentStore;
  cleanupService: StorageCleanupService;
}

export function createDocumentsRouter(deps: DocumentsRouterDeps): express.Router {
  const {
    config, stamperRoot, assessmentStore, poamStore, policyStore,
    personnelStore, trainingStore, screeningElementStore, riskAssessmentStore,
    cleanupService,
  } = deps;

  const router = express.Router();

  // ── SSP Endpoints ──

  const sspStore = path.join(config.storageRoot, 'ssp');
  fs.mkdirSync(sspStore, { recursive: true });

  // POST /api/ssp/generate
  router.post('/api/ssp/generate', async (req: Request, res: Response) => {
    const validation = validateRequest(SspGenerateRequestSchema, req.body);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.message);
      return;
    }

    const { tenantSlug: reqTenantSlug, assessmentId } = validation.data;
    // FX-EO6: everything below is read for the REQUESTED tenant, never config.tenantSlug.
    const scope = resolveTenantScope(reqTenantSlug, stamperRoot);
    if (!scope.ok) { sendError(res, scope.status, scope.message); return; }

    const latest = assessmentStore.loadForTenant(scope.tenantId, assessmentId);
    if (!latest) {
      sendError(res, 404, `Assessment snapshot not found for tenant ${scope.slug}: ${assessmentId}`);
      return;
    }

    try {
      const controlsRefPath = resolveDataPath('cmmc-l2-controls.reference.json');
      const weightsPath = resolveDataPath('sprs-weights.json');

      // Initialize AdminOps + ODP providers for SnippetDataResolver
      const adminOpsProvider = new AdminOpsDataProvider();
      try { adminOpsProvider.initialize(); } catch (e) { console.warn('AdminOps loading skipped:', e instanceof Error ? e.message : String(e)); }
      // W4-EO2: only controls with a live SAT AdminOps row for THIS tenant lose the "designed procedure" label.
      try { adminOpsProvider.setLiveControls(liveSatAdminOpsControls(new AdminOpsEvidenceReader(scope.tenantId).read().parsed)); }
      catch (e) { console.warn('AdminOps live rows unavailable; all AdminOps text labelled designed procedure:', e instanceof Error ? e.message : String(e)); }

      const odpValues = loadOptionalJson(config.tenantManifestPath)?.odpValues as Record<string, unknown> | undefined;
      const odpProvider = new OdpValueProvider(odpValues as any);

      const snippetResolver = new SnippetDataResolver({ adminOpsProvider, odpValueProvider: odpProvider });

      // G4: resolve the active stack from the tenant config (absent ⇒ Microsoft default) so the SSP
      // narrative strategy is selected by the provider's sspNarrativeSourceId. Best-effort: on any
      // load failure, fall back to the default (Microsoft) provider.
      // G13: structured warn includes the tenant slug + requested stack id for diagnostics.
      let sspStackCapabilities;
      try {
        const sspTc = loadTenantConfig(scope.tenantJsonPath);
        sspStackCapabilities = getActiveStackProvider(sspTc).capabilities;
      } catch (e) {
        const requestedStackId = (e as any)?.stack ?? 'unknown';
        console.warn(`[EoServer] Stack resolution for SSP failed (tenant=${reqTenantSlug}, requestedStack=${requestedStackId}); using default provider:`, e instanceof Error ? e.message : String(e));
        sspStackCapabilities = getActiveStackProvider(undefined).capabilities;
      }

      let srmGenerator: SharedResponsibilityMatrixGenerator | undefined;
      try { srmGenerator = new SharedResponsibilityMatrixGenerator(); } catch (e) { console.warn('SRM loading skipped:', e instanceof Error ? e.message : String(e)); }

      const diagramRenderer = new DiagramRenderer();

      const generator = new SspGenerator(
        controlsRefPath, weightsPath, snippetResolver, trainingStore, screeningElementStore,
        { srmGenerator, diagramRenderer }
      );

      const registries = [loadRegistry(config.registryPath)];
      if (config.infraRegistryPath) registries.push(loadRegistry(config.infraRegistryPath));

      // Load policies for SSP generation
      const sspTenantSlug = scope.slug;
      const sspPolicies = policyStore.load(sspTenantSlug);

      // Load variables for template rendering
      const variableStore = new VariableStore({ account_name: '', account_key: '', container: '', base_path: '', blob_endpoint: '' });
      const loadedVariables = variableStore.loadFromDisk(scope.slug);

      const sspEvidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);

      // Load personnel records for SSP PS control narratives + Appendix F
      const sspPersonnelSlug = scope.slug;
      const sspPersonnelRecords = personnelStore.load(sspPersonnelSlug);

      // Load training data for SSP AT control narratives + Appendix G
      let trainingData: { catalog: import('../../../shared/types/personnel.types.js').TrainingCatalog; states: Map<string, import('../../../shared/types/personnel.types.js').PersonnelTrainingState> } | undefined;
      if (sspPersonnelSlug && sspPersonnelRecords.length > 0) {
        const sspCatalog = trainingStore.loadCatalog(sspPersonnelSlug);
        const sspTrainingStates = new Map<string, import('../../../shared/types/personnel.types.js').PersonnelTrainingState>();
        for (const pr of sspPersonnelRecords) {
          const ts = trainingStore.loadTrainingState(sspPersonnelSlug, pr.id);
          if (ts) sspTrainingStates.set(pr.id, ts);
        }
        trainingData = { catalog: sspCatalog, states: sspTrainingStates };
      }

      // Load screening data for SSP PS control narratives + Appendix F screening matrix
      let screeningData: { elements: Map<string, import('../../personnel/screening.types.js').ScreeningElementState[]> } | undefined;
      if (sspPersonnelSlug && sspPersonnelRecords.length > 0) {
        const sspScreeningElements = new Map<string, import('../../personnel/screening.types.js').ScreeningElementState[]>();
        for (const pr of sspPersonnelRecords) {
          const elements = screeningElementStore.loadAll(sspPersonnelSlug, pr.id);
          sspScreeningElements.set(pr.id, elements);
        }
        screeningData = { elements: sspScreeningElements };
      }

      // Load risk assessment data for SSP RA control narratives
      const riskConfig = riskAssessmentStore.loadConfig(sspTenantSlug, config.missionPlanPath, config.infraManifestPath);
      const riskRegister = riskAssessmentStore.loadRegister(sspTenantSlug);
      const riskSnapshots = riskAssessmentStore.listSnapshots(sspTenantSlug);
      const latestSnapshot = riskSnapshots.length > 0 ? riskAssessmentStore.loadSnapshot(sspTenantSlug, riskSnapshots[0].year) : null;

      const ssp = generator.generate({
        assessment: latest,
        missionPlan: loadOptionalJson(config.missionPlanPath),
        tenantManifest: loadOptionalJson(config.tenantManifestPath),
        infraManifest: loadOptionalJson(config.infraManifestPath),
        registries,
        policies: sspPolicies,
        variables: loadedVariables ?? undefined,
        blobStorageConnected: !!sspEvidenceStorage,
        personnelRecords: sspPersonnelRecords,
        trainingData,
        screeningData,
        riskAssessmentData: { config: riskConfig, register: riskRegister, latestSnapshot },
        stack: sspStackCapabilities,
        tenantSlug: scope.slug,
        // G-EUT-5 Phase 3: per-objective evidence from the latest tenant test-suite run (if present).
        objectiveEvidence: loadObjectiveEvidenceFromSuite(),
      });

      const filePath = path.join(sspStore, `${ssp.sspId}.json`);
      const latestSspPath = sspLatestPath(config.storageRoot, scope.slug)!;
      const sspContent = JSON.stringify(ssp, null, 2);

      const tmpPath = `${filePath}.tmp`;
      const tmpLatestPath = `${latestSspPath}.tmp`;

      writeTextArtifact(tmpPath, sspContent);
      const tmpStats = await fs.promises.stat(tmpPath);
      if (tmpStats.size === 0) {
        console.warn(`WARN: Zero-byte file written to ${tmpPath}`);
        sendError(res, 500, 'Generated file is empty');
        return;
      }
      await fs.promises.rename(tmpPath, filePath);

      writeTextArtifact(tmpLatestPath, sspContent);
      const tmpLatestStats = await fs.promises.stat(tmpLatestPath);
      if (tmpLatestStats.size === 0) {
        console.warn(`WARN: Zero-byte file written to ${tmpLatestPath}`);
        sendError(res, 500, 'Generated file is empty');
        return;
      }
      await fs.promises.rename(tmpLatestPath, latestSspPath);

      res.json(ssp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg);
    }
  });

  // GET /api/ssp/latest
  router.get('/api/ssp/latest', (req: Request, res: Response) => {
    const scope = resolveTenantScope(req.query.tenant, stamperRoot);
    if (!scope.ok) { sendError(res, scope.status, scope.message); return; }
    const ssp = loadLatestSsp(config.storageRoot, scope.slug);
    if (!ssp) {
      sendError(res, 404, `No SSP generated yet for tenant ${scope.slug}.`);
      return;
    }
    res.json(ssp);
  });

  /**
   * FX-EO7: load an SSP by id for the REQUESTED tenant only. The id must be a UUID (no path
   * games), `?tenant=` is required, and an SSP whose tenantId is another tenant's GUID is a
   * 404 — indistinguishable from "does not exist", so ids cannot be probed across tenants.
   */
  const loadSspForTenant = (req: Request, res: Response): SystemSecurityPlan | null => {
    const sspId = String(req.params.sspId);
    if (!validateUuid(sspId)) { sendError(res, 400, 'Invalid SSP id format'); return null; }
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return null;
    const filePath = path.join(sspStore, `${sspId}.json`);
    let ssp: SystemSecurityPlan | null = null;
    if (fs.existsSync(filePath)) {
      try { ssp = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { ssp = null; }
    }
    if (!ssp || ssp.tenantId !== scope.tenantId) {
      sendError(res, 404, `SSP not found: ${sspId}`);
      return null;
    }
    return ssp;
  };

  // GET /api/ssp/:sspId
  router.get('/api/ssp/:sspId', (req: Request, res: Response) => {
    const ssp = loadSspForTenant(req, res);
    if (!ssp) return;
    res.json(ssp);
  });

  // GET /api/ssp/export/:sspId
  router.get('/api/ssp/export/:sspId', async (req: Request, res: Response) => {
    try {
      const ssp = loadSspForTenant(req, res);
      if (!ssp) return;
      const exporter = new SspDocxExporter({ qualityScorecard: new SspQualityScorecard() });
      const buffer = await exporter.export(ssp);
      const date = new Date(ssp.generatedAt).toISOString().split('T')[0];
      const filename = `SSP-${ssp.tenantId}-${date}.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      console.error('SSP export failed:', error);
      const sanitizedError = (error instanceof Error ? error.message : String(error)).replace(/[A-Z]:\\.+/g, '<path>').substring(0, 200);
      sendError(res, 500, 'DOCX export failed', sanitizedError);
    }
  });

  // ── POA&M Endpoints ──

  // POST /api/poam/generate
  router.post('/api/poam/generate', async (req: Request, res: Response) => {
    const validation = validateRequest(PoamGenerateRequestSchema, req.body);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.message);
      return;
    }

    const { tenantSlug: reqTenantSlug, assessmentId } = validation.data;
    const scope = resolveTenantScope(reqTenantSlug, stamperRoot);
    if (!scope.ok) { sendError(res, scope.status, scope.message); return; }

    // FX-EO6: the snapshot must belong to the requested tenant.
    const latest = assessmentStore.loadForTenant(scope.tenantId, assessmentId);
    if (!latest) {
      sendError(res, 404, `Assessment snapshot not found for tenant ${scope.slug}: ${assessmentId}`);
      return;
    }

    try {
      const controlsRefPath = resolveDataPath('cmmc-l2-controls.reference.json');
      const weightsPath = resolveDataPath('sprs-weights.json');

      const registries = [loadRegistry(config.registryPath)];
      if (config.infraRegistryPath) registries.push(loadRegistry(config.infraRegistryPath));

      const generator = new PoamGenerator(controlsRefPath, weightsPath, registries);

      const poam = generator.generate({
        assessment: latest,
        missionPlan: loadOptionalJson(config.missionPlanPath),
      });

      poamStore.save(scope.slug, poam);

      res.json(poam);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg);
    }
  });

  // FX-EO6: POA&M reads are scoped to ?tenant= (no default-tenant fallback).
  const poamScope = (req: Request, res: Response): string | null => {
    const scope = resolveTenantScope(req.query.tenant, stamperRoot);
    if (!scope.ok) { sendError(res, scope.status, scope.message); return null; }
    return scope.slug;
  };

  // GET /api/poam/latest
  router.get('/api/poam/latest', (req: Request, res: Response) => {
    const slug = poamScope(req, res);
    if (!slug) return;
    const poam = poamStore.loadLatest(slug);
    if (!poam) {
      sendError(res, 404, 'No POA&M generated yet.');
      return;
    }
    res.json(poam);
  });

  // GET /api/poam/list -- registered BEFORE /api/poam/:poamId (FX-EO6: it was shadowed
  // by the :poamId route, so 'list' was looked up as a POA&M id and always 404'd).
  router.get('/api/poam/list', (req: Request, res: Response) => {
    const slug = poamScope(req, res);
    if (!slug) return;
    res.json(poamStore.listSnapshots(slug));
  });

  // GET /api/poam/:poamId
  router.get('/api/poam/:poamId', (req: Request, res: Response) => {
    const slug = poamScope(req, res);
    if (!slug) return;
    const poam = poamStore.load(slug, req.params.poamId);
    if (!poam) {
      sendError(res, 404, `POA&M not found: ${req.params.poamId}`);
      return;
    }
    res.json(poam);
  });

  // GET /api/poam/export/:poamId
  router.get('/api/poam/export/:poamId', async (req: Request, res: Response) => {
    const slug = poamScope(req, res);
    if (!slug) return;
    try {
      const poam = poamStore.load(slug, req.params.poamId);
      if (!poam) {
        sendError(res, 404, `POA&M not found: ${req.params.poamId}`);
        return;
      }
      const exporter = new PoamDocxExporter();
      const buffer = await exporter.export(poam);
      const date = new Date(poam.generatedAt).toISOString().split('T')[0];
      const filename = `POAM-${poam.tenantId}-${date}.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      console.error('POA&M export failed:', error);
      const sanitizedError = (error instanceof Error ? error.message : String(error)).replace(/[A-Z]:\\.+/g, '<path>').substring(0, 200);
      sendError(res, 500, 'DOCX export failed', sanitizedError);
    }
  });

  // ── Storage Cleanup Endpoints ──

  // DELETE /api/snapshots/:snapshotId — delete a specific assessment snapshot
  router.delete('/api/snapshots/:snapshotId', async (req: Request, res: Response) => {
    const { snapshotId } = req.params;

    if (!validateUuid(snapshotId)) {
      sendError(res, 400, 'Invalid snapshot ID format');
      return;
    }

    const deleted = await cleanupService.deleteSnapshot(snapshotId);
    if (!deleted) {
      sendError(res, 404, 'Snapshot not found');
      return;
    }

    res.status(204).send();
  });

  // POST /api/storage/cleanup — prune old snapshots and temp files
  router.post('/api/storage/cleanup', async (_req: Request, res: Response) => {
    const snapshotsDeleted = await cleanupService.cleanAssessmentSnapshots();
    const tempFilesDeleted = await cleanupService.cleanTempFiles();

    res.json({ snapshotsDeleted, tempFilesDeleted });
  });

  // ── Artifact Loading ──

  // POST /api/artifacts/load — load MP/TM/IM files by path
  router.post('/api/artifacts/load', (req: Request, res: Response) => {
    const { missionPlanPath, tenantManifestPath, infraManifestPath } = req.body;
    const loaded: string[] = [];

    if (missionPlanPath && fs.existsSync(missionPlanPath)) {
      config.missionPlanPath = missionPlanPath;
      loaded.push('Mission Plan');
    }
    if (tenantManifestPath && fs.existsSync(tenantManifestPath)) {
      config.tenantManifestPath = tenantManifestPath;
      loaded.push('Tenant Manifest');
    }
    if (infraManifestPath && fs.existsSync(infraManifestPath)) {
      config.infraManifestPath = infraManifestPath;
      loaded.push('Infrastructure Manifest');
    }

    res.json({ loaded });
  });

  return router;
}
