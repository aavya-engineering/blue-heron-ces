// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { loadLatestSsp } from '../../ssp/sspLatest.js';
import express, { type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import type { EoConfig } from '../../config/EoConfig.js';
import { loadTenantConfig } from 'ces-shared/config';
import { ControlAssessor, type BlobArtifact } from '../../assessment/ControlAssessor.js';
import { StamperEvidenceLoader } from '../../evidence/StamperEvidenceLoader.js';
import { AssessmentStore } from '../../assessment/AssessmentStore.js';
import { buildDeterminationLedger, type ManualControlStatus, type DeterminationLedger } from '../../assessment/DeterminationLedger.js';
import { reconcilePoamLifecycle } from '../../poam/PoamLifecycle.js';
import { PoamLedgerStore } from '../../poam/PoamLedgerStore.js';
import { loadPersonas, projectPersona, projectAllPersonas } from '../../persona/PersonaProjection.js';
import { composeAssessorView, type AssessorView } from '../../viewer/AssessorViewComposer.js';
import { renderAssessorHtml } from '../../viewer/AssessorViewHtml.js';
import { AdminOpsEvidenceReader } from '../../adminops/AdminOpsEvidenceReader.js';
import { SprsCalculator } from '../../sprs/SprsCalculator.js';
import { PoamGenerator } from '../../poam/PoamGenerator.js';
import { PoamStore } from '../../poam/PoamStore.js';
import { PolicyStore } from '../../policies/PolicyStore.js';
import { PersonnelStore } from '../../personnel/PersonnelStore.js';
import { TrainingStore } from '../../personnel/TrainingStore.js';
import { ScreeningElementStore } from '../../personnel/ScreeningElementStore.js';
import { SessionManager } from '../../core/SessionManager.js';
import { isSessionBoundTo } from '../signalCapture.js';
import { ComplianceSignalFetcher } from '../../ingestion/ComplianceSignalFetcher.js';
import { PowerShellFallbackAdapter } from '../../ingestion/PowerShellFallbackAdapter.js';
import { SignalToControlMapper } from '../../mapping/SignalToControlMapper.js';
import { selectEvaluatorRegistry } from '../../mapping/evaluators/index.js';
import { getActiveStackProvider } from 'ces-shared/stack';
import { resolveControlSignalRegistryPath } from '../../mapping/registryResolver.js';
import { EvidenceCaptureService } from '../../generation/EvidenceCaptureService.js';
import { EligibilityChecker } from '../../submission/EligibilityChecker.js';
import { DirectivePoamGenerator } from '../../poam/DirectivePoamGenerator.js';
import { RenderOrchestrator } from '../../rendering/RenderOrchestrator.js';
import {
  downloadBlob,
  listBlobs,
} from 'ces-shared/blob';
import type { ControlAssessment } from 'ces-shared/types/controls';
import type { DirectiveControlImplementation } from '../../../shared/types/ssp.types.js';
import type { RenderDirective, RenderContext, RenderResult } from '../../../shared/types/render.types.js';
import {
  sendError,
  validateControlId,
  resolveTenantJsonPath,
  resolveDataPath,
  loadOptionalJson,
  loadObjectiveEvidenceFromSuite,
  loadDispositionsFromProfile,
  loadRegistry,
  getEvidenceStorageConfig,
  resolveTenantScope,
  requireTenantScope,
  type TenantScope,
} from '../eo-router-utils.js';

type ResolvedTenant = Extract<TenantScope, { ok: true }>;

export interface AssessmentRouterDeps {
  config: EoConfig;
  stamperRoot: string;
  /** FX2-EO1: the session opened for THIS tenant slug, or null — never another tenant's. */
  getSessionManager: (tenantSlug: string) => SessionManager | null;
  assessmentStore: AssessmentStore;
  poamStore: PoamStore;
  poamLedgerStore: PoamLedgerStore;
  policyStore: PolicyStore;
  personnelStore: PersonnelStore;
  screeningElementStore: ScreeningElementStore;
  trainingStore: TrainingStore;
}

export function createAssessmentRouter(deps: AssessmentRouterDeps): express.Router {
  const {
    config, stamperRoot, getSessionManager,
    assessmentStore, poamStore, poamLedgerStore,
    policyStore, personnelStore, screeningElementStore, trainingStore,
  } = deps;

  const router = express.Router();

  // GET /api/assess — SSE: run evidence assessment (import + EC + merge)
  router.get('/api/assess', async (req: Request, res: Response) => {
    // FX-EO8: the requested tenant only — no fallback to the server's default tenant.
    const tenantSlug = typeof req.query.tenant === 'string' ? req.query.tenant.trim() : '';

    // Pre-SSE validation: return HTTP errors before setting SSE headers
    if (!tenantSlug) {
      sendError(res, 400, 'Missing tenant parameter');
      return;
    }

    // stamperRoot resolved at module scope
    const tenantJsonPath = resolveTenantJsonPath(tenantSlug, stamperRoot, os.homedir());
    if (!tenantJsonPath) {
      sendError(res, 404, `Tenant config not found: ${tenantSlug}`);
      return;
    }

    // Validate tenant config is readable and parseable
    try {
      JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
    } catch {
      sendError(res, 400, 'Invalid tenant config format');
      return;
    }

    // SSE setup (all 4xx errors already returned above)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    let closed = false;
    req.on('close', () => { closed = true; });

    try {
      send({ type: 'assess_start', tenant: tenantSlug, timestamp: new Date().toISOString() });

      // Load raw tenant JSON for EC findings phase
      let tenantConfigRaw: any;
      try {
        tenantConfigRaw = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        send({ type: 'assess_error', error: 'Failed to load tenant config', detail: errorMsg });
        res.end();
        return;
      }

      // Load typed TenantConfig for SessionManager and variable resolution
      const tc = loadTenantConfig(tenantJsonPath);

      // Phase 1.5: Load Stamper manual gate evidence (offline — reads from disk)
      const evidenceLoader = new StamperEvidenceLoader(tenantSlug);
      const stamperEvidence = evidenceLoader.loadEvidenceForTenant();
      const stamperEvidenceSources = evidenceLoader.toAssessmentSources(stamperEvidence);
      const directiveMetadataMap = evidenceLoader.toDirectiveMetadataMap(stamperEvidence);
      send({
        type: 'assess_import',
        filesFound: stamperEvidence.length,
        directiveMetadataCount: directiveMetadataMap.size,
        directory: `stamper://plan-data/${tenantSlug}/evidence`,
      });

      // Phase 1.6: Load AdminOps evidence from shared ces.db (AE-R4)
      const aoTenantId = tenantConfigRaw.tenant?.tenant_id;
      let adminOpsReadResult: import('../../adminops/AdminOpsEvidenceReader.js').AdminOpsReadResult | null = null;
      if (aoTenantId) {
        try {
          const { AdminOpsEvidenceReader } = await import('../../adminops/AdminOpsEvidenceReader.js');
          const aoReader = new AdminOpsEvidenceReader(aoTenantId);
          adminOpsReadResult = aoReader.read();
          for (const [controlId, aoSources] of adminOpsReadResult.sources) {
            const existing = stamperEvidenceSources.get(controlId) || [];
            existing.push(...aoSources);
            stamperEvidenceSources.set(controlId, existing);
          }
          send({
            type: 'assess_adminops',
            total: adminOpsReadResult.stats.total,
            live: adminOpsReadResult.stats.live,
            dryRunSkipped: adminOpsReadResult.stats.dryRun,
            denied: adminOpsReadResult.stats.denied,
            unparsed: adminOpsReadResult.stats.unparsed,
          });
        } catch (err) {
          console.warn('[assess] AdminOps evidence read error:', (err as Error).message);
          send({ type: 'assess_adminops_error', error: (err as Error).message });
        }
      }

      // Phase 1.7: EC evidence items (manual uploads / attestations, M4a). Read-only and
      // verdict-neutral: an unreachable EC or an unset secret yields [] and never blocks
      // assessment (EcEvidenceReader never throws).
      let ecItems: import('ces-shared/types/evidence-collector').EcEvidenceItem[] = [];
      try {
        const { EcEvidenceReader } = await import('../../evidence/EcEvidenceReader.js');
        const ecReader = new EcEvidenceReader({ ecUrl: config.ecUrl, secret: config.evidenceOpsSecret });
        ecItems = await ecReader.readItems(tenantSlug);
        send({ type: 'assess_ec_items', count: ecItems.length });
      } catch (err) {
        console.warn('[assess] EC evidence read error:', (err as Error).message);
        send({ type: 'assess_ec_items_error', error: (err as Error).message });
      }

      // Phase 2: Load evidence from Azure Blob Storage (offline — uses SharedKey auth from tenant config)
      // FX-EO7: the ASSESSED tenant's blob storage, never the server default's.
      const evidenceStorage = getEvidenceStorageConfig(config, tenantJsonPath);
      let blobArtifacts: BlobArtifact[] = [];

      if (evidenceStorage) {
        try {
          // List all blobs from root (base_path auto-prepended by shared blob lib)
          // Handles all conventions: Stamper family folders, legacy evidence/ prefix, EC artifacts/
          const allBlobEntries = await listBlobs(evidenceStorage, '');
          console.log(`[EoServer] Blob listing returned ${allBlobEntries.length} entries (base_path=${JSON.stringify(evidenceStorage.base_path)})`);
          if (allBlobEntries.length > 0 && allBlobEntries.length <= 10) {
            console.log(`[EoServer] Blob entries: ${allBlobEntries.map(e => e.name).join(', ')}`);
          } else if (allBlobEntries.length > 10) {
            console.log(`[EoServer] First 10 blob entries: ${allBlobEntries.slice(0, 10).map(e => e.name).join(', ')}`);
          }

          let skippedNonJson = 0;
          let skippedNoControl = 0;
          for (const entry of allBlobEntries) {
            if (!entry.name.endsWith('.json')) { skippedNonJson++; continue; }
            if (entry.name.startsWith('manifests/')) continue;

            try {
              const content = await downloadBlob(evidenceStorage, entry.name);
              if (!content) {
                console.warn(`[EoServer] downloadBlob returned null for '${entry.name}'`);
                continue;
              }
              const parsed = JSON.parse(content);

              let artifactId = parsed.artifactId ?? parsed.artifact_id ?? '';
              let controlIds: string[] = parsed.controlIds ?? (parsed.control_ids ? parsed.control_ids : []);
              const capturedAt = parsed.capturedAt ?? parsed.collected_at ?? '';
              const source = parsed.source ?? parsed.collector ?? 'blob';
              const checkId = parsed.checkId ?? parsed.check_id ?? parsed.signalId ?? '';
              const sha256 = parsed.sha256 ?? parsed.sha256_hash ?? '';

              // Single controlId field → array
              if (controlIds.length === 0 && parsed.controlId) {
                controlIds = [parsed.controlId];
              }

              // Derive controlId from filename if not in content
              if (controlIds.length === 0) {
                const fileName = entry.name.split('/').pop() || '';
                const controlMatch = fileName.match(/^([a-z]{2})\.l2-([\d.]+)\./i);
                if (controlMatch) {
                  controlIds = [`${controlMatch[1].toUpperCase()}.L2-${controlMatch[2]}`];
                }
              }

              // Generate artifactId from blob name if absent
              if (!artifactId) {
                artifactId = 'blob:' + entry.name.replace(/[/\\]/g, ':');
              }

              if (controlIds.length > 0) {
                blobArtifacts.push({
                  artifactId,
                  runId: parsed.runId ?? '',
                  capturedAt,
                  source,
                  checkId,
                  controlIds,
                  sha256,
                });
              } else {
                skippedNoControl++;
              }
            } catch (err) {
              console.warn(`[EoServer] Skipping malformed blob '${entry.name}':`, (err as Error).message);
            }
          }
          if (skippedNonJson > 0) console.log(`[EoServer] Skipped ${skippedNonJson} non-JSON blob(s)`);
          if (skippedNoControl > 0) console.warn(`[EoServer] Skipped ${skippedNoControl} blob(s) with no parseable controlId`);

          send({
            type: 'assess_import',
            filesFound: blobArtifacts.length,
            directory: `blob://${evidenceStorage.account_name}/${evidenceStorage.container}`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[EoServer] Blob artifact loading failed: ${msg}`);
        }
      } else {
        console.warn('[EoServer] No evidence_storage config — blob artifacts unavailable');
      }

      if (closed) { res.end(); return; }

      // Phase 4: Signal fetch + evaluation (when Graph session is available)
      let signalAssessments: Map<string, ControlAssessment> | undefined;

      // FX2-EO1: only the assessed tenant's own session; bound-tenant check as defence in depth.
      const candidateSession = getSessionManager(tenantSlug);
      const sessionManager = isSessionBoundTo(candidateSession, tenantSlug, tc.tenantId) ? candidateSession : null;
      const liveSignals = sessionManager ? 'connected' : 'not_connected';
      send({ type: 'live_signals', tenant: tenantSlug, liveSignals });
      if (sessionManager !== null) {
        try {
          // Proactive connection check — verify/restore Graph session before signal fetch
          send({ type: 'graph_reconnect', phase: 'checking', timestamp: new Date().toISOString() });
          await sessionManager.ensureConnected('graph');
          send({ type: 'graph_reconnect', phase: 'ready', timestamp: new Date().toISOString() });

          send({ type: 'signal_fetch_start', timestamp: new Date().toISOString() });

          const psAdapter = new PowerShellFallbackAdapter(tc);
          const fetcher = new ComplianceSignalFetcher(sessionManager, psAdapter);

          const allSignals = await fetcher.fetchAllSignals();
          send({ type: 'signal_fetch', signalCount: allSignals.length });

          // Run evaluators to map signals to control assessments
          // G4: registry + evaluator set are selected by the active stack provider (Microsoft default).
          // G13: resolve the registry path via registryResolver (supports Microsoft + Google; unknown → undefined).
          const stack = getActiveStackProvider(tc).capabilities;
          const mapper = new SignalToControlMapper(resolveControlSignalRegistryPath(stack.controlSignalRegistryId), stack.controlSignalRegistryId);
          const signalControlAssessments = mapper.mapSignalsToControls(allSignals, selectEvaluatorRegistry(stack.evaluatorSetId));

          signalAssessments = new Map<string, ControlAssessment>();
          for (const sa of signalControlAssessments) {
            signalAssessments.set(sa.control_id, sa);
          }

          send({ type: 'signal_eval_done', controlsEvaluated: signalAssessments.size });

          // Capture signal artifacts to blob storage (non-blocking)
          const captureEvidenceStorage = getEvidenceStorageConfig(config, tenantJsonPath); // FX-EO7
          if (captureEvidenceStorage && signalAssessments) {
            try {
              const captureService = new EvidenceCaptureService(captureEvidenceStorage);
              const captureResults = await Promise.allSettled(
                Array.from(signalAssessments.values()).map(sa => captureService.captureForAssessment(sa))
              );

              let totalArtifacts = 0;
              for (const result of captureResults) {
                if (result.status === 'fulfilled') {
                  totalArtifacts += result.value.length;
                }
              }

              const captureErrors = captureService.getErrors();
              send({
                type: 'signal_capture',
                artifactCount: totalArtifacts,
                errorCount: captureErrors.length,
                errors: captureErrors,
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn('[EoServer] Signal capture failed:', msg);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send({ type: 'signal_fetch_error', message: msg });
          // Signal fetch is non-blocking — assessment continues without signals
        }
      }

      if (closed) { res.end(); return; }

      // Phase 5: Merge all sources into assessment snapshot
      const controlsRefPath = resolveDataPath('cmmc-l2-controls.reference.json');

      // Load policies for tenant (if any imported)
      const tenantPolicies = policyStore.load(tenantSlug);

      // Load command registries for classification (same source as Stamper)
      const registries = [loadRegistry(config.registryPath)];
      if (config.infraRegistryPath) registries.push(loadRegistry(config.infraRegistryPath));

      const assessor = new ControlAssessor(controlsRefPath, registries);
      const snapshot = assessor.merge(
        tenantConfigRaw.tenant?.tenant_id ?? tenantSlug,
        [],
        blobArtifacts,
        [],
        tenantPolicies,
        stamperEvidenceSources,
        signalAssessments,
        directiveMetadataMap,
        ecItems
      );

      // Phase 5.5: Render orchestration (AFTER evidence loading, BEFORE SPRS)
      let renderResultMap = new Map<string, RenderResult>();
      try {
        const renderJobs = stamperEvidence
          .filter(ev => ev.renderDirective)
          .map(ev => ({
            controlId: ev.controlIds[0] ?? ev.entryId,
            directive: ev.renderDirective as RenderDirective,
            evidenceFilePath: ev.evidenceFilePath,
          }));

        if (renderJobs.length > 0) {
          send({ type: 'render_start', jobCount: renderJobs.length, timestamp: new Date().toISOString() });

          const renderOrchestrator = new RenderOrchestrator(stamperRoot, tenantSlug);
          if (adminOpsReadResult) {
            renderOrchestrator.setAdminOpsData(adminOpsReadResult);
          }
          const renderContext: RenderContext = {
            tenantSlug,
            tenantName: tenantConfigRaw.client?.name ?? tenantSlug,
            complianceRepoPath: config.complianceRepoPath,
            assessmentSnapshot: snapshot,
            renderedArtifacts: new Map(),
            date: new Date().toISOString().split('T')[0],
          };

          renderResultMap = await renderOrchestrator.orchestrateRenders(
            renderJobs,
            renderContext,
            (event) => send({ type: 'render_progress', ...event }),
          );

          const rendered = Array.from(renderResultMap.values()).filter(r => r.state === 'rendered').length;
          const failed = Array.from(renderResultMap.values()).filter(r => r.state === 'failed').length;
          const skipped = Array.from(renderResultMap.values()).filter(r => r.state === 'skipped').length;

          send({
            type: 'render_summary',
            total: renderResultMap.size,
            rendered,
            failed,
            skipped,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'render_error', message: msg });
      }

      if (closed) { res.end(); return; }

      // Calculate SPRS score
      const sprsCalc = new SprsCalculator();
      const sprsResult = sprsCalc.calculate(snapshot.controls);
      snapshot.sprs_score = sprsResult.score;

      assessmentStore.save(snapshot);

      // Auto-generate POA&M for NOT MET controls
      try {
        const poamControlsRefPath = resolveDataPath('cmmc-l2-controls.reference.json');
        const weightsPath = resolveDataPath('sprs-weights.json');

        const poamRegistries = [loadRegistry(config.registryPath)];
        if (config.infraRegistryPath) poamRegistries.push(loadRegistry(config.infraRegistryPath));

        const generator = new PoamGenerator(poamControlsRefPath, weightsPath, poamRegistries);
        const poam = generator.generate({ assessment: snapshot });
        poamStore.save(tenantSlug, poam); // FX-EO7: the assessed tenant, not the server default

        send({
          type: 'poam_generated',
          poamId: poam.poamId,
          totalItems: poam.items.length,
          eligible: poam.eligibility.eligible,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'poam_generation_failed', reason: msg, timestamp: new Date().toISOString() });
      }

      // Directive-aware eligibility check (advisory only per Decision 5)
      let eligibilityReport;
      try {
        const directivePoamGen = new DirectivePoamGenerator();
        // Build directive POA&M from controls that have directive metadata
        const directiveControls = snapshot.controls
          .filter(c => c.directiveMetadata)
          .map(c => ({
            control_id: c.control_id,
            nist_ref: c.nist_ref,
            family: '',
            practice: '',
            status: c.status,
            classification: c.classification,
            weight: 0,
            implementationNarrative: '',
            technologyUsed: [],
            responsibleRole: '',
            evidenceReferences: [],
            relatedPolicies: [],
            odpValues: [],
            assessmentObjectives: [],
            sprsValue: c.status === 'not_met' ? 'NOT_MET' as const : c.status === 'met' ? 'MET' as const : undefined,
            sprsRationale: undefined,
            directiveMetadata: c.directiveMetadata as unknown as DirectiveControlImplementation['directiveMetadata'],
            directive: (c.directiveMetadata as unknown as Record<string, unknown>)?.directive as DirectiveControlImplementation['directive'],
          }));

        const directivePoamList = directivePoamGen.buildPoamList(directiveControls);
        const controlsWithoutDirectives = snapshot.controls.filter(c => !c.directiveMetadata).length;

        const eligChecker = new EligibilityChecker();
        eligibilityReport = eligChecker.checkEligibility(
          { controlImplementations: [] } as unknown as import('ces-shared/types/ssp').SystemSecurityPlan,
          sprsResult.score,
          directivePoamList,
          controlsWithoutDirectives > 0 ? controlsWithoutDirectives : undefined
        );

        send({
          type: 'eligibility_report',
          eligible: eligibilityReport.eligible,
          score: eligibilityReport.score,
          blockingIssues: eligibilityReport.blockingIssues,
          warnings: eligibilityReport.warnings,
          poam_summary: eligibilityReport.poam_summary,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'eligibility_check_skipped', reason: msg });
      }

      // Compute directive-based SPRS counts from controls
      const directiveCounts = snapshot.controls.reduce(
        (acc, c) => {
          const sv = (c as any).sprsValue;
          if (sv === 'MET') acc.met++;
          else if (sv === 'NOT_MET') acc.notMet++;
          else if (sv === 'N/A') acc.na++;
          return acc;
        },
        { met: 0, notMet: 0, na: 0 }
      );

      send({
        type: 'assess_summary',
        snapshotId: snapshot.snapshotId,
        sprs_score: sprsResult.score,
        sprs_met: directiveCounts.met,
        sprs_not_met: directiveCounts.notMet,
        sprs_na: directiveCounts.na,
        controls_met: snapshot.controls_met,
        controls_not_met: snapshot.controls_not_met,
        controls_partial: snapshot.controls_partial,
        controls_not_assessed: snapshot.controls_not_assessed,
        liveAssessmentCount: snapshot.liveAssessmentCount,
      });

      send({ type: 'assess_done', liveSignals, timestamp: new Date().toISOString() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'assess_error', error: msg });
    }

    res.end();
  });

  // GET /api/assessment?tenant= — the REQUESTED tenant's latest snapshot (FX-EO8; was the
  // storage's last-saved tenant, whoever that was).
  router.get('/api/assessment', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const latest = assessmentStore.loadLatestForTenant(scope.tenantId);
    if (!latest) {
      sendError(res, 404, `No assessment available for tenant ${scope.slug}. Run /api/assess first.`);
      return;
    }
    res.json(latest);
  });

  // GET /api/ledger — the unified per-objective determination ledger. Composes the digital
  // AssessmentSnapshot + tenant-suite objective evidence + non-digital readiness (PS/AT) +
  // mission-plan dispositions into one per-objective source of truth (with provenance) that the
  // POA&M lifecycle, SSP, and persona views all project from.
  // Assemble the unified determination ledger for a tenant from the latest snapshot + suite
  // evidence + non-digital PS/AT readiness + mission-plan dispositions. Shared by /api/ledger
  // and /api/poam/reconcile so both project from exactly the same source of truth.
  // FX-EO8: built from the REQUESTED tenant's own latest snapshot (scope = resolved ?tenant=).
  const assembleLedger = (scope: ResolvedTenant): DeterminationLedger | null => {
    const slug = scope.slug;
    const latest = assessmentStore.loadLatestForTenant(scope.tenantId);
    if (!latest) return null;
    const manualControlStatus: Record<string, ManualControlStatus> = {};
    if (slug) {
      const readiness = personnelStore.getReadiness(slug, screeningElementStore);
      manualControlStatus['PS.L2-3.9.1'] = { status: readiness.ps_3_9_1, source: 'personnel', rationale: 'personnel screening readiness (all active personnel cleared)' };
      manualControlStatus['PS.L2-3.9.2'] = { status: readiness.ps_3_9_2, source: 'personnel', rationale: 'offboarding/termination readiness' };
      const active = personnelStore.load(slug).filter(r => r.screeningState !== 'offboarded').map(r => ({ id: r.id, role: r.role, screeningState: r.screeningState }));
      if (active.length > 0) {
        for (const at of ['AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3']) {
          manualControlStatus[at] = { status: trainingStore.isControlMet(slug, at, active) ? 'met' : 'not_met', source: 'training', rationale: 'awareness-training completion across active personnel' };
        }
      }
    }
    return buildDeterminationLedger({
      tenantId: latest.tenantId,
      generatedAt: latest.generatedAt,
      snapshot: latest,
      objectiveEvidence: loadObjectiveEvidenceFromSuite(),
      manualControlStatus,
      dispositions: loadDispositionsFromProfile(slug),
    });
  };

  router.get('/api/ledger', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const ledger = assembleLedger(scope);
      if (!ledger) { sendError(res, 404, 'No assessment available. Run /api/assess first.'); return; }
      res.json(ledger);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/poam/reconcile — the objective-level POA&M lifecycle. Diffs the current ledger
  // deficiencies against the persisted POA&M ledger: new -> open, still-deficient -> carry
  // forward (id/history preserved), remediated -> AUTO-CLOSE, recurred -> reopen. Persists and
  // returns the reconciled ledger (open items, certification blockers, and the closed audit trail).
  router.get('/api/poam/reconcile', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const ledger = assembleLedger(scope);
      if (!ledger) { sendError(res, 404, 'No assessment available. Run /api/assess first.'); return; }
      const previous = poamLedgerStore.loadLatest(slug);
      const reconciled = reconcilePoamLifecycle(previous, ledger.deficiencies, new Date().toISOString(), uuidv4(), ledger.tenantId);
      poamLedgerStore.save(slug, reconciled);
      res.json(reconciled);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/personas — all persona projections (each role's controls + status + action backlog).
  router.get('/api/personas', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const ledger = assembleLedger(scope);
      if (!ledger) { sendError(res, 404, 'No assessment available. Run /api/assess first.'); return; }
      res.json(projectAllPersonas(loadPersonas(), ledger));
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/persona/:id — one persona's tailored view (their controls, status, prioritized actions).
  router.get('/api/persona/:id', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const persona = loadPersonas().find(p => p.id.toUpperCase() === req.params.id.toUpperCase());
      if (!persona) { sendError(res, 404, `Unknown persona '${req.params.id}' (expected P1..P8)`); return; }
      const ledger = assembleLedger(scope);
      if (!ledger) { sendError(res, 404, 'No assessment available. Run /api/assess first.'); return; }
      res.json(projectPersona(persona, ledger));
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // Compose the unified assessor view for a tenant: ledger + latest SSP + POA&M lifecycle +
  // mission plan + personas + WORM evidence refs. Missing inputs degrade gracefully (never faked).
  const composeAssessorViewForTenant = (scope: ResolvedTenant): AssessorView | null => {
    const slug = scope.slug;
    const ledger = assembleLedger(scope);
    if (!ledger) return null;
    let ssp: { controlImplementations?: Array<{ control_id: string; implementationNarrative?: string; evidenceReferences?: string[] }> } | null = null;
    // FX-EO6: this tenant's own latest SSP (per-tenant file), never another tenant's.
    ssp = loadLatestSsp(config.storageRoot, slug);
    // W4-EO1 (AE-R5): this tenant's AdminOps rows from ces.db, keyed by the tenant GUID exactly as
    // /api/assess reads them (tenant.tenant_id). A read failure leaves the section out, never faked.
    let adminOps: ReturnType<AdminOpsEvidenceReader['read']>['parsed'] | null = null;
    try { adminOps = new AdminOpsEvidenceReader(scope.tenantId).read().parsed; } catch { adminOps = null; }
    return composeAssessorView({
      adminOps,
      adminOpsTenantId: scope.tenantId,
      ledger,
      ssp,
      poamLedger: poamLedgerStore.loadLatest(slug),
      missionPlan: loadOptionalJson(config.missionPlanPath) ?? null,
      personas: loadPersonas(),
      tenantSlug: slug, // FX-EO7: evidence links carry the tenant
    });
  };

  // GET /api/assessor-view — the composed payload (JSON twin of the viewer).
  router.get('/api/assessor-view', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;
    try {
      const view = composeAssessorViewForTenant(scope);
      if (!view) { sendError(res, 404, 'No assessment available. Run /api/assess first.'); return; }
      res.json(view);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /assessor — the self-contained pivotable Assessor Determination Viewer (HTML).
  router.get('/assessor', (req: Request, res: Response) => {
    // FX-EO8: the requested tenant only; 400 missing / 404 unknown (as HTML).
    const scope = resolveTenantScope(req.query.tenant, stamperRoot);
    if (!scope.ok) {
      res.status(scope.status).type('html').send('<h1>' + (scope.status === 400 ? 'Tenant required' : 'Unknown tenant') + '</h1><p>' + scope.message.replace(/</g, '&lt;') + '</p>');
      return;
    }
    try {
      const view = composeAssessorViewForTenant(scope);
      if (!view) { res.status(404).type('html').send('<h1>No assessment yet</h1><p>Run <code>/api/assess</code> first.</p>'); return; }
      res.type('html').send(renderAssessorHtml(view));
    } catch (err) {
      res.status(500).type('html').send('<h1>Error</h1><pre>' + String((err as Error).message).replace(/</g, '&lt;') + '</pre>');
    }
  });

  // GET /api/sprs — current SPRS result from latest assessment
  router.get('/api/sprs', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8
    if (!scope) return;
    const latest = assessmentStore.loadLatestForTenant(scope.tenantId);
    if (!latest) {
      sendError(res, 404, 'No assessment available.');
      return;
    }
    const sprsCalc = new SprsCalculator();
    const result = sprsCalc.calculate(latest.controls);
    res.json(result);
  });

  // GET /api/sprs/weights — raw SPRS weights for all 110 controls
  router.get('/api/sprs/weights', (_req: Request, res: Response) => {
    const sprsCalc = new SprsCalculator();
    res.json(sprsCalc.weights.controls);
  });

  // GET /api/sprs/history — SPRS scores over time
  router.get('/api/sprs/history', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8
    if (!scope) return;
    const snapshots = assessmentStore.listSnapshotsForTenant(scope.tenantId);
    res.json(snapshots);
  });

  // GET /api/controls — all 110 controls with assessment status
  router.get('/api/controls', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8
    if (!scope) return;
    const latest = assessmentStore.loadLatestForTenant(scope.tenantId);
    if (!latest) {
      sendError(res, 404, 'No assessment available.');
      return;
    }
    res.json(latest.controls);
  });

  // GET /api/controls/:controlId — single control detail
  router.get('/api/controls/:controlId', (req: Request, res: Response) => {
    if (!validateControlId(req.params.controlId)) {
      sendError(res, 400, 'Invalid control ID format. Expected pattern: XX.LN-N.N.N');
      return;
    }
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8
    if (!scope) return;

    const latest = assessmentStore.loadLatestForTenant(scope.tenantId);
    if (!latest) {
      sendError(res, 404, 'No assessment available.');
      return;
    }
    const control = latest.controls.find(c => c.control_id === req.params.controlId);
    if (!control) {
      sendError(res, 404, `Control not found: ${req.params.controlId}`);
      return;
    }
    res.json(control);
  });

  return router;
}
