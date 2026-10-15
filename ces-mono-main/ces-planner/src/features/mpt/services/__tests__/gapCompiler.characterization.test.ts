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
  buildScopeExclusions,
  classifyInfrastructureGaps,
  classifyLicenseTierGaps,
  classifyGapType,
} from '../gapCompiler';
import { makeSIBaseline } from '@/__fixtures__/builders';

/**
 * CHARACTERIZATION tests for MPT scope-exclusion + gap-classification logic.
 * Pure functions over plain SI-baseline objects — no data loader required.
 */

function exclusionIds(si: ReturnType<typeof makeSIBaseline>): string[] {
  return [...buildScopeExclusions(si).exclusions.keys()];
}

describe('buildScopeExclusions — operational scope rules', () => {
  it('excludes no controls and emits no warnings for an empty operations baseline', () => {
    const si = makeSIBaseline({});
    const { exclusions, warnings } = buildScopeExclusions(si);
    expect([...exclusions.keys()]).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('Rule 1: no_mobile_devices excludes the two mobile-device controls', () => {
    const si = makeSIBaseline({ operations: { mobile_device_presence: 'no_mobile_devices' } });
    expect(exclusionIds(si)).toEqual(['AC.L2-3.1.18', 'AC.L2-3.1.19']);
  });

  it('Rule 2: no_wireless excludes the wireless-access control', () => {
    const si = makeSIBaseline({ operations: { wireless_posture: 'no_wireless' } });
    expect(exclusionIds(si)).toEqual(['AC.L2-3.1.16']);
  });

  it('Rule 3: blocked removable media excludes the three media controls as prohibitions', () => {
    const si = makeSIBaseline({ operations: { removable_media_posture: 'blocked' } });
    const { exclusions } = buildScopeExclusions(si);
    expect([...exclusions.keys()]).toEqual(['AC.L2-3.1.6', 'MP.L2-3.8.5', 'MP.L2-3.8.6']);
    expect(exclusions.get('AC.L2-3.1.6')?.kind).toBe('prohibition');
  });

  it('Rule 4: no_remote (non-cloud) excludes remote-access controls', () => {
    const si = makeSIBaseline({
      operations: { remote_access_posture: 'no_remote' },
      scope: { deployment_posture: 'on_prem' },
    });
    expect(exclusionIds(si)).toEqual(['AC.L2-3.1.12', 'AC.L2-3.1.13', 'PE.L2-3.10.6']);
  });

  it('Rule 4: no_remote is suppressed for cloud_only deployments and instead warns', () => {
    const si = makeSIBaseline({
      operations: { remote_access_posture: 'no_remote' },
      scope: { deployment_posture: 'cloud_only' },
    });
    const { exclusions, warnings } = buildScopeExclusions(si);
    expect(exclusions.has('AC.L2-3.1.12')).toBe(false);
    expect(warnings).toEqual([
      "Configuration conflict: remote_access_posture is 'no_remote' but deployment_posture is 'cloud_only'. Cloud-only deployments inherently require remote access. Review SI answers for accuracy.",
    ]);
  });

  it('Rule 5: no_nonlocal maintenance excludes the maintenance control', () => {
    const si = makeSIBaseline({ operations: { maintenance_posture: 'no_nonlocal' } });
    expect(exclusionIds(si)).toEqual(['MA.L2-3.7.4']);
  });

  it('Rule 6: browser_only excludes endpoint controls incl. SC.L2-3.13.16 with rr-validation flag', () => {
    const si = makeSIBaseline({ operations: { cui_endpoint_posture: 'browser_only' } });
    const { exclusions } = buildScopeExclusions(si);
    expect([...exclusions.keys()]).toEqual([
      'CM.L2-3.4.6',
      'MP.L2-3.8.7',
      'AC.L2-3.1.19',
      'SC.L2-3.13.16',
    ]);
    const sc = exclusions.get('SC.L2-3.13.16');
    expect(sc?.kind).toBe('prohibition');
    expect(sc?.requires_rr_validation).toBe(true);
    expect(sc?.justification).toBe(
      'CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline',
    );
  });

  it('session_controlled_byod rewrites the browser_only justifications', () => {
    const si = makeSIBaseline({
      operations: { cui_endpoint_posture: 'browser_only', byod_posture: 'session_controlled_byod' },
    });
    const { exclusions } = buildScopeExclusions(si);
    const expected =
      'CUI accessible via session-controlled browser only. Entra ID Conditional Access App Control enforces download/copy/print/upload blocks at M365 service layer. Endpoint is untrusted by design; CUI never persists on device.';
    for (const id of ['CM.L2-3.4.6', 'MP.L2-3.8.7', 'AC.L2-3.1.19', 'SC.L2-3.13.16']) {
      expect(exclusions.get(id)?.justification).toBe(expected);
    }
  });

  it('warns on wireless_access_path_only combined with no_remote', () => {
    const si = makeSIBaseline({
      operations: { wireless_posture: 'wireless_access_path_only', remote_access_posture: 'no_remote' },
    });
    const { warnings } = buildScopeExclusions(si);
    expect(warnings).toEqual([
      "Configuration conflict: wireless_posture is 'wireless_access_path_only' but remote_access_posture is 'no_remote'. Wireless-only access path implies remote access exists. Review SI answers for accuracy.",
    ]);
  });
});

describe('classifyInfrastructureGaps', () => {
  it('returns manual_alternative for an Azure-only control when infra is m365_only', () => {
    expect(classifyInfrastructureGaps('m365_only', 'SC.L1-3.13.1')).toEqual(['manual_alternative']);
  });
  it('returns no classification when infra is not m365_only', () => {
    expect(classifyInfrastructureGaps('m365_azure', 'SC.L1-3.13.1')).toEqual([]);
  });
  it('returns no classification for a control not in the M365 alternatives set', () => {
    expect(classifyInfrastructureGaps('m365_only', 'AC.L2-3.1.1')).toEqual([]);
  });
});

describe('classifyLicenseTierGaps', () => {
  it('returns control_not_available for AU/IR controls on business_premium', () => {
    expect(classifyLicenseTierGaps('business_premium', 'AU.L2-3.3.1')).toEqual(['control_not_available']);
    expect(classifyLicenseTierGaps('business_premium', 'IR.L2-3.6.1')).toEqual(['control_not_available']);
    expect(classifyLicenseTierGaps('business_premium', 'IR.L2-3.6.2')).toEqual(['control_not_available']);
  });
  it('returns nothing for controls outside the tier-gap set', () => {
    expect(classifyLicenseTierGaps('business_premium', 'AC.L2-3.1.1')).toEqual([]);
  });
  it('returns nothing for tiers other than business_premium', () => {
    expect(classifyLicenseTierGaps('g5', 'AU.L2-3.3.1')).toEqual([]);
  });
});

describe('classifyGapType', () => {
  it('defaults to manual when no patterns/playbook signals match', () => {
    expect(classifyGapType([], new Map())).toEqual(['manual']);
  });

  it('orders distinct signals most-constrained-first (manual, customize, configure)', () => {
    const playbook = new Map([
      ['act-cfg', { action_id: 'act-cfg', signal: 'configure' } as never],
      ['act-cust', { action_id: 'act-cust', signal: 'customize' } as never],
      ['act-man', { action_id: 'act-man', signal: 'manual' } as never],
    ]);
    const patterns = [
      {
        practice_id: 'AC.L2-3.1.1',
        actions: [{ id: 'act-cfg' }, { id: 'act-cust' }, { id: 'act-man' }],
      } as never,
    ];
    expect(classifyGapType(patterns, playbook)).toEqual(['manual', 'customize', 'configure']);
  });
});
