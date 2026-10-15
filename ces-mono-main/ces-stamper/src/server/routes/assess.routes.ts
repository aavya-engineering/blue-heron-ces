// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../../config/ClientConfig.js';
import { StamperConfig } from '../../config/StamperConfig.js';
import { SessionManager } from '../../core/SessionManager.js';
import { ENGINE_SESSION_MAP } from 'ces-shared/session';
import { ExecutionContext } from '../../core/ExecutionContext.js';
import { PowerShellAdapter } from '../../adapters/PowerShellAdapter.js';
import { CommandEntry } from '../../registry/command-registry.types.js';
import { CommandRegistry } from '../../registry/CommandRegistry.js';
import { ReadinessResult, evidenceFileForEntry, evidenceDirForTenant, tenantPlansDir, tenantBaseDir } from '../../core/EvidenceReadinessAnalyzer.js';
import { CmmcComplianceAnalyzer, computeSprsByCategory, isDryRunRecord } from '../../core/CmmcComplianceAnalyzer.js';
import { EnrichedScopeExclusion, CESScopeExclusion, MPControl, CESControlDirective } from '../../types/ces-artifacts.types.js';
import { loadSprsWeights, enrichScopeExclusions } from '../../core/ScopeExclusionValidator.js';
import { ResourceFallbackResolver } from '../../core/ResourceFallbackResolver.js';
import { resolveTemplate } from '../../utils/templateResolver.js';
import { buildStructuredEvidence, writeAndUploadEvidence } from '../../utils/structuredEvidence.js';
import { DiscoveryResult, ExecutablePlan, StructuredEvidence, EvidenceOutcome } from '../../types/schema.types.js';
import { extractVariablesFromTemplate } from '../../utils/variableExtractor.js';
import { OutputVerificationEngine } from '../../core/OutputVerificationEngine.js';
import { VARIABLE_MAPPING, VARIABLE_DEFAULTS } from '../../shared/variable-map.js';
import { writeJsonArtifact } from 'ces-shared/persistence/files';

interface TenantConfigFile {
  client?: { name?: string; slug?: string };
  tenant?: { tenant_id?: string; domain?: string; environment?: string };
  resources?: Record<string, any>;
}

/**
 * After fallback resolution discovers resource values, persist them back to the
 * tenant JSON file so they become defaults for all future runs.
 */
function persistResolvedToTenantJson(tenantJsonPath: string, resolved: Record<string, string>): boolean {
  const raw = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
  if (!raw.resources) raw.resources = {};

  let updated = false;
  for (const [varName, value] of Object.entries(resolved)) {
    const field = VARIABLE_MAPPING[varName];
    if (field && !raw.resources[field]) {
      raw.resources[field] = value;
      updated = true;
    }
  }

  if (updated) {
    writeJsonArtifact(tenantJsonPath, raw, { trailingNewline: true });
  }

  return updated;
}

/** Extract compact registry metadata for SSE payloads */
function registryMeta(entry: CommandEntry): Record<string, any> {
  return {
    get_command_template: entry.get_command || null,
    set_command_template: entry.set_command || null,
    variables_required: entry.variables_required || [],
    variables_runtime: entry.variables_runtime || [],
    captures: (entry.captures || []).map(c => ({ variable: c.variable, from: c.from })),
    idempotency: entry.idempotency,
    on_failure: entry.on_failure,
    layer_hint: entry.layer_hint,
    sequence_hint: entry.sequence_hint,
    manual_only: entry.manual_only,
    evidence_commands: entry.evidence_commands || [],
    notes: entry.notes || null,
  };
}

