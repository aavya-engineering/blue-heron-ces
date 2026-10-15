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
import type { EoConfig } from '../../config/EoConfig.js';
import { AssessmentStore } from '../../assessment/AssessmentStore.js';
import { PersonnelStore } from '../../personnel/PersonnelStore.js';
import { RiskAssessmentStore } from '../../risk-assessment/RiskAssessmentStore.js';
import { PolicyStore } from '../../policies/PolicyStore.js';
import { PoamStore } from '../../poam/PoamStore.js';
import { SessionManager } from '../../core/SessionManager.js';
import { isSessionBoundTo, type SignalCaptureResult } from '../signalCapture.js';
import { downloadBlob, listBlobs, type EvidenceStorageConfig } from 'ces-shared/blob';
import { StamperEvidenceLoader } from '../../evidence/StamperEvidenceLoader.js';
import { getStamperTenantRoot } from 'ces-shared/storage/node';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { EvidencePackager } from '../../packager/EvidencePackager.js';
import { SprsCalculator } from '../../sprs/SprsCalculator.js';
import { SspDocxExporter } from '../../ssp/SspDocxExporter.js';
import { SspQualityScorecard } from '../../ssp/SspQualityScorecard.js';
import { PoamDocxExporter } from '../../poam/PoamDocxExporter.js';
import { PowerShellFallbackAdapter } from '../../ingestion/PowerShellFallbackAdapter.js';
import { ComplianceSignalFetcher } from '../../ingestion/ComplianceSignalFetcher.js';
import type { SignalResult } from 'ces-shared/types/signal';
import { loadTenantConfig } from 'ces-shared/config';
import {
  sendError,
  validateUuid,
  getEvidenceStorageConfig,
  resolveDataPath,
  resolveTenantScope,
  requireTenantScope,
} from '../eo-router-utils.js';
import { AdminOpsEvidenceReader } from '../../adminops/AdminOpsEvidenceReader.js';
import { EcEvidenceReader } from '../../evidence/EcEvidenceReader.js';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import {
  toExplorerItem,
  toExecutionView,
  parseAdminOpsItemPath,
} from '../../adminops/adminopsViews.js';
import type { AdminOpsEvidence } from 'ces-shared/types/adminops-evidence';
import { sspLatestPath } from '../../ssp/sspLatest.js';

export interface EvidenceRouterDeps {
  config: EoConfig;
  stamperRoot: string;
  assessmentStore: AssessmentStore;
  personnelStore: PersonnelStore;
  riskAssessmentStore: RiskAssessmentStore;
  policyStore: PolicyStore;
  poamStore: PoamStore;
  /** FX2-EO1: the session opened for THIS tenant slug, or null — never another tenant's. */
  getSessionManager: (tenantSlug: string) => SessionManager | null;
  captureSignals: (
    slug: string,
    sessionManager: SessionManager | null,
    evidenceStorage: EvidenceStorageConfig | null,
    config: EoConfig,
    stamperRoot: string,
  ) => Promise<SignalCaptureResult>;
  getLastCaptureRun: () => {
    timestamp: string;
    capturedCount: number;
    errors: Array<{ controlId: string; error: string }>;
  } | null;
}

