// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Resolver dispatch table for input sources named by render directives.
 *
 * W4-EO3: every provider reads a real CES data source; none is a stub any more.
 *   - entra, intune, exchange, purview, sharepoint, teams, sentinel, defender, defender_for_cloud:
 *     the tenant's Stamper discovery evidence (getStamperTenantRoot(slug)/evidence/**.json — what
 *     Stamper actually read from the tenant), classified by engine and command/Graph URI.
 *   - stamper: the same evidence plus Stamper's execution-results manifests (state/) and plans.
 *   - planner: the Planner (Muster) tenant-config profile and mission plan for this tenant, joined
 *     on tenant_config.identity.tenant_id == the tenant GUID.
 *   - eo: EvidenceOps' own assessment snapshot (set by the orchestrator).
 *   - adminops: AO evidence rows from ces.db (FX-EO3).
 * Stamper's directives name sources in underscore form (entra_password_policy, unified_audit_log,
 * pipeline_not_sat_findings …); those names are aliased onto the dotted grammar below.
 * A path that matches nothing resolves { resolved: false } with a reason — it never widens.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getStamperTenantRoot, getPlannerCustomersRoot } from 'ces-shared/storage/node';
import type { InputSourceSpec, ResolverResponse } from '../../shared/types/render.types.js';
import type { AdminOpsReadResult } from '../adminops/AdminOpsEvidenceReader.js';

type ProviderFn = (spec: InputSourceSpec) => ResolverResponse;

export interface InputSourceContext {
  /** Tenant slug — selects the Stamper tenant root. */
  tenantSlug?: string;
  /** Tenant GUID — joins the Planner tenant-config profile. */
  tenantId?: string;
}

/** One Stamper discovery-evidence file, as a provider returns it. */
export interface StamperEvidenceRecord {
  file: string;            // path relative to the tenant's evidence dir
  entryId: string;
  label: string;
  engine: string;
  controlIds: string[];
  command: string;
  rawResponse: string;
  outcome: string;
  verdict: string;
  timestamp: string;
  sha256: string;
  narrative?: string;      // directiveMetadata.narrative_stub when present
}

/** Stamper directive names (execute.routes.ts DOC_RENDERABLE_CONTROLS) -> dotted paths. */
export const STAMPER_INPUT_ALIASES: Record<string, string> = {
  entra_password_policy: 'entra.password_policy',
  entra_audit_logs: 'entra.audit_logs',
  intune_app_control_policies: 'intune.app_control_policies',
  unified_audit_log: 'purview.unified_audit_log',
  defender_for_cloud_findings: 'defender_for_cloud.findings',
  pipeline_not_sat_findings: 'eo.not_sat_findings',
  manual_gate_items: 'stamper.manual_gate_items',
  pipeline_control_narratives: 'stamper.control_narratives',
  evidence_manifests: 'stamper.execution_results',
};

const text = (r: StamperEvidenceRecord) => `${r.command} ${r.entryId}`;

const isIntune = (r: StamperEvidenceRecord) => /deviceManagement|deviceAppManagement|DeviceManagement|DeviceApp/.test(r.command);
// Case-sensitive cmdlet nouns (Get-SPOTenant, Get-PnP…): case-insensitive 'SPO' would match 'AccessPolicy'.
const isSharePoint = (r: StamperEvidenceRecord) => /-SPO[A-Z]|-PnP[A-Z]/.test(r.command) || /sharepoint/i.test(r.command);
const isDefenderForCloud = (r: StamperEvidenceRecord) => /AzSecurity|Microsoft\.Security|defender.?for.?cloud/i.test(r.command);

