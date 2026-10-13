// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// tcpAdapter.ts — W4-MU1 (MS-R7, G-MUSTER-PLAN-3 M3): build the Tenant Config
// Profile (TCP) from a Muster session, through the VENDORED, unforked Planner
// generator (tcpProfileGenerator.generateTenantConfigProfile), and decorate the
// Infrastructure Manifest for the Muster → Stamper hand-off.
//
// Answer precedence per TCP bank question (every answer carries provenance):
//   1. interview  — the operator answered a TCP plan-input node
//                   (tcpPlanInputNodes.ts; slug value → the bank's own option).
//   2. derived    — Planner's own SI → TCP mapping (vendored tcpSIDerivation)
//                   over the SI Baseline this same compile built.
//   3. recommended— the bank's `recommended` value, with {org}/{ORG}/{slug}
//                   resolved from the session. Listed as DEFAULTED — never
//                   presented as observed.
//   4. unresolved — nothing Muster holds answers it (e.g. the tenant's primary
//                   domain: no discovery observation carries it yet, and a
//                   {domain}-templated recommendation is NOT invented). The
//                   generator's own empty value stands; listed as defaulted.
//
// "network": the TCP bank has no network section. The Infra Manifest's network
// block (VNet CIDR, subnets) comes from the vendored infra generator's
// convention, recorded in its provenance[] — not a Muster-invented question.
import type { InterviewFact } from '@/shared/types/engagement';
import type {
  InfrastructureManifest,
  SIBaseline,
  TenantConfigProfileOutput,
} from '@/vendored/ces-planner/shared/types/artifacts';
import { generateTenantConfigProfile } from '@/vendored/ces-planner/tcp/tcpProfileGenerator';
import { deriveTCPDefaults } from '@/vendored/ces-planner/tcp/tcpSIDerivation';
import type { TCPAnswer, TCPQuestionDef, TCPSectionDef } from '@/vendored/ces-planner/tcp/types';
import { TCP_NODE_SPEC_BY_ID } from '@/features/interview/tcpPlanInputNodes';
import type { ProvisioningInputs } from './provisioningInputs';

/** The primed TCP Question Bank as parsed from YAML (only what we read). */
export interface TcpQuestionBank {
  schema_version?: string;
  sections: TCPSectionDef[];
}

/** Session facts the recommendation templates may resolve. */
export interface TcpContext {
  /** Organisation name (the assessed party). */
  orgName?: string | null;
  /** Tenant slug (readiness manifest) — else derived from orgName. */
  tenantSlug?: string | null;
}

export type TcpAnswerSource = 'interview' | 'derived' | 'recommended' | 'unresolved';

export interface TcpBuildResult {
  tenantConfig: TenantConfigProfileOutput;
  /** question id → where its answer came from. Covers every bank question. */
  sources: Record<string, TcpAnswerSource>;
  /** Human labels of questions whose value is a recommendation or unresolved. */
  defaulted: string[];
}

const CAPTURED_AT = '1970-01-01T00:00:00.000Z';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Resolve {org}/{ORG}/{slug} in a recommended value; null when the value
 * needs something Muster does not hold ({domain}). Other braces ({lastname},
 * {Department} …) are naming-convention tokens and stay literal. */
function resolveTemplate(
  value: TCPQuestionDef['recommended'],
  ctx: { org: string; slug: string }
): TCPQuestionDef['recommended'] | null {
  const one = (s: string): string | null => {
    if (s.includes('{domain}')) return null;
    return s
      .replace(/\{org\}/g, ctx.org)
      .replace(/\{ORG\}/g, ctx.org.toUpperCase().replace(/[^A-Z0-9]+/g, ''))
      .replace(/\{slug\}/g, ctx.slug);
  };
  if (typeof value === 'string') return one(value);
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const v of value) {
      const r = one(v);
      if (r === null) return null;
      out.push(r);
    }
    return out;
  }
  return value ?? null;
}

