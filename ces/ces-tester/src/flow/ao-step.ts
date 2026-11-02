// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W2 (PLAN §3, E5 / E6X / E7A): AdminOps (AO) in the loop, as pure functions plus one injectable
 * CLI seam, so the step sequencing is unit-tested without AO, the sim or a server.
 *
 * - E5: the registry record `sim-tenant-<slug>` gains `resources.*` copied from the pushed TM `tenant_identity`
 *   (snake_case keys AO's SourceBindings read) and the keys the scenario's ops name that the harness discovers from the
 *   simulator (a read, never typed). Every key carries a provenance.
 * - E6X: the scenario's `drift_injection` sim writes (S3 only; empty elsewhere, the step passes trivially).
 * - E7A: each op of `adminops_ops`, in order, through AO's CLI (`<ces>/ces-ao/dist/cli/index.js`), AO unchanged:
 *     T2: `exec` (dry run), then `exec --apply`;
 *     T3 with two-person approval ON (`CES_TWO_PERSON_APPROVAL=1` in the AO env): `exec` (writes
 *         blocked_pending_approval, returns an approval id), `approve <id>` by a second principal the harness mints
 *         (HS256, role ao-approver, tid = the registry tenant id), then `exec --approval <id> --apply`;
 *     T3 with two-person approval OFF (the default, founder ruling 2026-10-31): the T2 sequence, no approver.
 *   Every exec passes `--requestor` (the operator principal, `resources.operator_upn`). Every `--param` value is read from
 *   the registry record. The approver token and the per-run principal secret live only in the AO child env.
 */
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResolveRequestBody } from '../stacksim-client/types.js';
import type { ExpectedStateCheck } from '../verifier/expectedState.js';

// ---------- scenario fields (musterE2eFile.ts re-exports these types) ----------

export interface AdminOpsOpSpec {
  /** AO registry command id, e.g. "A-02". */
  op: string;
  /** AO separation-of-duties tier: T2 = single person, T3 = two-person approval. */
  tier: 'T2' | 'T3';
  /** read = evidence-only op; write = a state change with a paired confirming read. */
  kind: 'read' | 'write';
  description?: string;
  /** `--param <name>=<value>`: name -> registry record path (`resources.<key>`). Never a literal value. */
  params?: Record<string, string>;
  /** Write ops: the simulator read that must show the new state after the apply (V46). `{resources.<key>}` is substituted. */
  confirm?: ExpectedStateCheck;
}

export interface ExpectedImprovement {
  controlId: string;
  /** The op expected to move it. */
  op: string;
  from?: string;
  to?: string;
  note?: string;
}

export interface AllowedRevert {
  objectType: string;
  objectId?: string;
  /** Controls the forced run (E8F) may then regress, beyond SC.L2-3.13.15 (V43a). */
  controls?: string[];
  reason: string;
}

export interface DriftInjection {
  description?: string;
  request: { kind: 'uri'; method: 'PATCH' | 'POST' | 'DELETE'; uri: string; body?: unknown };
}

// ---------- E5: registry record resources ----------

/** TM `tenant_identity` key -> registry `resources.<key>` (the snake_case keys `ces-ao` SourceBindings.ts reads). */
export const TM_TO_RESOURCES: Record<string, string> = {
  operatorUPN: 'operator_upn',
  breakGlassUPN: 'breakglass_upn',
  breakGlassUserId: 'breakglass_user_id',
  approverUPN: 'approver_upn',
  roleDefId: 'global_admin_role_def_id',
};

/** Muster's provenance words -> the harness's (Muster writes "asked" for an answered value). */
const PROVENANCE_WORD: Record<string, string> = { asked: 'answered', answered: 'answered', discovered: 'discovered', derived: 'derived' };

export interface RegistryResources {
  resources: Record<string, string>;
  provenance: Record<string, string>;
}

/** The TM-copied resources, with each value's provenance from `tenant_identity.operator_value_provenance.values`. */
export function resourcesFromTm(tenantIdentity: Record<string, unknown> | null | undefined): RegistryResources {
  const out: RegistryResources = { resources: {}, provenance: {} };
  if (!tenantIdentity) return out;
  const prov = ((tenantIdentity.operator_value_provenance as { values?: Record<string, unknown> } | undefined)?.values ?? {}) as Record<string, unknown>;
  for (const [tmKey, resKey] of Object.entries(TM_TO_RESOURCES)) {
    const v = tenantIdentity[tmKey];
    if (typeof v !== 'string' || v === '' || /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(v)) continue;
    out.resources[resKey] = v;
    const p = typeof prov[tmKey] === 'string' ? (prov[tmKey] as string) : 'unknown';
    out.provenance[resKey] = `tm:${tmKey} (${PROVENANCE_WORD[p] ?? p})`;
  }
  return out;
}

