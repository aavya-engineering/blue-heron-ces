// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Pure-function tests for contract form validation.
import { describe, it, expect } from 'vitest';
import { validateContractForm, isContractFormValid } from '../contractValidation';

describe('validateContractForm — required field validation', () => {
  it('returns no errors for a fully-valid form', () => {
    const errors = validateContractForm({
      contract_number: 'W911NF-24-C-0001',
      program_name: 'CUI Cyber Program',
      cmmc_level_required: 2,
    });
    expect(errors).toEqual({});
  });

  it('errors when contract_number is missing', () => {
    const errors = validateContractForm({
      program_name: 'Program A',
      cmmc_level_required: 1,
    });
    expect(errors.contract_number).toBeTruthy();
    expect(errors.program_name).toBeUndefined();
    expect(errors.cmmc_level_required).toBeUndefined();
  });

  it('errors when contract_number is only whitespace', () => {
    const errors = validateContractForm({
      contract_number: '   ',
      program_name: 'Program A',
      cmmc_level_required: 1,
    });
    expect(errors.contract_number).toBeTruthy();
  });

  it('errors when program_name is missing', () => {
    const errors = validateContractForm({
      contract_number: 'W911NF-24-C-0001',
      cmmc_level_required: 3,
    });
    expect(errors.program_name).toBeTruthy();
    expect(errors.contract_number).toBeUndefined();
  });

  it('errors when cmmc_level_required is missing', () => {
    const errors = validateContractForm({
      contract_number: 'W911NF-24-C-0001',
      program_name: 'Program A',
    });
    expect(errors.cmmc_level_required).toBeTruthy();
  });

  it('errors when cmmc_level_required is 0 (out of range)', () => {
    const errors = validateContractForm({
      contract_number: 'W911NF-24-C-0001',
      program_name: 'Program A',
      cmmc_level_required: 0,
    });
    expect(errors.cmmc_level_required).toBeTruthy();
  });

  it('errors when cmmc_level_required is 4 (out of range)', () => {
    const errors = validateContractForm({
      contract_number: 'W911NF-24-C-0001',
      program_name: 'Program A',
      cmmc_level_required: 4,
    });
    expect(errors.cmmc_level_required).toBeTruthy();
  });

  it('accepts cmmc_level_required as string "1"', () => {
    const errors = validateContractForm({
      contract_number: 'W911NF-24-C-0001',
      program_name: 'Program A',
      cmmc_level_required: '1',
    });
    expect(errors.cmmc_level_required).toBeUndefined();
  });

  it('accepts cmmc_level_required as string "3"', () => {
    const errors = validateContractForm({
      contract_number: 'W911NF-24-C-0001',
      program_name: 'Program A',
      cmmc_level_required: '3',
    });
    expect(errors.cmmc_level_required).toBeUndefined();
  });

  it('returns all three errors when all required fields missing', () => {
    const errors = validateContractForm({});
    expect(errors.contract_number).toBeTruthy();
    expect(errors.program_name).toBeTruthy();
    expect(errors.cmmc_level_required).toBeTruthy();
  });

  it('optional fields do not affect validity', () => {
    const errors = validateContractForm({
      contract_number: 'W911NF-24-C-0001',
      program_name: 'Program A',
      cmmc_level_required: 2,
      notes: 'some note',
      uei: '123456789012',
      cage_code: 'ABC12',
    });
    expect(errors).toEqual({});
  });
});

describe('isContractFormValid', () => {
  it('returns true for a valid form', () => {
    expect(
      isContractFormValid({
        contract_number: 'W911NF-24-C-0001',
        program_name: 'Program A',
        cmmc_level_required: 2,
      })
    ).toBe(true);
  });

  it('returns false when required fields missing', () => {
    expect(isContractFormValid({})).toBe(false);
  });
});
