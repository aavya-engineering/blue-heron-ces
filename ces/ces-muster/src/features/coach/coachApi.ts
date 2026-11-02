// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * Coach API client — thin wrapper around POST /coach/chat.
 * Separated from CoachPanel.tsx so non-component exports don't
 * violate the react-refresh/only-export-components ESLint rule.
 */
import { api } from '@/shared/api/musterApi';

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  reply: string;
  degraded?: boolean;
}

/**
 * Send a chat message to the coach API.
 * Returns {reply, degraded: false} on success.
 * Returns {reply: '', degraded: true} on any failure or 503.
 */
export async function sendChatMessage(
  sessionId: string,
  messages: CoachMessage[]
): Promise<{ reply: string; degraded: boolean }> {
  const result = await api.post<ChatResponse>('/coach/chat', { sessionId, messages });
  if (!result.ok) {
    return { reply: '', degraded: true };
  }
  return { reply: result.data.reply, degraded: result.data.degraded === true };
}