export function createEvidenceRouter(deps: EvidenceRouterDeps): express.Router {
  const {
    config, stamperRoot, assessmentStore, personnelStore, riskAssessmentStore,
    policyStore, poamStore, getSessionManager, captureSignals, getLastCaptureRun,
  } = deps;

  const router = express.Router();

  // FX-EO8: packages live per tenant (packages/<slug>/). The slug has already passed
  // resolveTenantScope's SLUG_RE and names an existing tenant, so it is safe to join.
  // Zips built before FX-EO8 in the flat packages/ root are no longer listed or served.
  const packagesRoot = path.join(config.storageRoot, 'packages');
  const packagesDirFor = (slug: string): string => {
    const dir = path.join(packagesRoot, slug);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  // ── Evidence Browser Endpoints (blob-backed) ──

  // GET /api/evidence/artifacts — list artifacts from blob storage
  router.get('/api/evidence/artifacts', async (req: Request, res: Response) => {
    // FX-EO7: the blob browser reads the REQUESTED tenant's storage only.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    try {
      const evidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);
      if (!evidenceStorage) {
        res.json([]);
        return;
      }

      const controlId = req.query.controlId as string | undefined;
      const runId = req.query.runId as string | undefined;
      const family = req.query.family as string | undefined;

      const prefix = runId ? `artifacts/${runId}/` : 'artifacts/';
      const blobEntries = await listBlobs(evidenceStorage, prefix);

      const artifacts: unknown[] = [];
      for (const entry of blobEntries) {
        if (!entry.name.endsWith('.json')) continue;
        try {
          const content = await downloadBlob(evidenceStorage, entry.name);
          if (!content) continue;
          const raw = JSON.parse(content);
          if (controlId && !(raw.controlIds ?? []).includes(controlId)) continue;
          if (family && !(raw.controlIds ?? []).some((c: string) => c.startsWith(family + '.'))) continue;
          artifacts.push({
            artifactId: raw.artifactId,
            runId: raw.runId,
            capturedAt: raw.capturedAt,
            source: raw.source,
            checkId: raw.checkId,
            controlIds: raw.controlIds,
            sha256: raw.sha256,
          });
        } catch { /* skip */ }
      }

      artifacts.sort((a, b) => {
        const bTime = (b as Record<string, unknown>).capturedAt as string ?? '';
        const aTime = (a as Record<string, unknown>).capturedAt as string ?? '';
        return bTime.localeCompare(aTime);
      });
      res.json(artifacts);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/evidence/artifacts/:runId/:artifactId — single artifact detail
  router.get('/api/evidence/artifacts/:runId/:artifactId', async (req: Request, res: Response) => {
    if (!validateUuid(req.params.runId) || !validateUuid(req.params.artifactId)) {
      sendError(res, 400, 'Invalid UUID format for runId or artifactId');
      return;
    }
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO7
    if (!scope) return;

    const evidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);
    if (!evidenceStorage) {
      sendError(res, 404, 'Evidence storage not configured');
      return;
    }
    const blobPath = `artifacts/${req.params.runId}/${req.params.artifactId}.json`;
    const content = await downloadBlob(evidenceStorage, blobPath);
    if (!content) {
      sendError(res, 404, 'Artifact not found');
      return;
    }
    res.json(JSON.parse(content));
  });

  // GET /api/evidence/verify/:runId/:artifactId — recompute + verify hash
  router.get('/api/evidence/verify/:runId/:artifactId', async (req: Request, res: Response) => {
    if (!validateUuid(req.params.runId) || !validateUuid(req.params.artifactId)) {
      sendError(res, 400, 'Invalid UUID format for runId or artifactId');
      return;
    }
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO7
    if (!scope) return;

    const evidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);
    if (!evidenceStorage) {
      sendError(res, 404, 'Evidence storage not configured');
      return;
    }
    const blobPath = `artifacts/${req.params.runId}/${req.params.artifactId}.json`;
    const content = await downloadBlob(evidenceStorage, blobPath);
    if (!content) {
      sendError(res, 404, 'Artifact not found');
      return;
    }
    const artifact = JSON.parse(content);
    const recomputed = createHash('sha256').update(JSON.stringify(artifact.rawValue), 'utf-8').digest('hex');
    res.json({
      stored: artifact.sha256,
      recomputed,
      match: artifact.sha256 === recomputed,
    });
  });

  // GET /api/evidence/manifests — list manifests from blob storage
  router.get('/api/evidence/manifests', async (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO7
    if (!scope) return;
    const evidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);
    if (!evidenceStorage) {
      res.json([]);
      return;
    }
    const blobEntries = await listBlobs(evidenceStorage, 'manifests/');
    const manifests: unknown[] = [];
    for (const entry of blobEntries) {
      if (!entry.name.endsWith('.manifest.json')) continue;
      try {
        const content = await downloadBlob(evidenceStorage, entry.name);
        if (!content) continue;
        const raw = JSON.parse(content);
        manifests.push({ runId: raw.runId, tenantId: raw.tenantId, generatedAt: raw.generatedAt, artifactCount: raw.artifactCount });
      } catch { /* skip */ }
    }
    res.json(manifests);
  });

  // ── Evidence Explorer Endpoints ──

  // GET /api/evidence-explorer/index — aggregate evidence from all sources
  router.get('/api/evidence-explorer/index', async (req: Request, res: Response) => {
    // FX-EO1: every read is scoped to the REQUESTED tenant; no default-tenant fallback.
    const scope = resolveTenantScope(req.query.tenant, stamperRoot);
    if (!scope.ok) { sendError(res, scope.status, scope.message); return; }
    const slug = scope.slug;

    const items: Array<{
      id: string; source: string; title: string; family?: string;
      controlIds: string[]; timestamp: string; verdict?: string;
      path?: string; requiresConnection: boolean;
    }> = [];

    // 1. Stamper evidence (always local)
    try {
      const loader = new StamperEvidenceLoader(slug);
      const evidence = loader.loadEvidenceForTenant();
      for (const ev of evidence) {
        items.push({
          id: 'stamper:' + ev.entryId,
          source: 'stamper',
          title: ev.label,
          family: ev.controlIds[0]?.split('.')[0]?.replace(/L\d+-/, ''),
          controlIds: ev.controlIds,
          timestamp: ev.timestamp,
          verdict: ev.complianceVerdict || undefined,
          path: ev.evidenceFilePath || ev.entryId,
          requiresConnection: false,
        });
      }
    } catch (err) {
      console.warn('[evidence-explorer] Stamper load error:', (err as Error).message);
    }

    // 2. Blob artifacts (requires evidenceStorage)
    const evidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);
    if (evidenceStorage) {
      try {
        const allBlobEntries = await listBlobs(evidenceStorage, '');
        let timestampParseFailures = 0;
        for (const entry of allBlobEntries) {
          if (entry.name.startsWith('manifests/')) continue;

          const fileName = entry.name.split('/').pop() || entry.name;
          let title = fileName.replace(/\.\w+$/, '');
          let controlIds: string[] = [];
          let timestamp = '';

          const controlMatch = fileName.match(/^([a-z]{2})\.l2-([\d.]+)\./i);
          if (controlMatch) {
            const fullId = `${controlMatch[1].toUpperCase()}.L2-${controlMatch[2]}`;
            controlIds = [fullId];
            title = fullId + ' — ' + fileName.replace(/\.\w+$/, '').replace(/^[^.]+\.l2-[\d.]+\./, '');
          } else {
            const parts = entry.name.split('/');
            if (parts.length >= 2 && parts[0] === 'evidence') {
              const legacyControlId = parts[1];
              if (legacyControlId && /^[A-Z]{2}\.L2-/.test(legacyControlId)) {
                controlIds = [legacyControlId];
                title = legacyControlId + ' — ' + title;
              }
            }
          }

          const tsMatch = fileName.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
          if (tsMatch) {
            timestamp = tsMatch[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
          } else {
            timestampParseFailures++;
          }

          items.push({
            id: 'blob:' + entry.name,
            source: 'blob',
            title,
            family: controlIds[0]?.split('.')[0],
            controlIds,
            timestamp,
            path: entry.name,
            requiresConnection: true,
          });
        }
        if (timestampParseFailures > 0) {
          console.warn(`[evidence-explorer] ${timestampParseFailures} blob(s) had unparseable timestamps`);
        }
      } catch (err) {
        console.warn('[evidence-explorer] Blob list error:', (err as Error).message);
      }
    }

    // 3. Local assessment (always available)
    try {
      const snapshot = assessmentStore.loadLatestForTenant(scope.tenantId);
      if (snapshot) {
        for (const ctrl of snapshot.controls) {
          items.push({
            id: 'assessment:' + ctrl.control_id,
            source: 'local',
            title: ctrl.control_id + ' — ' + ctrl.status,
            family: ctrl.control_id.split('.')[0],
            controlIds: [ctrl.control_id],
            timestamp: snapshot.generatedAt,
            verdict: ctrl.status === 'met' ? 'SAT' : ctrl.status === 'not_met' ? 'NOT_SAT' : undefined,
            path: ctrl.control_id,
            requiresConnection: false,
          });
        }
      }
    } catch (err) {
      console.warn('[evidence-explorer] Assessment load error:', (err as Error).message);
    }

    // 4. Local stores: personnel, risk register
    try {
      const personnel = personnelStore.load(slug);
      for (const p of personnel) {
        items.push({
          id: 'personnel:' + p.id,
          source: 'local',
          title: 'Personnel: ' + p.displayName,
          family: 'PS',
          controlIds: ['PS.L2-3.9.1', 'PS.L2-3.9.2'],
          timestamp: p.createdDate || '',
          path: 'personnel/' + p.id,
          requiresConnection: false,
        });
      }
    } catch { /* skip */ }

    try {
      const register = riskAssessmentStore.loadRegister(slug);
      if (register && register.entries.length > 0) {
        items.push({
          id: 'risk:register',
          source: 'local',
          title: 'Risk Register (' + register.entries.length + ' entries)',
          family: 'RA',
          controlIds: ['RA.L2-3.11.1', 'RA.L2-3.11.2'],
          timestamp: register.lastUpdated || '',
          path: 'risk-register',
          requiresConnection: false,
        });
      }
    } catch { /* skip */ }

    // 5. Signal catalog (static list, requiresConnection=true)
    const signalCatalog = [
      { id: 'signal:identitySignals', title: 'Identity Signals (CA, Auth Methods, Roles)', controlIds: ['AC.L2-3.1.1', 'IA.L2-3.5.3'] },
      { id: 'signal:deviceSignals', title: 'Device Signals (Compliance, Managed Devices)', controlIds: ['CM.L2-3.4.1', 'CM.L2-3.4.2'] },
      { id: 'signal:securitySignals', title: 'Security Signals (Secure Score, Alerts)', controlIds: ['RA.L2-3.11.2', 'SI.L2-3.14.6'] },
      { id: 'signal:dlpSignals', title: 'DLP / Sensitivity Labels', controlIds: ['MP.L2-3.8.1', 'MP.L2-3.8.2'] },
      { id: 'signal:groupMembership', title: 'Group Membership (CUI-Authorized-Users)', controlIds: ['AC.L2-3.1.1'] },
      { id: 'signal:namedLocations', title: 'Named Locations', controlIds: ['AC.L2-3.1.12'] },
      { id: 'signal:deviceConfigurations', title: 'Device Configurations (Intune)', controlIds: ['CM.L2-3.4.6'] },
      { id: 'signal:authStrengthPolicies', title: 'Authentication Strength Policies', controlIds: ['IA.L2-3.5.3'] },
      { id: 'signal:agreements', title: 'Terms of Use Agreements', controlIds: ['AT.L2-3.2.1'] },
      { id: 'signal:vulnerabilities', title: 'Vulnerabilities (Threat Intelligence)', controlIds: ['RA.L2-3.11.2'] },
      { id: 'signal:exchangeConfig', title: 'Exchange Online Config', controlIds: ['SC.L2-3.13.8'] },
      { id: 'signal:purviewConfig', title: 'Purview / Compliance Config', controlIds: ['AU.L2-3.3.1'] },
    ];
    for (const sig of signalCatalog) {
      items.push({
        ...sig,
        source: 'signal',
        family: sig.controlIds[0]?.split('.')[0],
        timestamp: '',
        path: sig.id.replace('signal:', ''),
        requiresConnection: true,
      });
    }

    // 6. AdminOps evidence from ces.db (AE-R5), scoped to the requested tenant's GUID (FX-EO1)
    try {
      const aoResult = new AdminOpsEvidenceReader(scope.tenantId).read();
      for (const entry of aoResult.entries) items.push(toExplorerItem(entry));
    } catch (err) {
      console.warn('[evidence-explorer] AdminOps load error:', (err as Error).message);
    }

    // FX2-EO1: THIS tenant's connection state, not "some tenant is connected".
    res.json({ items, connectionState: isSessionBoundTo(getSessionManager(scope.slug), scope.slug, scope.tenantId) ? 'connected' : 'disconnected' });
  });

  // GET /api/evidence-explorer/item — fetch individual item content
  router.get('/api/evidence-explorer/item', async (req: Request, res: Response) => {
    const source = req.query.source as string;
    const itemPath = req.query.path as string;
    if (!source || !itemPath) { sendError(res, 400, 'tenant, source, path required'); return; }
    const scope = resolveTenantScope(req.query.tenant, stamperRoot);
    if (!scope.ok) { sendError(res, scope.status, scope.message); return; }
    const slug = scope.slug;

    try {
      if (source === 'stamper') {
        let fullPath: string;
        if (path.isAbsolute(itemPath) && fs.existsSync(itemPath)) {
          fullPath = itemPath;
        } else {
          const evidenceDir = path.join(getStamperTenantRoot(slug), 'evidence');
          fullPath = path.join(evidenceDir, itemPath);
          if (!fullPath.endsWith('.json')) fullPath += '.json';
          if (!fs.existsSync(fullPath)) {
            const loader = new StamperEvidenceLoader(slug);
            const all = loader.loadEvidenceForTenant();
            const match = all.find(e => e.entryId === itemPath);
            if (match && match.evidenceFilePath) {
              fullPath = match.evidenceFilePath;
            } else {
              sendError(res, 404, 'Evidence file not found'); return;
            }
          }
        }
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw);
        res.json({
          content: parsed,
          metadata: { sha256: parsed.metadata?.sha256Hash, timestamp: parsed.metadata?.timestamp, size: raw.length },
        });
      } else if (source === 'blob') {
        const evidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);
        if (!evidenceStorage) { sendError(res, 503, 'Blob storage not configured'); return; }
        const content = await downloadBlob(evidenceStorage, itemPath);
        if (!content) { sendError(res, 404, 'Blob not found'); return; }
        let parsed: unknown;
        try { parsed = JSON.parse(content); } catch { parsed = content; }
        const meta: Record<string, unknown> = { size: content.length };
        if (typeof parsed === 'object' && parsed !== null) {
          const p = parsed as Record<string, unknown>;
          const pm = p.metadata as Record<string, unknown> | undefined;
          meta.sha256 = p.sha256 || pm?.sha256Hash || undefined;
          meta.timestamp = p.capturedAt || pm?.timestamp || undefined;
        }
        res.json({ content: parsed, metadata: meta });
      } else if (source === 'local') {
        if (itemPath.startsWith('personnel/')) {
          const personnelId = itemPath.replace('personnel/', '');
          const record = personnelStore.get(slug, personnelId);
          res.json({ content: record, metadata: { timestamp: record?.createdDate || '' } });
        } else if (itemPath === 'risk-register') {
          const register = riskAssessmentStore.loadRegister(slug);
          res.json({ content: register, metadata: { timestamp: register.lastUpdated || '' } });
        } else {
          const snapshot = assessmentStore.loadLatestForTenant(scope.tenantId);
          const ctrl = snapshot?.controls.find(c => c.control_id === itemPath);
          res.json({ content: ctrl || null, metadata: { timestamp: snapshot?.generatedAt || '' } });
        }
      } else if (source === 'adminops') {
        // FX-EO2: resolve an AO item by the row id the index returned, within the
        // requested tenant only (a row id from another tenant is simply not found).
        const rowId = parseAdminOpsItemPath(itemPath);
        if (!rowId) { sendError(res, 400, 'Invalid adminops item path'); return; }
        const entry = new AdminOpsEvidenceReader(scope.tenantId).read().entries.find(e => e.rowId === rowId);
        if (!entry) { sendError(res, 404, 'AdminOps evidence row not found'); return; }
        const ev = entry.evidence;
        res.json({
          content: { rowId: entry.rowId, ...ev },
          metadata: { sha256: ev.sha256, timestamp: ev.timestamp },
        });
      } else if (source === 'signal') {
        sendError(res, 400, 'Use POST /api/evidence-explorer/signal for live signal data');
      } else {
        sendError(res, 400, 'Unknown source: ' + source);
      }
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/evidence-explorer/signal — fetch live signal data
  router.post('/api/evidence-explorer/signal', async (req: Request, res: Response) => {
    // FX-EO7: tenant from the body (or ?tenant=), never the server default.
    const scope = requireTenantScope(req, res, stamperRoot, req.body?.tenant ?? req.query.tenant);
    if (!scope) return;
    const signalId = req.body?.signalId as string;
    if (!signalId) { sendError(res, 400, 'tenant and signalId required'); return; }
    // FX2-EO1: only this tenant's own session; 503 means THIS tenant is not connected.
    const sessionManager = getSessionManager(scope.slug);
    if (!isSessionBoundTo(sessionManager, scope.slug, scope.tenantId)) {
      sendError(res, 503, `Not connected to tenant ${scope.slug} — connect first`); return;
    }

    try {
      const tc = loadTenantConfig(scope.tenantJsonPath);
      const psAdapter = new PowerShellFallbackAdapter(tc);
      const fetcher = new ComplianceSignalFetcher(sessionManager, psAdapter);
      const methodMap: Record<string, () => Promise<SignalResult[]>> = {
        identitySignals: () => fetcher.fetchIdentitySignals(),
        deviceSignals: () => fetcher.fetchDeviceSignals(),
        securitySignals: () => fetcher.fetchSecuritySignals(),
        dlpSignals: () => fetcher.fetchDlpSignals(),
        groupMembership: () => fetcher.fetchGroupMembership(),
        namedLocations: () => fetcher.fetchNamedLocations(),
        deviceConfigurations: () => fetcher.fetchDeviceConfigurations(),
        authStrengthPolicies: () => fetcher.fetchAuthStrengthPolicies(),
        agreements: () => fetcher.fetchAgreements(),
        vulnerabilities: () => fetcher.fetchVulnerabilities(),
        exchangeConfig: () => fetcher.fetchExchangeConfig(),
        purviewConfig: () => fetcher.fetchPurviewConfig(),
        // FC-EO-H (2026-09-28): on-demand diagnostic fetch of the six automatic-signal-coverage
        // reads (trainingUserCoverage, directoryUsers, securityIncidents, lifecycleWorkflows,
        // roleAssignmentsAll, managedDevicesAll, tvmAssessmentRecency) — lets an operator (or a
        // live-sim test) confirm a specific coverage signal without a full /api/assess run.
        coverageSignals: () => fetcher.fetchCoverageSignals(),
      };
      const method = methodMap[signalId];
      if (!method) { sendError(res, 400, 'Unknown signalId: ' + signalId); return; }
      const results = await method();
      res.json({ signalResults: results, timestamp: new Date().toISOString() });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // POST /api/evidence-explorer/capture — on-demand signal capture
  router.post('/api/evidence-explorer/capture', async (req: Request, res: Response) => {
    // FX-EO7: capture into the REQUESTED tenant's blob store, never the default tenant's.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;

    const evidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);
    // FX2-EO1: the requested tenant's own session (or none → liveSignals: 'not_connected').
    const result = await captureSignals(scope.slug, getSessionManager(scope.slug), evidenceStorage, config, stamperRoot);

    res.json({
      capturedCount: result.capturedCount,
      errors: result.errors,
      liveSignals: result.liveSignals,
      timestamp: new Date().toISOString(),
    });
  });

  // GET /api/evidence-explorer/capture/status — scheduled capture observability
  router.get('/api/evidence-explorer/capture/status', (_req: Request, res: Response) => {
    const lastCaptureRun = getLastCaptureRun();
    res.json({
      enabled: config.enableScheduledSignalCapture ?? false,
      intervalHours: config.signalCaptureIntervalHours ?? null,
      lastRun: lastCaptureRun?.timestamp ?? null,
      lastCapturedCount: lastCaptureRun?.capturedCount ?? null,
      lastErrors: lastCaptureRun?.errors ?? null,
    });
  });

  // GET /api/evidence-explorer/verify — verify SHA-256 integrity
  router.get('/api/evidence-explorer/verify', async (req: Request, res: Response) => {
    const source = req.query.source as string;
    const itemPath = req.query.path as string;
    if (!source || !itemPath) { sendError(res, 400, 'tenant, source, path required'); return; }
    const scope = resolveTenantScope(req.query.tenant, stamperRoot);
    if (!scope.ok) { sendError(res, scope.status, scope.message); return; }
    const slug = scope.slug;

    try {
      let content = '';
      let expectedHash = '';

      if (source === 'stamper') {
        const evidenceDir = path.join(getStamperTenantRoot(slug), 'evidence');
        let fullPath = path.join(evidenceDir, itemPath);
        if (!fullPath.endsWith('.json')) fullPath += '.json';
        content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(content);
        expectedHash = parsed.metadata?.sha256Hash || '';
      } else if (source === 'blob') {
        const evidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);
        if (!evidenceStorage) { sendError(res, 503, 'No blob storage'); return; }
        content = (await downloadBlob(evidenceStorage, itemPath)) || '';
        const parsed = JSON.parse(content);
        expectedHash = parsed.sha256 || parsed.metadata?.sha256Hash || '';
      } else {
        sendError(res, 400, 'Verify only supports stamper and blob sources'); return;
      }

      const actualHash = createHash('sha256').update(content).digest('hex');
      res.json({ verified: expectedHash === actualHash, expected: expectedHash, actual: actualHash });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // ── Evidence Package Endpoints ──

  // POST /api/package/build — build evidence package .zip
  router.post('/api/package/build', async (req: Request, res: Response) => {
    // FX-EO1: the package is built for the REQUESTED tenant only (body.tenant or ?tenant=).
    const scope = resolveTenantScope(req.body?.tenant ?? req.query.tenant, stamperRoot);
    if (!scope.ok) { sendError(res, scope.status, scope.message); return; }
    const latest = assessmentStore.loadLatestForTenant(scope.tenantId);
    if (!latest) {
      sendError(res, 404, `No assessment available for tenant ${scope.slug}. Run /api/assess first.`);
      return;
    }
    const packagesDir = packagesDirFor(scope.slug);

    let sspDocxTempPath: string | undefined;
    let poamDocxTempPath: string | undefined;

    try {
      const controlsRefPath = resolveDataPath('cmmc-l2-controls.reference.json');
      const packager = new EvidencePackager(controlsRefPath);

      const weightsPath = resolveDataPath('sprs-weights.json');
      const sprsCalc = new SprsCalculator();
      const sprsResult = sprsCalc.calculate(latest.controls);
      const sprsPath = path.join(packagesDir, 'sprs-worksheet.json');
      writeJsonArtifact(sprsPath, { ...sprsResult, tenantId: latest.tenantId, generatedAt: new Date().toISOString() }, { pretty: true });

      // FX-EO6: only the REQUESTED tenant's latest SSP goes into its package.
      const sspLatest = sspLatestPath(config.storageRoot, scope.slug) ?? '';

      if (fs.existsSync(sspLatest)) {
        try {
          const ssp = JSON.parse(fs.readFileSync(sspLatest, 'utf-8'));
          const sspExporter = new SspDocxExporter({ qualityScorecard: new SspQualityScorecard() });
          const sspBuffer = await sspExporter.export(ssp);
          sspDocxTempPath = path.join(packagesDir, `ssp-${createHash('sha256').update(Math.random().toString()).digest('hex').substring(0, 8)}.docx`);
          fs.writeFileSync(sspDocxTempPath, sspBuffer);
        } catch (error) {
          console.error('SSP DOCX generation failed, continuing without it:', error);
          sspDocxTempPath = undefined;
        }
      }

      const poam = poamStore.loadLatest(scope.slug);
      let poamJsonPath: string | undefined;
      if (poam) {
        try {
          poamJsonPath = path.join(packagesDir, `poam-${createHash('sha256').update(Math.random().toString()).digest('hex').substring(0, 8)}.json`);
          writeJsonArtifact(poamJsonPath, poam, { pretty: true });

          const poamExporter = new PoamDocxExporter();
          const poamBuffer = await poamExporter.export(poam);
          poamDocxTempPath = path.join(packagesDir, `poam-${createHash('sha256').update(Math.random().toString()).digest('hex').substring(0, 8)}.docx`);
          fs.writeFileSync(poamDocxTempPath, poamBuffer);
        } catch (error) {
          console.error('POA&M DOCX generation failed, continuing without it:', error);
          poamDocxTempPath = undefined;
        }
      }

      const evidenceStorage = getEvidenceStorageConfig(config, scope.tenantJsonPath);

      const pkgPolicies = policyStore.load(scope.slug);
      const pkgPersonnelRecords = personnelStore.load(scope.slug);

      let pkgAdminOpsRows: AdminOpsEvidence[] = [];
      try {
        pkgAdminOpsRows = new AdminOpsEvidenceReader(scope.tenantId).read().parsed;
      } catch (err) {
        console.warn('[package] AdminOps evidence load error:', (err as Error).message);
      }

      // M4a: EC evidence items (manual uploads/attestations) with fetched bytes for the zip.
      let pkgEcItems: Array<{ item: EcEvidenceItem; content: Buffer }> = [];
      try {
        const ecReader = new EcEvidenceReader({ ecUrl: config.ecUrl, secret: config.evidenceOpsSecret });
        const items = await ecReader.readItems(scope.slug);
        const withContent = await Promise.all(items.map(async item => {
          const content = await ecReader.readItemContent(scope.slug, item.itemId);
          return content ? { item, content: content.buffer } : null;
        }));
        pkgEcItems = withContent.filter((x): x is { item: EcEvidenceItem; content: Buffer } => x !== null);
      } catch (err) {
        console.warn('[package] EC evidence load error:', (err as Error).message);
      }

      const result = await packager.build({
        assessment: latest,
        sspPath: fs.existsSync(sspLatest) ? sspLatest : undefined,
        sprsPath,
        poamPath: poamJsonPath,
        sspDocxPath: sspDocxTempPath,
        poamDocxPath: poamDocxTempPath,
        evidenceStorage: evidenceStorage ?? undefined,
        policies: pkgPolicies,
        personnelRecords: pkgPersonnelRecords,
        adminOpsRows: pkgAdminOpsRows.length > 0 ? pkgAdminOpsRows : undefined,
        ecEvidenceItems: pkgEcItems.length > 0 ? pkgEcItems : undefined,
        outputDir: packagesDir,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg);
    } finally {
      if (sspDocxTempPath && fs.existsSync(sspDocxTempPath)) {
        try {
          fs.unlinkSync(sspDocxTempPath);
        } catch (error) {
          console.error('Failed to clean up SSP DOCX temp file:', error);
        }
      }
      if (poamDocxTempPath && fs.existsSync(poamDocxTempPath)) {
        try {
          fs.unlinkSync(poamDocxTempPath);
        } catch (error) {
          console.error('Failed to clean up POA&M DOCX temp file:', error);
        }
      }
    }
  });

  // GET /api/package/download/:filename — download .zip file
  router.get('/api/package/download/:filename', (req: Request, res: Response) => {
    // FX-EO8: only the requested tenant's own packages can be downloaded.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const packagesDir = packagesDirFor(scope.slug);
    const filename = req.params.filename;

    const filenameRegex = /^[a-zA-Z0-9_-]+\.zip$/;
    if (!filenameRegex.test(filename)) {
      sendError(res, 400, 'Invalid package filename format');
      return;
    }

    if (path.basename(filename) !== filename) {
      sendError(res, 400, 'Invalid filename', 'Filename must not contain path separators');
      return;
    }

    const filePath = path.join(packagesDir, filename);
    if (!fs.existsSync(filePath)) {
      sendError(res, 404, 'Package not found');
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });

  // GET /api/packages — list available packages
  router.get('/api/packages', (req: Request, res: Response) => {
    // FX-EO8: lists the requested tenant's packages only.
    const scope = requireTenantScope(req, res, stamperRoot);
    if (!scope) return;
    const packagesDir = packagesDirFor(scope.slug);
    try {
      const files = fs.readdirSync(packagesDir)
        .filter(f => f.endsWith('.zip'))
        .map(f => {
          const stat = fs.statSync(path.join(packagesDir, f));
          return { filename: f, sizeBytes: stat.size, createdAt: stat.birthtime.toISOString() };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json(files);
    } catch {
      res.json([]);
    }
  });

  // GET /api/adminops/executions — list AdminOps evidence rows for a tenant (AE-R5)
  router.get('/api/adminops/executions', (req: Request, res: Response) => {
    // FX-EO1: scoped to the requested tenant's GUID; missing -> 400, unknown -> 404.
    const scope = resolveTenantScope(req.query.tenant, stamperRoot);
    if (!scope.ok) { sendError(res, scope.status, scope.message); return; }

    try {
      const result = new AdminOpsEvidenceReader(scope.tenantId).read();
      res.json({ tenant: scope.slug, executions: result.entries.map(toExecutionView), stats: result.stats });
    } catch (err) {
      sendError(res, 500, `AdminOps evidence read error: ${(err as Error).message}`);
    }
  });

  return router;
}
