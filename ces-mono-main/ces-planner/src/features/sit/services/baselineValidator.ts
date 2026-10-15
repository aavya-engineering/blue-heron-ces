// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline } from '@/shared/types/artifacts';

/**
 * Validate session-controlled BYOD configuration consistency.
 * Returns array of warning strings (empty if valid).
 * Warnings are informational only — they do not block baseline generation.
 */
export function validateSessionControlledByod(siBaseline: SIBaseline): string[] {
  const warnings: string[] = [];
  const ops = siBaseline.si_baseline?.operations;
  const deps = siBaseline.si_baseline?.dependencies;

  const isSessionControlled =
    ops?.byod_posture === 'session_controlled_byod' ||
    ops?.mobile_device_presence === 'session_controlled_byod';

  if (!isSessionControlled) {
    return warnings;
  }

  if (deps?.infrastructure_model !== 'm365_azure' && deps?.infrastructure_model !== 'm365_sentinel') {
    warnings.push(
      `session_controlled_byod requires infrastructure_model 'm365_azure' or 'm365_sentinel' for Defender for Cloud Apps integration, but current value is '${deps?.infrastructure_model || 'undefined'}'.`,
    );
  }

  if (deps?.license_tier !== 'g5') {
    warnings.push(
      `session_controlled_byod requires license_tier 'g5' for Conditional Access App Control (Defender for Cloud Apps), but current value is '${deps?.license_tier || 'undefined'}'.`,
    );
  }

  if (ops?.cui_endpoint_posture !== 'browser_only') {
    warnings.push(
      `session_controlled_byod requires cui_endpoint_posture 'browser_only' to ensure CUI never persists on endpoints, but current value is '${ops?.cui_endpoint_posture || 'undefined'}'.`,
    );
  }

  return warnings;
}

/**
 * Validate wireless-access-path-only configuration consistency.
 * Returns array of warning strings (empty if valid).
 * Warnings are informational only — they do not block baseline generation.
 */
export function validateWirelessAccessPathOnly(siBaseline: SIBaseline): string[] {
  const warnings: string[] = [];
  const ops = siBaseline.si_baseline?.operations;
  const scope = siBaseline.si_baseline?.scope;

  if (ops?.wireless_posture !== 'wireless_access_path_only') {
    return warnings;
  }

  if (scope?.deployment_posture !== 'cloud_only') {
    warnings.push(
      `wireless_access_path_only is applicable to cloud-only deployments where no organizational wireless infrastructure exists, but deployment_posture is '${scope?.deployment_posture || 'undefined'}'.`,
    );
  }

  if (ops?.remote_access_posture === 'no_remote') {
    warnings.push(
      `wireless_access_path_only implies remote access exists (users connect over unmanaged wireless from off-network locations), but remote_access_posture is 'no_remote'. These are contradictory.`,
    );
  }

  warnings.push(
    'wireless_access_path_only: No organizational wireless infrastructure exists. Wireless is present only in the unmanaged user access path between personal endpoints and M365. Requires Entra ID Conditional Access policy evidence and M365 TLS enforcement documentation.',
  );

  return warnings;
}
