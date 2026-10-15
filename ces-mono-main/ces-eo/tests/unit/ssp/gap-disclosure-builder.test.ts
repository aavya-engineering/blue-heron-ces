// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { GapDisclosureBuilder } from '../../../src/eo/ssp/GapDisclosureBuilder';
import type { DependencyTable } from '../../../src/eo/ssp/MechanismNarrativeComposer';
import type { MechanismStatus, ArchitectureMetadata } from '../../../src/shared/types/evidence.types';

const dependencyTable: DependencyTable = JSON.parse(
  require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../src/shared/data/mechanism-dependency-table.json'),
    'utf-8'
  )
);

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

describe('GapDisclosureBuilder', () => {
  it('returns empty string when all mechanisms pass', () => {
    const status: MechanismStatus = {
      ca_app_control_active: true,
      ca_non_browser_block_active: true,
      dlp_active: true,
      sensitivity_labels_active: true,
    };
    const result = GapDisclosureBuilder.buildGapDisclosure(
      status, dependencyTable, makeArchMetadata({ mechanism_status: status })
    );
    expect(result).toBe('');
  });

  it('lists DLP when dlp_active=false', () => {
    const status: MechanismStatus = {
      ca_app_control_active: true,
      ca_non_browser_block_active: true,
      dlp_active: false,
      sensitivity_labels_active: true,
    };
    const result = GapDisclosureBuilder.buildGapDisclosure(
      status, dependencyTable, makeArchMetadata({ mechanism_status: status })
    );
    expect(result).toContain('Data Loss Prevention');
    expect(result).toContain('Gap Disclosure');
  });

  it('lists ca_app_control when inactive', () => {
    const status: MechanismStatus = {
      ca_app_control_active: false,
      ca_non_browser_block_active: true,
      dlp_active: true,
      sensitivity_labels_active: true,
    };
    const result = GapDisclosureBuilder.buildGapDisclosure(
      status, dependencyTable, makeArchMetadata({ mechanism_status: status })
    );
    expect(result).toContain('Conditional Access App Control');
  });

  it('lists multiple mechanisms when two are failing', () => {
    const status: MechanismStatus = {
      ca_app_control_active: false,
      ca_non_browser_block_active: false,
      dlp_active: true,
      sensitivity_labels_active: true,
    };
    const result = GapDisclosureBuilder.buildGapDisclosure(
      status, dependencyTable, makeArchMetadata({ mechanism_status: status })
    );
    expect(result).toContain('Conditional Access App Control');
    expect(result).toContain('Non-Browser Client Block');
  });

  it('lists three failing mechanisms', () => {
    const status: MechanismStatus = {
      ca_app_control_active: false,
      ca_non_browser_block_active: false,
      dlp_active: false,
      sensitivity_labels_active: true,
    };
    const result = GapDisclosureBuilder.buildGapDisclosure(
      status, dependencyTable, makeArchMetadata({ mechanism_status: status })
    );
    expect(result).toContain('Conditional Access App Control');
    expect(result).toContain('Non-Browser Client Block');
    expect(result).toContain('Data Loss Prevention');
  });

  it('lists all four failing mechanisms', () => {
    const status: MechanismStatus = {
      ca_app_control_active: false,
      ca_non_browser_block_active: false,
      dlp_active: false,
      sensitivity_labels_active: false,
    };
    const result = GapDisclosureBuilder.buildGapDisclosure(
      status, dependencyTable, makeArchMetadata({ mechanism_status: status })
    );
    expect(result).toContain('Conditional Access App Control');
    expect(result).toContain('Non-Browser Client Block');
    expect(result).toContain('Data Loss Prevention');
    expect(result).toContain('Sensitivity Labels');
  });

  it('includes gap_description_dlp when provided', () => {
    const status: MechanismStatus = {
      ca_app_control_active: true,
      ca_non_browser_block_active: true,
      dlp_active: false,
      sensitivity_labels_active: true,
    };
    const meta = makeArchMetadata({
      mechanism_status: status,
      gap_description_dlp: 'DLP policies not yet deployed to Exchange Online.',
    });
    const result = GapDisclosureBuilder.buildGapDisclosure(status, dependencyTable, meta);
    expect(result).toContain('DLP policies not yet deployed to Exchange Online.');
  });

  it('includes poam_id when provided', () => {
    const status: MechanismStatus = {
      ca_app_control_active: true,
      ca_non_browser_block_active: true,
      dlp_active: false,
      sensitivity_labels_active: true,
    };
    const meta = makeArchMetadata({
      mechanism_status: status,
      poam_id: 'POAM-2026-003',
    });
    const result = GapDisclosureBuilder.buildGapDisclosure(status, dependencyTable, meta);
    expect(result).toContain('POAM-2026-003');
    expect(result).toContain('Plan of Action and Milestones');
  });
});
