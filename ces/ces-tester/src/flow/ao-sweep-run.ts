// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure AO-4a / finishing plan FIN-29: harness step E7S, the AdminOps sweep (V77). Every command of AO's registry
 * goes through AO's governed CLI (`exec <op> --json`) on the run's simulated tenant: one dry run each, then an apply
 * wherever the sweep scenario (`scenarios/ao/ao-sweep.json`) and the cost gate allow it. A recurring-cost op stays a dry
 * run (V113 owns its DP-1/DP-2 traversal). Tier-3 ops follow AO's two-person mode: OFF (the default, founder ruling
 * 2026-10-31) runs the Tier-2 sequence; ON (CES_TWO_PERSON_APPROVAL=1) adds the request, a second-person approval
 * (principal token of `resources.approver_upn`, child env only) and the gated apply.
 *
 * Tenant-sourced parameter values (the registry `source` fields) are discovered from the simulator by the scenario's
 * declarative reads into a PRIVATE copy of the tenant record (`out/ao-sweep/tenants/sim/<slug>.json`): the run's record,
 * which E7A and every check read, is never changed. Nothing is typed in place of a value the simulator does not hold:
 * a command whose value is missing is recorded "not run" with the key, and V77 names it.
 *
 * Placement: after E8F and E7C (and after every other FIN-29 step that uses the sim), so no assessment and no later
 * step reads its writes. S1 only (`applies_to`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolve as simResolve } from '../stacksim-client/http.js';
import type { ResolveRequestBody } from '../stacksim-client/types.js';
import {
  AO_SECRET_ENV,
  AO_TOKEN_ENV,
  DISCOVERERS,
  TWO_PERSON_APPROVAL_ENV,
  makeSimPfx,
  mintPrincipalToken,
  parseAoJson,
  recordValue,
  rowsOf,
  summarizeExec,
  twoPersonApprovalOn,
  type AoCallRecord,
  type AoCliRunner,
  type AoParamRecord,
} from './ao-step.js';
import { FIN29_FILES, FIN29_SCHEMAS, type Fin29StepCtx, type Fin29StepDef } from './fin29-common.js';

// ---------- the sweep scenario ----------

export const AO_SWEEP_SCENARIO_SCHEMA = 'ces-tester/ao-sweep-scenario@1';
/** scenarios/ao/ao-sweep.json, relative to the ces-tester root. */
export const AO_SWEEP_SCENARIO_REL = path.join('scenarios', 'ao', 'ao-sweep.json');

/** A value for a request input: a literal (`{domain}` is the tenant's domain) or a resource key of the private record. */
export type SweepValueSpec = string | { resource: string; else?: string };

export type SweepResourceSpec =
  | { read: ResolveRequestBody; match?: Record<string, string>; pick: string[]; describe: string }
  | { discoverer: string }
  | { literal: string; describe: string }
  | { stacksim_fixture: string; describe: string };

export interface AoSweepScenario {
  schema: typeof AO_SWEEP_SCENARIO_SCHEMA;
  scenario_id: string;
  applies_to: string[];
  expected_commands: number;
  apply_floor: number;
  resources: Record<string, SweepResourceSpec>;
  inputs: { by_name: Record<string, SweepValueSpec>; by_command: Record<string, Record<string, SweepValueSpec>> };
  /** op -> reason it is never applied (beyond the cost gate's own rule). */
  no_apply: Record<string, string>;
  /**
   * PH-5 (R-F2 V77 red): op -> why it has no target on this scenario's tenant. An op listed here is recorded "not
   * applicable" (no dry run, no apply) ONLY when this run's discovery proved one of its inputs absent ("no simulator
   * object: ..."); otherwise it runs as usual, so a real binding error still fails.
   */
  not_applicable?: Record<string, string>;
}

