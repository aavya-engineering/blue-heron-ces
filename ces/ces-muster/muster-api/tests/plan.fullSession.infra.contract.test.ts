// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W4-MU1 acceptance (MS-R7, PLAN-3 M3): a FULL interview session for an
// m365_azure enclave — every question-graph node answered, including the new
// Tenant Config Profile plan inputs — runs through the production session
// driver and compilePlanForSession, and the Infrastructure Manifest it emits
// parses with the canonical ces-shared InfraManifestSchema (the full Azure
// body: identity / logging / security / storage / network / automation /
// diagnostics + Stamper's variable map).
//
// Also proves: removing a required body field makes the same schema reject it;
// an m365_only session without TCP input still produces NO infra manifest and
// NO TCP (pre-M3 behaviour kept); and the TCP itself validates against
// Planner's own JSON schema (CES TCP Tenant Config Profile.schema.json).
import 'fake-indexeddb/auto';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { InfraManifestSchema, STAMPER_PROVISIONING_REQUIRED_VARIABLES } from 'ces-shared/types/mission-plan';
import { POLICY_ANSWERS } from './helpers/policyAnswers';

const SPA_ROOT = path.resolve(__dirname, '../..');

vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('@/features/plan/__tests__/planTestSupport');
  const banks = loadBanks(SPA_ROOT);
  return {
    loadCompilerBanks: async () => banks,
    _resetCompilerBanksCache: () => {},
  };
});

const { createSession, answer, completeInterview } = await import('@/driver/sessionDriver');
const { loadQuestionGraph } = await import('@/features/interview/questionGraphService');
const { compilePlanForSession } = await import('@/features/plan/planCompileService');
const { parsePlanInputAnswer } = await import('@/features/interview/siPlanInputNodes');
const { rrActivityAnswers, withoutLegacyReadiness } = await import('./helpers/readinessAnswers');
type PlanCompileResult = Awaited<ReturnType<typeof compilePlanForSession>>;

const STACKS = ['Microsoft 365', 'microsoft_intune', 'microsoft_sentinel'];

const READINESS: Record<string, string> = {
  'iam-001': 'yes', 'iam-002': 'no', 'iam-003': 'yes', 'iam-004': 'no', 'iam-005': 'unknown',
  'ep-001': 'yes', 'ep-002': 'no', 'ep-003': 'yes', 'ep-004': 'no',
  'pol-001': 'yes', 'pol-002': 'no', 'pol-003': 'no', 'pol-004': 'yes',
  'mon-001': 'no', 'mon-002': 'yes', 'mon-003': 'no', 'mon-004': 'unknown',
  'dp-001': 'yes', 'dp-002': 'no', 'dp-003': 'yes', 'dp-004': 'no',
  'ir-001': 'no', 'ir-002': 'yes', 'ir-003': 'no', 'ir-004': 'yes',
  'bnd-001': 'yes', 'bnd-002': 'unsure', 'bnd-003': 'no',
};

const SI_AZURE: Record<string, string> = {
  'G-01': 'L2', 'G-02': 'cui_present', 'G-05': 'certification', 'G-07': 'single_enclave',
  'G-08': 'hybrid', 'S-12': 'teams_first', 'S-13': 'allowed_mdm', 'S-16': 'c3pao_ready',
  'S-20': 'gcc_high', 'SIT-020': 'm365_azure', 'SIT-021': 'g5', 'S-24': 'poam_if_allowed',
  // FC-MU (MU-10): the six operations postures, now live enum nodes
  'S-25': 'company_managed_only', 'S-26': 'no_wireless', 'S-27': 'blocked', 'S-28': 'cloud_native',
  'S-29': 'no_nonlocal', 'S-30': 'browser_only',
  // FC-MU (MU-10): the non-enum SIT residue, asked through typed inputs
  'G-03': 'CTI', 'G-04': 'none beyond CUI', 'G-06': 'ASAP', 'S-11': '25', 'SIT-022': '25',
  'SIT-023': 'FR1234567890', 'SIT-024': '1', 'SIT-025': '0',
};

