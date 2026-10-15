// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Shared answer-type-specific validation for TCP, CUI, and BTC wizard inputs.
 *
 * Enforces hygiene rules that downstream consumers (profile generators,
 * boundary generators, manifest builder, task compiler) depend on.
 */

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPN_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_TEXT_LENGTH = 2000;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_LENGTH = 200;
const MAX_NUMBER = 100_000;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const OK: ValidationResult = { valid: true };

/**
 * Validate a single answer value against its answer_type and the question's
 * declared options.  Returns `{ valid: true }` or `{ valid: false, error }`.
 *
 * `required` gating (empty-check) is handled separately by the section page
 * component — this function only checks *format / hygiene*.
 */
export function validateAnswer(
  answerType: string,
  value: unknown,
  options?: string[],
  questionId?: string,
): ValidationResult {
  switch (answerType) {
    case 'guid':
      return validateGuid(value);
    case 'upn_list':
      return validateUpnList(value);
    case 'number':
      return validateNumber(value, questionId);
    case 'text':
      return validateText(value);
    case 'list':
      return validateList(value);
    case 'single_select':
      return validateSingleSelect(value, options);
    case 'multi_select':
      return validateMultiSelect(value, options);
    case 'boolean':
      return OK; // always valid
    default:
      return OK;
  }
}

// ---------------------------------------------------------------------------
// Per-type validators
// ---------------------------------------------------------------------------

function validateGuid(value: unknown): ValidationResult {
  if (value === '' || value === undefined || value === null) return OK; // emptiness is a required-check concern
  const s = String(value);
  if (!GUID_REGEX.test(s)) {
    return { valid: false, error: 'Must be a valid GUID (e.g. 00000000-0000-0000-0000-000000000000)' };
  }
  return OK;
}

function validateUpnList(value: unknown): ValidationResult {
  if (!value || (typeof value === 'string' && value.trim() === '')) return OK;
  const lines =
    typeof value === 'string'
      ? value
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
      : Array.isArray(value)
        ? (value as string[]).map((l) => l.trim()).filter(Boolean)
        : [];
  for (const line of lines) {
    if (!UPN_REGEX.test(line)) {
      return { valid: false, error: `Invalid UPN format: "${line}". Expected user@domain.tld` };
    }
  }
  if (lines.length > MAX_LIST_ITEMS) {
    return { valid: false, error: `Too many entries (${lines.length}). Maximum is ${MAX_LIST_ITEMS}.` };
  }
  return OK;
}

function validateNumber(value: unknown, questionId?: string): ValidationResult {
  if (value === '' || value === undefined || value === null) return OK;
  const n = Number(value);
  if (Number.isNaN(n)) {
    return { valid: false, error: 'Must be a valid number' };
  }
  // Count fields must be at least 1
  const isCountField =
    questionId &&
    (questionId.includes('LIC.002') ||
      questionId.includes('USR.002') ||
      questionId.includes('license_count') ||
      questionId.includes('user_count'));
  const min = isCountField ? 1 : 0;
  if (n < min) {
    return { valid: false, error: `Must be at least ${min}` };
  }
  if (n > MAX_NUMBER) {
    return { valid: false, error: `Must be at most ${MAX_NUMBER.toLocaleString()}` };
  }
  if (!Number.isInteger(n)) {
    return { valid: false, error: 'Must be a whole number' };
  }
  return OK;
}

function validateText(value: unknown): ValidationResult {
  if (value === '' || value === undefined || value === null) return OK;
  const s = String(value);
  if (s.length > MAX_TEXT_LENGTH) {
    return {
      valid: false,
      error: `Text is too long (${s.length} chars). Maximum is ${MAX_TEXT_LENGTH}.`,
    };
  }
  return OK;
}

function validateList(value: unknown): ValidationResult {
  if (!value) return OK;
  if (typeof value === 'string') {
    const items = value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (items.length > MAX_LIST_ITEMS) {
      return { valid: false, error: `Too many items (${items.length}). Maximum is ${MAX_LIST_ITEMS}.` };
    }
    for (const item of items) {
      if (item.length > MAX_LIST_ITEM_LENGTH) {
        return {
          valid: false,
          error: `Item "${item.slice(0, 30)}..." is too long. Maximum is ${MAX_LIST_ITEM_LENGTH} chars.`,
        };
      }
    }
  }
  if (Array.isArray(value) && value.length > MAX_LIST_ITEMS) {
    return { valid: false, error: `Too many items (${value.length}). Maximum is ${MAX_LIST_ITEMS}.` };
  }
  return OK;
}

function validateSingleSelect(value: unknown, options?: string[]): ValidationResult {
  if (value === '' || value === undefined || value === null) return OK;
  if (options && options.length > 0 && !options.includes(String(value))) {
    return { valid: false, error: `"${String(value)}" is not a valid option` };
  }
  return OK;
}

function validateMultiSelect(value: unknown, options?: string[]): ValidationResult {
  if (!Array.isArray(value) || value.length === 0) return OK;
  if (options && options.length > 0) {
    const invalid = (value as string[]).filter((v) => !options.includes(v));
    if (invalid.length > 0) {
      return { valid: false, error: `Invalid option(s): ${invalid.join(', ')}` };
    }
  }
  return OK;
}