export function loadAoSweepScenario(file: string): AoSweepScenario {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as AoSweepScenario;
  const problems: string[] = [];
  if (raw.schema !== AO_SWEEP_SCENARIO_SCHEMA) problems.push(`schema ${String(raw.schema)}`);
  if (!Array.isArray(raw.applies_to) || raw.applies_to.length === 0) problems.push('applies_to empty');
  if (!Number.isInteger(raw.expected_commands) || raw.expected_commands <= 0) problems.push('expected_commands');
  if (!Number.isInteger(raw.apply_floor) || raw.apply_floor < 0) problems.push('apply_floor');
  if (!raw.resources || typeof raw.resources !== 'object') problems.push('resources');
  for (const [k, s] of Object.entries(raw.resources ?? {})) {
    const ok = ('read' in s && Array.isArray(s.pick) && s.pick.length > 0) || ('discoverer' in s && !!DISCOVERERS[s.discoverer]) || ('literal' in s && typeof s.literal === 'string') || ('stacksim_fixture' in s && typeof s.stacksim_fixture === 'string');
    if (!ok) problems.push(`resources.${k}: needs read+pick, a known discoverer, a literal or a stacksim_fixture`);
  }
  if (!raw.inputs?.by_name || !raw.inputs?.by_command) problems.push('inputs.by_name / inputs.by_command');
  if (!raw.no_apply || typeof raw.no_apply !== 'object') problems.push('no_apply');
  if (raw.not_applicable !== undefined && (typeof raw.not_applicable !== 'object' || Object.values(raw.not_applicable).some((v) => typeof v !== 'string' || !v))) problems.push('not_applicable: op -> reason');
  if (problems.length) throw new Error(`ao-sweep scenario ${file}: ${problems.join('; ')}`);
  return raw;
}

// ---------- AO's registry (the fields the sweep reads) ----------

export interface SweepCommand {
  id: string;
  sodTier: string;
  idempotencyClass?: string;
  parameters: Array<{ name: string; source?: string; required?: boolean; type?: string }>;
  cost_gate?: { recurring?: boolean; recurring_when?: { param: string; gt: number } | null } | null;
}

export function loadAoRegistry(aoRoot: string): SweepCommand[] {
  return JSON.parse(fs.readFileSync(path.join(aoRoot, 'src', 'registry', 'ao-commands.registry.json'), 'utf8').replace(/^﻿/, '')) as SweepCommand[];
}

// ---------- discovery into the private record ----------

/** Rows of a /resolve answer: an array, a Graph `{ value: [] }` page, or one object. */
export function rowsOfAny(data: unknown): Array<Record<string, unknown>> {
  const rows = rowsOf(data);
  if (rows.length) return rows;
  return data && typeof data === 'object' && !Array.isArray(data) && !('value' in (data as object)) ? [data as Record<string, unknown>] : [];
}

/** A match value is an exact (case-insensitive) string, or `/re/flags`. */
export function matchesRow(row: Record<string, unknown>, match: Record<string, string> | undefined): boolean {
  for (const [field, want] of Object.entries(match ?? {})) {
    const got = row[field];
    if (typeof got !== 'string') return false;
    const re = /^\/(.*)\/([a-z]*)$/.exec(want);
    if (re ? !new RegExp(re[1], re[2]).test(got) : got.toLowerCase() !== want.toLowerCase()) return false;
  }
  return true;
}

export function pickFrom(rows: Array<Record<string, unknown>>, match: Record<string, string> | undefined, pick: string[]): string | undefined {
  for (const r of rows.filter((x) => matchesRow(x, match))) {
    for (const f of pick) {
      const v = r[f];
      if (typeof v === 'string' && v !== '') return v;
      if (typeof v === 'number') return String(v);
    }
  }
  return undefined;
}

export type SimReader = (req: ResolveRequestBody) => Promise<unknown>;

export interface DiscoveredResources {
  resources: Record<string, string>;
  provenance: Record<string, string>;
  missing: Record<string, string>;
}

/**
 * Fills every scenario resource key the record does not carry: a sim read (match + pick), a named E5 discoverer, a
 * literal operator setting or a simulator fixture path. Keys the record already has are kept as they are.
 */
