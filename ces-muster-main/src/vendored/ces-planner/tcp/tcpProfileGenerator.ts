// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { TenantConfigProfileOutput } from '../shared/types/artifacts';
import type { TCPAnswer, TCPSectionDef } from './types';

/**
 * Maps TCP wizard answers → typed TenantConfigProfileOutput.
 * Uses bindings.tenant_config dot-paths to resolve nested artifact paths.
 */

function normalizeCloudEnvironment(
  raw: string,
): TenantConfigProfileOutput['tenant_config']['identity']['cloud_environment'] {
  const lower = String(raw).toLowerCase().replace(/\s+/g, '_');
  if (lower.includes('gcc_high') || lower.includes('gcc high')) return 'gcc_high';
  if (lower.includes('dod')) return 'dod';
  if (lower.includes('gcc')) return 'gcc';
  return 'commercial';
}

function normalizeIdentityProvider(
  raw: string,
): TenantConfigProfileOutput['tenant_config']['identity_architecture']['identity_provider'] {
  const lower = String(raw).toLowerCase();
  if (lower.includes('ad connect')) return 'hybrid_ad_connect';
  if (lower.includes('cloud sync')) return 'hybrid_cloud_sync';
  if (lower.includes('external') || lower.includes('okta') || lower.includes('ping'))
    return 'external_idp';
  return 'entra_native';
}

function normalizeEnrollmentType(
  raw: string,
): TenantConfigProfileOutput['tenant_config']['device_management']['enrollment_type'] {
  const lower = String(raw).toLowerCase();
  if (lower.includes('hybrid')) return 'hybrid_join';
  if (lower.includes('enroll') || lower.includes('byod')) return 'enroll_only';
  if (lower.includes('none')) return 'none';
  return 'azure_ad_join';
}

function normalizeGroupStrategy(
  raw: string,
): TenantConfigProfileOutput['tenant_config']['group_architecture']['group_strategy'] {
  const lower = String(raw).toLowerCase();
  if (lower.includes('dynamic')) return 'dynamic';
  if (lower.includes('mixed') || lower.includes('both')) return 'mixed';
  return 'assigned';
}

function parseNamedLocations(
  lines: string[],
): TenantConfigProfileOutput['tenant_config']['conditional_access']['named_locations'] {
  return lines
    .filter((l) => l.includes('|'))
    .map((line) => {
      const [name, type, value] = line.split('|').map((s) => s.trim());
      return {
        name: name || '',
        type: (type === 'country' ? 'country' : 'ip') as 'ip' | 'country',
        value: value || '',
      };
    });
}

function parseKeyGroups(lines: string[]): Record<string, string> {
  const groups: Record<string, string> = {};
  for (const line of lines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const name = line.slice(0, eqIdx).trim();
      const role = line.slice(eqIdx + 1).trim();
      groups[name] = role;
    }
  }
  return groups;
}

function parseServiceActivations(selected: string[]): Record<string, boolean> {
  const activations: Record<string, boolean> = {};
  for (const svc of selected) {
    if (svc === 'None') continue;
    const key = svc
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    activations[key] = true;
  }
  return activations;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'yes' || value === 'true';
  return false;
}

export function generateTenantConfigProfile(
  answers: Record<string, TCPAnswer>,
  sections: TCPSectionDef[],
  bankVersion: string,
): TenantConfigProfileOutput {
  // Build a flat map of binding path → raw_answer
  const bindingMap = new Map<string, unknown>();
  for (const section of sections) {
    for (const question of section.questions) {
      const answer = answers[question.id];
      if (!answer) continue;
      if (question.bindings.tenant_config) {
        bindingMap.set(question.bindings.tenant_config, answer.raw_answer);
      }
    }
  }

  const get = (path: string): unknown => bindingMap.get(path);
  const str = (path: string, fallback = ''): string => {
    const v = get(path);
    return v != null ? String(v) : fallback;
  };
  const num = (path: string, fallback = 0): number => {
    const v = get(path);
    return typeof v === 'number' ? v : fallback;
  };

  return {
    ces: {
      artifact: 'tenant_config_profile',
      version: '1.0',
      generated_on: new Date().toISOString().slice(0, 10),
      tcp_bank_version: bankVersion,
    },
    tenant_config: {
      identity: {
        tenant_id: str('identity.tenant_id'),
        primary_domain: str('identity.primary_domain'),
        custom_domains: toStringArray(get('identity.custom_domains')),
        cloud_environment: normalizeCloudEnvironment(str('identity.cloud_environment')),
        display_name: str('identity.display_name'),
      },
      licensing: {
        primary_sku: str('licensing.primary_sku'),
        license_count: num('licensing.license_count'),
        addon_skus: toStringArray(get('licensing.addon_skus')),
        service_activations: parseServiceActivations(
          toStringArray(get('licensing.service_activations')),
        ),
      },
      identity_architecture: {
        break_glass_accounts: toStringArray(get('identity_architecture.break_glass_accounts')),
        admin_naming_convention: str('identity_architecture.admin_naming_convention'),
        service_account_naming_convention: str(
          'identity_architecture.service_account_naming_convention',
        ),
        identity_provider: normalizeIdentityProvider(
          str('identity_architecture.identity_provider'),
        ),
        directory_sync_enabled: toBoolean(get('identity_architecture.directory_sync_enabled')),
      },
      privileged_access: {
        global_admins: toStringArray(get('privileged_access.global_admins')),
        security_admins: toStringArray(get('privileged_access.security_admins')),
        compliance_admins: toStringArray(get('privileged_access.compliance_admins')),
        pim_enabled: toBoolean(get('privileged_access.pim_enabled')),
        break_glass_exclusion_group: str('privileged_access.break_glass_exclusion_group'),
      },
      group_architecture: {
        security_group_convention: str('group_architecture.security_group_convention'),
        key_groups: parseKeyGroups(toStringArray(get('group_architecture.key_groups'))),
        distribution_group_convention: str('group_architecture.distribution_group_convention'),
        group_strategy: normalizeGroupStrategy(str('group_architecture.group_strategy')),
      },
      conditional_access: {
        ca_naming_convention: str('conditional_access.ca_naming_convention'),
        named_locations: parseNamedLocations(
          toStringArray(get('conditional_access.named_locations')),
        ),
        existing_policy_count: num('conditional_access.existing_policy_count'),
      },
      device_management: {
        enrollment_type: normalizeEnrollmentType(str('device_management.enrollment_type')),
        device_naming_convention: str('device_management.device_naming_convention'),
        compliance_policy_convention: str('device_management.compliance_policy_convention'),
        platforms_in_scope: toStringArray(get('device_management.platforms_in_scope')).filter(
          (s) => s !== 'None',
        ),
      },
      data_protection: {
        sensitivity_label_convention: str('data_protection.sensitivity_label_convention'),
        cui_sharepoint_sites: toStringArray(get('data_protection.cui_sharepoint_sites')),
        cui_teams_channels: toStringArray(get('data_protection.cui_teams_channels')),
        dlp_policy_convention: str('data_protection.dlp_policy_convention'),
      },
      monitoring: {
        sentinel_workspace_name: str('monitoring.sentinel_workspace_name'),
        sentinel_resource_group: str('monitoring.sentinel_resource_group'),
        log_analytics_workspace_id: str('monitoring.log_analytics_workspace_id'),
        data_connectors: toStringArray(get('monitoring.data_connectors')).filter(
          (s) => s !== 'None',
        ),
        alert_rule_convention: str('monitoring.alert_rule_convention'),
      },
    },
  };
}
