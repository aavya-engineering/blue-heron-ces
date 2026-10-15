// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type {
  TechRefCMMCL2,
  TechRefControl,
  TechRefServiceSection,
  TechRefParagraph,
} from '@/shared/types/domain';

// ---------------------------------------------------------------------------
// Service name normalization
// ---------------------------------------------------------------------------

/**
 * Maps playbook service tokens (lowercase) to tech ref canonical service names.
 * The playbook uses short/combined names ("Entra ID", "Intune + Defender for
 * Endpoint") while the tech ref uses full official names ("Microsoft Entra ID",
 * "Intune/Intune Suite").
 */
const SERVICE_ALIASES: Record<string, string> = {
  'entra id': 'Microsoft Entra ID',
  'entra id governance': 'Microsoft Entra ID',
  'entra id pim': 'Privileged Identity Management (PIM)',
  'intune': 'Intune/Intune Suite',
  'sentinel': 'Microsoft Sentinel',
  'microsoft sentinel': 'Microsoft Sentinel',
  'defender for endpoint': 'Microsoft Defender for Endpoint',
  'defender xdr': 'Microsoft 365 Defender',
  'defender for office 365': 'Microsoft Defender for Office 365',
  'pim': 'Privileged Identity Management (PIM)',
  'conditional access': 'Conditional Access',
  'compliance manager': 'M365 Compliance Center',
  'purview': 'Microsoft Purview',
  'purview dlp': 'Microsoft Purview',
  'purview information protection': 'Microsoft Purview',
  'purview sensitivity labels': 'Microsoft Purview',
  'purview message encryption': 'Office 365 Message Encryption (OME)',
  'purview insider risk management': 'Insider Risk Management',
  'sensitivity labels': 'Microsoft Purview',
  'azure key vault': 'Azure Key Vault',
  'azure bastion': 'Azure Bastion',
  'azure firewall': 'Azure Firewall',
  'azure firewall + nsgs': 'Azure Firewall',
  'microsoft secure score': 'Secure Score',
  'secure score': 'Secure Score',
  'azure': 'Azure RBAC',
  'azure monitor': 'Azure Monitor',
  'azure devops': 'Azure Automation',
  'azure backup': 'Azure Storage',
  'azure vpn gateway': 'VPN Gateway',
  'azure virtual networks': 'Virtual Network',
  'azure virtual networks + nsgs': 'Virtual Network',
  'azure private link': 'Virtual Network',
  'nsgs': 'Network Security Groups',
  'bitlocker': 'Bitlocker',
  'azure storage encryption': 'Azure Storage',
  'sharepoint online': 'Microsoft 365 Web Apps',
  'microsoft teams admin': 'Teams',
  'unified audit log': 'Log Analytics Workspace',
  'windows update for business': 'Intune/Intune Suite',
  'defender vulnerability management': 'Threat and Vulnerability Management',
  'windows': 'Intune/Intune Suite',
  'm365': 'Microsoft 365 Admin Center',
  'viva learning': 'Microsoft Learn',
  'defender for cloud apps': 'Microsoft Defender for Cloud Apps',
};

/**
 * Services available in E3/G3 licensing. Any playbook service that maps to a
 * tech ref service NOT in this set is considered E5-gated.
 */
const E3_INCLUDED_SERVICES = new Set([
  'Microsoft Entra ID',
  'Conditional Access',
  'Intune/Intune Suite',
  'Azure RBAC',
  'Secure Score',
  'M365 Compliance Center',
  'Azure Key Vault',
  'Azure Firewall',
  'Azure Bastion',
  'Azure Monitor',
  'Azure Storage',
  'Virtual Network',
  'Network Security Groups',
  'VPN Gateway',
  'Microsoft 365 Admin Center',
  'Microsoft 365 Web Apps',
  'Microsoft 365 Groups',
  'Teams',
  'Microsoft Entra ID Multi-Factor Authentication',
  'Bitlocker',
  'Log Analytics Workspace',
  'Azure Datacenter',
  'Azure Virtual Machines',
  'Microsoft Learn',
  'Microsoft Graph',
  'Azure Automation',
  'Customer Lockbox',
  'Named Locations',
  'Office 365 Message Encryption (OME)',
  'Microsoft Purview',
  'Microsoft Defender for Office 365',
]);