/** Which Stamper evidence belongs to which service provider (a record may belong to several). */
export const SERVICE_MATCH: Record<string, (r: StamperEvidenceRecord) => boolean> = {
  entra: r => r.engine === 'mgraph' && !isIntune(r) && !isSharePoint(r),
  intune: isIntune,
  exchange: r => r.engine === 'exchange',
  purview: r => r.engine === 'ipps' || /UnifiedAuditLog|Dlp|\bGet-Label|LabelPolicy|ComplianceSearch|InsiderRisk|Retention/.test(r.command),
  sharepoint: isSharePoint,
  teams: r => r.engine === 'teams' || /\b(Get|Set|New)-Cs[A-Z]/.test(r.command),
  sentinel: r => /sentinel|OperationalInsights/i.test(text(r)),
  defender: r => !isDefenderForCloud(r) && /Atp|SafeAttachment|SafeLinks|AntiPhish|MalwareFilter|attackSurfaceReduction|asr-|Defender/i.test(text(r)),
  defender_for_cloud: isDefenderForCloud,
};

/** Named collections per service (a regex over command + entry id). `records` = everything. */
export const SERVICE_COLLECTIONS: Record<string, Record<string, RegExp>> = {
  entra: {
    conditional_access: /conditionalAccess|ConditionalAccess/,
    password_policy: /password|\/settings'|authenticationMethod/i,
    audit_logs: /auditLogs|AuditLog|audit/i,
    sign_in_logs: /signIns|AuditLogSignIn/,
    users: /MgUser|\/users/,
    groups: /MgGroup|\/groups/,
    roles: /DirectoryRole|roleManagement|RoleManagement/,
    auth_methods: /authenticationMethod|AuthenticationStrength/i,
  },
  intune: {
    device_configurations: /deviceConfiguration|DeviceConfiguration/,
    app_protection: /deviceAppManagement|DeviceApp/,
    app_control_policies: /deviceAppManagement|appLocker|wdac|install|ApplicationControl/i,
    compliance: /compliancePolic|CompliancePolic/i,
  },
  exchange: { transport: /Transport/, audit_config: /AdminAuditLogConfig/, unified_audit_log: /UnifiedAuditLog/ },
  purview: { labels: /Label/, dlp: /Dlp/i, audit_retention: /AuditLogRetention/, unified_audit_log: /UnifiedAuditLog/ },
  sharepoint: { sharing: /sharing|Sharing/ },
  teams: { external_access: /ExternalAccess|Federation/ },
  sentinel: { data_connectors: /DataConnector|data-connector/i, alert_rules: /AlertRule/, incidents: /Incident/ },
  defender: { office365: /Atp|Safe|AntiPhish|MalwareFilter/, endpoint: /asr-|attackSurfaceReduction|Defender/i },
  defender_for_cloud: { findings: /AzSecurity|Microsoft\.Security/ },
};

export class InputSourceResolver {
  private readonly providers: Map<string, ProviderFn>;
  private adminOpsData: AdminOpsReadResult | null = null;
  private context: InputSourceContext;
  private snapshot: unknown = null;
  private evidenceCache: StamperEvidenceRecord[] | null = null;

  constructor(context: InputSourceContext = {}) {
    this.context = { ...context };
    this.providers = new Map<string, ProviderFn>();
    for (const service of Object.keys(SERVICE_MATCH)) {
      this.providers.set(service, this.serviceResolver(service));
    }
    this.providers.set('adminops', this.adminOpsResolver());
    this.providers.set('stamper', this.stamperResolver());
    this.providers.set('planner', this.plannerResolver());
    this.providers.set('eo', this.eoResolver());
  }

  /** Prefixes this resolver answers (every one is backed by a real data source). */
  get providerPrefixes(): string[] {
    return [...this.providers.keys()];
  }

  setContext(context: InputSourceContext): void {
    this.context = { ...this.context, ...context };
    this.evidenceCache = null;
  }

  /** EvidenceOps' own assessment snapshot for this run (eo.* sources); also supplies the tenant GUID. */
  setAssessmentSnapshot(snapshot: unknown): void {
    this.snapshot = snapshot ?? null;
    const tid = (snapshot as { tenantId?: unknown } | null)?.tenantId;
    if (!this.context.tenantId && typeof tid === 'string') this.context.tenantId = tid;
  }

  resolveInputSource(rawPath: string): ResolverResponse {
    const aliased = STAMPER_INPUT_ALIASES[rawPath] ?? rawPath;
    const spec = this.parseInputSourceSpec(aliased);
    return this.dispatchToProvider(spec);
  }

