// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type {
  PreambleAnswers,
  ActionStatus,
  DerivationSource,
  DerivedActionStatus,
  RRTAnswer,
} from '../types';
import type {
  PlaybookEntry,
  ImplementationPatterns,
  VendorPlaybook,
} from '@/shared/types/domain';
import type { TechRefIndex } from '@/shared/services/techRefIndex';
import type { BTCRiskFlag } from '@/shared/types/artifacts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** M365 services that require E5 / GCC-G5 licensing */
const E5_REQUIRED_SERVICES = new Set([
  'Microsoft Sentinel',
  'Microsoft Defender for Endpoint P2',
  'Microsoft Defender for Identity',
  'Microsoft Purview DLP',
  'Microsoft Purview Information Protection',
  'Privileged Identity Management',
  'Azure AD Identity Protection',
  'Entra ID Protection',
  'Defender for Cloud Apps',
  'Microsoft Defender for Office 365 P2',
]);

const E5_TIER_SET = new Set(['e5', 'gcc_g5']);

/** Physical-security CMMC domains gated by cloud-only deployment */
const PE_DOMAIN = 'PE';

/** Capabilities related to endpoint management */
const ENDPOINT_CAPABILITIES = new Set([
  'endpoint_management',
  'endpoint_protection',
  'device_compliance',
]);

/** M365 services related to endpoint management */
const ENDPOINT_SERVICES = new Set([
  'Microsoft Intune',
  'Intune',
  'Microsoft Defender for Endpoint',
  'Microsoft Defender for Endpoint P2',
]);

/** Capabilities related to monitoring / SIEM */
const MONITORING_CAPABILITIES = new Set([
  'security_monitoring_logging',
  'security_monitoring',
  'audit_logging',
  'incident_response',
]);

/** M365 services related to SIEM */
const SIEM_SERVICES = new Set(['Microsoft Sentinel', 'Sentinel']);

/** M365 services related to policy / compliance docs */
const POLICY_SERVICES = new Set(['Compliance Manager', 'Microsoft Purview Compliance Manager']);

// ---------------------------------------------------------------------------
// Archetype default lookup
// ---------------------------------------------------------------------------

type SignalType = 'configure' | 'customize' | 'manual';

interface ArchetypeDefaults {
  configure: ActionStatus;
  customize: ActionStatus;
  manual: ActionStatus;
  /** Capability-specific overrides: capability → { signal → status } */
  overrides?: Record<string, Partial<Record<SignalType, ActionStatus>>>;
}

