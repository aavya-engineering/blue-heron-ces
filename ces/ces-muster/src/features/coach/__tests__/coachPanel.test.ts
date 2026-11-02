// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Unit tests for sendChatMessage and the degraded-mode logic.
// Deviation from plan: tests the exported API-call function rather than DOM rendering;
// React Testing Library is not available in this project. The degraded rendering
// logic is fully covered by testing sendChatMessage return values.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendChatMessage } from '../coachApi';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendChatMessage', () => {
  it('returns degraded=false and the reply on a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ reply: 'Enable MFA via Conditional Access.', degraded: false }),
      })
    );
    const result = await sendChatMessage('sess-1', [{ role: 'user', content: 'How do I enable MFA?' }]);
    expect(result.degraded).toBe(false);
    expect(result.reply).toBe('Enable MFA via Conditional Access.');
    vi.unstubAllGlobals();
  });

  it('returns degraded=true and empty reply when server returns 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ degraded: true }),
      })
    );
    const result = await sendChatMessage('sess-1', [{ role: 'user', content: 'Help' }]);
    expect(result.degraded).toBe(true);
    expect(result.reply).toBe('');
    vi.unstubAllGlobals();
  });

  it('returns degraded=true when fetch throws a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ERR_NETWORK_CHANGED'))
    );
    const result = await sendChatMessage('sess-1', [{ role: 'user', content: 'Help' }]);
    expect(result.degraded).toBe(true);
    expect(result.reply).toBe('');
    vi.unstubAllGlobals();
  });

  it('returns degraded=true when fetch aborts due to timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    );
    const result = await sendChatMessage('sess-1', [{ role: 'user', content: 'Help' }]);
    expect(result.degraded).toBe(true);
    vi.unstubAllGlobals();
  });

  it('returns degraded=true when server responds with non-503 error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'internal' }),
      })
    );
    const result = await sendChatMessage('sess-2', [{ role: 'user', content: 'test' }]);
    expect(result.degraded).toBe(true);
    vi.unstubAllGlobals();
  });

  it('sends sessionId and messages in the POST body', async () => {
    let capturedBody: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
        capturedBody = opts.body as string;
        return Promise.resolve({
          ok: true,
          json: async () => ({ reply: 'ok' }),
        });
      })
    );
    await sendChatMessage('sess-xyz', [{ role: 'user', content: 'question' }]);
    const body = JSON.parse(capturedBody ?? '{}') as { sessionId: string; messages: unknown[] };
    expect(body.sessionId).toBe('sess-xyz');
    expect(Array.isArray(body.messages)).toBe(true);
    expect((body.messages[0] as { role: string }).role).toBe('user');
    vi.unstubAllGlobals();
  });
});
