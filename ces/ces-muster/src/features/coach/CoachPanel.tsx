// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * Coach Panel — collapsible right-side chat assistant for the assessment page.
 *
 * Online: sends {sessionId, messages} to POST /coach/chat and renders the reply.
 * Degraded (503 / any failure): shows static guidance from the current question's
 * mapped_requirements plus "Coach unavailable — offline mode" notice.
 * No retry loop — one attempt per user submission.
 */
import { useState } from 'react';
import { sendChatMessage, type CoachMessage } from './coachApi';

export interface CoachPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  /** Mapped requirement codes for the currently-active question cluster. */
  currentRequirements: string[];
}

/** Build static guidance text from requirement codes when coach is unavailable. */
function staticGuidance(requirements: string[]): string {
  if (requirements.length === 0) return 'Refer to CMMC Level 2 practice documentation.';
  return `Refer to: ${requirements.join(', ')} in the CMMC Level 2 Assessment Guide.`;
}

export default function CoachPanel({
  isOpen,
  onClose,
  sessionId,
  currentRequirements,
}: CoachPanelProps) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);

  if (!isOpen) return null;

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    const userMsg: CoachMessage = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setDegraded(false);

    const result = await sendChatMessage(sessionId, next);
    setLoading(false);

    if (result.degraded) {
      setDegraded(true);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: staticGuidance(currentRequirements) },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.reply },
      ]);
    }
  };

  return (
    <div className="coach-panel" role="complementary" aria-label="Coach assistant">
      <div className="coach-panel-header">
        <span className="coach-panel-title">Coach</span>
        <button
          className="coach-panel-close"
          onClick={onClose}
          aria-label="Close coach panel"
        >
          ✕
        </button>
      </div>

      {degraded && (
        <p className="callout-warning" data-testid="coach-degraded-notice">
          Coach unavailable — offline mode
        </p>
      )}

      <div className="coach-messages" data-testid="coach-messages">
        {messages.length === 0 && (
          <p className="coach-empty">Ask a question about your CMMC controls.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`coach-message coach-message--${m.role}`}
            data-testid={`coach-msg-${m.role}`}
          >
            {m.content}
          </div>
        ))}
        {loading && <p className="coach-loading">…</p>}
      </div>

      <div className="coach-input-row">
        <input
          type="text"
          className="coach-input"
          placeholder="Ask the coach…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          disabled={loading}
          aria-label="Coach message input"
        />
        <button
          className="btn btn-primary"
          onClick={() => void send()}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