  dispatchToProvider(spec: InputSourceSpec): ResolverResponse {
    const provider = this.providers.get(spec.prefix);
    if (!provider) {
      return { resolved: false, reason: `Unknown input source prefix: '${spec.prefix}'` };
    }
    const res = provider(spec);
    // Every failure names its provider, so a render notice says which source was missing.
    if (!res.resolved && !res.reason.includes(spec.prefix)) return { resolved: false, reason: `${spec.prefix}: ${res.reason}` };
    return res;
  }

  private parseInputSourceSpec(rawPath: string): InputSourceSpec {
    const segments = rawPath.split('.');
    const prefix = segments[0].replace(/\[.*$/, '');
    return {
      rawPath,
      prefix,
      segments: segments.slice(1),
    };
  }

  setAdminOpsData(data: AdminOpsReadResult): void {
    this.adminOpsData = data;
  }

  // ── Stamper discovery evidence ────────────────────────────────────────────

  private loadStamperEvidence(): StamperEvidenceRecord[] | { error: string } {
    const slug = this.context.tenantSlug;
    if (!slug) return { error: 'No tenant slug in resolver context' };
    if (this.evidenceCache) return this.evidenceCache;
    const dir = path.join(getStamperTenantRoot(slug), 'evidence');
    if (!fs.existsSync(dir)) return { error: `No Stamper evidence for tenant '${slug}'` };
    const out: StamperEvidenceRecord[] = [];
    for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
      const relStr = String(rel).replace(/\\/g, '/');
      if (!relStr.endsWith('.json')) continue;
      let j: Record<string, any>;
      try { j = JSON.parse(fs.readFileSync(path.join(dir, String(rel)), 'utf-8')); } catch { continue; }
      const controlIds = j?.metadata?.controlIds;
      if (!Array.isArray(controlIds) || controlIds.length === 0) continue;
      out.push({
        file: relStr,
        entryId: String(j.registryEntry?.entry_id ?? path.basename(relStr, '.json')),
        label: String(j.registryEntry?.label ?? ''),
        engine: String(j.registryEntry?.engine ?? ''),
        controlIds: controlIds.map(String),
        command: String(j.metadata?.commandExecuted ?? ''),
        rawResponse: String(j.rawResponse ?? ''),
        outcome: String(j.outcome ?? ''),
        verdict: String(j.complianceVerdict ?? ''),
        timestamp: String(j.metadata?.timestamp ?? ''),
        sha256: String(j.metadata?.sha256Hash ?? ''),
        ...(typeof j.directiveMetadata?.narrative_stub === 'string' && j.directiveMetadata.narrative_stub
          ? { narrative: j.directiveMetadata.narrative_stub as string } : {}),
      });
    }
    out.sort((a, b) => a.file.localeCompare(b.file));
    this.evidenceCache = out;
    return out;
  }

  private serviceResolver(service: string): ProviderFn {
    return (spec: InputSourceSpec): ResolverResponse => {
      const parsed = parseCollectionPath(spec.rawPath, service);
      if ('error' in parsed) return { resolved: false, reason: parsed.error };
      const collection = parsed.collection ?? 'records';
      const matcher = collection === 'records' ? null : SERVICE_COLLECTIONS[service]?.[collection];
      if (collection !== 'records' && !matcher) {
        return { resolved: false, reason: `Unknown ${service} collection '${collection}' (known: records, ${Object.keys(SERVICE_COLLECTIONS[service] ?? {}).join(', ')})` };
      }
      if (parsed.rest.length) {
        return { resolved: false, reason: `Field paths inside ${service} raw output are not supported ('${parsed.rest.join('.')}'); request '${service}.${collection}'` };
      }
      const ev = this.loadStamperEvidence();
      if ('error' in ev) return { resolved: false, reason: ev.error };
      const rows = ev.filter(r => SERVICE_MATCH[service](r)
        && (!matcher || matcher.test(text(r)))
        && parsed.filters.every(([k, v]) => RECORD_FILTERS[k](r, v)));
      if (!rows.length) return { resolved: false, reason: `No Stamper evidence matches '${spec.rawPath}' for tenant '${this.context.tenantSlug}'` };
      return { resolved: true, data: rows };
    };
  }