function normalizeServiceToken(token: string): string | undefined {
  const key = token.trim().toLowerCase();
  return SERVICE_ALIASES[key];
}

function resolveCanonicalServices(playbookService: string): string[] {
  // Try direct alias match first
  const directAlias = normalizeServiceToken(playbookService);
  if (directAlias) return [directAlias];

  // Split on " + " for compound services
  const tokens = playbookService.split(/\s*\+\s*/);
  const resolved: string[] = [];
  for (const token of tokens) {
    const canonical = normalizeServiceToken(token);
    if (canonical) resolved.push(canonical);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// TechRefIndex interface + builder
// ---------------------------------------------------------------------------

export interface TechRefIndex {
  byControl: Map<string, TechRefControl>;
  serviceToControls: Map<string, Set<string>>;
  cspManaged: Set<string>;
  getControl(practiceId: string): TechRefControl | undefined;
  getGuidance(practiceId: string, playbookService: string): TechRefServiceSection | undefined;
  getGcchResponsibilities(practiceId: string): TechRefParagraph[] | undefined;
  isE5Service(playbookService: string): boolean;
}

export function buildTechRefIndex(techRef: TechRefCMMCL2): TechRefIndex {
  const byControl = new Map<string, TechRefControl>();
  const nistRefMap = new Map<string, TechRefControl>();
  const cspManaged = new Set<string>();

  // Index all controls
  for (const family of techRef.control_families) {
    for (const control of family.controls) {
      byControl.set(control.control_id, control);
      nistRefMap.set(control.nist_sp_800_171_ref, control);

      if (control.note && control.note.toLowerCase().includes('csp-managed')) {
        cspManaged.add(control.control_id);
      }
    }
  }

  // Build service-to-controls index
  const serviceToControls = new Map<string, Set<string>>();
  for (const [serviceName, controlIds] of Object.entries(techRef.service_to_control_mapping.services)) {
    serviceToControls.set(serviceName, new Set(controlIds));
  }

  function getControl(practiceId: string): TechRefControl | undefined {
    // Direct lookup by control_id
    const direct = byControl.get(practiceId);
    if (direct) return direct;

    // Fallback: extract NIST ref from practice ID (e.g. "AC.L1-3.1.1" → "3.1.1")
    const nistMatch = practiceId.match(/\d+\.\d+\.\d+/);
    if (nistMatch) {
      return nistRefMap.get(nistMatch[0]);
    }
    return undefined;
  }

  function getGuidance(
    practiceId: string,
    playbookService: string
  ): TechRefServiceSection | undefined {
    const control = getControl(practiceId);
    if (!control || control.implementation_by_service.length === 0) return undefined;

    const canonicalNames = resolveCanonicalServices(playbookService);
    if (canonicalNames.length === 0) return undefined;

    // Find first matching implementation section
    for (const canonical of canonicalNames) {
      const lowerCanonical = canonical.toLowerCase();
      for (const section of control.implementation_by_service) {
        if (section.service_name.toLowerCase().includes(lowerCanonical) ||
            lowerCanonical.includes(section.service_name.toLowerCase())) {
          return section;
        }
      }
      // Exact match fallback
      const exact = control.implementation_by_service.find(
        (s) => s.service_name === canonical
      );
      if (exact) return exact;
    }

    return undefined;
  }

  function getGcchResponsibilities(practiceId: string): TechRefParagraph[] | undefined {
    const control = getControl(practiceId);
    return control?.customer_responsibilities?.gcch;
  }

  function isE5Service(playbookService: string): boolean {
    if (playbookService === 'N/A') return false;

    const canonicalNames = resolveCanonicalServices(playbookService);
    if (canonicalNames.length === 0) return false;

    // If any resolved service is NOT in the E3 set, the action is E5-gated
    return canonicalNames.some((name) => !E3_INCLUDED_SERVICES.has(name));
  }

  return {
    byControl,
    serviceToControls,
    cspManaged,
    getControl,
    getGuidance,
    getGcchResponsibilities,
    isE5Service,
  };
}
