// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { TenantConfigProfileOutput } from '@/shared/types/artifacts';
import type { TCPAnswer, TCPQuestionDef, TCPSectionDef } from '../types';

/**
 * Reverse-maps a compiled TenantConfigProfileOutput back to raw TCPAnswer objects
 * using bindings.tenant_config paths from the question bank.
 */

const CLOUD_ENVIRONMENT_REVERSE: Record<string, string> = {
  gcc_high: 'GCC High',
  dod: 'DoD',
  gcc: 'GCC',
  commercial: 'Commercial',
};

const IDENTITY_PROVIDER_REVERSE: Record<string, string> = {
  entra_native: 'Entra ID native (cloud-only)',
  hybrid_ad_connect: 'Hybrid with AD Connect',
  hybrid_cloud_sync: 'Hybrid with Cloud Sync',
  external_idp: 'External IdP (Okta, Ping, etc.)',
};

const ENROLLMENT_TYPE_REVERSE: Record<string, string> = {
  azure_ad_join: 'Azure AD Join',
  hybrid_join: 'Hybrid Join',
  enroll_only: 'Enroll Only (BYOD MDM)',
  none: 'None',
};

const GROUP_STRATEGY_REVERSE: Record<string, string> = {
  dynamic: 'Dynamic (attribute-based)',
  assigned: 'Assigned (manual)',
  mixed: 'Mixed (both)',
};

function resolveBindingPath(profile: TenantConfigProfileOutput, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = profile.tenant_config;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function reverseNamedLocations(
  locations: Array<{ name: string; type: string; value: string }>,
): string {
  if (!Array.isArray(locations) || locations.length === 0) return '';
  return locations.map((loc) => `${loc.name}|${loc.type}|${loc.value}`).join('\n');
}

function reverseKeyGroups(groups: Record<string, string>): string {
  if (!groups || typeof groups !== 'object') return '';
  const entries = Object.entries(groups);
  if (entries.length === 0) return '';
  return entries.map(([name, role]) => `${name}=${role}`).join('\n');
}

function reverseServiceActivations(
  activations: Record<string, boolean>,
  question: TCPQuestionDef,
): string[] {
  if (!activations || typeof activations !== 'object') return [];
  const result: string[] = [];
  for (const option of question.options) {
    if (option === 'None') continue;
    const snakeKey = toSnakeCase(option);
    if (activations[snakeKey] === true) {
      result.push(option);
    }
  }
  return result;
}

export function reverseNormalizeValue(
  path: string,
  value: unknown,
  question: TCPQuestionDef,
): string | number | boolean | string[] | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    return null;
  }

  // Enum reverse mappings based on binding path
  if (path === 'identity.cloud_environment') {
    return CLOUD_ENVIRONMENT_REVERSE[value as string] ?? null;
  }
  if (path === 'identity_architecture.identity_provider') {
    return IDENTITY_PROVIDER_REVERSE[value as string] ?? null;
  }
  if (path === 'device_management.enrollment_type') {
    return ENROLLMENT_TYPE_REVERSE[value as string] ?? null;
  }
  if (path === 'group_architecture.group_strategy') {
    return GROUP_STRATEGY_REVERSE[value as string] ?? null;
  }

  // Structured object reverse mappings
  if (path === 'conditional_access.named_locations') {
    const reversed = reverseNamedLocations(
      value as Array<{ name: string; type: string; value: string }>,
    );
    return reversed || null;
  }
  if (path === 'group_architecture.key_groups') {
    const reversed = reverseKeyGroups(value as Record<string, string>);
    return reversed || null;
  }
  if (path === 'licensing.service_activations') {
    const reversed = reverseServiceActivations(value as Record<string, boolean>, question);
    return reversed.length > 0 ? reversed : null;
  }

  // Arrays pass through
  if (Array.isArray(value)) {
    return value.map(String);
  }

  // Primitives pass through
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return null;
}

export function reverseMapProfile(
  profile: TenantConfigProfileOutput,
  sections: TCPSectionDef[],
): Record<string, TCPAnswer> {
  const result: Record<string, TCPAnswer> = {};
  const now = new Date().toISOString();

  for (const section of sections) {
    for (const question of section.questions) {
      const bindingPath = question.bindings.tenant_config;
      if (!bindingPath) continue;

      const rawValue = resolveBindingPath(profile, bindingPath);
      const reversed = reverseNormalizeValue(bindingPath, rawValue, question);
      if (reversed === null) continue;

      result[question.id] = {
        question_id: question.id,
        answer_type: question.answer_type,
        raw_answer: reversed,
        captured_at: now,
        provenance_class: 'previous_run',
      };
    }
  }

  return result;
}
