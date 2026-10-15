// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { ArchitectureDetector } from '../../../src/eo/ssp/ArchitectureDetector';
import type { ArchitectureMetadata } from '../../../src/shared/types/evidence.types';

function makeArchMetadata(overrides: Partial<ArchitectureMetadata> = {}): ArchitectureMetadata {
  return {
    architecture_declared: 'session_controlled_byod',
    directive: 'document-prohibition',
    enforcement_verified: true,
    verification_date: '2026-04-15T10:30:00Z',
    mechanism_status: {
      ca_app_control_active: true,
      ca_non_browser_block_active: true,
      dlp_active: true,
      sensitivity_labels_active: true,
    },
    tenant_variant: 'GCC High',
    azure_resources_present: false,
    ...overrides,
  };
}

describe('ArchitectureDetector', () => {
  describe('detectArchitecture', () => {
    it('returns session_controlled_byod when architecture_declared=session_controlled_byod and directive=validate', () => {
      const meta = makeArchMetadata({ directive: 'validate' });
      expect(ArchitectureDetector.detectArchitecture(meta)).toBe('session_controlled_byod');
    });

    it('returns session_controlled_byod when directive=document-prohibition', () => {
      const meta = makeArchMetadata({ directive: 'document-prohibition' });
      expect(ArchitectureDetector.detectArchitecture(meta)).toBe('session_controlled_byod');
    });

    it('returns session_controlled_byod when directive=implement', () => {
      const meta = makeArchMetadata({ directive: 'implement' });
      expect(ArchitectureDetector.detectArchitecture(meta)).toBe('session_controlled_byod');
    });

    it('returns null when directive=skip', () => {
      const meta = makeArchMetadata({ directive: 'skip' });
      expect(ArchitectureDetector.detectArchitecture(meta)).toBeNull();
    });

    it('returns null when architecture_declared=allowed_vdi_only and directive=validate', () => {
      const meta = makeArchMetadata({ architecture_declared: 'allowed_vdi_only', directive: 'validate' });
      expect(ArchitectureDetector.detectArchitecture(meta)).toBeNull();
    });

    it('returns null when architecture_declared=allowed_vdi_only and directive=implement', () => {
      const meta = makeArchMetadata({ architecture_declared: 'allowed_vdi_only', directive: 'implement' });
      expect(ArchitectureDetector.detectArchitecture(meta)).toBeNull();
    });

    it('returns null when architecture_declared=no_mobile_devices and directive=validate', () => {
      const meta = makeArchMetadata({ architecture_declared: 'no_mobile_devices', directive: 'validate' });
      expect(ArchitectureDetector.detectArchitecture(meta)).toBeNull();
    });

    it('returns null when architecture_declared=no_mobile_devices and directive=document-prohibition', () => {
      const meta = makeArchMetadata({ architecture_declared: 'no_mobile_devices', directive: 'document-prohibition' });
      expect(ArchitectureDetector.detectArchitecture(meta)).toBeNull();
    });

    it('returns null when architecture_declared=allowed_vdi_only and directive=skip', () => {
      const meta = makeArchMetadata({ architecture_declared: 'allowed_vdi_only', directive: 'skip' });
      expect(ArchitectureDetector.detectArchitecture(meta)).toBeNull();
    });
  });

  describe('isByodArchitecture', () => {
    it('returns true for session_controlled_byod + validate', () => {
      const meta = makeArchMetadata({ directive: 'validate' });
      expect(ArchitectureDetector.isByodArchitecture(meta)).toBe(true);
    });

    it('returns false for session_controlled_byod + skip', () => {
      const meta = makeArchMetadata({ directive: 'skip' });
      expect(ArchitectureDetector.isByodArchitecture(meta)).toBe(false);
    });

    it('returns false for no_mobile_devices + implement', () => {
      const meta = makeArchMetadata({ architecture_declared: 'no_mobile_devices', directive: 'implement' });
      expect(ArchitectureDetector.isByodArchitecture(meta)).toBe(false);
    });
  });
});
