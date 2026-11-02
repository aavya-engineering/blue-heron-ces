// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * Pure validation helper for the Contract create/edit form.
 * Required fields: contract_number, program_name, cmmc_level_required (1 | 2 | 3).
 * [validate with BHD — confirm required vs optional field list]
 */

export interface ContractFormData {
  contract_number?: string;
  program_name?: string;
  cmmc_level_required?: number | string;
  party_id?: string;
  prime_ref?: string | null;
  start_date?: string;
  end_date?: string;
  value_usd?: number | string;
  cage_code?: string;
  uei?: string;
  contracting_office?: string;
  classification_level?: string;
  notes?: string;
}

export interface ContractFormErrors {
  contract_number?: string;
  program_name?: string;
  cmmc_level_required?: string;
}

/**
 * Validate the contract form.
 * Returns an errors object — empty ({}) means valid.
 * Checks only required fields; optional fields are accepted as-is.
 */
export function validateContractForm(form: ContractFormData): ContractFormErrors {
  const errors: ContractFormErrors = {};

  if (!form.contract_number?.trim()) {
    errors.contract_number = 'Contract number is required.';
  }

  if (!form.program_name?.trim()) {
    errors.program_name = 'Program name is required.';
  }

  const level = Number(form.cmmc_level_required);
  if (!form.cmmc_level_required || ![1, 2, 3].includes(level)) {
    errors.cmmc_level_required = 'CMMC level required must be 1, 2, or 3.';
  }

  return errors;
}

/** True when validateContractForm returns no errors. */
export function isContractFormValid(form: ContractFormData): boolean {
  return Object.keys(validateContractForm(form)).length === 0;
}
