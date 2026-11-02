// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// PlanInputField.tsx — FC-MU (MU-10, closes F9): the typed input for a non-enum
// plan-input node (counts, notes, lists, the certification timing goal).
// The value is validated with the SAME parser the SI adapter types it with
// (siPlanInputNodes.parsePlanInputAnswer) and committed on blur / Enter; an
// invalid value is never recorded — the reason is shown instead.
import { useState } from 'react';
import type { PlanInputKind } from '@/features/interview/questionGraph';
import { parsePlanInputAnswer } from '@/features/interview/siPlanInputNodes';

const PLACEHOLDER: Record<PlanInputKind, string> = {
  number: 'a whole number, e.g. 25',
  text: 'free text',
  list: 'comma-separated, e.g. CTI, Export Controlled',
  time_goal: 'YYYY-MM-DD, a number of days, or ASAP (optionally "; driver")',
  upn: 'approver@contoso.com',
  // file / secret have their own widgets (TouFileField / InitialPasswordField).
  file: '',
  secret: '',
};

export default function PlanInputField({
  id,
  kind,
  value,
  onCommit,
}: {
  id: string;
  kind: PlanInputKind;
  /** The recorded answer ('' when unanswered). */
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');

  const commit = () => {
    const text = draft.trim();
    if (text === '' || text === value) {
      setError('');
      return;
    }
    const parsed = parsePlanInputAnswer(kind, text);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError('');
    onCommit(text);
  };

  return (
    <div className="field">
      <input
        type={kind === 'number' ? 'number' : 'text'}
        min={kind === 'number' ? 0 : undefined}
        step={kind === 'number' ? 1 : undefined}
        name={id}
        data-testid={`plan-input-${id}`}
        placeholder={PLACEHOLDER[kind]}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {error && (
        <p className="form-error" data-testid={`plan-input-error-${id}`}>
          {error}
        </p>
      )}
    </div>
  );
}
