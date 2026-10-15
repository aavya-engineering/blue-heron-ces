// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import {
  validateSessionControlledByod,
  validateWirelessAccessPathOnly,
} from '../baselineValidator';
import { makeSIBaseline } from '@/__fixtures__/builders';

/**
 * CHARACTERIZATION tests for SIT baseline consistency validators.
 * Pure functions returning warning-string arrays; never block generation.
 */

describe('validateSessionControlledByod', () => {
  it('returns no warnings when not a session-controlled-BYOD configuration', () => {
    const si = makeSIBaseline({ operations: { byod_posture: 'not_allowed' } });
    expect(validateSessionControlledByod(si)).toEqual([]);
  });

  it('returns no warnings for a fully consistent session-controlled-BYOD baseline', () => {
    const si = makeSIBaseline({
      operations: { byod_posture: 'session_controlled_byod', cui_endpoint_posture: 'browser_only' },
      dependencies: { infrastructure_model: 'm365_azure', license_tier: 'g5' },
    });
    expect(validateSessionControlledByod(si)).toEqual([]);
  });

  it('triggers via mobile_device_presence as an alternate session-controlled signal', () => {
    const si = makeSIBaseline({
      operations: {
        mobile_device_presence: 'session_controlled_byod',
        cui_endpoint_posture: 'browser_only',
      },
      dependencies: { infrastructure_model: 'm365_sentinel', license_tier: 'g5' },
    });
    expect(validateSessionControlledByod(si)).toEqual([]);
  });

  it('emits all three warnings when infra, license, and endpoint posture are inconsistent', () => {
    const si = makeSIBaseline({
      operations: {
        byod_posture: 'session_controlled_byod',
        cui_endpoint_posture: 'managed_endpoints',
      },
      dependencies: { infrastructure_model: 'm365_only', license_tier: 'g3' },
    });
    expect(validateSessionControlledByod(si)).toEqual([
      "session_controlled_byod requires infrastructure_model 'm365_azure' or 'm365_sentinel' for Defender for Cloud Apps integration, but current value is 'm365_only'.",
      "session_controlled_byod requires license_tier 'g5' for Conditional Access App Control (Defender for Cloud Apps), but current value is 'g3'.",
      "session_controlled_byod requires cui_endpoint_posture 'browser_only' to ensure CUI never persists on endpoints, but current value is 'managed_endpoints'.",
    ]);
  });

  it("reports 'undefined' literal when fields are absent", () => {
    const si = makeSIBaseline({ operations: { byod_posture: 'session_controlled_byod' } });
    const warnings = validateSessionControlledByod(si);
    expect(warnings[0]).toContain("current value is 'undefined'.");
    expect(warnings).toHaveLength(3);
  });
});

describe('validateWirelessAccessPathOnly', () => {
  it('returns no warnings when wireless_posture is not wireless_access_path_only', () => {
    const si = makeSIBaseline({ operations: { wireless_posture: 'no_wireless' } });
    expect(validateWirelessAccessPathOnly(si)).toEqual([]);
  });

  it('emits only the informational note when deployment is cloud_only and remote access exists', () => {
    const si = makeSIBaseline({
      operations: {
        wireless_posture: 'wireless_access_path_only',
        remote_access_posture: 'cloud_native',
      },
      scope: { deployment_posture: 'cloud_only' },
    });
    expect(validateWirelessAccessPathOnly(si)).toEqual([
      'wireless_access_path_only: No organizational wireless infrastructure exists. Wireless is present only in the unmanaged user access path between personal endpoints and M365. Requires Entra ID Conditional Access policy evidence and M365 TLS enforcement documentation.',
    ]);
  });

  it('emits deployment + remote-access conflicts plus the trailing informational note', () => {
    const si = makeSIBaseline({
      operations: {
        wireless_posture: 'wireless_access_path_only',
        remote_access_posture: 'no_remote',
      },
      scope: { deployment_posture: 'on_prem' },
    });
    expect(validateWirelessAccessPathOnly(si)).toEqual([
      "wireless_access_path_only is applicable to cloud-only deployments where no organizational wireless infrastructure exists, but deployment_posture is 'on_prem'.",
      "wireless_access_path_only implies remote access exists (users connect over unmanaged wireless from off-network locations), but remote_access_posture is 'no_remote'. These are contradictory.",
      'wireless_access_path_only: No organizational wireless infrastructure exists. Wireless is present only in the unmanaged user access path between personal endpoints and M365. Requires Entra ID Conditional Access policy evidence and M365 TLS enforcement documentation.',
    ]);
  });
});
