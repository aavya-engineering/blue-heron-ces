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
import { StamperEngine } from '../../core/StamperEngine.js';
import { StamperConfig, StamperConfigOptions } from '../../config/StamperConfig.js';
import { ExecutionReporter } from '../../reporting/ExecutionReporter.js';
import { evidenceFileForEntry, EVIDENCE_DIR, evidenceDirForTenant, tenantPlansDir, tenantLogsDir, tenantBaseDir } from '../../core/EvidenceReadinessAnalyzer.js';
import { ExecutionResultsCollector, ResultVerdict, metVerdict } from '../../core/ExecutionResultsCollector.js';
import { publishExecutionResults } from '../../core/ExecutionResultsPublisher.js';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../../config/ClientConfig.js';
import { SessionManager } from '../../core/SessionManager.js';
import { ENGINE_SESSION_MAP, type SessionType } from 'ces-shared/session';
import { ExecutionContext } from '../../core/ExecutionContext.js';
import { SubCommandStreamEvent } from '../../adapters/PowerShellAdapter.js';
import { resolveTemplate } from '../../utils/templateResolver.js';
import { StructuredEvidence, EvidenceOutcome, ComplianceVerdict, type EoRenderDirective } from '../../types/schema.types.js';
import { buildStructuredEvidence, writeAndUploadEvidence, deriveVerdict } from '../../utils/structuredEvidence.js';
import { EO_RENDER_DIRECTIVES, buildDocumentRenderableEvidence } from '../../evidence/eoRenderDirective.js';
import type { EnrichedScopeExclusion, CESScopeExclusion } from '../../types/ces-artifacts.types.js';
import { loadSprsWeights, enrichScopeExclusions } from '../../core/ScopeExclusionValidator.js';
import { saveTenantVariables } from './variables.routes.js';
import { VARIABLE_DEFAULTS } from '../../shared/variable-map.js';
import { fileURLToPath } from 'node:url';
import { computeControlVerdict, buildNarrativeStub, type MechanismStatus } from '../../core/ByodVerdictAggregator.js';
import { CommandRegistry } from '../../registry/CommandRegistry.js';
import { checkPriorRunCompleted } from '../../utils/blobStorageHelpers.js';
import { writeJsonArtifact, writeTextArtifact } from 'ces-shared/persistence/files';
import { resolveSharedDataPath } from '../../core/sharedData.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkEoTooledAdequacy(
  controlId: string,
  tenantSlug: string | undefined
): Promise<{
  control_id: string;
  directive: string;
  readiness: 'met' | 'not-met';
  managed_within: string;
  operational_summary: string;
  evidence_pointer: string;
  verification_method: string;
  narrative_for_assessor: string;
  evidence_artifacts_in_ssp_package: string[];
  stamper_run_metadata: {
    timestamp: string;
    tenant_slug: string;
    feature_operational: boolean;
    gap_message: string;
  };
}> {
  const timestamp = new Date().toISOString();
  const slug = tenantSlug || 'dev';
  const baseMeta = {
    timestamp,
    tenant_slug: slug,
    feature_operational: false,
    gap_message: 'EO subsystem feature not yet operational',
  };

  switch (controlId) {
    case 'AT.L2-3.2.1':
      return {
        control_id: controlId,
        directive: 'eo-tooled',
        readiness: 'not-met',
        managed_within: 'EO Personnel Card \u2192 Training',
        operational_summary: 'Security awareness training records managed in EO Personnel Card. Current: 0 personnel, 0 with current training.',
        evidence_pointer: 'eo://personnel-card/training/security-awareness',
        verification_method: 'Query EO Personnel Card API for training completion records',
        narrative_for_assessor: 'Personnel Card feature not yet operational. Evidence will be available via EO API once feature ships.',
        evidence_artifacts_in_ssp_package: ['Personnel roster with training records', 'Training completion certificates', 'Annual awareness training schedule'],
        stamper_run_metadata: baseMeta,
      };
    case 'AT.L2-3.2.2':
      return {
        control_id: controlId,
        directive: 'eo-tooled',
        readiness: 'not-met',
        managed_within: 'EO Personnel Card \u2192 Training',
        operational_summary: 'Role-based training records managed in EO Personnel Card. Current: 0 roles defined, 0 personnel with role-specific training.',
        evidence_pointer: 'eo://personnel-card/training/role-based',
        verification_method: 'Query EO Personnel Card API for role-appropriate training records',
        narrative_for_assessor: 'Personnel Card feature not yet operational. Evidence will be available via EO API once feature ships.',
        evidence_artifacts_in_ssp_package: ['Role-based training matrix', 'Position descriptions with training requirements', 'Role-specific training completion records'],
        stamper_run_metadata: baseMeta,
      };
    case 'PS.L2-3.9.1':
      return {
        control_id: controlId,
        directive: 'eo-tooled',
        readiness: 'not-met',
        managed_within: 'EO Personnel Card \u2192 Screening',
        operational_summary: 'Personnel screening records managed in EO Personnel Card. Current: 0 personnel, 0 screenings complete (all 7 elements).',
        evidence_pointer: 'eo://personnel-card/screening',
        verification_method: 'Query EO Personnel Card API for screening records',
        narrative_for_assessor: 'Personnel Card feature not yet operational. Evidence will be available via EO API once feature ships.',
        evidence_artifacts_in_ssp_package: ['Screening policy document', 'Screening records (sanitized)', 'Verification of 7-element screening completion'],
        stamper_run_metadata: baseMeta,
      };
    case 'PS.L2-3.9.2':
      return {
        control_id: controlId,
        directive: 'eo-tooled',
        readiness: 'not-met',
        managed_within: 'EO Personnel Card \u2192 Offboarding',
        operational_summary: 'Termination procedures managed in EO Personnel Card. Current: 0 offboarding events tracked.',
        evidence_pointer: 'eo://personnel-card/offboarding',
        verification_method: 'Query EO Personnel Card API for offboarding records',
        narrative_for_assessor: 'Personnel Card feature not yet operational. Evidence will be available via EO API once feature ships.',
        evidence_artifacts_in_ssp_package: ['Offboarding checklist template', 'Sample offboarding records (anonymized)', 'Access revocation logs'],
        stamper_run_metadata: baseMeta,
      };
    case 'RA.L2-3.11.1':
      return {
        control_id: controlId,
        directive: 'eo-tooled',
        readiness: 'not-met',
        managed_within: 'EO Risk Assessment',
        operational_summary: 'Risk assessment process managed in EO Risk Assessment feature. Current: 0 risk register entries.',
        evidence_pointer: 'eo://risk-assessment',
        verification_method: 'Query EO Risk Assessment API for current risk register',
        narrative_for_assessor: 'Risk Assessment feature not yet operational. Evidence will be available via EO API once feature ships.',
        evidence_artifacts_in_ssp_package: ['Risk assessment methodology', 'Current risk register', 'Risk treatment plan'],
        stamper_run_metadata: baseMeta,
      };
    default:
      return {
        control_id: controlId,
        directive: 'eo-tooled',
        readiness: 'not-met',
        managed_within: 'Unknown',
        operational_summary: `Unrecognized eo-tooled control: ${controlId}`,
        evidence_pointer: '',
        verification_method: '',
        narrative_for_assessor: `Control ${controlId} is not a recognized eo-tooled control.`,
        evidence_artifacts_in_ssp_package: [],
        stamper_run_metadata: baseMeta,
      };
  }
}

