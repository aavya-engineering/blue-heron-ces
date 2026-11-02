// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { handleExecutionError } from '../src/execution/ErrorHandler.js';
import { makeAoCommand } from './fixtures.js';

// Characterization tests for error classification + retryable flags.
const ao = makeAoCommand({ id: 'A-09' });

describe('handleExecutionError', () => {
  it('classifies permission errors as NOT retryable', () => {
    const r = handleExecutionError({ message: 'Insufficient privileges' }, ao);
    expect(r.classification).toBe('permission');
    expect(r.retryable).toBe(false);
    expect(r.message).toBe('Permission denied for command A-09: Insufficient privileges');
  });

  it('classifies throttle errors (429/TooMany) as retryable', () => {
    const r = handleExecutionError({ message: '429 TooManyRequests' }, ao);
    expect(r.classification).toBe('throttle');
    expect(r.retryable).toBe(true);
    expect(r.message).toBe('Rate limit exceeded for command A-09: 429 TooManyRequests');
  });

  it('classifies network errors (ECONNREFUSED) as retryable', () => {
    const r = handleExecutionError({ message: 'ECONNREFUSED' }, ao);
    expect(r.classification).toBe('network');
    expect(r.retryable).toBe(true);
  });

  it('classifies validation errors as NOT retryable', () => {
    const r = handleExecutionError({ message: 'field is required' }, ao);
    expect(r.classification).toBe('validation');
    expect(r.retryable).toBe(false);
  });

  it('classifies anything else as unknown / NOT retryable', () => {
    const r = handleExecutionError({ message: 'boom' }, ao);
    expect(r.classification).toBe('unknown');
    expect(r.retryable).toBe(false);
    expect(r.message).toBe('Unknown error for command A-09: boom');
  });

  it('falls back to error.stderr when message is absent', () => {
    const r = handleExecutionError({ stderr: 'access denied' }, ao);
    expect(r.classification).toBe('permission');
  });

  it('accepts a raw string error', () => {
    const r = handleExecutionError('ETIMEDOUT happened', ao);
    expect(r.classification).toBe('network');
    expect(r.retryable).toBe(true);
  });
});
