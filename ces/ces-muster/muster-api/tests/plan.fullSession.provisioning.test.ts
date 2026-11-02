// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU-2 (MS-5 live, founder decision 2026-09-27): Muster's Tenant Config
// intake asks for the three Stamper provisioning inputs no artifact produced —
// the PIM approver UPN, the terms-of-use file, and an initial password — and
// the Infrastructure Manifest carries them.
//
// A FULL m365_azure session runs through the production session driver (every
// question-graph node answered, the ToU file attached and the password
// generated through the SAME production functions the widgets call) and
// compilePlanForSession. The emitted Infra Manifest parses with ces-shared's
// InfraManifestSchema and carries:
//   - stamper_variable_map.approverUPN           (the UPN asked in the intake)
//   - stamper_variable_map.touFileName / touFileBase64 (the uploaded PDF)
//   - the initial password ONLY as a one-time secret reference, OUTSIDE the
//     variable map (secret_references[]) — Stamper maps initialPassword →
//     initial_password literally, so a reference there would become the password.
// The generated password itself appears nowhere: not in Dexie, not in any artifact.
import 'fake-indexeddb/auto';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import * as path from 'node:path';
import { InfraManifestSchema, TenantManifestSchema, ProvisioningInputsSchema } from 'ces-shared/types/mission-plan';
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

const { createSession, answer, completeInterview, attachTouFile, generateInitialPassword } = await import(
  '@/driver/sessionDriver'
);
const { loadQuestionGraph } = await import('@/features/interview/questionGraphService');
const { compilePlanForSession } = await import('@/features/plan/planCompileService');
const { parsePlanInputAnswer } = await import('@/features/interview/siPlanInputNodes');
const { PROVISIONING_NODE_IDS } = await import('@/features/interview/tcpProvisioningNodes');
const { db } = await import('@/shared/db/schema');
const { rrActivityAnswers, withoutLegacyReadiness } = await import('./helpers/readinessAnswers');

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
  'S-25': 'company_managed_only', 'S-26': 'no_wireless', 'S-27': 'blocked', 'S-28': 'cloud_native',
  'S-29': 'no_nonlocal', 'S-30': 'browser_only',
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

const APPROVER = 'pim-approver@enclave-fixture.example';
const TOU_NAME = 'Enclave Terms of Use.pdf';
// A tiny but real-looking PDF (the widget checks the %PDF- magic).
const TOU_BYTES = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');

let im: any;
let password: string;
let passwordRef: string;
let touRef: string;
let artifactsJson: string;
let dexieJson: string;
let defaulted: string[];

beforeAll(async () => {
  const handle = await createSession('individual_contractor', {
    stacks: STACKS,
    party: { name: 'Azure Enclave Fixture Co', on_prem_ot: 'no' },
  });
  const graph = await loadQuestionGraph(STACKS);
  // MG-07: the asked RR activities take the answers given to the retired
  // readiness nodes they alias (tests/helpers/readinessAnswers.ts).
  const plain = {
    ...withoutLegacyReadiness({ ...READINESS, ...SI_AZURE, ...TCP, ...BOUNDARY_AND_MODE, [PROVISIONING_NODE_IDS.approverUpn]: APPROVER }),
    ...rrActivityAnswers(graph, READINESS),
  };

  for (const node of graph) {
    if (node.id === PROVISIONING_NODE_IDS.touFile) {
      touRef = await attachTouFile(handle, TOU_NAME, TOU_BYTES);
      continue;
    }
    if (node.id === PROVISIONING_NODE_IDS.initialPassword) {
      ({ password, ref: passwordRef } = await generateInitialPassword(handle));
      continue;
    }
    const value = plain[node.id];
    expect(value, `fixture must answer every question-graph node (${node.id})`).toBeDefined();
    if (node.input) {
      expect(parsePlanInputAnswer(node.input, value).ok, `${node.id} answer must parse as ${node.input}`).toBe(true);
    } else {
      expect(node.options.map((o) => o.value), `${node.id} answer must be a valid option`).toContain(value);
    }
    await answer(handle, node.id, value);
  }
  // The three provisioning inputs are real graph nodes of the TCP intake.
  for (const id of Object.values(PROVISIONING_NODE_IDS)) {
    const node = graph.find((n) => n.id === id);
    expect(node, id).toBeDefined();
    expect(node!.cluster).toBe('plan-input:tcp');
    expect(node!.mapped_requirements).toEqual([]);
  }

  await completeInterview(handle);
  const result = await compilePlanForSession(handle.sessionId);
  im = result.artifacts.infrastructureManifest;
  defaulted = result.defaultedInputs;
  artifactsJson = JSON.stringify(result.artifacts) + JSON.stringify(result.docs);
  dexieJson = JSON.stringify({
    sessions: await db.interview_sessions.toArray(),
    engagements: await db.engagements.toArray(),
    parties: await db.assessed_parties.toArray(),
  });
});

