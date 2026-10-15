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
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { EoConfig } from '../config/EoConfig.js';
import { saveLastTenant, stamperTenantConfigPath } from '../config/EoConfig.js';
import { writeJsonArtifact, writeTextArtifact } from 'ces-shared/persistence/files';
import { requestLogger } from 'ces-shared/observability';
import { ControlAssessor, type BlobArtifact } from '../assessment/ControlAssessor.js';
import { StamperEvidenceLoader } from '../evidence/StamperEvidenceLoader.js';
import { AssessmentStore } from '../assessment/AssessmentStore.js';
import { buildDeterminationLedger, type ManualControlStatus, type Disposition, type DeterminationLedger } from '../assessment/DeterminationLedger.js';
import { reconcilePoamLifecycle } from '../poam/PoamLifecycle.js';
import { PoamLedgerStore } from '../poam/PoamLedgerStore.js';
import { loadPersonas, projectPersona, projectAllPersonas } from '../persona/PersonaProjection.js';
import { composeAssessorView, type AssessorView } from '../viewer/AssessorViewComposer.js';
import { renderAssessorHtml } from '../viewer/AssessorViewHtml.js';
import { v4 as uuidv4 } from 'uuid';
import { SprsCalculator } from '../sprs/SprsCalculator.js';
import { SspGenerator } from '../ssp/SspGenerator.js';
import { SspDocxExporter } from '../ssp/SspDocxExporter.js';
import { AdminOpsDataProvider } from '../ssp/AdminOpsDataProvider.js';
import { OdpValueProvider } from '../ssp/OdpValueProvider.js';
import { SnippetDataResolver } from '../ssp/SnippetDataResolver.js';
import { SharedResponsibilityMatrixGenerator } from '../ssp/SharedResponsibilityMatrixGenerator.js';
import { DiagramRenderer } from '../ssp/DiagramRenderer.js';
import { SspQualityScorecard } from '../ssp/SspQualityScorecard.js';
import { PoamGenerator } from '../poam/PoamGenerator.js';
import { PoamDocxExporter } from '../poam/PoamDocxExporter.js';
import { PoamStore } from '../poam/PoamStore.js';
import { EvidencePackager } from '../packager/EvidencePackager.js';
import type { CommandRegistryFile } from 'ces-shared/types/registry';
import type { PolicyDocument } from 'ces-shared/types/policy';
import { loadTenantConfig } from 'ces-shared/config';
import { PolicyStore } from '../policies/PolicyStore.js';
import { PersonnelStore } from '../personnel/PersonnelStore.js';
import { TrainingStore } from '../personnel/TrainingStore.js';
import { TrainingEmailHelper } from '../personnel/TrainingEmailHelper.js';
import { AttachmentHandler } from '../personnel/AttachmentHandler.js';
import { OffboardingWizardStore } from '../personnel/OffboardingWizardStore.js';
import { ScreeningElementStore } from '../personnel/ScreeningElementStore.js';
import { generateCuiAcknowledgmentPdf } from '../screening/generateCuiAcknowledgmentPdf.js';
import { SCREENING_TEMPLATE_TEXT, SCREENING_ELEMENT_TITLES, ELEMENT_ARTIFACT_TYPE_MAP, ELEMENT_TYPE_DISCRIMINANT, ScreeningElementStateSchema } from '../personnel/screening.types.js';
import type { ScreeningElementState } from '../personnel/screening.types.js';
import multer from 'multer';
import {
  downloadBlob,
  listBlobs,
  type EvidenceStorageConfig,
} from 'ces-shared/blob';
import { validatePowerShellModules } from '../ingestion/PowerShellModuleValidator.js';
import { VariableStore } from '../evidence/VariableStore.js';
import { PrerequisiteChecker } from 'ces-shared/prereq';
import { SessionManager } from '../core/SessionManager.js';
import type { TenantConfig } from 'ces-shared/config';
import type { ControlAssessment } from 'ces-shared/types/controls';
import type { SignalResult } from 'ces-shared/types/signal';
import { StorageCleanupService } from './StorageCleanupService.js';
import { ComplianceSignalFetcher } from '../ingestion/ComplianceSignalFetcher.js';
import { PowerShellFallbackAdapter } from '../ingestion/PowerShellFallbackAdapter.js';
import { SignalToControlMapper } from '../mapping/SignalToControlMapper.js';
import { selectEvaluatorRegistry } from '../mapping/evaluators/index.js';
import { getActiveStackProvider } from 'ces-shared/stack';
import { resolveControlSignalRegistryPath } from '../mapping/registryResolver.js';
import { createEoAuthMiddleware, readEoAuthOptionsFromEnv } from './authMiddleware.js';
import {
  SspGenerateRequestSchema, PoamGenerateRequestSchema, PolicyImportRequestSchema, validateRequest,
  PersonnelCreateRequestSchema, PersonnelUpdateRequestSchema, LifecycleEventCreateSchema, PersonnelConfigSchema,
  OffboardingStepCompleteSchema, OffboardingFinalizeSchema,
  TrainingAssignRequestSchema, TrainingCompleteRequestSchema, TrainingEmailRequestSchema,
  TrainingCatalogSchema,
  ScreeningElementUpdateRequestSchema,
  RiskAssessmentConfigUpdateSchema, RiskEntryCreateSchema, RiskEntryUpdateSchema,
} from './validation-schemas.js';
import { RiskAssessmentStore } from '../risk-assessment/RiskAssessmentStore.js';
import { VulnerabilityIngestionService } from '../risk-assessment/VulnerabilityIngestionService.js';
import type { FindingStoreAdapter } from '../risk-assessment/VulnerabilityIngestionService.js';
import { autoScoreRegister } from '../risk-assessment/SecureScoreAutoScorer.js';
import { EligibilityChecker } from '../submission/EligibilityChecker.js';
import { DirectivePoamGenerator } from '../poam/DirectivePoamGenerator.js';
import type { DirectiveControlImplementation } from '../../shared/types/ssp.types.js';
import { RenderOrchestrator } from '../rendering/RenderOrchestrator.js';
import type { RenderDirective, RenderContext, RenderResult, ResolverResponse } from '../../shared/types/render.types.js';
import { EvidenceCaptureService } from '../generation/EvidenceCaptureService.js';
import {
  type TenantSummary,
  type Timeline,
  type TimelineEvent,
  resolveTenantJsonPath,
  validateUuid,
  validateControlId,
  sendError,
  resolveDataPath,
  loadOptionalJson,
  loadObjectiveEvidenceFromSuite,
  loadDispositionsFromProfile,
  loadRegistry,
  getEvidenceStorageConfig,
  loadTimeline,
  saveTimeline,
} from './eo-router-utils.js';
import { createRiskAssessmentRouter } from './routers/risk-assessment-router.js';
import { createEvidenceRouter } from './routers/evidence-router.js';
import { createTimelineRouter } from './routers/timeline-router.js';
import { createPoliciesRouter } from './routers/policies-router.js';
import { createPersonnelRouter } from './routers/personnel-router.js';
import { createDocumentsRouter } from './routers/documents-router.js';
import { createConfigRouter } from './routers/config-router.js';
import { createAssessmentRouter } from './routers/assessment-router.js';
import { createApproverTokenRouter } from './routers/approver-token-router.js';
import { createEcRouter } from './routers/ec-router.js';
import { TenantSessionRegistry } from './TenantSessionRegistry.js';
import { captureSignalsForTenant, getLastCaptureRun } from './signalCapture.js';