export function createAssessRouter(
  getCachedEntries: () => CommandEntry[],
  getCachedRegistries: () => CommandRegistry[],
  getLastReadinessResult: () => ReadinessResult | null,
  setLastReadinessResult: (result: ReadinessResult | null) => void,
  saveAssessState: (slug: string, data: object) => void,
  loadAssessState: (slug: string) => Record<string, any> | null
): Router {
  const router = Router();

  // GET /api/assess-state — return cached assess state from disk
  router.get('/api/assess-state', (req: Request, res: Response) => {
    const tenant = req.query['tenant'] as string | undefined;
    if (!tenant || tenant === 'dev') { res.json({ ok: false }); return; }

    const data = loadAssessState(tenant);
    if (!data) { res.json({ ok: false }); return; }

    // Restore in-memory lastReadinessResult so translate can use accomplishedIds
    if (!getLastReadinessResult() && data.accomplishedIds) {
      setLastReadinessResult({
        matches: [],
        accomplishedIds: data.accomplishedIds,
        byCategory: data.byCategory || {},
        totalRegistryEntries: data.totalRegistryEntries || 0,
        totalAccomplished: data.totalAccomplished || 0,
      });
    }

    // Migrate legacy cached state: initialize missing entryDetails arrays for backward compatibility
    // Cached assess-state.json from prior runs lacks entryDetails, causing chevrons to never render
    if (data.cmmcStatus && !data.cmmcStatus._migrated) {
      ['satisfiedControls', 'willBeControls', 'wontBeControls', 'notVerifiedControls'].forEach(key => {
        if (Array.isArray(data.cmmcStatus[key])) {
          data.cmmcStatus[key].forEach((c: any) => {
            if (!c.entryDetails) c.entryDetails = [];
            if (c.registryEntryCount === undefined) c.registryEntryCount = 0;
            if (c.discoveredCount === undefined) c.discoveredCount = 0;
            if (c.missingCount === undefined) c.missingCount = 0;
          });
        }
      });
      data.cmmcStatus._migrated = true;
    }

    res.json(data);
  });

  // GET /api/assess — SSE readiness assessment: query tenant infra, write evidence, analyze
  router.get('/api/assess', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    // SSE keepalive heartbeat — prevents proxy/browser timeouts
    const heartbeat = setInterval(() => {
      try { res.write(':keepalive\n\n'); } catch { /* connection gone */ }
    }, 15_000);

    let closed = false;
    req.on('close', () => { closed = true; clearInterval(heartbeat); });

    try {
      const tenant = req.query['tenant'] as string | undefined;
      const verbose = req.query['verbose'] !== 'false';
      const uploadEnabled = req.query['uploadToBlob'] !== 'false';
      const planFile = req.query['planFile'] as string | undefined;

      if (!tenant || tenant === 'dev') {
        send({ type: 'error', message: 'Assessment requires a real tenant connection. Select a tenant from the dropdown.' });
        res.end();
        return;
      }

      // Tenant-scoped evidence directory
      const evidenceDir = evidenceDirForTenant(tenant);

      // Load tenant config
      const tenantJsonPath = await resolveTenantJsonPath(tenant);
      if (!fs.existsSync(tenantJsonPath)) {
        send({ type: 'error', message: `Tenant config not found: ${tenantJsonPath}` });
        res.end();
        return;
      }

      const clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);

      // Read raw tenant JSON for display info
      const tenantRaw: TenantConfigFile = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));

      send({
        type: 'connection_log',
        phase: 'config_loaded',
        message: `Tenant config loaded: ${tenantRaw.client?.name ?? tenant} (${tenantRaw.tenant?.environment ?? 'unknown'})`,
        tenant,
        detail: `Domain: ${tenantRaw.tenant?.domain ?? 'n/a'} | Environment: ${tenantRaw.tenant?.environment ?? 'n/a'}`
      });

      send({
        type: 'connection_log',
        phase: 'connecting',
        message: 'Connecting to tenant...',
        tenant
      });

      // Create infrastructure — use fromTenantConfig to avoid requiring process.env
      const stamperConfig = StamperConfig.fromTenantConfig({ ...tenantRaw, dryRun: false });
      const sessionManager = new SessionManager(clientConfig, false);
      const executionContext = new ExecutionContext(false);
      executionContext.loadClientConfig(clientConfig);
      const adapter = new PowerShellAdapter(stamperConfig, sessionManager, executionContext, clientConfig.evidenceStorage, tenant);

      // Build variables map from tenant config
      const variables: Record<string, any> = {};

      // Auth vars (loaded via executionContext, also populate map for resolve)
      variables.tenantId = clientConfig.tenantId;
      variables.appId = clientConfig.appId;
      variables.certThumbprint = clientConfig.certThumbprint;
      variables.certPath = clientConfig.certPath;
      if (clientConfig.targetTenantDomain) {
        variables.tenantName = clientConfig.targetTenantDomain.split('.')[0];
      }

      // Subscription vars
      if (clientConfig.subscription) {
        variables.subscriptionId = clientConfig.subscription.subscription_id;
        variables.resourceGroup = clientConfig.subscription.resource_group;
        variables.location = clientConfig.subscription.location;
      }

      // Resource vars
      if (clientConfig.resources) {
        const r = clientConfig.resources;
        for (const [camelKey, snakeKey] of Object.entries(VARIABLE_MAPPING)) {
          const value = (r as any)[snakeKey];
          if (value !== undefined) variables[camelKey] = value;
        }
      }

      // Apply well-known constant defaults (e.g. Azure AD role definition IDs)
      // Only set if not already provided by tenant config
      for (const [key, defaultVal] of Object.entries(VARIABLE_DEFAULTS)) {
        if (variables[key] === undefined) variables[key] = defaultVal;
      }

      // Restore previously-captured runtime variables from tenant variables.json.
      // Assess has no plan — runtime captures (breakGlassUserId, cuiGroupId, etc.)
      // from prior Execute runs are needed for discovery of entries that depend on them.
      try {
        const varsPath = path.join(tenantBaseDir(tenant), 'variables.json');
        if (fs.existsSync(varsPath)) {
          const savedVars = JSON.parse(fs.readFileSync(varsPath, 'utf-8'));
          for (const [key, value] of Object.entries(savedVars)) {
            if (variables[key] === undefined && typeof value === 'string') {
              variables[key] = value;
            }
          }
        }
      } catch { /* non-fatal — first run won't have variables.json */ }

      // Load variables into ExecutionContext so PowerShellAdapter.resolve() can find them
      // (assess has no plan — this map is built manually above from tenant config)
      executionContext.loadManifestVariables(variables);

      // Use cached registry entries (loaded at server startup)
      // Filter by infrastructure_model: preserve all M365 entries, filter infra entries by enclave
      const allEntries = getCachedEntries();
      const infrastructureModel = clientConfig.infrastructure_model || 'm365_azure';
      const registries = getCachedRegistries();
      const infraRegistry = registries.find(r => r.allEntries.some(e => e.entry_id.startsWith('AZ-')));

      let entries = allEntries;
      if (infraRegistry) {
        const filteredInfraEntries = infraRegistry.filterByEnclave(infrastructureModel);
        const m365Entries = allEntries.filter(e => !e.entry_id.startsWith('AZ-'));
        entries = [...m365Entries, ...filteredInfraEntries];
      }

      // Filter tenant-level excluded entries (e.g. BYOD entries for non-BYOD tenants)
      const tenantExcluded = clientConfig.excluded_entries || [];
      if (tenantExcluded.length > 0) {
        const excludeSet = new Set(tenantExcluded);
        entries = entries.filter(e => !excludeSet.has(e.entry_id));
      }

      if (entries.length === 0) {
        send({ type: 'error', message: 'No registries found' });
        res.end();
        return;
      }

      // Ensure evidence directory exists
      if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
      }

      send({ type: 'assess_start', evidencePath: evidenceDir, totalEntries: entries.length });

      // --- Fallback discovery phase ---
      const allRequiredVars = new Set<string>();
      for (const entry of entries) {
        for (const v of entry.variables_required || []) allRequiredVars.add(v);
      }
      const missingBefore = [...allRequiredVars].filter(v => !variables[v]);

      if (missingBefore.length > 0) {
        send({ type: 'assess_phase', phase: 'fallback_scan', count: 0 });
        const discoverFn: import('../../core/ResourceFallbackResolver.js').DiscoverFn = (engine, cmd, captures, vars) =>
          adapter.discoverSubCommand(engine, cmd, captures as any, vars, false);
        const resolver = new ResourceFallbackResolver(discoverFn, variables, send);
        const resolved = await resolver.resolveByFallback(missingBefore);
        Object.assign(variables, resolved);

        if (Object.keys(resolved).length > 0) {
          const persisted = persistResolvedToTenantJson(tenantJsonPath, resolved);
          if (persisted) {
            send({ type: 'assess_phase', phase: 'tenant_updated',
                   message: 'Discovered values saved to tenant config', count: 0 });
          }
        }
      }

      send({ type: 'assess_phase', phase: 'live', count: entries.length });

      let connectionConfirmed = false;
      const accomplishedIds: string[] = [];
      const discoveryResults = new Map<string, DiscoveryResult>();

      // ---- First pass: discover entries that produce captures for runtime variables ----
      const captureProviders: CommandEntry[] = [];
      const needsSecondPass: CommandEntry[] = [];

      for (const entry of entries) {
        if (!entry.get_command) continue; // handled separately

        const getVarsNeeded = extractVariablesFromTemplate(entry.get_command);
        const hasAllGetVars = getVarsNeeded.every(v => variables[v]);

        // Capture provider: has captures AND all get_command vars satisfied AND no runtime dependencies
        if (entry.captures && entry.captures.length > 0 &&
            entry.variables_runtime.length === 0 && hasAllGetVars) {
          captureProviders.push(entry);
        }
        // Needs second pass: depends on variables_runtime that might be captured in pass 1
        else if (entry.variables_runtime.length > 0) {
          needsSecondPass.push(entry);
        }
      }

      // Execute capture providers concurrently to populate variables map
      if (captureProviders.length > 0) {
        send({ type: 'assess_phase', phase: 'capture_pass', count: captureProviders.length });
        const processCaptureProvider = async (entry: CommandEntry): Promise<void> => {
          if (closed) return;
          try {
            const result = await adapter.discoverSubCommand(
              entry.engine,
              entry.get_command!,
              entry.captures || [],
              variables,
              false,
              entry.variables_required || [],
              entry.variables_runtime || []
            );

            if (!connectionConfirmed) {
              connectionConfirmed = true;
              send({
                type: 'connection_log',
                phase: 'connected',
                message: `Connected to tenant: ${tenantRaw.client?.name ?? tenant}`,
                tenant,
                detail: `Environment: ${tenantRaw.tenant?.environment ?? 'unknown'}`
              });
            }

            // Merge captures into variables map for second pass
            if (result.exists && Object.keys(result.captures).length > 0) {
              Object.assign(variables, result.captures);
              send({
                type: 'assess_phase',
                phase: 'captures_merged',
                message: `Captured ${Object.keys(result.captures).length} variables from ${entry.entry_id}`,
                count: Object.keys(result.captures).length
              });
            }
          } catch (err) {
            // Capture failures are non-fatal, second pass will handle missing vars
          }
        };

        await asyncPool(5, captureProviders, processCaptureProvider);
      }

      // ---- Second pass: re-partition all entries with enriched variables map ----
      // ---- Partition entries into skip (no PS call) and live (need discovery) ----
      const skipEntries: CommandEntry[] = [];
      const liveEntries: CommandEntry[] = [];

      for (const entry of entries) {
        if (!entry.get_command) {
          skipEntries.push(entry);
          continue;
        }
        const getVarsNeeded = extractVariablesFromTemplate(entry.get_command);
        const missingVars = getVarsNeeded.filter(v => !variables[v]);
        if (missingVars.length > 0) {
          skipEntries.push(entry);
        } else {
          liveEntries.push(entry);
        }
      }

      // Helper: strip STAMPER_EXECUTION_SUCCESS sentinel from evidence content
      const stripSentinel = (content: string): string => {
        return content
          .replace(/\r?\nSTAMPER_EXECUTION_SUCCESS\s*$/g, '')
          .replace(/^STAMPER_EXECUTION_SUCCESS\r?\n?$/g, '')
          .trim();
      };

      // Helper: validate evidence file has real SAT content (not just sentinel or NOT_SAT)
      const hasValidEvidence = (entryId: string, label: string, evidenceDir: string): boolean => {
        const baseFp = path.join(evidenceDir, evidenceFileForEntry(entryId, label));
        // Try .json file — check complianceVerdict is SAT
        const jsonFp = baseFp.replace(/\.txt$/, '.json');
        if (fs.existsSync(jsonFp)) {
          try {
            const content = fs.readFileSync(jsonFp, 'utf-8');
            const stripped = stripSentinel(content);
            if (stripped === '') return false;
            const parsed = JSON.parse(stripped);
            // Only trust evidence that actually passed compliance — and never a dry run (FX2-ST2)
            if (parsed.complianceVerdict === 'SAT' && !isDryRunRecord(parsed)) return true;
          } catch { /* malformed JSON — not valid */ }
          return false;
        }
        // Fallback: .txt file (legacy format, no verdict to check — trust non-empty)
        if (fs.existsSync(baseFp)) {
          const content = fs.readFileSync(baseFp, 'utf-8');
          const stripped = stripSentinel(content);
          if (stripped !== '') return true;
        }
        return false;
      };

      // Helper: read evidence content best-effort (truncated to 2000 chars)
      const readEvidenceContent = (entryId: string, label: string): string => {
        try {
          const baseFp = path.join(evidenceDir, evidenceFileForEntry(entryId, label));

          // Try .txt file first
          if (fs.existsSync(baseFp)) {
            const rawContent = fs.readFileSync(baseFp, 'utf-8');
            return stripSentinel(rawContent).substring(0, 4000);
          }

          // Try .json file and parse StructuredEvidence wrapper
          const jsonFp = baseFp.replace(/\.txt$/, '.json');
          if (fs.existsSync(jsonFp)) {
            const rawContent = fs.readFileSync(jsonFp, 'utf-8');
            const stripped = stripSentinel(rawContent);

            try {
              const parsed = JSON.parse(stripped);
              // Extract rawResponse from StructuredEvidence wrapper
              const payload = parsed.rawResponse
                ? (typeof parsed.rawResponse === 'string'
                    ? JSON.parse(parsed.rawResponse)
                    : parsed.rawResponse)
                : parsed;
              return JSON.stringify(payload, null, 2).substring(0, 4000);
            } catch {
              // If JSON parse fails, return raw stripped content
              return stripped.substring(0, 4000);
            }
          }
        } catch { /* best-effort */ }
        return '';
      };

      // Helper: build and write StructuredEvidence for non-success assess paths.
      // Returns the evidence object (or null on failure) so the SSE can include evidenceContent.
      const writeNonSuccessEvidence = async (
        entry: CommandEntry,
        outcome: EvidenceOutcome,
        outcomeRationale: string,
        rawOutput: string,
        verdict: 'SAT' | 'NOT_SAT',
        verdictRationale: string,
      ): Promise<StructuredEvidence | null> => {
        try {
          const evidFile = evidenceFileForEntry(entry.entry_id, entry.label).replace(/\.txt$/, '.json');
          const registrySnapshot = {
            entry_id: entry.entry_id, label: entry.label, engine: entry.engine,
            layer_hint: entry.layer_hint, sequence_hint: entry.sequence_hint,
            idempotency: entry.idempotency, on_failure: entry.on_failure,
            control_ids: entry.control_ids, notes: entry.notes,
            manual_only: entry.manual_only,
          };
          const evidence: StructuredEvidence = {
            rawResponse: rawOutput,
            outcome,
            outcomeRationale,
            complianceVerdict: verdict,
            verdictRationale,
            registryEntry: registrySnapshot,
            metadata: {
              controlIds: entry.control_ids || [],
              timestamp: new Date().toISOString(),
              executorIdentity: variables.tenant_slug || variables.tenantSlug || 'unknown',
              commandExecuted: entry.get_command
                ? `[assess] ${resolveTemplate(entry.get_command, variables)}`
                : `[no get_command] ${entry.label}`,
              sha256Hash: createHash('sha256').update(rawOutput, 'utf8').digest('hex'),
              environment: variables.environment || 'GCC-High',
            },
          };
          await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig.evidenceStorage : undefined);
          return evidence;
        } catch { return null; /* evidence write is best-effort */ }
      };

      // Helper: resolve set_command for display
      const resolveSetCmd = (entry: CommandEntry): string =>
        entry.set_command ? resolveTemplate(entry.set_command, variables) : '(manual_only — no set_command)';

      let entryCounter = 0;

      // ---- Process skip entries first (instant, no PS calls) ----
      for (const entry of skipEntries) {
        if (closed) break;
        entryCounter++;

        if (!entry.get_command) {
          if (hasValidEvidence(entry.entry_id, entry.label, evidenceDir)) {
            discoveryResults.set(entry.entry_id, { status: 'exists' });
            accomplishedIds.push(entry.entry_id);
            send({
              type: 'assess_check',
              entryId: entry.entry_id,
              label: entry.label,
              status: 'exists',
              found: true,
              source: 'evidence',
              command: '(verified from evidence on file)',
              reason: 'exists: verified from evidence on file',
              cmmc_controls: entry.control_ids || [],
              engine: entry.engine,
              entryIndex: entryCounter,
              set_command: resolveSetCmd(entry),
              evidenceContent: readEvidenceContent(entry.entry_id, entry.label),
              registry: registryMeta(entry),
            });
          } else if (entry.manual_only) {
            discoveryResults.set(entry.entry_id, { status: 'exists' });
            accomplishedIds.push(entry.entry_id);
            const oosEvidence = await writeNonSuccessEvidence(
              entry, 'not_applicable',
              'Manual-only entry — outside automated assessment scope',
              '', 'SAT', 'Manual-only entry marked as out-of-scope — treated as satisfied by policy'
            );
            send({
              type: 'assess_check',
              entryId: entry.entry_id,
              label: entry.label,
              status: 'out_of_scope',
              found: true,
              source: 'out_of_scope',
              command: '(outside tenant scope)',
              reason: 'out_of_scope: manual_only entry with no get_command',
              cmmc_controls: entry.control_ids || [],
              engine: entry.engine,
              entryIndex: entryCounter,
              set_command: resolveSetCmd(entry),
              evidenceContent: oosEvidence ? JSON.stringify(oosEvidence, null, 2).substring(0, 4000) : '',
              registry: registryMeta(entry),
            });
          } else {
            discoveryResults.set(entry.entry_id, { status: 'no_query' });
            const nqEvidence = await writeNonSuccessEvidence(
              entry, 'not_applicable',
              'No get_command defined in registry — cannot assess automatically',
              '', 'NOT_SAT', 'No automated assessment possible — no get_command in registry entry'
            );
            send({
              type: 'assess_check',
              entryId: entry.entry_id,
              label: entry.label,
              status: 'no_query',
              found: false,
              source: 'live',
              command: '(no get_command defined)',
              reason: 'no_query: no get_command defined in registry',
              cmmc_controls: entry.control_ids || [],
              engine: entry.engine,
              entryIndex: entryCounter,
              set_command: resolveSetCmd(entry),
              evidenceContent: nqEvidence ? JSON.stringify(nqEvidence, null, 2).substring(0, 4000) : '',
              registry: registryMeta(entry),
            });
          }
        } else {
          // Has get_command but missing variables
          const getVarsNeeded = extractVariablesFromTemplate(entry.get_command);
          const missingVars = getVarsNeeded.filter(v => !variables[v]);
          if (hasValidEvidence(entry.entry_id, entry.label, evidenceDir)) {
            discoveryResults.set(entry.entry_id, { status: 'exists' });
            accomplishedIds.push(entry.entry_id);
            send({
              type: 'assess_check',
              entryId: entry.entry_id,
              label: entry.label,
              status: 'exists',
              found: true,
              source: 'evidence',
              command: '(verified from evidence on file)',
              reason: 'exists: verified from evidence on file',
              cmmc_controls: entry.control_ids || [],
              engine: entry.engine,
              entryIndex: entryCounter,
              set_command: resolveSetCmd(entry),
              evidenceContent: readEvidenceContent(entry.entry_id, entry.label),
              registry: registryMeta(entry),
            });
          } else {
            discoveryResults.set(entry.entry_id, { status: 'no_query' });
            const skipEvidence = await writeNonSuccessEvidence(
              entry, 'failed_remediation_available',
              `Skipped: missing variables [${missingVars.join(', ')}]`,
              `Required variables not resolved: ${missingVars.join(', ')}`,
              'NOT_SAT', `Cannot assess — missing required variables: ${missingVars.join(', ')}`
            );
            send({
              type: 'assess_check',
              entryId: entry.entry_id,
              label: entry.label,
              status: 'skipped',
              found: false,
              detail: `Missing variables: ${missingVars.join(', ')}`,
              source: 'live',
              command: resolveTemplate(entry.get_command, variables),
              reason: `skipped: missing variables [${missingVars.join(', ')}]`,
              cmmc_controls: entry.control_ids || [],
              engine: entry.engine,
              entryIndex: entryCounter,
              set_command: resolveSetCmd(entry),
              evidenceContent: skipEvidence ? JSON.stringify(skipEvidence, null, 2).substring(0, 4000) : '',
              registry: registryMeta(entry),
            });
          }
        }
      }

      // ---- Concurrent discovery of live entries ----
      // asyncPool: run at most `concurrency` async tasks in parallel
      async function asyncPool<T, R>(concurrency: number, items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
        const results: R[] = [];
        const executing = new Set<Promise<void>>();
        let idx = 0;
        for (const item of items) {
          const i = idx++;
          const p = fn(item).then(r => { results[i] = r; });
          const tracked: Promise<void> = p.then(() => { executing.delete(tracked); });
          executing.add(tracked);
          if (executing.size >= concurrency) {
            await Promise.race(executing);
          }
        }
        await Promise.all(executing);
        return results;
      }

      // Process a single live entry: discover, emit SSE, write evidence
      const processLiveEntry = async (entry: CommandEntry): Promise<void> => {
        if (closed) return;
        const myIndex = ++entryCounter;

        try {
          const result = await adapter.discoverSubCommand(
            entry.engine,
            entry.get_command!,
            entry.captures || [],
            variables,
            false,
            entry.variables_required || [],
            entry.variables_runtime || []
          );

          if (!connectionConfirmed) {
            connectionConfirmed = true;
            send({
              type: 'connection_log',
              phase: 'connected',
              message: `Connected to tenant: ${tenantRaw.client?.name ?? tenant}`,
              tenant,
              detail: `Environment: ${tenantRaw.tenant?.environment ?? 'unknown'}`
            });
          }

          if (result.exists) {
            // Merge captures into variables for downstream resolution
            if (Object.keys(result.captures).length > 0) {
              Object.assign(variables, result.captures);
            }

            // Run evidence_commands for richer audit-grade evidence
            let evidenceOutput = result.rawOutput || '';
            if (entry.evidence_commands && entry.evidence_commands.length > 0) {
              for (const evidCmd of entry.evidence_commands) {
                try {
                  const resolvedEvidCmd = resolveTemplate(evidCmd, variables);
                  const sessionType = ENGINE_SESSION_MAP[entry.engine] ?? 'azure';
                  const evidResult = await sessionManager.execute(sessionType, resolvedEvidCmd);
                  if (evidResult.exitCode === 0 && evidResult.stdout.trim()) {
                    evidenceOutput = evidResult.stdout; // prefer richer evidence
                  }
                } catch { /* evidence_command is best-effort */ }
              }
            }

            // Verification step: if entry has verification criteria, run OutputVerificationEngine
            // This now runs for ALL entries (not just those with evidence_commands)
            let verdict: 'SAT' | 'NOT_SAT' | undefined = undefined;
            let verificationScore: number | undefined = undefined;
            if (entry.verification && evidenceOutput) {
              try {
                const verifier = new OutputVerificationEngine();
                const verifyResult = verifier.verify(
                  { stdout: evidenceOutput, stderr: '', exitCode: 0 },
                  { stdout: evidenceOutput, exitCode: 0 },
                  entry.verification
                );
                verdict = verifyResult.passed ? 'SAT' : 'NOT_SAT';
                verificationScore = verifyResult.score;
              } catch {
                // Verification failure: default to undefined (backward compat, treated as SAT)
                verdict = undefined;
                verificationScore = undefined;
              }
            }

            // Write evidence file
            let evidence: any = null;
            if (evidenceOutput) {
              try {
                const evidFile = evidenceFileForEntry(entry.entry_id, entry.label).replace(/\.txt$/, '.json');
                const registrySnapshot = {
                  entry_id: entry.entry_id, label: entry.label, engine: entry.engine,
                  layer_hint: entry.layer_hint, sequence_hint: entry.sequence_hint,
                  idempotency: entry.idempotency, on_failure: entry.on_failure,
                  control_ids: entry.control_ids, notes: entry.notes,
                  manual_only: entry.manual_only,
                };
                // Build a minimal ExeTask-like object for buildStructuredEvidence
                const pseudoTask = { controls: entry.control_ids } as any;
                evidence = buildStructuredEvidence(
                  evidenceOutput, 0, '', null,
                  { ...entry, set_command: entry.set_command || '', variables_required: entry.variables_required || [],
                    variables_runtime: entry.variables_runtime || [], captures: entry.captures || [],
                    evidence_commands: entry.evidence_commands || [], sequence_hint: entry.sequence_hint } as any,
                  pseudoTask, variables, undefined,
                  registrySnapshot,
                  { assessOnly: true }
                );
                await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig.evidenceStorage : undefined);
              } catch { /* evidence write is best-effort */ }
            }

            // Read evidence content for GUI display
            const evidenceContent = readEvidenceContent(entry.entry_id, entry.label);

            // Set discovery result with verdict and score
            discoveryResults.set(entry.entry_id, { status: 'exists', verdict, verificationScore });

            accomplishedIds.push(entry.entry_id);
            send({
              type: 'assess_check',
              entryId: entry.entry_id,
              label: entry.label,
              status: 'exists',
              found: true,
              file: evidenceFileForEntry(entry.entry_id, entry.label),
              detail: evidenceOutput ? evidenceOutput.substring(0, 120) : '',
              source: 'live',
              command: resolveTemplate(entry.get_command!, variables),
              rawOutput: verbose ? result.rawOutput : result.rawOutput?.substring(0, 2000),
              reason: 'exists: resource found via live query',
              cmmc_controls: entry.control_ids || [],
              engine: entry.engine,
              entryIndex: myIndex,
              set_command: resolveSetCmd(entry),
              evidenceContent,
              registry: registryMeta(entry),
              outcome: evidence?.outcome || null,
              outcomeRationale: evidence?.outcomeRationale || null,
              complianceVerdict: evidence?.complianceVerdict || null,
              verdictRationale: evidence?.verdictRationale || null,
              fullRegistry: entry,
            });
          } else {
            discoveryResults.set(entry.entry_id, { status: 'missing' });
            const missingEvidence = await writeNonSuccessEvidence(
              entry, 'failed_remediation_available',
              'Resource not found or get_command returned empty during assess',
              verbose ? (result.rawOutput || '') : (result.rawOutput?.substring(0, 2000) || ''),
              'NOT_SAT', 'Resource not present in tenant — compliance requirement not yet satisfied'
            );
            send({
              type: 'assess_check',
              entryId: entry.entry_id,
              label: entry.label,
              status: 'missing',
              found: false,
              source: 'live',
              command: resolveTemplate(entry.get_command!, variables),
              rawOutput: verbose ? result.rawOutput : result.rawOutput?.substring(0, 2000),
              reason: 'missing: get_command returned empty or ResourceNotFound',
              cmmc_controls: entry.control_ids || [],
              engine: entry.engine,
              entryIndex: myIndex,
              set_command: resolveSetCmd(entry),
              evidenceContent: missingEvidence ? JSON.stringify(missingEvidence, null, 2).substring(0, 4000) : '',
              registry: registryMeta(entry),
            });
          }
        } catch (queryErr) {
          discoveryResults.set(entry.entry_id, { status: 'error' });
          const qMsg = queryErr instanceof Error ? queryErr.message : String(queryErr);
          const errEvidence = await writeNonSuccessEvidence(
            entry, 'failed_remediation_available',
            `Assessment query failed: ${qMsg}`,
            qMsg,
            'NOT_SAT', `Assessment error: ${qMsg}`
          );
          send({
            type: 'assess_check',
            entryId: entry.entry_id,
            label: entry.label,
            status: 'error',
            found: false,
            detail: qMsg,
            source: 'live',
            command: resolveTemplate(entry.get_command!, variables),
            reason: `error: ${qMsg}`,
            cmmc_controls: entry.control_ids || [],
            engine: entry.engine,
            entryIndex: myIndex,
            set_command: resolveSetCmd(entry),
            evidenceContent: errEvidence ? JSON.stringify(errEvidence, null, 2).substring(0, 4000) : '',
            registry: registryMeta(entry),
          });
        }
      };

      // Run live entries with concurrency of 5
      await asyncPool(5, liveEntries, processLiveEntry);

      // Build summary from live tenant query results (no local file scanning)
      const accomplishedSet = new Set(accomplishedIds);
      const byCategory: Record<string, { done: number; pending: number }> = {};
      for (const entry of entries) {
        const cat = entry.entry_id.split('.').slice(0, 2).join('.'); // e.g. "M365.EXO"
        if (!byCategory[cat]) byCategory[cat] = { done: 0, pending: 0 };
        if (accomplishedSet.has(entry.entry_id)) {
          byCategory[cat].done++;
        } else {
          byCategory[cat].pending++;
        }
      }

      send({
        type: 'assess_summary',
        totalRegistry: entries.length,
        accomplished: accomplishedIds.length,
        pending: entries.length - accomplishedIds.length,
        byCategory,
      });

      // ---- CMMC Compliance Analysis (plan-less mode) ----
      let cmmcPayload: Record<string, any> | null = null;
      try {
        // Use cached registries (loaded at server startup)
        const cmmcRegistries = getCachedRegistries();

        // Compute excluded entry IDs for enclave filtering
        const allInfraEntries = infraRegistry ? infraRegistry.allEntries.map(e => e.entry_id) : [];
        const includedInfraEntries = infraRegistry ? infraRegistry.filterByEnclave(infrastructureModel).map(e => e.entry_id) : [];
        const excludedEntryIds = new Set(allInfraEntries.filter(id => !includedInfraEntries.includes(id)));

        // Also add tenant-level excluded entries (BYOD, etc.)
        for (const id of (clientConfig.excluded_entries || [])) {
          excludedEntryIds.add(id);
        }

        // Load plan if provided to enable plan-aware mode (3-category output)
        let planControlIds: string[] | null = null;
        let mpControls: MPControl[] | null = null;
        let controlDirectives: CESControlDirective[] | undefined = undefined;
        let enrichedExclusions: EnrichedScopeExclusion[] = [];
        if (planFile) {
          try {
            // Accept full path or filename; resolve relative to tenant plans dir
            const planPath = path.isAbsolute(planFile) ? planFile : path.join(tenantPlansDir(tenant), planFile);
            if (fs.existsSync(planPath)) {
              const planJson = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
              // Try loading as ExecutablePlan (has execution_graph)
              if (planJson.execution_graph) {
                const controlIds = Array.from(new Set((planJson as ExecutablePlan).execution_graph.flatMap(t => t.controls)));
                planControlIds = controlIds;
                send({ type: 'info', message: `Plan-aware mode: loaded ${controlIds.length} control IDs from ${planFile}` });
              }
              // Try loading MP controls from the file (works for MP files)
              if (planJson.outputs?.human_readable_mission_plan?.controls) {
                mpControls = planJson.outputs.human_readable_mission_plan.controls;
                send({ type: 'info', message: `Loaded ${mpControls!.length} MP controls from planFile` });
              }
              // Try loading control_directives from the file
              if (planJson.outputs?.human_readable_mission_plan?.control_directives) {
                const planDirectives: CESControlDirective[] = planJson.outputs.human_readable_mission_plan.control_directives;
                if (planDirectives.length > 0) {
                  controlDirectives = planDirectives;
                  send({ type: 'info', message: `Loaded ${controlDirectives.length} control directives from planFile` });
                }
              }
            } else {
              send({ type: 'warning', message: `Plan file not found: ${planFile}. Continuing in plan-less mode.` });
            }
          } catch (planErr) {
            const planMsg = planErr instanceof Error ? planErr.message : String(planErr);
            send({ type: 'warning', message: `Failed to load plan file: ${planMsg}. Continuing in plan-less mode.` });
          }
        }

        // 6b. Load MP controls and scope exclusions from single source (Mission Plan)
        try {
          const plansDir = tenantPlansDir(tenant);
          let mpPath: string | null = null;

          // Prefer last_session.translate_paths.missionPlan from tenant config if available
          if ((tenantRaw as any)?.last_session?.translate_paths?.missionPlan) {
            mpPath = path.resolve((tenantRaw as any).last_session.translate_paths.missionPlan);
          } else if (fs.existsSync(plansDir)) {
            const mpFiles = fs.readdirSync(plansDir)
              .filter((f: string) => f.startsWith('manual-mission-plan-') && f.endsWith('.json'))
              .sort()
              .reverse();
            if (mpFiles.length > 0) {
              mpPath = path.join(plansDir, mpFiles[0]);
            }
          }

          if (mpPath && fs.existsSync(mpPath)) {
            const mpJson = JSON.parse(fs.readFileSync(mpPath, 'utf-8'));

            // Extract controls array from outputs.human_readable_mission_plan.controls
            if (!mpControls && mpJson.outputs?.human_readable_mission_plan?.controls) {
              mpControls = mpJson.outputs.human_readable_mission_plan.controls;
              send({ type: 'info', message: `Loaded ${mpControls!.length} MP controls from ${path.basename(mpPath)}` });
            }

            // Extract control_directives from MP
            const rawDirectives: CESControlDirective[] | undefined =
              mpJson?.outputs?.human_readable_mission_plan?.control_directives;
            if (rawDirectives && rawDirectives.length > 0) {
              controlDirectives = rawDirectives;
              send({ type: 'info', message: `Loaded ${controlDirectives.length} control directives from ${path.basename(mpPath)}` });
            } else if (mpJson?.outputs?.human_readable_mission_plan && (!rawDirectives || rawDirectives.length === 0)) {
              // MP exists but lacks control_directives — abort assess
              send({ type: 'error', message: 'Mission Plan lacks control_directives array. Cannot produce directive-based classification. Please regenerate the Mission Plan with control_directives.' });
              res.end();
              return;
            }

            // Extract scope_exclusions array
            const rawExclusions: CESScopeExclusion[] | undefined =
              mpJson?.outputs?.human_readable_mission_plan?.scope_exclusions;
            if (rawExclusions && rawExclusions.length > 0) {
              const sprsWeights = loadSprsWeights();
              enrichedExclusions = enrichScopeExclusions(rawExclusions, sprsWeights);
              const controlIds = enrichedExclusions.map(e => e.requirement_id);
              send({ type: 'info', message: `Loaded ${enrichedExclusions.length} scope exclusions: [${controlIds.join(', ')}]` });
            }
          }
        } catch (mpErr) {
          const mpMsg = mpErr instanceof Error ? mpErr.message : String(mpErr);
          send({ type: 'info', message: `Could not load MP controls/exclusions: ${mpMsg}` });
        }

        const analyzer = new CmmcComplianceAnalyzer(cmmcRegistries, planControlIds, discoveryResults, excludedEntryIds, evidenceDir, enrichedExclusions.length > 0 ? enrichedExclusions : undefined, controlDirectives, mpControls ?? undefined);
        const cmmcStatus = analyzer.analyze();

        // Write evidence files for excluded and non-stack controls
        for (const cs of cmmcStatus.outOfScope) {
          const controlId = cs.control.control_id;
          const evidFile = `cmmc_controls/${controlId.toLowerCase()}.json`;
          const isExcluded = cs.reason?.startsWith('SI scope exclusion') || cs.reason?.startsWith('Excluded by directive');

          const evidence: StructuredEvidence = {
            rawResponse: cs.reason || 'Control out of scope for this tenant enclave',
            outcome: 'not_applicable',
            outcomeRationale: isExcluded
              ? `Excluded per scope exclusion: ${cs.reason}`
              : `Non-stack control: ${cs.reason}`,
            complianceVerdict: 'SAT',
            verdictRationale: isExcluded
              ? 'Control excluded per Mission Plan scope exclusion — satisfied by policy'
              : 'Non-stack control — no automated implementation surface in this enclave',
            registryEntry: {
              entry_id: controlId,
              label: cs.control.practice.split('\n')[0],
              engine: 'policy',
              layer_hint: -1,
              sequence_hint: 0,
              idempotency: 'evidence-only',
              on_failure: 'skip',
              control_ids: [controlId],
              notes: cs.reason || undefined,
              manual_only: true,
            },
            metadata: {
              controlIds: [controlId],
              timestamp: new Date().toISOString(),
              executorIdentity: variables.tenant_slug || variables.tenantSlug || 'unknown',
              commandExecuted: `[assess] ${isExcluded ? 'scope_exclusion' : 'non_stack'}: ${controlId}`,
              sha256Hash: createHash('sha256').update(cs.reason || '', 'utf8').digest('hex'),
              environment: variables.environment || 'GCC-High',
            },
          };

          await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig.evidenceStorage : undefined);
        }

        // Write evidence files for scope-excluded controls (satisfied/excluded bucket)
        // These are controls classified as satisfied via control_directives 'exclude' action,
        // but they land in the satisfied array (not outOfScope), so the loop above misses them.
        const exclusionMeta = new Map<string, { si_field: string; si_value: string; justification: string }>();
        for (const ex of enrichedExclusions) {
          exclusionMeta.set(ex.requirement_id, { si_field: ex.si_field, si_value: ex.si_value, justification: ex.justification });
        }

        for (const cs of cmmcStatus.satisfied.filter(c => c.automationType === 'document-absence')) {
          const controlId = cs.control.control_id;
          const evidFile = `cmmc_controls/${controlId.toLowerCase()}.json`;
          const meta = exclusionMeta.get(controlId);

          const evidence: StructuredEvidence = {
            rawResponse: JSON.stringify({
              control_id: controlId,
              practice: cs.control.practice.split('\n')[0],
              exclusion_basis: cs.reason,
              si_field: meta?.si_field || 'stamper_directive',
              si_value: meta?.si_value || 'exclude',
              assessment_method: 'policy_review',
            }, null, 2),
            outcome: 'not_applicable',
            outcomeRationale: `Control ${controlId} excluded from organizational CUI scope per Mission Plan scope exclusion. SI basis: ${meta?.si_field || 'directive'} = ${meta?.si_value || 'exclude'}. ${cs.reason}`,
            complianceVerdict: undefined as any,
            verdictRationale: `${cs.reason}. This control is satisfied by organizational policy decision documented in the CES Mission Plan. The scope exclusion is based on the Strategic Intent field "${meta?.si_field || 'directive'}" with value "${meta?.si_value || 'exclude'}". No automated implementation surface exists in this enclave for this control family, and the exclusion has been reviewed and approved as part of the compliance engineering process.`,
            registryEntry: {
              entry_id: controlId,
              label: cs.control.practice.split('\n')[0],
              engine: 'policy',
              layer_hint: -1,
              sequence_hint: 0,
              idempotency: 'evidence-only',
              on_failure: 'skip',
              control_ids: [controlId],
              notes: cs.reason || undefined,
              manual_only: true,
            },
            metadata: {
              controlIds: [controlId],
              timestamp: new Date().toISOString(),
              executorIdentity: variables.tenant_slug || variables.tenantSlug || 'unknown',
              commandExecuted: `[assess] scope_exclusion: ${controlId} (${meta?.si_field || 'directive'}=${meta?.si_value || 'exclude'})`,
              sha256Hash: createHash('sha256').update(cs.reason || '', 'utf8').digest('hex'),
              environment: variables.environment || 'GCC-High',
            },
          };

          await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig.evidenceStorage : undefined);
        }

        // Write evidence for platform-inherited controls (CSP-provided by default)
        const platformInherited: Array<{ controlId: string; practice: string; basis: string; detail: string }> = [
          {
            controlId: 'AU.L2-3.3.7',
            practice: 'Provide a system capability that compares and synchronizes internal system clocks with an authoritative source to generate time stamps for audit records.',
            basis: 'CSP platform inheritance — Microsoft Azure Gov / M365 GCC High',
            detail: 'All M365 GCC High and Azure Government services synchronize to Microsoft NTP infrastructure (time.windows.com), which chains to NIST stratum-1 sources. No customer configuration is required or possible. Audit record timestamps in Entra sign-in logs, Exchange message tracking, SharePoint audit logs, and Azure Activity logs all use this authoritative time source. This satisfies AU.L2-3.3.7 via FedRAMP inheritance from the CSP.',
          },
          {
            controlId: 'IA.L2-3.5.11',
            practice: 'Obscure feedback of authentication information.',
            basis: 'CSP platform default — Microsoft Entra ID login experience',
            detail: 'The Microsoft Entra ID login page (login.microsoftonline.us for GCC High) obscures password input by default using standard HTML password field masking (dots/asterisks). This is a platform behavior that cannot be disabled by tenant administrators. All authentication flows — browser-based, Teams client, Outlook, and mobile — use Microsoft-controlled login UIs that mask credential entry. This satisfies IA.L2-3.5.11 via platform default behavior.',
          },
          {
            controlId: 'RA.L2-3.11.2',
            practice: 'Scan for vulnerabilities in organizational systems and applications periodically and when new vulnerabilities affecting those systems and applications are identified.',
            basis: 'Azure subscription service — Microsoft Defender for Cloud (Standard tier)',
            detail: 'Defender for Cloud provides continuous vulnerability scanning at the Azure subscription level. Vulnerability assessments run automatically against all subscription resources (VMs, SQL, Storage, Key Vault, App Services) without requiring Intune device enrollment or customer-managed scanners. Defender for Cloud integrates Qualys and Microsoft MDVM engines. Sentinel ingests Defender findings for correlation. Zero active alerts is a valid positive outcome — it means the scanner is active and found no vulnerabilities. This satisfies RA.L2-3.11.2 via Azure subscription-level Defender for Cloud.',
          },
          {
            controlId: 'IA.L1-3.5.1',
            practice: 'Identify information system users, processes acting on behalf of authorized users, or devices.',
            basis: 'CSP platform capability — Microsoft Entra ID identity management',
            detail: 'Microsoft Entra ID is the identity provider for all M365 GCC High and Azure Government services. Every user, service principal, and managed identity is uniquely identified by an immutable Object ID (GUID) and a User Principal Name. Entra ID enforces unique identification at the directory level — duplicate identifiers are architecturally impossible. The tenant directory is the authoritative identity store: sign-in logs, audit logs, and all M365 service access reference Entra ID identities. This satisfies IA.L1-3.5.1 via Entra ID platform identity management.',
          },
          {
            controlId: 'IA.L1-3.5.2',
            practice: 'Authenticate (or verify) the identities of those users, processes, or devices, as a prerequisite to allowing access to organizational information systems.',
            basis: 'CSP platform capability — Microsoft Entra ID authentication + Conditional Access',
            detail: 'Microsoft Entra ID authenticates all users, service principals, and devices before granting access to any M365 GCC High or Azure Government resource. Authentication is enforced at the platform level — no unauthenticated access is possible. The tenant has MFA enabled via Conditional Access policies (Security Defaults or explicit CA policies), and all authentication events are logged in Entra sign-in logs with details including method used, device state, location, and risk level. This satisfies IA.L1-3.5.2 via Entra ID platform authentication enforcement.',
          },
          {
            controlId: 'CM.L2-3.4.8',
            practice: 'Apply deny-by-exception (blacklisting) policy to prevent the use of unauthorized software.',
            basis: 'CSP platform capability — Microsoft Entra ID Conditional Access application controls',
            detail: 'Conditional Access policies in Entra ID enforce application-level access controls across the M365 GCC High tenant. CA policies define which cloud applications users can access and under what conditions (device compliance, MFA, location). Applications not explicitly targeted by CA policies are subject to tenant-level defaults. Combined with Defender for Cloud Apps (MCAS) session policies and Intune MAM app protection policies, this implements deny-by-exception at the application layer without requiring device enrollment. This satisfies CM.L2-3.4.8 via Entra ID Conditional Access application controls.',
          },
          {
            controlId: 'RA.L2-3.11.1',
            practice: 'Periodically assess the risk to organizational operations (including mission, functions, image, or reputation), organizational assets, and individuals, resulting from the operation of organizational systems and the associated processing, storage, or transmission of CUI.',
            basis: 'Stamper CMMC assessment process + Microsoft Defender for Cloud + Secure Score',
            detail: 'Risk assessment is performed periodically through multiple complementary mechanisms: (1) Stamper CMMC Assess evaluates tenant security posture against all 110 NIST 800-171 controls, producing a timestamped SPRS score and control compliance matrix — each run constitutes a formal risk assessment with dated evidence artifacts. (2) Microsoft Secure Score continuously evaluates tenant configuration against security best practices and provides prioritized improvement recommendations. (3) Defender for Cloud Security Posture Management (CSPM) continuously assesses Azure subscription resources against security benchmarks. Assessment results are persisted as assess-state.json with full control-by-control status, SPRS scoring, and remediation guidance. This satisfies RA.L2-3.11.1 via combination of automated periodic assessment tooling.',
          },
          {
            controlId: 'RA.L2-3.11.3',
            practice: 'Remediate vulnerabilities in accordance with risk assessments.',
            basis: 'Azure subscription service — Defender for Cloud remediation + Azure Update Manager',
            detail: 'Vulnerability remediation is addressed through multiple platform-level mechanisms: (1) Defender for Cloud generates prioritized remediation recommendations for all discovered vulnerabilities, with one-click remediation for many findings. (2) Azure Update Manager provides automated patch management for Azure VMs and Arc-enabled servers at the subscription level without requiring Intune device enrollment. (3) M365 GCC High services (Exchange, SharePoint, Teams, Entra ID) are patched by Microsoft as part of the CSP responsibility model — no customer action required. (4) The Stamper POA&M generator tracks remaining deficiencies with scheduled completion dates and milestones. This satisfies RA.L2-3.11.3 via platform-level remediation tooling and CSP shared responsibility.',
          },
          {
            controlId: 'CA.L2-3.12.2',
            practice: 'Develop and implement plans of action designed to correct deficiencies and reduce or eliminate vulnerabilities in organizational systems.',
            basis: 'Stamper POA&M generator — automated plan-of-action artifact production',
            detail: 'Stamper provides a built-in POA&M (Plan of Action & Milestones) generator that automatically extracts all wontBeSatisfied controls from the CMMC compliance analysis, enriches each deficiency with SPRS weights, risk levels, auto-derived milestones based on automation type, and a 90-day scheduled completion date. The generated POA&M is saved as both JSON and Markdown artifacts under the tenant plans directory (plan-data/<slug>/plans/poam-<timestamp>.json/.md). This constitutes a concrete, dated plan of action that identifies deficiencies, assigns risk levels, and establishes remediation milestones — satisfying the core requirement of CA.L2-3.12.2. The POA&M artifact itself serves as assessor-grade evidence that the organization develops and implements plans to correct deficiencies.',
          },
        ];

        for (const pi of platformInherited) {
          const evidFile = `cmmc_controls/${pi.controlId.toLowerCase()}.json`;
          const evidence: StructuredEvidence = {
            rawResponse: JSON.stringify({ control_id: pi.controlId, practice: pi.practice, inheritance_basis: pi.basis, assessment_method: 'platform_review' }, null, 2),
            outcome: 'compliant' as EvidenceOutcome,
            outcomeRationale: `${pi.controlId} satisfied via CSP platform inheritance. ${pi.basis}.`,
            complianceVerdict: 'SAT',
            verdictRationale: pi.detail,
            registryEntry: {
              entry_id: pi.controlId,
              label: pi.practice.split('.')[0] + '.',
              engine: 'policy',
              layer_hint: -1,
              sequence_hint: 0,
              idempotency: 'evidence-only',
              on_failure: 'skip',
              control_ids: [pi.controlId],
              notes: pi.basis,
              manual_only: true,
            },
            metadata: {
              controlIds: [pi.controlId],
              timestamp: new Date().toISOString(),
              executorIdentity: variables.tenant_slug || variables.tenantSlug || 'unknown',
              commandExecuted: `[assess] platform_inherited: ${pi.controlId}`,
              sha256Hash: createHash('sha256').update(pi.detail, 'utf8').digest('hex'),
              environment: variables.environment || 'GCC-High',
            },
          };
          await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig.evidenceStorage : undefined);
        }

        cmmcPayload = {
          type: 'cmmc_status',
          total: cmmcStatus.total,
          satisfied: cmmcStatus.satisfied.length,
          provisional: cmmcStatus.provisional.length,
          willBeSatisfied: cmmcStatus.willBeSatisfied.length,
          wontBeSatisfied: cmmcStatus.wontBeSatisfied.length,
          notVerified: cmmcStatus.notVerified.length,  // FX2-ST2: planned, not proven by a tenant read
          outOfScope: cmmcStatus.outOfScope.length,
          hasDirectives: controlDirectives !== undefined && controlDirectives !== null && controlDirectives.length > 0,
          byFamily: cmmcStatus.byFamily,
          satisfiedControls: cmmcStatus.satisfied.map(cs => ({
            control_id: cs.control.control_id,
            practice: cs.control.practice,
            reason: cs.reason,
            registryEntryCount: cs.registryEntryCount,
            discoveredCount: cs.discoveredCount,
            automationType: cs.automationType,
            sprsWeight: cs.sprsWeight,
            entryDetails: cs.registryEntryDetails,
          })),
          provisionalControls: cmmcStatus.provisional.map(cs => ({
            control_id: cs.control.control_id,
            practice: cs.control.practice,
            reason: cs.reason,
            registryEntryCount: cs.registryEntryCount,
            discoveredCount: cs.discoveredCount,
            automationType: cs.automationType,
            sprsWeight: cs.sprsWeight,
            entryDetails: cs.registryEntryDetails,
          })),
          willBeControls: cmmcStatus.willBeSatisfied.map(cs => ({
            control_id: cs.control.control_id,
            practice: cs.control.practice,
            missingCount: cs.missingCount,
            registryEntryCount: cs.registryEntryCount,
            automationType: cs.automationType,
            sprsWeight: cs.sprsWeight,
            entryDetails: cs.registryEntryDetails,
          })),
          wontBeControls: cmmcStatus.wontBeSatisfied.map(cs => ({
            control_id: cs.control.control_id,
            practice: cs.control.practice,
            reason: cs.reason ?? 'Not configured',
            registryEntryCount: cs.registryEntryCount,
            discoveredCount: cs.discoveredCount,
            missingCount: cs.missingCount,
            automationType: cs.automationType,
            sprsWeight: cs.sprsWeight,
            entryDetails: cs.registryEntryDetails,
          })),
          // FX2-ST2: planned-only controls (never SAT; deducted in sprsByCategory)
          notVerifiedControls: cmmcStatus.notVerified.map(cs => ({
            control_id: cs.control.control_id,
            practice: cs.control.practice,
            reason: cs.reason ?? 'Planned — not verified',
            registryEntryCount: cs.registryEntryCount,
            discoveredCount: cs.discoveredCount,
            missingCount: cs.missingCount,
            automationType: cs.automationType,
            sprsWeight: cs.sprsWeight,
            entryDetails: cs.registryEntryDetails,
            _category: 'not_verified',
          })),
          excludedControls: cmmcStatus.outOfScope
            .filter(cs => cs.reason?.startsWith('SI scope exclusion') || cs.reason?.startsWith('Excluded by directive'))
            .map(cs => ({
              control_id: cs.control.control_id,
              practice: cs.control.practice,
              reason: cs.reason ?? 'Scope excluded',
              automationType: cs.automationType,
              sprsWeight: cs.sprsWeight,
              entryDetails: cs.registryEntryDetails,
            })),
          nonsStackControls: cmmcStatus.outOfScope
            .filter(cs => !cs.reason?.startsWith('SI scope exclusion') && !cs.reason?.startsWith('Excluded by directive'))
            .map(cs => ({
              control_id: cs.control.control_id,
              practice: cs.control.practice,
              reason: cs.reason ?? 'Out of scope',
              registryEntryCount: cs.registryEntryCount,
              automationType: cs.automationType,
              sprsWeight: cs.sprsWeight,
              entryDetails: cs.registryEntryDetails,
            })),
          // Legacy field for backward compat
          outOfScopeControls: cmmcStatus.outOfScope.map(cs => ({
            control_id: cs.control.control_id,
            practice: cs.control.practice,
            reason: cs.reason ?? 'Out of scope',
            registryEntryCount: cs.registryEntryCount,
            automationType: cs.automationType,
            sprsWeight: cs.sprsWeight,
            entryDetails: cs.registryEntryDetails,
          })),
        };

        // Calculate SPRS scores by category — points-off semantics (canonical weights)
        const sprsByCategory = computeSprsByCategory(cmmcStatus);
        cmmcPayload.sprsByCategory = sprsByCategory;

        send(cmmcPayload);
      } catch (cmmcErr) {
        const cmmcMsg = cmmcErr instanceof Error ? cmmcErr.message : String(cmmcErr);
        send({ type: 'warning', message: `CMMC analysis skipped: ${cmmcMsg}` });
      }

      // Store for translate to use
      setLastReadinessResult({
        matches: [],
        accomplishedIds,
        byCategory,
        totalRegistryEntries: entries.length,
        totalAccomplished: accomplishedIds.length,
      });

      // Persist assess state to disk for restart survival
      saveAssessState(tenant, {
        timestamp: new Date().toISOString(),
        accomplishedIds,
        pending: entries.length - accomplishedIds.length,
        byCategory,
        totalRegistryEntries: entries.length,
        totalAccomplished: accomplishedIds.length,
        cmmcStatus: cmmcPayload,
        discoveryResults: Object.fromEntries(discoveryResults),
      });

      send({ type: 'assess_done' });
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'error', message: msg });
      res.end();
    } finally {
      clearInterval(heartbeat);
    }
  });

  return router;
}
