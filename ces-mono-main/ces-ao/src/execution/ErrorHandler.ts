// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 7: Error Handler
// Classifies execution errors and determines retryability

import type { AoCommand } from '../types/AoCommand.js';

export interface ErrorResult {
  classification: 'permission' | 'throttle' | 'network' | 'validation' | 'unknown';
  message: string;
  retryable: boolean;
}

/**
 * Handle execution error and classify for retry logic.
 * Pattern matching on stderr/message:
 * - "Authorization_RequestDenied", "Insufficient privileges", "403" → permission
 * - "429", "TooManyRequests" → throttle
 * - "ECONNREFUSED", "ETIMEDOUT" → network
 * - "validation", "invalid", "required" → validation
 * - Default → unknown
 *
 * Retryable flag: throttle and network are retryable, others are not.
 * unknown is NOT retryable.
 */
export function handleExecutionError(error: any, aoCommand: AoCommand): ErrorResult {
  const message = error?.message || error?.stderr || String(error);
  const messageLower = message.toLowerCase();

  // Permission errors (NOT retryable)
  if (
    messageLower.includes('authorization_requestdenied') ||
    messageLower.includes('insufficient privileges') ||
    messageLower.includes('403') ||
    messageLower.includes('forbidden') ||
    messageLower.includes('access denied')
  ) {
    return {
      classification: 'permission',
      message: `Permission denied for command ${aoCommand.id}: ${message}`,
      retryable: false,
    };
  }

  // Throttle errors (retryable)
  if (
    messageLower.includes('429') ||
    messageLower.includes('toomany') ||
    messageLower.includes('throttle')
  ) {
    return {
      classification: 'throttle',
      message: `Rate limit exceeded for command ${aoCommand.id}: ${message}`,
      retryable: true,
    };
  }

  // Network errors (retryable)
  if (
    messageLower.includes('econnrefused') ||
    messageLower.includes('etimedout') ||
    messageLower.includes('network error') ||
    messageLower.includes('connection reset')
  ) {
    return {
      classification: 'network',
      message: `Network error for command ${aoCommand.id}: ${message}`,
      retryable: true,
    };
  }

  // Validation errors (NOT retryable)
  if (
    messageLower.includes('validation') ||
    messageLower.includes('invalid') ||
    messageLower.includes('required')
  ) {
    return {
      classification: 'validation',
      message: `Validation error for command ${aoCommand.id}: ${message}`,
      retryable: false,
    };
  }

  // Unknown error (NOT retryable)
  return {
    classification: 'unknown',
    message: `Unknown error for command ${aoCommand.id}: ${message}`,
    retryable: false,
  };
}
