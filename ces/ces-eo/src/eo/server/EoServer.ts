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
import { secretEnv } from 'ces-shared/secrets';
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
  loadTimeline,
  saveTimeline,
} from './eo-router-utils.js';
import { createRiskAssessmentRouter } from './routers/risk-assessment-router.js';
import { createEvidenceRouter } from './routers/evidence-router.js';
import { createTimelineRouter } from './routers/timeline-router.js';
import { createPoliciesRouter } from './routers/policies-router.js';
import { createIntakeRouter } from './routers/intake-router.js';
import { createPersonnelRouter } from './routers/personnel-router.js';
import { createDocumentsRouter } from './routers/documents-router.js';
import { createConfigRouter } from './routers/config-router.js';
import { createAssessmentRouter } from './routers/assessment-router.js';
import { createApproverTokenRouter } from './routers/approver-token-router.js';
import { createEcRouter } from './routers/ec-router.js';
import { createReviewRouter } from './routers/review-router.js';
import { createInterviewRouter } from './routers/interview-router.js';
// FIN-31: the EO kit UI at /app/ and the routes its screens need.
import { createEoUiRouter } from './routers/eo-ui-router.js';
import { createReviewQueueRouter } from './routers/review-queue-router.js';
import { createUploaderTokenRouter } from './routers/uploader-token-router.js';
import { PasskeyOperatorService } from '../approver-tokens/PasskeyOperatorService.js';
import { TenantSessionRegistry } from './TenantSessionRegistry.js';
import { captureSignalsForTenant, getLastCaptureRun, isSessionBoundTo } from './signalCapture.js';
import { FileTenantRegistry } from 'ces-tenant';
import { resolveCollectorIdentity } from '../evidence/store/collectorIdentity.js';
import { readDrift } from '../assessment/DriftDetector.js';
import {
  CollectionScheduler, createCollectionScheduleRouter, loopbackAssess, readSchedulerOptions, SCHEDULER_HEADER,
} from '../collect/collectionScheduler.js';
import { fetchEcOpenFindings } from '../collect/ecIntegrity.js';

interface ScheduledCaptureHandler {
  start: () => void;
  stop: () => void;
}