interface ScheduledCaptureHandler {
  start: () => void;
  stop: () => void;
}

let scheduledCaptureHandler: ScheduledCaptureHandler | null = null;

export function getScheduledCaptureHandler(): ScheduledCaptureHandler | null {
  return scheduledCaptureHandler;
}

export function createEoServer(config: EoConfig) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  // G8: env-gated bearer-token auth for /api/* (no-op unless CES_EO_AUTH_TOKEN is set).
  app.use(createEoAuthMiddleware(readEoAuthOptionsFromEnv()));
  // G-ENG-6: request-ID correlation + structured request logging (observability floor).
  // Health-check polling is exempt — it fires every ~30s and drowns out real traffic.
  const logRequests = requestLogger('evidence-ops');
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    logRequests(req, res, next);
  });

  const startedAt = new Date().toISOString();
  const assessmentStore = new AssessmentStore(config.storageRoot);
  const policyStore = new PolicyStore(config.storageRoot);
  const poamStore = new PoamStore(config.storageRoot);
  const poamLedgerStore = new PoamLedgerStore(config.storageRoot);
  const personnelStore = new PersonnelStore(config.storageRoot);
  const trainingStore = new TrainingStore(config.storageRoot);
  const attachmentHandler = new AttachmentHandler(config.storageRoot);
  const offboardingWizardStore = new OffboardingWizardStore(config.storageRoot);
  const screeningElementStore = new ScreeningElementStore(config.storageRoot);
  const riskAssessmentStore = new RiskAssessmentStore(config.storageRoot);

  // Multer config for personnel attachment uploads
  const uploadStorage = multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  });
  const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.docx'];
  const upload = multer({
    storage: uploadStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
      }
    },
  });

  // M4a: EC ingest uploads. Memory storage (no temp file) — the router base64-encodes the
  // buffer server-side before forwarding to EC's POST /api/ingest, which itself caps decoded
  // content at 10 MB, so this limit matches EC's own ceiling.
  const ecUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  const cleanupService = new StorageCleanupService(config.storageRoot);
  // Registry lives at stamper/src/registry/*.json — go up two levels to get stamper root
  const stamperRoot = path.resolve(path.dirname(config.registryPath), '..', '..');
  // FX2-EO1: Graph sessions are bound to the tenant /api/connect opened them for. A live-signal
  // read for tenant X uses X's session or none — never whichever tenant connected last.
  const tenantSessions = new TenantSessionRegistry();

  // PowerShell module pre-flight check (fire-and-forget, warns only)
  validatePowerShellModules().then(moduleCheck => {
    if (moduleCheck.warnings.length > 0) {
      console.warn('[EoServer] PowerShell module warnings:', moduleCheck.warnings.join('; '));
    }
    if (moduleCheck.installed.length > 0) {
      console.log('[EoServer] PowerShell modules found:', moduleCheck.installed.map(m => `${m.Name}@${m.Version}`).join(', '));
    }
  }).catch(err => {
    console.warn('[EoServer] PowerShell module check failed:', err instanceof Error ? err.message : String(err));
  });

  // Prerequisite check (fire-and-forget, warns only)
  const prereqChecker = new PrerequisiteChecker();
  prereqChecker.checkAll().then(results => {
    const missing = results.filter(r => r.required && !r.installed);
    if (missing.length > 0) {
      console.warn('[EoServer] Missing required modules:', missing.map(m => m.name).join(', '));
    }
    const installed = results.filter(r => r.installed);
    if (installed.length > 0) {
      console.log('[EoServer] PowerShell modules detected:', installed.map(m => `${m.name}@${m.version}`).join(', '));
    }
  }).catch(err => {
    console.warn('[EoServer] Prerequisite check failed:', err instanceof Error ? err.message : String(err));
  });

  // Serve static GUI
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.use(createConfigRouter({ config, stamperRoot, startedAt, sessions: tenantSessions }));

  app.use(createAssessmentRouter({ config, stamperRoot, getSessionManager: (slug) => tenantSessions.get(slug), assessmentStore, poamStore, poamLedgerStore, policyStore, personnelStore, screeningElementStore, trainingStore }));

  app.use(createDocumentsRouter({ config, stamperRoot, assessmentStore, poamStore, policyStore, personnelStore, trainingStore, screeningElementStore, riskAssessmentStore, cleanupService }));

  app.use(createPoliciesRouter({ config, stamperRoot, policyStore }));

  app.use(createPersonnelRouter({ config, upload, personnelStore, trainingStore, attachmentHandler, offboardingWizardStore, screeningElementStore, riskAssessmentStore, stamperRoot }));

  app.use(createRiskAssessmentRouter({ config, riskAssessmentStore, assessmentStore, stamperRoot, getSessionManager: (slug) => tenantSessions.get(slug) }));

  app.use(createEvidenceRouter({ config, stamperRoot, assessmentStore, personnelStore, riskAssessmentStore, policyStore, poamStore, getSessionManager: (slug) => tenantSessions.get(slug), captureSignals: captureSignalsForTenant, getLastCaptureRun }));

  app.use(createTimelineRouter({ config, assessmentStore, stamperRoot }));

  // FC-EO-C AO-16: AdminOps approver-token issuer (BHD operator only; every mint logged as evidence).
  app.use(createApproverTokenRouter({ stamperRoot }));
  app.use(createEcRouter({ ecUrl: config.ecUrl, secret: config.evidenceOpsSecret, upload: ecUpload }));

  // Setup scheduled signal capture if configured
  if (config.enableScheduledSignalCapture && config.signalCaptureIntervalHours) {
    const intervalMs = config.signalCaptureIntervalHours * 3600000;
    let scheduledCaptureIntervalId: NodeJS.Timeout | null = null;

    scheduledCaptureHandler = {
      start: () => {
        if (scheduledCaptureIntervalId) return;

        console.log(`[ScheduledCapture] Starting scheduled signal capture every ${config.signalCaptureIntervalHours} hours`);

        scheduledCaptureIntervalId = setInterval(async () => {
          const timestamp = new Date().toISOString();
          console.log(`[ScheduledCapture] Running scheduled capture at ${timestamp}`);

          const tenantSlug = config.tenantSlug;
          if (!tenantSlug) {
            console.warn('[ScheduledCapture] No tenant slug configured — skipping');
            return;
          }

          // FX2-EO1: the default tenant's OWN session only; not_connected ⇒ nothing is captured.
          const evidenceStorage = getEvidenceStorageConfig(config);
          const result = await captureSignalsForTenant(tenantSlug, tenantSessions.get(tenantSlug), evidenceStorage, config, stamperRoot);
          if (result.liveSignals === 'not_connected') {
            console.warn(`[ScheduledCapture] Tenant '${tenantSlug}' has no live session of its own — skipped`);
          }

          console.log(`[ScheduledCapture] Captured ${result.capturedCount} artifacts`);
          if (result.errors.length > 0) {
            console.warn(`[ScheduledCapture] ${result.errors.length} errors:`, result.errors);
          }
        }, intervalMs);

        process.on('SIGTERM', () => {
          if (scheduledCaptureIntervalId) {
            clearInterval(scheduledCaptureIntervalId);
            console.log('[ScheduledCapture] Stopped due to SIGTERM');
          }
        });

        process.on('SIGINT', () => {
          if (scheduledCaptureIntervalId) {
            clearInterval(scheduledCaptureIntervalId);
            console.log('[ScheduledCapture] Stopped due to SIGINT');
          }
        });
      },
      stop: () => {
        if (scheduledCaptureIntervalId) {
          clearInterval(scheduledCaptureIntervalId);
          scheduledCaptureIntervalId = null;
          console.log('[ScheduledCapture] Stopped');
        }
      },
    };
  }

  return app;
}