/** The interview TCP facts, decoded to the bank's own option values. */
function interviewAnswers(facts: InterviewFact[]): Record<string, TCPAnswer> {
  const out: Record<string, TCPAnswer> = {};
  for (const f of facts) {
    const spec = TCP_NODE_SPEC_BY_ID.get(f.question_id);
    if (!spec) continue;
    const opt = spec.options.find((o) => o.value === f.answer);
    if (!opt) continue;
    out[spec.id] = {
      question_id: spec.id,
      answer_type: spec.answerType,
      raw_answer: opt.bankOption,
      captured_at: CAPTURED_AT,
      provenance_class: 'client_assertion',
    };
  }
  return out;
}

/** True when the session answered at least one TCP plan-input node. */
export function hasTcpInput(facts: InterviewFact[]): boolean {
  return facts.some((f) => TCP_NODE_SPEC_BY_ID.has(f.question_id));
}

/**
 * Build the TCP for a session. Pure (bank injected, no fetch). `siBaseline` is
 * the one this compile built — the SI → TCP derivation reads it.
 */
export function buildTenantConfigProfile(
  facts: InterviewFact[],
  bank: TcpQuestionBank,
  siBaseline: SIBaseline | null,
  ctx: TcpContext,
  cesId?: string
): TcpBuildResult {
  const org = (ctx.orgName ?? '').trim();
  const slug = ctx.tenantSlug?.trim() || slugify(org);
  const questions = bank.sections.flatMap((s) => s.questions);

  const fromInterview = interviewAnswers(facts);
  const fromSi = siBaseline ? deriveTCPDefaults(siBaseline, bank.sections).defaults : {};

  const answers: Record<string, TCPAnswer> = {};
  const sources: Record<string, TcpAnswerSource> = {};
  const defaulted: string[] = [];

  for (const q of questions) {
    if (fromInterview[q.id]) {
      answers[q.id] = fromInterview[q.id];
      sources[q.id] = 'interview';
      continue;
    }
    if (fromSi[q.id]) {
      answers[q.id] = { ...fromSi[q.id], captured_at: CAPTURED_AT };
      sources[q.id] = 'derived';
      continue;
    }
    // A GUID "recommendation" is the bank's all-zero placeholder, not a value:
    // tenant / workspace ids are observed or asked, never recommended.
    const rec =
      q.recommended === undefined || q.recommended === '' || q.answer_type === 'guid'
        ? null
        : resolveTemplate(q.recommended, { org, slug });
    if (rec !== null && rec !== undefined) {
      answers[q.id] = {
        question_id: q.id,
        answer_type: q.answer_type,
        raw_answer: rec,
        captured_at: CAPTURED_AT,
        provenance_class: 'system_recommendation',
      };
      sources[q.id] = 'recommended';
    } else {
      sources[q.id] = 'unresolved';
    }
    defaulted.push(`TCP ${q.id}: ${q.prompt} (${sources[q.id]})`);
  }

  // display_name: the assessed party's name is an operator declaration — use
  // it over the bank's "{org} GCC High Tenant" template when present.
  const displayQ = questions.find((q) => q.bindings.tenant_config === 'identity.display_name');
  if (displayQ && sources[displayQ.id] !== 'interview' && org) {
    answers[displayQ.id] = {
      question_id: displayQ.id,
      answer_type: displayQ.answer_type,
      raw_answer: org,
      captured_at: CAPTURED_AT,
      provenance_class: 'client_assertion',
    };
    const wasDefaulted = sources[displayQ.id] === 'recommended' || sources[displayQ.id] === 'unresolved';
    sources[displayQ.id] = 'derived';
    if (wasDefaulted) {
      const i = defaulted.findIndex((d) => d.startsWith(`TCP ${displayQ.id}:`));
      if (i >= 0) defaulted.splice(i, 1);
    }
  }

  const tenantConfig = generateTenantConfigProfile(answers, bank.sections, bank.schema_version ?? '1.0');
  if (cesId) tenantConfig.ces.cesId = cesId;
  return { tenantConfig, sources, defaulted };
}

/** The Infra Manifest as Muster emits it: the canonical shared-contract shape
 * (`infrastructure` key — REQ-ces-muster-infra-manifest-emit, ces-shared 2.5.0). */