  private stamperResolver(): ProviderFn {
    return (spec: InputSourceSpec): ResolverResponse => {
      const parsed = parseCollectionPath(spec.rawPath, 'stamper');
      if ('error' in parsed) return { resolved: false, reason: parsed.error };
      const slug = this.context.tenantSlug;
      if (!slug) return { resolved: false, reason: 'No tenant slug in resolver context' };
      const collection = parsed.collection ?? 'evidence';
      if (collection === 'execution_results' || collection === 'plans') {
        const sub = collection === 'plans' ? 'plans' : 'state';
        const want = collection === 'plans' ? /^executable-plan-.*\.json$/ : /^execution-results-.*\.json$/;
        const dir = path.join(getStamperTenantRoot(slug), sub);
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => want.test(f)).sort() : [];
        const docs = files
          .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Record<string, unknown>; } catch { return null; } })
          .filter((d): d is Record<string, unknown> => !!d && (d.tenantSlug === undefined || d.tenantSlug === slug));
        if (!docs.length) return { resolved: false, reason: `No Stamper ${collection} for tenant '${slug}'` };
        return { resolved: true, data: docs };
      }
      const ev = this.loadStamperEvidence();
      if ('error' in ev) return { resolved: false, reason: ev.error };
      let rows: StamperEvidenceRecord[];
      if (collection === 'evidence') rows = ev;
      else if (collection === 'manual_gate_items') rows = ev.filter(r => r.engine === 'manual_gate');
      else if (collection === 'control_narratives') rows = ev.filter(r => r.narrative);
      else return { resolved: false, reason: `Unknown stamper collection '${collection}' (known: evidence, manual_gate_items, control_narratives, execution_results, plans)` };
      if (parsed.rest.length) return { resolved: false, reason: `Field paths inside stamper.${collection} are not supported ('${parsed.rest.join('.')}')` };
      const filtered = rows.filter(r => parsed.filters.every(([k, v]) => RECORD_FILTERS[k](r, v)));
      if (!filtered.length) return { resolved: false, reason: `No Stamper data matches '${spec.rawPath}' for tenant '${slug}'` };
      const data = collection === 'control_narratives'
        ? filtered.map(r => ({ controlIds: r.controlIds, entryId: r.entryId, narrative: r.narrative }))
        : filtered;
      return { resolved: true, data };
    };
  }

  // ── Planner (Muster) artifacts ────────────────────────────────────────────

  private plannerResolver(): ProviderFn {
    return (spec: InputSourceSpec): ResolverResponse => {
      const tenantId = this.context.tenantId;
      if (!tenantId) return { resolved: false, reason: 'No tenant id in resolver context (needed to find the Planner profile)' };
      const [collection, ...rest] = spec.segments;
      if (collection !== 'tenant_config' && collection !== 'mission_plan') {
        return { resolved: false, reason: `Unknown planner collection '${collection ?? ''}' (known: tenant_config, mission_plan)` };
      }
      const found = findPlannerCustomer(tenantId);
      if (!found) return { resolved: false, reason: `No Planner tenant-config profile for tenant '${tenantId}'` };
      if (collection === 'tenant_config') {
        let node: unknown = found.profile.tenant_config;
        for (const key of rest) {
          if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) node = (node as Record<string, unknown>)[key];
          else return { resolved: false, reason: `Planner tenant_config has no '${rest.join('.')}' for tenant '${tenantId}'` };
        }
        return { resolved: true, data: node };
      }
      const plan = latestJson(path.join(found.customerDir, 'outputs'), /mission-plan.*\.json$/);
      if (!plan) return { resolved: false, reason: `No Planner mission plan for tenant '${tenantId}'` };
      return { resolved: true, data: plan };
    };
  }

  // ── EvidenceOps' own assessment ───────────────────────────────────────────

  private eoResolver(): ProviderFn {
    return (spec: InputSourceSpec): ResolverResponse => {
      const snap = this.snapshot as { controls?: Array<{ status?: string }> } | null;
      if (!snap) return { resolved: false, reason: 'No EvidenceOps assessment snapshot in resolver context' };
      const [collection] = spec.segments;
      if (collection === 'snapshot') return { resolved: true, data: snap };
      if (collection === 'not_sat_findings') {
        return { resolved: true, data: (snap.controls ?? []).filter(c => c.status !== 'met') };
      }
      return { resolved: false, reason: `Unknown eo collection '${collection ?? ''}' (known: snapshot, not_sat_findings)` };
    };
  }

  /**
   * FX-EO3: the adminops provider honours the path it is given instead of returning every
   * loaded row. Grammar (after the `adminops.` prefix):
   *
   *   <collection>[key=value][key=value,key=value]...
   *
   * `collection` must be `evidence` or `executions` (AO evidence rows); other collections
   * (e.g. `change_log`) are not provided by the AO evidence contract and resolve to
   * `resolved:false`. Filter keys: tenant (tenantId or tenantSlug), control (in controlIds),
   * command (commandId), mode, outcome, correlation (correlationId). Values may contain dots
   * (control ids). An unknown key or malformed filter never widens the result — it fails.
   */
  private adminOpsResolver(): ProviderFn {
    return (spec: InputSourceSpec): ResolverResponse => {
      if (!this.adminOpsData || this.adminOpsData.parsed.length === 0) {
        return { resolved: false, reason: 'No AdminOps evidence loaded' };
      }
      const parsedPath = parseAdminOpsPath(spec.rawPath);
      if ('error' in parsedPath) return { resolved: false, reason: parsedPath.error };
      if (!ADMINOPS_COLLECTIONS.has(parsedPath.collection)) {
        return { resolved: false, reason: `AdminOps collection not available: '${parsedPath.collection}'` };
      }
      const rows = this.adminOpsData.parsed.filter(ev =>
        parsedPath.filters.every(([key, value]) => ADMINOPS_FILTERS[key](ev, value)));
      if (rows.length === 0) {
        return { resolved: false, reason: `No AdminOps evidence matches '${spec.rawPath}'` };
      }
      return { resolved: true, data: rows };
    };
  }
}

