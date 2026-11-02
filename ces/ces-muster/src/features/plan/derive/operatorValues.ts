// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// operatorValues.ts — MG-14 / FX-11: the operator values Stamper's commands
// need (ces-stamper src/shared/variable-map.ts): operator UPN, break-glass UPN
// and object id, CUI group name, Wi-Fi SSID, security notification email.
//
// Sources, in order: a discovered (harvest prefill, provenance auto_detected)
// or asked session fact; a value the TCP already holds (break-glass UPN from
// TCP.IA.001, CUI group from TCP.GA.002, with that field's provenance); else
// defaulted. Only the two values discovery can never see (Wi-Fi SSID, security
// email) get a VISIBLE placeholder when defaulted, so a headless plan carries
// the key and the placeholder is plainly not a real value. The others stay
// absent (null) when nothing supplies them: an invented account is worse than
// an unresolved variable.
import type { TenantConfigProfileOutput } from '@/features/plan/engine/shared/types/artifacts';

export type TcpProvenance = 'discovered' | 'asked' | 'derived' | 'archetype' | 'defaulted';

export type OperatorKey =
  | 'operator_upn'
  | 'breakglass_upn'
  | 'break_glass_user_id'
  | 'cui_group_name'
  | 'wifi_ssid'
  | 'security_email'
  /** W5c6: the same answered mailbox under Stamper's AZ-MON-001 name (TM operator-value addition, MG-27). */
  | 'ciso_email';

export interface OperatorValue {
  /** Tenant JSON / TM key (Stamper VARIABLE_MAPPING right-hand side). */
  key: OperatorKey;
  /** Stamper plan variable (VARIABLE_MAPPING left-hand side). */
  stamperVar: string;
  value: string | null;
  provenance: TcpProvenance;
  /** Where the value came from (node id, TCP field or placeholder rule). */
  from: string;
}

export type OperatorValues = Record<OperatorKey, OperatorValue>;

export const STAMPER_VAR: Record<OperatorKey, string> = {
  operator_upn: 'operatorUPN',
  breakglass_upn: 'breakGlassUPN',
  break_glass_user_id: 'breakGlassUserId',
  cui_group_name: 'cuiGroupName',
  wifi_ssid: 'wifiSsid',
  security_email: 'securityEmail',
  ciso_email: 'cisoEmail',
};

/** Visible placeholders for the two values discovery cannot see. */
export const OPERATOR_PLACEHOLDER: Partial<Record<OperatorKey, string>> = {
  wifi_ssid: 'MUSTER-DEFAULT-SSID',
  security_email: 'unset-security-email@example.invalid',
  ciso_email: 'unset-security-email@example.invalid',
};

/** A session-held operator answer (discovered or asked). */
export interface HeldValue {
  value: string;
  provenance: Extract<TcpProvenance, 'discovered' | 'asked'>;
  nodeId: string;
}

/**
 * W1 fallbacks: the FX-11 operator values an answered `OPV.<stamperVar>` fact
 * may supply (org-content operator_values_without_register_row). An answered
 * value applies only when discovery (or the key's own register answer) gives
 * no value; a discovered value always wins.
 */
export const OPV_FALLBACK_VARS = ['operatorUPN', 'breakGlassUPN', 'breakGlassUserId'] as const;
export type OpvFallbackVar = (typeof OPV_FALLBACK_VARS)[number];

/** An answered OPV value for one of OPV_FALLBACK_VARS. */
export interface AnsweredFallback {
  value: string;
  /** Fact id and source, e.g. `OPV.breakGlassUPN (synthetic-org-content:<slug>)`. */
  from: string;
}

