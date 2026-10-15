// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from '@jest/globals';
import { OdpValueProvider, type OdpValue } from '../OdpValueProvider.js';

describe('OdpValueProvider', () => {
  const sampleOdpValues: Record<string, OdpValue> = {
    'AC.L2-3.1.8': {
      controlId: 'AC.L2-3.1.8',
      odpId: 'AC.L2-3.1.8_ODP_01',
      description: 'Unsuccessful logon attempts threshold',
      value: '3 failed attempts within 15 minutes',
      enforcementMechanism: 'via Conditional Access policy CA-005',
      rationale: 'Balances security with usability',
      source: 'Policy Inputs'
    },
    'AU.L2-3.3.6': {
      controlId: 'AU.L2-3.3.6',
      odpId: 'AU.L2-3.3.6_ODP_01',
      description: 'Audit retention period',
      value: '365 days',
      enforcementMechanism: 'via Log Analytics retention policy and Blob Storage archive',
      rationale: 'Meets DFARS 1-year retention requirement'
    },
    'IA.L2-3.5.11': {
      controlId: 'IA.L2-3.5.11',
      odpId: 'IA.L2-3.5.11_ODP_01',
      description: 'Password reuse generations',
      value: '24 previous passwords',
      enforcementMechanism: 'via Azure AD password protection policy'
    }
  };

  it('should load ODP values from manifest and retrieve by control ID', () => {
    const provider = new OdpValueProvider(sampleOdpValues);

    const odp = provider.getByControlId('AC.L2-3.1.8');
    expect(odp).not.toBeNull();
    expect(odp?.value).toBe('3 failed attempts within 15 minutes');
    expect(odp?.enforcementMechanism).toBe('via Conditional Access policy CA-005');
    expect(odp?.rationale).toBe('Balances security with usability');
    expect(odp?.description).toBe('Unsuccessful logon attempts threshold');
    expect(odp?.source).toBe('Policy Inputs');
  });

  it('should return null for controls without ODP defined', () => {
    const provider = new OdpValueProvider(sampleOdpValues);

    const odp = provider.getByControlId('AC.L2-3.1.1');
    expect(odp).toBeNull();
  });

  it('should handle empty odpValues gracefully', () => {
    const provider = new OdpValueProvider({});

    expect(provider.getLoadedCount()).toBe(0);
    const odp = provider.getByControlId('AC.L2-3.1.8');
    expect(odp).toBeNull();
  });

  it('should handle undefined odpValues gracefully', () => {
    const provider = new OdpValueProvider();

    expect(provider.getLoadedCount()).toBe(0);
    const odp = provider.getByControlId('AC.L2-3.1.8');
    expect(odp).toBeNull();
  });

  it('should count loaded ODP values correctly', () => {
    const provider = new OdpValueProvider(sampleOdpValues);

    expect(provider.getLoadedCount()).toBe(3);
  });

  it('should check hasOdp() returns correct boolean', () => {
    const provider = new OdpValueProvider(sampleOdpValues);

    expect(provider.hasOdp('AC.L2-3.1.8')).toBe(true);
    expect(provider.hasOdp('AU.L2-3.3.6')).toBe(true);
    expect(provider.hasOdp('AC.L2-3.1.1')).toBe(false);
    expect(provider.hasOdp('NonExistent')).toBe(false);
  });

  it('should return all fields including optional rationale and source', () => {
    const provider = new OdpValueProvider(sampleOdpValues);

    // Control with all fields including optional rationale and source
    const odpWithRationale = provider.getByControlId('AC.L2-3.1.8');
    expect(odpWithRationale?.value).toBe('3 failed attempts within 15 minutes');
    expect(odpWithRationale?.enforcementMechanism).toBe('via Conditional Access policy CA-005');
    expect(odpWithRationale?.rationale).toBe('Balances security with usability');
    expect(odpWithRationale?.description).toBe('Unsuccessful logon attempts threshold');
    expect(odpWithRationale?.source).toBe('Policy Inputs');

    // Control without rationale or source (should return empty strings)
    const odpWithoutRationale = provider.getByControlId('IA.L2-3.5.11');
    expect(odpWithoutRationale?.value).toBe('24 previous passwords');
    expect(odpWithoutRationale?.enforcementMechanism).toBe('via Azure AD password protection policy');
    expect(odpWithoutRationale?.rationale).toBe('');
    expect(odpWithoutRationale?.description).toBe('Password reuse generations');
    expect(odpWithoutRationale?.source).toBe('');
  });
});
