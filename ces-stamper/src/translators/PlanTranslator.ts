// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import {
  CESManualMissionPlanSchema,
  CESManualStep,
  CESHumanPlan,
  CESConfigIntent,
  EnrichedScopeExclusion,
  CESControlDirective,
  MPControl,
  CESPlanMeta,
  normalizeStamperAction,
  CESInfrastructureManifestSchema,
} from '../types/ces-artifacts.types.js';
import { SUPPORTED_PLAN_VERSIONS, ControlDispositionSchema, SECRET_VARIABLE_NAMES } from 'ces-shared/types/mission-plan';
import type { SecretReference, ProvisioningInputs } from 'ces-shared/types/mission-plan';
import { secretSentinel } from '../core/secretSentinel.js';
import {
  loadSprsWeights,
  enrichScopeExclusions,
  validateScopeExclusions,
} from '../core/ScopeExclusionValidator.js';
import {
  ExecutablePlan,
  ExeTask,
  Check,
  Engine,
  TaskType,
  Priority,
  Idempotency,
  EvidenceArtifact,
  SubCommand,
  CesIdentity,
} from '../types/schema.types.js';
import { LayerClassifier, ExecutionLayer, LAYER_NAMES } from './LayerClassifier.js';
import { ManifestReader } from './ManifestReader.js';
import { CommandRegistry } from '../registry/CommandRegistry.js';
import { CommandEntry } from '../registry/command-registry.types.js';
import { ClientConfig } from '../config/ClientConfig.js';
import { VARIABLE_MAPPING, VARIABLE_DEFAULTS } from '../shared/variable-map.js';
import { ExecutionContext, type VariableValidationTarget } from '../core/ExecutionContext.js';
import { resolveSharedDataPath } from '../core/sharedData.js';


interface VariableMergeReport {
  fromTenant: number;
  fromManifest: number;
  fromConfig: number;
  skipped: string[];
  /** W4-ST2: variables gap-filled from the Infra Manifest's stamper_variable_map. */
  fromInfraManifest?: number;
}

/** W4-ST2: translate options. `infraManifest` = the raw Infra Manifest JSON (Muster's infrastructure-manifest-*.json). */
export interface TranslateOptions {
  strictScope?: boolean;
  infraManifest?: unknown;
  /** Where the Infra Manifest was read from (recorded as variables._infra_manifest_source). */
  infraManifestSource?: string;
}

/** Warning prefixes for variables the executable plan cannot resolve (W4-ST2). */
export const UNRESOLVED_VARIABLE_PREFIX = 'UNRESOLVED_VARIABLE:';
export const UNRESOLVED_RUNTIME_VARIABLE_PREFIX = 'UNRESOLVED_RUNTIME_VARIABLE:';

/** Auto-generated placeholder values (e.g. sub_mkeonpc0_lo73tbt) are never real resource names. */
export const looksLikeGeneratedPlaceholder = (val: string): boolean => /^[a-z]+_[a-z0-9]{8,}_[a-z0-9]{7,}$/i.test(val);

/** FX2-ST3: warning prefix for a Mission Plan control that could not be translated as given. */
export const CONTROL_ISSUE_PREFIX = 'CONTROL_ISSUE:';

/** FX2-ST3: one quarantined Mission Plan control (translated as a manual-review directive). */
export interface ControlIssue {
  control_id: string;
  stamper_action: unknown;
  reason: string;
}

interface TranslationResult {
  plan: ExecutablePlan;
  layerSummary: Record<number, { name: string; taskCount: number; taskIds: string[] }>;
  warnings: string[];
  variableMergeReport: VariableMergeReport;
  /** FX2-ST3: controls quarantined as issues (empty when every control translated). */
  controlIssues?: ControlIssue[];
}

/**
 * FX2-ST3: why a Muster control cannot be translated as given (null = fine).
 * Checks the shared ControlDisposition contract and Stamper's action normalization.
 */
function controlProblem(c: unknown): string | null {
  const action = actionProblem(c);
  if (action !== null) return action;
  const parsed = ControlDispositionSchema.safeParse(c);
  if (!parsed.success) {
    return parsed.error.errors.map(e => `${e.path.join('.') || 'control'}: ${e.message}`).join('; ');
  }
  return null;
}

