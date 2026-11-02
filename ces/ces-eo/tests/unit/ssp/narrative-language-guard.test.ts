// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { NarrativeLanguageGuard } from '../../../src/eo/ssp/NarrativeLanguageGuard';

describe('NarrativeLanguageGuard', () => {
  it('returns valid for clean narrative', () => {
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      'This control is satisfied under the session-controlled BYOD architecture.',
      'session_controlled_byod'
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('detects VDI in narrative', () => {
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      'Users access CUI through a VDI session.',
      'session_controlled_byod'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('VDI');
  });

  it('detects Cloud PC in narrative', () => {
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      'The organization deploys Cloud PC for remote access.',
      'session_controlled_byod'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('Cloud PC');
  });

  it('detects AVD in narrative', () => {
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      'Azure Virtual Desktop (AVD) provides virtual sessions.',
      'session_controlled_byod'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('AVD');
  });

  it('detects Intune in narrative', () => {
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      'Devices are managed by Intune compliance policies.',
      'session_controlled_byod'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('Intune');
  });

  it('detects MDM in narrative', () => {
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      'All endpoints are enrolled in MDM.',
      'session_controlled_byod'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('MDM');
  });

  it('detects multiple forbidden terms', () => {
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      'Users connect via VDI or Cloud PC with MDM enrollment.',
      'session_controlled_byod'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('VDI');
    expect(result.violations).toContain('Cloud PC');
    expect(result.violations).toContain('MDM');
  });

  it('allows MDM and Intune in the opt-out clause', () => {
    const narrative =
      'This control is met. ' +
      'Organizations that do not issue managed endpoints to all CUI-handling personnel ' +
      'may opt out of device-management controls (e.g., MDM enrollment, Intune compliance) ' +
      'when the session-controlled BYOD architecture provides equivalent or superior data ' +
      'protection through the four mechanisms listed above.';
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      narrative,
      'session_controlled_byod'
    );
    expect(result.valid).toBe(true);
  });

  it('skips validation for non-BYOD architecture', () => {
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      'Users connect via VDI with Intune.',
      'allowed_vdi_only'
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('case-insensitive detection', () => {
    const result = NarrativeLanguageGuard.validateNoForbiddenTerms(
      'Users use vdi for access.',
      'session_controlled_byod'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('VDI');
  });
});