type AdminOpsRow = AdminOpsReadResult['parsed'][number];
type AdminOpsFilterKey = 'tenant' | 'control' | 'command' | 'mode' | 'outcome' | 'correlation';

const ADMINOPS_COLLECTIONS = new Set(['evidence', 'executions']);

const ADMINOPS_FILTERS: Record<AdminOpsFilterKey, (ev: AdminOpsRow, value: string) => boolean> = {
  tenant: (ev, v) => ev.tenantId === v || ev.tenantSlug === v,
  control: (ev, v) => ev.controlIds.includes(v),
  command: (ev, v) => ev.commandId === v,
  mode: (ev, v) => ev.mode === v,
  outcome: (ev, v) => ev.outcome === v,
  correlation: (ev, v) => ev.correlationId === v,
};

/** Parse `adminops.<collection>[k=v]...` into a collection name + validated filters. */
function parseAdminOpsPath(
  rawPath: string,
): { collection: string; filters: Array<[AdminOpsFilterKey, string]> } | { error: string } {
  const PREFIX = 'adminops.';
  if (!rawPath.startsWith(PREFIX)) return { error: `Not an adminops path: '${rawPath}'` };
  const rest = rawPath.slice(PREFIX.length);
  const m = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[[^\]]*\])*)$/.exec(rest);
  if (!m) return { error: `Malformed adminops path: '${rawPath}'` };
  const filters: Array<[AdminOpsFilterKey, string]> = [];
  for (const group of m[2].match(/\[[^\]]*\]/g) ?? []) {
    for (const pair of group.slice(1, -1).split(',')) {
      const eq = pair.indexOf('=');
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (eq <= 0 || value === '') return { error: `Malformed adminops filter '${pair}' in '${rawPath}'` };
      if (!(key in ADMINOPS_FILTERS)) return { error: `Unknown adminops filter key '${key}' in '${rawPath}'` };
      filters.push([key as AdminOpsFilterKey, value]);
    }
  }
  return { collection: m[1], filters };
}

// ── helpers (W4-EO3) ────────────────────────────────────────────────────────

