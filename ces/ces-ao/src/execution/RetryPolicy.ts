// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 7: Retry Policy
// Determines retry behavior for failed commands

import type { ErrorResult } from './ErrorHandler.js';

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
}

/**
 * Determine if command should be retried.
 * Retry rules:
 * - Max 3 attempts (attemptCount 0, 1, 2)
 * - Retryable errors: 'throttle', 'network'
 * - Non-retryable: 'permission', 'validation', 'unknown'
 *
 * Exponential backoff: 1000ms, 2000ms, 4000ms
 *
 * @param error - ErrorResult from ErrorHandler
 * @param attemptCount - Current attempt number (0-indexed)
 * @returns { retry: boolean, delayMs: number }
 */
export function shouldRetry(error: ErrorResult, attemptCount: number): RetryDecision {
  // Max 3 attempts (0, 1, 2)
  if (attemptCount >= 2) {
    return { retry: false, delayMs: 0 };
  }

  // Only retry throttle and network errors
  if (!error.retryable) {
    return { retry: false, delayMs: 0 };
  }

  // Exponential backoff: 1000ms, 2000ms, 4000ms
  const backoffDelays = [1000, 2000, 4000];
  const delayMs = backoffDelays[attemptCount] || 4000;

  return { retry: true, delayMs };
}
