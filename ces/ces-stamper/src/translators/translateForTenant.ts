// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W8-STX: the one translate path. `stamper translate` (mode `cli`) and POST /api/translate
 * (mode `gui`) both call translateForTenant(); the CLI is the reference (PLAN AD-5), so the
 * inputs are built the CLI's way in both modes: the bundled file registry, no tenant
 * variables.json, the Infra Manifest named or found beside the Tenant Manifest, `strictScope`
 * passed through. The mode changes only the error surface: in `gui` mode an unreadable or
 * invalid Infra Manifest is an InvalidInfraManifestError (the route answers 400) and a
 * missing tenant record is skipped; in `cli` mode both behave as the command always did.
 *
 * DEPTH-2 (closes FQ-10): one merged registry for both modes. Unless a registry file is named, the
 * bundled M365 registry is merged with the infra registry when the infrastructure model (Infra
 * Manifest, else the tenant record) is m365_sentinel or m365_azure; PlanTranslator's filterByEnclave
 * then keeps only the tiers that model allows. For m365_only, or no known model, the infra registry is
 * not loaded (V95: an m365_only plan gains no AZ-* entry). Before translation, the merged registry
 * drops retired infra entries and any entry the cost gate would keep whose cost_gate.requires_entries
 * names an entry that is not planned (its creator is gated off, retired or outside the enclave).
 * Recurring entries without a DP-1 stay in, so PlanTranslator still records them as cost_gated_off.
 * An infra entry whose manifest variable has no value (an UNRESOLVED_VARIABLE warning) is left out too,
 * and the plan translated once more without it, so no planned AZ-* command is blocked at run time.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PlanTranslator, UNRESOLVED_VARIABLE_PREFIX } from './PlanTranslator.js';
import { CESInfrastructureManifestSchema } from '../types/ces-artifacts.types.js';
import type { MPControl } from '../types/ces-artifacts.types.js';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath, type ClientConfig } from '../config/ClientConfig.js';
import { readCostAcks, applyCostGate, loadCostGateReference, type CostAck, type CostGateReference } from '../core/CostGate.js';
import { CommandRegistry } from '../registry/CommandRegistry.js';
import type { CommandEntry } from '../registry/command-registry.types.js';
import { tenantBaseDir } from '../core/EvidenceReadinessAnalyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type TranslateMode = 'cli' | 'gui';

export type TranslateForTenantResult = ReturnType<PlanTranslator['translateFile']>;

export interface TranslateForTenantInput {
  mode: TranslateMode;
  missionPlanPath: string;
  manifestPath: string;
  outputPath: string;
  /** Tenant slug whose record supplies the ClientConfig (none = no ClientConfig). */
  tenant?: string;
  /** Infra Manifest path; when absent or empty, the one beside the Tenant Manifest (if any). */
  infraManifestPath?: string;
  /** Command registry JSON. Named: exactly that file (no merge). Default: the merged registry (DEPTH-2). */
  registryPath?: string;
  strictScope?: boolean;
}

export interface TranslateForTenantOutput {
  result: TranslateForTenantResult;
  clientConfig?: ClientConfig;
  /** The Infra Manifest used (absolute), if one was found. */
  infraManifestPath?: string;
  /** The registry loaded (absolute), if one was found: the main (or named) file. */
  registryPath?: string;
  /** DEPTH-2: the infra registry merged in (absolute), when the model allowed it. */
  infraRegistryPath?: string;
  /** DEPTH-2: entries the merged registry left out before translation, with the reason. */
  excludedEntries?: ExcludedRegistryEntry[];
}

export type InfrastructureModel = 'm365_only' | 'm365_sentinel' | 'm365_azure';

/** DEPTH-2: the warning prefix for an infra entry the merged registry left out (requires or variable). */
export const ENTRY_NOT_PLANNED_PREFIX = 'ENTRY_NOT_PLANNED:';

export interface ExcludedRegistryEntry {
  entry_id: string;
  reason: 'retired' | 'requires_not_planned' | 'unresolved_variable';
  /** requires_not_planned: the required entries that are not planned; unresolved_variable: the variables. */
  missing?: string[];
}

/** `gui` mode: the Infra Manifest is unreadable or fails the shared schema. */
export class InvalidInfraManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInfraManifestError';
  }
}