/** FX2-ST3: the stamper_action alone (missing, not a Muster value, or not normalizable). */
function actionProblem(c: unknown): string | null {
  const raw = (c as { stamper_action?: unknown } | null | undefined)?.stamper_action;
  if (raw === undefined || raw === null || raw === '') return 'stamper_action is missing';
  const parsed = ControlDispositionSchema.shape.stamper_action.safeParse(raw);
  if (!parsed.success) return `unknown stamper_action ${JSON.stringify(raw)}`;
  try {
    normalizeStamperAction(parsed.data);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

/**
 * Translates a CES Manual Mission Plan into a Stamper-compatible Executable Plan.
 *
 * Phase 8: Accepts Mission Plan (primary) + Tenant Manifest (separate file) as dual inputs.
 * Phase 9: Cross-references config intents and injects desired_config, _get_command,
 *           _idempotency_pattern, and routes Purview tasks to engine: 'ipps'.
 * Phase 10: Removes 50-postcheck cap; sorts by severity; rewrites precheck generation.
 * Phase 11: Registry-backed command resolution — lookups by control_id produce deterministic
 *            sub-commands with variable contracts and capture chaining.
 */
export class PlanTranslator {
  private classifier: LayerClassifier;
  private registry?: CommandRegistry;
  private clientConfig?: ClientConfig;
  private mpControls: MPControl[] | null;
  private infrastructureModel?: 'm365_only' | 'm365_sentinel' | 'm365_azure';
  private cmmcReferenceCache: any;
  /** FX2-ST3: controls quarantined by the current translate (reset each call). */
  private controlIssues: ControlIssue[] = [];

  constructor(registry?: CommandRegistry, clientConfig?: ClientConfig, mpControls?: MPControl[], infrastructureModel?: 'm365_only' | 'm365_sentinel' | 'm365_azure') {
    this.classifier = new LayerClassifier();
    this.registry = registry;
    this.clientConfig = clientConfig;
    this.mpControls = mpControls ?? null;
    this.infrastructureModel = infrastructureModel;
    // FX2-ST1: canonical ces-shared control reference (no local copy)
    this.cmmcReferenceCache = JSON.parse(fs.readFileSync(resolveSharedDataPath('cmmc-l2-controls.reference.json'), 'utf-8'));
  }

  /**
   * Load a registry from file. Allows late-binding for callers that construct
   * PlanTranslator before knowing the registry path.
   */
  loadRegistry(registryPath?: string): void {
    this.registry = CommandRegistry.load(registryPath);
  }

  /**
   * G1/T2 identity propagation: build the `ces` identity block carried on the
   * ExecutablePlan from the mission plan's `ces` envelope. Propagates the
   * (customer, SI-baseline) tuple so it survives Planner → Stamper.
   *
   * Only includes keys actually present (no undefined-valued keys). tenantSlug
   * is sourced from the loaded tenant config (ClientConfig.tenantSlug) or, if
   * absent, the merged variables['tenant_slug']; omitted when neither is set.
   */
  private buildCesIdentity(planMeta: CESPlanMeta | undefined, variables?: Record<string, any>): CesIdentity | undefined {
    const ces: CesIdentity = {};
    if (planMeta) {
      if (planMeta.cesId !== undefined) ces.cesId = planMeta.cesId;
      if (planMeta.customerId !== undefined) ces.customerId = planMeta.customerId;
      if (planMeta.siBaselineId !== undefined) ces.siBaselineId = planMeta.siBaselineId;
      if (planMeta.customerName !== undefined) ces.customerName = planMeta.customerName;
    }
    const tenantSlug = this.clientConfig?.tenantSlug ?? variables?.['tenant_slug'];
    if (tenantSlug !== undefined && tenantSlug !== null && tenantSlug !== '') {
      ces.tenantSlug = tenantSlug;
    }
    return Object.keys(ces).length > 0 ? ces : undefined;
  }

  /**
   * Phase 8.1: Translate a Mission Plan file + separate Tenant Manifest file.
   * manifestPath is required. For older MP formats with embedded manifest,
   * callers should migrate to providing a separate manifest file.
   */
  translateFile(missionPlanPath: string, manifestPath: string, outputPath?: string, tenantVariablesPath?: string, options?: TranslateOptions): TranslationResult {
    if (!fs.existsSync(missionPlanPath)) {
      throw new Error(`Mission plan file not found: ${missionPlanPath}`);
    }

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Tenant manifest file not found: ${manifestPath}`);
    }

    const manifestReader = ManifestReader.fromFile(manifestPath);
    const data = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
    const result = this.translate(data, manifestReader, tenantVariablesPath, options);

    if (outputPath) {
      writeJsonArtifact(outputPath, result.plan);
    }

    return result;
  }

  /**
   * Phase 8.2: translate() accepts a ManifestReader instance directly.
   * The caller is responsible for constructing the ManifestReader from the
   * separate tenant manifest file.
   */
  translate(missionPlanData: unknown, manifest: ManifestReader, tenantVariablesPath?: string, options?: TranslateOptions): TranslationResult {
    // W4-ST2: the Infra Manifest is validated with the shared contract (canonical
    // `infrastructure` key or the deprecated `infrastructure_manifest` alias; variable
    // aliases normalized). Its infrastructure_model scopes the registry when the caller
    // did not set one.
    let infraVarMap: Record<string, unknown> | undefined;
    let infraSecretRefs: SecretReference[] = [];
    if (options?.infraManifest !== undefined) {
      const parsed = CESInfrastructureManifestSchema.safeParse(options.infraManifest);
      if (!parsed.success) {
        throw new Error(`Invalid infrastructure manifest: ${parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      this.infrastructureModel ??= parsed.data.infrastructure.infrastructure_model;
      infraVarMap = (parsed.data.infrastructure.stamper_variable_map ?? {}) as Record<string, unknown>;
      infraSecretRefs = parsed.data.infrastructure.secret_references ?? [];
    }

    const result = this.translateCore(missionPlanData, manifest, tenantVariablesPath, options);

    // FX2-ST3: quarantined controls are visible issue rows, never silent.
    result.controlIssues = [...this.controlIssues];
    if (this.controlIssues.length > 0) {
      for (const issue of this.controlIssues) {
        result.warnings.push(
          `${CONTROL_ISSUE_PREFIX} ${issue.control_id} — stamper_action ${JSON.stringify(issue.stamper_action ?? null)}: ${issue.reason}. Translated as a manual-review directive.`
        );
      }
      result.plan.variables._control_issues = result.controlIssues;
    }

    if (infraVarMap) {
      this.mergeInfraManifestVariables(result, infraVarMap, options?.infraManifestSource);
    }
    // FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution): secret_references[] (Infra
    // Manifest) and provisioning_inputs (Tenant Manifest, m365-only sessions) never contribute a
    // plain value to plan.variables — only a safe sentinel token and reference metadata.
    this.applySecretReferences(result, infraSecretRefs, manifest.provisioningInputs);
    this.appendUnresolvedVariableWarnings(result);
    return result;
  }

  /**
   * FC-ST-3 step 2: gap-fill the sentinel + reference metadata for every secret-bearing
   * variable, from the Infra Manifest's `secret_references[]` and/or the Tenant Manifest's
   * `provisioning_inputs`. Never sets a plain value for a `SECRET_VARIABLE_NAMES` entry — the
   * real value is resolved only at execution time (PowerShellAdapter's secret overlay), from
   * whichever store (SecretStore, a future Key Vault reader) holds it then.
   */
  private applySecretReferences(
    result: TranslationResult,
    infraSecretRefs: SecretReference[],
    provisioningInputs: ProvisioningInputs | undefined
  ): void {
    const vars = result.plan.variables;
    const refs: SecretReference[] = [...infraSecretRefs];

    if (provisioningInputs) {
      // Non-secret provisioning fields map straight onto Stamper's existing camelCase names
      // (VARIABLE_MAPPING) — first-write-wins, same precedence as every other variable source.
      if (vars['approverUPN'] === undefined || vars['approverUPN'] === '') {
        vars['approverUPN'] = provisioningInputs.approver_upn;
      }
      const tou = provisioningInputs.terms_of_use_file;
      if (tou) {
        if (vars['touFileName'] === undefined || vars['touFileName'] === '') vars['touFileName'] = tou.file_name;
        if (vars['touFileBase64'] === undefined || vars['touFileBase64'] === '') vars['touFileBase64'] = tou.content_base64;
      }
      if (provisioningInputs.initial_password_ref) {
        refs.push(provisioningInputs.initial_password_ref);
      }
    }

    if (refs.length === 0) return;

    const secretRefMeta: Array<Record<string, string>> = [];
    for (const ref of refs) {
      const meta: Record<string, string> = { variable: ref.variable, form: ref.form };
      if (ref.form === 'one_time_operator_held') meta.ref = ref.ref;
      if (ref.form === 'key_vault_secret') { meta.vault = ref.vault; meta.name = ref.name; }
      secretRefMeta.push(meta);

      // First-write-wins, same precedence rule as every other variable source in this file:
      // a value already merged from a higher-precedence source (tenant config, Tenant Manifest,
      // prior infra var map merge) is left alone rather than overwritten with the sentinel.
      if (vars[ref.variable] === undefined || vars[ref.variable] === '') {
        vars[ref.variable] = secretSentinel(ref.variable);
      }
    }

    vars._secret_references = secretRefMeta;
  }

  /**
   * W4-ST2: gap-fill the Infra Manifest's stamper_variable_map into the plan variables
   * with the lowest precedence (after tenant variables, Tenant Manifest and tenant
   * config — first write wins, same rule as the GUI's former post-translate merge).
   * Generated placeholders are skipped with a visible warning.
   */
  private mergeInfraManifestVariables(result: TranslationResult, varMap: Record<string, unknown>, source?: string): void {
    const vars = result.plan.variables;
    let merged = 0;
    for (const [key, value] of Object.entries(varMap)) {
      if (typeof value !== 'string' || value === '') continue;
      // FC-ST-3 step 2: a SECRET_VARIABLE_NAMES entry must only ever arrive via
      // secret_references[] (applySecretReferences, sentinel only) — ces-shared's
      // InfraManifestSchema already rejects a plain non-empty stamper_variable_map.initialPassword
      // at the manifest level; this is defense-in-depth against any other manifest shape reaching
      // this merge with the field still populated.
      if ((SECRET_VARIABLE_NAMES as readonly string[]).includes(key)) {
        result.warnings.push(`INFRA_MANIFEST: refused plain value for secret variable "${key}" — use secret_references instead.`);
        continue;
      }
      if (looksLikeGeneratedPlaceholder(value)) {
        result.warnings.push(`INFRA_MANIFEST: skipped generated placeholder for "${key}" (${value})`);
        continue;
      }
      if (vars[key] !== undefined && vars[key] !== '') {
        result.variableMergeReport.skipped.push(key);
        continue;
      }
      vars[key] = value;
      merged++;
    }
    result.variableMergeReport.fromInfraManifest = merged;
    vars._infra_manifest_source = source ?? 'inline';
  }

  /**
   * W4-ST2: report every variable a sub-command requires that the executable plan
   * cannot resolve — not in plan variables, well-known defaults or the tenant config's
   * credentials, and not captured by any command in the plan (ExecutionContext
   * contract check). Runtime (capture-produced) variables are reported separately.
   */
  private appendUnresolvedVariableWarnings(result: TranslationResult): void {
    const ctx = new ExecutionContext(true);
    const known: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ ...VARIABLE_DEFAULTS, ...result.plan.variables })) {
      if (v !== undefined && v !== null && v !== '') known[k] = v;
    }
    ctx.loadManifestVariables(known);
    if (this.clientConfig) ctx.loadClientConfig(this.clientConfig);

    const produced = new Set<string>();
    const targets: VariableValidationTarget[] = [];
    for (const task of result.plan.execution_graph) {
      for (const sub of (task.action.args._sub_commands as SubCommand[] | undefined) ?? []) {
        for (const c of sub.captures ?? []) produced.add(c.variable);
        targets.push({
          step_id: task.id,
          entry_id: sub.id,
          variables_required: sub.variables_required ?? [],
          variables_runtime: sub.variables_runtime ?? [],
        });
      }
    }
    const seen = new Set<string>();
    for (const err of ctx.validateManifestContract(targets, produced)) {
      const prefix = err.source === 'manifest' ? UNRESOLVED_VARIABLE_PREFIX : UNRESOLVED_RUNTIME_VARIABLE_PREFIX;
      const key = `${prefix}${err.missing_variable}:${err.entry_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.warnings.push(`${prefix} ${err.missing_variable} (required by ${err.entry_id}, task ${err.step_id})`);
    }
  }

  /**
   * FX2-ST3: drop controls that fail the shared contract or Stamper's action
   * normalization from the plan (and from mpControls) and record each as an issue.
   * Returns the plan to validate; the input object is not mutated.
   */
  private quarantineBadControls(raw: Record<string, any> | null | undefined): unknown {
    this.controlIssues = [];
    const hp = raw?.outputs?.human_readable_mission_plan;
    const controls = hp?.controls;
    if (!Array.isArray(controls)) {
      if (this.mpControls) this.mpControls = this.mpControls.filter(c => actionProblem(c) === null);
      return raw;
    }
    const valid: unknown[] = [];
    controls.forEach((c: any, i: number) => {
      const problem = controlProblem(c);
      if (problem === null) { valid.push(c); return; }
      const id = typeof c?.requirement_id === 'string' && c.requirement_id ? c.requirement_id : `controls[${i}]`;
      this.controlIssues.push({ control_id: id, stamper_action: c?.stamper_action, reason: problem });
    });
    // mpControls (caller-supplied) are filtered on the action only; flagged plan ids go too.
    const flagged = new Set(this.controlIssues.map(i => i.control_id));
    if (this.mpControls) this.mpControls = this.mpControls.filter(c => actionProblem(c) === null && !flagged.has(c.requirement_id));
    if (this.controlIssues.length === 0) return raw;
    return { ...raw, outputs: { ...raw!.outputs, human_readable_mission_plan: { ...hp, controls: valid } } };
  }

  /**
   * FX2-ST3: replace any directive for a quarantined control with a manual-review
   * directive, so the control stays visible (manual task + 'manual' in the map).
   */
  private withIssueDirectives(directives: CESControlDirective[]): CESControlDirective[] {
    if (this.controlIssues.length === 0) return directives;
    const referenceIds = new Set((this.cmmcReferenceCache.controls as Array<{ control_id: string }>).map(c => c.control_id));
    const flagged = new Set(this.controlIssues.map(i => i.control_id));
    const out = directives.filter(d => !flagged.has(d.control_id));
    for (const issue of this.controlIssues) {
      if (!referenceIds.has(issue.control_id)) continue;
      out.push({
        control_id: issue.control_id,
        directive: 'manual',
        justification: `Manual review required: Mission Plan control has an invalid stamper_action (${issue.reason})`,
      });
    }
    return out;
  }

  private translateCore(missionPlanData: unknown, manifest: ManifestReader, tenantVariablesPath?: string, options?: TranslateOptions): TranslationResult {
    // Validate input — version gate: reject unsupported contract versions with a clear error
    const raw = missionPlanData as Record<string, any> | null | undefined;
    if (raw?.ces?.version && !SUPPORTED_PLAN_VERSIONS.includes(raw.ces.version)) {
      throw new Error(
        `Unsupported mission plan version "${raw.ces.version}" — Stamper supports ${SUPPORTED_PLAN_VERSIONS.join(', ')}`
      );
    }
    // FX2-ST3: one bad control must not abort the whole translate — quarantine it.
    const sanitized = this.quarantineBadControls(raw);
    const parseResult = CESManualMissionPlanSchema.safeParse(sanitized);
    if (!parseResult.success) {
      throw new Error(
        `Mission plan validation failed: ${parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }

    const missionPlan = parseResult.data;
    const humanPlan = missionPlan.outputs.human_readable_mission_plan;
    const warnings: string[] = [];

    // ── Directive-mode detection ──
    const directives = humanPlan.control_directives;
    if (directives && directives.length > 0) {
      return this.translateFromDirectives(this.withIssueDirectives(directives), humanPlan, manifest, warnings, tenantVariablesPath, options, missionPlan.ces);
    }

    // Synthesize control_directives from controls[] when Muster provides
    // stamper_action but no explicit control_directives (Muster v1 format).
    if (this.mpControls && this.mpControls.length > 0) {
      const synthesized: CESControlDirective[] = [];
      for (const mc of this.mpControls) {
        if (!mc.stamper_action) continue;
        const normalized = normalizeStamperAction(mc.stamper_action);
        const DIRECTIVE_MAP: Record<string, CESControlDirective['directive'] | undefined> = {
          'automated': 'implement',
          'document-absence': 'document-absence',
          'document-prohibition': 'document-prohibition',
          'document-renderable': 'document-renderable',
          'inherit-fedramp': 'inherit-fedramp',
          'eo-tooled': 'eo-tooled',
          'nonstack': undefined,
        };
        const mapped = DIRECTIVE_MAP[normalized];
        if (mapped) {
          synthesized.push({
            control_id: mc.requirement_id,
            directive: mapped,
            justification: mc.scope_justification,
            fedramp_package_id: mc.fedramp_package_id,
          });
        }
      }
      if (synthesized.length > 0 || this.controlIssues.length > 0) {
        return this.translateFromDirectives(this.withIssueDirectives(synthesized), humanPlan, manifest, warnings, tenantVariablesPath, options, missionPlan.ces);
      }
    }

    // ── Scope Exclusion Handling ──
    const rawScopeExclusions = humanPlan.scope_exclusions ?? [];
    let enrichedScopeExclusions: EnrichedScopeExclusion[] = [];
    const excludedControlIds = new Set<string>();

    if (rawScopeExclusions.length > 0) {
      const sprsWeights = loadSprsWeights();
      enrichedScopeExclusions = enrichScopeExclusions(rawScopeExclusions, sprsWeights);
      const validation = validateScopeExclusions(rawScopeExclusions, sprsWeights, options?.strictScope ?? false);

      if (!validation.valid) {
        if (options?.strictScope) {
          throw new Error(`Scope exclusion validation failed (strict mode): ${validation.errors.join('; ')}`);
        }
      }

      for (const se of enrichedScopeExclusions) {
        excludedControlIds.add(se.requirement_id);
      }
    }

    // Warn if mission plan still carries an embedded manifest (deprecated flow)
    if (missionPlan.outputs.tenant_manifest) {
      warnings.push(
        'DEPRECATION: Mission plan contains an embedded tenant_manifest. ' +
        'Provide the manifest as a separate file via -m/--manifest. ' +
        'The embedded manifest is ignored when a separate manifest is provided.'
      );
    }

    // Classify steps into layers
    const layerAssignments = new Map<string, ExecutionLayer>();
    const layerTasks = new Map<ExecutionLayer, string[]>();

    const steps = humanPlan.steps ?? [];
    for (const step of steps) {
      const layer = (step.layer !== undefined && step.layer >= 0 && step.layer <= 8)
        ? step.layer as ExecutionLayer
        : this.classifier.classifyStep(step);
      layerAssignments.set(step.id, layer);

      if (!layerTasks.has(layer)) {
        layerTasks.set(layer, []);
      }
      layerTasks.get(layer)!.push(step.id);
    }

    // Build layer summary
    const layerSummary: Record<number, { name: string; taskCount: number; taskIds: string[] }> = {};
    for (const [layer, taskIds] of layerTasks.entries()) {
      layerSummary[layer] = {
        name: LAYER_NAMES[layer],
        taskCount: taskIds.length,
        taskIds
      };
    }

    // Build set of valid L2 control IDs for filtering out L1 controls
    const l2ControlIds = new Set(this.cmmcReferenceCache.controls.map((c: { control_id: string }) => c.control_id));

    // Translate steps to executable tasks with layer-based dependencies.
    const exeTasks: ExeTask[] = [];
    for (const step of steps) {
      // Filter out L1 controls from step control_coverage
      const allStepControlIds = (step.control_coverage ?? []).map(cc => cc.control_id);
      const stepControlIds = allStepControlIds.filter(cid => {
        if (!l2ControlIds.has(cid)) {
          console.log('L1 control filtered out:', cid, '— not in L2 reference set');
          return false;
        }
        return true;
      });
      if (allStepControlIds.length > 0 && stepControlIds.length === 0) {
        console.log(`Step ${step.id} has no L2 controls (all L1) — skipping step`);
        continue;
      }
      if (stepControlIds.length > 0 && excludedControlIds.size > 0) {
        const allExcluded = stepControlIds.every(cid => excludedControlIds.has(cid));
        if (allExcluded) {
          warnings.push(`SCOPE_EXCLUSION: All ${stepControlIds.length} control(s) excluded on step "${step.title}" — step flows through with excluded directive`);
        }
      }

      const task = this.translateStep(step, layerAssignments, layerTasks, humanPlan, manifest, warnings);

      // Annotate task with MP control directive metadata
      if (this.mpControls) {
        const stepControlIds = (step.control_coverage ?? []).map(cc => cc.control_id);
        for (const cid of stepControlIds) {
          const mpControl = this.mpControls.find(mp =>
            mp.level === 'L2' && mp.requirement_id === cid
          );
          if (mpControl) {
            if (!task.action.args._control_directives) {
              task.action.args._control_directives = [];
            }
            (task.action.args._control_directives as any[]).push({
              control_id: cid,
              action: mpControl.stamper_action,
              scope_status: mpControl.scope_status,
              readiness_status: mpControl.readiness_status,
            });
          }
        }
      }

      // Annotate mixed-control tasks (some controls excluded, some not)
      if (stepControlIds.length > 0 && excludedControlIds.size > 0) {
        const excludedOnStep = stepControlIds.filter(cid => excludedControlIds.has(cid));
        if (excludedOnStep.length > 0) {
          task.action.args._scope_excluded_controls = excludedOnStep.map(cid => {
            const se = enrichedScopeExclusions.find(e => e.requirement_id === cid);
            return se ? {
              requirement_id: se.requirement_id,
              nist_ref: se.nist_ref,
              justification: se.justification,
              si_field: se.si_field,
            } : { requirement_id: cid, nist_ref: '', justification: '', si_field: '' };
          });
          warnings.push(`SCOPE_EXCLUSION: Partial exclusion on task "${step.title}" — ${excludedOnStep.length} of ${stepControlIds.length} control(s) excluded`);
        }
      }

      exeTasks.push(task);
    }

    // Sort by layer then by original order within layer
    exeTasks.sort((a, b) => {
      const layerA = layerAssignments.get(a.id) ?? 0;
      const layerB = layerAssignments.get(b.id) ?? 0;
      return layerA - layerB;
    });

    // Deduplicate: if the same sub-command entry_id appears in multiple tasks,
    // keep it only in the first (lowest-layer) task and remove from later ones.
    const seenSubIds = new Set<string>();
    for (const task of exeTasks) {
      const subs = (task.action.args._sub_commands || []) as SubCommand[];
      const filtered = subs.filter(s => {
        if (seenSubIds.has(s.id)) return false;
        seenSubIds.add(s.id);
        return true;
      });
      task.action.args._sub_commands = filtered;
    }
    // Remove tasks that ended up with zero sub-commands after dedup
    const dedupedTasks = exeTasks.filter(t => {
      const subs = (t.action.args._sub_commands || []) as SubCommand[];
      return subs.length > 0 || t.action.engine === 'manual_gate';
    });

    // ── Gap-fill: ensure every L2 control in the MP has a task ──
    this.applyControlGapFill(dedupedTasks, enrichedScopeExclusions, 8);

    // Clean up depends_on: remove self-references and references to dedup-removed tasks
    const survivingIds = new Set(dedupedTasks.map(t => t.id));
    for (const task of dedupedTasks) {
      task.depends_on = task.depends_on.filter(id => id !== task.id && survivingIds.has(id));
    }

    // Semantic constraints: ensure retention/label tasks depend on audit-log tasks.
    // Previously enforced at runtime (DependencyResolver); now baked into the plan.
    const auditPattern = /Enable-OrganizationCustomization|Set-AdminAuditLogConfig/i;
    const retentionPattern = /New-Label|Set-Label|New-LabelPolicy|retention/i;

    const auditTaskIds = dedupedTasks
      .filter(t => (t.action.args._sub_commands || []).some(
        (s: SubCommand) => auditPattern.test(s.set_command || '')
      ))
      .map(t => t.id);

    if (auditTaskIds.length > 0) {
      for (const task of dedupedTasks) {
        const subs = (task.action.args._sub_commands || []) as SubCommand[];
        const isRetention = subs.some(s => retentionPattern.test(s.set_command || ''));
        if (isRetention && !task.depends_on.some(d => auditTaskIds.includes(d))) {
          task.depends_on.push(auditTaskIds[0]);
        }
      }
    }

    // Phase 10.2: Platform-level prechecks from query_method (via ManifestReader)
    const prechecks = manifest.generatePrechecks();
    if (prechecks.length === 0) {
      prechecks.push(...this.defaultPrechecks());
    }

    const allPostchecks = manifest.generatePostchecks();

    // Phase 10.1: Remove 50-cap. Sort by severity (high priority first).
    const prioritized = allPostchecks.sort((a, b) => severityRank(b) - severityRank(a));

    if (allPostchecks.length > 200) {
      warnings.push(
        `Large postcheck set: ${allPostchecks.length} postchecks generated. ` +
        'Review the manifest for unnecessary verification entries.'
      );
    }

    // Variable merge: tenant variables.json > manifest > ClientConfig
    // Tenant values (user-edited) take highest priority; manifest/config gap-fill only.
    const variableMergeReport = { fromTenant: 0, fromManifest: 0, fromConfig: 0, skipped: [] as string[] };

    // Start with tenant variables.json as the base (highest priority)
    let variables: Record<string, any> = {};
    if (tenantVariablesPath && fs.existsSync(tenantVariablesPath)) {
      try {
        const tenantVars = JSON.parse(fs.readFileSync(tenantVariablesPath, 'utf-8'));
        for (const [key, value] of Object.entries(tenantVars)) {
          variables[key] = value;
          variableMergeReport.fromTenant++;
        }
      } catch {
        // Non-fatal: continue without tenant vars if file read fails
      }
    }

    // Gap-fill from manifest (only keys not already in tenant variables)
    const manifestVars = manifest.generateVariables();
    for (const [key, value] of Object.entries(manifestVars)) {
      if (!(key in variables)) {
        variables[key] = value;
        variableMergeReport.fromManifest++;
      } else {
        variableMergeReport.skipped.push(key);
      }
    }

    // Infra domain: merge subscription variables from ClientConfig so Azure commands
    // have {subscriptionId}, {resourceGroup}, {location} available during execution.
    const configGapFill = (key: string, val: string | undefined) => {
      if (!val) return;
      if (!(key in variables)) { variables[key] = val; variableMergeReport.fromConfig++; }
      else { variableMergeReport.skipped.push(key); }
    };
    if ((this.infrastructureModel ?? this.clientConfig?.infrastructure_model) !== 'm365_only') {
      if (this.clientConfig?.subscription) {
        configGapFill('subscriptionId', this.clientConfig.subscription.subscription_id);
        configGapFill('resourceGroup', this.clientConfig.subscription.resource_group);
        configGapFill('location', this.clientConfig.subscription.location);
      }
    }

    // Merge resource variables from ClientConfig so infra registry commands have
    // all named resources available during execution.
    if (this.clientConfig?.resources) {
      const r = this.clientConfig.resources;
      for (const [camelKey, snakeKey] of Object.entries(VARIABLE_MAPPING)) {
        const value = (r as any)[snakeKey];
        if (value !== undefined) configGapFill(camelKey, value);
      }
    }

    // Derive primaryDomain from tenant domain if still missing
    if (!variables['primaryDomain'] && this.clientConfig?.targetTenantDomain) {
      variables['primaryDomain'] = this.clientConfig.targetTenantDomain;
    }

    // Derive tenantName (SharePoint prefix) from tenant domain if still missing
    if (!variables['tenantName'] && this.clientConfig?.targetTenantDomain) {
      variables['tenantName'] = this.clientConfig.targetTenantDomain.split('.')[0];
    }

    // Phase 3.3: Include drift_policies in plan variables so StamperEngine can
    // construct DriftExceptionRegistry on load.
    const driftPolicies = manifest.driftPolicies;

    // Build authoritative per-control directive map (110 entries)
    const controlDirectives = this.buildControlDirectives(dedupedTasks);

    // G1/T2: identity block from mission plan envelope (+ tenantSlug if available)
    const cesIdentity = this.buildCesIdentity(missionPlan.ces, variables);

    // Assemble the executable plan
    const plan: ExecutablePlan = {
      plan_id: `translated-${humanPlan.plan_id}`,
      target_level: humanPlan.target_level,
      tech_stack_id: manifest.techStackId,
      execution_graph: dedupedTasks,
      variables: {
        ...variables,
        _source: 'translated-from-manual-mission-plan',
        _source_plan_id: humanPlan.plan_id, // FX-ST4: bare Mission Plan id (results manifest planId)
        _plan_mode: humanPlan.plan_mode,
        _translated_at: new Date().toISOString(),
        _drift_policies: driftPolicies,
        _scope_exclusions: enrichedScopeExclusions,
        _control_directives: controlDirectives,
      },
      prechecks,
      postchecks: prioritized,
      ...(cesIdentity ? { ces: cesIdentity } : {}),
    };

    return { plan, layerSummary, warnings, variableMergeReport };
  }

  private translateStep(
    step: CESManualStep,
    layerAssignments: Map<string, ExecutionLayer>,
    layerTasks: Map<ExecutionLayer, string[]>,
    humanPlan: CESHumanPlan,
    manifest: ManifestReader,
    _warnings: string[]
  ): ExeTask {
    const layer = layerAssignments.get(step.id)!;

    // Map control IDs
    const controls = step.control_coverage.map(cc => cc.control_id);

    // Phase 11: Registry-backed command resolution.
    // Priority: registry lookup → vendor block → what_to_do fallback.
    // Filter registry by enclave (infrastructure_model) before querying.
    let effectiveRegistry = this.registry && (this.infrastructureModel ?? this.clientConfig?.infrastructure_model)
      ? this.registry.filterByEnclave(this.infrastructureModel ?? this.clientConfig!.infrastructure_model!)
      : this.registry?.allEntries ?? [];
    // Also exclude tenant-level excluded entries (BYOD, etc.)
    const tenantExcluded = this.clientConfig?.excluded_entries;
    if (tenantExcluded && tenantExcluded.length > 0) {
      const excludeSet = new Set(tenantExcluded);
      effectiveRegistry = effectiveRegistry.filter(e => !excludeSet.has(e.entry_id));
    }
    const registryEntries = effectiveRegistry.length > 0
      ? effectiveRegistry.filter(e =>
          e.control_ids.some(cid => controls.includes(cid))
        )
      : [];

    // Enrich controls with additional control_ids from matched registry entries
    const enrichedControls = new Set(controls);
    for (const entry of registryEntries) {
      for (const cid of entry.control_ids) {
        enrichedControls.add(cid);
      }
    }
    const finalControls = Array.from(enrichedControls);

    // Determine engine from vendor block or task type
    let engine = registryEntries.length > 0
      ? registryEntries[0].engine as Engine
      : this.determineEngine(step);

    // Build command — registry primary command or vendor/what_to_do fallback
    const command = registryEntries.length > 0
      ? registryEntries[0].set_command || this.buildCommand(step)
      : this.buildCommand(step);

    // Build depends_on from explicit deps + layer dependencies
    const dependsOn = this.buildDependencies(step, layer, layerAssignments, layerTasks, humanPlan);

    // Map task type
    const taskType = this.mapTaskType(step.task_type);

    // Map priority
    const priority = step.priority as Priority;

    // Determine idempotency
    const idempotency = this.determineIdempotency(step);

    // Build evidence artifacts
    const evidenceEmit = this.buildEvidenceArtifacts(step);

    // Build base args
    const args: Record<string, any> = {
      _layer: layer,
      _layer_name: LAYER_NAMES[layer],
      _step_title: step.title,
      _task_type: step.task_type,
      _directive: 'implement',
    };

    // Pass new CES-FE v2 step fields into args
    if (step.section) args._section = step.section;
    if (step.resource_type) args._resource_type = step.resource_type;
    if (step.gap_classifications) args._gap_classifications = step.gap_classifications;
    if (step.requirement_context) args._requirement_context = step.requirement_context;
    if (step.tech_ref) args._tech_ref = step.tech_ref;

    // Collect existing evidence commands from vendor blocks
    let existingEvidenceCmds: string[] = [];
    if (step.actions) {
      for (const action of step.actions) {
        if (action.vendor?.portal_path) {
          args._portal_path = action.vendor.portal_path;
        }
        if (action.vendor?.evidence_commands) {
          existingEvidenceCmds = [
            ...existingEvidenceCmds,
            ...action.vendor.evidence_commands
          ];
        }
        if (action.vendor?.tech_ref_guidance?.length) {
          args._tech_ref_guidance = action.vendor.tech_ref_guidance;
        }
      }
    }

    if (step.how_to_verify.length > 0) {
      args._verification_steps = step.how_to_verify;
    }

    // Phase 11: Assemble sub-commands from registry entries.
    if (registryEntries.length > 0) {
      const subCommands: SubCommand[] = registryEntries.map(entry => ({
        id: entry.entry_id,
        label: entry.label,
        set_command: entry.set_command,
        get_command: entry.get_command,
        engine: entry.engine as Engine,
        sequence_hint: entry.sequence_hint,
        idempotency: entry.idempotency,
        variables_required: entry.variables_required,
        variables_runtime: entry.variables_runtime,
        captures: entry.captures,
        on_failure: entry.on_failure,
        evidence_commands: entry.evidence_commands,
        verification: entry.verification,
      }));

      args._sub_commands = subCommands;

      // Aggregate _get_command from first non-empty entry
      const firstGetCmd = registryEntries.find(e => e.get_command)?.get_command;
      if (firstGetCmd) args._get_command = firstGetCmd;

      // Aggregate evidence commands from all entries
      const registryEvidenceCmds = registryEntries.flatMap(e => e.evidence_commands);
      args._evidence_commands = [
        ...existingEvidenceCmds,
        ...registryEvidenceCmds,
      ];

      // Track variable requirements for contract validation
      args._variables_required = registryEntries.flatMap(e => e.variables_required);
      args._variables_runtime = registryEntries.flatMap(e => e.variables_runtime);
      args._captures = registryEntries.flatMap(e => e.captures);
    } else {
      // Phase 9.1: Cross-reference config intents for all controls on this step.
      const configIntents: CESConfigIntent[] = [];
      for (const controlId of controls) {
        configIntents.push(...manifest.getConfigIntentsForControl(controlId));
      }

      // Deduplicate intents by id
      const seenIntentIds = new Set<string>();
      const uniqueIntents = configIntents.filter(ci => {
        if (seenIntentIds.has(ci.id)) return false;
        seenIntentIds.add(ci.id);
        return true;
      });

      // Phase 9.1 step 6: Route Purview/DLP tasks to IPPSAdapter based on service name.
      const stepServiceName = this.getServiceName(step);
      if (/sensitivityLabel|dlp|Purview/i.test(stepServiceName)) {
        engine = 'ipps';
        args._ipps_routed = true;
      }

      if (uniqueIntents.length > 0) {
        const mergedDesiredConfig: Record<string, any> = {};
        const intentEvidenceCmds: string[] = [];

        for (const intent of uniqueIntents) {
          Object.assign(mergedDesiredConfig, intent.desired_config);

          if (!args._get_command) {
            args._get_command = this.deriveGetCommand(command, intent.query_method);
          }
          if (!args._idempotency_pattern) {
            args._idempotency_pattern = this.deriveIdempotencyPattern(step);
          }
        }

        args._desired_config = mergedDesiredConfig;
        args._evidence_commands = [...existingEvidenceCmds, ...intentEvidenceCmds];
      } else if (existingEvidenceCmds.length > 0) {
        args._evidence_commands = existingEvidenceCmds;
      }
    }

    return {
      id: step.id,
      type: taskType,
      priority,
      depends_on: dependsOn,
      action: {
        engine,
        command,
        args
      },
      inputs: step.what_to_do,
      outputs: step.manual_completion_criteria,
      controls: finalControls,
      idempotency,
      rollback: this.determineRollback(step),
      evidence_emit: evidenceEmit.length > 0 ? evidenceEmit : undefined
    };
  }

  /**
   * Directive-mode translation: builds an ExecutablePlan from control_directives[].
   * implement directives delegate to existing translateStep() via step_ids.
   * validate directives build get-only sub-commands from registry.
   * manual directives build manual_gate tasks.
   * document-absence directives build narrative-only evidence tasks.
   * document-prohibition directives build enforcement verification tasks.
   * skip directives produce no output.
   */
  private translateFromDirectives(
    directives: CESControlDirective[],
    humanPlan: CESHumanPlan,
    manifest: ManifestReader,
    warnings: string[],
    tenantVariablesPath?: string,
    _options?: TranslateOptions,
    planMeta?: CESPlanMeta
  ): TranslationResult {
    // Load 110 controls from cached reference
    const cmmcRef: { controls: Array<{ control_id: string; family: string; cmmc_level: number; nist_ref: string; practice: string }> } = this.cmmcReferenceCache;
    const controlMap = new Map<string, { control_id: string; family: string; cmmc_level: number; nist_ref: string; practice: string }>();
    for (const c of cmmcRef.controls) {
      controlMap.set(c.control_id, c);
    }

    // Get effective registry entries (filtered by enclave + exclusions)
    let effectiveRegistry = this.registry && (this.infrastructureModel ?? this.clientConfig?.infrastructure_model)
      ? this.registry.filterByEnclave(this.infrastructureModel ?? this.clientConfig!.infrastructure_model!)
      : this.registry?.allEntries ?? [];
    const tenantExcluded = this.clientConfig?.excluded_entries;
    if (tenantExcluded && tenantExcluded.length > 0) {
      const excludeSet = new Set(tenantExcluded);
      effectiveRegistry = effectiveRegistry.filter(e => !excludeSet.has(e.entry_id));
    }

    // Group directives by type
    const implementDirectives: CESControlDirective[] = [];
    const validateDirectives: CESControlDirective[] = [];
    const manualDirectives: CESControlDirective[] = [];
    const absenceDirectives: CESControlDirective[] = [];
    const prohibitionDirectives: CESControlDirective[] = [];
    const inheritanceDirectives: CESControlDirective[] = [];
    const eoTooledDirectives: CESControlDirective[] = [];
    const skipDirectives: CESControlDirective[] = [];

    const renderableDirectives: CESControlDirective[] = [];

    for (const d of directives) {
      switch (d.directive) {
        case 'implement': implementDirectives.push(d); break;
        case 'validate': validateDirectives.push(d); break;
        case 'manual': manualDirectives.push(d); break;
        case 'document-absence': absenceDirectives.push(d); break;
        case 'document-prohibition': prohibitionDirectives.push(d); break;
        case 'document-renderable': renderableDirectives.push(d); break;
        case 'inherit-fedramp': inheritanceDirectives.push(d); break;
        case 'eo-tooled': eoTooledDirectives.push(d); break;
        case 'skip': skipDirectives.push(d); break;
      }
    }

    // Convert skip to manual_gate — skip is not a valid final state
    if (skipDirectives.length > 0) {
      console.warn('Skip directive found for controls:', skipDirectives.map(d => d.control_id).join(', '), '— converted to manual_gate (manual review required). Skip is not a valid final state.');
      skipDirectives.forEach(sd => manualDirectives.push(sd));
    }

    // Conflict detection: absence/prohibition wins over implement
    const absenceControlIds = new Set(absenceDirectives.map(d => d.control_id));
    const prohibitionControlIds = new Set(prohibitionDirectives.map(d => d.control_id));
    for (let i = implementDirectives.length - 1; i >= 0; i--) {
      if (absenceControlIds.has(implementDirectives[i].control_id)) {
        console.warn(`Directive conflict: ${implementDirectives[i].control_id} appears in both implement and document-absence — document-absence wins`);
        implementDirectives.splice(i, 1);
      } else if (prohibitionControlIds.has(implementDirectives[i].control_id)) {
        console.warn(`Directive conflict: ${implementDirectives[i].control_id} appears in both implement and document-prohibition — document-prohibition wins`);
        implementDirectives.splice(i, 1);
      }
    }

    // Reclassify: manual/nonstack → document-renderable for controls with signal-verifiable evidence.
    // The Planner FE doesn't emit document-renderable directives yet (Non-Stack → manual),
    // so Stamper intercepts these 7 controls and promotes them to document-renderable.
    const DOC_RENDERABLE_CONTROL_IDS = new Set([
      'IA.L2-3.5.8',   // Password Reuse
      'CM.L2-3.4.4',   // Security Impact Analysis
      'CM.L2-3.4.8',   // App Deny/Allow
      'AU.L2-3.3.6',   // Audit Reduction
      'CA.L2-3.12.2',  // POA&M
      'CA.L2-3.12.4',  // SSP
      'RA.L2-3.11.2',  // Vulnerability Scanning
    ]);
    for (let i = manualDirectives.length - 1; i >= 0; i--) {
      if (DOC_RENDERABLE_CONTROL_IDS.has(manualDirectives[i].control_id)) {
        const promoted = manualDirectives.splice(i, 1)[0];
        promoted.directive = 'document-renderable';
        renderableDirectives.push(promoted);
      }
    }

    const exeTasks: ExeTask[] = [];
    const layerAssignments = new Map<string, ExecutionLayer>();
    const layerTasks = new Map<ExecutionLayer, string[]>();
    const enrichedScopeExclusions: EnrichedScopeExclusion[] = [];

    // ── Merge MP-level scope_exclusions (Strategic Intent baseline) ──
    const rawScopeExclusions = humanPlan.scope_exclusions ?? [];
    if (rawScopeExclusions.length > 0) {
      const sprsWeights = loadSprsWeights();
      enrichedScopeExclusions.push(...enrichScopeExclusions(rawScopeExclusions, sprsWeights));
    }

    // ── implement directives: delegate to existing translateStep() via step_ids ──
    const steps = humanPlan.steps ?? [];
    const stepMap = new Map<string, CESManualStep>();
    for (const step of steps) {
      stepMap.set(step.id, step);
    }

    for (const d of implementDirectives) {
      if (!d.step_ids || d.step_ids.length === 0) {
        warnings.push(`DIRECTIVE: implement directive for ${d.control_id} has no step_ids — skipped`);
        continue;
      }
      if (steps.length === 0) {
        warnings.push(`DIRECTIVE: implement directive for ${d.control_id} has step_ids but humanPlan.steps is empty — skipped`);
        continue;
      }
      for (const stepId of d.step_ids) {
        // Try exact match first, then with step_ prefix (MP may use step_task_... IDs
        // while directives reference task_... IDs)
        const step = stepMap.get(stepId) ?? stepMap.get(`step_${stepId}`);
        if (!step) {
          warnings.push(`DIRECTIVE: implement directive for ${d.control_id} references unknown step_id "${stepId}" — skipped`);
          continue;
        }
        // Skip if already translated (another implement directive may reference the same step)
        if (layerAssignments.has(step.id)) continue;

        const layer = (step.layer !== undefined && step.layer >= 0 && step.layer <= 8)
          ? step.layer as ExecutionLayer
          : this.classifier.classifyStep(step);
        layerAssignments.set(step.id, layer);
        if (!layerTasks.has(layer)) layerTasks.set(layer, []);
        layerTasks.get(layer)!.push(step.id);

        const task = this.translateStep(step, layerAssignments, layerTasks, humanPlan, manifest, warnings);
        exeTasks.push(task);
      }
    }

    // ── validate directives: build get-only tasks ──
    for (const d of validateDirectives) {
      const matchingEntries = effectiveRegistry.filter(e => e.control_ids.includes(d.control_id));
      const layer: ExecutionLayer = 0; // Validate tasks → L0 (pre-check)
      const taskId = `validate-${d.control_id}`;
      const task = this.buildValidateTask(d.control_id, matchingEntries, {}, layer, controlMap);
      layerAssignments.set(taskId, layer);
      if (!layerTasks.has(layer)) layerTasks.set(layer, []);
      layerTasks.get(layer)!.push(taskId);
      exeTasks.push(task);
    }

    // ── manual directives: build manual_gate tasks ──
    for (const d of manualDirectives) {
      const layer: ExecutionLayer = 8; // Manual tasks → L8 (post-config)
      const taskId = `manual-${d.control_id}`;
      const task = this.buildManualTask(d.control_id, layer, controlMap);
      layerAssignments.set(taskId, layer);
      if (!layerTasks.has(layer)) layerTasks.set(layer, []);
      layerTasks.get(layer)!.push(taskId);
      exeTasks.push(task);
    }

    // ── document-absence directives: build absence evidence tasks (no automation) ──
    for (const d of absenceDirectives) {
      const layer: ExecutionLayer = 8;
      const task = this.buildProvisionalTask(d.control_id, 'document-absence', d.justification || 'Capability absent from CUI boundary', layer, controlMap);
      layerAssignments.set(task.id, layer);
      if (!layerTasks.has(layer)) layerTasks.set(layer, []);
      layerTasks.get(layer)!.push(task.id);
      exeTasks.push(task);
    }

    // ── document-prohibition directives: build enforcement evidence tasks (registry get_command) ──
    for (const d of prohibitionDirectives) {
      const matchingEntries = effectiveRegistry.filter(e => e.control_ids.includes(d.control_id));
      const layer: ExecutionLayer = 8;
      const task = this.buildProvisionalTask(d.control_id, 'document-prohibition', d.justification || 'Capability prohibited by design', layer, controlMap, matchingEntries);
      layerAssignments.set(task.id, layer);
      if (!layerTasks.has(layer)) layerTasks.set(layer, []);
      layerTasks.get(layer)!.push(task.id);
      exeTasks.push(task);
    }

    // ── inherit-fedramp directives: build inheritance verification tasks ──
    for (const d of inheritanceDirectives) {
      const layer: ExecutionLayer = 0; // L0 — verification tasks run early
      const task = this.buildInheritanceTask(d.control_id, d.justification || 'FedRAMP High inheritance from CSP', layer, controlMap, d.fedramp_package_id);
      layerAssignments.set(task.id, layer);
      if (!layerTasks.has(layer)) layerTasks.set(layer, []);
      layerTasks.get(layer)!.push(task.id);
      exeTasks.push(task);
    }

    // ── document-renderable directives: build signal verification + eo_render_directive tasks ──
    for (const d of renderableDirectives) {
      const matchingEntries = effectiveRegistry.filter(e => e.control_ids.includes(d.control_id));
      const layer: ExecutionLayer = 8; // L8 — post-config layer
      const task = this.buildProvisionalTask(d.control_id, 'document-renderable', d.justification || 'Document-renderable signal verification', layer, controlMap, matchingEntries);
      layerAssignments.set(task.id, layer);
      if (!layerTasks.has(layer)) layerTasks.set(layer, []);
      layerTasks.get(layer)!.push(task.id);
      exeTasks.push(task);
    }

    // ── eo-tooled directives: build EO-managed evidence tasks ──
    for (const d of eoTooledDirectives) {
      const layer: ExecutionLayer = 8;
      const task = this.buildEoTooledTask(d.control_id, d.justification || 'EO Personnel Card or Risk Assessment evidence', layer, controlMap);
      layerAssignments.set(task.id, layer);
      if (!layerTasks.has(layer)) layerTasks.set(layer, []);
      layerTasks.get(layer)!.push(task.id);
      exeTasks.push(task);
    }

    // ── Gap-fill: ensure every L2 control in the MP has a task ──
    this.applyControlGapFill(exeTasks, enrichedScopeExclusions, 8, layerAssignments, layerTasks);

    // Sort by layer then by control_id lexical within layer
    exeTasks.sort((a, b) => {
      const layerA = layerAssignments.get(a.id) ?? 0;
      const layerB = layerAssignments.get(b.id) ?? 0;
      if (layerA !== layerB) return layerA - layerB;
      return a.id.localeCompare(b.id);
    });

    // Build layer summary
    const layerSummary: Record<number, { name: string; taskCount: number; taskIds: string[] }> = {};
    for (const [layer, taskIds] of layerTasks.entries()) {
      layerSummary[layer] = {
        name: LAYER_NAMES[layer],
        taskCount: taskIds.length,
        taskIds
      };
    }

    // Variable merge (same logic as steps path)
    const variableMergeReport = { fromTenant: 0, fromManifest: 0, fromConfig: 0, skipped: [] as string[] };
    let variables: Record<string, any> = {};
    if (tenantVariablesPath && fs.existsSync(tenantVariablesPath)) {
      try {
        const tenantVars = JSON.parse(fs.readFileSync(tenantVariablesPath, 'utf-8'));
        for (const [key, value] of Object.entries(tenantVars)) {
          variables[key] = value;
          variableMergeReport.fromTenant++;
        }
      } catch { /* Non-fatal */ }
    }
    const manifestVars = manifest.generateVariables();
    for (const [key, value] of Object.entries(manifestVars)) {
      if (!(key in variables)) {
        variables[key] = value;
        variableMergeReport.fromManifest++;
      } else {
        variableMergeReport.skipped.push(key);
      }
    }
    const configGapFill = (key: string, val: string | undefined) => {
      if (!val) return;
      if (!(key in variables)) { variables[key] = val; variableMergeReport.fromConfig++; }
      else { variableMergeReport.skipped.push(key); }
    };
    if ((this.infrastructureModel ?? this.clientConfig?.infrastructure_model) !== 'm365_only') {
      if (this.clientConfig?.subscription) {
        configGapFill('subscriptionId', this.clientConfig.subscription.subscription_id);
        configGapFill('resourceGroup', this.clientConfig.subscription.resource_group);
        configGapFill('location', this.clientConfig.subscription.location);
      }
    }
    if (this.clientConfig?.resources) {
      const r = this.clientConfig.resources;
      for (const [camelKey, snakeKey] of Object.entries(VARIABLE_MAPPING)) {
        const value = (r as any)[snakeKey];
        if (value !== undefined) configGapFill(camelKey, value);
      }
    }
    if (!variables['primaryDomain'] && this.clientConfig?.targetTenantDomain) {
      variables['primaryDomain'] = this.clientConfig.targetTenantDomain;
    }
    if (!variables['tenantName'] && this.clientConfig?.targetTenantDomain) {
      variables['tenantName'] = this.clientConfig.targetTenantDomain.split('.')[0];
    }

    const driftPolicies = manifest.driftPolicies;

    // Build authoritative per-control directive map (110 entries)
    // Pass control_directives[] (Set B) as overrides so document-absence,
    // document-prohibition, etc. are correctly represented in the map.
    const controlDirectives = this.buildControlDirectives(exeTasks, directives);

    // Prechecks and postchecks
    const prechecks = manifest.generatePrechecks();
    if (prechecks.length === 0) {
      prechecks.push(...this.defaultPrechecks());
    }
    const postchecks = manifest.generatePostchecks();

    // G1/T2: identity block from mission plan envelope (+ tenantSlug if available)
    const cesIdentity = this.buildCesIdentity(planMeta, variables);

    const plan: ExecutablePlan = {
      plan_id: `translated-${humanPlan.plan_id}`,
      target_level: humanPlan.target_level,
      tech_stack_id: manifest.techStackId,
      execution_graph: exeTasks,
      variables: {
        ...variables,
        _source: 'translated-from-control-directives',
        _source_plan_id: humanPlan.plan_id, // FX-ST4: bare Mission Plan id (results manifest planId)
        _plan_mode: humanPlan.plan_mode,
        _translated_at: new Date().toISOString(),
        _drift_policies: driftPolicies,
        _scope_exclusions: enrichedScopeExclusions,
        _control_directives: controlDirectives,
      },
      prechecks,
      postchecks,
      ...(cesIdentity ? { ces: cesIdentity } : {}),
    };

    return { plan, layerSummary, warnings, variableMergeReport };
  }

  /**
   * Build a validate-type ExeTask that runs only get_command + evidence_commands
   * (no set_command) to verify a control is still met.
   */
  private buildValidateTask(
    controlId: string,
    registryEntries: CommandEntry[],
    _variables: Record<string, any>,
    layer: ExecutionLayer,
    controlMap: Map<string, { control_id: string; practice: string }>
  ): ExeTask {
    const controlRef = controlMap.get(controlId);
    const practiceText = controlRef?.practice || controlId;

    if (registryEntries.length === 0) {
      // No registry entries match: create single manual_gate sub-command
      const subCommands: SubCommand[] = [{
        id: `validate-manual-${controlId}`,
        label: `Validate: ${practiceText}`,
        set_command: '',
        get_command: '',
        engine: 'manual_gate' as Engine,
        sequence_hint: 0,
        idempotency: 'safe' as const,
        variables_required: [],
        variables_runtime: [],
        on_failure: 'warn_continue' as const,
        evidence_commands: [],
      }];

      return {
        id: `validate-${controlId}`,
        type: 'validate',
        priority: 'p1',
        depends_on: [],
        action: {
          engine: 'manual_gate',
          command: `Validate control ${controlId}`,
          args: {
            _layer: layer,
            _layer_name: LAYER_NAMES[layer],
            _step_title: `Validate: ${practiceText}`,
            _task_type: 'validate',
            _directive: 'validate',
            _sub_commands: subCommands,
          }
        },
        inputs: [`Confirm control ${controlId} is currently met`],
        outputs: [`${controlId} validation confirmed`],
        controls: [controlId],
        idempotency: 'safe',
        rollback: { strategy: 'none' },
      };
    }

    // Build sub-commands from entries using ONLY get_command + evidence_commands (exclude set_command)
    const subCommands: SubCommand[] = registryEntries.map(entry => ({
      id: entry.entry_id,
      label: entry.label,
      set_command: '',
      get_command: entry.get_command,
      engine: entry.engine as Engine,
      sequence_hint: entry.sequence_hint,
      idempotency: 'safe' as const,
      variables_required: entry.variables_required,
      variables_runtime: entry.variables_runtime,
      captures: entry.captures,
      on_failure: entry.on_failure,
      evidence_commands: entry.evidence_commands,
      verification: entry.verification,
    }));

    const engine: Engine = registryEntries[0].engine as Engine;

    return {
      id: `validate-${controlId}`,
      type: 'validate',
      priority: 'p1',
      depends_on: [],
      action: {
        engine,
        command: registryEntries[0].get_command || `Validate control ${controlId}`,
        args: {
          _layer: layer,
          _layer_name: LAYER_NAMES[layer],
          _step_title: `Validate: ${practiceText}`,
          _task_type: 'validate',
          _directive: 'validate',
          _sub_commands: subCommands,
          _get_command: registryEntries[0].get_command || undefined,
          _evidence_commands: registryEntries.flatMap(e => e.evidence_commands),
          _variables_required: registryEntries.flatMap(e => e.variables_required),
          _variables_runtime: registryEntries.flatMap(e => e.variables_runtime),
          _captures: registryEntries.flatMap(e => e.captures),
        }
      },
      inputs: [`Verify control ${controlId} is currently configured`],
      outputs: [`${controlId} validation result`],
      controls: [controlId],
      idempotency: 'safe',
      rollback: { strategy: 'none' },
    };
  }

  /**
   * Build a manual ExeTask with engine: 'manual_gate' for controls requiring
   * manual review via the existing approval gate mechanism.
   */
  private buildManualTask(
    controlId: string,
    layer: ExecutionLayer,
    controlMap: Map<string, { control_id: string; practice: string }>
  ): ExeTask {
    const controlRef = controlMap.get(controlId);
    const practiceText = controlRef?.practice || controlId;

    const subCommands: SubCommand[] = [{
      id: `manual-${controlId}`,
      label: practiceText,
      set_command: '',
      get_command: '',
      engine: 'manual_gate' as Engine,
      sequence_hint: 0,
      idempotency: 'safe' as const,
      variables_required: [],
      variables_runtime: [],
      on_failure: 'warn_continue' as const,
      evidence_commands: [],
    }];

    return {
      id: `manual-${controlId}`,
      type: 'process',
      priority: 'p2',
      depends_on: [],
      action: {
        engine: 'manual_gate',
        command: `Manual review: ${practiceText}`,
        args: {
          _layer: layer,
          _layer_name: LAYER_NAMES[layer],
          _step_title: `Manual gate: ${practiceText}`,
          _task_type: 'process',
          _directive: 'manual',
          _sub_commands: subCommands,
        }
      },
      inputs: [`Provide manual review for control ${controlId}`],
      outputs: [`${controlId} manual review recorded`],
      controls: [controlId],
      idempotency: 'safe',
      rollback: { strategy: 'manual', notes: 'Manual gate requires human review' },
    };
  }

  /**
   * Build a provisional ExeTask for document-absence, document-prohibition, or non-stack controls.
   * Produces evidence_collection tasks with _directive metadata so Execute
   * can write appropriate evidence without running set commands.
   *
   * document-absence: narrative-only evidence, no automation, SPRS N/A
   * document-prohibition: enforcement query via registry get_command, SPRS MET/NOT MET
   * nonstack: provisional evidence for out-of-band review
   */
  private buildProvisionalTask(
    controlId: string,
    directive: 'document-absence' | 'document-prohibition' | 'document-renderable' | 'nonstack',
    justification: string,
    layer: ExecutionLayer,
    controlMap: Map<string, { control_id: string; practice: string }>,
    registryEntries?: CommandEntry[]
  ): ExeTask {
    const controlRef = controlMap.get(controlId);
    const practiceText = controlRef?.practice || controlId;

    if (directive === 'document-absence') {
      const taskId = `absence-${controlId}`;
      const subCommands: SubCommand[] = [{
        id: `absence-${controlId}`,
        label: `Absence: ${practiceText}`,
        set_command: '',
        get_command: '',
        engine: 'manual_gate' as Engine,
        sequence_hint: 0,
        idempotency: 'safe' as const,
        variables_required: [],
        variables_runtime: [],
        on_failure: 'warn_continue' as const,
        evidence_commands: [],
      }];

      return {
        id: taskId,
        type: 'evidence_collection',
        priority: 'p3',
        depends_on: [],
        action: {
          engine: 'manual_gate',
          command: `Document absence: ${controlId}`,
          args: {
            _layer: layer,
            _layer_name: LAYER_NAMES[layer],
            _step_title: `Documented Absence: ${practiceText}`,
            _task_type: 'evidence_collection',
            _directive: 'document-absence',
            _justification: justification,
            _evidence_type: 'ABSENCE_NARRATIVE',
            _sub_commands: subCommands,
          }
        },
        inputs: [justification],
        outputs: [`${controlId} absence narrative recorded`],
        controls: [controlId],
        idempotency: 'safe',
        rollback: { strategy: 'none' },
      };
    }

    if (directive === 'document-prohibition') {
      const taskId = `prohibition-${controlId}`;
      // Build sub-commands from registry entries for enforcement query
      const subCommands: SubCommand[] = registryEntries && registryEntries.length > 0
        ? registryEntries.map(entry => ({
            id: entry.entry_id,
            label: `Prohibition: ${entry.label}`,
            set_command: '',
            get_command: entry.get_command,
            engine: entry.engine as Engine,
            sequence_hint: entry.sequence_hint,
            idempotency: 'safe' as const,
            variables_required: entry.variables_required,
            variables_runtime: entry.variables_runtime,
            captures: entry.captures,
            on_failure: entry.on_failure,
            evidence_commands: entry.evidence_commands,
            verification: entry.verification,
          }))
        : [{
            id: `prohibition-${controlId}`,
            label: `Prohibition: ${practiceText}`,
            set_command: '',
            get_command: '',
            engine: 'manual_gate' as Engine,
            sequence_hint: 0,
            idempotency: 'safe' as const,
            variables_required: [],
            variables_runtime: [],
            on_failure: 'warn_continue' as const,
            evidence_commands: [],
          }];

      const engine: Engine = registryEntries && registryEntries.length > 0
        ? registryEntries[0].engine as Engine
        : 'manual_gate';

      return {
        id: taskId,
        type: 'evidence_collection',
        priority: 'p3',
        depends_on: [],
        action: {
          engine,
          command: registryEntries && registryEntries.length > 0
            ? registryEntries[0].get_command || `Document prohibition: ${controlId}`
            : `Document prohibition: ${controlId}`,
          args: {
            _layer: layer,
            _layer_name: LAYER_NAMES[layer],
            _step_title: `Documented Prohibition: ${practiceText}`,
            _task_type: 'evidence_collection',
            _directive: 'document-prohibition',
            _justification: justification,
            _evidence_type: 'PROHIBITION_DOCUMENTATION',
            _sub_commands: subCommands,
            ...(registryEntries && registryEntries.length > 0 ? {
              _get_command: registryEntries[0].get_command || undefined,
              _evidence_commands: registryEntries.flatMap(e => e.evidence_commands),
              _variables_required: registryEntries.flatMap(e => e.variables_required),
              _variables_runtime: registryEntries.flatMap(e => e.variables_runtime),
            } : {}),
          }
        },
        inputs: [justification],
        outputs: [`${controlId} prohibition documentation recorded`],
        controls: [controlId],
        idempotency: 'safe',
        rollback: { strategy: 'none' },
      };
    }

    if (directive === 'document-renderable') {
      const taskId = `renderable-${controlId}`;
      const subCommands: SubCommand[] = registryEntries && registryEntries.length > 0
        ? registryEntries.map(entry => ({
            id: entry.entry_id,
            label: `Renderable: ${entry.label}`,
            set_command: '',
            get_command: entry.get_command,
            engine: entry.engine as Engine,
            sequence_hint: entry.sequence_hint,
            idempotency: 'safe' as const,
            variables_required: entry.variables_required,
            variables_runtime: entry.variables_runtime,
            captures: entry.captures,
            on_failure: entry.on_failure,
            evidence_commands: entry.evidence_commands,
            verification: entry.verification,
          }))
        : [{
            id: `renderable-${controlId}`,
            label: `Renderable: ${practiceText}`,
            set_command: '',
            get_command: '',
            engine: 'manual_gate' as Engine,
            sequence_hint: 0,
            idempotency: 'safe' as const,
            variables_required: [],
            variables_runtime: [],
            on_failure: 'warn_continue' as const,
            evidence_commands: [],
          }];

      const engine: Engine = registryEntries && registryEntries.length > 0
        ? registryEntries[0].engine as Engine
        : 'manual_gate';

      return {
        id: taskId,
        type: 'evidence_collection',
        priority: 'p2',
        depends_on: [],
        action: {
          engine,
          command: registryEntries && registryEntries.length > 0
            ? registryEntries[0].get_command || `Document renderable: ${controlId}`
            : `Document renderable: ${controlId}`,
          args: {
            _layer: layer,
            _layer_name: LAYER_NAMES[layer],
            _step_title: `Document Renderable: ${practiceText}`,
            _task_type: 'evidence_collection',
            _directive: 'document-renderable',
            _justification: justification,
            _evidence_type: 'RENDERABLE_SIGNAL_VERIFICATION',
            _sub_commands: subCommands,
          }
        },
        inputs: [justification],
        outputs: [`${controlId} renderable signal verification recorded`],
        controls: [controlId],
        idempotency: 'safe',
        rollback: { strategy: 'none' },
      };
    }

    // nonstack directive (unchanged behavior)
    const taskId = `nonstack-${controlId}`;
    const subCommands: SubCommand[] = [{
      id: `nonstack-${controlId}`,
      label: `Non-Stack: ${practiceText}`,
      set_command: '',
      get_command: '',
      engine: 'manual_gate' as Engine,
      sequence_hint: 0,
      idempotency: 'safe' as const,
      variables_required: [],
      variables_runtime: [],
      on_failure: 'warn_continue' as const,
      evidence_commands: [],
    }];

    return {
      id: taskId,
      type: 'evidence_collection',
      priority: 'p3',
      depends_on: [],
      action: {
        engine: 'manual_gate',
        command: `Non-stack control ${controlId}`,
        args: {
          _layer: layer,
          _layer_name: LAYER_NAMES[layer],
          _step_title: `Non-Stack: ${practiceText}`,
          _task_type: 'evidence_collection',
          _directive: 'nonstack',
          _justification: justification,
          _sub_commands: subCommands,
        }
      },
      inputs: [justification],
      outputs: [`${controlId} provisional evidence recorded`],
      controls: [controlId],
      idempotency: 'safe',
      rollback: { strategy: 'none' },
    };
  }

  /**
   * Build an inherit-fedramp verification task for a control.
   * Produces a task with two sub-commands:
   *   1. Tenant type confirmation (Graph: Get-MgOrganization)
   *   2. No-contradicting-config check (Azure: Get-AzVM, Get-AzWvdHostPool, etc.)
   */
  private buildInheritanceTask(
    controlId: string,
    justification: string,
    layer: ExecutionLayer,
    controlMap: Map<string, { control_id: string; practice: string }>,
    fedrampPackageId?: string,
  ): ExeTask {
    const controlRef = controlMap.get(controlId);
    const practiceText = controlRef?.practice || controlId;

    const taskId = `inherit-${controlId}`;
    const subCommands: SubCommand[] = [
      {
        id: `inherit-${controlId}-tenant-type`,
        label: `Tenant Type: ${controlId}`,
        set_command: '',
        get_command: 'Get-MgOrganization | Select-Object DisplayName, Id, VerifiedDomains, TenantType | ConvertTo-Json -Depth 5',
        engine: 'mgraph' as Engine,
        sequence_hint: 0,
        idempotency: 'evidence-only' as const,
        variables_required: [],
        variables_runtime: [],
        on_failure: 'abort_step' as const,
        evidence_commands: [],
      },
      {
        id: `inherit-${controlId}-contradicting-config`,
        label: `Contradicting Config: ${controlId}`,
        set_command: '',
        get_command: [
          '$vms = @(Get-AzVM -Status 2>$null)',
          '$hostpools = @(Get-AzWvdHostPool 2>$null)',
          '$arcMachines = @(Get-AzConnectedMachine 2>$null)',
          '@{ vm_count = $vms.Count; hostpool_count = $hostpools.Count; arc_count = $arcMachines.Count; vms = ($vms | Select-Object Name, ResourceGroupName, PowerState); hostpools = ($hostpools | Select-Object Name, ResourceGroupName); arc = ($arcMachines | Select-Object Name, ResourceGroupName) } | ConvertTo-Json -Depth 5',
        ].join('; '),
        engine: 'az' as Engine,
        sequence_hint: 1,
        idempotency: 'evidence-only' as const,
        variables_required: [],
        variables_runtime: [],
        on_failure: 'abort_step' as const,
        evidence_commands: [],
      },
    ];

    return {
      id: taskId,
      type: 'evidence_collection',
      priority: 'p1',
      depends_on: [],
      action: {
        engine: 'mgraph',
        command: `Verify FedRAMP inheritance: ${controlId}`,
        args: {
          _layer: layer,
          _layer_name: LAYER_NAMES[layer],
          _step_title: `FedRAMP Inheritance: ${practiceText}`,
          _task_type: 'evidence_collection',
          _directive: 'inherit-fedramp',
          _justification: justification,
          _evidence_type: 'INHERITANCE_VERIFICATION',
          _fedramp_package_id: fedrampPackageId,
          _sub_commands: subCommands,
        }
      },
      inputs: [justification],
      outputs: [`${controlId} FedRAMP inheritance verification recorded`],
      controls: [controlId],
      idempotency: 'safe',
      rollback: { strategy: 'none' },
    };
  }

  private buildEoTooledTask(
    controlId: string,
    justification: string,
    layer: ExecutionLayer,
    controlMap: Map<string, { control_id: string; practice: string }>
  ): ExeTask {
    const practiceText = controlMap.get(controlId)?.practice ?? controlId;
    const subCommands: SubCommand[] = [
      {
        id: `eo-tooled-${controlId}`,
        label: practiceText,
        set_command: '',
        get_command: '',
        engine: 'manual_gate' as Engine,
        sequence_hint: 0,
        idempotency: 'safe' as const,
        variables_required: [],
        variables_runtime: [],
        on_failure: 'warn_continue' as const,
        evidence_commands: [],
      },
    ];

    return {
      id: `eo-tooled-${controlId}`,
      type: 'evidence_collection',
      priority: 'p2',
      depends_on: [],
      action: {
        engine: 'manual_gate',
        command: `EO tooled: ${controlId}`,
        args: {
          _layer: layer,
          _layer_name: LAYER_NAMES[layer],
          _step_title: `EO Tooled: ${practiceText}`,
          _task_type: 'evidence_collection',
          _directive: 'eo-tooled',
          _justification: justification,
          _sub_commands: subCommands,
        }
      },
      inputs: [justification],
      outputs: [`${controlId} EO tooled evidence recorded`],
      controls: [controlId],
      idempotency: 'safe',
      rollback: { strategy: 'none' },
    };
  }

  /**
   * Build a plan-level map of control_id → directive ('automated' | 'document-absence' | 'document-prohibition' | 'inherit-fedramp' | 'nonstack')
   * for all 110 L2 controls. This is the authoritative source for per-control directives.
   *
   * Phase 1: Seed from mpControls (MP is authoritative)
   * Phase 2: Gap-fill from task-level _directive for any L2 control not yet in map
   * Phase 3: Default remaining L2 controls to 'automated'
   */
  private buildControlDirectives(tasks: ExeTask[], controlDirectiveOverrides?: CESControlDirective[]): Record<string, string> {
    const directives: Record<string, string> = {};

    // Build reference set for fast lookup
    const referenceIds = new Set(
      (this.cmmcReferenceCache.controls as Array<{ control_id: string }>).map(c => c.control_id)
    );

    // Phase 1: Seed from mpControls (Set A stamper_action)
    if (this.mpControls) {
      for (const mp of this.mpControls) {
        const cid = mp.requirement_id;
        // Only include controls in the CMMC L2 reference set (includes L1 practices)
        if (!referenceIds.has(cid)) continue;
        directives[cid] = normalizeStamperAction(mp.stamper_action);
      }
    }

    // Phase 1.5: Overlay Set B directives from control_directives[] (authoritative)
    // These are the precise per-control directives from the Planner and override
    // the coarser Set A stamper_action values seeded in Phase 1.
    if (controlDirectiveOverrides) {
      for (const cd of controlDirectiveOverrides) {
        if (referenceIds.has(cd.control_id)) {
          directives[cd.control_id] = cd.directive;
        }
      }
    }

    // Phase 2: Gap-fill from task-level _directive (only reference controls)
    for (const task of tasks) {
      const taskDirective = task.action.args._directive as string | undefined;
      if (!taskDirective) continue;
      for (const cid of (task.controls || [])) {
        if (!(cid in directives) && referenceIds.has(cid)) {
          directives[cid] = taskDirective;
        }
      }
    }

    // Phase 3: Default remaining L2 controls to 'automated'
    for (const refControl of this.cmmcReferenceCache.controls as Array<{ control_id: string }>) {
      if (!(refControl.control_id in directives)) {
        directives[refControl.control_id] = 'automated';
      }
    }

    return directives;
  }

  /**
   * Gap-fill: ensure every L2 control in the MP has a task.
   * Extracted from translate() and translateFromDirectives() to avoid duplication.
   */
  private applyControlGapFill(
    tasks: ExeTask[],
    enrichedScopeExclusions: EnrichedScopeExclusion[],
    layerId: ExecutionLayer,
    layerAssignments?: Map<string, ExecutionLayer>,
    layerTasks?: Map<ExecutionLayer, string[]>
  ): void {
    if (this.mpControls === null) {
      console.warn('PlanTranslator: mpControls not provided to constructor — gap-fill will continue with degraded behavior. Directive precedence (scoped_out, manual_gate) will not be available; all gap-filled controls will default to "nonstack" directive.');
      // Continue execution — gap-fill proceeds but all directives default to 'nonstack'
    }

    const controlMap = new Map<string, { control_id: string; practice: string }>();
    for (const c of this.cmmcReferenceCache.controls) {
      controlMap.set(c.control_id, c);
    }

    const coveredControlIds = new Set(tasks.flatMap(t => t.controls || []));
    for (const ex of enrichedScopeExclusions) {
      coveredControlIds.add(ex.requirement_id);
    }

    // Phase 1: Process mpControls for directive precedence (if available)
    if (this.mpControls) {
      for (const mp of this.mpControls) {
        // Skip MP controls whose requirement_id isn't in the 110-control reference
        if (!controlMap.has(mp.requirement_id)) {
          console.log(`Gap-fill: skipping MP control ${mp.requirement_id} — not in CMMC L2 reference`);
          continue;
        }

        // Skip controls already covered by earlier translation (e.g., manualDirectives)
        if (coveredControlIds.has(mp.requirement_id)) continue;

        if (mp.scope_status === 'scoped_out' || normalizeStamperAction(mp.stamper_action) === 'document-absence') {
          const se = enrichedScopeExclusions.find(e => e.requirement_id === mp.requirement_id);
          const justification = se?.justification || mp.scope_justification || 'Capability absent from CUI boundary per Strategic Intent baseline';
          const task = this.buildProvisionalTask(mp.requirement_id, 'document-absence', justification, layerId, controlMap);
          tasks.push(task);
          if (layerAssignments) layerAssignments.set(task.id, layerId);
          if (layerTasks) {
            if (!layerTasks.has(layerId)) layerTasks.set(layerId, []);
            layerTasks.get(layerId)!.push(task.id);
          }
          coveredControlIds.add(mp.requirement_id);
        } else if (normalizeStamperAction(mp.stamper_action) === 'nonstack') {
          const practice = controlMap.get(mp.requirement_id)?.practice || mp.requirement_id;
          const task = this.buildProvisionalTask(mp.requirement_id, 'nonstack', `Non-stack: ${practice} — requires out-of-band evidence`, layerId, controlMap);
          tasks.push(task);
          if (layerAssignments) layerAssignments.set(task.id, layerId);
          if (layerTasks) {
            if (!layerTasks.has(layerId)) layerTasks.set(layerId, []);
            layerTasks.get(layerId)!.push(task.id);
          }
          coveredControlIds.add(mp.requirement_id);
        } else if (normalizeStamperAction(mp.stamper_action) === 'document-prohibition') {
          const practice = controlMap.get(mp.requirement_id)?.practice || mp.requirement_id;
          const task = this.buildProvisionalTask(mp.requirement_id, 'document-prohibition', `Prohibition enforcement: ${practice}`, layerId, controlMap);
          tasks.push(task);
          if (layerAssignments) layerAssignments.set(task.id, layerId);
          if (layerTasks) {
            if (!layerTasks.has(layerId)) layerTasks.set(layerId, []);
            layerTasks.get(layerId)!.push(task.id);
          }
          coveredControlIds.add(mp.requirement_id);
        } else if (normalizeStamperAction(mp.stamper_action) === 'inherit-fedramp') {
          const task = this.buildInheritanceTask(mp.requirement_id, mp.scope_justification || 'FedRAMP High inheritance from CSP', 0 as ExecutionLayer, controlMap, mp.fedramp_package_id);
          tasks.push(task);
          if (layerAssignments) layerAssignments.set(task.id, 0 as ExecutionLayer);
          if (layerTasks) {
            if (!layerTasks.has(0 as ExecutionLayer)) layerTasks.set(0 as ExecutionLayer, []);
            layerTasks.get(0 as ExecutionLayer)!.push(task.id);
          }
          coveredControlIds.add(mp.requirement_id);
        }
        // Automated controls are NOT gap-filled here — they are handled by
        // implement/validate directives in translateFromDirectives(). Phase 2
        // below catches any truly missing controls by defaulting to nonstack.
      }
    }

    // Phase 2: Iterate through all 110 L2 controls and gap-fill missing ones
    this.cmmcReferenceCache.controls.forEach((refControl: { control_id: string; practice: string }) => {
      if (!coveredControlIds.has(refControl.control_id)) {
        let directive: 'document-absence' | 'document-prohibition' | 'nonstack' = 'nonstack';
        let justification = 'No registry entry found for this control';
        let useInheritance = false;
        let inheritPkgId: string | undefined;

        if (this.mpControls) {
          const mpCtrl = this.mpControls.find(mc => mc.requirement_id === refControl.control_id);
          if (mpCtrl?.scope_status === 'scoped_out' || (mpCtrl?.stamper_action && normalizeStamperAction(mpCtrl.stamper_action) === 'document-absence')) {
            directive = 'document-absence';
            justification = mpCtrl?.scope_justification || 'Capability absent from CUI boundary per Mission Plan';
          } else if (mpCtrl?.stamper_action && normalizeStamperAction(mpCtrl.stamper_action) === 'document-prohibition') {
            directive = 'document-prohibition';
            justification = `Prohibition enforcement: ${refControl.practice}`;
          } else if (mpCtrl?.stamper_action && normalizeStamperAction(mpCtrl.stamper_action) === 'inherit-fedramp') {
            useInheritance = true;
            justification = mpCtrl.scope_justification || 'FedRAMP High inheritance from CSP';
            inheritPkgId = mpCtrl.fedramp_package_id;
          } else if (mpCtrl?.stamper_action && normalizeStamperAction(mpCtrl.stamper_action) === 'nonstack') {
            directive = 'nonstack';
            justification = 'Non-stack manual review required per Mission Plan';
          }
        }

        let task: ExeTask;
        if (useInheritance) {
          task = this.buildInheritanceTask(refControl.control_id, justification, 0 as ExecutionLayer, controlMap, inheritPkgId);
          if (layerAssignments) layerAssignments.set(task.id, 0 as ExecutionLayer);
          if (layerTasks) {
            if (!layerTasks.has(0 as ExecutionLayer)) layerTasks.set(0 as ExecutionLayer, []);
            layerTasks.get(0 as ExecutionLayer)!.push(task.id);
          }
        } else {
          task = this.buildProvisionalTask(refControl.control_id, directive, justification, layerId, controlMap);
          if (layerAssignments) layerAssignments.set(task.id, layerId);
          if (layerTasks) {
            if (!layerTasks.has(layerId)) layerTasks.set(layerId, []);
            layerTasks.get(layerId)!.push(task.id);
          }
        }

        tasks.push(task);
        coveredControlIds.add(refControl.control_id);
      }
    });
  }

  // Phase 9.1 step 4: Derive a GET command counterpart from query_method.
  private deriveGetCommand(command: string, _queryMethod: string): string {
    // If the command already starts with Get-, use it directly
    const getMatch = command.match(/^Get-\w+/);
    if (getMatch) {
      return getMatch[0];
    }
    // Extract verb+noun from Set-/New-/etc. to derive the Get- counterpart
    const verbNounMatch = command.match(/(?:New|Set|Update|Enable|Disable)-(\w+)/);
    if (verbNounMatch) {
      return `Get-${verbNounMatch[1]}`;
    }
    // Take the first command in a semicolon-joined list
    const firstCmd = command.split(';')[0].trim().split(' ')[0];
    return firstCmd.startsWith('Get-') ? firstCmd : `Get-${firstCmd}`;
  }

  // Phase 9.1 step 5: Map service to idempotency pattern.
  private deriveIdempotencyPattern(
    step: CESManualStep
  ): 'get-then-patch' | 'deterministic-guid-put' | 'safe-ps' {
    const service = this.getServiceName(step);
    if (/conditional.?access|intune/i.test(service)) {
      return 'get-then-patch';
    }
    if (/sentinel/i.test(service)) {
      return 'deterministic-guid-put';
    }
    return 'safe-ps';
  }

  private getServiceName(step: CESManualStep): string {
    if (step.actions) {
      for (const action of step.actions) {
        if (action.vendor?.m365_service) {
          return action.vendor.m365_service;
        }
      }
    }
    return '';
  }

  private determineEngine(step: CESManualStep): Engine {
    // CES-FE v2: auto_generate gap classification → powershell
    if (step.gap_classifications?.includes('auto_generate')) {
      return 'powershell';
    }

    // Check if any action has PowerShell commands
    if (step.actions) {
      for (const action of step.actions) {
        if (action.vendor?.powershell && action.vendor.powershell.length > 0) {
          return 'powershell';
        }
      }
    }

    // Check what_to_do for PowerShell/CLI patterns
    const allText = step.what_to_do.join(' ');
    if (/\b(?:Get-Mg|Set-Mg|New-Mg|Connect-Mg|Get-Az|Set-Az|New-Az)\b/.test(allText)) {
      return 'powershell';
    }
    if (/\baz\s+\w+/.test(allText)) {
      return 'cli';
    }
    if (/graph\.microsoft\.com|\/v1\.0\/|\/beta\//.test(allText)) {
      return 'api';
    }

    // Map by task type
    switch (step.task_type) {
      case 'configuration': return 'powershell';
      case 'monitoring': return 'powershell';
      case 'policy': return 'manual_gate';
      case 'process': return 'manual_gate';
      case 'training': return 'manual_gate';
      case 'assessment': return 'manual_gate';
      case 'evidence_collection': return 'powershell';
      default: return 'manual_gate';
    }
  }

  private buildCommand(step: CESManualStep): string {
    // Try to extract PowerShell command from vendor block
    if (step.actions) {
      const psCommands: string[] = [];
      for (const action of step.actions) {
        if (action.vendor?.powershell) {
          psCommands.push(...action.vendor.powershell);
        }
      }
      if (psCommands.length > 0) {
        return psCommands.join('; ');
      }
    }

    // Fall back to what_to_do description
    return step.what_to_do.join(' | ');
  }

  private buildDependencies(
    step: CESManualStep,
    layer: ExecutionLayer,
    _layerAssignments: Map<string, ExecutionLayer>,
    layerTasks: Map<ExecutionLayer, string[]>,
    humanPlan: CESHumanPlan
  ): string[] {
    const deps = new Set<string>();

    // Explicit dependencies from the mission plan
    if (step.dependencies) {
      for (const dep of step.dependencies) {
        // Find step by ID match
        const depStep = (humanPlan.steps ?? []).find(s => s.id === dep);
        if (depStep) {
          deps.add(dep);
        }
      }
    }

    // Layer-based dependencies: depend on the LAST task in each prerequisite layer.
    // This creates a "barrier" between layers without making every task depend on every other.
    const prereqLayers = this.classifier.getLayerDependencies(layer);
    for (const prereqLayer of prereqLayers) {
      const prereqTaskIds = layerTasks.get(prereqLayer);
      if (prereqTaskIds && prereqTaskIds.length > 0) {
        // Depend on the last task in the prerequisite layer
        deps.add(prereqTaskIds[prereqTaskIds.length - 1]);
      }
    }

    return Array.from(deps);
  }

  private mapTaskType(cesType: string): TaskType {
    const mapping: Record<string, TaskType> = {
      'policy': 'policy',
      'configuration': 'configuration',
      'process': 'process',
      'monitoring': 'monitoring',
      'training': 'training',
      'assessment': 'assessment',
      'evidence_collection': 'evidence_collection',
    };
    return mapping[cesType] ?? 'configuration';
  }

  private determineIdempotency(step: CESManualStep): Idempotency {
    switch (step.task_type) {
      case 'configuration': return 'safe';
      case 'monitoring': return 'safe';
      case 'policy': return 'safe';
      case 'evidence_collection': return 'safe';
      case 'process': return 'best_effort';
      case 'training': return 'best_effort';
      case 'assessment': return 'best_effort';
      default: return 'best_effort';
    }
  }

  private determineRollback(step: CESManualStep): { strategy: 'none' | 'reverse_task' | 'restore_snapshot' | 'manual'; notes?: string } {
    switch (step.task_type) {
      case 'configuration':
        return { strategy: 'reverse_task', notes: `Revert configuration for: ${step.title}` };
      case 'monitoring':
        return { strategy: 'reverse_task', notes: 'Disable monitoring rule' };
      case 'policy':
        return { strategy: 'manual', notes: 'Policy documents require manual rollback review' };
      default:
        return { strategy: 'none' };
    }
  }

  private buildEvidenceArtifacts(step: CESManualStep): EvidenceArtifact[] {
    return step.expected_artifacts.map(ea => ({
      artifact_id: ea.artifact_id,
      artifact_type: ea.artifact_type,
      description: ea.description,
      collector: ea.collector,
      retention_days: ea.retention_days,
      storage_location_ref: ea.storage_location_ref
    }));
  }

  private defaultPrechecks(): Check[] {
    return [
      {
        id: 'pre-connectivity',
        description: 'Verify Microsoft Graph API connectivity',
        method: 'api_query',
        target: '/v1.0/organization',
        expected: 'connected',
        on_fail: 'Cannot connect to Microsoft Graph — check credentials and network'
      },
      {
        id: 'pre-permissions',
        description: 'Verify required Graph API permissions',
        method: 'api_query',
        target: '/v1.0/organization',
        expected: 'sufficient_permissions',
        on_fail: 'Insufficient permissions — run stamper bootstrap to configure app registration'
      }
    ];
  }
}

// Phase 10.1: Severity rank helper for postcheck sorting.
// Higher rank = higher priority = sorted to front.
function severityRank(check: Check): number {
  const desc = (check.description + check.on_fail).toLowerCase();
  if (/critical|p0/.test(desc)) return 4;
  if (/high|p1/.test(desc)) return 3;
  if (/medium|p2/.test(desc)) return 2;
  if (/low|p3/.test(desc)) return 1;
  return 0;
}
