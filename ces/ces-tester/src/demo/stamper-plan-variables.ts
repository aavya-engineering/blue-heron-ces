// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M4 — seeding the plan variables the GUI leg's STRICT resolver
 * demands and the Muster manifest can never supply.
 *
 * Why this exists (docs/context/M2-ENTRY-FINDINGS.md, verified from
 * ../ces-stamper source, read-only):
 *
 * - The GUI execute route builds a real `ExecutionContext` for any non-`dev`
 *   tenant (`execute.routes.ts:216-223`), and `ExecutionContext.resolve()`
 *   (`ExecutionContext.ts:99-120`) THROWS `Unresolved manifest variables: ...`
 *   for any `variables_required` name it cannot find. The CLI leg never builds
 *   one and falls back to a lenient interpolator that leaves `{approverUPN}`
 *   in the command as literal text — which is why the CLI's "100/110 completed"
 *   always contained ~20 false passes. The GUI's 30/110 is the truthful count.
 * - 18 manifest names plus 2 producer-less runtime names are simply absent from
 *   the plan. `ManifestReader.generateVariables` (`ManifestReader.ts:202-257`)
 *   could never supply them — they are operator/deployment parameters Muster's
 *   wizards do not collect.
 * - The product's intended source is the tenant variable store, and
 *   `PlanTranslator.ts:366-380` makes that store the HIGHEST-PRIORITY base of
 *   the translate-time merge, so seeded keys land inside `plan.variables`
 *   itself and the plan becomes self-contained. Hence: seed BEFORE Translate.
 *
 * Values are sim-plausible and grounded, not invented:
 * - UPNs are real seeded users of the `demo-dib-small` stacksim scenario
 *   (`tenant-stacksim/scenarios/demo-dib-small.json` PATCHes `user-1..13` onto
 *   the `ridgelinefab.onmicrosoft.us` domain), so `Get-MgUser -Filter` resolves.
 * - `cuiGroupName` is the well-known seeded group `CUI-Authorized-Users`
 *   (`tenant-stacksim/src/seed/generators/identity.ts` `generateGroups`, whose
 *   first group is named exactly that so EO's `displayName eq` filter matches).
 *   NOTE the sim's own `SimTenantConfig.resources.cui_group_name` still reads
 *   `Sim Group 1` — that value is STALE against the generator; the generator
 *   wins because it is what the store actually contains.
 * - Azure/name values follow the sim's own conventions from
 *   `tenant-stacksim/src/config/SimTenantConfig.ts:65-100,146-155`
 *   (`sim-sub-<slug>`, `sim-rg-<slug>`, `usgovvirginia`, `sim-law-1`,
 *   `10.10.0.0/24`, `sim-terms-of-use.pdf`, `sim-roleDefId`) and its resource
 *   generators (`sim-vnet-1` @ `10.0.0.0/16`, `simstorage1`).
 *
 * Nothing here is a fabricated "after": seeding removes a resolver failure that
 * was masking real execution, it does not assert anything about the outcome.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The 18 manifest variables the M0/M2 GUI execute reported as
 * `Unresolved manifest variables` (union across 23 failed tasks).
 */
export const PLAN_VARIABLE_MANIFEST_NAMES: readonly string[] = [
  'approverUPN',
  'roleDefId',
  'operatorUPN',
  'breakGlassUPN',
  'subscriptionId',
  'resourceGroup',
  'location',
  'vmName',
  'vnetName',
  'vnetCidr',
  'storageAccountName',
  'lawWorkspaceName',
  'securityEmail',
  'cisoEmail',
  'cuiGroupName',
  'approvedIpRange',
  'touFileName',
  'touFileBase64',
  // GP-DEMO-3 M7 (measured in the first post-seed live execute, run m7-run1b):
  // two more manifest names the plan requires and no producer supplies —
  // `keyVaultName` (AZ key-vault provisioning, `BaselineProvisioner.ts:14,94`)
  // and `mgmtSubnetCidr` (`AZ-NET-002`'s `snet-mgmt` address prefix). Both are
  // pure creation parameters, so a seeded value cannot point at a wrong object.
  'keyVaultName',
  'mgmtSubnetCidr',
  // Three more surfaced by run `m7-run2` — each became REACHABLE only once the
  // names above resolved, which is the shape of this whole class: the plan is
  // under-specified in layers. All three are `New-Az*` CREATION parameters with
  // no producer capture anywhere (`AZ-NET-003`'s `snet-workload` prefix and
  // `AZ-VM-001`'s `-Image` / `-Size`), so a seeded value cannot name a wrong
  // object.
  'workloadSubnetCidr',
  'vmImage',
  'vmSize',
  // The rest of the gap, ENUMERATED from the two Stamper registries rather than
  // discovered one live run at a time: every `variables_required` name that no
  // entry's `captures` produces and this plan actually interpolates. Seeding
  // them together is what stops the "each fix reaches one layer deeper" loop.
  // (`adminUserName`, `initialPassword` and `wifiSsid` are in the same registry
  // gap but are NOT referenced by this plan, so they are deliberately left out —
  // and inventing a credential is not something a demo seed should do.)
  'appId',
  'tenantId',
  'tenantName',
  'primaryDomain',
  'eoAppDisplayName',
  'automationAccountName',
  'firewallName',
  'publicIpName',
  'cmkKeyName',
  'bastionSubnetCidr',
  'firewallSubnetCidr',
  'globalAdminRoleDefId',
  'privilegedRoleAdminDefId',
  'securityAdminRoleDefId',
  'complianceRoleId',
];

/**
 * Runtime variables whose capture can never run on this leg, so the variable
 * store is their only possible source (`ExecutionContext.ts:112-114` accepts a
 * store-supplied value for a runtime name).
 *
 * `breakGlassUserId` / `baselineTemplateId` have no producer capture anywhere in
 * the plan (M2-ENTRY-FINDINGS).
 *
 * **`operatorUserId` and `cuiGroupId` were added by GP-DEMO-3 M7, correcting M4's
 * assumption that "it has a producer" meant "the producer runs".** The live
 * execute (run `m7-run1b`) shows both producers structurally skipped inside the
 * SAME task, before the strict resolver throws:
 *
 *   [1/11] AC.L2-3.1.1.operator-discover — evidence-only (no set_command)
 *   [2/11] AC.L2-3.1.1.group-create      — engine=mgraph, phase=GET   <- idempotent skip
 *   [3/11] AC.L2-3.1.1.member-add        — engine=mgraph, phase=GET
 *   Error: Unresolved runtime variables: cuiGroupId, operatorUserId.
 *
 * `operator-discover` is evidence-only so its capture never runs at all, and
 * `group-create`'s SET is skipped because the sim seed already contains
 * `CUI-Authorized-Users`. Filed as REQ-STAMPER-SUBCOMMAND-CAPTURES-NOT-RUN.
 * The seeded values are READ FROM THE SIM'S OWN SEED, not guessed (see
 * `buildPlanVariableSeed`), and the merge is fill-missing-only, so a real
 * capture still wins whenever one lands.
 *
 * Deliberately still NOT seeded: `namedLocationId` and
 * `phishingResistantStrengthId`. Those objects are CREATED at runtime by the
 * plan itself, so a seeded id would point at an object that may not exist —
 * exactly the fabricated-state line the demo must not cross. They stay a
 * documented, pinned failure instead.
 */
export const PLAN_VARIABLE_RUNTIME_NAMES: readonly string[] = [
  'breakGlassUserId',
  'baselineTemplateId',
  'operatorUserId',
  'cuiGroupId',
];

/** All 20 names this module seeds. */
export const PLAN_VARIABLE_SEED_NAMES: readonly string[] = [
  ...PLAN_VARIABLE_MANIFEST_NAMES,
  ...PLAN_VARIABLE_RUNTIME_NAMES,
];

/** UPN/mail domain of the users `demo-dib-small` actually seeds. */
export const DEMO_SIM_USER_DOMAIN = 'ridgelinefab.onmicrosoft.us';

/** Plaintext behind `touFileBase64` — encoded at module init so it cannot be mistyped. */
export const TOU_NOTICE_TEXT =
  'CUI System Access Notice — access to this system is restricted to authorized users handling Controlled Unclassified Information.';

export interface PlanVariableSeedOptions {
  readonly slug: string;
  /** Defaults to the seeded scenario domain. */
  readonly userDomain?: string;
  /** Wins over every default — M5 supplies per-config values here. */
  readonly overrides?: Readonly<Record<string, string>>;
}

/**
 * Build the 20-name seed for a slug. Pure.
 *
 * Role mapping (from the scenario's own job titles): the Owner approves
 * privileged access, the MSP IT Administrator is the operator, and the
 * Programs Manager/FSO holds the emergency-access credential — realistic for a
 * 13-person shop and, more importantly, all three UPNs resolve against the sim.
 */
export function buildPlanVariableSeed(opts: PlanVariableSeedOptions): Record<string, string> {
  const domain = opts.userDomain ?? DEMO_SIM_USER_DOMAIN;
  const seed: Record<string, string> = {
    // Identity — seeded users of the scenario (user-1 / user-12 / user-2).
    approverUPN: `dana.okafor@${domain}`,
    operatorUPN: `ray.dominguez@${domain}`,
    breakGlassUPN: `marcus.bell@${domain}`,
    breakGlassUserId: 'user-2',
    // `/v1.0/users/user-12` in the scenario = Ray Dominguez, the MSP IT
    // Administrator this seed already names as `operatorUPN`.
    operatorUserId: 'user-12',
    // `generateGroups` names its FIRST group `CUI-Authorized-Users` and ids
    // groups `group-<i+1>` (tenant-stacksim/src/seed/generators/identity.ts:32-33).
    cuiGroupId: 'group-1',
    roleDefId: 'sim-roleDefId',
    cuiGroupName: 'CUI-Authorized-Users',
    // Azure — the sim's own naming conventions, slug-derived where the sim derives them.
    subscriptionId: `sim-sub-${opts.slug}`,
    resourceGroup: `sim-rg-${opts.slug}`,
    location: 'usgovvirginia',
    vmName: 'sim-vm-1',
    vnetName: 'sim-vnet-1',
    vnetCidr: '10.0.0.0/16',
    storageAccountName: 'simstorage1',
    lawWorkspaceName: 'sim-law-1',
    // `SimTenantConfig.ts:100` — `.../Microsoft.KeyVault/vaults/sim-kv-1`.
    keyVaultName: 'sim-kv-1',
    // AZ-NET-002 adds `snet-mgmt` inside `vnetCidr` (10.0.0.0/16); the sim seeds
    // `Subnets: []` on purpose, so this is a creation parameter, not a lookup.
    mgmtSubnetCidr: '10.0.1.0/24',
    // AZ-NET-003 adds `snet-workload` in the same vnet — a second, distinct /24.
    workloadSubnetCidr: '10.0.2.0/24',
    // AZ-VM-001's `New-AzVM -Image … -Size …`. Standard Azure identifiers (the
    // sim models the call, not an image catalogue); creation parameters only.
    vmImage: 'Win2022AzureEditionCore',
    vmSize: 'Standard_D2s_v3',
    // Tenant identity as the SIM ITSELF reports it — `[SessionFactory] graph:
    // identity -- {"ClientId":"sim-app-<slug>","TenantId":"sim-tenant-<slug>"}`.
    appId: `sim-app-${opts.slug}`,
    tenantId: `sim-tenant-${opts.slug}`,
    tenantName: 'Ridgeline Fabrication',
    // Where `Get-MgUser` actually resolves (the scenario's own user domain).
    primaryDomain: domain,
    eoAppDisplayName: 'CES Evidence Ops',
    // Azure resource NAMES, following the sim's `sim-<kind>-<n>` convention.
    automationAccountName: 'sim-automation-1',
    firewallName: 'sim-fw-1',
    publicIpName: 'sim-pip-1',
    cmkKeyName: 'cmmc-cmk',
    // Reserved-name subnets inside the same 10.0.0.0/16 vnet. Azure requires a
    // /26 minimum for both `AzureBastionSubnet` and `AzureFirewallSubnet`, and
    // neither overlaps snet-mgmt (10.0.1.0/24) or snet-workload (10.0.2.0/24).
    bastionSubnetCidr: '10.0.3.0/26',
    firewallSubnetCidr: '10.0.4.0/26',
    // Directory role-definition ids. The sim models ONE role-definition id
    // (`SimTenantConfig`'s `sim-roleDefId`, already used for `roleDefId`), so
    // every role-def name resolves to it rather than to an invented GUID.
    globalAdminRoleDefId: 'sim-roleDefId',
    privilegedRoleAdminDefId: 'sim-roleDefId',
    securityAdminRoleDefId: 'sim-roleDefId',
    complianceRoleId: 'sim-roleDefId',
    // Notification + policy inputs.
    securityEmail: `security@${domain}`,
    cisoEmail: `ciso@${domain}`,
    approvedIpRange: '10.10.0.0/24',
    touFileName: 'sim-terms-of-use.pdf',
    touFileBase64: Buffer.from(TOU_NOTICE_TEXT, 'utf8').toString('base64'),
    // Intune baseline template id — sim-scoped; the sim seeds no template
    // collection, and the value is only ever a URI path segment.
    baselineTemplateId: 'sim-baseline-template-1',
  };
  return { ...seed, ...(opts.overrides ?? {}) };
}

export interface PlanVariableMerge {
  readonly merged: Record<string, unknown>;
  /** Seed names that were absent and are now present. */
  readonly added: readonly string[];
  /** Seed names the store already had — left untouched. */
  readonly kept: readonly string[];
}

/**
 * Fill-missing-only merge. Pure. An existing value ALWAYS wins: the store is
 * operator/tenant-authored (Stamper's own `persistResolvedToTenantJson` follows
 * the same rule), and the 168-key mirror written at tenant setup must survive.
 */
export function mergePlanVariables(
  existing: Readonly<Record<string, unknown>>,
  seed: Readonly<Record<string, string>>,
): PlanVariableMerge {
  const merged: Record<string, unknown> = { ...existing };
  const added: string[] = [];
  const kept: string[] = [];
  for (const [name, value] of Object.entries(seed)) {
    const present = Object.prototype.hasOwnProperty.call(existing, name) && existing[name] !== undefined && existing[name] !== '';
    if (present) {
      kept.push(name);
    } else {
      merged[name] = value;
      added.push(name);
    }
  }
  return { merged, added, kept };
}

/** `{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/variables.json` — Stamper's own layout. */
export function tenantVariablesPath(pipelineRoot: string, slug: string): string {
  return path.join(pipelineRoot, 'Stamper', 'plan-data', slug, 'variables.json');
}

export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponseLike>;

export interface SeedPlanVariablesOptions {
  readonly slug: string;
  readonly seed: Readonly<Record<string, string>>;
  /** Stamper GUI base URL — the supported contract (`PUT /api/tenants/:slug/variables`). */
  readonly baseUrl?: string;
  /** Filesystem fallback target; also the only route when no `baseUrl` is given. */
  readonly variablesPath?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

export interface PlanVariableSeedResult {
  readonly route: 'api' | 'file';
  readonly added: readonly string[];
  readonly kept: readonly string[];
  /** Key count of the store after seeding — the 168-key mirror must not shrink. */
  readonly total: number;
  /** Set when the API route was attempted and failed before the file fallback ran. */
  readonly apiError?: string;
}

function asVariablesEnvelope(body: unknown): Record<string, unknown> {
  const envelope = body as { ok?: unknown; variables?: unknown } | null | undefined;
  if (envelope && typeof envelope === 'object' && envelope.variables && typeof envelope.variables === 'object') {
    return envelope.variables as Record<string, unknown>;
  }
  return {};
}

async function seedViaApi(opts: SeedPlanVariablesOptions, doFetch: FetchLike): Promise<PlanVariableSeedResult> {
  const url = `${opts.baseUrl!.replace(/\/+$/, '')}/api/tenants/${encodeURIComponent(opts.slug)}/variables`;
  const getRes = await doFetch(url);
  if (!getRes.ok) throw new Error(`GET ${url} -> ${getRes.status}`);
  const existing = asVariablesEnvelope(await getRes.json());

  const { merged, added, kept } = mergePlanVariables(existing, opts.seed);

  // PUT REPLACES the file (`variables.routes.ts` writes the body's `variables`
  // wholesale) — the GET/merge above is what stops it destroying the store.
  const putRes = await doFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables: merged }),
  });
  if (!putRes.ok) throw new Error(`PUT ${url} -> ${putRes.status}`);

  return { route: 'api', added, kept, total: Object.keys(merged).length };
}

