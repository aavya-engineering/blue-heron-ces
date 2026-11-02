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
//   1. session    — a fact on a TCP plan-input node (tcpPlanInputNodes.ts):
//                   `discovered` when it is the harvest prefill (provenance
//                   auto_detected, MG-14), `interview` (provenance `asked`)
//                   when the operator typed or picked it. Radio slugs decode to
//                   the bank's own option; typed answers parse with
//                   parsePlanInputAnswer.
//   2. derived    — Planner's own SI → TCP mapping (vendored tcpSIDerivation)
//                   over the SI Baseline this same compile built.
//   3. archetype  — MG-21 slot: the selected archetype's TCP prior (empty
//                   until BHD supplies TCP archetype content).
//   4. recommended— the bank's `recommended` value, with {org}/{ORG}/{slug}/
//                   {domain} resolved from the session ({domain} only from a
//                   discovered or asked primary domain). Listed as DEFAULTED —
//                   never presented as observed.
//   5. unresolved — nothing Muster holds answers it. The generator's own empty
//                   value stands; listed as defaulted.
//
// "network": the TCP bank has no network section. The Infra Manifest's network
// block (VNet CIDR, subnets) comes from the vendored infra generator's
// convention, recorded in its provenance[] — not a Muster-invented question.
import type { InterviewFact } from '@/shared/types/engagement';
import type {
  InfrastructureManifest,
  SIBaseline,
  TenantConfigProfileOutput,
} from '@/features/plan/engine/shared/types/artifacts';
import { generateTenantConfigProfile } from '@/features/plan/engine/tcp/tcpProfileGenerator';
import { deriveTCPDefaults } from '@/features/plan/engine/tcp/tcpSIDerivation';
import type { TCPAnswer, TCPQuestionDef, TCPSectionDef } from '@/features/plan/engine/tcp/types';
import {
  TCP_NODE_SPEC_BY_ID,
  TCP_OPERATOR_SPEC_BY_ID,
  TCP_TYPED_SPEC_BY_ID,
  type TcpTypedNodeSpec,
} from '@/features/interview/tcpPlanInputNodes';
import { parsePlanInputAnswer } from '@/features/interview/siPlanInputNodes';
import type { ProvisioningInputs } from './provisioningInputs';
import {
  buildOperatorValues,
  OPERATOR_VALUE_FACT_PREFIX,
  OPV_FALLBACK_VARS,
  type AnsweredFallback,
  type HeldValue,
  type OpvFallbackVar,
  type OperatorValues,
  type TcpProvenance,
} from './derive/operatorValues';

export type { TcpProvenance, OperatorValues } from './derive/operatorValues';

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
  /**
   * MG-21 slot (MG-14): the selected archetype's TCP priors, bank question id →
   * raw bank answer. Used only where the session and the SI are silent. Empty
   * until BHD supplies TCP archetype content (D8).
   */
  archetypePriors?: Record<string, TCPAnswer['raw_answer']> | null;
}

export type TcpAnswerSource =
  | 'interview'
  | 'discovered'
  | 'derived'
  | 'archetype'
  | 'recommended'
  | 'unresolved';

export interface TcpBuildResult {
  tenantConfig: TenantConfigProfileOutput;
  /** question id → where its answer came from. Covers every bank question. */
  sources: Record<string, TcpAnswerSource>;
  /**
   * MG-14: question id → provenance class (discovered / asked / derived /
   * archetype / defaulted). Covers every bank question.
   */
  provenance: Record<string, TcpProvenance>;
  /** Human labels of questions whose value is a recommendation or unresolved. */
  defaulted: string[];
  /** MG-14 / FX-11: the operator values Stamper needs, each with provenance. */
  operatorValues: OperatorValues;
}

const CAPTURED_AT = '1970-01-01T00:00:00.000Z';

const PROVENANCE_OF: Record<TcpAnswerSource, TcpProvenance> = {
  interview: 'asked',
  discovered: 'discovered',
  derived: 'derived',
  archetype: 'archetype',
  recommended: 'defaulted',
  unresolved: 'defaulted',
};

/**
 * MG-14 / FX-11: the operator values of each built TCP, keyed by the TCP
 * object itself (the artifact JSON stays Planner's shape). The Tenant Manifest
 * builder reads them with operatorValuesFor(tenantConfig).
 */
const OPERATOR_VALUES = new WeakMap<object, OperatorValues>();

