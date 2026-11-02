// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Retry a function with exponential backoff.
 * Detects Graph API 429/throttling and transient auth failures.
 */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  shouldRetry?: (err: any) => boolean;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

function isThrottleError(err: any): boolean {
  const combined = [err?.message, err?.stderr, String(err)]
    .filter(Boolean).join(' ').toLowerCase();
  return combined.includes('request_resourcenotavailable') ||
    combined.includes('toomanyrequests') ||
    combined.includes('429') ||
    combined.includes('throttled') ||
    combined.includes('rate limit');
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    shouldRetry = isThrottleError,
  } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < maxRetries - 1 && shouldRetry(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}