function seedViaFile(variablesPath: string, seed: Readonly<Record<string, string>>, apiError?: string): PlanVariableSeedResult {
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(variablesPath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(variablesPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
    } catch {
      // A corrupt store is not a reason to lose the seed; start from empty.
      existing = {};
    }
  }
  const { merged, added, kept } = mergePlanVariables(existing, seed);
  fs.mkdirSync(path.dirname(variablesPath), { recursive: true });
  fs.writeFileSync(variablesPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return { route: 'file', added, kept, total: Object.keys(merged).length, apiError };
}

/**
 * Seed the tenant variable store, API-first.
 *
 * The GUI's `PUT /api/tenants/:slug/variables` is the supported contract and
 * keeps ces-tester off Stamper's private disk layout; the filesystem fallback
 * writes the same file with the same merge semantics when the route is
 * unavailable. Both are invisible setup, not a demo surface.
 */
export async function seedPlanVariables(opts: SeedPlanVariablesOptions): Promise<PlanVariableSeedResult> {
  const doFetch = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  if (opts.baseUrl) {
    try {
      return await seedViaApi(opts, doFetch);
    } catch (err) {
      const apiError = err instanceof Error ? err.message : String(err);
      if (!opts.variablesPath) throw err;
      return seedViaFile(opts.variablesPath, opts.seed, apiError);
    }
  }
  if (!opts.variablesPath) throw new Error('seedPlanVariables needs a baseUrl or a variablesPath');
  return seedViaFile(opts.variablesPath, opts.seed);
}