/** The `resources.<key>` keys an op list reads (its `params` values and its confirm templates). */
export function resourceKeysNamed(ops: AdminOpsOpSpec[]): string[] {
  const keys = new Set<string>();
  for (const o of ops) {
    for (const p of Object.values(o.params ?? {})) if (p.startsWith('resources.')) keys.add(p.slice('resources.'.length));
    for (const m of JSON.stringify(o.confirm ?? {}).matchAll(/\{resources\.([a-z0-9_]+)\}/g)) keys.add(m[1]!);
  }
  return [...keys].sort();
}

/** W7-TST: what a pick may read besides its own rows: the record's resources so far (TM keys) and the `joins` reads' rows. */
export interface DiscoverContext {
  resources: Record<string, string>;
  /** Rows of each `joins` read, in the same order. */
  joined: Array<Array<Record<string, unknown>>>;
}

export interface Discoverer {
  /** The simulator read (through `/resolve`) the value is taken from. */
  request: ResolveRequestBody;
  /** W7-TST: further simulator reads the pick joins against (e.g. the users behind role assignments). */
  joins?: ResolveRequestBody[];
  /** Picks the value from the read's rows; undefined when the tenant has none. */
  pick: (rows: Array<Record<string, unknown>>, nowMs: number, ctx?: DiscoverContext) => string | undefined;
  describe: string;
}

/** Entra's built-in lifecycle-workflow tasks "Disable user account" and "Delete user account" (platform constants). */
const LCW_ACCOUNT_REMOVAL_TASK_IDS = ['1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950', '8d18588d-9ad3-4c0f-99d0-ec215f0e3dff'];
/** Built-in Global Administrator role template id (platform constant), when the TM gives no role id. */
const GLOBAL_ADMIN_TEMPLATE_ID = '62e90394-69f5-4237-9190-012177145e10';
const lc = (v: unknown): string => String(v ?? '').toLowerCase();
const isCesObject = (v: unknown): boolean => /^CMMC-/i.test(String(v ?? ''));

/** W7-TST: the enabled, licensed users holding a standing tenant-wide GA assignment, neither break-glass nor the operator (by UPN). */
function standingAdmins(rows: Array<Record<string, unknown>>, ctx?: DiscoverContext): Array<Record<string, unknown>> {
  const res = ctx?.resources ?? {};
  const ga = res.global_admin_role_def_id ?? GLOBAL_ADMIN_TEMPLATE_ID;
  const users = ctx?.joined[0] ?? [];
  const principals = new Set(
    rows
      .filter((a) => a.roleDefinitionId === ga && (a.directoryScopeId === undefined || a.directoryScopeId === '/'))
      .map((a) => String(a.principalId ?? ''))
      .filter((p) => p !== '' && p !== res.breakglass_user_id),
  );
  return users
    .filter((u) => principals.has(String(u.id ?? '')))
    .filter((u) => u.accountEnabled === true && Array.isArray(u.assignedLicenses) && u.assignedLicenses.length > 0)
    .filter((u) => typeof u.userPrincipalName === 'string' && u.userPrincipalName !== '')
    .filter((u) => lc(u.userPrincipalName) !== lc(res.operator_upn) && lc(u.userPrincipalName) !== lc(res.breakglass_upn))
    .sort((a, b) => String(a.userPrincipalName).localeCompare(String(b.userPrincipalName)));
}

/** W7-TST: customer (non-`CMMC-`) CA policies whose user exclusions lack the break-glass account, by displayName. */
function caPoliciesMissingBreakGlass(rows: Array<Record<string, unknown>>, ctx?: DiscoverContext): string[] {
  const bg = ctx?.resources.breakglass_user_id;
  if (!bg) return [];
  return rows
    .filter((p) => typeof p.displayName === 'string' && p.displayName !== '' && !isCesObject(p.displayName))
    .filter((p) => {
      const ex = ((p.conditions as { users?: { excludeUsers?: unknown } } | undefined)?.users?.excludeUsers ?? []) as unknown;
      return !(Array.isArray(ex) && ex.includes(bg));
    })
    .map((p) => p.displayName as string)
    .sort((a, b) => a.localeCompare(b));
}

