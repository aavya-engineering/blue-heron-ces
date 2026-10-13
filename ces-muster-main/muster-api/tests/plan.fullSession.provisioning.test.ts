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
  const plain = { ...READINESS, ...SI_AZURE, ...TCP, [PROVISIONING_NODE_IDS.approverUpn]: APPROVER };

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