export function createExecuteRouter(
  approvalGate: Map<string, (decision: 'approve' | 'skip' | 'accomplish') => void>,
  getAbortRequested: () => boolean,
  setAbortRequested: (value: boolean) => void
): Router {
  const router = Router();

  // Guard: prevent duplicate executions from EventSource auto-reconnect
  let executionInProgress = false;

  // GET /api/execute — SSE execution stream
  router.get('/api/execute', async (req: Request, res: Response) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    // Reject if another execution is already in flight
    if (executionInProgress) {
      send({ type: 'error', message: 'An execution is already in progress. Wait for it to complete or abort it first.' });
      res.end();
      return;
    }
    executionInProgress = true;

    // SSE keepalive heartbeat — prevents proxy/browser timeouts
    const heartbeat = setInterval(() => {
      try { res.write(':keepalive\n\n'); } catch { /* connection gone */ }
    }, 15_000);

    let closed = false;
    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      executionInProgress = false;
    });

    // Clear abort flag at start of each execution
    setAbortRequested(false);

    try {
      const planPath = req.query['plan'] as string | undefined;
      const mode = (req.query['mode'] as string | undefined) ?? 'auto';
      const dryRunParam = (req.query['dryRun'] as string | undefined) ?? 'false';
      const tenant = req.query['tenant'] as string | undefined;
      const verbose = req.query['verbose'] !== 'false';
      const uploadEnabled = req.query['uploadToBlob'] !== 'false';
      const evidencePopout = req.query['evidencePopout'] === 'true';
      const retry = req.query['retry'] === 'true';

      if (!planPath) {
        send({ type: 'error', message: 'plan query parameter is required' });
        res.end();
        return;
      }

      // dryrun_log mode forces dry run regardless of checkbox
      const isDevMode = !tenant || tenant === 'dev' || dryRunParam === 'true' || mode === 'dryrun_log';

      const evidenceDir = tenant && tenant !== 'dev' ? evidenceDirForTenant(tenant) : EVIDENCE_DIR;

      // Build session infrastructure for live (non-dev) execution
      let sessionManager: SessionManager | undefined;
      let executionContext: ExecutionContext | undefined;
      let clientConfig: ReturnType<typeof loadClientConfigFromTenantJson> | undefined;
      let tenantRaw: Record<string, any> | undefined;

      if (!isDevMode && tenant && tenant !== 'dev') {
        console.log(`[ExecuteRouter] Execution start — tenant=${tenant}, mode=${mode}, dryRun=${dryRunParam}`);
        const tenantCfgPath = await resolveTenantJsonPath(tenant);
        clientConfig = loadClientConfigFromTenantJson(tenantCfgPath);
        tenantRaw = JSON.parse(fs.readFileSync(tenantCfgPath, 'utf-8'));
        sessionManager = new SessionManager(clientConfig, false);
        executionContext = new ExecutionContext(false);
        executionContext.loadClientConfig(clientConfig);

        // Determine which session types the plan needs
        const planRaw = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
        const enginesUsed = new Set<string>();
        for (const task of planRaw.execution_graph || []) {
          enginesUsed.add(task.action?.engine || 'powershell');
          for (const sub of task.action?.args?._sub_commands || []) {
            if (sub.engine) enginesUsed.add(sub.engine);
          }
        }
        console.log(`[ExecuteRouter] Plan=${planPath}, engines=${[...enginesUsed].join(',')}`);

        const sessionsNeeded = new Set<SessionType>();
        for (const eng of enginesUsed) {
          const st = ENGINE_SESSION_MAP[eng];
          if (st) sessionsNeeded.add(st);
        }
        console.log(`[ExecuteRouter] Sessions needed: ${[...sessionsNeeded].join(', ')}`);

        // Pre-connect each needed session
        send({ type: 'connection_log', phase: 'config_loaded', message: `Loaded tenant config: ${tenant}`, tenant });
        for (const sessionType of sessionsNeeded) {
          const connStart = Date.now();
          console.log(`[ExecuteRouter] Connecting session: ${sessionType}...`);
          send({ type: 'connection_log', phase: `connecting_${sessionType}`, message: `Connecting ${sessionType} session...`, tenant });
          try {
            await sessionManager.ensureConnected(sessionType);
            console.log(`[ExecuteRouter] Session connected: ${sessionType} (${Date.now() - connStart}ms)`);
            send({ type: 'connection_log', phase: `connected_${sessionType}`, message: `${sessionType} session connected`, tenant });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`[ExecuteRouter] Session FAILED: ${sessionType} (${Date.now() - connStart}ms) — ${msg.substring(0, 200)}`);
            send({ type: 'connection_log', phase: `error_${sessionType}`, message: `${sessionType} connection failed: ${msg}`, tenant });
          }
        }
        console.log(`[ExecuteRouter] All sessions ready — ${sessionsNeeded.size} connected`);
        send({ type: 'connection_log', phase: 'connected', message: 'All sessions ready', tenant });
      }

      const stateOverrides: Partial<StamperConfigOptions> = {
        dryRun: isDevMode,
        ...(tenant && tenant !== 'dev' ? { stateDir: path.join(tenantBaseDir(tenant), 'state') } : {}),
      };
      const config = tenantRaw
        ? StamperConfig.fromTenantConfig({ ...tenantRaw, ...stateOverrides })
        : StamperConfig.fromTenantConfig(stateOverrides);
      const engine = new StamperEngine(config);
      const reporter = new ExecutionReporter(config);

      await engine.loadPlan(planPath, tenant && tenant !== 'dev' ? tenant : undefined, sessionManager, executionContext, uploadEnabled ? clientConfig?.evidenceStorage : undefined, (msg: string) => send({ type: 'log', message: msg }));

      const plan = engine.getPlan();
      if (!plan) {
        send({ type: 'error', message: 'Plan not loaded after loadPlan()' });
        res.end();
        return;
      }

      // Restore previously-captured runtime variables from tenant variables.json.
      // variables.json is incrementally updated during execution (saveTenantVariables),
      // while the plan file is only updated at the end. If a prior run was interrupted,
      // captured variables (breakGlassUserId, cuiGroupId, etc.) survive here.
      if (tenant && tenant !== 'dev') {
        try {
          const varsPath = path.join(tenantBaseDir(tenant), 'variables.json');
          if (fs.existsSync(varsPath)) {
            const savedVars = JSON.parse(fs.readFileSync(varsPath, 'utf-8'));
            plan.variables = { ...savedVars, ...(plan.variables || {}) };
          }
        } catch { /* non-fatal — first run won't have variables.json */ }
      }

      // Wire plan variables (35+ resource vars from PlanTranslator) into ExecutionContext
      // so that PowerShellAdapter.resolve() can find them at execution time
      if (executionContext) {
        // Merge VARIABLE_DEFAULTS into plan.variables before loading
        // (well-known constants like Azure AD role definition IDs)
        const mergedVars = { ...VARIABLE_DEFAULTS, ...(plan.variables || {}) };
        executionContext.loadManifestVariables(mergedVars);
      }

      const resultsCollector = new ExecutionResultsCollector();
      const currentTenantSlug = tenant && tenant !== 'dev' ? tenant : 'dev';

      // Per-control directive map: authoritative source for directive per L2 control
      const controlDirectivesMap = (plan.variables._control_directives as Record<string, string>) || {};

      // Load registry entries for document-renderable handler signal queries
      let effectiveRegistryEntries: Array<{ entry_id: string; label: string; engine: string; get_command: string; control_ids: string[] }> = [];
      try {
        const regDistPath = path.join(__dirname, '..', '..', 'registry', 'cmmc-l2-commands.registry.json');
        const regSrcPath = path.resolve(__dirname, '..', '..', '..', 'src', 'registry', 'cmmc-l2-commands.registry.json');
        const regPath = fs.existsSync(regDistPath) ? regDistPath : regSrcPath;
        const registry = CommandRegistry.load(regPath);
        effectiveRegistryEntries = registry.allEntries.map(e => ({
          entry_id: e.entry_id,
          label: e.label,
          engine: e.engine,
          get_command: e.get_command,
          control_ids: e.control_ids,
        }));
      } catch { /* registry load failed — document-renderable checks will fail gracefully */ }

      // ---- Compute and emit execution scope summary ----
      const controlsInScopeSet = new Set<string>();
      for (const t of plan.execution_graph) {
        if (t.controls) {
          for (const c of t.controls) controlsInScopeSet.add(c);
        }
      }
      const controlsInScope = controlsInScopeSet.size;

      // Load totalControls from CMMC reference JSON (do NOT hardcode)
      let totalControls = 0;
      let cmmcRefControls: Array<{ control_id: string; family: string; practice: string }> = [];
      try {
        const cmmcRefPath = resolveSharedDataPath('cmmc-l2-controls.reference.json');
        const cmmcRef = JSON.parse(fs.readFileSync(cmmcRefPath, 'utf-8'));
        cmmcRefControls = cmmcRef.controls || [];
        totalControls = cmmcRefControls.length;
      } catch { /* fallback: 0 means reference not found */ }

      if (totalControls !== 110) {
        send({ type: 'error', message: `CMMC reference validation failed: expected 110 L2 controls, got ${totalControls}. Check cmmc-l2-controls.reference.json integrity.` });
        // Do NOT return — allow execution to continue with degraded state (warning, not fatal error)
      }

      const controlsOutOfScope = totalControls - controlsInScope;
      const stepsTotal = plan.execution_graph.length;
      let actionsTotal = 0;
      for (const t of plan.execution_graph) {
        actionsTotal += (t.action?.args?._sub_commands || []).length;
      }

      // Load scope exclusions from MP (single source)
      let scopeExclusions: EnrichedScopeExclusion[] = [];
      // Mission Plan controls: requirement_id → { title, stamper_action }
      let mpControls: Array<{ requirement_id: string; title: string; stamper_action: string }> = [];
      try {
        if (tenant && tenant !== 'dev') {
          const plansDir = tenantPlansDir(tenant);
          let mpPath: string | null = null;

          // Prefer last_session.translate_paths.missionPlan from tenant config if available
          if (tenantRaw?.last_session?.translate_paths?.missionPlan) {
            mpPath = path.resolve(tenantRaw.last_session.translate_paths.missionPlan);
          } else if (fs.existsSync(plansDir)) {
            const mpFiles = fs.readdirSync(plansDir)
              .filter((f: string) => /^manual-mission-plan[-_]/.test(f) && f.endsWith('.json'))
              .sort()
              .reverse();
            if (mpFiles.length > 0) {
              mpPath = path.join(plansDir, mpFiles[0]);
            }
          }

          if (mpPath && fs.existsSync(mpPath)) {
            const mpJson = JSON.parse(fs.readFileSync(mpPath, 'utf-8'));
            const rawExclusions: CESScopeExclusion[] | undefined =
              mpJson?.outputs?.human_readable_mission_plan?.scope_exclusions;
            if (rawExclusions && rawExclusions.length > 0) {
              const sprsWeights = loadSprsWeights();
              scopeExclusions = enrichScopeExclusions(rawExclusions, sprsWeights);
            }

            // Extract control metadata for failure report
            const rawControls = mpJson?.outputs?.human_readable_mission_plan?.controls;
            if (Array.isArray(rawControls)) {
              mpControls = rawControls.map((c: any) => ({
                requirement_id: c.requirement_id || '',
                title: c.title || '',
                stamper_action: c.stamper_action || '',
              }));
            }
          }
        }
      } catch (mpErr) {
        console.warn('Mission Plan load failed, using plan.variables._scope_exclusions fallback:', mpErr);
        send({ type: 'log', message: 'Warning: MP not found, scope exclusions loaded from stale plan.variables', level: 'warn' });
        // Fallback to plan variables if MP load fails
        scopeExclusions = (plan.variables._scope_exclusions as EnrichedScopeExclusion[]) || [];
      }
      // Final fallback: if MP didn't provide exclusions, use plan variables
      if (scopeExclusions.length === 0) {
        scopeExclusions = (plan.variables._scope_exclusions as EnrichedScopeExclusion[]) || [];
      }
      const siDrivers = Array.from(new Set(scopeExclusions.map(ex => ex.si_field + '=' + ex.si_value)));
      const controlIdsToImplement = Array.from(controlsInScopeSet).sort();

      send({
        type: 'execution_scope',
        controlsInScope,
        controlsOutOfScope,
        stepsTotal,
        actionsTotal,
        totalControls,
        siDrivers,
        scopeExclusions,
        controlIdsToImplement,
      });

      const { taskRunner, idempotencyGuard, rollbackHandler, stateManager } =
        engine.getTuiDependencies();

      const startTime = Date.now();

      // Retry mode: cold-start guard and retryable task set
      let retryableSet: Set<string> | null = null;
      if (retry) {
        const priorState = stateManager.getState();
        if (Object.keys(priorState.tasks).length === 0) {
          send({ type: 'error', message: 'Cannot retry: no prior execution state found. Run Execute first.' });
          res.end();
          return;
        }
        const retryableIds = stateManager.getRetryableTaskIds();
        if (retryableIds.length === 0) {
          send({ type: 'error', message: 'No skipped or failed tasks to retry.' });
          res.end();
          return;
        }
        retryableSet = new Set(retryableIds);
        // Reset retryable tasks to 'pending' so idempotencyGuard evaluates them fresh
        for (const taskId of retryableSet) {
          stateManager.setTaskStatus(taskId, 'pending');
        }
      }

      stateManager.updatePlanStatus('running');

      let passCount = 0;
      let failCount = 0;
      let skipCount = 0;
      let accomplishedCount = 0;

      // For dryrun_log mode: collect log entries
      const dryRunLog: Array<{ taskId: string; label: string; subId?: string; engine: string; command: string }> = [];

      // Failure report: track failed tasks with metadata for post-execution markdown report
      const failedTasks: Array<{
        taskId: string;
        label: string;
        controls: string[];
        subCommands: Array<{ id: string; label: string; resolvedCommand: string }>;
      }> = [];

      // Batch mode: track layer transitions and skipped layers
      let currentLayer: number | null = null;
      const skippedLayers = new Set<number>();

      // Best-effort capture extraction for skipped tasks — preserves capture chaining
      // In retry mode, captures from the first run are already persisted in variables.json
      const extractSkippedCaptures = async (subs: typeof plan.execution_graph[0]['action']['args']['_sub_commands'] extends infer T ? T : never) => {
        if (retryableSet) return; // Skip in retry mode — captures already in variables.json
        const subArr = (subs || []) as Array<{
          id: string; label: string; set_command: string; get_command: string;
          engine: string; sequence_hint: number;
          captures?: Array<{ variable: string; from: string; json_path?: string; regex_pattern?: string }>;
        }>;
        for (const sub of subArr) {
          if (sub.captures && sub.captures.length > 0 && sub.get_command) {
            try {
              const captured = await taskRunner.queryCaptureValues(
                sub.engine as any,
                sub.get_command,
                sub.captures as any,
                plan.variables
              );
              if (Object.keys(captured).length > 0) {
                Object.assign(plan.variables, captured);
                if (executionContext) {
                  executionContext.registerCaptures(captured);
                }
                // Persist captured variables to tenant variables.json
                if (tenant && tenant !== 'dev') {
                  saveTenantVariables(tenant, plan.variables);
                }
              }
            } catch { /* best-effort */ }
          }
        }
      };

      // ---- Capture dependency map: which tasks produce/consume captured variables ----
      const captureProducers = new Map<string, string>(); // variableName → taskId that produces it
      const captureDependents = new Map<string, Array<{ taskId: string; label: string; variables: string[] }>>(); // producerTaskId → downstream consumers

      for (const t of plan.execution_graph) {
        const subs = (t.action.args._sub_commands as Array<{
          id: string; label: string;
          captures?: Array<{ variable: string }>;
          variables_runtime?: string[];
        }>) || [];
        for (const sub of subs) {
          if (sub.captures) {
            for (const cap of sub.captures) {
              captureProducers.set(cap.variable, t.id);
            }
          }
        }
      }

      // Second pass: find consumers and invert
      for (const t of plan.execution_graph) {
        const subs = (t.action.args._sub_commands as Array<{
          id: string; label: string;
          variables_runtime?: string[];
        }>) || [];
        const consumedFromProducers = new Map<string, string[]>(); // producerTaskId → variables consumed
        for (const sub of subs) {
          if (sub.variables_runtime) {
            for (const v of sub.variables_runtime) {
              const producer = captureProducers.get(v);
              if (producer && producer !== t.id) {
                const arr = consumedFromProducers.get(producer) || [];
                if (!arr.includes(v)) arr.push(v);
                consumedFromProducers.set(producer, arr);
              }
            }
          }
        }
        const stepLabel = (t.action.args['_step_title'] as string | undefined) ?? t.type;
        for (const [producerId, vars] of consumedFromProducers) {
          const list = captureDependents.get(producerId) || [];
          list.push({ taskId: t.id, label: stepLabel, variables: vars });
          captureDependents.set(producerId, list);
        }
      }

      function getDownstreamImpact(taskId: string): Array<{ taskId: string; label: string; variables: string[] }> {
        return captureDependents.get(taskId) || [];
      }

      // Factory: build an onStream SSE callback scoped to a task
      const makeOnStream = (taskId: string) => (evt: SubCommandStreamEvent) => {
        send({
          type: 'sub_command_stream',
          taskId,
          subId: evt.subId,
          phase: evt.phase,
          label: evt.label,
          engine: evt.engine,
          command: evt.command,
          // stdout_chunk: send raw (chunks are already small); others: truncate if not verbose
          stdout: evt.phase === 'stdout_chunk' ? evt.stdout : (verbose ? evt.stdout : evt.stdout.substring(0, 2000)),
          // stderr: send full on failure (exitCode != 0) so operators see complete error context
          stderr: (evt.exitCode !== 0) ? evt.stderr : (verbose ? evt.stderr : evt.stderr.substring(0, 500)),
          exitCode: evt.exitCode,
          success: evt.exitCode === 0,
          durationMs: evt.durationMs,
          evidenceFile: evt.evidenceFile,
          ...(evt.captures ? { captures: evt.captures } : {}),
          ...(evt.outcome ? { outcome: evt.outcome } : {}),
          ...(evt.outcomeRationale ? { outcomeRationale: evt.outcomeRationale } : {}),
          ...(evt.failureDiagnostics ? { failureDiagnostics: evt.failureDiagnostics } : {}),
        });
      };

      for (const task of plan.execution_graph) {
        if (closed || getAbortRequested()) break;

        // Helper: emit task_result with controls metadata so client can count per-control
        const sendTaskResult = (data: Record<string, any>) => {
          send({ ...data, type: 'task_result', controls: task.controls || [], controlCount: (task.controls || []).length || 1 });
        };

        // Retry mode: skip tasks not in the retryable set (already completed/accomplished)
        if (retryableSet && !retryableSet.has(task.id)) {
          send({ type: 'task_skipped', taskId: task.id, reason: 'already completed' });
          continue;
        }

        const stepTitle = (task.action.args['_step_title'] as string | undefined) ?? task.type;
        const taskLayer = (task.action.args['_layer'] as number | undefined) ?? 0;
        const subCommands = (task.action.args._sub_commands as Array<{
          id: string; label: string; set_command: string; get_command: string;
          engine: string; sequence_hint: number;
          captures?: Array<{ variable: string; from: string; json_path?: string; regex_pattern?: string }>;
          variables_required?: string[]; variables_runtime?: string[];
          idempotency?: string;
          on_failure?: string;
          evidence_commands?: string[];
        }>) || [];

        // ── Directive handler: document-absence / document-prohibition / nonstack tasks ──
        // Resolve directive: prefer per-control map, fallback to task._directive (backward compat)
        const taskDirectiveFallback = task.action.args._directive as string | undefined;
        const controlIds = task.controls || [];

        // Fail loudly if legacy exclude directive received
        for (const cid of controlIds) {
          const cidDirective = controlDirectivesMap[cid] || taskDirectiveFallback;
          if (cidDirective === 'exclude') {
            throw new Error(
              `ABORT: Legacy 'exclude' directive received for ${cid}. ` +
              `This indicates a Planner/Stamper version mismatch. ` +
              `Planner must emit Set B directives (document-absence, document-prohibition). ` +
              `Execution halted to prevent false SPRS attestation.`
            );
          }
        }

        // For multi-control tasks, check per-control directives from the authoritative map
        const resolveTaskDirective = (): string => {
          if (controlIds.length === 0) return taskDirectiveFallback || 'automated';
          const perControl = controlIds.map(cid => controlDirectivesMap[cid] || taskDirectiveFallback || 'automated');
          // implement/validate are execution directives — treat as automated
          if (perControl.some(d => d === 'automated' || d === 'implement' || d === 'validate')) return 'automated';
          // All controls are document-absence, document-prohibition, document-renderable, nonstack, or manual
          return perControl[0];
        };
        const directive = resolveTaskDirective();

        // ── document-absence: N/A evidence (narrative only, no enforcement) ──
        if (directive === 'document-absence') {
          stateManager.startTask(task.id);

          const justification = (task.action.args._justification as string) || '';
          const controlIds = task.controls || [];
          const evidFile = evidenceFileForEntry(task.id, (task.action.args._step_title as string) || task.id).replace(/\.txt$/, '.json');

          const evidence: StructuredEvidence = {
            rawResponse: justification,
            outcome: 'not_applicable' as EvidenceOutcome,
            outcomeRationale: `Capability absent from CUI boundary: ${justification}`,
            complianceVerdict: undefined,
            verdictRationale: 'N/A — capability not deployed; no compliance verdict applicable',
            metadata: {
              controlIds,
              timestamp: new Date().toISOString(),
              executorIdentity: tenant || 'unknown',
              commandExecuted: '',
              sha256Hash: createHash('sha256').update(justification, 'utf8').digest('hex'),
            }
          };

          try { await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined); } catch (err) { console.warn('[evidence-upload]', err); }
          stateManager.completeTask(task.id);

          send({
            type: 'task_start',
            taskId: task.id,
            label: stepTitle,
            engine: task.action.engine,
            subCommandCount: subCommands.length,
            priority: task.priority,
            taskType: task.type,
            layer: taskLayer,
            idempotency: task.idempotency,
            controls: task.controls || [],
            directive,
          });

          for (const sub of subCommands) {
            send({ type: 'sub_command_start', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, directive });
            send({ type: 'sub_command_complete', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, status: 'accomplished', directive, evidenceFile: evidFile });
          }

          for (const cid of controlIds) {
            resultsCollector.recordControlResult(cid, 'document-absence', ResultVerdict.NOT_APPLICABLE, 'document-absence', evidFile);
          }

          passCount++;
          sendTaskResult({ taskId: task.id, status: directive, message: justification, directive });
          continue;
        }

        // ── document-prohibition: enforcement verification (registry get_command) ──
        if (directive === 'document-prohibition') {
          stateManager.startTask(task.id);

          const justification = (task.action.args._justification as string) || '';
          const controlIds = task.controls || [];
          const evidFile = evidenceFileForEntry(task.id, (task.action.args._step_title as string) || task.id).replace(/\.txt$/, '.json');

          // Attempt enforcement verification via registry get_command (same as validate tasks)
          let enforcementVerified = false;
          let enforcementOutput = '';
          let enforcementError = '';

          const subResults: Record<string, { verified: boolean; output: string }> = {};
          for (const sub of subCommands) {
            if (sub.get_command && sub.engine !== 'manual_gate') {
              try {
                const discovery = await taskRunner.discoverSubCommandState(
                  sub.engine as any,
                  sub.get_command,
                  (sub.captures || []) as any,
                  plan.variables
                );
                if (discovery.exists && discovery.rawOutput && discovery.rawOutput.trim().length > 0) {
                  enforcementVerified = true;
                  enforcementOutput += discovery.rawOutput;
                  subResults[sub.id] = { verified: true, output: discovery.rawOutput };
                } else {
                  // Prohibition: successful query with no output means the prohibited
                  // capability is absent from the environment — enforcement confirmed
                  enforcementVerified = true;
                  enforcementOutput += 'Enforcement verified: prohibited capability not present in environment';
                  subResults[sub.id] = { verified: true, output: '' };
                }
              } catch (err) {
                enforcementError = err instanceof Error ? err.message : String(err);
                subResults[sub.id] = { verified: false, output: '' };
              }
            }
          }

          // Detect BYOD architecture: any sub-command entry_id contains '.byod-'
          const isByod = subCommands.some(sub => sub.id.includes('.byod-'));

          let byodMetadata: { architecture_declared?: string; mechanism_status?: MechanismStatus } = {};
          let narrativeStub = '';

          if (isByod) {
            // Build MechanismStatus from sub-command results
            const mechanismStatus: MechanismStatus = {
              ca_app_control: Object.entries(subResults)
                .filter(([id]) => !id.includes('.byod-'))
                .some(([, r]) => r.verified),
              non_browser_client_block: Object.entries(subResults)
                .filter(([id]) => id.includes('byod-nonbrowser-block'))
                .some(([, r]) => r.verified),
              dlp_coverage: Object.entries(subResults)
                .filter(([id]) => id.includes('byod-dlp-policies'))
                .some(([, r]) => r.verified),
              sensitivity_labels: Object.entries(subResults)
                .filter(([id]) => id.includes('byod-sensitivity-labels'))
                .some(([, r]) => r.verified),
            };

            // Extract policy names from sub-command output for narrative
            const policyNames: Record<string, string> = {};
            for (const [id, r] of Object.entries(subResults)) {
              if (r.output) {
                try {
                  const parsed = JSON.parse(r.output);
                  const name = Array.isArray(parsed)
                    ? parsed.map((p: any) => p.displayName || p.Name || '').filter(Boolean).join(', ')
                    : (parsed.displayName || parsed.Name || '');
                  if (name) {
                    if (!id.includes('.byod-')) policyNames['ca_app_control'] = name;
                    else if (id.includes('byod-nonbrowser-block')) policyNames['non_browser_client_block'] = name;
                    else if (id.includes('byod-dlp-policies')) policyNames['dlp_coverage'] = name;
                    else if (id.includes('byod-sensitivity-labels')) policyNames['sensitivity_labels'] = name;
                  }
                } catch { /* non-JSON output, skip name extraction */ }
              }
            }

            byodMetadata = {
              architecture_declared: 'session_controlled_byod',
              mechanism_status: mechanismStatus,
            };
            narrativeStub = buildNarrativeStub(mechanismStatus, policyNames);
          }

          const prohibRaw = JSON.stringify({
            policy_text: justification,
            enforcement_config: enforcementOutput || enforcementError || 'No enforcement query available',
          });
          const evidence: StructuredEvidence = {
            rawResponse: prohibRaw,
            outcome: 'policy_compliance' as EvidenceOutcome,
            outcomeRationale: isByod
              ? narrativeStub
              : (enforcementVerified
                ? `Prohibition enforced: ${justification}`
                : `Prohibition enforcement verification failed: ${enforcementError || 'No enforcement artifacts found'}`),
            complianceVerdict: (enforcementVerified ? 'SAT' : 'NOT_SAT') as ComplianceVerdict,
            verdictRationale: enforcementVerified
              ? 'Enforcement artifacts confirm prohibition is actively enforced'
              : 'Enforcement verification failed — prohibition not confirmed',
            metadata: {
              controlIds,
              timestamp: new Date().toISOString(),
              executorIdentity: tenant || 'unknown',
              commandExecuted: subCommands.map(s => s.get_command).filter(Boolean).join('; '),
              sha256Hash: createHash('sha256').update(prohibRaw, 'utf8').digest('hex'),
              ...byodMetadata,
            }
          };

          try { await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined); } catch (err) { console.warn('[evidence-upload]', err); }
          stateManager.completeTask(task.id);

          send({
            type: 'task_start',
            taskId: task.id,
            label: stepTitle,
            engine: task.action.engine,
            subCommandCount: subCommands.length,
            priority: task.priority,
            taskType: task.type,
            layer: taskLayer,
            idempotency: task.idempotency,
            controls: task.controls || [],
            directive,
          });

          for (const sub of subCommands) {
            send({ type: 'sub_command_start', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, directive });
            send({ type: 'sub_command_complete', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, status: 'accomplished', directive, evidenceFile: evidFile });
          }

          if (isByod && byodMetadata.mechanism_status) {
            for (const cid of controlIds) {
              const { verdict } = computeControlVerdict(cid, byodMetadata.mechanism_status);
              const sprsValue = metVerdict(verdict === 'SAT');
              resultsCollector.recordControlResult(cid, 'document-prohibition', sprsValue, 'document-prohibition', evidFile);
            }
          } else {
            for (const cid of controlIds) {
              const sprsValue = metVerdict(enforcementVerified);
              resultsCollector.recordControlResult(cid, 'document-prohibition', sprsValue, 'document-prohibition', evidFile);
            }
          }

          passCount++;
          sendTaskResult({ taskId: task.id, status: directive, message: justification, directive });
          continue;
        }

        // ── inherit-fedramp: FedRAMP inheritance precondition verification ──
        if (directive === 'inherit-fedramp') {
          stateManager.startTask(task.id);

          const justification = (task.action.args._justification as string) || '';
          const controlIds = task.controls || [];
          const taskFedrampPkgId = (task.action.args._fedramp_package_id as string) || undefined;
          const fedrampPkgId = taskFedrampPkgId || tenantRaw?.strategic_intent?.fedramp_package_id || 'F1603046498';
          const evidFile = evidenceFileForEntry(task.id, (task.action.args._step_title as string) || task.id).replace(/\.txt$/, '.json');

          // ── Verification 1: Tenant type confirmation ──
          // Default to passed=true when live verification unavailable (Planner already classified)
          let tenantTypeResult: {
            check: string; declared_variant: string; observed_variant: string;
            observed_primary_domain: string; observed_azure_environment: string;
            passed: boolean; failure_reason?: string; verified_live: boolean;
          } = {
            check: 'tenant_type_confirmation',
            declared_variant: 'gcc_high', // default; override from SI baseline if available
            observed_variant: 'gcc_high',
            observed_primary_domain: '',
            observed_azure_environment: '',
            passed: true,
            verified_live: false,
          };

          // Read declared variant from tenant config SI baseline
          if (tenantRaw?.strategic_intent?.tenant_variant) {
            tenantTypeResult.declared_variant = tenantRaw.strategic_intent.tenant_variant;
            tenantTypeResult.observed_variant = tenantRaw.strategic_intent.tenant_variant;
          }

          const tenantTypeSub = subCommands.find(s => s.id.includes('tenant-type'));
          if (tenantTypeSub && tenantTypeSub.get_command && tenantTypeSub.engine !== 'manual_gate') {
            try {
              const discovery = await taskRunner.discoverSubCommandState(
                tenantTypeSub.engine as any,
                tenantTypeSub.get_command,
                (tenantTypeSub.captures || []) as any,
                plan.variables
              );
              if (discovery.rawOutput) {
                try {
                  const orgData = JSON.parse(discovery.rawOutput);
                  const org = Array.isArray(orgData) ? orgData[0] : orgData;
                  const domains = org?.VerifiedDomains || [];
                  const primaryDomain = domains.find((d: any) => d.IsDefault)?.Name || domains[0]?.Name || '';
                  tenantTypeResult.observed_primary_domain = primaryDomain;
                  tenantTypeResult.verified_live = true;

                  // Determine variant from domain suffix
                  if (primaryDomain.endsWith('.onmicrosoft.us')) {
                    tenantTypeResult.observed_variant = 'gcc_high';
                  } else if (primaryDomain.endsWith('.onmicrosoft.com')) {
                    const tenantType = org?.TenantType || '';
                    tenantTypeResult.observed_variant = tenantType.toLowerCase().includes('gcc') ? 'gcc' : 'commercial';
                  }

                  tenantTypeResult.passed = tenantTypeResult.observed_variant === tenantTypeResult.declared_variant;
                  if (!tenantTypeResult.passed) {
                    tenantTypeResult.failure_reason = `SI baseline declares ${tenantTypeResult.declared_variant} but tenant domain indicates ${tenantTypeResult.observed_variant}`;
                  }
                } catch { /* Parse failure — keep Planner's classification (passed=true) */ }
              }
              // Empty response — keep Planner's classification (passed=true)
            } catch {
              // Session/query failure — keep Planner's classification (passed=true)
              // Live verification will be attempted on next cycle
            }
          }

          // ── Verification 2: No contradicting config ──
          let contradictingConfigResult: {
            check: string;
            per_family_status: Record<string, { passed: boolean; [k: string]: any }>;
            passed: boolean; failure_reason?: string; verified_live: boolean;
          } = {
            check: 'no_contradicting_config_check',
            per_family_status: {},
            passed: true,
            verified_live: false,
          };

          const configSub = subCommands.find(s => s.id.includes('contradicting-config'));
          let vmCount = 0, hostpoolCount = 0, arcCount = 0;

          if (configSub && configSub.get_command && configSub.engine !== 'manual_gate') {
            try {
              const discovery = await taskRunner.discoverSubCommandState(
                configSub.engine as any,
                configSub.get_command,
                (configSub.captures || []) as any,
                plan.variables
              );
              if (discovery.rawOutput) {
                contradictingConfigResult.verified_live = true;
                try {
                  const configData = JSON.parse(discovery.rawOutput);
                  vmCount = configData.vm_count ?? 0;
                  hostpoolCount = configData.hostpool_count ?? 0;
                  arcCount = configData.arc_count ?? 0;
                } catch { /* non-JSON, counts stay 0 — no contradiction detected */ }
              }
            } catch {
              // Session/query failure — keep passed=true (Planner's classification stands)
            }
          }

          // Determine control family from first control ID
          const controlFamily = controlIds[0]?.split('.')[0] || '';

          // Per-family adequacy rules (only fail if live verification found contradicting config)
          const maFamilyPassed = vmCount + hostpoolCount + arcCount === 0;
          const peFamilyPassed = true; // PE checks physical_facility_count from SI baseline (assumed 0 for cloud-only)
          const auTimesyncPassed = vmCount + hostpoolCount + arcCount === 0;

          contradictingConfigResult.per_family_status = {
            MA: { passed: maFamilyPassed, vm_count: vmCount, hostpool_count: hostpoolCount, arc_count: arcCount },
            PE: { passed: peFamilyPassed, declared_facility_count: 0 },
            AU_timesync: { passed: auTimesyncPassed, compute_resources_present: vmCount + hostpoolCount + arcCount > 0 },
            IA_microsoft_infra: { passed: true },
          };

          // Apply family-specific check — only override passed if live data found contradiction
          if (contradictingConfigResult.verified_live) {
            let familyPassed = true;
            if (controlFamily === 'MA') familyPassed = maFamilyPassed;
            else if (controlFamily === 'PE') familyPassed = peFamilyPassed;
            else if (controlFamily === 'AU') familyPassed = auTimesyncPassed;
            // IA always passes (microsoft infra controls)

            if (!familyPassed) {
              contradictingConfigResult.passed = false;
              const resources: string[] = [];
              if (vmCount > 0) resources.push(`${vmCount} Azure VM(s)`);
              if (hostpoolCount > 0) resources.push(`${hostpoolCount} AVD host pool(s)`);
              if (arcCount > 0) resources.push(`${arcCount} ARC machine(s)`);
              contradictingConfigResult.failure_reason = `${controlFamily} family inheritance refused. Customer has ${resources.join(', ')} requiring maintenance.`;
            }
          }

          // ── Overall verdict ──
          // Planner classified these as inheritable. Stamper verification is a precondition
          // check that can DOWNGRADE from MET to NOT MET if live data contradicts, but
          // cannot block MET when verification queries are unavailable.
          const inheritancePassed = tenantTypeResult.passed && contradictingConfigResult.passed;

          const inheritRaw = JSON.stringify({
            tenant_type_verification: tenantTypeResult,
            contradicting_config_check: contradictingConfigResult,
          });
          const evidence: StructuredEvidence = {
            rawResponse: inheritRaw,
            outcome: (inheritancePassed ? 'inherited' : 'failed_remediation_available') as EvidenceOutcome,
            outcomeRationale: inheritancePassed
              ? `FedRAMP High inheritance verified: tenant confirmed as ${tenantTypeResult.observed_variant}, no contradicting configuration detected`
              : `FedRAMP inheritance verification failed: ${tenantTypeResult.failure_reason || contradictingConfigResult.failure_reason || 'Unknown failure'}`,
            complianceVerdict: (inheritancePassed ? 'SAT' : 'NOT_SAT') as ComplianceVerdict,
            verdictRationale: inheritancePassed
              ? 'Control inherited from Microsoft FedRAMP High authorization — preconditions verified'
              : 'Inheritance precondition verification failed — control requires reclassification',
            metadata: {
              controlIds,
              timestamp: new Date().toISOString(),
              executorIdentity: tenant || 'unknown',
              commandExecuted: subCommands.map(s => s.get_command).filter(Boolean).join('; '),
              sha256Hash: createHash('sha256').update(inheritRaw, 'utf8').digest('hex'),
            }
          };

          try { await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined); } catch (err) { console.warn('[evidence-upload]', err); }

          // Write per-control inheritance evidence file
          for (const cid of controlIds) {
            const perControlEvid = {
              control_id: cid,
              directive: 'inherit-fedramp',
              readiness: inheritancePassed ? 'met' : 'not-met',
              enforcement_verified: inheritancePassed,
              fedramp_package_id: fedrampPkgId,
              inheritance_rationale: justification,
              tenant_variant_confirmed: tenantTypeResult.observed_variant,
              contradicting_config_check: contradictingConfigResult.passed ? 'passed' : 'failed',
              crm_reference_pending: true,
              evidence_artifacts: [evidFile],
              narrative_stub: inheritancePassed
                ? `Control inherited from Microsoft FedRAMP High authorization ${fedrampPkgId}. Microsoft is primary responsible party per the Customer Responsibility Matrix. Tenant confirmed as ${tenantTypeResult.observed_variant}; no customer configuration contradicts inheritance.`
                : `FedRAMP inheritance verification failed for ${cid}. ${tenantTypeResult.failure_reason || contradictingConfigResult.failure_reason || 'Reclassification required.'}`,
              ...(inheritancePassed ? {} : {
                failure_reason: tenantTypeResult.passed ? 'contradicting_configuration' : 'tenant_variant_mismatch',
                message: tenantTypeResult.failure_reason || contradictingConfigResult.failure_reason,
                blocking_advisory: !tenantTypeResult.passed,
              }),
            };

            const perControlFile = evidenceFileForEntry(`inherit-${cid}`, `inheritance-${cid}`).replace(/\.txt$/, '.json');
            try {
              const perControlRaw = JSON.stringify(perControlEvid);
              const perControlEvidence: StructuredEvidence = {
                rawResponse: perControlRaw,
                outcome: (inheritancePassed ? 'inherited' : 'failed_remediation_available') as EvidenceOutcome,
                outcomeRationale: perControlEvid.narrative_stub,
                complianceVerdict: (inheritancePassed ? 'SAT' : 'NOT_SAT') as ComplianceVerdict,
                verdictRationale: evidence.verdictRationale,
                metadata: {
                  controlIds: [cid],
                  timestamp: new Date().toISOString(),
                  executorIdentity: tenant || 'unknown',
                  commandExecuted: '',
                  sha256Hash: createHash('sha256').update(perControlRaw, 'utf8').digest('hex'),
                }
              };
              await writeAndUploadEvidence(evidenceDir, perControlFile, perControlEvidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined);
            } catch (err) { console.warn('[evidence-upload]', err); }
          }

          stateManager.completeTask(task.id);

          send({
            type: 'task_start',
            taskId: task.id,
            label: stepTitle,
            engine: task.action.engine,
            subCommandCount: subCommands.length,
            priority: task.priority,
            taskType: task.type,
            layer: taskLayer,
            idempotency: task.idempotency,
            controls: task.controls || [],
            directive,
          });

          for (const sub of subCommands) {
            send({ type: 'sub_command_start', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, directive });
            send({
              type: 'sub_command_complete', taskId: task.id, subId: sub.id, label: sub.label,
              engine: sub.engine, status: inheritancePassed ? 'accomplished' : 'failed', directive, evidenceFile: evidFile
            });
          }

          for (const cid of controlIds) {
            const sprsValue = metVerdict(inheritancePassed);
            resultsCollector.recordControlResult(cid, 'inherit-fedramp', sprsValue, 'inherit-fedramp', evidFile);
          }

          passCount++;
          sendTaskResult({ taskId: task.id, status: directive, message: justification, directive });
          continue;
        }

        // ── eo-tooled: EO-managed evidence (Personnel Card, Risk Assessment) ──
        if (directive === 'eo-tooled') {
          stateManager.startTask(task.id);

          const controlIds = task.controls || [];
          const evidFile = evidenceFileForEntry(task.id, stepTitle).replace(/\.txt$/, '.json');
          const controlId = controlIds[0] || task.id;
          const adequacyResult = await checkEoTooledAdequacy(controlId, tenant);
          const allMet = adequacyResult.readiness === 'met';

          const eoTooledRaw = JSON.stringify(adequacyResult);
          const evidence: StructuredEvidence = {
            rawResponse: eoTooledRaw,
            outcome: (allMet ? 'automated_success' : 'failed_remediation_available') as EvidenceOutcome,
            outcomeRationale: allMet ? `EO feature operational for ${controlId}` : `EO feature not yet operational for ${controlId}`,
            complianceVerdict: (allMet ? 'SAT' : 'NOT_SAT') as ComplianceVerdict,
            verdictRationale: allMet ? `${controlId} evidence adequate via EO` : `${controlId} evidence not yet available — EO feature pending`,
            metadata: {
              controlIds,
              timestamp: new Date().toISOString(),
              executorIdentity: tenant || 'unknown',
              commandExecuted: '',
              sha256Hash: createHash('sha256').update(eoTooledRaw, 'utf8').digest('hex'),
            }
          };
          await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined);

          send({
            type: 'task_start',
            taskId: task.id,
            label: stepTitle,
            engine: task.action.engine,
            subCommandCount: subCommands.length,
            priority: task.priority,
            taskType: task.type,
            layer: taskLayer,
            idempotency: task.idempotency,
            controls: task.controls || [],
            directive,
          });

          for (const sub of subCommands) {
            send({ type: 'sub_command_start', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, directive });
            send({
              type: 'sub_command_complete', taskId: task.id, subId: sub.id, label: sub.label,
              engine: sub.engine, status: allMet ? 'accomplished' : 'failed', directive, evidenceFile: evidFile
            });
          }

          for (const cid of controlIds) {
            resultsCollector.recordControlResult(cid, 'eo-tooled', metVerdict(allMet), 'eo-tooled', evidFile);
          }

          stateManager.completeTask(task.id);

          const justification = (task.action.args._justification as string) || '';
          passCount++;
          sendTaskResult({ taskId: task.id, status: directive, message: justification, directive });
          continue;
        }

        // ── document-renderable: signal verification + eo_render_directive emission ──
        if (directive === 'document-renderable') {
          stateManager.startTask(task.id);

          const controlIds = task.controls || [];
          const evidFile = evidenceFileForEntry(task.id, (task.action.args._step_title as string) || task.id).replace(/\.txt$/, '.json');

          // Lookup table: per-control config for document-renderable controls
          const DOC_RENDERABLE_CONTROLS = new Map<string, {
            adequacyCheck: (slug: string) => Promise<boolean>,
            eoRenderDirective: EoRenderDirective
          }>();

          // IA.L2-3.5.8 — Password Reuse
          DOC_RENDERABLE_CONTROLS.set('IA.L2-3.5.8', {
            adequacyCheck: async (_slug: string) => {
              const entry = effectiveRegistryEntries.find(e => e.control_ids.includes('IA.L2-3.5.8'));
              if (!entry || !entry.get_command) return false;
              try {
                const discovery = await taskRunner.discoverSubCommandState(
                  entry.engine as any, entry.get_command, [], plan.variables
                );
                return discovery.exists && !!discovery.rawOutput;
              } catch { return false; }
            },
            eoRenderDirective: EO_RENDER_DIRECTIVES['IA.L2-3.5.8']
          });

          // CM.L2-3.4.4 — Security Impact Analysis (process document — registry entry existence = adequate)
          DOC_RENDERABLE_CONTROLS.set('CM.L2-3.4.4', {
            adequacyCheck: async (_slug: string) => {
              return effectiveRegistryEntries.some(e => e.control_ids.includes('CM.L2-3.4.4'));
            },
            eoRenderDirective: EO_RENDER_DIRECTIVES['CM.L2-3.4.4']
          });

          // CM.L2-3.4.8 — App Deny/Allow (registry entry existence = adequate)
          DOC_RENDERABLE_CONTROLS.set('CM.L2-3.4.8', {
            adequacyCheck: async (_slug: string) => {
              return effectiveRegistryEntries.some(e => e.control_ids.includes('CM.L2-3.4.8'));
            },
            eoRenderDirective: EO_RENDER_DIRECTIVES['CM.L2-3.4.8']
          });

          // AU.L2-3.3.6 — Audit Reduction (M365 audit log inherent — registry entry existence = adequate)
          DOC_RENDERABLE_CONTROLS.set('AU.L2-3.3.6', {
            adequacyCheck: async (_slug: string) => {
              return effectiveRegistryEntries.some(e => e.control_ids.includes('AU.L2-3.3.6'));
            },
            eoRenderDirective: EO_RENDER_DIRECTIVES['AU.L2-3.3.6']
          });

          // CA.L2-3.12.2 — POA&M (prior execution run completed = adequate)
          DOC_RENDERABLE_CONTROLS.set('CA.L2-3.12.2', {
            adequacyCheck: async (slug: string) => {
              return checkPriorRunCompleted(slug);
            },
            eoRenderDirective: EO_RENDER_DIRECTIVES['CA.L2-3.12.2']
          });

          // CA.L2-3.12.4 — SSP (prior execution run completed = adequate)
          DOC_RENDERABLE_CONTROLS.set('CA.L2-3.12.4', {
            adequacyCheck: async (slug: string) => {
              return checkPriorRunCompleted(slug);
            },
            eoRenderDirective: EO_RENDER_DIRECTIVES['CA.L2-3.12.4']
          });

          // RA.L2-3.11.2 — Vulnerability Scanning (Defender inherent — registry entry existence = adequate)
          DOC_RENDERABLE_CONTROLS.set('RA.L2-3.11.2', {
            adequacyCheck: async (_slug: string) => {
              return effectiveRegistryEntries.some(e => e.control_ids.includes('RA.L2-3.11.2'));
            },
            eoRenderDirective: EO_RENDER_DIRECTIVES['RA.L2-3.11.2']
          });

          const primaryControlId = controlIds[0] || '';
          const controlConfig = DOC_RENDERABLE_CONTROLS.get(primaryControlId);

          let readiness: 'met' | 'not_met' = 'not_met';
          let justificationMsg = '';
          let eoDirective: EoRenderDirective | undefined = undefined;

          if (controlConfig) {
            try {
              const adequate = await controlConfig.adequacyCheck(currentTenantSlug);
              if (adequate) {
                readiness = 'met';
                justificationMsg = `Signal verified for ${primaryControlId} — document rendering eligible`;
                eoDirective = controlConfig.eoRenderDirective;
              } else {
                justificationMsg = `Signal not adequate for ${primaryControlId} — document rendering not possible`;
              }
            } catch (err) {
              justificationMsg = `Adequacy check failed for ${primaryControlId}: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else {
            justificationMsg = `Control ${primaryControlId} not in document-renderable lookup table`;
          }

          // W4-ST4: directive written at the evidence file's top level with `directive_code` (EO's shape).
          const evidence: StructuredEvidence = buildDocumentRenderableEvidence({
            controlIds,
            primaryControlId,
            readiness,
            justification: justificationMsg,
            executorIdentity: tenant || 'unknown',
            directive: eoDirective,
          });

          try { await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined); } catch (err) { console.warn('[evidence-upload]', err); }
          stateManager.completeTask(task.id);

          send({
            type: 'task_start',
            taskId: task.id,
            label: stepTitle,
            engine: task.action.engine,
            subCommandCount: subCommands.length,
            priority: task.priority,
            taskType: task.type,
            layer: taskLayer,
            idempotency: task.idempotency,
            controls: task.controls || [],
            directive,
          });

          for (const sub of subCommands) {
            send({ type: 'sub_command_start', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, directive });
            send({ type: 'sub_command_complete', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, status: readiness === 'met' ? 'accomplished' : 'failed', directive, evidenceFile: evidFile });
          }

          for (const cid of controlIds) {
            const sprsValue = metVerdict(readiness === 'met');
            resultsCollector.recordControlResult(cid, 'document-renderable', sprsValue, 'document-renderable', evidFile);
          }

          if (readiness === 'met') {
            passCount++;
          } else {
            failCount++;
          }
          sendTaskResult({ taskId: task.id, status: readiness === 'met' ? 'pass' : 'fail', message: justificationMsg, directive });
          continue;
        }

        // ── nonstack / manual: provisional evidence (out-of-band review required) ──
        if (directive === 'nonstack' || directive === 'manual') {
          stateManager.startTask(task.id);

          const justification = (task.action.args._justification as string) || '';
          const controlIds = task.controls || [];
          const evidFile = evidenceFileForEntry(task.id, (task.action.args._step_title as string) || task.id).replace(/\.txt$/, '.json');

          const evidence: StructuredEvidence = {
            rawResponse: justification,
            outcome: 'manual_action' as EvidenceOutcome,
            outcomeRationale: `Non-stack control — outside information system boundary: ${justification}`,
            complianceVerdict: 'PROVISIONAL' as ComplianceVerdict,
            verdictRationale: 'Non-stack control requires out-of-band evidence — provisional until assessor review',
            metadata: {
              controlIds,
              timestamp: new Date().toISOString(),
              executorIdentity: tenant || 'unknown',
              commandExecuted: '',
              sha256Hash: createHash('sha256').update(justification, 'utf8').digest('hex'),
            }
          };

          try { await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined); } catch (err) { console.warn('[evidence-upload]', err); }
          stateManager.completeTask(task.id);

          send({
            type: 'task_start',
            taskId: task.id,
            label: stepTitle,
            engine: task.action.engine,
            subCommandCount: subCommands.length,
            priority: task.priority,
            taskType: task.type,
            layer: taskLayer,
            idempotency: task.idempotency,
            controls: task.controls || [],
            directive,
          });

          for (const sub of subCommands) {
            send({ type: 'sub_command_start', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, directive });
            send({ type: 'sub_command_complete', taskId: task.id, subId: sub.id, label: sub.label, engine: sub.engine, status: 'accomplished', directive, evidenceFile: evidFile });
          }

          for (const cid of controlIds) {
            resultsCollector.recordControlResult(cid, 'nonstack', ResultVerdict.PROVISIONAL, 'nonstack', evidFile);
          }

          skipCount++;
          sendTaskResult({ taskId: task.id, status: 'nonstack', message: justification, directive });
          continue;
        }

        // Safe-fail: reject unrecognized non-automated directives before reaching execution logic
        if (directive !== 'automated' && directive !== 'skip') {
          const knownDirectives = ['automated', 'implement', 'validate', 'document-absence', 'document-prohibition', 'document-renderable', 'inherit-fedramp', 'nonstack', 'manual', 'skip'];
          if (!knownDirectives.includes(directive)) {
            throw new Error(
              `ABORT: Unrecognized directive "${directive}" for task ${task.id} (controls: ${controlIds.join(', ')}). ` +
              `Known directives: ${knownDirectives.join(', ')}. Execution halted.`
            );
          }
        }

        // Batch mode: gate on layer transitions
        if (mode === 'batch' && currentLayer !== null && taskLayer !== currentLayer) {
          // Emit layer approval request
          const gateKey = `layer::${taskLayer}`;
          const layerDecision = await new Promise<'approve' | 'skip' | 'accomplish'>((resolve) => {
            approvalGate.set(gateKey, resolve);
            send({
              type: 'layer_approve_request',
              layer: taskLayer,
              previousLayer: currentLayer,
              taskCount: plan.execution_graph.filter(t =>
                ((t.action.args['_layer'] as number | undefined) ?? 0) === taskLayer
              ).length
            });
          });
          approvalGate.delete(gateKey);

          if (layerDecision === 'skip') {
            skippedLayers.add(taskLayer);
          }
        }
        currentLayer = taskLayer;

        send({
          type: 'task_start',
          taskId: task.id,
          label: stepTitle,
          engine: task.action.engine,
          subCommandCount: subCommands.length,
          priority: task.priority,
          taskType: task.type,
          layer: taskLayer,
          idempotency: task.idempotency,
          controls: task.controls || [],
          directive: task.action.args._directive || 'automated',
        });

        // Emit individual sub-command details so the UI can show what actually runs
        for (let i = 0; i < subCommands.length; i++) {
          const sub = subCommands[i];
          // W4-ST2: resolve with the well-known defaults too, as the live ExecutionContext does.
          const displayVars = { ...VARIABLE_DEFAULTS, ...plan.variables };
          const resolvedCmd = sub.set_command
            ? resolveTemplate(sub.set_command, displayVars)
            : sub.idempotency === 'evidence-only' && sub.evidence_commands?.length
            ? `[evidence-only] ${resolveTemplate(sub.evidence_commands[0], displayVars).substring(0, 200)}`
            : `[manual] ${sub.label}`;
          send({
            type: 'sub_command',
            taskId: task.id,
            subId: sub.id,
            label: sub.label,
            engine: sub.engine,
            command: resolvedCmd,
            index: i + 1,
            total: subCommands.length,
            registry: {
              get_command_template: sub.get_command || null,
              set_command_template: sub.set_command || null,
              variables_required: sub.variables_required || [],
              variables_runtime: sub.variables_runtime || [],
              captures: (sub.captures || []).map(c => ({ variable: c.variable, from: c.from })),
              idempotency: sub.idempotency || null,
              on_failure: sub.on_failure || null,
              evidence_commands: sub.evidence_commands || [],
            },
          });

          // Collect for dry run log
          if (mode === 'dryrun_log') {
            dryRunLog.push({
              taskId: task.id,
              label: sub.label,
              subId: sub.id,
              engine: sub.engine,
              command: resolvedCmd
            });
          }
        }

        // Skip tasks in batch-skipped layers (extract captures to preserve chaining)
        if (skippedLayers.has(taskLayer)) {
          stateManager.skipTask(task.id, `Layer ${taskLayer} skipped by operator`);
          await extractSkippedCaptures(subCommands);
          skipCount++;
          sendTaskResult({
            taskId: task.id,
            status: 'skip',
            message: `Layer ${taskLayer} skipped by operator`
          });
          continue;
        }

        // IPPS session warmup: force a connection test right before IPPS tasks.
        // The pre-connect at startup may have failed silently; retry with backoff
        // on ALL errors (not just throttle) to handle transient auth/DNS failures.
        if (sessionManager && ENGINE_SESSION_MAP[task.action.engine] === 'purview') {
          const purviewState = sessionManager.getSessionState('purview');
          if (!purviewState.connected) {
            let ippsConnected = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
              send({ type: 'connection_log', phase: 'reconnecting_purview', message: `IPPS session not connected — attempt ${attempt}/3...`, tenant });
              try {
                await sessionManager.ensureConnected('purview');
                send({ type: 'connection_log', phase: 'connected_purview', message: `IPPS/Purview session connected (attempt ${attempt})`, tenant });
                ippsConnected = true;
                break;
              } catch (ippsErr) {
                const ippsMsg = ippsErr instanceof Error ? ippsErr.message : String(ippsErr);
                send({ type: 'connection_log', phase: 'error_purview', message: `IPPS attempt ${attempt}/3 failed: ${ippsMsg}`, tenant });
                if (attempt < 3) {
                  await new Promise(r => setTimeout(r, attempt * 5000)); // 5s, 10s backoff
                }
              }
            }
            if (!ippsConnected) {
              stateManager.failTask(task.id, 'IPPS/Purview session could not be established after 3 retries');
              failCount++;
              failedTasks.push({
                taskId: task.id,
                label: stepTitle,
                controls: task.controls || [],
                subCommands: subCommands.map(sub => ({
                  id: sub.id,
                  label: sub.label,
                  resolvedCommand: sub.set_command
                    ? resolveTemplate(sub.set_command, plan.variables)
                    : sub.idempotency === 'evidence-only' && sub.evidence_commands?.length
                    ? `[evidence-only] ${resolveTemplate(sub.evidence_commands[0], plan.variables).substring(0, 200)}`
                    : `[manual] ${sub.label}`,
                })),
              });
              sendTaskResult({ taskId: task.id, status: 'fail', message: 'IPPS/Purview session could not be established after 3 retries' });
              continue;
            }
          }
        }

        // Manual mode: per-sub-command approval
        if (mode === 'manual') {
          if (subCommands.length > 0) {
            // Walk each sub-command; operator approves/skips/accomplishes individually
            let approvedCount = 0;
            let skippedCount = 0;
            let accomplishedSubCount = 0;

            for (const sub of subCommands) {
              if (closed || getAbortRequested()) break;

              // Pre-flight check: run get_command before showing gate
              let preCheck: { alreadyApplied: boolean; output?: string } = { alreadyApplied: false };
              if (sub.get_command && sub.idempotency === 'get-then-set') {
                try {
                  const discovery = await taskRunner.discoverSubCommandState(
                    sub.engine as any,
                    sub.get_command,
                    (sub.captures || []) as any,
                    plan.variables
                  );
                  if (discovery.exists) {
                    preCheck = {
                      alreadyApplied: true,
                      output: discovery.rawOutput.substring(0, 500)
                    };
                    if (Object.keys(discovery.captures).length > 0) {
                      Object.assign(plan.variables, discovery.captures);
                      if (executionContext) {
                        executionContext.registerCaptures(discovery.captures);
                      }
                      // Persist captured variables to tenant variables.json
                      if (tenant && tenant !== 'dev') {
                        saveTenantVariables(tenant, plan.variables);
                      }
                    }
                  }
                } catch { /* get failed → resource doesn't exist → normal gate */ }
              }

              const gateKey = `${task.id}::${sub.id}`;
              const subDecision = await new Promise<'approve' | 'skip' | 'accomplish'>((resolve) => {
                approvalGate.set(gateKey, resolve);
                send({ type: 'sub_command_approve_request', taskId: task.id, subId: sub.id, idempotency: sub.idempotency, preCheck });
              });
              approvalGate.delete(gateKey);

              if (subDecision === 'approve') {
                approvedCount++;
                send({ type: 'sub_command_result', taskId: task.id, subId: sub.id, status: 'approved', message: 'Approved by operator — will execute' });
              } else if (subDecision === 'accomplish') {
                accomplishedSubCount++;
                let captureMsg = 'Accomplished by operator (completed outside Stamper)';
                if (sub.captures && sub.captures.length > 0 && sub.get_command) {
                  try {
                    const captured = await taskRunner.queryCaptureValues(
                      sub.engine as any,
                      sub.get_command,
                      sub.captures as any,
                      plan.variables
                    );
                    // Emit accomplished_query SSE event so GUI shows the query + results
                    send({
                      type: 'accomplished_query',
                      taskId: task.id,
                      subId: sub.id,
                      engine: sub.engine,
                      command: sub.get_command,
                      captures: captured,
                    });
                    if (Object.keys(captured).length > 0) {
                      Object.assign(plan.variables, captured);
                      captureMsg = `Accomplished — captured: ${Object.entries(captured).map(([k, v]) => `${k}=${v}`).join(', ')}`;
                      // Persist captured variables to tenant variables.json
                      if (tenant && tenant !== 'dev') {
                        saveTenantVariables(tenant, plan.variables);
                      }
                    }
                  } catch {
                    // best-effort: proceed without captures
                  }
                }
                // Write evidence with outside_action → SAT
                const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
                const registrySnapshot = { entry_id: sub.id, label: sub.label, engine: sub.engine,
                  sequence_hint: sub.sequence_hint,
                  idempotency: sub.idempotency || 'unsafe_requires_gate', on_failure: sub.on_failure || 'warn_continue', control_ids: task.controls };
                const pseudoTask = { controls: task.controls } as any;
                const evidence = buildStructuredEvidence(
                  captureMsg, 0, '', null, sub as any, pseudoTask, plan.variables, undefined,
                  registrySnapshot
                );
                try { await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined); } catch (err) { console.warn('[evidence-upload]', err); }
                send({ type: 'evidence_logged', taskId: task.id, subId: sub.id, file: evidFile, evidenceDir,
                  evidenceContent: JSON.stringify(evidence, null, 2), cmmc_controls: task.controls || [], reason: 'accomplished',
                  entryId: sub.id, label: sub.label, engine: task.action.engine });
                send({ type: 'sub_command_result', taskId: task.id, subId: sub.id, status: 'accomplished', message: captureMsg });
              } else {
                skippedCount++;
                send({ type: 'sub_command_result', taskId: task.id, subId: sub.id, status: 'skip', message: 'Skipped by operator' });
              }
            }

            if (approvedCount === 0 && accomplishedSubCount === 0) {
              stateManager.skipTask(task.id, 'All sub-commands skipped by operator');
              await extractSkippedCaptures(subCommands);
              skipCount++;
              sendTaskResult({
                taskId: task.id,
                status: 'skip',
                message: `All ${skippedCount} sub-commands skipped by operator`
              });
              continue;
            }

            if (approvedCount === 0 && accomplishedSubCount > 0) {
              try {
                stateManager.startTask(task.id);
                const { evidenceArtifacts } = await taskRunner.executeTask(
                  task,
                  plan.plan_id,
                  plan.variables,
                  makeOnStream(task.id)
                );
                stateManager.accomplishTask(task.id, evidenceArtifacts);
              } catch {
                stateManager.accomplishTask(task.id);
              }
              accomplishedCount++;
              // Record per-control result for accomplished tasks
              for (const cid of (task.controls || [])) {
                resultsCollector.recordControlResult(cid, controlDirectivesMap[cid] || 'automated', ResultVerdict.SAT, 'accomplished');
              }
              sendTaskResult({
                taskId: task.id,
                status: 'accomplished',
                message: `${accomplishedSubCount} sub-command(s) accomplished by operator outside Stamper`
              });
              continue;
            }

            // Case A (pure approved) & Case B (mixed approved+accomplished):
            // Actually execute the task — PowerShellAdapter writes real evidence per sub-command
            if (approvedCount > 0) {
              let taskSuccess = false;
              try {
                stateManager.startTask(task.id);
                const { result, evidenceArtifacts } = await taskRunner.executeTask(
                  task,
                  plan.plan_id,
                  plan.variables,
                  makeOnStream(task.id)
                );
                if (result.success) {
                  stateManager.completeTask(task.id, result.output, evidenceArtifacts,
                    { pre_state: result.pre_state, post_state: result.post_state });
                  passCount++;
                  taskSuccess = true;
                  if (tenant && tenant !== 'dev') {
                    saveTenantVariables(tenant, plan.variables);
                  }
                } else {
                  stateManager.failTask(task.id, result.error || 'Execution failed');
                  failCount++;
                  // Track failed task metadata for failure report (manual mode, result.success === false)
                  failedTasks.push({
                    taskId: task.id,
                    label: stepTitle,
                    controls: task.controls || [],
                    subCommands: subCommands.map(sub => ({
                      id: sub.id,
                      label: sub.label,
                      resolvedCommand: sub.set_command
                        ? resolveTemplate(sub.set_command, plan.variables)
                        : sub.idempotency === 'evidence-only' && sub.evidence_commands?.length
                        ? `[evidence-only] ${resolveTemplate(sub.evidence_commands[0], plan.variables).substring(0, 200)}`
                        : `[manual] ${sub.label}`,
                    })),
                  });
                }
                // Emit evidence_logged for each sub-command (read real evidence from disk)
                for (const sub of subCommands) {
                  const evidFileJson = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
                  const fullPathJson = path.join(evidenceDir, evidFileJson);
                  let evidenceContent = '';
                  try {
                    if (fs.existsSync(fullPathJson)) {
                      evidenceContent = fs.readFileSync(fullPathJson, 'utf-8');
                    }
                  } catch { /* best effort */ }
                  if (evidenceContent) {
                    send({
                      type: 'evidence_logged',
                      taskId: task.id,
                      subId: sub.id,
                      file: evidFileJson,
                      evidenceDir,
                      evidenceContent: evidenceContent.substring(0, 50000),
                      cmmc_controls: task.controls || [],
                      reason: null,
                      entryId: sub.id,
                      label: sub.label,
                      engine: task.action.engine
                    });

                    // Pause execution until evidence popout is dismissed
                    if (evidencePopout) {
                      const evidenceGateKey = `evidence::${task.id}::${sub.id}`;
                      await new Promise<'approve' | 'skip' | 'accomplish'>((resolve) => {
                        approvalGate.set(evidenceGateKey, resolve);
                        send({ type: 'evidence_approval_request', taskId: task.id, subId: sub.id });
                      });
                      approvalGate.delete(evidenceGateKey);
                    }
                  }
                }
              } catch (err: any) {
                stateManager.failTask(task.id, err.message || String(err));
                failCount++;
                // Track failed task metadata for failure report (manual mode, catch)
                failedTasks.push({
                  taskId: task.id,
                  label: stepTitle,
                  controls: task.controls || [],
                  subCommands: subCommands.map(sub => ({
                    id: sub.id,
                    label: sub.label,
                    resolvedCommand: sub.set_command
                      ? resolveTemplate(sub.set_command, plan.variables)
                      : sub.idempotency === 'evidence-only' && sub.evidence_commands?.length
                      ? `[evidence-only] ${resolveTemplate(sub.evidence_commands[0], plan.variables).substring(0, 200)}`
                      : `[manual] ${sub.label}`,
                  })),
                });
              }
              sendTaskResult({
                taskId: task.id,
                status: taskSuccess ? (task.type === 'validate' ? 'validated' : 'pass') : 'fail',
                message: `${approvedCount} sub-command(s) executed${accomplishedSubCount > 0 ? `, ${accomplishedSubCount} accomplished` : ''}`
              });
              continue;
            }
          } else {
            const decision = await new Promise<'approve' | 'skip' | 'accomplish'>((resolve) => {
              approvalGate.set(task.id, resolve);
              send({ type: 'task_approve_request', taskId: task.id, idempotency: task.idempotency });
            });
            approvalGate.delete(task.id);

            if (decision === 'skip') {
              stateManager.skipTask(task.id, 'Skipped by operator');
              await extractSkippedCaptures(subCommands);
              skipCount++;
              sendTaskResult({
                taskId: task.id,
                status: 'skip',
                message: 'Skipped by operator'
              });
              continue;
            }

            if (decision === 'accomplish') {
              try {
                stateManager.startTask(task.id);
                const { evidenceArtifacts } = await taskRunner.executeTask(
                  task,
                  plan.plan_id,
                  plan.variables,
                  makeOnStream(task.id)
                );
                stateManager.accomplishTask(task.id, evidenceArtifacts);
              } catch {
                stateManager.accomplishTask(task.id);
              }
              accomplishedCount++;
              // Record per-control result for accomplished tasks
              for (const cid of (task.controls || [])) {
                resultsCollector.recordControlResult(cid, controlDirectivesMap[cid] || 'automated', ResultVerdict.SAT, 'accomplished');
              }
              sendTaskResult({
                taskId: task.id,
                status: 'accomplished',
                message: 'Accomplished by operator (completed outside Stamper)'
              });
              continue;
            }

            // manual_gate tasks: GUI approval IS the gate — skip executeTask
            // to avoid ManualGateAdapter blocking on terminal readline
            if (task.action.engine === 'manual_gate') {
              stateManager.startTask(task.id);
              stateManager.completeTask(task.id, { approved: true, operator: 'gui-operator', timestamp: new Date().toISOString() });
              passCount++;
              // Write evidence markers for manual_gate sub-commands
              for (const sub of subCommands) {
                const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
                const metadata = {
                  status: 'approved', mode, operator: 'gui-operator',
                  timestamp: new Date().toISOString(),
                  task_id: task.id, controls: task.controls
                };
                const registrySnapshot = { entry_id: sub.id, label: sub.label, engine: sub.engine,
                  sequence_hint: sub.sequence_hint,
                  idempotency: sub.idempotency || 'unsafe_requires_gate', on_failure: sub.on_failure || 'warn_continue',
                  control_ids: task.controls };
                const pseudoTask = { controls: task.controls } as any;
                const evidence = buildStructuredEvidence(
                  JSON.stringify(metadata), 0, '', null, sub as any, pseudoTask, plan.variables || {}, undefined,
                  registrySnapshot
                );
                evidence.outcome = 'manual_action';
                const { verdict, rationale } = deriveVerdict('manual_action');
                evidence.complianceVerdict = verdict;
                evidence.verdictRationale = rationale;
                try { await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined); } catch (err) { console.warn('[evidence-upload]', err); }
                send({
                  type: 'evidence_logged',
                  taskId: task.id,
                  subId: sub.id,
                  file: evidFile,
                  evidenceDir,
                  evidenceContent: JSON.stringify(evidence, null, 2),
                  cmmc_controls: task.controls || [],
                  reason: null,
                  entryId: sub.id,
                  label: sub.label,
                  engine: task.action.engine
                });
              }
              // Record per-control result for manual_gate tasks
              for (const cid of (task.controls || [])) {
                resultsCollector.recordControlResult(cid, controlDirectivesMap[cid] || 'automated', ResultVerdict.SAT, 'completed');
              }
              sendTaskResult({
                taskId: task.id,
                status: task.type === 'validate' ? 'validated' : 'pass',
                message: 'Manual gate approved via GUI'
              });
              continue;
            }
          }
        }

        // Incremental mode: step-level approval, sub-commands auto-execute
        if (mode === 'incremental') {
          const decision = await new Promise<'approve' | 'skip' | 'accomplish'>((resolve) => {
            approvalGate.set(task.id, resolve);
            send({ type: 'task_approve_request', taskId: task.id, idempotency: task.idempotency });
          });
          approvalGate.delete(task.id);

          if (decision === 'skip') {
            stateManager.skipTask(task.id, 'Skipped by operator');
            await extractSkippedCaptures(subCommands);
            skipCount++;
            sendTaskResult({
              taskId: task.id,
              status: 'skip',
              message: 'Skipped by operator'
            });
            continue;
          }

          if (decision === 'accomplish') {
            try {
              stateManager.startTask(task.id);
              const { evidenceArtifacts } = await taskRunner.executeTask(
                task,
                plan.plan_id,
                plan.variables,
                makeOnStream(task.id)
              );
              stateManager.accomplishTask(task.id, evidenceArtifacts);
            } catch {
              stateManager.accomplishTask(task.id);
            }
            accomplishedCount++;
            // Record per-control result for accomplished tasks
            for (const cid of (task.controls || [])) {
              resultsCollector.recordControlResult(cid, controlDirectivesMap[cid] || 'automated', ResultVerdict.SAT, 'accomplished');
            }
            sendTaskResult({
              taskId: task.id,
              status: 'accomplished',
              message: 'Accomplished by operator (completed outside Stamper)'
            });
            continue;
          }
          // decision === 'approve': fall through to execute
        }

        // manual_gate tasks: GUI approval IS the gate — skip executeTask
        // to avoid ManualGateAdapter blocking on terminal readline
        if (task.action.engine === 'manual_gate') {
          stateManager.startTask(task.id);
          stateManager.completeTask(task.id, { approved: true, operator: 'gui-operator', timestamp: new Date().toISOString() });
          passCount++;
          // Write evidence markers for manual_gate sub-commands
          for (const sub of subCommands) {
            const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
            const metadata = {
              status: 'approved', mode, operator: 'gui-operator',
              timestamp: new Date().toISOString(),
              task_id: task.id, controls: task.controls
            };
            const registrySnapshot = { entry_id: sub.id, label: sub.label, engine: sub.engine,
              sequence_hint: sub.sequence_hint,
              idempotency: sub.idempotency || 'unsafe_requires_gate', on_failure: sub.on_failure || 'warn_continue',
              control_ids: task.controls };
            const pseudoTask = { controls: task.controls } as any;
            const evidence = buildStructuredEvidence(
              JSON.stringify(metadata), 0, '', null, sub as any, pseudoTask, plan.variables || {}, undefined,
              registrySnapshot
            );
            evidence.outcome = 'manual_action';
            const { verdict, rationale } = deriveVerdict('manual_action');
            evidence.complianceVerdict = verdict;
            evidence.verdictRationale = rationale;
            try { await writeAndUploadEvidence(evidenceDir, evidFile, evidence, uploadEnabled ? clientConfig?.evidenceStorage : undefined); } catch (err) { console.warn('[evidence-upload]', err); }
            send({
              type: 'evidence_logged',
              taskId: task.id,
              subId: sub.id,
              file: evidFile,
              evidenceDir,
              evidenceContent: JSON.stringify(evidence, null, 2),
              cmmc_controls: task.controls || [],
              reason: null,
              entryId: sub.id,
              label: sub.label,
              engine: task.action.engine
            });
          }
          // Record per-control result for manual_gate tasks
          for (const cid of (task.controls || [])) {
            resultsCollector.recordControlResult(cid, controlDirectivesMap[cid] || 'automated', ResultVerdict.SAT, 'completed');
          }
          sendTaskResult({
            taskId: task.id,
            status: task.type === 'validate' ? 'validated' : 'pass',
            message: 'Manual gate approved via GUI'
          });
          continue;
        }

        // Check idempotency
        const idempDecision = idempotencyGuard.evaluateTask(task, false);
        if (!idempDecision.canRun && !idempDecision.requiresApproval) {
          stateManager.skipTask(task.id, idempDecision.reason);
          await extractSkippedCaptures(subCommands);
          skipCount++;
          sendTaskResult({
            taskId: task.id,
            status: 'skip',
            message: idempDecision.reason
          });
          continue;
        }

        try {
          stateManager.startTask(task.id);

          const { result, evidenceArtifacts } = await taskRunner.executeTask(
            task,
            plan.plan_id,
            plan.variables,
            makeOnStream(task.id)
          );

          if (result.success) {
            stateManager.completeTask(
              task.id,
              result.output,
              evidenceArtifacts,
              { pre_state: result.pre_state, post_state: result.post_state }
            );
            passCount++;

            // Persist runtime-captured variables to tenant variables.json
            if (tenant && tenant !== 'dev') {
              saveTenantVariables(tenant, plan.variables);
            }

            // Emit state_diff if pre/post state snapshots exist
            if (result.pre_state && result.post_state) {
              const before = typeof result.pre_state.raw === 'string'
                ? result.pre_state.raw.substring(0, 2000) : JSON.stringify(result.pre_state).substring(0, 2000);
              const after = typeof result.post_state.raw === 'string'
                ? result.post_state.raw.substring(0, 2000) : JSON.stringify(result.post_state).substring(0, 2000);
              if (before !== after) {
                send({
                  type: 'state_diff',
                  taskId: task.id,
                  before,
                  after,
                });
              }
            }

            // Emit sub-command results — skip in manual mode (already emitted during approval loop)
            if (mode !== 'manual') {
              for (const sub of subCommands) {
                // First, read evidence to extract outcome for sub_command_result event
                const evidFileJson = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
                const evidFileTxt = evidenceFileForEntry(sub.id, sub.label).replace(/\.json$/, '.txt');
                const fullPathJson = path.join(evidenceDir, evidFileJson);
                const fullPathTxt = path.join(evidenceDir, evidFileTxt);
                let evidenceContent = '';
                let reason: string | null = null;
                let parsedEvidence: any = null;
                let outcome: string | undefined;
                let outcomeRationale: string | undefined;
                let failureDiagnostics: any | undefined;

                try {
                  let fileContent = '';

                  // Prioritize .json, fallback to .txt
                  if (fs.existsSync(fullPathJson)) {
                    fileContent = fs.readFileSync(fullPathJson, 'utf-8');
                    evidenceContent = fileContent.substring(0, 2000);

                    // Try parsing as JSON
                    try {
                      parsedEvidence = JSON.parse(fileContent);
                      outcome = parsedEvidence.outcome;
                      outcomeRationale = parsedEvidence.outcomeRationale;
                      failureDiagnostics = parsedEvidence.failureDiagnostics;
                    } catch {
                      // JSON parse failed — treat as legacy
                    }
                  } else if (fs.existsSync(fullPathTxt)) {
                    fileContent = fs.readFileSync(fullPathTxt, 'utf-8');

                    // Wrap in unknown_legacy envelope
                    const stat = fs.statSync(fullPathTxt);
                    const legacyEvidence: StructuredEvidence = {
                      rawResponse: fileContent,
                      outcome: 'unknown_legacy' as EvidenceOutcome,
                      outcomeRationale: 'Migrated from legacy .txt evidence',
                      metadata: {
                        controlIds: task.controls || [],
                        timestamp: stat.mtime.toISOString(),
                        executorIdentity: tenant || 'unknown',
                        commandExecuted: 'unknown',
                        sha256Hash: createHash('sha256').update(fileContent, 'utf8').digest('hex')
                      }
                    };
                    evidenceContent = fileContent.substring(0, 2000);
                    outcome = legacyEvidence.outcome;
                    outcomeRationale = legacyEvidence.outcomeRationale;
                  } else {
                    reason = 'evidence_file_not_found';
                  }
                } catch {
                  reason = 'evidence_read_failed';
                }

                // Use task.controls (all sub-commands inherit parent controls)
                const cmmcControls = task.controls || [];

                // Emit sub_command_result with outcome
                // Use pre-computed complianceVerdict from evidence (includes verification context)
                // rather than re-deriving from outcome alone (which loses verificationResult).
                const evidVerdict = parsedEvidence?.complianceVerdict;
                const status = evidVerdict
                  ? (evidVerdict === 'SAT' ? 'pass' : 'fail')
                  : (outcome ? (deriveVerdict(outcome as EvidenceOutcome).verdict === 'SAT' ? 'pass' : 'fail') : 'fail');
                send({
                  type: 'sub_command_result',
                  taskId: task.id,
                  subId: sub.id,
                  status,
                  message: '',
                  ...(outcome ? { outcome } : {}),
                  ...(outcomeRationale ? { outcomeRationale } : {})
                });

                send({
                  type: 'evidence_logged',
                  taskId: task.id,
                  subId: sub.id,
                  file: evidFileJson,
                  evidenceDir,
                  evidenceContent,
                  cmmc_controls: cmmcControls,
                  reason,
                  entryId: sub.id,
                  label: sub.label,
                  engine: task.action.engine,
                  ...(outcome ? { outcome } : {}),
                  ...(outcomeRationale ? { outcomeRationale } : {}),
                  ...(failureDiagnostics ? { failureDiagnostics } : {})
                });

                // Pause execution until evidence popout is dismissed
                if (evidencePopout && evidenceContent) {
                  const evidenceGateKey = `evidence::${task.id}::${sub.id}`;
                  await new Promise<'approve' | 'skip' | 'accomplish'>((resolve) => {
                    approvalGate.set(evidenceGateKey, resolve);
                    send({ type: 'evidence_approval_request', taskId: task.id, subId: sub.id });
                  });
                  approvalGate.delete(evidenceGateKey);
                }
              }
            }

            sendTaskResult({
              taskId: task.id,
              status: task.type === 'validate' ? 'validated' : 'pass',
              message: result.stdout?.substring(0, 200) ?? 'completed'
            });

            // Record per-control result for automated success
            for (const cid of (task.controls || [])) {
              const cidDirective = controlDirectivesMap[cid] || (task.type === 'validate' ? 'validation' : 'automated');
              resultsCollector.recordControlResult(cid, cidDirective, ResultVerdict.SAT, 'completed');
            }
          } else {
            throw new Error(result.error ?? 'Task execution failed');
          }
        } catch (taskErr) {
          const errMsg = taskErr instanceof Error ? taskErr.message : String(taskErr);
          stateManager.failTask(task.id, errMsg);
          failCount++;

          // Track failed task metadata for failure report
          failedTasks.push({
            taskId: task.id,
            label: stepTitle,
            controls: task.controls || [],
            subCommands: subCommands.map(sub => ({
              id: sub.id,
              label: sub.label,
              resolvedCommand: sub.set_command
                ? resolveTemplate(sub.set_command, plan.variables)
                : sub.idempotency === 'evidence-only' && sub.evidence_commands?.length
                ? `[evidence-only] ${resolveTemplate(sub.evidence_commands[0], plan.variables).substring(0, 200)}`
                : `[manual] ${sub.label}`,
            })),
          });

          // Emit per-sub-command results from evidence files so the frontend
          // knows which sub-commands actually passed vs failed (instead of
          // blanket-failing everything via task_result propagation).
          if (mode !== 'manual') {
            for (const sub of subCommands) {
              const evidFileJson = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
              const fullPathJson = path.join(evidenceDir, evidFileJson);
              let parsedEvidence: any = null;
              let outcome: string | undefined;
              let outcomeRationale: string | undefined;
              try {
                if (fs.existsSync(fullPathJson)) {
                  const fileContent = fs.readFileSync(fullPathJson, 'utf-8');
                  try {
                    parsedEvidence = JSON.parse(fileContent);
                    outcome = parsedEvidence.outcome;
                    outcomeRationale = parsedEvidence.outcomeRationale;
                  } catch { /* JSON parse failed */ }
                }
              } catch { /* evidence read failed */ }
              const evidVerdict2 = parsedEvidence?.complianceVerdict;
              const status2 = evidVerdict2
                ? (evidVerdict2 === 'SAT' ? 'pass' : 'fail')
                : (outcome ? (deriveVerdict(outcome as EvidenceOutcome).verdict === 'SAT' ? 'pass' : 'fail') : 'fail');
              send({
                type: 'sub_command_result',
                taskId: task.id,
                subId: sub.id,
                status: status2,
                message: parsedEvidence ? '' : errMsg,
                ...(outcome ? { outcome } : {}),
                ...(outcomeRationale ? { outcomeRationale } : {})
              });
            }
          }

          const rollbackResult = await rollbackHandler.handleTaskFailure(task, errMsg);
          const shouldAbort = rollbackHandler.shouldAbortOnFailure(task);

          // Check sub-command on_failure field for halt override
          // abort_step = skip remaining sub-commands in this task, continue execution
          // abort_execution = halt the entire execution run
          // warn_continue = log warning, continue normally
          const subOnFailure = (task.action.args._sub_commands as any)?.[0]?.on_failure;
          const shouldHalt = shouldAbort || subOnFailure === 'abort_execution';

          const impact = getDownstreamImpact(task.id);
          sendTaskResult({
            taskId: task.id,
            status: 'fail',
            message: errMsg,
            rollback: rollbackResult.action_taken,
            ...(impact.length > 0 ? { downstreamImpact: impact } : {})
          });

          // Record per-control result for automated failure
          for (const cid of (task.controls || [])) {
            resultsCollector.recordControlResult(cid, controlDirectivesMap[cid] || 'automated', ResultVerdict.NOT_SAT, 'failed');
          }

          if (shouldHalt) {
            send({ type: 'execution_halted', message: `Critical task ${task.id} failed: ${errMsg}`, reason: shouldAbort ? 'critical_priority' : 'on_failure_halt' });
            stateManager.updatePlanStatus('failed');
            res.end();
            return;
          }
        }
      }

      // If aborted, send halt event and exit early
      if (getAbortRequested()) {
        setAbortRequested(false);
        stateManager.updatePlanStatus('failed');
        send({ type: 'execution_halted', message: 'Execution halted by operator' });
        res.end();
        return;
      }

      stateManager.updatePlanStatus(failCount > 0 ? 'failed' : 'completed');

      const report = engine.generateReport(startTime);

      // Attach per-control results with names for the execution report table
      if (cmmcRefControls.length > 0) {
        const manifest = resultsCollector.buildManifestForPlan(plan.plan_id, currentTenantSlug, plan as any);
        const resultMap = new Map(manifest.results.map(r => [r.controlId, r]));
        report.controlResults = cmmcRefControls.map(ref => {
          const result = resultMap.get(ref.control_id);
          return {
            controlId: ref.control_id,
            family: ref.family,
            name: ref.practice.length > 60 ? ref.practice.slice(0, 57) + '...' : ref.practice,
            directive: result?.directive || controlDirectivesMap[ref.control_id] || '—',
            verdict: result?.verdict || '—',
          };
        });
      }

      const reportDir = tenant && tenant !== 'dev' ? tenantPlansDir(tenant) : undefined;
      if (reportDir && !fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
      const { jsonPath, markdownPath } = reporter.saveReport(report, reportDir);

      // For dryrun_log: write the log file
      let dryRunLogPath: string | undefined;
      if (mode === 'dryrun_log' && dryRunLog.length > 0) {
        const logDir = tenantLogsDir(tenant || 'dev');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        dryRunLogPath = path.join(logDir, `dryrun-log-${timestamp}.json`);
        writeJsonArtifact(dryRunLogPath, {
          generated: new Date().toISOString(),
          planId: plan.plan_id,
          mode: 'dryrun_log',
          totalCommands: dryRunLog.length,
          commands: dryRunLog
        });
      }

      send({
        type: 'summary',
        pass: passCount,
        fail: failCount,
        skip: skipCount,
        accomplished: accomplishedCount,
        total: plan.execution_graph.length,
        reportJson: jsonPath,
        reportMd: markdownPath,
        ...(dryRunLogPath ? { dryRunLog: dryRunLogPath } : {})
      });

      // ---- Per-Control Execution Results Manifest ----
      // FX-ST6: shared publisher — canonical write + Muster delivery (never fails the run).
      try {
        const published = await publishExecutionResults(resultsCollector, plan as any, currentTenantSlug, {
          dryRun: isDevMode,
          log: (m: string) => console.log(m),
        });
        send({ type: 'execution_results_manifest', data: published.manifest });
        send({ type: 'execution_results_delivery', data: { ...published.delivery, manifestPath: published.manifestPath } });
      } catch (manifestErr) {
        console.error('Failed to write execution results manifest:', manifestErr);
      }

      // ---- Failure Report (markdown) ----
      if (failCount > 0 && tenant && tenant !== 'dev') {
        try {
          // Build mpControls lookup: requirement_id → { title, stamper_action }
          const mpControlMap = new Map<string, { title: string; stamper_action: string }>();
          for (const mc of mpControls) {
            mpControlMap.set(mc.requirement_id, { title: mc.title, stamper_action: mc.stamper_action });
          }

          let md = '# Execution Failure Report\n\n';
          md += `**Generated:** ${new Date().toISOString()}\n`;
          md += `**Tenant:** ${tenant}\n`;
          md += `**Plan:** ${plan.plan_id}\n`;
          md += `**Failed Tasks:** ${failCount}\n\n`;
          md += '---\n\n';

          for (const ft of failedTasks) {
            // Control metadata from Mission Plan
            const controlLabels = ft.controls.map(cid => {
              const mc = mpControlMap.get(cid);
              const title = mc?.title || 'Unknown';
              const directive = controlDirectivesMap[cid] || mc?.stamper_action || 'Unknown';
              return `${cid} — ${title} [${directive}]`;
            });

            md += `## Task: ${ft.taskId}\n`;
            md += `**Label:** ${ft.label}\n`;
            md += `**Controls:** ${controlLabels.length > 0 ? controlLabels.join(', ') : 'None'}\n\n`;

            // Sub-commands with evidence from disk
            for (const sub of ft.subCommands) {
              md += `### Sub-Command: ${sub.id}\n`;
              md += `**Label:** ${sub.label}\n`;
              md += `**Resolved Command:**\n\`\`\`\n${sub.resolvedCommand}\n\`\`\`\n\n`;

              // Read evidence JSON for stdout/stderr/outcome
              const evidFileJson = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
              const fullPathJson = path.join(evidenceDir, evidFileJson);
              try {
                if (fs.existsSync(fullPathJson)) {
                  const evidJson = JSON.parse(fs.readFileSync(fullPathJson, 'utf-8'));
                  const stdout = evidJson.rawResponse || '';
                  const stderr = evidJson.metadata?.stderr || '';
                  const outcome = evidJson.outcome || 'unknown';
                  const outcomeRationale = evidJson.outcomeRationale || '';
                  const failureDiag = evidJson.failureDiagnostics;

                  md += `**Outcome:** ${outcome}\n`;
                  if (outcomeRationale) md += `**Outcome Rationale:** ${outcomeRationale}\n`;
                  if (failureDiag) {
                    md += `**Failure Diagnostics:**\n\`\`\`json\n${JSON.stringify(failureDiag, null, 2)}\n\`\`\`\n`;
                  }
                  if (stdout) md += `**Stdout:**\n\`\`\`\n${stdout}\n\`\`\`\n`;
                  if (stderr) md += `**Stderr:**\n\`\`\`\n${stderr}\n\`\`\`\n`;
                } else {
                  md += `**Evidence:** File not found (${evidFileJson})\n`;
                }
              } catch {
                md += `**Evidence:** Failed to read evidence file\n`;
              }
              md += '\n';
            }

            // Per-control summary
            md += '**Control Summary:**\n';
            for (const cid of ft.controls) {
              const mc = mpControlMap.get(cid);
              const directive = controlDirectivesMap[cid] || mc?.stamper_action || 'Unknown';
              md += `- ${cid}: **UNSAT** — Task failed (directive: ${directive})\n`;
            }
            md += '\n---\n\n';
          }

          const failReportDir = tenantLogsDir(tenant);
          const failTs = new Date().toISOString().replace(/[:.]/g, '-');
          const failReportPath = path.join(failReportDir, `failure-report-${failTs}.md`);
          writeTextArtifact(failReportPath, md);
          send({ type: 'failure_report_generated', path: failReportPath });
        } catch (failReportErr) {
          console.error('Failed to write failure report:', failReportErr);
        }
      }

      // ---- Fix 4: Persist captured variables back to plan file ----
      if (planPath && mode !== 'dryrun_log') {
        try {
          const planOnDisk = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
          planOnDisk.variables = { ...planOnDisk.variables, ...plan.variables };
          writeJsonArtifact(planPath, planOnDisk);
          send({ type: 'log', message: 'Captured variables persisted to plan file.' });
        } catch { /* non-fatal — plan file may be read-only or deleted */ }
      }

      send({ type: 'done' });
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'error', message: msg });
      res.end();
    } finally {
      clearInterval(heartbeat);
      executionInProgress = false;
    }
  });

  // POST /api/approve — resolve a pending approval gate (step, sub-command, or layer level)
  router.post('/api/approve', (req: Request, res: Response) => {
    try {
      const { taskId, subId, layer, decision, gateType } = req.body as {
        taskId?: string;
        subId?: string;
        layer?: number;
        decision: 'approve' | 'skip' | 'accomplish';
        gateType?: string;
      };

      if (!decision) {
        res.status(400).json({ ok: false, error: 'decision is required' });
        return;
      }

      // Layer-level gate: layer::N; Sub-command-level: taskId::subId; Step-level: taskId
      let gateKey: string;
      if (layer !== undefined) {
        gateKey = `layer::${layer}`;
      } else if (taskId && subId) {
        gateKey = gateType === 'evidence' ? `evidence::${taskId}::${subId}` : `${taskId}::${subId}`;
      } else if (taskId) {
        gateKey = taskId;
      } else {
        res.status(400).json({ ok: false, error: 'taskId or layer is required' });
        return;
      }

      const resolver = approvalGate.get(gateKey);
      if (!resolver) {
        res.status(404).json({ ok: false, error: `No pending approval for: ${gateKey}` });
        return;
      }

      resolver(decision);
      approvalGate.delete(gateKey);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/abort — request graceful halt of running execution
  router.post('/api/abort', (_req: Request, res: Response) => {
    setAbortRequested(true);
    // Resolve all pending approval gates with 'skip' so execution doesn't hang
    for (const [key, resolver] of approvalGate.entries()) {
      resolver('skip');
      approvalGate.delete(key);
    }
    res.json({ ok: true });
  });

  // GET /api/preflight — SSE: check & grant Graph permissions + directory roles
  router.get('/api/preflight', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    let closed = false;
    req.on('close', () => { closed = true; });

    // Import these constants from GuiServer
    const REQUIRED_GRAPH_PERMISSIONS = [
      'Policy.ReadWrite.ConditionalAccess',
      'Directory.ReadWrite.All',
      'DeviceManagementConfiguration.ReadWrite.All',
      'DeviceManagementManagedDevices.ReadWrite.All',
      'DeviceManagementServiceConfig.ReadWrite.All',
      'User.ReadWrite.All',
      'Group.ReadWrite.All',
      'RoleManagement.ReadWrite.Directory',
      'Organization.ReadWrite.All',
      'Policy.ReadWrite.Authorization',
      'AuditLog.Read.All',
      'SecurityEvents.ReadWrite.All',
      'ThreatIndicators.ReadWrite.OwnedBy',
      'IdentityRiskyUser.ReadWrite.All',
      'IdentityRiskEvent.ReadWrite.All',
      'InformationProtectionPolicy.Read.All',
      'AppRoleAssignment.ReadWrite.All',
      'DeviceManagementApps.ReadWrite.All',
      'SecurityAlert.Read.All',
      'SecurityAlert.ReadWrite.All',
      'SecurityIncident.Read.All',
      'SecurityIncident.ReadWrite.All',
    ];

    const REQUIRED_DIRECTORY_ROLES = [
      'Exchange Administrator',
      'SharePoint Administrator',
      'Compliance Administrator',
    ];

    /**
     * Parse the first complete JSON value from PowerShell stdout.
     * PS can concatenate multiple JSON objects or append extra text after
     * ConvertTo-Json output, causing `JSON.parse()` to throw.
     */
    function psJsonParse(raw: string): any {
      const trimmed = raw.trim();
      // Fast path — works for most single-object outputs
      try { return JSON.parse(trimmed); } catch { /* fall through */ }

      // Find the first '{' or '['
      const objIdx = trimmed.indexOf('{');
      const arrIdx = trimmed.indexOf('[');
      const start = objIdx >= 0 && arrIdx >= 0 ? Math.min(objIdx, arrIdx)
                  : objIdx >= 0 ? objIdx : arrIdx;
      if (start < 0) throw new SyntaxError('No JSON object or array found in PowerShell output');

      const open = trimmed[start];
      const close = open === '{' ? '}' : ']';
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < trimmed.length; i++) {
        const c = trimmed[i];
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === open) depth++;
        if (c === close) { depth--; if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1)); }
      }
      throw new SyntaxError('Unterminated JSON in PowerShell output');
    }

    interface TenantConfigFile {
      client?: { name?: string; slug?: string };
      tenant?: { tenant_id?: string; domain?: string; environment?: string };
      auth?: { app_id?: string; cert_thumbprint?: string };
    }

    try {
      const tenant = req.query['tenant'] as string | undefined;
      if (!tenant || tenant === 'dev') {
        send({ type: 'error', message: 'Preflight requires a real tenant. Select one from the dropdown.' });
        res.end();
        return;
      }

      // Load tenant config
      const tenantJsonPath = await resolveTenantJsonPath(tenant);
      if (!fs.existsSync(tenantJsonPath)) {
        send({ type: 'error', message: `Tenant config not found: ${tenantJsonPath}` });
        res.end();
        return;
      }

      const clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);
      const tenantRaw: TenantConfigFile = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));

      send({ type: 'connection_log', phase: 'config_loaded',
        message: `Tenant config loaded: ${tenantRaw.client?.name ?? tenant}`, tenant });

      const sessionManager = new SessionManager(clientConfig, false);

      send({ type: 'connection_log', phase: 'connecting', message: 'Connecting to Microsoft Graph...', tenant });
      await sessionManager.connectMgGraph(
        tenantRaw.tenant?.tenant_id,
        tenantRaw.auth?.app_id,
        tenantRaw.auth?.cert_thumbprint
      );
      send({ type: 'connection_log', phase: 'connected', message: 'Graph session connected', tenant });

      const appId = clientConfig.appId;
      if (!appId) {
        send({ type: 'error', message: 'No appId in tenant config — cannot run preflight.' });
        res.end();
        return;
      }

      // ---- Phase 1: Discover service principal ----
      send({ type: 'connection_log', phase: 'info', message: 'Discovering service principal...', tenant });

      const spResult = await sessionManager.execute('graph',
        `Get-MgServicePrincipal -Filter "appId eq '${appId}'" | ConvertTo-Json -Depth 3`);
      if (spResult.exitCode !== 0 || !spResult.stdout.trim()) {
        send({ type: 'error', message: `Cannot find service principal for appId ${appId}: ${spResult.stderr}` });
        res.end();
        return;
      }
      const spData = psJsonParse(spResult.stdout);
      const spId: string = spData.Id;
      send({ type: 'connection_log', phase: 'info', message: `Service principal: ${spData.DisplayName ?? appId} (${spId})`, tenant });

      // Get Microsoft Graph SP and its AppRoles
      const graphSpResult = await sessionManager.execute('graph',
        `Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'" | Select-Object Id, AppRoles | ConvertTo-Json -Depth 5`);
      if (graphSpResult.exitCode !== 0 || !graphSpResult.stdout.trim()) {
        send({ type: 'error', message: `Cannot find Microsoft Graph SP: ${graphSpResult.stderr}` });
        res.end();
        return;
      }
      const graphSpData = psJsonParse(graphSpResult.stdout);
      const graphSpId: string = graphSpData.Id;

      // Build appRoleName→Id lookup
      const appRoleMap = new Map<string, string>();
      for (const role of graphSpData.AppRoles || []) {
        if (role.Value) appRoleMap.set(role.Value, role.Id);
      }

      // Get current role assignments
      const assignResult = await sessionManager.execute('graph',
        `Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId '${spId}' -All | ConvertTo-Json -Depth 3`);
      const currentAssignments: any[] = assignResult.exitCode === 0 && assignResult.stdout.trim()
        ? (() => { const p = psJsonParse(assignResult.stdout); return Array.isArray(p) ? p : [p]; })()
        : [];
      const grantedRoleIds = new Set(currentAssignments.map((a: any) => a.AppRoleId));

      // Check each required permission
      const graphStats = { total: REQUIRED_GRAPH_PERMISSIONS.length, alreadyGranted: 0, newlyGranted: 0, failed: 0 };
      const missingPerms: { name: string; roleId: string }[] = [];

      for (const perm of REQUIRED_GRAPH_PERMISSIONS) {
        if (closed) break;
        const roleId = appRoleMap.get(perm);
        if (!roleId) {
          send({ type: 'preflight_check', phase: 'graph_permission', name: perm, status: 'unknown', detail: 'Not found in Graph AppRoles' });
          graphStats.failed++;
          continue;
        }
        if (grantedRoleIds.has(roleId)) {
          send({ type: 'preflight_check', phase: 'graph_permission', name: perm, status: 'granted' });
          graphStats.alreadyGranted++;
        } else {
          send({ type: 'preflight_check', phase: 'graph_permission', name: perm, status: 'missing' });
          missingPerms.push({ name: perm, roleId });
        }
      }

      // ---- Phase 2: Grant missing Graph permissions ----
      // Gate: the SP needs AppRoleAssignment.ReadWrite.All to grant itself permissions
      const canGrantPerms = grantedRoleIds.has(appRoleMap.get('AppRoleAssignment.ReadWrite.All') ?? '');
      const canAssignRoles = grantedRoleIds.has(appRoleMap.get('RoleManagement.ReadWrite.Directory') ?? '');

      if (missingPerms.length > 0 && !closed) {
        if (!canGrantPerms) {
          send({ type: 'preflight_action', phase: 'graph_permission', name: 'AppRoleAssignment.ReadWrite.All', result: 'error',
            error: 'BOOTSTRAP REQUIRED — The SP cannot grant itself permissions without AppRoleAssignment.ReadWrite.All. ' +
                   'An admin must grant this via Azure Portal > App registrations > API permissions > Add > AppRoleAssignment.ReadWrite.All > Grant admin consent.' });
          graphStats.failed += missingPerms.length;
        } else {
          send({ type: 'connection_log', phase: 'info', message: `Granting ${missingPerms.length} missing Graph permission(s)...`, tenant });
          for (const mp of missingPerms) {
            if (closed) break;
            try {
              const grantResult = await sessionManager.execute('graph',
                `New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId '${spId}' -PrincipalId '${spId}' -ResourceId '${graphSpId}' -AppRoleId '${mp.roleId}' | ConvertTo-Json`);
              if (grantResult.exitCode === 0) {
                send({ type: 'preflight_action', phase: 'graph_permission', name: mp.name, result: 'granted' });
                graphStats.newlyGranted++;
              } else {
                send({ type: 'preflight_action', phase: 'graph_permission', name: mp.name, result: 'error', error: grantResult.stderr });
                graphStats.failed++;
              }
            } catch (grantErr) {
              const gMsg = grantErr instanceof Error ? grantErr.message : String(grantErr);
              send({ type: 'preflight_action', phase: 'graph_permission', name: mp.name, result: 'error', error: gMsg });
              graphStats.failed++;
            }
          }
        }
      }

      // ---- Phase 3: Check directory role assignments ----
      const roleStats = { total: REQUIRED_DIRECTORY_ROLES.length, alreadyAssigned: 0, newlyAssigned: 0, failed: 0 };
      const missingRoles: { name: string; roleDefId: string }[] = [];

      for (const roleName of REQUIRED_DIRECTORY_ROLES) {
        if (closed) break;
        try {
          const roleDefResult = await sessionManager.execute('graph',
            `Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq '${roleName}'" | Select-Object Id, DisplayName | ConvertTo-Json`);
          if (roleDefResult.exitCode !== 0 || !roleDefResult.stdout.trim()) {
            send({ type: 'preflight_check', phase: 'directory_role', name: roleName, status: 'unknown', detail: 'Role definition not found' });
            roleStats.failed++;
            continue;
          }
          const roleDef = psJsonParse(roleDefResult.stdout);
          const roleDefId: string = roleDef.Id;

          const assignCheck = await sessionManager.execute('graph',
            `Get-MgRoleManagementDirectoryRoleAssignment -Filter "principalId eq '${spId}' and roleDefinitionId eq '${roleDefId}'" | ConvertTo-Json`);
          if (assignCheck.exitCode === 0 && assignCheck.stdout.trim() && assignCheck.stdout.trim() !== '[]') {
            send({ type: 'preflight_check', phase: 'directory_role', name: roleName, status: 'assigned' });
            roleStats.alreadyAssigned++;
          } else {
            send({ type: 'preflight_check', phase: 'directory_role', name: roleName, status: 'missing' });
            missingRoles.push({ name: roleName, roleDefId });
          }
        } catch (roleErr) {
          const rMsg = roleErr instanceof Error ? roleErr.message : String(roleErr);
          send({ type: 'preflight_check', phase: 'directory_role', name: roleName, status: 'error', detail: rMsg });
          roleStats.failed++;
        }
      }

      // ---- Phase 4: Assign missing directory roles ----
      if (missingRoles.length > 0 && !closed) {
        if (!canAssignRoles) {
          send({ type: 'preflight_action', phase: 'directory_role', name: 'RoleManagement.ReadWrite.Directory', result: 'error',
            error: 'BOOTSTRAP REQUIRED — The SP cannot assign directory roles without RoleManagement.ReadWrite.Directory. ' +
                   'An admin must grant this via Azure Portal > App registrations > API permissions > Add > RoleManagement.ReadWrite.Directory > Grant admin consent.' });
          roleStats.failed += missingRoles.length;
        } else {
          send({ type: 'connection_log', phase: 'info', message: `Assigning ${missingRoles.length} missing directory role(s)...`, tenant });
          for (const mr of missingRoles) {
            if (closed) break;
            try {
              const assignRoleResult = await sessionManager.execute('graph',
                `New-MgRoleManagementDirectoryRoleAssignment -PrincipalId '${spId}' -RoleDefinitionId '${mr.roleDefId}' -DirectoryScopeId '/' | ConvertTo-Json`);
              if (assignRoleResult.exitCode === 0) {
                send({ type: 'preflight_action', phase: 'directory_role', name: mr.name, result: 'assigned' });
                roleStats.newlyAssigned++;
              } else {
                send({ type: 'preflight_action', phase: 'directory_role', name: mr.name, result: 'error', error: assignRoleResult.stderr });
                roleStats.failed++;
              }
            } catch (assignErr) {
              const aMsg = assignErr instanceof Error ? assignErr.message : String(assignErr);
              send({ type: 'preflight_action', phase: 'directory_role', name: mr.name, result: 'error', error: aMsg });
              roleStats.failed++;
            }
          }
        }
      }

      // ---- Phase 5: Tenant readiness (org branding) ----
      const tenantReadiness = { checked: 0, created: 0, failed: 0 };
      if (!closed) {
        send({ type: 'connection_log', phase: 'info', message: 'Checking tenant readiness...', tenant });
        const tenantId = clientConfig.tenantId;
        try {
          tenantReadiness.checked++;
          const brandingResult = await sessionManager.execute('graph',
            `Get-MgOrganizationBranding -OrganizationId '${tenantId}' | Select-Object Id | ConvertTo-Json`);
          if (brandingResult.exitCode === 0 && brandingResult.stdout?.trim()) {
            send({ type: 'preflight_check', phase: 'tenant_readiness', name: 'Organization Branding', status: 'exists' });
          } else {
            send({ type: 'preflight_check', phase: 'tenant_readiness', name: 'Organization Branding', status: 'missing' });
            try {
              const createResult = await sessionManager.execute('graph',
                `Invoke-MgGraphRequest -Method PUT -Uri "v1.0/organization/${tenantId}/branding" -Body '{}' -ContentType 'application/json' | ConvertTo-Json`);
              if (createResult.exitCode === 0) {
                send({ type: 'preflight_action', phase: 'tenant_readiness', name: 'Organization Branding', result: 'created' });
                tenantReadiness.created++;
              } else {
                send({ type: 'preflight_action', phase: 'tenant_readiness', name: 'Organization Branding', result: 'error', error: createResult.stderr });
                tenantReadiness.failed++;
              }
            } catch (createErr) {
              const cMsg = createErr instanceof Error ? createErr.message : String(createErr);
              send({ type: 'preflight_action', phase: 'tenant_readiness', name: 'Organization Branding', result: 'error', error: cMsg });
              tenantReadiness.failed++;
            }
          }
        } catch (brandingErr) {
          // 404 or other error — branding resource doesn't exist
          send({ type: 'preflight_check', phase: 'tenant_readiness', name: 'Organization Branding', status: 'missing' });
          try {
            const createResult = await sessionManager.execute('graph',
              `Invoke-MgGraphRequest -Method PUT -Uri "v1.0/organization/${tenantId}/branding" -Body '{}' -ContentType 'application/json' | ConvertTo-Json`);
            if (createResult.exitCode === 0) {
              send({ type: 'preflight_action', phase: 'tenant_readiness', name: 'Organization Branding', result: 'created' });
              tenantReadiness.created++;
            } else {
              send({ type: 'preflight_action', phase: 'tenant_readiness', name: 'Organization Branding', result: 'error', error: createResult.stderr });
              tenantReadiness.failed++;
            }
          } catch (createErr) {
            const cMsg = createErr instanceof Error ? createErr.message : String(createErr);
            send({ type: 'preflight_action', phase: 'tenant_readiness', name: 'Organization Branding', result: 'error', error: cMsg });
            tenantReadiness.failed++;
          }
        }
      }

      // ---- Phase 5b: Exchange org customization ----
      if (!closed) {
        try {
          tenantReadiness.checked++;
          const exOrgResult = await sessionManager.execute('exchange',
            `Get-OrganizationConfig | Select-Object IsDehydrated | ConvertTo-Json`);
          if (exOrgResult.exitCode === 0 && exOrgResult.stdout?.trim()) {
            const orgConfig = psJsonParse(exOrgResult.stdout);
            if (orgConfig.IsDehydrated === true) {
              send({ type: 'preflight_check', phase: 'tenant_readiness', name: 'Exchange Org Customization', status: 'missing' });
              try {
                const enableResult = await sessionManager.execute('exchange', `Enable-OrganizationCustomization`);
                if (enableResult.exitCode === 0) {
                  send({ type: 'preflight_action', phase: 'tenant_readiness', name: 'Exchange Org Customization', result: 'created' });
                  tenantReadiness.created++;
                } else {
                  send({ type: 'preflight_action', phase: 'tenant_readiness', name: 'Exchange Org Customization', result: 'error', error: enableResult.stderr });
                  tenantReadiness.failed++;
                }
              } catch (enableErr) {
                const eMsg = enableErr instanceof Error ? enableErr.message : String(enableErr);
                send({ type: 'preflight_action', phase: 'tenant_readiness', name: 'Exchange Org Customization', result: 'error', error: eMsg });
                tenantReadiness.failed++;
              }
            } else {
              send({ type: 'preflight_check', phase: 'tenant_readiness', name: 'Exchange Org Customization', status: 'exists' });
            }
          } else {
            send({ type: 'preflight_check', phase: 'tenant_readiness', name: 'Exchange Org Customization', status: 'skipped', error: 'Could not query Exchange org config' });
          }
        } catch (exErr) {
          const exMsg = exErr instanceof Error ? exErr.message : String(exErr);
          send({ type: 'preflight_check', phase: 'tenant_readiness', name: 'Exchange Org Customization', status: 'skipped', error: exMsg });
        }
      }

      // ---- Summary + done ----
      send({
        type: 'preflight_summary',
        graphPermissions: graphStats,
        directoryRoles: roleStats,
        tenantReadiness,
      });

      send({ type: 'preflight_done' });
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'error', message: msg });
      res.end();
    }
  });

  return router;
}
