// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArchitectureDetector } from '../../../src/eo/ssp/ArchitectureDetector';
import { SharedResponsibilityMatrixGenerator } from '../../../src/eo/ssp/SharedResponsibilityMatrixGenerator';
import { SnippetDataResolver } from '../../../src/eo/ssp/SnippetDataResolver';
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

// W2.3: the run-19 TM (cloud_environment gcc_high) and IM (infrastructure_model m365_azure)
// are an Azure Government / GCC High architecture, not the `hybrid` fallback.
describe('SharedResponsibilityMatrixGenerator.detectArchitectureType (W2.3)', () => {
  const FIXTURES = path.resolve(__dirname, '../../fixtures/ssp-uplift');
  const TM = path.join(FIXTURES, 'tm-run19.json');
  const IM = path.join(FIXTURES, 'im-run19.json');
  const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  const gen = new SharedResponsibilityMatrixGenerator();

  it('run-19 fixtures (raw, still wrapped) -> azure-gov', () => {
    expect(gen.detectArchitectureType(readJson(TM), readJson(IM))).toBe('azure-gov');
  });

  it('run-19 fixtures as loadManifests resolves them -> azure-gov', async () => {
    const m = await new SnippetDataResolver().loadManifests('muster-partial', { tenantManifestPath: TM, infraManifestPath: IM });
    expect(gen.detectArchitectureType(m.tenantManifest as unknown as Record<string, unknown>, m.infraManifest as unknown as Record<string, unknown>)).toBe('azure-gov');
  });

  it('either signal alone is enough', () => {
    expect(gen.detectArchitectureType({ tenant_identity: { cloud_environment: 'gcc_high' } }, undefined)).toBe('azure-gov');
    expect(gen.detectArchitectureType(undefined, { infrastructure_model: 'm365_azure' })).toBe('azure-gov');
  });

  it('other environments still fall back to hybrid; BYOD still wins', () => {
    expect(gen.detectArchitectureType({ tenant_identity: { cloud_environment: 'commercial' } }, { infrastructure_model: 'm365_only' })).toBe('hybrid');
    expect(gen.detectArchitectureType({ byodArchitectureMetadata: {}, tenant_identity: { cloud_environment: 'gcc_high' } }, undefined)).toBe('byod');
  });
});
