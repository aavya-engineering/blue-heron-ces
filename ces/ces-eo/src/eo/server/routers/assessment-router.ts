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
import { ControlAssessor, type BlobArtifact, type CaSelfRecords } from '../../assessment/ControlAssessor.js';
import { StamperEvidenceLoader, gateContextOf } from '../../evidence/StamperEvidenceLoader.js';
import { loadLatestExecutionResults, executionResultsToSources, isStamperExecutionFailure } from '../../evidence/StamperExecutionResultsLoader.js';
import { getCesModuleRoot } from 'ces-shared/storage/node';
import { AssessmentStore } from '../../assessment/AssessmentStore.js';
import type { DeterminationLedger } from '../../assessment/DeterminationLedger.js';
import { assembleLedger as assembleTenantLedger, storeControlStatus, applyStoreControlStatus } from '../ledgerAssembly.js';
import { reconcilePoamLifecycle } from '../../poam/PoamLifecycle.js';
import { PoamLedgerStore } from '../../poam/PoamLedgerStore.js';
import { detectDrift, writeDrift, readDrift, summarizeDrift, pickBaseline } from '../../assessment/DriftDetector.js';
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
import { recordFetchedSignals } from '../../evidence/store/recordFetchedSignals.js';
import { resolveCollectorIdentity } from '../../evidence/store/collectorIdentity.js';
import { runCollectors, summarizeCollectRun } from '../../collect/index.js';
import { stamperEvidenceCollector, stamperEvidenceFromChain, NO_COLLECTOR_READER } from '../../collect/StamperEvidenceCollector.js';
import { EvidenceStore } from '../../evidence/store/EvidenceStore.js';
import { DocumentReviewStore } from './review-router.js';
import type { DocumentReview } from '../../assessment/ControlAssessor.js';
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
  loadRegistry,
  getEvidenceStorageConfig,
  resolveTenantScope,
  requireTenantScope,
  type TenantScope,
} from '../eo-router-utils.js';

type ResolvedTenant = Extract<TenantScope, { ok: true }>;

/** W0.2b: blob artifacts older than this are not used as assessment sources. */
export const BLOB_MAX_AGE_DAYS = 30;

/**
 * W0.2b (P0 #3): may this downloaded blob artifact become an assessment source?
 * - A NOT_SAT payload (complianceVerdict / verdict) is never a positive source.
 * - PH7-EO: a Stamper record run inside a manual gate (metadata.gateContext 'manual_gate') is display only, never a source.
 * - A blob that names a tenant (tenantId / tenant_id / tenantSlug / tenant) must name this one.
 *   The blob account itself is the assessed tenant's own (FX-EO7); EO's capture paths carry no
 *   tenant segment, so the content field is the only per-blob tenant marker.
 * - Its capture time (capturedAt / collected_at, or metadata.timestamp on a Stamper upload) must parse and be within BLOB_MAX_AGE_DAYS.
 */