type RecordFilterKey = 'control' | 'engine' | 'entry';
const RECORD_FILTERS: Record<RecordFilterKey, (r: StamperEvidenceRecord, v: string) => boolean> = {
  control: (r, v) => r.controlIds.includes(v),
  engine: (r, v) => r.engine === v,
  entry: (r, v) => r.entryId === v,
};

/** `<prefix>[.<collection>[.<rest>…]][k=v]…` — filters: control, engine, entry. Never widens. */
function parseCollectionPath(
  rawPath: string, prefix: string,
): { collection?: string; rest: string[]; filters: Array<[RecordFilterKey, string]> } | { error: string } {
  if (!rawPath.startsWith(prefix)) return { error: `Not a ${prefix} path: '${rawPath}'` };
  // Filter values may contain dots (control ids), so split off the [..] groups first.
  const tail = rawPath.slice(prefix.length);
  const bracket = tail.indexOf('[');
  const dotted = bracket === -1 ? tail : tail.slice(0, bracket);
  const groups = bracket === -1 ? '' : tail.slice(bracket);
  if (!/^(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(dotted) || !/^(?:\[[^\]]*\])*$/.test(groups)) {
    return { error: `Malformed ${prefix} path: '${rawPath}'` };
  }
  const segs = dotted.split('.').filter(Boolean);
  const filters: Array<[RecordFilterKey, string]> = [];
  for (const group of groups.match(/\[[^\]]*\]/g) ?? []) {
    for (const pair of group.slice(1, -1).split(',')) {
      const eq = pair.indexOf('=');
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (eq <= 0 || value === '') return { error: `Malformed filter '${pair}' in '${rawPath}'` };
      if (!(key in RECORD_FILTERS)) return { error: `Unknown filter key '${key}' in '${rawPath}'` };
      filters.push([key as RecordFilterKey, value]);
    }
  }
  return { collection: segs[0], rest: segs.slice(1), filters };
}

function latestJson(dir: string, re: RegExp): Record<string, unknown> | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => re.test(f)).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, files[i]), 'utf-8')); } catch { /* try the next one */ }
  }
  return null;
}

type PlannerProfile = { ces?: { generated_on?: string }; tenant_config?: Record<string, unknown> & { identity?: { tenant_id?: string } } };

/** Planner customer whose (latest) tenant-config profile names this tenant GUID. */
function findPlannerCustomer(tenantId: string): { customerDir: string; profile: PlannerProfile } | null {
  const root = getPlannerCustomersRoot();
  if (!fs.existsSync(root)) return null;
  let best: { customerDir: string; profile: PlannerProfile; key: string } | null = null;
  for (const name of fs.readdirSync(root)) {
    const customerDir = path.join(root, name);
    const inputs = path.join(customerDir, 'inputs');
    if (!fs.existsSync(inputs)) continue;
    for (const f of fs.readdirSync(inputs).filter(x => /^tenant-config-profile_.*\.json$/.test(x))) {
      let profile: PlannerProfile;
      try { profile = JSON.parse(fs.readFileSync(path.join(inputs, f), 'utf-8')); } catch { continue; }
      if (profile?.tenant_config?.identity?.tenant_id !== tenantId) continue;
      const key = `${profile.ces?.generated_on ?? ''}|${f}`;
      if (!best || key > best.key) best = { customerDir, profile, key };
    }
  }
  return best && { customerDir: best.customerDir, profile: best.profile };
}

/**
 * W4-EO3: readable text for a resolved input (renderers used String(data), which printed
 * "[object Object]" once providers returned real records). Stamper evidence records become one
 * line each; anything else is pretty JSON.
 */
export function describeResolvedData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data) && data.every(d => d && typeof d === 'object' && 'entryId' in d && 'command' in d)) {
    return (data as StamperEvidenceRecord[]).map(r =>
      `${r.entryId} [${r.controlIds.join(', ')}] ${r.verdict || r.outcome} @ ${r.timestamp}: ${r.label || r.command}`
      + (r.rawResponse.trim() ? ` — ${r.rawResponse.trim().slice(0, 400)}` : '')).join('\n');
  }
  return JSON.stringify(data, null, 2);
}
