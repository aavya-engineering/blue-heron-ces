// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { SprsValidator } from '../../../src/eo/ssp/SprsValidator';
import type { DependencyTable } from '../../../src/eo/ssp/MechanismNarrativeComposer';
import type { MechanismStatus } from '../../../src/shared/types/evidence.types';
import type { ExtendedDirectiveMetadata } from '../../../src/shared/types/directive.types';

const dependencyTable: DependencyTable = JSON.parse(
  require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../src/shared/data/mechanism-dependency-table.json'),
    'utf-8'
  )
);

function makeMetadata(overrides: Partial<ExtendedDirectiveMetadata> = {}): ExtendedDirectiveMetadata {
  return {
    control_id: 'AC.L2-3.1.18',
    directive: 'implement',
    readiness: 'met',
    platform_inherited: false,
    evidence_artifacts: ['artifact-001'],
    enforcement_verified: true,
    narrative_stub: '',
    reasoning_trace: '',
    ...overrides,
  };
}

describe('SprsValidator', () => {
  it('returns valid when enforcement_verified=false (no cross-check needed)', () => {
    const meta = makeMetadata({ enforcement_verified: false });
    const status: MechanismStatus = {
      ca_app_control_active: false,
      ca_non_browser_block_active: false,
      dlp_active: false,
      sensitivity_labels_active: false,
    };
    const result = SprsValidator.validateMechanismConsistency(
      'AC.L2-3.1.18', meta, status, dependencyTable
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid when enforcement_verified=true and all required mechanisms active', () => {
    const meta = makeMetadata({ enforcement_verified: true });
    const status: MechanismStatus = {
      ca_app_control_active: true,
      ca_non_browser_block_active: true,
      dlp_active: true,
      sensitivity_labels_active: true,
    };
    const result = SprsValidator.validateMechanismConsistency(
      'AC.L2-3.1.18', meta, status, dependencyTable
    );
    expect(result.valid).toBe(true);
  });

  it('returns invalid when enforcement_verified=true but ca_app_control is false', () => {
    const meta = makeMetadata({ enforcement_verified: true });
    const status: MechanismStatus = {
      ca_app_control_active: false,
      ca_non_browser_block_active: true,
      dlp_active: true,
      sensitivity_labels_active: true,
    };
    const result = SprsValidator.validateMechanismConsistency(
      'AC.L2-3.1.18', meta, status, dependencyTable
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Conditional Access App Control');
    expect(result.errors[0]).toContain('enforcement_verified=true');
  });

  it('returns invalid when enforcement_verified=true but dlp is false for DLP-dependent control', () => {
    const meta = makeMetadata({ enforcement_verified: true, control_id: 'MP.L2-3.8.8' });
    const status: MechanismStatus = {
      ca_app_control_active: true,
      ca_non_browser_block_active: true,
      dlp_active: false,
      sensitivity_labels_active: true,
    };
    const result = SprsValidator.validateMechanismConsistency(
      'MP.L2-3.8.8', meta, status, dependencyTable
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Data Loss Prevention');
  });

  it('returns valid for unknown control (not in dependency table)', () => {
    const meta = makeMetadata({ enforcement_verified: true });
    const status: MechanismStatus = {
      ca_app_control_active: false,
      ca_non_browser_block_active: false,
      dlp_active: false,
      sensitivity_labels_active: false,
    };
    const result = SprsValidator.validateMechanismConsistency(
      'XX.L2-99.99.99', meta, status, dependencyTable
    );
    expect(result.valid).toBe(true);
  });

  it('does not flag recommended mechanisms as errors', () => {
    // AC.L2-3.1.19 has sensitivity_labels as recommended
    const meta = makeMetadata({ enforcement_verified: true });
    const status: MechanismStatus = {
      ca_app_control_active: true,
      ca_non_browser_block_active: true,
      dlp_active: true,
      sensitivity_labels_active: false,
    };
    const result = SprsValidator.validateMechanismConsistency(
      'AC.L2-3.1.19', meta, status, dependencyTable
    );
    expect(result.valid).toBe(true);
  });

  it('error message mentions Stamper bug or evidence tampering', () => {
    const meta = makeMetadata({ enforcement_verified: true });
    const status: MechanismStatus = {
      ca_app_control_active: false,
      ca_non_browser_block_active: true,
      dlp_active: true,
      sensitivity_labels_active: true,
    };
    const result = SprsValidator.validateMechanismConsistency(
      'AC.L2-3.1.18', meta, status, dependencyTable
    );
    expect(result.errors[0]).toContain('Stamper bug or evidence tampering');
  });
});