const TCP: Record<string, string> = {
  'TCP.TI.004': 'gcc_high',
  'TCP.LIC.001': 'm365_g5',
  'TCP.IA.004': 'hybrid_ad_connect',
  'TCP.IA.005': 'yes',
  'TCP.PA.004': 'yes',
  'TCP.GA.004': 'mixed',
  'TCP.DM.001': 'hybrid_join',
  // MG-14: TCP tenant facts (typed) and the FX-11 operator values
  'TCP.TI.001': '00000000-0000-4000-8000-0000000000e1',
  'TCP.TI.002': 'enclave-fixture.example',
  'TCP.TI.003': 'enclave-fixture.example',
  'TCP.TI.005': 'Azure Enclave Fixture Co',
  'TCP.LIC.002': '35',
  'TCP.IA.001': 'breakglass1@enclave-fixture.example, breakglass2@enclave-fixture.example',
  'TCP.PA.001': 'admin@enclave-fixture.example',
  'TCP.PA.002': 'secadmin@enclave-fixture.example',
  'TCP.PA.003': 'complianceadmin@enclave-fixture.example',
  'TCP.GA.002': 'CUI-Authorized-Users, CMMC-Operators',
  'TCP.CA.003': '3',
  'TCP.DM.004': 'Windows, iOS/iPadOS',
  'TCP.MON.003': '00000000-0000-4001-8000-0000000000e1',
  'TCP.MON.004': 'Azure Active Directory, Microsoft 365',
  // W5c3: the bank's text / list TCP questions are typed nodes now.
  'TCP.LIC.003': 'IDENTITY_THREAT_PROTECTION',
  'TCP.LIC.004': 'Exchange Online, SharePoint Online, Teams, Intune',
  'TCP.IA.002': 'adm-{lastname}.{firstname}@{domain}',
  'TCP.IA.003': 'svc-{appname}@{domain}',
  'TCP.PA.005': 'SG-BreakGlass-Exclusion',
  'TCP.GA.001': 'SG-{Department}-{Function}',
  'TCP.GA.003': 'DL-{Department}',
  'TCP.CA.001': 'CA-{Number}-{Purpose}',
  'TCP.CA.002': 'Fixture Office|ip|192.0.2.0/24',
  'TCP.DM.002': 'FX-{Type}-{Number}',
  'TCP.DM.003': 'CP-{Platform}-{Level}',
  'TCP.DP.001': 'FX-{Classification}-{Handling}',
  'TCP.DP.002': 'https://fixture.sharepoint.us/sites/CUI',
  'TCP.DP.003': 'CUI Operations',
  'TCP.DP.004': 'DLP-{Scope}-{Action}',
  'TCP.MON.001': 'fixture-law-prod',
  'TCP.MON.002': 'fixture-rg-security',
  'TCP.MON.005': 'AR-{Severity}-{Source}-{Description}',
  // W5c2 content nodes (added to the fixture in W5c3).
  'PI.PER.009': 'Fixture Official | Authorizing Official | ao@fixture.example',
  'PI.PER.010': 'role held by the ISSO',
  'PI.PER.011': 'role held by the System Administrator',
  'PI.SYS.001': 'FX-SYS-001',
  'CUI.LC.VOL.001': 'About 1,000 files (4 GB); about 50 new files a month',
  'CUI.INT.004': 'Prime portal | ISA FX-ISA-01 | HTTPS browser upload | CUI',
  'TCP.MU.004': 'operator@enclave-fixture.example',
  'TCP.MU.005': '00000000-0000-4002-8000-0000000000e1',
  'TCP.MU.006': 'ENCLAVE-CORP',
  'TCP.MU.007': 'security@enclave-fixture.example',
};

// FC-MU-2 (MS-5): the provisioning intake nodes (well-formed answers; the
// file/secret flows themselves are proven in plan.fullSession.provisioning).
const PROVISIONING: Record<string, string> = {
  'TCP.MU.001': 'pim-approver@fixture.example',
  'TCP.MU.002': `file:terms.pdf;sha256:${'0'.repeat(64)}`,
  'TCP.MU.003': 'secretref:one-time:00000000-0000-4000-8000-000000000000',
};