/** W7-TST: the first customer (non-`CMMC-`) app-protection policy id of a list read. */
const firstCustomerPolicyId = (rows: Array<Record<string, unknown>>): string | undefined =>
  rows
    .filter((p) => typeof p.id === 'string' && p.id !== '' && !isCesObject(p.displayName))
    .map((p) => p.id as string)
    .sort((a, b) => a.localeCompare(b))[0];

/**
 * Keys the harness discovers from the simulator because the TM does not carry them. `offboard_upn`: the enabled member
 * whose Entra `employeeLeaveDateTime` has passed (a leaver whose account is still on), oldest leave date first.
 * W7-TST: `leaver_workflow_id` (A-21; throws when none: A-21 fails unless the bound id is such a leaver),
 * `standing_admin_id` / `standing_admin_upn` (A-10), `breakglass_ca_policy_1` / `_2` (A-19, displayNames),
 * `android_app_protection_policy_id` / `ios_app_protection_policy_id` (B-09).
 */
export const DISCOVERERS: Record<string, Discoverer> = {
  offboard_upn: {
    request: { kind: 'uri', method: 'GET', uri: '/v1.0/users' },
    describe: 'GET /v1.0/users: accountEnabled true and employeeLeaveDateTime in the past (oldest first)',
    pick: (rows, nowMs) =>
      rows
        .filter((u) => u.accountEnabled === true && typeof u.employeeLeaveDateTime === 'string' && Date.parse(u.employeeLeaveDateTime as string) <= nowMs)
        .sort((a, b) => String(a.employeeLeaveDateTime).localeCompare(String(b.employeeLeaveDateTime)) || String(a.userPrincipalName).localeCompare(String(b.userPrincipalName)))
        .map((u) => u.userPrincipalName)
        .find((v): v is string => typeof v === 'string' && v !== ''),
  },
  leaver_workflow_id: {
    request: { kind: 'uri', method: 'GET', uri: '/v1.0/identityGovernance/lifecycleWorkflows/workflows' },
    describe: 'GET /v1.0/identityGovernance/lifecycleWorkflows/workflows: category leaver, isEnabled true, an enabled disable/delete-user-account task (by built-in task id or name; lowest id first)',
    pick: (rows) => {
      const id = rows
        .filter((w) => w.category === 'leaver' && w.isEnabled === true)
        .filter((w) =>
          (Array.isArray(w.tasks) ? (w.tasks as Array<Record<string, unknown>>) : []).some(
            (t) => t.isEnabled !== false && (LCW_ACCOUNT_REMOVAL_TASK_IDS.includes(lc(t.taskDefinitionId)) || /\b(disable|delete)\s+user\s+account\b/i.test(String(t.displayName ?? ''))),
          ),
        )
        .map((w) => w.id)
        .filter((v): v is string => typeof v === 'string' && v !== '')
        .sort((a, b) => a.localeCompare(b))[0];
      if (id === undefined) throw new Error('leaver_workflow_id: the tenant has no enabled leaver lifecycle workflow with a disable/delete-user-account task; A-21 cannot be bound');
      return id;
    },
  },
  standing_admin_id: {
    request: { kind: 'uri', method: 'GET', uri: '/v1.0/roleManagement/directory/roleAssignments' },
    joins: [{ kind: 'uri', method: 'GET', uri: '/v1.0/users' }],
    describe: 'GET /v1.0/roleManagement/directory/roleAssignments joined to GET /v1.0/users: a standing tenant-wide Global Administrator assignment of an enabled, licensed user that is neither resources.breakglass_* nor resources.operator_upn (first by UPN); its id',
    pick: (rows, _now, ctx) => standingAdmins(rows, ctx).map((u) => u.id).find((v): v is string => typeof v === 'string' && v !== ''),
  },
  standing_admin_upn: {
    request: { kind: 'uri', method: 'GET', uri: '/v1.0/roleManagement/directory/roleAssignments' },
    joins: [{ kind: 'uri', method: 'GET', uri: '/v1.0/users' }],
    describe: 'GET /v1.0/roleManagement/directory/roleAssignments joined to GET /v1.0/users: a standing tenant-wide Global Administrator assignment of an enabled, licensed user that is neither resources.breakglass_* nor resources.operator_upn (first by UPN); its UPN',
    pick: (rows, _now, ctx) => standingAdmins(rows, ctx).map((u) => u.userPrincipalName as string)[0],
  },
  breakglass_ca_policy_1: {
    request: { kind: 'uri', method: 'GET', uri: '/v1.0/identity/conditionalAccess/policies' },
    describe: 'GET /v1.0/identity/conditionalAccess/policies: the 1st customer (non-CMMC-) policy by displayName whose excludeUsers lacks resources.breakglass_user_id; its displayName',
    pick: (rows, _now, ctx) => caPoliciesMissingBreakGlass(rows, ctx)[0],
  },
  breakglass_ca_policy_2: {
    request: { kind: 'uri', method: 'GET', uri: '/v1.0/identity/conditionalAccess/policies' },
    describe: 'GET /v1.0/identity/conditionalAccess/policies: the 2nd customer (non-CMMC-) policy by displayName whose excludeUsers lacks resources.breakglass_user_id; its displayName',
    pick: (rows, _now, ctx) => caPoliciesMissingBreakGlass(rows, ctx)[1],
  },
  android_app_protection_policy_id: {
    request: { kind: 'uri', method: 'GET', uri: '/v1.0/deviceAppManagement/androidManagedAppProtections' },
    describe: 'GET /v1.0/deviceAppManagement/androidManagedAppProtections: the customer (non-CMMC-) policy (lowest id first)',
    pick: (rows) => firstCustomerPolicyId(rows),
  },
  ios_app_protection_policy_id: {
    request: { kind: 'uri', method: 'GET', uri: '/v1.0/deviceAppManagement/iosManagedAppProtections' },
    describe: 'GET /v1.0/deviceAppManagement/iosManagedAppProtections: the customer (non-CMMC-) policy (lowest id first)',
    pick: (rows) => firstCustomerPolicyId(rows),
  },
};

