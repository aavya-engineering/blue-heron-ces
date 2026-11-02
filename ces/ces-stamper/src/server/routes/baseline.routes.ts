// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../../config/ClientConfig.js';
import { SessionManager } from '../../core/SessionManager.js';
import { ExecutionContext } from '../../core/ExecutionContext.js';
import {
  BaselineProvisioner,
  BASELINE_RESOURCE_TYPES,
  baselineCostEntryId,
  baselineCostReference,
  isBaselineRecurring,
  type BaselineCostDecider,
} from '../../core/BaselineProvisioner.js';
import { PostureLevel } from '../../types/baseline.types.js';
import { tenantPlansDir, tenantBaseDir } from '../../core/EvidenceReadinessAnalyzer.js';
import { CESInfrastructureManifestSchema } from '../../types/ces-artifacts.types.js';
import {
  loadCostGateReference,
  readCostAcks,
  recordCostAck,
  currentAckFor,
  formatEstimate,
  CostGateError,
  type CostGateReference,
} from '../../core/CostGate.js';
import { runDp2, expectedDp2Text } from '../../adapters/CostGateDp2.js';

interface TenantConfigFile {
  client?: { name?: string; slug?: string };
  tenant?: { tenant_id?: string; domain?: string; environment?: string };
  resources?: Record<string, any>;
}

const SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_POSTURES: PostureLevel[] = ['m365_only', 'm365_foundation', 'm365_full_infra'];

/** FIN-15: one recurring baseline item as the Configure screen shows it (DP-1 list and DP-2 fields). */
export interface BaselineCostItemView {
  entry_id: string;
  resourceType: string;
  label: string;
  cost_key: string | null;
  estimate: string | null;
  estimate_basis: string;
  price_date: string;
  standard_alternative: string[];
  /** A current DP-1 exists (its ackHash matches today's price file). */
  acked: boolean;
  acked_at?: string;
  operator?: string;
  /** What DP-2 must be typed as: `<entry id> <monthly cost>`. */
  expected_dp2: string | null;
}

/** FIN-15: the recurring items a posture would build, with their estimate and DP-1 state. */
export function baselineCostItems(posture: PostureLevel, tenantDir: string, ref: CostGateReference): BaselineCostItemView[] {
  const acks = readCostAcks(tenantDir);
  return BASELINE_RESOURCE_TYPES[posture].filter(isBaselineRecurring).map((type) => {
    const id = baselineCostEntryId(type);
    const item = ref.byId.get(id);
    const key = item?.cost_gate.cost_key ?? null;
    const price = key ? ref.estimates.prices[key] : undefined;
    const estimate = price ? formatEstimate(price.estimate_month_low, price.estimate_month_high) : null;
    const ack = currentAckFor(id, acks, ref);
    return {
      entry_id: id,
      resourceType: type,
      label: item?.label ?? `Bring to Baseline: ${type}`,
      cost_key: key,
      estimate,
      estimate_basis: item?.cost_gate.estimate_basis ?? price?.basis ?? 'no price',
      price_date: ref.estimates.price_date,
      standard_alternative: item?.cost_gate.standard_alternative ?? [],
      acked: !!ack,
      ...(ack ? { acked_at: ack.acked_at, operator: ack.operator } : {}),
      expected_dp2: estimate ? expectedDp2Text(id, estimate) : null,
    };
  });
}