export async function discoverSweepResources(
  spec: Record<string, SweepResourceSpec>,
  existing: Record<string, string>,
  read: SimReader,
  o: { stacksimRoot: string; nowMs?: number },
): Promise<DiscoveredResources> {
  const resources: Record<string, string> = { ...existing };
  const provenance: Record<string, string> = Object.fromEntries(Object.keys(existing).map((k) => [k, 'tenant record (E5)']));
  const missing: Record<string, string> = {};
  for (const [key, s] of Object.entries(spec)) {
    if (resources[key] !== undefined) continue;
    try {
      if ('literal' in s) {
        resources[key] = s.literal;
        provenance[key] = `ao-sweep scenario: ${s.describe}`;
      } else if ('stacksim_fixture' in s) {
        const f = path.join(o.stacksimRoot, s.stacksim_fixture);
        if (fs.existsSync(f)) {
          resources[key] = f;
          provenance[key] = `simulator fixture ${s.stacksim_fixture}`;
        } else missing[key] = `no simulator fixture ${s.stacksim_fixture}`;
      } else if ('discoverer' in s) {
        const d = DISCOVERERS[s.discoverer]!;
        const joined: Array<Array<Record<string, unknown>>> = [];
        for (const j of d.joins ?? []) joined.push(rowsOf(await read(j)));
        const v = d.pick(rowsOf(await read(d.request)), o.nowMs ?? Date.now(), { resources, joined });
        if (v === undefined) missing[key] = `no simulator object: ${d.describe}`;
        else {
          resources[key] = v;
          provenance[key] = `discovered (${d.describe})`;
        }
      } else {
        const v = pickFrom(rowsOfAny(await read(s.read)), s.match, s.pick);
        if (v === undefined) missing[key] = `no simulator object: ${s.describe}`;
        else {
          resources[key] = v;
          provenance[key] = `discovered (${s.describe})`;
        }
      }
    } catch (err) {
      missing[key] = `read failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
    }
  }
  return { resources, provenance, missing };
}

// ---------- request inputs ----------

export function resolveSweepInputs(
  cmd: SweepCommand,
  sc: AoSweepScenario,
  resources: Record<string, string>,
  domain: string,
): { params: AoParamRecord[]; missing: string[] } {
  const params: AoParamRecord[] = [];
  const missing: string[] = [];
  for (const p of cmd.parameters ?? []) {
    if (p.source) continue; // tenant-sourced: AO binds it from the (private) record
    const spec = sc.inputs.by_command[cmd.id]?.[p.name] ?? sc.inputs.by_name[p.name];
    if (spec === undefined) {
      if (p.required) missing.push(`${p.name} (no ao-sweep input)`);
      continue;
    }
    if (typeof spec === 'string') {
      params.push({ name: p.name, from: 'ao-sweep scenario', value: spec.replace(/\{domain\}/g, domain), provenance: 'ao-sweep scenario literal' });
      continue;
    }
    const v = resources[spec.resource];
    if (v !== undefined) params.push({ name: p.name, from: `resources.${spec.resource}`, value: v, provenance: `private record resources.${spec.resource}` });
    else if (spec.else !== undefined) params.push({ name: p.name, from: 'ao-sweep scenario (fallback)', value: spec.else.replace(/\{domain\}/g, domain), provenance: `ao-sweep scenario literal (resources.${spec.resource} not discovered)` });
    else if (p.required) missing.push(`${p.name} <- resources.${spec.resource}`);
  }
  return { params, missing };
}

/** Why an op is not applied, or null when it is. Recurring-cost ops stay dry unless their free condition holds. */
export function applySkipReason(cmd: SweepCommand, sc: AoSweepScenario, resources: Record<string, string>): string | null {
  if (sc.no_apply[cmd.id]) return `ao-sweep scenario: ${sc.no_apply[cmd.id]}`;
  const cg = cmd.cost_gate;
  if (cg?.recurring) {
    const when = cg.recurring_when;
    if (when) {
      const p = cmd.parameters.find((x) => x.name === when.param);
      const key = p?.source?.replace(/^resources\./, '');
      const raw = (key ? resources[key] ?? resources[camelToSnake(key)] : undefined) ?? undefined;
      if (raw !== undefined && Number(raw) <= when.gt) return null; // the free path of a conditionally recurring op
    }
    return 'recurring cost: stays a dry run (DP-1 / DP-2 traversal is V113 / E7C)';
  }
  return null;
}

const camelToSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** The discovery's proof that an object is absent from the simulated tenant (discoverSweepResources). */
export const ABSENT_PROOF = /^no simulator object: /;

/**
 * PH-5 (V77): "<reason>; discovery: <key>: <proof>" when the scenario lists `cmd` as not applicable AND this run's
 * discovery proved one of its inputs absent; null otherwise (the op then runs, and a missing value fails as binding).
 * Inputs: each non-sourced parameter's ao-sweep resource, and each sourced parameter's record key (as is, or snake).
 */
export function notApplicableReason(cmd: SweepCommand, sc: AoSweepScenario, resourcesMissing: Record<string, string>): string | null {
  const reason = sc.not_applicable?.[cmd.id];
  if (!reason) return null;
  const keys: string[] = [];
  for (const p of cmd.parameters ?? []) {
    if (p.source) {
      const k = p.source.replace(/^(resources|subscription)\./, '');
      keys.push(k, camelToSnake(k));
      continue;
    }
    const spec = sc.inputs.by_command[cmd.id]?.[p.name] ?? sc.inputs.by_name[p.name];
    if (spec && typeof spec === 'object' && 'resource' in spec) keys.push(spec.resource);
  }
  const key = keys.find((k) => ABSENT_PROOF.test(resourcesMissing[k] ?? ''));
  return key ? `${reason}; discovery: ${key}: ${resourcesMissing[key]}` : null;
}

// ---------- one call's error class ----------

export type SweepErrorClass = 'binding' | 'guard' | 'denied' | 'other' | null;

/** binding = a required tenant value missing (W4-AO2); guard = the PowerShell injection or read-only guard. */
export function errorClassOf(r: { rc: number; stdout: string; stderr: string }): { cls: SweepErrorClass; error?: string } {
  const j = parseAoJson(r.stdout);
  const err = String(j?.error ?? (j ? '' : (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-1)[0] ?? '')).slice(0, 400);
  const outcome = String(j?.evidence?.outcome ?? '');
  if (/Parameter binding failed|required tenant-sourced parameter|Missing required parameter/i.test(err)) return { cls: 'binding', error: err };
  if (/PowerShell injection guard|PS_GUARD_|read-only guard|state read refused/i.test(err)) return { cls: 'guard', error: err };
  if (/^denied_/.test(outcome)) return { cls: 'denied', error: err || outcome };
  if (r.rc !== 0 || !j || j.success === false) return { cls: 'other', ...(err ? { error: err } : {}) };
  return { cls: null };
}

// ---------- the sweep ----------

export interface SweepCallRecord extends AoCallRecord {
  error_class: SweepErrorClass;
  error?: string;
}

export interface SweepOpRecord {
  op: string;
  tier: 'T2' | 'T3';
  params: AoParamRecord[];
  calls: SweepCallRecord[];
  dry_run_ok: boolean;
  applied: boolean;
  apply_skipped?: string;
  not_run?: string;
  /** PH-5: the op has no target on this tenant, with the discovery's proof (notApplicableReason). */
  not_applicable?: string;
  detail?: string;
}

export interface AoSweepRecord {
  schema: typeof FIN29_SCHEMAS.aoSweep;
  slug: string;
  taken: string;
  started: string;
  ended: string;
  scenario: string;
  tenant_id: string | null;
  requestor_upn: string | null;
  approver_upn: string | null;
  two_person_approval: 'on' | 'off';
  expected_commands: number;
  apply_floor: number;
  private_record: string;
  resources: Record<string, string>;
  resources_missing: Record<string, string>;
  totals: { commands: number; dry_run_ok: number; applied: number; apply_skipped: number; not_run: number; not_applicable: number; binding_errors: number; guard_errors: number };
  ops: SweepOpRecord[];
  ok: boolean;
  note?: string;
}

export function execSweepArgs(o: { op: string; slug: string; requestor: string; params: AoParamRecord[]; apply?: boolean; approvalId?: string }): string[] {
  const a = ['exec', o.op, '--tenant', o.slug, '--requestor', o.requestor];
  if (o.approvalId) a.push('--approval', o.approvalId);
  if (o.apply) a.push('--apply');
  for (const p of o.params) a.push('--param', `${p.name}=${p.value}`);
  a.push('--json');
  return a;
}

export interface RunAoSweepInput {
  commands: SweepCommand[];
  scenario: AoSweepScenario;
  slug: string;
  /** The private record as AO will read it (resources discovered). */
  record: Record<string, unknown>;
  env: NodeJS.ProcessEnv;
  runCli: AoCliRunner;
  now?: () => number;
  /** Every minted approver token is registered for the leak scan. */
  registerSecret?: (name: string, value: string) => void;
  /** PH-5: this run's discovery misses (key -> why), the proof a not-applicable op needs. */
  resourcesMissing?: Record<string, string>;
}

export async function runAoSweep(i: RunAoSweepInput): Promise<Omit<AoSweepRecord, 'schema' | 'slug' | 'taken' | 'started' | 'ended' | 'scenario' | 'private_record' | 'resources_missing' | 'expected_commands' | 'apply_floor'>> {
  const resources = (i.record.resources ?? {}) as Record<string, string>;
  const requestor = recordValue(i.record, 'resources.operator_upn') ?? null;
  const approver = recordValue(i.record, 'resources.approver_upn') ?? null;
  const tenantId = recordValue(i.record, 'tenant.tenant_id') ?? null;
  const domain = recordValue(i.record, 'tenant.domain') ?? '';
  const twoOn = twoPersonApprovalOn(i.env);
  const ops: SweepOpRecord[] = [];
  for (const cmd of i.commands) {
    const tier: 'T2' | 'T3' = cmd.sodTier === 'Tier 3' ? 'T3' : 'T2';
    const rec: SweepOpRecord = { op: cmd.id, tier, params: [], calls: [], dry_run_ok: false, applied: false };
    ops.push(rec);
    const na = notApplicableReason(cmd, i.scenario, i.resourcesMissing ?? {});
    if (na) {
      rec.not_applicable = na;
      continue;
    }
    const { params, missing } = resolveSweepInputs(cmd, i.scenario, resources, domain);
    rec.params = params;
    if (!requestor) missing.push('requestor <- resources.operator_upn');
    if (missing.length) {
      rec.not_run = `inputs not bound: ${missing.join(', ')}`;
      continue;
    }
    const call = async (kind: AoCallRecord['call'], argv: string[], env: NodeJS.ProcessEnv): Promise<SweepCallRecord> => {
      const r = await i.runCli(argv, env, `E7S-${cmd.id}-${kind}`);
      const c = summarizeExec(kind, argv, r);
      const e = errorClassOf(r);
      const row: SweepCallRecord = { ...c, error_class: e.cls, ...(e.error ? { error: e.error } : {}) };
      rec.calls.push(row);
      return row;
    };
    if (tier === 'T3' && twoOn) {
      // Two-person ON: AO answers a Tier-3 call without an approval by opening the gate (pending_approval) and running
      // nothing, so that request is the op's dry-run equivalent (as E7A's T3 sequence).
      if (!approver || approver === requestor || !tenantId) {
        rec.not_run = 'two-person ON: needs resources.approver_upn different from the requestor and tenant.tenant_id';
        continue;
      }
      const q = await call('request', execSweepArgs({ op: cmd.id, slug: i.slug, requestor: requestor!, params }), i.env);
      rec.dry_run_ok = q.ok && !!q.approval_id && q.error_class !== 'binding' && q.error_class !== 'guard';
      if (!rec.dry_run_ok) {
        rec.detail = q.error ?? q.detail ?? 'no approval request';
        continue;
      }
      const skip = applySkipReason(cmd, i.scenario, resources);
      if (skip) {
        rec.apply_skipped = skip;
        continue;
      }
      const secret = i.env[AO_SECRET_ENV];
      if (!secret) {
        rec.detail = `${AO_SECRET_ENV} absent from the AO env`;
        continue;
      }
      const token = mintPrincipalToken({ upn: approver, tid: tenantId }, secret, (i.now ?? Date.now)());
      i.registerSecret?.(`ao_sweep_approver_token_${cmd.id}`, token);
      const argv = ['approve', q.approval_id!];
      const r = await i.runCli(argv, { ...i.env, [AO_TOKEN_ENV]: token }, `E7S-${cmd.id}-approve`);
      const ok = r.rc === 0 && /APPROVED/.test(r.stdout);
      rec.calls.push({ call: 'approve', argv, rc: r.rc, ok, error_class: ok ? null : 'other', ...(ok ? {} : { error: (r.stderr || r.stdout).trim().slice(0, 300) }) });
      if (!ok) {
        rec.detail = 'approve failed';
        continue;
      }
      const a = await call('apply', execSweepArgs({ op: cmd.id, slug: i.slug, requestor: requestor!, params, apply: true, approvalId: q.approval_id }), i.env);
      rec.applied = a.success === true && a.mode !== 'dry_run' && a.error_class === null;
      if (!rec.applied) rec.detail = a.error ?? a.detail ?? 'apply not ok';
      continue;
    }
    const d = await call('dry_run', execSweepArgs({ op: cmd.id, slug: i.slug, requestor: requestor!, params }), i.env);
    rec.dry_run_ok = d.ok && d.success === true && d.error_class === null;
    if (!rec.dry_run_ok) {
      rec.detail = d.error ?? d.detail ?? 'dry run not ok';
      continue;
    }
    const skip = applySkipReason(cmd, i.scenario, resources);
    if (skip) {
      rec.apply_skipped = skip;
      continue;
    }
    const a = await call('apply', execSweepArgs({ op: cmd.id, slug: i.slug, requestor: requestor!, params, apply: true }), i.env);
    rec.applied = a.success === true && a.mode !== 'dry_run' && a.error_class === null;
    if (!rec.applied) rec.detail = a.error ?? a.detail ?? 'apply not ok';
  }
  const all = ops.flatMap((o) => o.calls);
  const totals = {
    commands: ops.length,
    dry_run_ok: ops.filter((o) => o.dry_run_ok).length,
    applied: ops.filter((o) => o.applied).length,
    apply_skipped: ops.filter((o) => o.apply_skipped).length,
    not_run: ops.filter((o) => o.not_run).length,
    not_applicable: ops.filter((o) => o.not_applicable).length,
    binding_errors: all.filter((c) => c.error_class === 'binding').length,
    guard_errors: all.filter((c) => c.error_class === 'guard').length,
  };
  return {
    tenant_id: tenantId,
    requestor_upn: requestor,
    approver_upn: twoOn ? approver : null,
    two_person_approval: twoOn ? 'on' : 'off',
    resources,
    totals,
    ops,
    ok: totals.not_run === 0 && totals.dry_run_ok === totals.commands - totals.not_applicable && totals.binding_errors === 0 && totals.guard_errors === 0,
  };
}

// ---------- the private tenant record ----------

/** `out/ao-sweep/tenants`: the private tenant root E7S points AO at (CES_TENANT_ROOT). */
export function sweepTenantRoot(outDir: string): string {
  return path.join(outDir, 'ao-sweep', 'tenants');
}

export function writePrivateRecord(root: string, slug: string, record: Record<string, unknown>): string {
  const f = path.join(root, 'sim', `${slug}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(record, null, 2) + '\n', 'utf-8');
  return f;
}

// ---------- the step factory ----------

export interface E7sDeps {
  read?: SimReader;
  makePfx?: (pfxPath: string) => { path: string; thumbprint: string };
  scenarioFile?: string;
}

/**
 * E7S. Runner placement: after E7C and after every other FIN-29 step that uses the sim (E7S is the last sim-writing
 * step before the run's finally block). It needs the sim (E1), the AO env (E7A) and the registry record (E5/E7A).
 */
export function e7sStep(ctx: Fin29StepCtx, deps: E7sDeps = {}): Fin29StepDef {
  const testerRoot = path.join(ctx.P.ces, 'ces-tester');
  const scenarioFile = deps.scenarioFile ?? path.join(testerRoot, AO_SWEEP_SCENARIO_REL);
  let sc: AoSweepScenario | null = null;
  let loadError: string | null = null;
  try {
    sc = loadAoSweepScenario(scenarioFile);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }
  const outFile = path.join(ctx.P.out, FIN29_FILES.aoSweep);
  const root = sweepTenantRoot(ctx.P.out);
  const skip = loadError ? `ao-sweep scenario not loaded: ${loadError}` : !sc!.applies_to.includes(ctx.slug) ? `ao-sweep applies to ${sc!.applies_to.join(', ')} only (V77: S1)` : undefined;
  return {
    id: 'E7S',
    title: `AdminOps sweep: every AO command dry-run, applied where the sim and the cost gate allow (two-person ${twoPersonApprovalOn(process.env) ? 'ON' : 'OFF'}; ${TWO_PERSON_APPROVAL_ENV}=1 turns it on)`,
    fatal: false,
    ...(skip ? { skip } : {}),
    commands: [
      `discovery: ${ctx.rel(scenarioFile)} resources (sim /resolve reads) -> private record ${ctx.rel(path.join(root, 'sim', `${ctx.slug}.json`))} (the run's record is not changed)`,
      `(cwd ${ctx.rel(ctx.P.aoRoot)}, AO env as E7A, CES_TENANT_ROOT=${ctx.rel(root)}) ${'node'} ${ctx.rel(ctx.P.aoCli)} exec <op> --tenant ${ctx.slug} --requestor <resources.operator_upn> [--param k=v ...] --json, then --apply where allowed (x every registry command)`,
      `-> ${ctx.rel(outFile)}`,
    ],
    run: async () => {
      fs.rmSync(outFile, { force: true });
      fs.rmSync(path.join(ctx.P.out, 'ao-sweep'), { recursive: true, force: true });
      const env0 = ctx.aoEnv();
      if (!ctx.simUp() || !env0 || !fs.existsSync(ctx.P.registryRecord)) return { rc: 1, detail: 'E7S needs the sim (E1), the AO env (E7A) and the registry record (E5)' };
      const started = ctx.nowIso();
      const read: SimReader = deps.read ?? ((req) => simResolve(ctx.urls.sim, req));
      const record = JSON.parse(fs.readFileSync(ctx.P.registryRecord, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
      const disc = await discoverSweepResources(sc!.resources, (record.resources ?? {}) as Record<string, string>, read, { stacksimRoot: ctx.P.sim });
      const priv: Record<string, unknown> = { ...record, resources: disc.resources };
      let ownPfx: string | null = null;
      try {
        const certPath = (record.auth as { cert_path?: string } | undefined)?.cert_path;
        if (!certPath || !fs.existsSync(certPath)) {
          // E7A's throwaway PFX is gone (or E7A had no ops): make E7S's own, removed below (SP-11 sim-PFX sweep).
          const made = (deps.makePfx ?? makeSimPfx)(path.join(ctx.P.out, 'ao-sweep', 'sim', `${ctx.slug}.pfx`));
          ownPfx = made.path;
          priv.auth = { ...((record.auth as Record<string, unknown>) ?? {}), cert_path: made.path };
        }
        const privFile = writePrivateRecord(root, ctx.slug, priv);
        const env: NodeJS.ProcessEnv = { ...env0, CES_TENANT_ROOT: root };
        const commands = loadAoRegistry(ctx.P.aoRoot);
        const res = await runAoSweep({ commands, scenario: sc!, slug: ctx.slug, record: priv, env, runCli: (a, e, l) => ctx.runAoCli(a, e, l), registerSecret: (n, v) => ctx.registerSecret(n, v), resourcesMissing: disc.missing });
        const rec: AoSweepRecord = {
          schema: FIN29_SCHEMAS.aoSweep,
          slug: ctx.slug,
          taken: ctx.nowIso(),
          started,
          ended: ctx.nowIso(),
          scenario: ctx.rel(scenarioFile),
          expected_commands: sc!.expected_commands,
          apply_floor: sc!.apply_floor,
          private_record: ctx.rel(privFile),
          resources_missing: disc.missing,
          ...res,
          // the record keeps the discovered keys' provenance, not only the values
          resources: Object.fromEntries(Object.keys(disc.resources).sort().map((k) => [k, disc.provenance[k] ?? 'unknown'])),
        };
        fs.writeFileSync(outFile, JSON.stringify(rec, null, 2));
        const t = rec.totals;
        const line = `${t.commands} commands: ${t.dry_run_ok} dry-run ok, ${t.applied} applied (floor ${rec.apply_floor}), ${t.apply_skipped} kept dry, ${t.not_run} not run, ${t.not_applicable} not applicable (resource absent), binding errors ${t.binding_errors}, guard errors ${t.guard_errors}`;
        ctx.log(`  E7S: ${line}`);
        return { rc: rec.ok && t.applied >= rec.apply_floor ? 0 : 1, detail: line, extra: { file: FIN29_FILES.aoSweep, ...t, two_person_approval: rec.two_person_approval } };
      } finally {
        if (ownPfx) fs.rmSync(ownPfx, { force: true });
      }
    },
  };
}