describe('FC-MU-2 MS-5: approver UPN, ToU file and initial password from the Muster intake', () => {
  test('the Infra Manifest parses under ces-shared and carries all three', () => {
    const parsed = InfraManifestSchema.safeParse(im);
    if (!parsed.success) console.error(parsed.error.issues.slice(0, 10));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data.infrastructure as any;
    const vm = body.stamper_variable_map;

    // 1. approver UPN — asked in the intake.
    expect(vm.approverUPN).toBe(APPROVER);
    // 2. terms-of-use file — the uploaded bytes, base64, with its name.
    expect(vm.touFileName).toBe(TOU_NAME);
    expect(Buffer.from(vm.touFileBase64, 'base64').equals(Buffer.from(TOU_BYTES))).toBe(true);
    // 3. initial password — the safe form: a one-time secret reference,
    //    OUTSIDE the variable map, never the value.
    expect(vm.initialPassword).toBeUndefined();
    expect(body.secret_references).toEqual([
      { variable: 'initialPassword', form: 'one_time_operator_held', ref: passwordRef },
    ]);
    expect(passwordRef).toMatch(/^secretref:one-time:[0-9a-f-]{36}$/);

    // Each value has a provenance row (source 'tcp'); the ToU row names the file, not its bytes.
    const prov = (f: string) => body.provenance.find((p: any) => p.field === f);
    expect(prov('stamper_variable_map.approverUPN')).toMatchObject({ source: 'tcp', value: APPROVER });
    expect(prov('stamper_variable_map.touFileBase64')).toMatchObject({ source: 'tcp' });
    expect(JSON.stringify(prov('stamper_variable_map.touFileBase64').value)).not.toContain(vm.touFileBase64);
    expect(prov('secret_references.initialPassword')).toMatchObject({ source: 'tcp', value: passwordRef });
    // Answered → not listed as defaulted.
    expect(defaulted.filter((d) => /approver|terms-of-use|initial password/i.test(d))).toEqual([]);
  });

  // REQ-ces-shared-im-secret-values.md acceptance #2, now satisfied by
  // ces-shared 2.8.0's typed schema (closes the MS-5 HONEST-OPEN): a manifest
  // that puts the password in stamper_variable_map is rejected, not merely
  // passed through. A regression guard on Muster's own emitted shape, not a
  // re-test of ces-shared's own suite.
  test('ces-shared rejects the Infra Manifest if a plain password ever landed in stamper_variable_map', () => {
    const broken = structuredClone(im) as any;
    broken.infrastructure.stamper_variable_map.initialPassword = 'Sup3rSecret!Plain';
    const parsed = InfraManifestSchema.safeParse(broken);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain(
        'infrastructure.stamper_variable_map.initialPassword'
      );
    }
  });

  test('the generated password is usable and is stored NOWHERE', () => {
    expect(password.length).toBeGreaterThanOrEqual(20);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
    expect(dexieJson).not.toContain(password);
    expect(artifactsJson).not.toContain(password);
    expect(JSON.stringify(im)).not.toContain(password);
    // The session holds the reference, not the value.
    expect(dexieJson).toContain(passwordRef);
  });

  test('the session fact for the ToU file is a reference (name + sha256), not the bytes', () => {
    expect(touRef).toMatch(/^file:Enclave Terms of Use\.pdf;sha256:[0-9a-f]{64}$/);
    const session = JSON.parse(dexieJson).sessions[0];
    const fact = session.facts.find((f: any) => f.question_id === PROVISIONING_NODE_IDS.touFile);
    expect(fact.answer).toBe(touRef);
    expect(JSON.stringify(session.facts)).not.toContain(Buffer.from(TOU_BYTES).toString('base64'));
  });
});

// FC-MU-4 step 2 (founder decision 2026-09-28 #11): an m365_only session
// builds no Tenant Config Profile and no Infrastructure Manifest (tcpWanted
// stays false — no TCP bank question answered, and the model is neither
// m365_sentinel nor m365_azure). The three provisioning inputs must still
// reach an artifact: ces-shared 2.8.0's TenantManifestBodySchema.provisioning_inputs.
const READINESS_ONLY: Record<string, string> = {
  'iam-001': 'yes', 'iam-002': 'no', 'iam-003': 'yes', 'iam-004': 'no', 'iam-005': 'unknown',
  'ep-001': 'yes', 'ep-002': 'no', 'ep-003': 'yes', 'ep-004': 'no',
  'pol-001': 'yes', 'pol-002': 'no', 'pol-003': 'no', 'pol-004': 'yes',
  'mon-001': 'no', 'mon-002': 'yes', 'mon-003': 'no', 'mon-004': 'unknown',
  'dp-001': 'yes', 'dp-002': 'no', 'dp-003': 'yes', 'dp-004': 'no',
  'ir-001': 'no', 'ir-002': 'yes', 'ir-003': 'no', 'ir-004': 'yes',
  'bnd-001': 'yes', 'bnd-002': 'unsure', 'bnd-003': 'no',
};

