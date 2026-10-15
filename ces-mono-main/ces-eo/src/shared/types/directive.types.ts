// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Directive type definitions for Stamper Set B directive metadata consumption.
 * These types extend the base DirectiveMetadata from ces-shared/types/evidence
 * with additional fields needed for narrative template expansion and SPRS calculation.
 */

export type DirectiveType =
  | 'implement'
  | 'validate'
  | 'manual'
  | 'document-absence'
  | 'document-prohibition'
  | 'skip'
  | 'inherit-fedramp';

export type DirectiveReadiness = 'met' | 'not-met' | 'unknown';

/**
 * Extended directive metadata interface.
 * Superset of the base DirectiveMetadata from ces-shared/types/evidence,
 * adding optional narrative template fields populated by Stamper from artifacts.
 */
export interface ExtendedDirectiveMetadata {
  control_id: string;
  directive: DirectiveType;
  readiness: DirectiveReadiness;
  platform_inherited: boolean;
  evidence_artifacts: string[];
  enforcement_verified: boolean;
  narrative_stub: string;
  reasoning_trace: string;

  // Optional fields for narrative template expansion (Stamper-provided)
  baseline_date?: string;
  verification_date?: string;
  policy_reference?: string;
  enforcement_mechanism?: string;
  configuration_reference?: string;
  monitoring_mechanism?: string;
  service_line?: string;
  crm_reference?: string;
  fedramp_package_id?: string;
  tenant_variant_confirmed?: string;
}

const VALID_DIRECTIVES: ReadonlySet<string> = new Set<DirectiveType>([
  'implement',
  'validate',
  'manual',
  'document-absence',
  'document-prohibition',
  'skip',
  'inherit-fedramp',
]);

/**
 * Validate whether a string is a valid DirectiveType value.
 */
export function isValidDirective(d: string): d is DirectiveType {
  return VALID_DIRECTIVES.has(d);
}

/**
 * Cast a base DirectiveMetadata (with string directive/readiness) to ExtendedDirectiveMetadata.
 * Returns null if the directive value is not a recognized DirectiveType.
 * Throws if the directive value is present but invalid (per plan: halt on invalid directive).
 */
export function toExtendedDirectiveMetadata(
  raw: { directive: string; readiness: string; [key: string]: unknown }
): ExtendedDirectiveMetadata {
  if (!isValidDirective(raw.directive)) {
    throw new Error(
      `Invalid directive value '${raw.directive}' for control ${raw.control_id ?? 'unknown'}. ` +
      `Valid values: implement, validate, manual, document-absence, document-prohibition, skip, inherit-fedramp.`
    );
  }

  const readiness: DirectiveReadiness =
    raw.readiness === 'met' || raw.readiness === 'not-met' || raw.readiness === 'unknown'
      ? raw.readiness
      : 'unknown';

  return {
    control_id: String(raw.control_id ?? ''),
    directive: raw.directive,
    readiness,
    platform_inherited: Boolean(raw.platform_inherited),
    evidence_artifacts: Array.isArray(raw.evidence_artifacts)
      ? raw.evidence_artifacts.map(String)
      : [],
    enforcement_verified: Boolean(raw.enforcement_verified),
    narrative_stub: String(raw.narrative_stub ?? ''),
    reasoning_trace: String(raw.reasoning_trace ?? ''),
    baseline_date: raw.baseline_date != null ? String(raw.baseline_date) : undefined,
    verification_date: raw.verification_date != null ? String(raw.verification_date) : undefined,
    policy_reference: raw.policy_reference != null ? String(raw.policy_reference) : undefined,
    enforcement_mechanism: raw.enforcement_mechanism != null ? String(raw.enforcement_mechanism) : undefined,
    configuration_reference: raw.configuration_reference != null ? String(raw.configuration_reference) : undefined,
    monitoring_mechanism: raw.monitoring_mechanism != null ? String(raw.monitoring_mechanism) : undefined,
    service_line: raw.service_line != null ? String(raw.service_line) : undefined,
    crm_reference: raw.crm_reference != null ? String(raw.crm_reference) : undefined,
    fedramp_package_id: raw.fedramp_package_id != null ? String(raw.fedramp_package_id) : undefined,
    tenant_variant_confirmed: raw.tenant_variant_confirmed != null ? String(raw.tenant_variant_confirmed) : undefined,
  };
}