/** The Infra Manifest beside a Tenant Manifest: `infrastructure-manifest` or `infra-manifest` in its name. */
export function findSiblingInfraManifest(manifestPath: string): string | undefined {
  const candidates = [
    manifestPath.replace(/tenant-manifest/i, 'infrastructure-manifest'),
    manifestPath.replace(/tenant-manifest/i, 'infra-manifest'),
  ].filter(p => p !== manifestPath);
  return candidates.find(p => fs.existsSync(path.resolve(p)));
}

/** The bundled M365 registry: the source copy first, then the built copy. */
export function defaultRegistryPath(): string | undefined {
  const registryPath = path.resolve(__dirname, '..', '..', 'src', 'registry', 'cmmc-l2-commands.registry.json');
  const distRegistryPath = path.resolve(__dirname, '..', 'registry', 'cmmc-l2-commands.registry.json');
  if (fs.existsSync(registryPath)) return registryPath;
  if (fs.existsSync(distRegistryPath)) return distRegistryPath;
  return undefined;
}

/** The bundled infra registry: the source copy first, then the built copy. */
export function defaultInfraRegistryPath(): string | undefined {
  const src = path.resolve(__dirname, '..', '..', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json');
  const dist = path.resolve(__dirname, '..', 'registry', 'infra-cmmc-l2-commands.registry.json');
  if (fs.existsSync(src)) return src;
  if (fs.existsSync(dist)) return dist;
  return undefined;
}

/**
 * The infra entries a translation left with a manifest variable that has no value, from its
 * UNRESOLVED_VARIABLE warnings ("UNRESOLVED_VARIABLE: <var> (required by <entry>, task <step>)").
 */
export function unresolvedInfraEntries(warnings: string[], infraIds: ReadonlySet<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const w of warnings) {
    if (!w.startsWith(UNRESOLVED_VARIABLE_PREFIX)) continue;
    const m = /^\S+\s+(\S+)\s+\(required by ([^,]+),/.exec(w);
    if (!m || !infraIds.has(m[2])) continue;
    const vars = out.get(m[2]) ?? [];
    if (!vars.includes(m[1])) vars.push(m[1]);
    out.set(m[2], vars);
  }
  return out;
}

/** Whether the infra registry is merged for this model (V95: never for m365_only or an unknown model). */
export function mergesInfra(model: InfrastructureModel | undefined): boolean {
  return model === 'm365_sentinel' || model === 'm365_azure';
}

function requiresOf(e: CommandEntry): string[] {
  const r = (e.cost_gate as { requires_entries?: unknown } | undefined)?.requires_entries;
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * DEPTH-2: the registry a translation draws on. Retired entries go; an entry the cost gate would keep
 * (free, or recurring with a current DP-1) stays only while every entry in its requires_entries is
 * itself planned: present, inside the enclave, kept by the cost gate, and not dropped by this rule
 * (repeated to a fixed point, so chains and pairs such as the firewall and its IP resolve together).
 * Recurring entries without a DP-1 are kept, so the translator reports them as cost_gated_off.
 */
export function planRegistry(
  registries: CommandRegistry[],
  model: InfrastructureModel | undefined,
  acks: CostAck[],
  ref: CostGateReference = loadCostGateReference(),
  unresolved: ReadonlyMap<string, string[]> = new Map(),
): { registry: CommandRegistry; excluded: ExcludedRegistryEntry[] } {
  const merged = registries.length === 1 ? registries[0] : CommandRegistry.merge(...registries);
  const excluded: ExcludedRegistryEntry[] = [];
  const live = merged.allEntries.filter(e => {
    if (e.retired) { excluded.push({ entry_id: e.entry_id, reason: 'retired' }); return false; }
    return true;
  });
  const liveRegistry = CommandRegistry.fromData({ version: merged.version, generated_on: '', description: '', entries: live });
  const inEnclave = new Set((model ? liveRegistry.filterByEnclave(model) : live).map(e => e.entry_id));
  const planned = new Set(applyCostGate(live.filter(e => inEnclave.has(e.entry_id)), acks, ref).kept.map(e => e.entry_id));
  const dropped = new Map<string, string[]>();
  const unresolvedDropped = new Map<string, string[]>();
  for (const [id, vars] of unresolved) {
    if (planned.delete(id)) unresolvedDropped.set(id, vars);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const e of live) {
      if (!planned.has(e.entry_id)) continue;
      const missing = requiresOf(e).filter(r => !planned.has(r));
      if (missing.length > 0) { planned.delete(e.entry_id); dropped.set(e.entry_id, missing); changed = true; }
    }
  }
  for (const [entry_id, missing] of unresolvedDropped) excluded.push({ entry_id, reason: 'unresolved_variable', missing });
  for (const [entry_id, missing] of dropped) excluded.push({ entry_id, reason: 'requires_not_planned', missing });
  if (excluded.length === 0) return { registry: merged, excluded };
  const keep = live.filter(e => !dropped.has(e.entry_id) && !unresolvedDropped.has(e.entry_id));
  return {
    registry: CommandRegistry.fromData({ version: merged.version, generated_on: new Date().toISOString().slice(0, 10), description: 'Merged registry, planned subset (DEPTH-2)', entries: keep }),
    excluded,
  };
}

export async function translateForTenant(input: TranslateForTenantInput): Promise<TranslateForTenantOutput> {
  let clientConfig: ClientConfig | undefined;
  if (input.tenant) {
    const tenantJsonPath = await resolveTenantJsonPath(input.tenant);
    if (input.mode === 'cli' || fs.existsSync(tenantJsonPath)) {
      clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);
    }
  }

  const resolvedPlanPath = path.resolve(input.missionPlanPath);
  const resolvedManifestPath = path.resolve(input.manifestPath);
  const resolvedOutputPath = path.resolve(input.outputPath);

  // Load mpControls from MP for gap-fill directive precedence
  let mpControls: MPControl[] | undefined;
  try {
    const mpJson = JSON.parse(fs.readFileSync(resolvedPlanPath, 'utf-8'));
    const controls = mpJson?.outputs?.human_readable_mission_plan?.controls;
    if (Array.isArray(controls) && controls.length > 0) {
      mpControls = controls;
    }
  } catch { /* MP load failure handled downstream */ }

  // Infra Manifest: the one named (when it exists), else the one beside the Tenant Manifest.
  const named = input.infraManifestPath && input.infraManifestPath.trim() ? input.infraManifestPath : undefined;
  const infraManifestPath = named
    ? (fs.existsSync(path.resolve(named)) ? named : undefined)
    : findSiblingInfraManifest(input.manifestPath);
  let infraModelValue: 'm365_only' | 'm365_sentinel' | 'm365_azure' | undefined;
  let infraData: unknown;
  if (infraManifestPath) {
    try {
      infraData = JSON.parse(fs.readFileSync(path.resolve(infraManifestPath), 'utf-8'));
    } catch (err) {
      if (input.mode === 'gui') {
        throw new InvalidInfraManifestError(`Invalid infrastructure manifest: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (infraData !== undefined) {
      const infraParse = CESInfrastructureManifestSchema.safeParse(infraData);
      if (infraParse.success) {
        infraModelValue = infraParse.data.infrastructure.infrastructure_model;
      } else if (input.mode === 'gui') {
        const errors = infraParse.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new InvalidInfraManifestError(`Invalid infrastructure manifest: ${errors}`);
      }
    }
  }

  // DEPTH-2: one merged registry for the CLI and the GUI (closes FQ-10). A named registry file is used as
  // it is; otherwise the bundled M365 registry, merged with the infra registry when the model allows it.
  const costAcks = input.tenant ? readCostAcks(tenantBaseDir(input.tenant)) : [];
  const model: InfrastructureModel | undefined = infraModelValue ?? clientConfig?.infrastructure_model;
  const registryPath = input.registryPath ? path.resolve(input.registryPath) : defaultRegistryPath();
  const infraRegistryPath = registryPath && !input.registryPath && mergesInfra(model) ? defaultInfraRegistryPath() : undefined;
  let registry: CommandRegistry | undefined;
  let excludedEntries: ExcludedRegistryEntry[] = [];
  let mainRegistry: CommandRegistry | undefined;
  let infraRegistry: CommandRegistry | undefined;
  if (registryPath) {
    registry = mainRegistry = CommandRegistry.load(registryPath);
    if (infraRegistryPath) {
      infraRegistry = CommandRegistry.load(infraRegistryPath);
      const planned = planRegistry([mainRegistry, infraRegistry], model, costAcks);
      registry = planned.registry;
      excludedEntries = planned.excluded;
    }
  }

  // W4-ST2: the Infra Manifest's stamper_variable_map is merged by the translator.
  const translate = (reg: CommandRegistry | undefined) =>
    new PlanTranslator(reg, clientConfig, mpControls, infraModelValue).translateFile(resolvedPlanPath, resolvedManifestPath, resolvedOutputPath, undefined, {
      strictScope: input.strictScope,
      // Cost gate: the tenant's DP-1 records, one file for the CLI and the GUI (V72).
      costAcks,
      ...(infraData !== undefined ? { infraManifest: infraData, infraManifestSource: path.resolve(infraManifestPath!) } : {}),
    });
  let result = translate(registry);

  // DEPTH-2: an infra entry with a manifest variable that has no value is not planned (it would be
  // blocked at run time); translate once more without it. Main-registry entries are unchanged.
  if (mainRegistry && infraRegistry) {
    const unresolved = unresolvedInfraEntries(result.warnings, new Set(infraRegistry.allEntries.map(e => e.entry_id)));
    if (unresolved.size > 0) {
      const planned = planRegistry([mainRegistry, infraRegistry], model, costAcks, undefined, unresolved);
      excludedEntries = planned.excluded;
      result = translate(planned.registry);
    }
    // One line per entry left out for a reason the operator can act on, printed beside COST_GATED_OFF.
    for (const e of excludedEntries) {
      if (e.reason === 'requires_not_planned') result.warnings.push(`${ENTRY_NOT_PLANNED_PREFIX} ${e.entry_id} requires ${(e.missing ?? []).join(', ')} (not planned)`);
      else if (e.reason === 'unresolved_variable') result.warnings.push(`${ENTRY_NOT_PLANNED_PREFIX} ${e.entry_id} has no value for ${(e.missing ?? []).join(', ')}`);
    }
  }

  return {
    result,
    ...(clientConfig ? { clientConfig } : {}),
    ...(infraManifestPath ? { infraManifestPath: path.resolve(infraManifestPath) } : {}),
    ...(registryPath ? { registryPath } : {}),
    ...(infraRegistryPath ? { infraRegistryPath, excludedEntries } : {}),
  };
}

export interface ProjectedSubCommand {
  id: string;
  set_command: string | null;
  get_command: string | null;
  evidence_commands: string[];
  org_values: unknown;
  lookup: unknown;
  verification: unknown;
}

export interface ProjectedTask {
  id: string;
  engine: string | null;
  directive: string | null;
  controls: string[];
  sub_commands: ProjectedSubCommand[];
}

export interface ExecutablePlanProjection {
  tasks: ProjectedTask[];
  variables: Record<string, unknown>;
}

/** Variables that carry a timestamp, left out of the projection. */
const PROJECTION_OMITTED_VARIABLES: ReadonlySet<string> = new Set(['_translated_at']);

/**
 * W8-STX (5) / V72: the comparable content of an executable plan: per task its id, engine,
 * directive, controls and sub-commands (id, set/get/evidence commands, org_values, lookup,
 * verification), and the plan variables. Left out: plan_id, timestamps, `_source_paths`,
 * `_pre_accomplished` and every other field.
 */
export function projectExecutablePlan(plan: unknown): ExecutablePlanProjection {
  const p = (plan ?? {}) as { execution_graph?: unknown; variables?: unknown };
  const graph = Array.isArray(p.execution_graph) ? (p.execution_graph as any[]) : [];
  const vars = p.variables && typeof p.variables === 'object' ? (p.variables as Record<string, unknown>) : {};
  const variables: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (!PROJECTION_OMITTED_VARIABLES.has(key)) variables[key] = value;
  }
  return {
    tasks: graph.map((task) => {
      const subs = task?.action?.args?._sub_commands;
      return {
        id: task?.id,
        engine: task?.action?.engine ?? null,
        directive: task?.action?.args?._directive ?? null,
        controls: Array.isArray(task?.controls) ? [...task.controls] : [],
        sub_commands: (Array.isArray(subs) ? subs : []).map((sub: any) => ({
          id: sub?.id,
          set_command: sub?.set_command ?? null,
          get_command: sub?.get_command ?? null,
          evidence_commands: Array.isArray(sub?.evidence_commands) ? [...sub.evidence_commands] : [],
          org_values: sub?.org_values ?? null,
          lookup: sub?.lookup ?? null,
          verification: sub?.verification ?? null,
        })),
      };
    }),
    variables,
  };
}