/** FIN-15: the `dp2` query value, a JSON object { "<entry id>": "<typed text>" }; anything else = none. */
export function parseDp2Param(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * FIN-15: DP-2 for each missing recurring baseline resource, through CostGate's runDp2: DP-1 must be
 * current, the typed text must be `<entry id> <monthly cost>`, and every outcome (accepted or
 * refused) is a `dp: 2` cost-gate evidence record under <tenant>/cost-gate-evidence/. The text is
 * typed in the Configure screen's dialog just before the run and carried on the stream URL.
 */
export function makeBaselineCostDecider(input: {
  ref: CostGateReference;
  tenantDir: string;
  operator: string;
  dp2: Record<string, string>;
}): BaselineCostDecider {
  const acks = readCostAcks(input.tenantDir);
  return async (resource) => {
    const entryId = baselineCostEntryId(resource.resourceType);
    const outcome = await runDp2({
      entryId,
      ref: input.ref,
      acks,
      tenantDir: input.tenantDir,
      runtime: {
        mode: 'manual',
        interactive: true,
        operator: input.operator || 'unknown-operator',
        promptDp2: async () => ({ typed: input.dp2[entryId] ?? '', operator: input.operator }),
      },
    });
    return {
      allowed: outcome.allowed,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      ...(outcome.prompt ? { estimate: outcome.prompt.estimate } : {}),
    };
  };
}

/**
 * Create the baseline router with SSE endpoint for Bring to Baseline feature.
 * Validates tenant + sessions, loads infrastructure manifest, runs discovery,
 * computes gaps, executes missing resource provisioning.
 */
export function createBaselineRouter(
  _getCachedRegistries: () => any[],
  getAbortRequested: () => boolean,
  setAbortRequested: (value: boolean) => void
): Router {
  const router = Router();

  // FIN-15: the DP-1 list for Bring to Baseline: the recurring items the posture would build.
  router.get('/api/baseline/cost-items', (req: Request, res: Response) => {
    const tenant = String(req.query['tenant'] ?? '');
    const posture = String(req.query['posture'] ?? 'm365_only') as PostureLevel;
    if (!SLUG_RE.test(tenant) || tenant === 'dev') return res.status(400).json({ error: 'a real tenant slug is required' });
    if (!VALID_POSTURES.includes(posture)) return res.status(400).json({ error: `Invalid posture: ${posture}` });
    try {
      const ref = baselineCostReference(loadCostGateReference());
      return res.json({ tenant, posture, price_date: ref.estimates.price_date, items: baselineCostItems(posture, tenantBaseDir(tenant), ref) });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // FIN-15: DP-1 for one baseline item. `typed` must equal the entry id. Same cost-acks.json and
  // evidence folder as the plan's DP-1 (costAck.routes.ts).
  router.post('/api/baseline/cost-ack', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { tenant?: string; entryId?: string; typed?: string; operator?: string };
    const tenant = String(body.tenant ?? '');
    const entryId = String(body.entryId ?? '');
    if (!SLUG_RE.test(tenant) || tenant === 'dev' || !entryId) return res.status(400).json({ error: 'tenant and entryId are required' });
    if (!entryId.startsWith('baseline.')) return res.status(400).json({ error: `DP-1 refused: ${entryId} is not a baseline item` });
    if (String(body.typed ?? '').trim() !== entryId) return res.status(400).json({ error: `DP-1 refused: type the entry id ${entryId} to opt in` });
    try {
      const ref = baselineCostReference(loadCostGateReference());
      const { ack, evidencePath } = recordCostAck(tenantBaseDir(tenant), { entry_id: entryId, operator: String(body.operator ?? '') }, ref);
      return res.json({ ok: true, ack, evidencePath, estimate: formatEstimate(ack.estimate_month_low, ack.estimate_month_high), price_date: ack.price_date });
    } catch (err) {
      const status = err instanceof CostGateError ? 400 : 500;
      return res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Guard: prevent duplicate baseline executions
  let baselineInProgress = false;

  // GET /api/baseline — SSE baseline provisioning stream
  router.get('/api/baseline', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    // Reject if another baseline is already in flight
    if (baselineInProgress) {
      send({ type: 'baseline_error', phase: 'discovery', error: 'A baseline operation is already in progress. Wait for it to complete or abort it first.' });
      res.end();
      return;
    }
    baselineInProgress = true;

    // SSE keepalive heartbeat
    const heartbeat = setInterval(() => {
      try { res.write(':keepalive\n\n'); } catch { /* connection gone */ }
    }, 15_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      baselineInProgress = false;
    });

    // Clear abort flag at start
    setAbortRequested(false);

    const startTime = Date.now();

    try {
      const tenant = req.query['tenant'] as string | undefined;
      const posture = (req.query['posture'] as PostureLevel | undefined) ?? 'm365_only';

      if (!tenant || tenant === 'dev') {
        send({ type: 'baseline_error', phase: 'discovery', error: 'Baseline requires a real tenant. Select a tenant from the dropdown.' });
        res.end();
        return;
      }

      // Validate posture parameter
      if (!VALID_POSTURES.includes(posture)) {
        send({ type: 'baseline_error', phase: 'discovery', error: `Invalid posture: ${posture}. Must be one of: ${VALID_POSTURES.join(', ')}` });
        res.end();
        return;
      }

      // Load tenant config
      const tenantJsonPath = await resolveTenantJsonPath(tenant);
      if (!fs.existsSync(tenantJsonPath)) {
        send({ type: 'baseline_error', phase: 'discovery', error: `Tenant config not found: ${tenantJsonPath}` });
        res.end();
        return;
      }

      const clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);
      const tenantRaw: TenantConfigFile = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));

      // Validate tenant has auth credentials required for sessions.
      if (!clientConfig.tenantId || !clientConfig.appId || !clientConfig.certThumbprint) {
        send({ type: 'baseline_error', phase: 'discovery', error: 'Tenant config is missing required auth credentials (tenantId, appId, certThumbprint). Configure the tenant before running baseline.' });
        res.end();
        return;
      }

      // Load latest infrastructure manifest from tenant's plans directory
      const plansDir = tenantPlansDir(tenant);
      let manifestPath: string | null = null;

      if (fs.existsSync(plansDir)) {
        const manifests = fs.readdirSync(plansDir)
          .filter(f => /^infrastructure-manifest.*\.json$/.test(f))
          .map(f => ({ name: f, path: path.join(plansDir, f), modified: fs.statSync(path.join(plansDir, f)).mtime.toISOString() }))
          .sort((a, b) => b.modified.localeCompare(a.modified));
        if (manifests.length > 0) manifestPath = manifests[0].path;
      }

      if (!manifestPath) {
        send({ type: 'baseline_error', phase: 'discovery', error: 'Infrastructure manifest not found. Generate manifest first via Configure card.' });
        res.end();
        return;
      }

      let stamperVariableMap: Record<string, any>;
      try {
        const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const parsed = CESInfrastructureManifestSchema.safeParse(manifestRaw);
        if (!parsed.success) {
          const errors = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
          send({ type: 'baseline_error', phase: 'discovery', error: `Invalid infrastructure manifest: ${errors}` });
          res.end();
          return;
        }
        stamperVariableMap = parsed.data.infrastructure.stamper_variable_map;

        // Overlay authoritative tenant config values onto manifest.
        // The manifest may contain placeholder answers from TCP question bank;
        // the tenant config (subscription + resources blocks) is the source of truth.
        if (clientConfig.subscription) {
          stamperVariableMap.subscriptionId = clientConfig.subscription.subscription_id;
          stamperVariableMap.resourceGroup = clientConfig.subscription.resource_group;
          stamperVariableMap.location = clientConfig.subscription.location;
        }
        const res_ = clientConfig.resources;
        if (res_) {
          if (res_.law_name) stamperVariableMap.lawWorkspaceName = res_.law_name;
          if (res_.kv_name) stamperVariableMap.keyVaultName = res_.kv_name;
          if (res_.storage_account_name) stamperVariableMap.storageAccountName = res_.storage_account_name;
          if (res_.automation_account_name) stamperVariableMap.automationAccountName = res_.automation_account_name;
          if (res_.vnet_name) stamperVariableMap.vnetName = res_.vnet_name;
          if (res_.nsg_name) stamperVariableMap.nsgPeName = res_.nsg_name;
          if (res_.cmk_key_name) stamperVariableMap.cmkKeyName = res_.cmk_key_name;
        }
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        send({ type: 'baseline_error', phase: 'discovery', error: `Failed to load infrastructure manifest: ${msg}` });
        res.end();
        return;
      }

      send({
        type: 'connection_log',
        phase: 'config_loaded',
        message: `Baseline starting: ${tenantRaw.client?.name ?? tenant} (posture: ${posture})`,
        tenant,
      });

      // Create execution infrastructure
      const sessionManager = new SessionManager(clientConfig, false);
      const executionContext = new ExecutionContext(false);
      executionContext.loadClientConfig(clientConfig);
      executionContext.loadManifestVariables(stamperVariableMap);

      // Create provisioner with infrastructure manifest variables
      let provisioner: BaselineProvisioner;
      try {
        provisioner = new BaselineProvisioner(
          tenant,
          stamperVariableMap,
          getAbortRequested,
          sessionManager,
          executionContext
        );
      } catch (ctorErr) {
        const msg = ctorErr instanceof Error ? ctorErr.message : String(ctorErr);
        send({ type: 'baseline_error', phase: 'discovery', error: msg });
        res.end();
        return;
      }

      // Get resource definitions for posture level
      const resources = provisioner.getResourceDefinitions(posture);

      if (resources.length === 0) {
        send({
          type: 'connection_log',
          phase: 'info',
          message: 'M365 Only posture selected. No Azure resources to provision.',
          tenant,
        });
        send({ type: 'baseline_complete', duration: Date.now() - startTime, succeeded: 0, failed: 0, skipped: 0 });
        res.end();
        return;
      }

      send({
        type: 'connection_log',
        phase: 'info',
        message: `Discovering ${resources.length} resources for posture: ${posture}`,
        tenant,
      });

      // ---- Phase 1: Discovery ----
      const discoveryResults = await provisioner.discoverPosture(resources, send);

      if (getAbortRequested()) {
        send({ type: 'baseline_complete', duration: Date.now() - startTime, succeeded: 0, failed: 0, skipped: resources.length });
        res.end();
        return;
      }

      // ---- Phase 2: Gap Analysis ----
      const { gapSummary, missingResources } = provisioner.computeGaps(resources, discoveryResults);

      send({
        type: 'gap_summary',
        total: gapSummary.total,
        missing: gapSummary.missing,
        existing: gapSummary.existing,
        byResourceType: gapSummary.byResourceType,
      });

      if (missingResources.length === 0) {
        send({
          type: 'connection_log',
          phase: 'info',
          message: 'All resources are already provisioned. No gaps to execute.',
          tenant,
        });
        // Persist any captures from discovery phase
        provisioner.persistCaptures();
        send({ type: 'baseline_complete', duration: Date.now() - startTime, succeeded: 0, failed: 0, skipped: 0 });
        res.end();
        return;
      }

      send({
        type: 'connection_log',
        phase: 'info',
        message: `Provisioning ${missingResources.length} missing resources...`,
        tenant,
      });

      // ---- Phase 3: Execution ----
      // FIN-15: a recurring resource needs DP-1 (cost-acks.json) and DP-2 (typed in the Configure
      // dialog, carried as `dp2`); without a cost reference every recurring resource is refused.
      let costGate: BaselineCostDecider | undefined;
      try {
        costGate = makeBaselineCostDecider({
          ref: baselineCostReference(loadCostGateReference()),
          tenantDir: tenantBaseDir(tenant),
          operator: String(req.query['operator'] ?? ''),
          dp2: parseDp2Param(req.query['dp2']),
        });
      } catch (costErr) {
        send({ type: 'connection_log', phase: 'error', message: `Cost gate unavailable, so recurring resources are refused: ${costErr instanceof Error ? costErr.message : String(costErr)}`, tenant });
      }
      const executionResult = await provisioner.executeGaps(missingResources, send, costGate);

      // Persist captures to assess-state.json after baseline completes
      provisioner.persistCaptures();

      send({
        type: 'baseline_complete',
        duration: Date.now() - startTime,
        succeeded: executionResult.succeeded,
        failed: executionResult.failed,
        skipped: executionResult.skipped,
        cost_gated_off: executionResult.costGatedOff,
        recurring_enabled: executionResult.recurringEnabled,
      });

      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'baseline_error', phase: 'discovery', error: msg });
      res.end();
    } finally {
      clearInterval(heartbeat);
      baselineInProgress = false;
    }
  });

  return router;
}