export function buildOperatorValues(
  held: Partial<Record<'operator_upn' | 'break_glass_user_id' | 'wifi_ssid' | 'security_email', HeldValue>>,
  tenantConfig: TenantConfigProfileOutput,
  fieldProvenance: { breakGlass: TcpProvenance; keyGroups: TcpProvenance; keyGroupNames: string[] },
  answered: Partial<Record<OpvFallbackVar, AnsweredFallback>> = {}
): OperatorValues {
  const out = {} as OperatorValues;
  const put = (key: OperatorKey, value: string | null, provenance: TcpProvenance, from: string) => {
    out[key] = { key, stamperVar: STAMPER_VAR[key], value, provenance, from };
  };
  // W1: the winner's `from` names the answered OPV value it beat (or used).
  const fallbackFor = (key: OperatorKey) => answered[STAMPER_VAR[key] as OpvFallbackVar];
  const beat = (key: OperatorKey, provenance: TcpProvenance) => {
    const a = fallbackFor(key);
    return a ? `; answered ${a.from} not used (${provenance} value wins)` : '';
  };
  const useFallback = (key: OperatorKey): boolean => {
    const a = fallbackFor(key);
    if (!a) return false;
    put(key, a.value, 'asked', `${a.from}; answered fallback (discovery gave no value)`);
    return true;
  };
  const fromHeld = (key: 'operator_upn' | 'break_glass_user_id' | 'wifi_ssid' | 'security_email') => {
    const h = held[key];
    if (h) return put(key, h.value, h.provenance, `${h.nodeId}${beat(key, h.provenance)}`);
    if (useFallback(key)) return;
    const ph = OPERATOR_PLACEHOLDER[key];
    put(key, ph ?? null, 'defaulted', ph ? 'visible placeholder (not discoverable, not answered)' : 'unresolved');
  };

  fromHeld('operator_upn');
  const bg = tenantConfig.tenant_config.identity_architecture.break_glass_accounts[0];
  const bgKept = Boolean(bg) && (fieldProvenance.breakGlass === 'discovered' || fieldProvenance.breakGlass === 'asked');
  if (bg && (bgKept || !fallbackFor('breakglass_upn'))) {
    put('breakglass_upn', bg, fieldProvenance.breakGlass, `TCP.IA.001[0]${bgKept ? beat('breakglass_upn', fieldProvenance.breakGlass) : ''}`);
  } else if (!useFallback('breakglass_upn')) put('breakglass_upn', null, 'defaulted', 'unresolved');
  fromHeld('break_glass_user_id');
  const cui = fieldProvenance.keyGroupNames.find((g) => /cui/i.test(g));
  if (cui) put('cui_group_name', cui, fieldProvenance.keyGroups, 'TCP.GA.002 (first group naming CUI)');
  else put('cui_group_name', null, 'defaulted', 'unresolved');
  fromHeld('wifi_ssid');
  fromHeld('security_email');
  // W5c6 (coordinator decision): Stamper's AZ-MON-001 action group mails {cisoEmail}
  // (variable-map ciso_email). Muster asks no separate CISO question: the answered
  // security mailbox (TCP.MU.007) is emitted again under that name, with the same
  // value and provenance, so the push gate treats both alike.
  const sec = out.security_email;
  put('ciso_email', sec.value, sec.provenance, `${sec.from}; same value as securityEmail (Stamper AZ-MON-001 reads cisoEmail)`);
  return out;
}

/** The values as TM keys (snake_case, Stamper's tenant JSON keys); nulls dropped. */
export function operatorTenantKeys(v: OperatorValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of Object.values(v)) if (o.value !== null) out[o.key] = o.value;
  return out;
}

/** The values as Stamper plan variables (camelCase); nulls dropped. */
export function operatorStamperVariables(v: OperatorValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of Object.values(v)) if (o.value !== null) out[o.stamperVar] = o.value;
  return out;
}

/**
 * FX-11 / MG-15: the provenance record the Tenant Manifest carries beside the
 * operator values (tenant_identity.operator_value_provenance). A non-scalar
 * key, so Stamper's ManifestReader (scalars only) never turns it into a plan
 * variable; the push gates (SPA planValidation, muster-api planPushAudit) read
 * it to block defaulted values unless the plan is sim-only.
 */
export interface OperatorValueProvenanceBlock {
  /** The plan was compiled for a sim tenant (readiness_manifest.tenant_kind 'sim'). */
  sim_only: boolean;
  /** Stamper variable name → provenance, for all seven (unresolved ones included; W5c6 adds cisoEmail). */
  values: Record<string, TcpProvenance>;
}

export const OPERATOR_PROVENANCE_KEY = 'operator_value_provenance';