/** Rows of a `/resolve` read (an array, or a Graph `{ value: [] }` page). */
export function rowsOf(data: unknown): Array<Record<string, unknown>> {
  const v = data && typeof data === 'object' && Array.isArray((data as { value?: unknown }).value) ? (data as { value: unknown[] }).value : data;
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : [];
}

/** Merges `resources` into the registry record file (other fields untouched). */
export function writeRecordResources(recordFile: string, resources: Record<string, string>): void {
  const raw = JSON.parse(fs.readFileSync(recordFile, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
  raw.resources = { ...((raw.resources as Record<string, string> | undefined) ?? {}), ...resources };
  fs.writeFileSync(recordFile, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
}

// ---------- E7A: the sim tenant's certificate file ----------

/**
 * Run 36: every AO apply failed "Configuration validation failed: Certificate file not found at: sim/<slug>.pfx".
 * AO has no simulator or no-certificate auth mode: `createExecutionContext` (ces-ao `src/execution/AuthChain.ts`) checks,
 * before any live call and for the dry run's state reader too, that the tenant config's `certPath` exists on disk. The
 * ephemeral sim record ces-tenant writes names the relative `sim/<slug>.pfx`, which exists nowhere. On the sim the file
 * is never read (the stacksim shims answer every Connect-* call), so the harness makes a throwaway self-signed PFX per
 * run under `<WS>/out/ao/sim/<slug>.pfx` and points the record's `auth.cert_path` at it. The key is a CNG ephemeral key
 * made in memory (no Windows certificate store entry, no key container); the PFX password is random, lives only in the
 * PowerShell child's env and is dropped. The file is removed at the run's start and end; `<WS>/out` is in no repo.
 */
export const SIM_PFX_OUT_ENV = 'CES_SIM_PFX_OUT';
export const SIM_PFX_PASSWORD_ENV = 'CES_SIM_PFX_PASSWORD';

/** `<out>/ao/sim/<slug>.pfx`: the run's throwaway sim certificate. */
export function simCertPath(outDir: string, slug: string): string {
  return path.join(outDir, 'ao', 'sim', `${slug}.pfx`);
}

/** Windows PowerShell 5.1: a self-signed RSA-2048 certificate made in memory and exported as a PFX; prints the thumbprint. */
export const SIM_PFX_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$rsa = New-Object System.Security.Cryptography.RSACng(2048)',
  "$req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest('CN=ces-sim-throwaway', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)",
  '$now = [DateTimeOffset]::UtcNow',
  '$cert = $req.CreateSelfSigned($now.AddMinutes(-5), $now.AddDays(1))',
  `$bytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $env:${SIM_PFX_PASSWORD_ENV})`,
  `[System.IO.File]::WriteAllBytes($env:${SIM_PFX_OUT_ENV}, $bytes)`,
  'Write-Output $cert.Thumbprint',
  '$cert.Dispose(); $rsa.Dispose()',
].join('\n');

export type PowerShellRunner = (encodedCommand: string, env: NodeJS.ProcessEnv) => { rc: number; stdout: string; stderr: string };

export const windowsPowerShellRunner: PowerShellRunner = (encodedCommand, env) => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand], { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { rc: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error) : '') };
};