let scheduledCaptureHandler: ScheduledCaptureHandler | null = null;
let signalHandlersInstalled = false;

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

  // FIN-24: operator assess / collect / connect calls in flight. The collection scheduler defers a
  // tenant's tick while one runs (its own loopback assess carries SCHEDULER_HEADER and is not counted).
  let operatorInFlight = 0;
  app.use((req, res, next) => {
    const guarded = (req.path === '/api/assess' || req.path === '/api/connect' || (req.path === '/api/collect' && req.method === 'POST'));
    if (!guarded || req.get(SCHEDULER_HEADER) === '1') return next();
    operatorInFlight++;
    let done = false;
    const release = () => { if (!done) { done = true; operatorInFlight--; } };
    res.on('finish', release);
    res.on('close', release);
    next();
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
  // FIN-31: the kit UI (built into public/app) at /app/ with history fallback, before static.
  app.use(createEoUiRouter(publicDir));
  app.use(express.static(publicDir));

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.use(createConfigRouter({ config, stamperRoot, startedAt, sessions: tenantSessions }));

  app.use(createAssessmentRouter({ config, stamperRoot, getSessionManager: (slug) => tenantSessions.get(slug), assessmentStore, poamStore, poamLedgerStore, policyStore, personnelStore, screeningElementStore, trainingStore }));

  app.use(createDocumentsRouter({ config, stamperRoot, assessmentStore, poamStore, policyStore, personnelStore, trainingStore, screeningElementStore, riskAssessmentStore, cleanupService }));

  app.use(createPoliciesRouter({ config, stamperRoot, policyStore }));

  // GC-FLOW-3: Muster's push bundle (POST /api/intake/muster); policies go through the import path above.
  app.use(createIntakeRouter({ config, stamperRoot, policyStore }));

  app.use(createPersonnelRouter({ config, upload, personnelStore, trainingStore, attachmentHandler, offboardingWizardStore, screeningElementStore, riskAssessmentStore, stamperRoot }));

  app.use(createRiskAssessmentRouter({ config, riskAssessmentStore, assessmentStore, stamperRoot, getSessionManager: (slug) => tenantSessions.get(slug) }));

  app.use(createEvidenceRouter({ config, stamperRoot, assessmentStore, personnelStore, riskAssessmentStore, policyStore, poamStore, getSessionManager: (slug) => tenantSessions.get(slug), captureSignals: captureSignalsForTenant, getLastCaptureRun }));

  app.use(createTimelineRouter({ config, assessmentStore, stamperRoot }));

  // FC-EO-C AO-16: AdminOps approver-token issuer (BHD operator only; every mint logged as evidence).
  // FIN-31: one passkey service for both issuers (operator sessions are held in memory).
  const operatorPasskeys = new PasskeyOperatorService();
  app.use(createApproverTokenRouter({ stamperRoot, passkeys: operatorPasskeys }));
  app.use(createUploaderTokenRouter({ stamperRoot, passkeys: operatorPasskeys }));
  app.use(createEcRouter({ ecUrl: config.ecUrl, secret: config.evidenceOpsSecret, upload: ecUpload }));
  app.use(createReviewRouter({ stamperRoot, ecUrl: config.ecUrl, secret: config.evidenceOpsSecret }));
  app.use(createReviewQueueRouter({ stamperRoot, ecUrl: config.ecUrl, secret: config.evidenceOpsSecret }));
  // NS-2: interview records Muster emits (WORM eo_interview_records).
  app.use(createInterviewRouter({ stamperRoot }));

  // FIN-24 (W2.0a): continuous collection. Replaces the D-11 one-tenant capture timer: every registered
  // tenant, its collectors on their declared cadence, and a full assess (live reads, snapshot, drift,
  // POA&M reconcile) every SIGNAL_CAPTURE_INTERVAL_HOURS (24 h by default); drift and EC HASH_DRIFT
  // raise a notice. No automatic fix: re-applying a setting stays an operator action in Stamper or AO.
  const schedulerOptions = readSchedulerOptions(process.env, {
    enabled: config.enableScheduledSignalCapture === true,
    intervalHours: config.signalCaptureIntervalHours ?? 24,
  });
  const schedulerOpened = new WeakSet<SessionManager>();
  const loopbackHost = (() => {
    const bind = process.env.CES_EO_BIND;
    if (!bind || bind === '0.0.0.0' || bind === '::') return '127.0.0.1';
    return bind.includes(':') ? `[${bind}]` : bind;
  })();
  const collectionScheduler = schedulerOptions.enabled ? new CollectionScheduler(schedulerOptions, {
    storageRoot: config.storageRoot,
    listTenants: async () => {
      const registry = new FileTenantRegistry();
      const [live, sim] = await Promise.all([registry.listByKind('live'), registry.listByKind('sim')]);
      // Live registry tenants are opened app-only only on opt-in (CES_EO_COLLECT_LIVE=1, or named in
      // CES_EO_COLLECT_TENANTS): the binding "leave the dev tenant alone" rule. A live tenant an operator
      // connected is collected through that operator session.
      const allow = schedulerOptions.tenantAllowlist ?? [];
      const liveOk = (slug: string) => process.env.CES_EO_COLLECT_LIVE === '1' || allow.includes(slug);
      const slugs = new Set<string>([...sim.map(r => r.tenantSlug), ...live.map(r => r.tenantSlug).filter(liveOk)]);
      for (const s of tenantSessions.slugs()) slugs.add(s);
      return [...slugs].filter(s => resolveTenantJsonPath(s, stamperRoot, os.homedir()) !== null);
    },
    ensureSession: async (slug) => {
      const tenantJsonPath = resolveTenantJsonPath(slug, stamperRoot, os.homedir());
      if (!tenantJsonPath) return { ok: false, reason: `Tenant config not found: ${slug}` };
      const tc = loadTenantConfig(tenantJsonPath);
      let sm = tenantSessions.get(slug, tc.tenantId);
      if (!sm && tenantSessions.get(slug)) {
        // The slot holds a session bound to another tenant GUID: never replaced, never borrowed.
        return { ok: false, tenantId: tc.tenantId, reason: 'the registered session is bound to another tenant id' };
      }
      if (!sm) {
        // App-only: the tenant's own certificate credential (ces-tenant session factory), no interactive step.
        // Registered only when no session is bound, so an operator's session is never replaced.
        const opened = new SessionManager(tc, { tenantSlug: slug });
        try {
          await opened.ensureConnected('graph');
        } catch (err) {
          opened.disconnectAll().catch(() => { /* already gone */ });
          return { ok: false, tenantId: tc.tenantId, reason: `app-only session failed: ${err instanceof Error ? err.message : String(err)}` };
        }
        if (tenantSessions.get(slug)) {
          opened.disconnectAll().catch(() => { /* already gone */ }); // an operator connected meanwhile
        } else {
          tenantSessions.set(slug, opened);
          schedulerOpened.add(opened);
        }
        sm = tenantSessions.get(slug, tc.tenantId);
      }
      // Labelled by instance: an operator's /api/connect that replaced the app-only session reads 'operator'.
      const kind: 'operator' | 'app_only' = sm && schedulerOpened.has(sm) ? 'app_only' : 'operator';
      if (!isSessionBoundTo(sm, slug, tc.tenantId)) return { ok: false, tenantId: tc.tenantId, reason: 'no session bound to this tenant' };
      await sm.ensureConnected('graph');
      const reader = new ComplianceSignalFetcher(sm, new PowerShellFallbackAdapter(tc));
      const identity = await resolveCollectorIdentity(sm, (tc as any)?.appId);
      return { ok: true, tenantId: tc.tenantId, reader, identity, session: kind };
    },
    runAssess: (slug) => loopbackAssess(`http://${loopbackHost}:${config.port}`, slug, { token: secretEnv().CES_EO_AUTH_TOKEN }),
    latestSnapshotId: (tenantId) => assessmentStore.loadLatestForTenant(tenantId)?.snapshotId ?? null,
    readDrift: (snapshotId, tenantId) => readDrift(config.storageRoot, snapshotId, tenantId),
    loadPoamLedger: (slug) => poamLedgerStore.loadLatest(slug),
    readEcFindings: (slug) => fetchEcOpenFindings(config.ecUrl, slug, undefined, config.evidenceOpsSecret),
    isBusy: () => operatorInFlight > 0,
  }) : null;

  app.use(createCollectionScheduleRouter({
    scheduler: collectionScheduler,
    tenantExists: (slug) => resolveTenantJsonPath(slug, stamperRoot, os.homedir()) !== null,
  }));

  if (collectionScheduler) {
    scheduledCaptureHandler = {
      start: () => collectionScheduler.start(),
      stop: () => collectionScheduler.stop(),
    };
    if (!signalHandlersInstalled) {
      signalHandlersInstalled = true;
      for (const sig of ['SIGTERM', 'SIGINT'] as const) {
        process.on(sig, () => { scheduledCaptureHandler?.stop(); console.log(`[CollectionScheduler] stopped (${sig})`); });
      }
    }
  }

  return app;
}