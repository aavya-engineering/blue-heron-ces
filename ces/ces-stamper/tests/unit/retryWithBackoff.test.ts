// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { jest } from '@jest/globals';
import { retryWithBackoff } from '../../src/utils/retryWithBackoff';

describe('retryWithBackoff', () => {
  it('should return result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on throttle error and succeed', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('TooManyRequests'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after exhausting retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('429 throttled'));

    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 }))
      .rejects.toThrow('429 throttled');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-throttle errors by default', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Invalid argument'));

    await expect(retryWithBackoff(fn)).rejects.toThrow('Invalid argument');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should detect Request_ResourceNotAvailable as throttle', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('Request_ResourceNotAvailable'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should detect 429 status code in message', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('HTTP 429: too many requests'))
      .mockResolvedValue('done');

    const result = await retryWithBackoff(fn, { baseDelayMs: 10 });
    expect(result).toBe('done');
  });

  it('should detect rate limit in stderr', async () => {
    const err: any = new Error('command failed');
    err.stderr = 'Rate limit exceeded';
    const fn = jest.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 10 });
    expect(result).toBe('ok');
  });

  it('should use custom shouldRetry predicate', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('custom-retriable'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, {
      baseDelayMs: 10,
      shouldRetry: (err) => err.message.includes('custom-retriable'),
    });
    expect(result).toBe('ok');
  });

  it('should respect maxRetries=1 (no retries)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('429'));

    await expect(retryWithBackoff(fn, { maxRetries: 1 })).rejects.toThrow('429');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use exponential backoff delays', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('throttled'))
      .mockRejectedValueOnce(new Error('throttled'))
      .mockResolvedValue('ok');

    const start = Date.now();
    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 50 });
    const elapsed = Date.now() - start;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    // First delay: 50ms, second delay: 100ms = total ~150ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('should handle fn returning undefined', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    const result = await retryWithBackoff(fn);
    expect(result).toBeUndefined();
  });

  it('should propagate non-Error throwables', async () => {
    const fn = jest.fn().mockRejectedValue('string error');
    await expect(retryWithBackoff(fn)).rejects.toBe('string error');
  });

  it('should handle fn returning a number', async () => {
    const fn = jest.fn().mockResolvedValue(42);
    const result = await retryWithBackoff(fn);
    expect(result).toBe(42);
  });
});