/** Makes the throwaway PFX at `pfxPath`; returns its path and thumbprint (never the password). */
export function makeSimPfx(pfxPath: string, run: PowerShellRunner = windowsPowerShellRunner): { path: string; thumbprint: string } {
  fs.mkdirSync(path.dirname(pfxPath), { recursive: true });
  fs.rmSync(pfxPath, { force: true });
  const password = crypto.randomBytes(24).toString('hex');
  const encoded = Buffer.from(SIM_PFX_SCRIPT, 'utf16le').toString('base64');
  const r = run(encoded, { ...process.env, [SIM_PFX_OUT_ENV]: pfxPath, [SIM_PFX_PASSWORD_ENV]: password });
  if (r.rc !== 0 || !fs.existsSync(pfxPath)) throw new Error(`sim PFX not made (rc ${r.rc}): ${r.stderr.trim().split(/\r?\n/)[0] ?? ''}`);
  return { path: pfxPath, thumbprint: r.stdout.trim().split(/\r?\n/).pop() ?? '' };
}

/** Points the registry record's `auth.cert_path` at the run's PFX (the other fields, the thumbprint included, are kept). */
export function writeRecordCertPath(recordFile: string, certPath: string): void {
  const raw = JSON.parse(fs.readFileSync(recordFile, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  raw.auth = { ...((raw.auth as Record<string, unknown> | undefined) ?? {}), cert_path: certPath };
  fs.writeFileSync(recordFile, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
}

// ---------- E7A: principals, env, calls ----------

/** The per-run HS256 secret AO verifies approver tokens with (>= 16 chars). Child env only. */
export function mintPrincipalSecret(): string {
  return crypto.randomBytes(24).toString('hex');
}

const b64url = (b: Buffer): string => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** An HS256 principal token in the shape ces-shared `signPrincipalToken` makes (sub, upn, roles, tid, iat, exp). */
export function mintPrincipalToken(claims: { upn: string; tid: string; roles?: string[] }, secret: string, nowMs: number = Date.now(), ttlSeconds = 3600): string {
  if (secret.length < 16) throw new Error('principal secret must be at least 16 characters');
  const iat = Math.floor(nowMs / 1000);
  const payload = { iat, exp: iat + ttlSeconds, sub: `sim-principal:${claims.upn}`, upn: claims.upn, roles: claims.roles ?? ['ao-approver'], tid: claims.tid, jti: crypto.randomUUID() };
  const head = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

export const AO_SECRET_ENV = 'CES_AO_PRINCIPAL_SECRET';
export const AO_TOKEN_ENV = 'CES_AO_PRINCIPAL_TOKEN';
/** W9-C1 (2P-H): AO's two-person switch (ces-ao SodGate.ts TWO_PERSON_APPROVAL_ENV). Default OFF. */
export const TWO_PERSON_APPROVAL_ENV = 'CES_TWO_PERSON_APPROVAL';

/** The two-person mode AO will apply, parsed as AO parses it (`1` or `true`, case-insensitive, means ON). */
export function twoPersonApprovalOn(env: NodeJS.ProcessEnv): boolean {
  const v = String(env[TWO_PERSON_APPROVAL_ENV] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** The env keys E7A sets for AO (values never recorded for the two secret ones). */
export const AO_ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_TENANT_ROOT', 'STACKSIM_SERVER_URL', 'PSModulePath', 'CES_AO_SIM_ONLY', AO_SECRET_ENV] as const;

/** PLAN §3 E7A environment: the sim launch env plus the harness pipeline and tenant roots, the sim-only rail and the secret. */
export function buildAoEnv(simEnv: NodeJS.ProcessEnv, o: { pipelineRoot: string; tenantRoot: string; simUrl: string; secret: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...simEnv, CES_PIPELINE_ROOT: o.pipelineRoot, CES_TENANT_ROOT: o.tenantRoot, STACKSIM_SERVER_URL: o.simUrl, CES_AO_SIM_ONLY: '1', [AO_SECRET_ENV]: o.secret };
  delete env.CES_AO_ALLOW_LIVE;
  delete env[AO_TOKEN_ENV];
  return env;
}

/**
 * W2 follow-up (per-run isolation of AO evidence): the env var on the EO server that bounds every AdminOps read to this
 * run (ces-eo `AdminOpsEvidenceReader` ADMINOPS_SINCE_ENV). `<WS>/pl/ces.db` is one SQLite file whose
 * `adminops_evidence` collection is append-only (ces-shared WORM, no scoped bulk delete), so the harness never deletes
 * rows: it passes the run start (E1's start) to EO at E7, and EO's status sources, CRM credit and C10 skip every row timed
 * before it. Six-year retention is a production property, not a simulator property: a real deployment sets no window.
 */
export const EO_ADMINOPS_SINCE_ENV = 'CES_EO_ADMINOPS_SINCE';

/** The EO env entry for the run window; refused when the run start is not an ISO time (it is E1's recorded start). */
export function eoAdminOpsWindowEnv(runStart: string | undefined): Record<string, string> {
  if (!runStart || !Number.isFinite(Date.parse(runStart))) throw new Error(`no run start for ${EO_ADMINOPS_SINCE_ENV} (E1 has not run)`);
  return { [EO_ADMINOPS_SINCE_ENV]: runStart };
}

export type AoCallKind = 'dry_run' | 'request' | 'approve' | 'apply';

export interface AoCliResult {
  rc: number;
  stdout: string;
  stderr: string;
}

/** Runs `node <ces-ao>/dist/cli/index.js <args>` with the given env; the run step supplies a spawn, tests a fake. */
export type AoCliRunner = (args: string[], env: NodeJS.ProcessEnv, label: string) => Promise<AoCliResult>;

/** The last top-level JSON object `--json` printed (AO may log other lines before it). */
export function parseAoJson(stdout: string): Record<string, any> | null {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== '{') continue;
    try {
      return JSON.parse(lines.slice(i).join('\n')) as Record<string, any>;
    } catch {
      /* not the start of the object */
    }
  }
  const t = stdout.trim();
  if (t.startsWith('{')) {
    try {
      return JSON.parse(t) as Record<string, any>;
    } catch {
      return null;
    }
  }
  return null;
}

export interface AoCallRecord {
  call: AoCallKind;
  /** argv after `node <ao cli>`; no secret ever appears in it (the token travels in the env). */
  argv: string[];
  rc: number;
  ok: boolean;
  success?: boolean;
  status?: string;
  outcome?: string;
  mode?: string;
  verdict?: string;
  approval_id?: string;
  evidence_row_id?: string;
  evidence_sha256?: string;
  evidence_persisted?: boolean;
  state_changed?: boolean;
  /** AO's recorded two-person mode for this call (`evidence.metadata.twoPersonApproval.mode`). */
  two_person_mode?: 'on' | 'off';
  detail?: string;
}

export interface AoParamRecord {
  name: string;
  from: string;
  value: string;
  provenance: string;
}

export interface AoOpRecord {
  op: string;
  tier: 'T2' | 'T3';
  kind: 'read' | 'write';
  params: AoParamRecord[];
  calls: AoCallRecord[];
  confirm?: { check: ExpectedStateCheck; pass: boolean; actual?: string };
  ok: boolean;
  detail?: string;
}

/** Reads `resources.<key>` (or any dotted path) from the registry record. */
export function recordValue(record: Record<string, unknown>, from: string): string | undefined {
  let cur: unknown = record;
  for (const part of from.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' && cur !== '' ? cur : undefined;
}

/** Substitutes `{resources.<key>}` in every string of a check (from the registry record). Throws on an unknown key. */
export function resolveCheck(check: ExpectedStateCheck, record: Record<string, unknown>): ExpectedStateCheck {
  const sub = (v: unknown): unknown => {
    if (typeof v === 'string') {
      return v.replace(/\{(resources\.[a-z0-9_]+)\}/g, (_m, p: string) => {
        const val = recordValue(record, p);
        if (val === undefined) throw new Error(`confirm check names ${p}, which the registry record does not carry`);
        return val;
      });
    }
    if (Array.isArray(v)) return v.map(sub);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
    return v;
  };
  return sub(check) as ExpectedStateCheck;
}

/** `exec` argv for one call. `--requestor` is always passed; `--json` always (the step parses it). */
export function execArgs(o: { op: string; slug: string; requestor: string; params: AoParamRecord[]; apply?: boolean; approvalId?: string }): string[] {
  const a = ['exec', o.op, '--tenant', o.slug, '--requestor', o.requestor];
  if (o.approvalId) a.push('--approval', o.approvalId);
  if (o.apply) a.push('--apply');
  for (const p of o.params) a.push('--param', `${p.name}=${p.value}`);
  a.push('--json');
  return a;
}

const rowIdOf = (evidencePath: unknown): string | undefined =>
  typeof evidencePath === 'string' && evidencePath.includes('/') ? evidencePath.slice(evidencePath.indexOf('/') + 1) : undefined;

/** Shapes one `exec --json` result into the run record's call row. */
export function summarizeExec(call: AoCallKind, argv: string[], r: AoCliResult): AoCallRecord {
  const j = parseAoJson(r.stdout);
  const ev = j?.evidence as Record<string, any> | undefined;
  const meta = (ev?.metadata ?? {}) as Record<string, any>;
  const rec: AoCallRecord = {
    call,
    argv,
    rc: r.rc,
    ok: false,
    ...(typeof j?.success === 'boolean' ? { success: j.success } : {}),
    ...(typeof j?.status === 'string' ? { status: j.status } : {}),
    ...(typeof ev?.outcome === 'string' ? { outcome: ev.outcome } : {}),
    ...(typeof meta.mode === 'string' ? { mode: meta.mode } : meta.dryRun === true ? { mode: 'dry_run' } : {}),
    ...(typeof ev?.complianceVerdict === 'string' ? { verdict: ev.complianceVerdict } : {}),
    ...(typeof j?.approvalId === 'string' ? { approval_id: j.approvalId } : {}),
    ...(rowIdOf(j?.evidencePath) ? { evidence_row_id: rowIdOf(j?.evidencePath) } : {}),
    ...(typeof meta.sha256Hash === 'string' ? { evidence_sha256: meta.sha256Hash } : {}),
    ...(typeof j?.evidencePersisted === 'boolean' ? { evidence_persisted: j.evidencePersisted } : {}),
    ...(typeof meta.stateChanged === 'boolean' ? { state_changed: meta.stateChanged } : {}),
    ...(meta.twoPersonApproval?.mode === 'on' || meta.twoPersonApproval?.mode === 'off' ? { two_person_mode: meta.twoPersonApproval.mode } : {}),
  };
  if (r.rc !== 0 || !j) {
    rec.detail = `rc ${r.rc}${j ? '' : ', no JSON result'}: ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-1)[0] ?? ''}`.slice(0, 300);
    return rec;
  }
  if (rec.evidence_persisted !== true) {
    rec.detail = 'evidence row not persisted';
    return rec;
  }
  if (call === 'dry_run') rec.ok = rec.mode === 'dry_run';
  else if (call === 'request') rec.ok = rec.status === 'pending_approval' && !!rec.approval_id;
  else rec.ok = rec.success === true && rec.mode !== 'dry_run' && rec.verdict === 'SAT';
  if (!rec.ok) rec.detail = `${call}: success ${rec.success}, status ${rec.status ?? '-'}, mode ${rec.mode ?? '-'}, outcome ${rec.outcome ?? '-'}, verdict ${rec.verdict ?? '-'}`;
  return rec;
}

export interface RunAoOpsInput {
  ops: AdminOpsOpSpec[];
  slug: string;
  /** The registry record as AO will read it (after E5). */
  record: Record<string, unknown>;
  /** `resources.<key>` -> provenance (E5). */
  provenance: Record<string, string>;
  env: NodeJS.ProcessEnv;
  runCli: AoCliRunner;
  /** Runs one confirm check against the sim (the run step: verifyExpectedState). */
  confirm: (check: ExpectedStateCheck) => Promise<{ pass: boolean; actual?: string }>;
  now?: () => number;
}

export interface RunAoOpsResult {
  requestor_upn: string | null;
  /** The T3 approver; null when two-person approval is OFF (no approver acts). */
  approver_upn: string | null;
  tenant_id: string | null;
  /** W9-C1 (2P-H): the two-person mode the harness ran T3 ops under (read from the AO env). */
  two_person_approval: 'on' | 'off';
  ops: AoOpRecord[];
  ok: boolean;
}

/**
 * Runs the ops in order. The requestor is `resources.operator_upn`; with two-person approval ON a T3 approver is
 * `resources.approver_upn`, minted as a second principal (it must differ from the requestor); with it OFF a T3 op runs
 * the T2 sequence. An op whose parameter is not on the record fails without calling AO: nothing is typed in its place.
 */
export async function runAoOps(i: RunAoOpsInput): Promise<RunAoOpsResult> {
  const requestor = recordValue(i.record, 'resources.operator_upn') ?? null;
  const approver = recordValue(i.record, 'resources.approver_upn') ?? null;
  const tenantId = recordValue(i.record, 'tenant.tenant_id') ?? null;
  const twoPersonOn = twoPersonApprovalOn(i.env);
  const ops: AoOpRecord[] = [];
  for (const spec of i.ops) {
    const rec: AoOpRecord = { op: spec.op, tier: spec.tier, kind: spec.kind, params: [], calls: [], ok: false };
    ops.push(rec);
    const missing: string[] = [];
    for (const [name, from] of Object.entries(spec.params ?? {})) {
      const value = recordValue(i.record, from);
      if (value === undefined) missing.push(`${name} <- ${from}`);
      else rec.params.push({ name, from, value, provenance: i.provenance[from.replace(/^resources\./, '')] ?? 'unknown' });
    }
    if (!requestor) missing.push('requestor <- resources.operator_upn');
    if (missing.length) {
      rec.detail = `not run: the registry record lacks ${missing.join(', ')}`;
      continue;
    }
    let confirmCheck: ExpectedStateCheck | undefined;
    try {
      confirmCheck = spec.confirm ? resolveCheck(spec.confirm, i.record) : undefined;
    } catch (e) {
      rec.detail = `not run: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }
    if (spec.kind === 'write' && !confirmCheck) {
      rec.detail = 'not run: a write op needs a confirm check (V46)';
      continue;
    }
    const call = async (kind: AoCallKind, argv: string[], env: NodeJS.ProcessEnv): Promise<AoCallRecord> => {
      const r = await i.runCli(argv, env, `${spec.op}-${kind}`);
      const c = summarizeExec(kind, argv, r);
      rec.calls.push(c);
      return c;
    };
    if (spec.tier === 'T2' || !twoPersonOn) {
      const d = await call('dry_run', execArgs({ op: spec.op, slug: i.slug, requestor: requestor!, params: rec.params }), i.env);
      if (!d.ok) { rec.detail = d.detail; continue; }
      const a = await call('apply', execArgs({ op: spec.op, slug: i.slug, requestor: requestor!, params: rec.params, apply: true }), i.env);
      if (!a.ok) { rec.detail = a.detail; continue; }
    } else {
      if (!approver || approver === requestor || !tenantId) {
        rec.detail = `not run: a T3 op needs resources.approver_upn different from the requestor and tenant.tenant_id (approver ${approver ? (approver === requestor ? 'equals the requestor' : 'set') : 'missing'})`;
        continue;
      }
      const q = await call('request', execArgs({ op: spec.op, slug: i.slug, requestor: requestor!, params: rec.params }), i.env);
      if (!q.ok) { rec.detail = q.detail; continue; }
      const secret = i.env[AO_SECRET_ENV];
      if (!secret) { rec.detail = `not run: ${AO_SECRET_ENV} absent from the AO env`; continue; }
      const token = mintPrincipalToken({ upn: approver, tid: tenantId }, secret, (i.now ?? Date.now)());
      const argv = ['approve', q.approval_id!];
      const r = await i.runCli(argv, { ...i.env, [AO_TOKEN_ENV]: token }, `${spec.op}-approve`);
      const approved: AoCallRecord = { call: 'approve', argv, rc: r.rc, ok: r.rc === 0 && /APPROVED/.test(r.stdout), ...(r.rc === 0 ? {} : { detail: (r.stderr || r.stdout).trim().slice(0, 300) }) };
      rec.calls.push(approved);
      if (!approved.ok) { rec.detail = approved.detail ?? 'approve: no APPROVED line'; continue; }
      const a = await call('apply', execArgs({ op: spec.op, slug: i.slug, requestor: requestor!, params: rec.params, apply: true, approvalId: q.approval_id }), i.env);
      if (!a.ok) { rec.detail = a.detail; continue; }
    }
    if (confirmCheck) {
      const c = await i.confirm(confirmCheck);
      rec.confirm = { check: confirmCheck, pass: c.pass, ...(c.actual !== undefined ? { actual: c.actual } : {}) };
      if (!c.pass) { rec.detail = `confirming read failed: ${c.actual ?? 'no value'}`; continue; }
    }
    rec.ok = true;
  }
  return { requestor_upn: requestor, approver_upn: twoPersonOn ? approver : null, tenant_id: tenantId, two_person_approval: twoPersonOn ? 'on' : 'off', ops, ok: ops.every((o) => o.ok) };
}

export const ADMINOPS_E7A_SCHEMA = 'ces-tester/adminops-e7a@1';

/** The AO CLI path relative to `<ws>/ces`. */
export const AO_CLI_REL = path.join('ces-ao', 'dist', 'cli', 'index.js');