export function operatorValuesFor(tenantConfig: TenantConfigProfileOutput | null | undefined): OperatorValues | null {
  return tenantConfig ? (OPERATOR_VALUES.get(tenantConfig) ?? null) : null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Resolve {org}/{ORG}/{slug}/{domain} in a recommended value; null when the
 * value needs a {domain} Muster does not hold. Other braces ({lastname},
 * {Department} …) are naming-convention tokens and stay literal. */
function resolveTemplate(
  value: TCPQuestionDef['recommended'],
  ctx: { org: string; orgCode: string; slug: string; domain: string | null }
): TCPQuestionDef['recommended'] | null {
  const one = (s: string): string | null => {
    if (s.includes('{domain}') && !ctx.domain) return null;
    return s
      .replace(/\{domain\}/g, ctx.domain ?? '')
      .replace(/\{org\}/g, ctx.org)
      .replace(/\{ORG\}/g, ctx.orgCode)
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

/**
 * W5c3 (founder ruling R-2): list questions whose honest answer can be "none".
 * An answer of exactly "none" is the empty list, not a one-item list naming "none".
 */
export const TCP_EMPTY_LIST_ANSWER_IDS: ReadonlySet<string> = new Set(['TCP.LIC.003']);

/** A typed answer as the bank's raw_answer type; null when it does not parse. */
function typedRaw(spec: TcpTypedNodeSpec, answer: string): TCPAnswer['raw_answer'] | null {
  if (TCP_EMPTY_LIST_ANSWER_IDS.has(spec.id) && /^none$/i.test(answer.trim())) return [];
  const parsed = parsePlanInputAnswer(spec.input, answer);
  if (!parsed.ok) return null;
  return parsed.value as TCPAnswer['raw_answer'];
}

/** The last session fact per TCP node (an "I'm not sure" is not an answer). */
function lastFacts(facts: InterviewFact[]): Map<string, InterviewFact> {
  const out = new Map<string, InterviewFact>();
  for (const f of facts) {
    if (f.confidence === 'unknown') continue;
    if (TCP_NODE_SPEC_BY_ID.has(f.question_id) || TCP_TYPED_SPEC_BY_ID.has(f.question_id) || TCP_OPERATOR_SPEC_BY_ID.has(f.question_id)) {
      out.set(f.question_id, f);
    }
  }
  return out;
}

const isDiscovered = (f: InterviewFact): boolean => f.provenance === 'auto_detected';

/** The session's TCP facts, decoded to the bank's own answer values. */
function sessionAnswers(facts: Map<string, InterviewFact>): Record<string, { answer: TCPAnswer; discovered: boolean }> {
  const out: Record<string, { answer: TCPAnswer; discovered: boolean }> = {};
  for (const f of facts.values()) {
    const radio = TCP_NODE_SPEC_BY_ID.get(f.question_id);
    const typed = TCP_TYPED_SPEC_BY_ID.get(f.question_id);
    let raw: TCPAnswer['raw_answer'] | null = null;
    let answerType: string | null = null;
    if (radio) {
      const opt = radio.options.find((o) => o.value === f.answer);
      if (opt) {
        raw = opt.bankOption;
        answerType = radio.answerType;
      }
    } else if (typed) {
      raw = typedRaw(typed, f.answer);
      answerType = typed.bankType;
    }
    if (raw === null || answerType === null) continue;
    out[f.question_id] = {
      answer: {
        question_id: f.question_id,
        answer_type: answerType as TCPAnswer['answer_type'],
        raw_answer: raw,
        captured_at: CAPTURED_AT,
        provenance_class: isDiscovered(f) ? 'system_observation' : 'client_assertion',
      },
      discovered: isDiscovered(f),
    };
  }
  return out;
}

/** True when the session answered at least one TCP plan-input node. */
export function hasTcpInput(facts: InterviewFact[]): boolean {
  return facts.some(
    (f) =>
      TCP_NODE_SPEC_BY_ID.has(f.question_id) ||
      TCP_TYPED_SPEC_BY_ID.has(f.question_id) ||
      TCP_OPERATOR_SPEC_BY_ID.has(f.question_id)
  );
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

  const held = lastFacts(facts);
  const fromSession = sessionAnswers(held);
  const fromSi = siBaseline ? deriveTCPDefaults(siBaseline, bank.sections).defaults : {};
  const priors = ctx.archetypePriors ?? {};

  // {domain}: only a discovered or asked primary domain — never invented.
  const domainQ = questions.find((q) => q.bindings.tenant_config === 'identity.primary_domain');
  const domainRaw = domainQ ? fromSession[domainQ.id]?.answer.raw_answer : undefined;
  const domain = typeof domainRaw === 'string' && domainRaw.trim() ? domainRaw.trim() : null;
  // {ORG}: the tenant's own short label (primary-domain label, else the tenant
  // slug), upper-cased. A naming convention, so still listed as defaulted.
  const orgCode = (domain ? domain.split('.')[0] : slug).toUpperCase().replace(/[^A-Z0-9]+/g, '-');

  const answers: Record<string, TCPAnswer> = {};
  const sources: Record<string, TcpAnswerSource> = {};
  const defaulted: string[] = [];

  for (const q of questions) {
    const s = fromSession[q.id];
    if (s) {
      answers[q.id] = s.answer;
      sources[q.id] = s.discovered ? 'discovered' : 'interview';
      continue;
    }
    if (fromSi[q.id]) {
      answers[q.id] = { ...fromSi[q.id], captured_at: CAPTURED_AT };
      sources[q.id] = 'derived';
      continue;
    }
    if (priors[q.id] !== undefined && priors[q.id] !== null) {
      answers[q.id] = {
        question_id: q.id,
        answer_type: q.answer_type,
        raw_answer: priors[q.id],
        captured_at: CAPTURED_AT,
        provenance_class: 'system_recommendation',
      };
      sources[q.id] = 'archetype';
      continue;
    }
    // A GUID "recommendation" is the bank's all-zero placeholder, not a value:
    // tenant / workspace ids are observed or asked, never recommended.
    const rec =
      q.recommended === undefined || q.recommended === '' || q.answer_type === 'guid'
        ? null
        : resolveTemplate(q.recommended, { org, orgCode, slug, domain });
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
  // it over the bank's "{org} GCC High Tenant" template when the tenant's own
  // display name was neither discovered nor asked.
  const displayQ = questions.find((q) => q.bindings.tenant_config === 'identity.display_name');
  if (displayQ && sources[displayQ.id] !== 'interview' && sources[displayQ.id] !== 'discovered' && org) {
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

  const provenance: Record<string, TcpProvenance> = {};
  for (const [id, src] of Object.entries(sources)) provenance[id] = PROVENANCE_OF[src];

  const tenantConfig = generateTenantConfigProfile(answers, bank.sections, bank.schema_version ?? '1.0');
  if (cesId) tenantConfig.ces.cesId = cesId;

  // MG-14 / FX-11: operator values.
  const heldOperator: Parameters<typeof buildOperatorValues>[0] = {};
  for (const f of held.values()) {
    const spec = TCP_OPERATOR_SPEC_BY_ID.get(f.question_id);
    if (!spec || !f.answer.trim()) continue;
    const parsed = parsePlanInputAnswer(spec.input, f.answer);
    if (!parsed.ok) continue;
    const h: HeldValue = { value: String(parsed.value), provenance: isDiscovered(f) ? 'discovered' : 'asked', nodeId: spec.id };
    heldOperator[spec.key] = h;
  }
  const idOf = (field: string) => questions.find((q) => q.bindings.tenant_config === field)?.id ?? '';
  const keyGroupsId = idOf('group_architecture.key_groups');
  const keyGroupsRaw = answers[keyGroupsId]?.raw_answer;
  // W1: answered OPV.<stamperVar> values for operatorUPN / breakGlassUPN /
  // breakGlassUserId (last fact wins, as lastFacts); used only as a fallback.
  const answeredOperator: Partial<Record<OpvFallbackVar, AnsweredFallback>> = {};
  for (const f of facts) {
    if (f.confidence === 'unknown' || !f.answer.trim() || !f.question_id.startsWith(OPERATOR_VALUE_FACT_PREFIX)) continue;
    const v = f.question_id.slice(OPERATOR_VALUE_FACT_PREFIX.length) as OpvFallbackVar;
    if (!OPV_FALLBACK_VARS.includes(v)) continue;
    answeredOperator[v] = { value: f.answer.trim(), from: f.source ? `${f.question_id} (${f.source})` : f.question_id };
  }
  const operatorValues = buildOperatorValues(
    heldOperator,
    tenantConfig,
    {
      breakGlass: provenance[idOf('identity_architecture.break_glass_accounts')] ?? 'defaulted',
      keyGroups: provenance[keyGroupsId] ?? 'defaulted',
      keyGroupNames: Array.isArray(keyGroupsRaw) ? keyGroupsRaw.map((g) => String(g).split('=')[0].trim()) : [],
    },
    answeredOperator
  );
  for (const v of Object.values(operatorValues)) {
    if (v.provenance === 'defaulted') {
      defaulted.push(`Operator value ${v.key} (${v.stamperVar}): ${v.value === null ? 'unresolved' : `placeholder ${v.value}`}`);
    }
  }
  OPERATOR_VALUES.set(tenantConfig, operatorValues);

  return { tenantConfig, sources, provenance, defaulted, operatorValues };
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
      ?.infrastructure_model || 'm365_only'; // the generator's own default (CG-1)
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
