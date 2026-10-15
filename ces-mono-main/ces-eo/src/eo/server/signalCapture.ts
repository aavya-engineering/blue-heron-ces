// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Live signal capture for ONE tenant (on-demand `/api/evidence-explorer/capture` and the
 * scheduled capture timer). Extracted from EoServer.ts so it is testable under ts-jest
 * (EoServer drags the docx/blob export chain ts-jest cannot load).
 *
 * FX2-EO1 (P0, cross-tenant):
 *  - the tenant config is the REQUESTED tenant's, resolved from its slug (registry first, then
 *    Stamper plan-data). It used to be `config.tenantConfigPath` — the server default tenant,
 *    i.e. whichever tenant `/api/connect` opened last — whatever tenant was asked for;
 *  - the session must be the one opened for this tenant (`boundTenantSlug` / `boundTenantId`).
 *    A missing or foreign session is never used: the capture is skipped and reported as
 *    `liveSignals: 'not_connected'`.
 */
import * as os from 'node:os';
import type { EvidenceStorageConfig } from 'ces-shared/blob';
import { loadTenantConfig } from 'ces-shared/config';
import { getActiveStackProvider } from 'ces-shared/stack';
import type { EoConfig } from '../config/EoConfig.js';
import type { SessionManager } from '../core/SessionManager.js';
import { ComplianceSignalFetcher } from '../ingestion/ComplianceSignalFetcher.js';
import { PowerShellFallbackAdapter } from '../ingestion/PowerShellFallbackAdapter.js';
import { SignalToControlMapper } from '../mapping/SignalToControlMapper.js';
import { selectEvaluatorRegistry } from '../mapping/evaluators/index.js';
import { resolveControlSignalRegistryPath } from '../mapping/registryResolver.js';
import { EvidenceCaptureService } from '../generation/EvidenceCaptureService.js';
import { resolveTenantJsonPath } from './tenant-resolve.js';
import type { LiveSignalsState } from './TenantSessionRegistry.js';

export interface SignalCaptureResult {
  capturedCount: number;
  errors: Array<{ controlId: string; error: string }>;
  /** FX2-EO1: whether the tenant had its OWN live session. `not_connected` ⇒ nothing was fetched. */
  liveSignals: LiveSignalsState;
}

export interface CaptureRunRecord {
  timestamp: string;
  capturedCount: number;
  errors: Array<{ controlId: string; error: string }>;
}

let lastCaptureRun: CaptureRunRecord | null = null;

export function getLastCaptureRun(): CaptureRunRecord | null {
  return lastCaptureRun;
}

/** True iff `sm` was opened for exactly this tenant (slug and, when known, tenant GUID). */
export function isSessionBoundTo(sm: SessionManager | null, tenantSlug: string, tenantId?: string): sm is SessionManager {
  if (!sm) return false;
  if (sm.boundTenantSlug !== tenantSlug) return false;
  if (tenantId !== undefined && sm.boundTenantId !== undefined && sm.boundTenantId !== tenantId) return false;
  return true;
}

export async function captureSignalsForTenant(
  tenantSlug: string,
  sessionManager: SessionManager | null,
  evidenceStorage: EvidenceStorageConfig | null,
  config: EoConfig,
  stamperRoot: string,
): Promise<SignalCaptureResult> {
  let liveSignals: LiveSignalsState = 'not_connected';
  try {
    // The REQUESTED tenant's config — never the server default (config.tenantConfigPath).
    const tenantConfigPath = resolveTenantJsonPath(tenantSlug, stamperRoot, os.homedir());
    if (!tenantConfigPath) {
      const errors = [{ controlId: '_TENANT_CONFIG', error: `Tenant config not found: ${tenantSlug}` }];
      lastCaptureRun = { timestamp: new Date().toISOString(), capturedCount: 0, errors };
      return { capturedCount: 0, errors, liveSignals: 'not_connected' };
    }
    const tc = loadTenantConfig(tenantConfigPath);

    if (!isSessionBoundTo(sessionManager, tenantSlug, tc.tenantId)) {
      console.warn(`[captureSignalsForTenant] No live session for tenant '${tenantSlug}' — skipping capture (never borrowing another tenant's session)`);
      return { capturedCount: 0, errors: [], liveSignals: 'not_connected' };
    }
    liveSignals = 'connected';
    if (!evidenceStorage) {
      console.warn('[captureSignalsForTenant] evidenceStorage is null — skipping capture');
      return { capturedCount: 0, errors: [], liveSignals: 'connected' };
    }

    // Proactive connection check — verify/restore Graph session before fetching signals
    await sessionManager.ensureConnected('graph');

    const psAdapter = new PowerShellFallbackAdapter(tc);
    const fetcher = new ComplianceSignalFetcher(sessionManager, psAdapter);

    const allSignals = await fetcher.fetchAllSignals();

    // G4: route registry + evaluator selection through the active stack provider (Microsoft default).
    // G13: resolve the registry path via registryResolver (supports Microsoft + Google; unknown → undefined).
    const stack = getActiveStackProvider(tc).capabilities;
    const mapper = new SignalToControlMapper(resolveControlSignalRegistryPath(stack.controlSignalRegistryId), stack.controlSignalRegistryId);
    const signalControlAssessments = mapper.mapSignalsToControls(allSignals, selectEvaluatorRegistry(stack.evaluatorSetId));

    const captureService = new EvidenceCaptureService(evidenceStorage);
    const captureResults = await Promise.allSettled(
      signalControlAssessments.map(sa => captureService.captureForAssessment(sa))
    );

    let capturedCount = 0;
    for (const result of captureResults) {
      if (result.status === 'fulfilled') {
        capturedCount += result.value.length;
      }
    }

    const errors = captureService.getErrors();
    lastCaptureRun = { timestamp: new Date().toISOString(), capturedCount, errors };
    return { capturedCount, errors, liveSignals: 'connected' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errors = [{ controlId: '_FETCH_ERROR', error: msg }];
    lastCaptureRun = { timestamp: new Date().toISOString(), capturedCount: 0, errors };
    return { capturedCount: 0, errors, liveSignals };
  }
}