// MG-08 / MG-10: the CUI boundary bindings Muster asks and the plan-mode confirm.
const BOUNDARY_AND_MODE: Record<string, string> = {
  'CUI.CONTRACT.001': 'Fixture contract FX-0001 (DFARS 252.204-7012)',
  'CUI.GEN.001': 'both',
  'CUI.GEN.002': 'Engineering, Program Management',
  'CUI.LC.ING.001': 'Encrypted email, Teams/SharePoint sharing',
  'CUI.LC.STO.001': 'SharePoint Online (GCC High), OneDrive (GCC High), Exchange mailboxes',
  'CUI.LC.PROC.001': 'Microsoft 365, SharePoint, Teams',
  'CUI.USR.002': '25',
  'CUI.DEV.002': 'yes',
  'CUI.INT.001': 'none',
  'CUI.OOS.001': 'Commercial tenant',
  // W5c7: the authoritative time source (Muster-only ODP).
  'PI.ODP.016': 'time.windows.com',
  // FIN-26: the sign-in frequency (note 42) and the AT.L2-3.2.2 role population (FD-9).
  'PI.ODP.017': '8',
  // FIN-32b: the 15 bank ODPs are optional nodes now (the bank's recommended values).
  'PI.ODP.001': '3',
  'PI.ODP.002': '15',
  'PI.ODP.003': '15',
  'PI.ODP.004': '14',
  'PI.ODP.005': '24',
  'PI.ODP.006': '60',
  'PI.ODP.007': '365',
  'PI.ODP.008': 'Monthly',
  'PI.ODP.009': '14',
  'PI.ODP.010': '30',
  'PI.ODP.011': 'Annually',
  'PI.ODP.012': '72',
  'PI.ODP.013': 'Quarterly',
  'PI.ODP.014': 'Daily',
  'PI.ODP.015': 'NIST SP 800-88 Purge',
  'PI.PER.012': 'Systems Administrator',
  // W5c4: the seven CUI bindings that are nodes now.
  'CUI.CAT.001': 'Controlled Technical Information (CTI)',
  'CUI.USR.001': 'Engineers, IT Admins',
  'CUI.DEVOPS.002': 'Azure DevOps (GCC High)',
  'CUI.INT.002': 'no',
  'CUI.INT.003': 'no',
  'CUI.BKP.001': 'm365_native',
  'CUI.ENF.001': 'Conditional Access, DLP policies',
  'PLAN.MODE.001': 'harden_existing',
  // MG-09: the BTC questions no discovery read evidences (plan/btc/btcGateNodes.ts).
  'BTC.ID.003': 'no_guests',
  'BTC.ID.004': 'yes',
  'BTC.DEV.003': 'yes',
  'BTC.DEVOPS.001': 'no',
  'BTC.DEVOPS.002': 'yes',
  'BTC.DEVOPS.003': 'yes',
  'BTC.INT.001': 'all_identified_and_approved',
  'BTC.INT.002': 'yes',
  'BTC.INT.003': 'yes',
  'BTC.INT.004': 'all_in_scope',
  'BTC.GOV.001': 'yes',
  'BTC.GOV.002': 'yes',
  'BTC.GOV.003': 'yes',
  'BTC.GOV.004': 'yes',
  // MG-16: the Policy Inputs questions (interview/policyInputNodes.ts).
  ...POLICY_ANSWERS,
};

async function runSession(
  answers: Record<string, string>,
  opts: { requireEveryNode: boolean; stacks?: string[] }
): Promise<{ result: PlanCompileResult; engagementId: string }> {
  const stacks = opts.stacks ?? STACKS;
  const handle = await createSession('individual_contractor', {
    stacks,
    party: { name: 'Azure Enclave Fixture Co', on_prem_ot: 'no' },
  });
  const graph = await loadQuestionGraph(stacks);
  // MG-07: the asked RR activities take the answers given to the retired
  // readiness nodes they alias (tests/helpers/readinessAnswers.ts).
  answers = { ...withoutLegacyReadiness(answers), ...rrActivityAnswers(graph, answers) };
  if (opts.requireEveryNode) {
    const missing = graph.filter((n) => !(n.id in answers)).map((n) => n.id);
    expect(missing, 'fixture must answer every question-graph node').toEqual([]);
  }
  for (const node of graph) {
    const value = answers[node.id];
    if (value === undefined) continue;
    if (node.input) {
      expect(parsePlanInputAnswer(node.input, value).ok, `${node.id} answer must parse as ${node.input}`).toBe(true);
    } else {
      expect(node.options.map((o) => o.value), `${node.id} answer must be a valid option`).toContain(value);
    }
    await answer(handle, node.id, value);
  }
  await completeInterview(handle);
  return { result: await compilePlanForSession(handle.sessionId), engagementId: handle.engagementId };
}