export interface EmittedInfraManifest {
  ces: InfrastructureManifest['ces'] & { cesId?: string };
  infrastructure: InfrastructureManifest['infrastructure_manifest'] & {
    infrastructure_model: string;
    stamper_variable_map: InfrastructureManifest['infrastructure_manifest']['stamper_variable_map'] &
      Record<string, string | undefined>;
    /**
     * FC-MU-2 (MS-5): secrets travel as references, never values, and OUTSIDE
     * stamper_variable_map (Stamper copies a map value verbatim into the
     * variable, so a reference there would become the password). ces-shared has
     * no secret-reference shape yet: REQ-ces-shared-im-secret-values.md.
     */
    secret_references?: SecretReference[];
  };
}

/**
 * FC-MU-2 (MS-5): a secret the Infra Manifest (or, for m365-only, the Tenant
 * Manifest's provisioning_inputs) names but never carries. Structurally
 * identical to ces-shared 2.8.0's `OneTimeOperatorHeldSecretRefSchema` variant
 * of `SecretReferenceSchema` (`ces-shared/types/mission-plan`) — confirmed by
 * the full-session contract tests, which parse Muster's emitted shape with the
 * canonical schema. Declared locally (not imported) because the SPA does not
 * depend on the `ces-shared` package — only `muster-api` does (see
 * `src/vendored/cesSharedSync.ts`'s header for why).
 */
export interface SecretReference {
  /** The Stamper variable the secret fills. */
  variable: 'initialPassword';
  /** Generated in Muster, shown to the operator once, stored nowhere. */
  form: 'one_time_operator_held';
  ref: string;
}

/**
 * FC-MU-4 step 2 (founder decision 2026-09-28 #11): the ces-shared 2.8.0
 * `ProvisioningInputsSchema` shape (`ces-shared/types/mission-plan`), Muster's
 * own type mirror for the same file-boundary reason as `SecretReference`
 * above. m365-only sessions carry no Infra Manifest, so these three inputs
 * travel on the Tenant Manifest's `provisioning_inputs` instead.
 */
export interface SharedProvisioningInputs {
  approver_upn: string;
  terms_of_use_file: { file_name: string; content_base64: string };
  initial_password_ref: SecretReference;
}

/**
 * Build the Tenant Manifest's `provisioning_inputs` from the Tenant Config
 * intake — only when all three inputs are present (the shared schema requires
 * every field; a partial intake is reported as defaulted instead, same as
 * every other plan input). Returns null otherwise.
 */
export function provisioningInputsForTenantManifest(
  provisioning?: ProvisioningInputs
): SharedProvisioningInputs | null {
  if (!provisioning?.approverUpn || !provisioning.touFile || !provisioning.initialPasswordRef) return null;
  return {
    approver_upn: provisioning.approverUpn,
    terms_of_use_file: {
      file_name: provisioning.touFile.name,
      content_base64: provisioning.touFile.base64,
    },
    initial_password_ref: {
      variable: 'initialPassword',
      form: 'one_time_operator_held',
      ref: provisioning.initialPasswordRef,
    },
  };
}

/** Same convention as the vendored generator's subnetCidr (octet[2] = index). */
function subnetAt(vnetCidr: string, index: number, bits: number): string {
  const octets = vnetCidr.split('/')[0].split('.').map(Number);
  octets[2] = index;
  octets[3] = 0;
  return `${octets.join('.')}/${bits}`;
}

/**
 * Shape the vendored generator's output for the Muster → Stamper hand-off,
 * per ces-shared REQ-ces-muster-infra-manifest-emit (W4-SH2). The vendored body
 * is not modified; this is a Muster-side emit step:
 *  1. canonical `infrastructure` key (the generator writes the deprecated
 *     `infrastructure_manifest` alias);
 *  2. `infrastructure_model` on the body, from the SI Baseline that chose the
 *     generator path (Stamper's translate reads it; a pushed plan has no
 *     Stamper client config to fall back on) — plus MS-R4 `cesId`;
 *  3. m365_azure only: the canonical subnet variables Stamper's network
 *     registry resolves (`firewallSubnetCidr` from the generator's
 *     `fwSubnetCidr`; `workloadSubnetCidr` / `bastionSubnetCidr` by the
 *     generator's own octet convention, next free indices) and the firewall /
 *     public IP / management VM names the infra registry requires — each added
 *     value gets a provenance row (convention / default), never silent.
 */