const SI_ONLY: Record<string, string> = {
  'G-01': 'L2', 'G-02': 'cui_present', 'G-05': 'certification', 'G-07': 'single_enclave',
  'G-08': 'cloud_only', 'S-12': 'teams_first', 'S-13': 'not_allowed', 'S-16': 'c3pao_ready',
  'S-20': 'gcc_high', 'SIT-020': 'm365_only', 'SIT-021': 'g5', 'S-24': 'poam_if_allowed',
  'S-25': 'company_managed_only', 'S-26': 'managed_wireless', 'S-27': 'allowed_encrypted', 'S-28': 'cloud_native',
  'S-29': 'managed_nonlocal', 'S-30': 'managed_endpoints',
  'G-03': 'CTI', 'G-04': 'none beyond CUI', 'G-06': 'ASAP', 'S-11': '25', 'SIT-022': '25',
  'SIT-023': 'FR1234567890', 'SIT-024': '1', 'SIT-025': '0',
};

const APPROVER_ONLY = 'pim-approver@only-fixture.example';
const TOU_ONLY_NAME = 'Only Terms of Use.pdf';
const TOU_ONLY_BYTES = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');

describe('FC-MU-4 MS-5 (m365_only): the three provisioning inputs travel on the Tenant Manifest', () => {
  let tenantManifest: unknown;
  let infrastructureManifest: unknown;
  let tenantConfig: unknown;
  let onlyPassword: string;
  let onlyPasswordRef: string;
  let onlyArtifactsJson: string;
  let onlyDexieJson: string;

  beforeAll(async () => {
    const handle = await createSession('individual_contractor', {
      stacks: [],
      party: { name: 'M365-Only Fixture Co', on_prem_ot: 'no' },
    });
    await attachTouFile(handle, TOU_ONLY_NAME, TOU_ONLY_BYTES);
    const secret = await generateInitialPassword(handle);
    onlyPassword = secret.password;
    onlyPasswordRef = secret.ref;
    await answer(handle, PROVISIONING_NODE_IDS.approverUpn, APPROVER_ONLY);
    for (const [id, value] of Object.entries({ ...READINESS_ONLY, ...SI_ONLY })) {
      await answer(handle, id, value);
    }
    await completeInterview(handle);
    const result = await compilePlanForSession(handle.sessionId);
    tenantManifest = result.artifacts.tenantManifest;
    infrastructureManifest = result.artifacts.infrastructureManifest;
    tenantConfig = result.artifacts.tenantConfig;
    onlyArtifactsJson = JSON.stringify(result.artifacts) + JSON.stringify(result.docs);
    onlyDexieJson = JSON.stringify({
      sessions: await db.interview_sessions.toArray(),
      engagements: await db.engagements.toArray(),
      parties: await db.assessed_parties.toArray(),
    });
  });

  test('no Tenant Config Profile and no Infra Manifest are built for m365_only', () => {
    expect(tenantConfig).toBeNull();
    expect(infrastructureManifest).toBeNull();
  });

  test('the Tenant Manifest parses under ces-shared and carries provisioning_inputs', () => {
    const parsed = TenantManifestSchema.safeParse(tenantManifest);
    if (!parsed.success) console.error(parsed.error.issues.slice(0, 10));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const pi = parsed.data.tenant_manifest.provisioning_inputs;
    expect(pi).toBeDefined();
    const piParsed = ProvisioningInputsSchema.safeParse(pi);
    expect(piParsed.success).toBe(true);
    if (!pi) return;
    expect(pi.approver_upn).toBe(APPROVER_ONLY);
    expect(pi.terms_of_use_file.file_name).toBe(TOU_ONLY_NAME);
    expect(Buffer.from(pi.terms_of_use_file.content_base64, 'base64').equals(Buffer.from(TOU_ONLY_BYTES))).toBe(true);
    // The password travels ONLY as a one-time reference, never a plain value.
    expect(pi.initial_password_ref).toEqual({
      variable: 'initialPassword',
      form: 'one_time_operator_held',
      ref: onlyPasswordRef,
    });
  });

  test('the generated password is usable and is stored NOWHERE', () => {
    expect(onlyPassword.length).toBeGreaterThanOrEqual(20);
    expect(onlyDexieJson).not.toContain(onlyPassword);
    expect(onlyArtifactsJson).not.toContain(onlyPassword);
    expect(JSON.stringify(tenantManifest)).not.toContain(onlyPassword);
    expect(onlyDexieJson).toContain(onlyPasswordRef);
  });
});