export function operatorValueProvenance(v: OperatorValues, simOnly: boolean): OperatorValueProvenanceBlock {
  const values: Record<string, TcpProvenance> = {};
  for (const o of Object.values(v)) values[o.stamperVar] = o.provenance;
  return { sim_only: simOnly, values };
}

// ── W1 (synthetic customers): the further Stamper values Muster supplies ─────
//
// Sources: discovered (a harvest fact, provenance auto_detected), answered (an
// interview fact, provenance class 'asked'), or derived (a platform constant).
// Only resolved values are returned; an unresolved one is listed in
// `unresolved` and left out of the TM (an invented value is worse than an
// unresolved variable), so the push gate's rule for the six FX-11 values is
// unchanged.

/** Fact ids for operator values with no register row: `OPV.<stamperVar>`. */
export const OPERATOR_VALUE_FACT_PREFIX = 'OPV.';

/**
 * Built-in Entra role template ids (platform constants, identical in every
 * tenant). Equal to muster-api harvestService ROLE_TEMPLATE (tsc rootDir keeps
 * the SPA from importing it; a test compares them).
 */
export const ENTRA_ROLE_TEMPLATE = {
  globalAdministrator: '62e90394-69f5-4237-9190-012177145e10',
  complianceAdministrator: '17315797-102d-40b4-93e0-432062caca18',
} as const;

/** The PIM approver UPN node (tcpProvisioningNodes PROVISIONING_NODE_IDS.approverUpn). */
const APPROVER_NODE = 'TCP.MU.001';

export const SUPPLIED_OPERATOR_VARS = [
  'approverUPN',
  'adminUserName',
  'approvedIpRange',
  'touFileName',
  'touFileBase64',
  'subscriptionId',
  'baselineTemplateId',
  'complianceRoleId',
  'roleDefId',
] as const;

export type SuppliedOperatorVar = (typeof SUPPLIED_OPERATOR_VARS)[number];

export interface SuppliedOperatorValue {
  stamperVar: SuppliedOperatorVar;
  value: string;
  provenance: Extract<TcpProvenance, 'discovered' | 'asked' | 'derived'>;
  /** Fact id and source, or the constant's name. */
  from: string;
}

export interface SuppliedOperatorValues {
  values: SuppliedOperatorValue[];
  unresolved: SuppliedOperatorVar[];
}

/** Minimal fact shape read here (an InterviewFact). */
interface FactLike {
  question_id: string;
  answer: string;
  provenance: string;
  confidence: string;
  source?: string;
}

export function buildSuppliedOperatorValues(facts: FactLike[]): SuppliedOperatorValues {
  const last = (id: string): FactLike | undefined => {
    let v: FactLike | undefined;
    for (const f of facts) if (f.question_id === id && f.confidence !== 'unknown' && f.answer.trim() !== '') v = f;
    return v;
  };
  const values: SuppliedOperatorValue[] = [];
  const unresolved: SuppliedOperatorVar[] = [];
  const fromFact = (stamperVar: SuppliedOperatorVar, ids: string[]) => {
    for (const id of ids) {
      const f = last(id);
      if (!f) continue;
      values.push({
        stamperVar,
        value: f.answer.trim(),
        provenance: f.provenance === 'auto_detected' ? 'discovered' : 'asked',
        from: f.source ? `${id} (${f.source})` : id,
      });
      return;
    }
    unresolved.push(stamperVar);
  };
  const opv = (v: SuppliedOperatorVar) => `${OPERATOR_VALUE_FACT_PREFIX}${v}`;
  fromFact('approverUPN', [APPROVER_NODE, opv('approverUPN')]);
  for (const v of ['adminUserName', 'approvedIpRange', 'touFileName', 'touFileBase64', 'subscriptionId', 'baselineTemplateId'] as const) {
    fromFact(v, [opv(v)]);
  }
  values.push({
    stamperVar: 'complianceRoleId',
    value: ENTRA_ROLE_TEMPLATE.complianceAdministrator,
    provenance: 'derived',
    from: 'built-in Entra role template: Compliance Administrator',
  });
  values.push({
    stamperVar: 'roleDefId',
    value: ENTRA_ROLE_TEMPLATE.globalAdministrator,
    provenance: 'derived',
    from: 'built-in Entra role template: Global Administrator',
  });
  return { values, unresolved };
}
