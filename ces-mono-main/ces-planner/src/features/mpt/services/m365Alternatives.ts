// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// M365-native alternative implementations for 9 controls that cannot be satisfied M365-only.
// NIST 800-171 Rev 2 is frozen for CMMC L2 — control IDs are stable.

export interface AlternativeImplementation {
  azure_approach: string;
  m365_alternative: string;
  gap_severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export const SENTINEL_SATISFIED_CONTROLS: Set<string> = new Set([
  'AU.L2-3.3.3',
  'AU.L2-3.3.4',
  'IR.L2-3.6.2',
]);

export const M365_ALTERNATIVES: Record<string, AlternativeImplementation> = {
  'AU.L2-3.3.4': {
    azure_approach: 'Sentinel alerting on Log Analytics workspace heartbeat failure',
    m365_alternative:
      'Defender XDR custom detection rules monitoring Purview Audit log ingestion gaps + Power Automate email alerts. Alert rule: "If no Purview Audit events in 60 minutes, notify SOC mailbox."',
    gap_severity: 'MEDIUM',
  },
  'SC.L1-3.13.1': {
    azure_approach: 'NSG flow logs + Azure Firewall + Sentinel',
    m365_alternative:
      'Conditional Access policies as boundary enforcement + Defender for Cloud Apps session policies. Tenant boundary IS the security boundary. Document: "External boundary = M365 tenant edge with Conditional Access as access control point."',
    gap_severity: 'LOW',
  },
  'SC.L1-3.13.5': {
    azure_approach: 'VNet segregation with dedicated subnet',
    m365_alternative:
      'SharePoint external sharing policies + Conditional Access named locations limiting external collaboration sites to specific IP ranges. Separate SharePoint site collections for public content with restrictive DLP.',
    gap_severity: 'MEDIUM',
  },
  'SC.L2-3.13.6': {
    azure_approach: 'NSG default deny rules',
    m365_alternative:
      'Conditional Access "block all access" baseline + exception grants for trusted devices/locations/users. Intune compliance enforcing "deny non-compliant device access."',
    gap_severity: 'LOW',
  },
  'SC.L2-3.13.10': {
    azure_approach: 'Azure Key Vault with HSM-backed keys',
    m365_alternative:
      'Entra ID Certificate-Based Authentication + Microsoft Cloud PKI (G5 2026 feature) for device certificates. Customer-managed keys for SharePoint/Exchange at-rest encryption (requires G5 + compliance add-on).',
    gap_severity: 'HIGH',
  },
  'SI.L2-3.14.7': {
    azure_approach: 'Sentinel UEBA + Azure AD sign-in analytics',
    m365_alternative:
      'Entra ID Identity Protection risk-based Conditional Access + Defender for Cloud Apps anomaly detection (impossible travel, unusual file access). Purview Insider Risk Management for data exfiltration.',
    gap_severity: 'MEDIUM',
  },
  'AU.L2-3.3.3': {
    azure_approach: 'Sentinel retention policies + automated audit log review',
    m365_alternative:
      'Purview Audit Premium search with saved queries + Defender XDR Advanced Hunting scheduled queries for authentication failures, privilege escalations, DLP violations. Export to SharePoint for quarterly review.',
    gap_severity: 'LOW',
  },
  'IR.L2-3.6.2': {
    azure_approach: 'Sentinel incident tracking with auto-assignment and SLA',
    m365_alternative:
      'Defender XDR incident queue + integration with ServiceNow/Jira via Graph API for formal IR ticketing. Manual IR documentation in SharePoint IR library with Purview legal hold.',
    gap_severity: 'MEDIUM',
  },
  'SC.L2-3.13.2': {
    azure_approach: 'Azure Advisor security recommendations + Secure Score',
    m365_alternative:
      'Microsoft Secure Score for M365 + Compliance Manager CMMC template. Quarterly architecture review using Secure Score improvement actions. Document principles in System Security Plan (manual).',
    gap_severity: 'LOW',
  },
};

export function getApplicableM365Alternatives(
  infrastructureModel: string,
): Map<string, AlternativeImplementation> {
  if (infrastructureModel === 'm365_only') {
    return new Map(Object.entries(M365_ALTERNATIVES));
  }
  if (infrastructureModel === 'm365_sentinel') {
    const filtered = new Map<string, AlternativeImplementation>();
    for (const [key, value] of Object.entries(M365_ALTERNATIVES)) {
      if (!SENTINEL_SATISFIED_CONTROLS.has(key)) {
        filtered.set(key, value);
      }
    }
    return filtered;
  }
  return new Map();
}