const ARCHETYPE_DEFAULTS: Record<string, ArchetypeDefaults> = {
  greenfield: {
    configure: 'not_implemented',
    customize: 'not_implemented',
    manual: 'not_implemented',
  },
  security_defaults_only: {
    configure: 'not_implemented',
    customize: 'not_implemented',
    manual: 'not_implemented',
    overrides: {
      identity_access_management: { configure: 'partial' },
    },
  },
  basic_ca_policies: {
    configure: 'partial',
    customize: 'not_implemented',
    manual: 'not_implemented',
    overrides: {
      identity_access_management: { configure: 'implemented', customize: 'partial' },
    },
  },
  moderate_hardening: {
    configure: 'partial',
    customize: 'partial',
    manual: 'not_implemented',
    overrides: {
      identity_access_management: { configure: 'implemented', customize: 'implemented' },
      endpoint_management: { configure: 'implemented' },
      endpoint_protection: { configure: 'implemented' },
    },
  },
  managed_by_msp: {
    configure: 'partial',
    customize: 'partial',
    manual: 'partial',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractLevel(practiceId: string): string | null {
  const m = practiceId.match(/\.L(\d)/);
  return m ? `L${m[1]}` : null;
}

function extractDomain(practiceId: string): string {
  return practiceId.split('.')[0];
}

function targetLevelNum(siBaseline: any): number {
  const level =
    siBaseline?.si_baseline?.target?.target_cmmc_level ??
    siBaseline?.ces?.target?.target_cmmc_level ??
    'L2';
  return parseInt(level.replace('L', ''), 10) || 2;
}

function hasCUI(siBaseline: any): boolean {
  const cui =
    siBaseline?.si_baseline?.scope?.cui_presence ??
    siBaseline?.ces?.scope?.cui_presence;
  return cui !== 'no_cui';
}

function isCloudOnly(siBaseline: any): boolean {
  const posture =
    siBaseline?.si_baseline?.scope?.deployment_posture ??
    siBaseline?.ces?.scope?.deployment_posture;
  return posture === 'cloud_only';
}

function isBYODNotAllowed(siBaseline: any): boolean {
  const byod =
    siBaseline?.si_baseline?.scope?.byod_posture ??
    siBaseline?.ces?.scope?.byod_posture;
  return byod === 'not_allowed';
}

function isInherent(playbook: PlaybookEntry | undefined): boolean {
  if (!playbook) return false;
  const combined = `${playbook.implementation ?? ''} ${playbook.notes ?? ''}`.toLowerCase();
  return combined.includes('inherent');
}

function isMobileAction(playbook: PlaybookEntry | undefined): boolean {
  if (!playbook) return false;
  const combined =
    `${playbook.implementation ?? ''} ${playbook.m365_service ?? ''}`.toLowerCase();
  return combined.includes('mobile') || combined.includes('byod');
}

// ---------------------------------------------------------------------------
// Preamble status resolution helpers
// ---------------------------------------------------------------------------

function resolveEndpointStatus(
  preamble: PreambleAnswers,
  signal: SignalType
): ActionStatus | null {
  switch (preamble.endpoint_management) {
    case 'intune_enrolled':
      return signal === 'configure' ? 'implemented' : 'partial';
    case 'third_party_mdm':
      return 'partial';
    case 'mixed':
      return 'partial';
    case 'unmanaged':
      return 'not_implemented';
    default:
      return null;
  }
}

function resolveMonitoringStatus(
  preamble: PreambleAnswers,
  signal: SignalType
): ActionStatus | null {
  switch (preamble.monitoring_siem) {
    case 'sentinel_deployed':
      return signal === 'configure' ? 'implemented' : 'partial';
    case 'third_party_siem':
      return 'partial';
    case 'basic_m365_audit':
      return signal === 'configure' ? 'partial' : 'not_implemented';
    case 'none':
      return 'not_implemented';
    default:
      return null;
  }
}

function resolvePolicyStatus(preamble: PreambleAnswers): ActionStatus | null {
  switch (preamble.policy_doc_state) {
    case 'ssp_with_policies':
      return 'implemented';
    case 'some_policies_drafted':
      return 'partial';
    case 'nothing_written':
      return 'not_implemented';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main derivation function
// ---------------------------------------------------------------------------

/**
 * Derive action statuses for every implementation action by running a 6-step
 * cascade. First matching rule wins.
 */
export function deriveActionStatuses(
  patterns: ImplementationPatterns,
  playbook: VendorPlaybook,
  preamble: PreambleAnswers,
  siBaseline: any,
  techRefIndex?: TechRefIndex,
  btcRiskFlags?: BTCRiskFlag[]
): DerivedActionStatus[] {
  const playbookMap = new Map<string, PlaybookEntry>();
  for (const entry of playbook.playbook) {
    playbookMap.set(entry.action_id, entry);
  }

  const targetLevel = targetLevelNum(siBaseline);
  const cuiPresent = hasCUI(siBaseline);
  const cloudOnly = isCloudOnly(siBaseline);
  const byodBlocked = isBYODNotAllowed(siBaseline);

  const results: DerivedActionStatus[] = [];

  for (const pattern of patterns.patterns) {
    const practiceLevel = extractLevel(pattern.practice_id);
    const practiceLevelNum = practiceLevel
      ? parseInt(practiceLevel.replace('L', ''), 10)
      : 2;
    const domain = extractDomain(pattern.practice_id);

    for (const action of pattern.actions) {
      const pb = playbookMap.get(action.id);
      const signal: SignalType = pb?.signal ?? 'manual';
      const m365Service = pb?.m365_service ?? 'N/A';

      const base: Omit<DerivedActionStatus, 'status' | 'derivation_source' | 'derivation_reason'> =
        {
          action_id: action.id,
          practice_id: pattern.practice_id,
          capability: pattern.capability,
          action_text: action.action,
          action_type: action.action_type,
          signal,
          m365_service: m365Service,
          overridden: false,
          mapped_requirements: [pattern.practice_id],
        };

      const derived = applyCascade(
        base,
        pb,
        preamble,
        siBaseline,
        targetLevel,
        practiceLevelNum,
        domain,
        cuiPresent,
        cloudOnly,
        byodBlocked,
        techRefIndex,
        btcRiskFlags
      );

      results.push(derived);
    }
  }

  return results;
}

function applyCascade(
  base: Omit<DerivedActionStatus, 'status' | 'derivation_source' | 'derivation_reason'>,
  pb: PlaybookEntry | undefined,
  preamble: PreambleAnswers,
  _siBaseline: any,
  targetLevel: number,
  practiceLevelNum: number,
  domain: string,
  cuiPresent: boolean,
  cloudOnly: boolean,
  byodBlocked: boolean,
  techRefIndex?: TechRefIndex,
  btcRiskFlags?: BTCRiskFlag[]
): DerivedActionStatus {
  // 1. License gate
  if (preamble.license_tier !== 'unknown' && pb) {
    const hasE5 = E5_TIER_SET.has(preamble.license_tier);
    const e5Gated = techRefIndex
      ? techRefIndex.isE5Service(pb.m365_service)
      : E5_REQUIRED_SERVICES.has(pb.m365_service);
    if (!hasE5 && e5Gated) {
      return {
        ...base,
        status: 'not_applicable',
        derivation_source: 'license_gate',
        derivation_reason: `${pb.m365_service} requires E5/GCC-G5 licensing`,
      };
    }
  }

  // 2. Scope gate
  if (practiceLevelNum > targetLevel) {
    return {
      ...base,
      status: 'not_applicable',
      derivation_source: 'scope_gate',
      derivation_reason: `L${practiceLevelNum} practice exceeds target L${targetLevel}`,
    };
  }
  if (!cuiPresent && practiceLevelNum >= 2) {
    const cuiDomains = new Set(['MP', 'SC', 'SI']);
    if (cuiDomains.has(domain)) {
      return {
        ...base,
        status: 'not_applicable',
        derivation_source: 'scope_gate',
        derivation_reason: `CUI-specific practice in ${domain} domain; no CUI present`,
      };
    }
  }

  // 3. Inherent check
  if (isInherent(pb)) {
    return {
      ...base,
      status: 'implemented',
      derivation_source: 'inherent',
      derivation_reason: 'Capability is inherent to the platform',
    };
  }

  // 4. SI overrides
  if (cloudOnly && domain === PE_DOMAIN) {
    return {
      ...base,
      status: 'not_applicable',
      derivation_source: 'si_override',
      derivation_reason: 'Cloud-only deployment; physical security N/A',
    };
  }
  if (techRefIndex?.cspManaged.has(base.practice_id)) {
    return {
      ...base,
      status: 'implemented',
      derivation_source: 'inherent',
      derivation_reason: 'CSP-managed (Microsoft datacenter)',
    };
  }
  if (byodBlocked && isMobileAction(pb)) {
    return {
      ...base,
      status: 'not_applicable',
      derivation_source: 'si_override',
      derivation_reason: 'BYOD not allowed; mobile action N/A',
    };
  }

  // 4.5 BTC risk flag gate — downgrades only
  if (btcRiskFlags && btcRiskFlags.length > 0) {
    const domainLower = domain.toLowerCase();
    const matchedFlag = btcRiskFlags.find(
      (flag) =>
        flag.domain.toLowerCase() === domainLower &&
        (flag.severity.toLowerCase().includes('high') ||
          flag.severity.toLowerCase().includes('critical'))
    );
    if (matchedFlag) {
      return {
        ...base,
        status: 'partial',
        derivation_source: 'btc_risk_flag',
        derivation_reason: `BTC risk flag: ${matchedFlag.description}`,
      };
    }
  }

  // 5. Preamble overrides
  const preambleResult = applyPreambleOverrides(base, pb, preamble);
  if (preambleResult) return preambleResult;

  // 6. Archetype default (fallback)
  return applyArchetypeDefault(base, preamble);
}

function applyPreambleOverrides(
  base: Omit<DerivedActionStatus, 'status' | 'derivation_source' | 'derivation_reason'>,
  pb: PlaybookEntry | undefined,
  preamble: PreambleAnswers
): DerivedActionStatus | null {
  const signal = base.signal as SignalType;
  const capability = base.capability;
  const service = pb?.m365_service ?? '';

  // Endpoint management preamble
  if (ENDPOINT_CAPABILITIES.has(capability) || ENDPOINT_SERVICES.has(service)) {
    const status = resolveEndpointStatus(preamble, signal);
    if (status) {
      return {
        ...base,
        status,
        derivation_source: 'preamble_override',
        derivation_reason: `Endpoint management: ${preamble.endpoint_management}`,
      };
    }
  }

  // Monitoring / SIEM preamble
  if (MONITORING_CAPABILITIES.has(capability) || SIEM_SERVICES.has(service)) {
    const status = resolveMonitoringStatus(preamble, signal);
    if (status) {
      return {
        ...base,
        status,
        derivation_source: 'preamble_override',
        derivation_reason: `Monitoring/SIEM: ${preamble.monitoring_siem}`,
      };
    }
  }

  // Policy doc state preamble
  if (base.action_type === 'policy' || POLICY_SERVICES.has(service)) {
    const status = resolvePolicyStatus(preamble);
    if (status) {
      return {
        ...base,
        status,
        derivation_source: 'preamble_override',
        derivation_reason: `Policy documentation: ${preamble.policy_doc_state}`,
      };
    }
  }

  return null;
}

function applyArchetypeDefault(
  base: Omit<DerivedActionStatus, 'status' | 'derivation_source' | 'derivation_reason'>,
  preamble: PreambleAnswers
): DerivedActionStatus {
  const archetype = preamble.security_archetype;
  const defaults = ARCHETYPE_DEFAULTS[archetype] ?? ARCHETYPE_DEFAULTS.greenfield;
  const signal = base.signal as SignalType;
  const capability = base.capability;

  // Check for capability-specific override first
  const capOverride = defaults.overrides?.[capability]?.[signal];
  const status: ActionStatus = capOverride ?? defaults[signal];

  return {
    ...base,
    status,
    derivation_source: 'archetype_default',
    derivation_reason: `Archetype "${archetype}" default for ${signal} / ${capability}`,
  };
}

// ---------------------------------------------------------------------------
// Convert derived statuses to RRTAnswer records
// ---------------------------------------------------------------------------

const PROVENANCE_MAP: Record<DerivationSource, RRTAnswer['provenance_class']> = {
  inherent: 'system_observation',
  license_gate: 'system_observation',
  scope_gate: 'system_observation',
  si_override: 'operator_observation',
  btc_risk_flag: 'operator_observation',
  archetype_default: 'operator_inference',
  preamble_override: 'operator_inference',
  advisor_override: 'client_assertion',
};

/**
 * Convert DerivedActionStatus[] to a Record<string, RRTAnswer> suitable for
 * the existing posture generator. Actions with `not_applicable` are excluded.
 */
export function convertToRRTAnswers(
  actionStatuses: DerivedActionStatus[]
): Record<string, RRTAnswer> {
  const answers: Record<string, RRTAnswer> = {};

  for (const action of actionStatuses) {
    if (action.status === 'not_applicable') continue;

    answers[action.action_id] = {
      question_id: action.action_id,
      answer: { status: action.status },
      provenance_class: PROVENANCE_MAP[action.derivation_source] ?? 'operator_inference',
      mapped_requirements: action.mapped_requirements,
    };
  }

  return answers;
}