export function decorateInfraManifest(
  manifest: InfrastructureManifest,
  siBaseline: SIBaseline,
  tenantConfig: TenantConfigProfileOutput | null,
  cesId?: string,
  provisioning?: ProvisioningInputs
): EmittedInfraManifest {
  const model =
    (siBaseline.si_baseline as { dependencies?: { infrastructure_model?: string } } | undefined)?.dependencies
      ?.infrastructure_model || 'm365_sentinel'; // the generator's own default
  const body = manifest.infrastructure_manifest;
  const vars: Record<string, string | undefined> = { ...(body.stamper_variable_map as unknown as Record<string, string>) };
  const provenance = [...body.provenance];

  if (model === 'm365_azure' && vars.vnetCidr) {
    // Prefix: the generator's own rule (primary-domain slug, else 'cmmc').
    const domain = tenantConfig?.tenant_config.identity.primary_domain ?? '';
    const prefix = domain.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'cmmc';
    const add = (field: string, value: string, source: 'convention' | 'default', rule: string) => {
      if (vars[field]) return; // never overwrite a generator value
      vars[field] = value;
      provenance.push({ field: `stamper_variable_map.${field}`, value, source, rule });
    };
    if (vars.fwSubnetCidr) add('firewallSubnetCidr', vars.fwSubnetCidr, 'convention', 'canonical name for the generator fwSubnetCidr (AzureFirewallSubnet)');
    add('workloadSubnetCidr', subnetAt(vars.vnetCidr, 6, 27), 'convention', '/27 from vnet octet[2]=6 (next free index after the generator subnets 1-5)');
    add('bastionSubnetCidr', subnetAt(vars.vnetCidr, 7, 26), 'convention', '/26 from vnet octet[2]=7 (AzureBastionSubnet minimum size /26)');
    add('firewallName', `${prefix}-afw`, 'convention', '{prefix}-afw');
    add('publicIpName', `${prefix}-afw-pip`, 'convention', '{prefix}-afw-pip');
    add('vmName', `${prefix}-vm-mgmt`, 'convention', '{prefix}-vm-mgmt');
    add('vmImage', 'Win2022Datacenter', 'default', 'management VM image default');
    add('vmSize', 'Standard_B2s', 'default', 'management VM size default');
  }

  // FC-MU-2 (MS-5): the Tenant Config intake's provisioning inputs.
  const secretRefs: SecretReference[] = [];
  if (provisioning?.approverUpn) {
    vars.approverUPN = provisioning.approverUpn;
    provenance.push({ field: 'stamper_variable_map.approverUPN', value: provisioning.approverUpn, source: 'tcp', rule: 'TCP.MU.001 (Muster intake)' });
  }
  if (provisioning?.touFile) {
    const { name, base64, sha256 } = provisioning.touFile;
    vars.touFileName = name;
    vars.touFileBase64 = base64;
    provenance.push({ field: 'stamper_variable_map.touFileName', value: name, source: 'tcp', rule: 'TCP.MU.002 (Muster intake upload)' });
    provenance.push({ field: 'stamper_variable_map.touFileBase64', value: `${name} (sha256 ${sha256})`, source: 'tcp', rule: 'TCP.MU.002 (Muster intake upload)' });
  }
  if (provisioning?.initialPasswordRef) {
    secretRefs.push({ variable: 'initialPassword', form: 'one_time_operator_held', ref: provisioning.initialPasswordRef });
    provenance.push({ field: 'secret_references.initialPassword', value: provisioning.initialPasswordRef, source: 'tcp', rule: 'TCP.MU.003 (generated in Muster, shown once, never stored)' });
  }

  return {
    ces: { ...manifest.ces, ...(cesId ? { cesId } : {}) },
    infrastructure: {
      ...body,
      stamper_variable_map: vars as EmittedInfraManifest['infrastructure']['stamper_variable_map'],
      provenance,
      infrastructure_model: model,
      ...(secretRefs.length > 0 ? { secret_references: secretRefs } : {}),
    },
  };
}
