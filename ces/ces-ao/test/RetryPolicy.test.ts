// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { shouldRetry } from '../src/execution/RetryPolicy.js';
import type { ErrorResult } from '../src/execution/ErrorHandler.js';

const retryable: ErrorResult = { classification: 'throttle', message: 'x', retryable: true };
const nonRetryable: ErrorResult = { classification: 'permission', message: 'x', retryable: false };

// Characterization tests for retry decision + exponential backoff.
describe('shouldRetry', () => {
  it('retries retryable errors on attempt 0 with 1000ms backoff', () => {
    expect(shouldRetry(retryable, 0)).toEqual({ retry: true, delayMs: 1000 });
  });

  it('retries retryable errors on attempt 1 with 2000ms backoff', () => {
    expect(shouldRetry(retryable, 1)).toEqual({ retry: true, delayMs: 2000 });
  });

  it('does NOT retry once attemptCount >= 2 (max 3 attempts)', () => {
    expect(shouldRetry(retryable, 2)).toEqual({ retry: false, delayMs: 0 });
    expect(shouldRetry(retryable, 3)).toEqual({ retry: false, delayMs: 0 });
  });

  it('never retries non-retryable errors regardless of attempt', () => {
    expect(shouldRetry(nonRetryable, 0)).toEqual({ retry: false, delayMs: 0 });
  });
});