let azure: PlanCompileResult;
let azureEngagementId: string;

beforeAll(async () => {
  const r = await runSession({ ...READINESS, ...SI_AZURE, ...TCP, ...PROVISIONING, ...BOUNDARY_AND_MODE }, { requireEveryNode: true });
  azure = r.result;
  azureEngagementId = r.engagementId;
});

describe('W4-MU1: full m365_azure session → Tenant Config Profile + Infra Manifest', () => {
  test('the Infra Manifest parses with the canonical ces-shared schema (full Azure body)', () => {
    const parsed = InfraManifestSchema.safeParse(azure.artifacts.infrastructureManifest);
    if (!parsed.success) console.error('Infra issues:', parsed.error.issues.slice(0, 10));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data.infrastructure;

    expect(parsed.data.ces.artifact).toBe('infrastructure_manifest');
    expect(parsed.data.ces.cesId).toBe(azureEngagementId);
    expect(body.infrastructure_model).toBe('m365_azure');
    // Non-vacuous: every Azure section is populated.
    for (const section of ['identity', 'logging', 'security', 'storage', 'network', 'automation', 'diagnostics'] as const) {
      expect(body[section].length, `${section} resources`).toBeGreaterThan(0);
    }
    // TCP answers flowed through: gov cloud -> usgovvirginia; the Stamper
    // variable map is fully populated for the variables Stamper requires.
    const vm = body.stamper_variable_map;
    expect(vm.location).toBe('usgovvirginia');
    for (const k of ['subscriptionId', 'resourceGroup', 'lawWorkspaceName', 'eoAppDisplayName', 'storageAccountName', 'keyVaultName', 'vnetName', 'vnetCidr'] as const) {
      expect(vm[k], k).toBeTruthy();
    }
    // Network block comes from the generator's convention, with provenance.
    expect(body.provenance.some((p) => p.field.startsWith('network'))).toBe(true);
  });

  // ces-shared REQ-ces-muster-infra-manifest-emit (W4-SH2) acceptance, on the
  // full-session output AND on the committed golden Stamper consumes.
  test('emits the shape Stamper provisions from: canonical key, required variables, canonical subnets', () => {
    const golden = JSON.parse(
      fs.readFileSync(path.join(SPA_ROOT, 'src/features/plan/__fixtures__/infrastructure-manifest.json'), 'utf8')
    );
    for (const [name, m] of [['full session', azure.artifacts.infrastructureManifest], ['golden', golden]] as const) {
      const im = m as { infrastructure?: Record<string, unknown>; infrastructure_manifest?: unknown; ces: { generated_on: string } };
      expect(im.infrastructure, `${name}: keyed infrastructure`).toBeDefined();
      expect(im.infrastructure_manifest, `${name}: no deprecated key`).toBeUndefined();
      expect(InfraManifestSchema.safeParse(im).success, `${name}: parses`).toBe(true);
      expect(new Date(im.ces.generated_on).toISOString(), `${name}: ISO date-time`).toBe(im.ces.generated_on);
      const body = im.infrastructure!;
      expect(body.infrastructure_model).toBe('m365_azure');
      const vm = body.stamper_variable_map as Record<string, string>;
      // FC-MU-4 step 1: the canonical list, imported from ces-shared 2.8.0
      // (`ces-shared/types/mission-plan`, re-exported since 2.5.0 via `export *`
      // — REQ-ces-shared-export-provisioning-vars.md) — no local copy.
      for (const k of STAMPER_PROVISIONING_REQUIRED_VARIABLES) {
        expect(vm[k], `${name}: ${k}`).toBeTruthy();
      }
      for (const k of ['mgmtSubnetCidr', 'workloadSubnetCidr', 'bastionSubnetCidr', 'firewallSubnetCidr']) {
        expect(vm[k], `${name}: ${k}`).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/);
      }
      for (const k of ['firewallName', 'publicIpName', 'vmName', 'vmImage', 'vmSize']) {
        expect(vm[k], `${name}: ${k}`).toBeTruthy();
      }
    }
  });

  test('the Infra Manifest and the TCP are listed on the Plan tab; defaults are listed honestly', () => {
    const kinds = azure.docs.map((d) => d.kind);
    expect(kinds).toEqual(['si-baseline', 'tenant-config', 'tenant-manifest', 'infra-manifest', 'mission-plan']);
    // W5c3: naming conventions are typed nodes (MG-14 had them as bank recommendations);
    // this full session answers them, so none is reported as defaulted.
    expect(azure.defaultedInputs.some((d) => d.startsWith('TCP TCP.DM.002:'))).toBe(false);
    // Interview-answered TCP questions are not.
    for (const id of Object.keys(TCP)) {
      expect(azure.defaultedInputs.some((d) => d.startsWith(`TCP ${id}:`)), id).toBe(false);
    }
  });

  test('the TCP carries the interview answers and validates against Planner’s TCP JSON schema', () => {
    const tcp = azure.artifacts.tenantConfig!;
    expect(tcp).not.toBeNull();
    expect(tcp.tenant_config.identity.cloud_environment).toBe('gcc_high');
    expect(tcp.tenant_config.identity.display_name).toBe('Azure Enclave Fixture Co');
    expect(tcp.tenant_config.licensing.primary_sku).toBe('Microsoft 365 G5');
    expect(tcp.tenant_config.identity_architecture.identity_provider).toBe('hybrid_ad_connect');
    expect(tcp.tenant_config.identity_architecture.directory_sync_enabled).toBe(true);
    expect(tcp.tenant_config.privileged_access.pim_enabled).toBe(true);
    expect(tcp.tenant_config.group_architecture.group_strategy).toBe('mixed');
    expect(tcp.tenant_config.device_management.enrollment_type).toBe('hybrid_join');

    const schema = JSON.parse(
      fs.readFileSync(path.join(SPA_ROOT, 'public/schemas/planner/CES TCP Tenant Config Profile.schema.json'), 'utf8')
    );
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    const ok = validate(tcp);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });

  test('the same schema rejects the Infra Manifest when a required field is removed', () => {
    const cases: Array<{ name: string; mutate: (m: any) => void; path: string }> = [
      { name: 'stamper_variable_map', mutate: (m) => delete m.infrastructure.stamper_variable_map, path: 'infrastructure.stamper_variable_map' },
      { name: 'ces.artifact', mutate: (m) => delete m.ces.artifact, path: 'ces.artifact' },
      { name: 'the body', mutate: (m) => delete m.infrastructure, path: 'infrastructure' },
    ];
    for (const c of cases) {
      const broken = structuredClone(azure.artifacts.infrastructureManifest) as any;
      c.mutate(broken);
      const parsed = InfraManifestSchema.safeParse(broken);
      expect(parsed.success, `infra without ${c.name} must fail`).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain(c.path);
      }
    }
  });

  // No declared stacks: SIT-020 is not derived (siDerivation), so the
  // interview answer is the infrastructure model. (Since FC-MU MU-10 an explicit
  // operator answer beats a derivation anyway — see plan.siBaseline.complete.)
  test('m365_sentinel with TCP input: the Sentinel-only Infra Manifest parses', async () => {
    const { result } = await runSession(
      { ...READINESS, ...SI_AZURE, 'SIT-020': 'm365_sentinel', ...TCP },
      { requireEveryNode: false, stacks: [] }
    );
    const parsed = InfraManifestSchema.safeParse(result.artifacts.infrastructureManifest);
    if (!parsed.success) console.error('Infra issues:', parsed.error.issues.slice(0, 10));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.infrastructure.infrastructure_model).toBe('m365_sentinel');
    expect(parsed.data.infrastructure.logging.map((r) => r.resource_type)).toEqual([
      'resource_group',
      'log_analytics_workspace',
      'sentinel_onboarding',
    ]);
    expect(parsed.data.infrastructure.network).toEqual([]);
  });

  test('m365_only without TCP input: no TCP, no Infra Manifest (pre-M3 plan kept)', async () => {
    const { result } = await runSession(
      { ...READINESS, ...SI_AZURE, 'SIT-020': 'm365_only' },
      { requireEveryNode: false, stacks: [] }
    );
    expect(result.artifacts.tenantConfig).toBeNull();
    expect(result.artifacts.infrastructureManifest).toBeNull();
    expect(result.docs.map((d) => d.kind)).toEqual(['si-baseline', 'tenant-manifest', 'mission-plan']);
  });
});