export function blobInScope(
  parsed: Record<string, any>,
  tenant: { slug: string; tenantId?: string },
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; reason: 'not_sat' | 'manual_gate' | 'foreign_tenant' | 'stale' } {
  const verdict = parsed.complianceVerdict ?? parsed.verdict;
  if (verdict === 'NOT_SAT') return { ok: false, reason: 'not_sat' };
  if (gateContextOf(parsed) === 'manual_gate') return { ok: false, reason: 'manual_gate' };
  const named = parsed.tenantId ?? parsed.tenant_id ?? parsed.tenantSlug ?? parsed.tenant;
  if (typeof named === 'string' && named !== '' && named !== tenant.slug && named !== tenant.tenantId) {
    return { ok: false, reason: 'foreign_tenant' };
  }
  const captured = Date.parse(String(parsed.capturedAt ?? parsed.collected_at ?? parsed.metadata?.timestamp ?? ''));
  if (!Number.isFinite(captured) || nowMs - captured > BLOB_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: 'stale' };
  }
  return { ok: true };
}

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

    // W7-EO (V68): the stream always ends with a terminal event (assess_done or assess_error); a write that
    // fails (the client is gone) is dropped rather than thrown.
    let terminal = false;
    const send = (data: object): void => {
      const type = (data as { type?: string }).type;
      if (type === 'assess_done' || type === 'assess_error') terminal = true;
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write('data: ' + JSON.stringify(data) + '\n\n');
      } catch (err) {
        console.warn('[assess] SSE write failed:', (err as Error).message);
      }
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

      // Phase 1.5 (FLOW-4): Stamper evidence from EO's hash chain. Collector C11 first appends the
      // tenant's Stamper evidence files and stamper_evidence_metadata rows to the evidence store; the
      // assessment then reads the items of that run's index from the store, not Stamper's files.
      const evidenceLoader = new StamperEvidenceLoader(tenantSlug);
      const stamperCollect = await runCollectors({
        storageRoot: config.storageRoot,
        tenantId: tc.tenantId,
        tenantSlug,
        reader: NO_COLLECTOR_READER,
        identity: await resolveCollectorIdentity(null, (tc as any)?.appId),
        collectors: [stamperEvidenceCollector],
      });
      const chained = stamperCollect.errors.length
        ? { evidence: [], indexRecordId: null, missing: [], error: stamperCollect.errors.map((e) => e.error).join('; ') }
        : stamperEvidenceFromChain(EvidenceStore.forStorageRoot(config.storageRoot, tc.tenantId), stamperCollect.results[0]);
      if (chained.error || chained.missing.length) {
        console.warn(`[assess] FLOW-4 Stamper evidence chain: ${chained.error ?? `${chained.missing.length} file(s) not in the chain`}`);
      }
      console.log(`[EoServer] FLOW-4 C11: ${stamperCollect.recorded} record(s) appended; index ${chained.indexRecordId ?? 'none'}; ${chained.evidence.length} evidence item(s) read from the chain`);
      const stamperEvidence = chained.evidence;
      const stamperEvidenceSources = evidenceLoader.toAssessmentSources(stamperEvidence);
      const directiveMetadataMap = evidenceLoader.toDirectiveMetadataMap(stamperEvidence);
      send({
        type: 'assess_import',
        filesFound: stamperEvidence.length,
        directiveMetadataCount: directiveMetadataMap.size,
        directory: `stamper://plan-data/${tenantSlug}/evidence`,
        chain: {
          source: stamperEvidenceCollector.sourceId,
          notInChain: chained.missing.length,
          ...(chained.error ? { error: chained.error } : {}),
        },
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

      // Phase 1.65 (FX-12): Stamper's execution-results manifest for this tenant. A control whose
      // Stamper task failed or was blocked is judged not_met (ControlAssessor.determineStatus),
      // so it shows in the SSP entry and feeds the POA&M instead of a seeded-state "met".
      try {
        const execResults = loadLatestExecutionResults(tenantSlug);
        if (execResults) {
          const execSources = executionResultsToSources(execResults.manifest);
          for (const [controlId, sources] of execSources) {
            const existing = stamperEvidenceSources.get(controlId) || [];
            existing.push(...sources);
            stamperEvidenceSources.set(controlId, existing);
          }
          const failing = [...execSources.values()].filter(list => list.some(isStamperExecutionFailure)).length;
          send({
            type: 'assess_stamper_results',
            runId: execResults.manifest.runId,
            completedAt: execResults.manifest.completedAt,
            controls: execSources.size,
            failedOrBlocked: failing,
            invalidManifests: execResults.invalidFiles.length,
          });
        } else {
          send({ type: 'assess_stamper_results', controls: 0, directory: `stamper://plan-data/${tenantSlug}/state` });
        }
      } catch (err) {
        console.warn('[assess] Stamper execution-results read error:', (err as Error).message);
        send({ type: 'assess_stamper_results_error', error: (err as Error).message });
      }

      // Phase 1.7: EC evidence items (manual uploads / attestations, M4a). Read-only and
      // verdict-neutral. An unset secret yields []. R-F1 (2026-10-31): with EC configured, an unreadable
      // item list FAILS the assessment (assess_error, no snapshot saved) instead of scoring without the
      // uploads and removing the stored organisation records below.
      let ecItems: import('ces-shared/types/evidence-collector').EcEvidenceItem[] = [];
      const { EcEvidenceReader, EcUnavailableError } = await import('../../evidence/EcEvidenceReader.js');
      try {
        const ecReader = new EcEvidenceReader({ ecUrl: config.ecUrl, secret: config.evidenceOpsSecret });
        ecItems = await ecReader.readItemsOrThrow(tenantSlug);
        send({ type: 'assess_ec_items', count: ecItems.length });
        // W5 cycle 7: the organisation's uploaded personnel records (screening, lifecycle) become the personnel
        // store's readiness source for PS.L2-3.9.1 / 3.9.2; none uploaded -> the stored set is removed.
        // The records come from the item list just read, so they never see a different (empty) list.
        const { readOrganisationRecords } = await import('../../ssp/OrganisationRecords.js');
        const listed = ecItems;
        const orgRecords = await readOrganisationRecords(
          { readItems: async () => listed, readItemContent: (slug, itemId) => ecReader.readItemContent(slug, itemId) },
          tenantSlug,
        );
        const stored = personnelStore.saveOrganisationRecords(tenantSlug, orgRecords);
        // NS-3b: the organisation's training records become the tenant's customer-scoped training catalog
        // (their own courses, by name); none uploaded -> the stored catalog is removed.
        const { catalogFromOrganisationRecords } = await import('../../personnel/OrganisationTraining.js');
        const orgCatalog = catalogFromOrganisationRecords(orgRecords);
        trainingStore.saveOrganisationCatalog(tenantSlug, orgCatalog);
        send({ type: 'assess_personnel_records', screening: stored?.screening.length ?? 0, lifecycle: stored?.lifecycle.length ?? 0, training_courses: orgCatalog?.courses.length ?? 0 });
      } catch (err) {
        console.warn('[assess] EC evidence read error:', (err as Error).message);
        send({ type: 'assess_ec_items_error', error: (err as Error).message });
        if (err instanceof EcUnavailableError) throw err;
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
          const skippedOutOfScope = { not_sat: 0, manual_gate: 0, foreign_tenant: 0, stale: 0 };
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

              // W0.2b: only this tenant's, in-age, non-NOT_SAT blobs become sources.
              const scoped = blobInScope(parsed, { slug: tenantSlug, tenantId: tenantConfigRaw.tenant?.tenant_id });
              if (!scoped.ok) { skippedOutOfScope[scoped.reason]++; continue; }

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
          if (skippedOutOfScope.not_sat + skippedOutOfScope.manual_gate + skippedOutOfScope.foreign_tenant + skippedOutOfScope.stale > 0) {
            console.log(`[EoServer] W0.2b: skipped blobs not usable as sources: ${JSON.stringify(skippedOutOfScope)}`);
          }

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

          // EO-collection W2 (E7 hook): the registered collectors run first, once per assessment
          // pass, appending their rows to the store; their windowed views join the fetched signals.
          const collector = await resolveCollectorIdentity(sessionManager, (tc as any)?.appId);
          const collected = await runCollectors({
            storageRoot: config.storageRoot,
            tenantId: tc.tenantId,
            tenantSlug,
            reader: fetcher,
            identity: collector,
          });
          const collectSummary = summarizeCollectRun(collected);
          send({ type: 'collect', ...collectSummary });
          console.log(`[EoServer] W2 collect: ${collected.recorded} record(s); ` +
            collectSummary.collectors.map((c) => `${c.planId} ${c.status} +${c.newItems}`).join(', ') +
            (collected.errors.length ? `; errors: ${JSON.stringify(collected.errors.slice(0, 3))}` : ''));

          const fetchedSignals = await fetcher.fetchAllSignals();
          const allSignals = [...fetchedSignals, ...collected.signals];
          send({ type: 'signal_fetch', signalCount: allSignals.length });

          // Run evaluators to map signals to control assessments
          // G4: registry + evaluator set are selected by the active stack provider (Microsoft default).
          // G13: resolve the registry path via registryResolver (supports Microsoft + Google; unknown → undefined).
          const stack = getActiveStackProvider(tc).capabilities;
          const mapper = new SignalToControlMapper(resolveControlSignalRegistryPath(stack.controlSignalRegistryId), stack.controlSignalRegistryId);
          // W5 cycle 1 addendum: the TM's expected values and account lists reach the evaluators.
          const signalControlAssessments = mapper.mapSignalsToControls(allSignals, selectEvaluatorRegistry(stack.evaluatorSetId),
            { tenantManifest: loadOptionalJson(config.tenantManifestPath), tenantId: tc.tenantId });

          signalAssessments = new Map<string, ControlAssessment>();
          for (const sa of signalControlAssessments) {
            signalAssessments.set(sa.control_id, sa);
          }

          send({ type: 'signal_eval_done', controlsEvaluated: signalAssessments.size });

          // EO-collection W1.4: every read of this fetch goes into the tenant's evidence store once,
          // whatever its status, in fetch order (one sequential loop, not per control). The
          // collectors' views are not reads; their rows were recorded by the collectors above.
          const stored = recordFetchedSignals(fetchedSignals, signalControlAssessments, {
            storageRoot: config.storageRoot,
            tenantId: tc.tenantId,
            tenantSlug,
            collector,
            describe: (s) => fetcher.describeRead(s),
          });
          console.log(`[EoServer] W1.4: ${stored.recorded} read(s) recorded in the evidence store` +
            (stored.errors.length ? `; ${stored.errors.length} not recorded: ${JSON.stringify(stored.errors.slice(0, 3))}` : ''));

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

      // NS-1b (GD-b): the tenant's WORM document reviews (eo_document_reviews, written by review-router.ts),
      // scoped as review-router records them. merge reads each matching EC item's uploadedBy (ecItems above)
      // for the non-uploader rule. A read error counts no review (logged).
      let documentReviews: DocumentReview[] = [];
      const tenantGuid = tenantConfigRaw.tenant?.tenant_id;
      if (typeof tenantGuid === 'string' && tenantGuid.trim() !== '') {
        try {
          documentReviews = new DocumentReviewStore().list({ slug: tenantSlug, tenantId: tenantGuid });
        } catch (err) {
          console.warn('[assess] NS-1b document reviews read error (no review counted):', (err as Error).message);
        }
      }
      console.log(`[EoServer] NS-1b: ${documentReviews.length} document review(s) passed to merge`);

      // FIN-27 (FD-4): EO's own records decide CA.L2-3.12.1 / 3.12.3; read before this snapshot is saved.
      // The same prior-snapshot list is the drift baseline below (one read of ces.db, not two).
      const caTenantId = tenantConfigRaw.tenant?.tenant_id ?? tenantSlug;
      let priorSnapshots: ReturnType<typeof assessmentStore.listFullSnapshotsForTenant> = [];
      let caSelfRecords: CaSelfRecords | undefined;
      try {
        priorSnapshots = assessmentStore.listFullSnapshotsForTenant(caTenantId);
        const ledger = poamLedgerStore.loadLatest(tenantSlug);
        caSelfRecords = {
          assessments: priorSnapshots
            .map(s => ({ snapshotId: s.snapshotId, generatedAt: s.generatedAt, forced: s.metadata?.forced === true })),
          poamLedger: ledger ? { poamId: ledger.poamId, generatedAt: ledger.generatedAt } : null,
        };
      } catch (err) {
        console.warn('[assess] FIN-27 CA self-records read error (CA.L2-3.12.1/3 not credited):', (err as Error).message);
      }

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
        ecItems,
        undefined,
        documentReviews,
        caSelfRecords
      );

      // NS-3b (founder D-2): the personnel and training stores set the PS / AT control status they decide,
      // under the determination ledger's precedence (disposition, tenant-suite probe, then the store), so the
      // snapshot, SPRS, SSP and POA&M carry the same status as the ledger. Read error: snapshot left as merged.
      try {
        const storeScope: ResolvedTenant = { ok: true, slug: tenantSlug, tenantId: snapshot.tenantId, tenantJsonPath };
        const storeDeps = { assessmentStore, personnelStore, screeningElementStore, trainingStore, storageRoot: config.storageRoot };
        const storeLedger = assembleTenantLedger(storeDeps, storeScope, snapshot);
        if (storeLedger) {
          const moved = applyStoreControlStatus(snapshot, storeLedger, storeControlStatus(storeDeps, tenantSlug));
          console.log(`[EoServer] NS-3b: store-decided status moved ${moved.length} control(s)${moved.length ? `: ${moved.map(m => `${m.controlId} ${m.from} -> ${m.to}`).join(', ')}` : ''}`);
        }
      } catch (err) {
        console.warn('[assess] NS-3b store status not applied:', (err as Error).message);
      }

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

          // RF-25 (R14): render-status write-back goes under the pipeline root, where
          // StamperEvidenceLoader read the evidence, never into the ces-stamper repo tree.
          const renderOrchestrator = new RenderOrchestrator(getCesModuleRoot('Stamper'), tenantSlug);
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

      // EO-collection W3: the drift baseline = the tenant's newest stored snapshot that is not forced
      // (read before this one is saved). `forced=1` marks the harness's forced-failure assess (E8F).
      const forced = req.query.forced === '1';
      const previousSnapshot = pickBaseline(snapshot.tenantId === caTenantId ? priorSnapshots : assessmentStore.listFullSnapshotsForTenant(snapshot.tenantId));
      assessmentStore.save(snapshot, { forced });

      // Auto-generate POA&M for NOT MET controls
      try {
        const poamControlsRefPath = resolveDataPath('cmmc-l2-controls.reference.json');
        const weightsPath = resolveDataPath('sprs-weights.json');

        const poamRegistries = [loadRegistry(config.registryPath)];
        if (config.infraRegistryPath) poamRegistries.push(loadRegistry(config.infraRegistryPath));

        const generator = new PoamGenerator(poamControlsRefPath, weightsPath, poamRegistries);
        // W2.4: the MP gives each item its owner role and milestone date (was 'TBD' / no date).
        const poam = generator.generate({ assessment: snapshot, missionPlan: loadOptionalJson(config.missionPlanPath) });
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

      // EO-collection W3: the determination ledger on this snapshot feeds drift (objectives) and the
      // automatic POA&M reconcile. Built exactly as /api/ledger builds it.
      const w3Scope: ResolvedTenant = { ok: true, slug: tenantSlug, tenantId: snapshot.tenantId, tenantJsonPath };
      const w3Deps = { assessmentStore, personnelStore, screeningElementStore, trainingStore, storageRoot: config.storageRoot };
      let w3Ledger: DeterminationLedger | null = null;
      try {
        w3Ledger = assembleTenantLedger(w3Deps, w3Scope, snapshot);
      } catch (err) {
        console.warn('[EoServer] W3 ledger assembly failed:', (err as Error).message);
      }

      // EO-collection W3.2/W3.3: drift against the baseline (previous non-forced snapshot), written beside this
      // snapshot (assessments/<snapshotId>/drift.json); regressions (met -> worse) are alerted here.
      try {
        const previousLedger = previousSnapshot && w3Ledger ? assembleTenantLedger(w3Deps, w3Scope, previousSnapshot) : null;
        const drift = detectDrift({ previous: previousSnapshot, current: snapshot, previousLedger, currentLedger: w3Ledger });
        writeDrift(config.storageRoot, drift);
        send({ type: 'drift', ...summarizeDrift(drift) });
        const sm = drift.summary;
        console.log(`[EoServer] W3 drift vs ${drift.previousSnapshotId ?? 'none (baseline)'}: ` +
          `${sm.regressions} regression(s), ${sm.improvements} improvement(s), ${sm.declines} decline(s), ${sm.tierOrSourceOnly} tier/source-only; ` +
          `objectives ${sm.objectiveRegressions}/${sm.objectiveImprovements}/${sm.objectiveDeclines}/${sm.objectiveSourceOnly}`);
        for (const r of drift.regressions) {
          console.warn(`[EoServer] W3 REGRESSION ${r.controlId}: ${r.previous.status} (Tier ${r.previous.tier ?? '-'} ${r.previous.source ?? '-'}) -> ` +
            `${r.current.status} (Tier ${r.current.tier ?? '-'} ${r.current.source ?? '-'})`);
        }
      } catch (err) {
        send({ type: 'drift_error', error: (err as Error).message });
      }

      // EO-collection W3.5: automatic POA&M reconcile after every assess (the on-demand
      // /api/poam/reconcile route stays): new deficiencies open, remediated ones auto-close, history kept.
      if (w3Ledger) {
        try {
          const reconciled = reconcilePoamLifecycle(poamLedgerStore.loadLatest(tenantSlug), w3Ledger.deficiencies, snapshot.generatedAt, uuidv4(), w3Ledger.tenantId);
          poamLedgerStore.save(tenantSlug, reconciled);
          send({ type: 'poam_reconciled', poamId: reconciled.poamId, summary: reconciled.summary });
        } catch (err) {
          send({ type: 'poam_reconcile_failed', error: (err as Error).message });
        }
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
    } finally {
      if (!terminal && !closed) send({ type: 'assess_error', error: 'assessment ended without a terminal event' });
      if (!res.writableEnded) res.end();
    }
  });

  // GET /api/assessment?tenant= — the REQUESTED tenant's latest snapshot (FX-EO8; was the
  // storage's last-saved tenant, whoever that was).
  // POST /api/collect?tenant= — EO-collection W2.0: run the registered collectors for the
  // requested tenant once, on that tenant's own bound session (never another tenant's), and answer
  // with counts per collector (no rows). The same run the /api/assess hook makes before each pass.
  router.post('/api/collect', async (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    try {
      const tc = loadTenantConfig(scope.tenantJsonPath);
      const candidate = getSessionManager(scope.slug);
      const sessionManager = isSessionBoundTo(candidate, scope.slug, tc.tenantId) ? candidate : null;
      if (sessionManager === null) {
        sendError(res, 409, `No live session for tenant '${scope.slug}'`);
        return;
      }
      await sessionManager.ensureConnected('graph');
      const fetcher = new ComplianceSignalFetcher(sessionManager, new PowerShellFallbackAdapter(tc));
      const identity = await resolveCollectorIdentity(sessionManager, (tc as any)?.appId);
      const run = await runCollectors({
        storageRoot: config.storageRoot,
        tenantId: tc.tenantId,
        tenantSlug: scope.slug,
        reader: fetcher,
        identity,
      });
      res.json(summarizeCollectRun(run));
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/drift?tenant=[&snapshotId=] — EO-collection W3: the drift record of the tenant's latest
  // snapshot (or of the named snapshot, only if it is this tenant's). 404 when there is none.
  router.get('/api/drift', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const requested = typeof req.query.snapshotId === 'string' ? req.query.snapshotId.trim() : '';
    const snap = requested ? assessmentStore.loadForTenant(scope.tenantId, requested) : assessmentStore.loadLatestForTenant(scope.tenantId);
    if (!snap) {
      sendError(res, 404, requested ? `Snapshot not found for tenant ${scope.slug}` : `No assessment available for tenant ${scope.slug}. Run /api/assess first.`);
      return;
    }
    const drift = readDrift(config.storageRoot, snap.snapshotId, scope.tenantId);
    if (!drift) {
      sendError(res, 404, `No drift record for snapshot ${snap.snapshotId}`);
      return;
    }
    res.json(drift);
  });

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
  // Assemble the unified determination ledger (W2.4: moved to ../ledgerAssembly.ts, shared with
  // the SSP route). /api/ledger and /api/poam/reconcile both project from it.
  // FX-EO8: built from the REQUESTED tenant's own latest snapshot (scope = resolved ?tenant=).
  const assembleLedger = (scope: ResolvedTenant): DeterminationLedger | null =>
    assembleTenantLedger({ assessmentStore, personnelStore, screeningElementStore, trainingStore, storageRoot: config.storageRoot, missionPlanPath: config.missionPlanPath }, scope);

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
    // FIN-14 (V76): reader entries, so each row carries AO's objective ids into the view.
    let adminOps: ReturnType<AdminOpsEvidenceReader['read']>['entries'] | null = null;
    try { adminOps = new AdminOpsEvidenceReader(scope.tenantId).read().entries; } catch { adminOps = null; }
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
