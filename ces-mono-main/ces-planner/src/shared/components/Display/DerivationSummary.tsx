// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';

export interface DerivationEntry {
  questionId: string;
  questionPrompt: string;
  derivedValue: string;
  source: string;
}

interface DerivationSummaryProps {
  entries: DerivationEntry[];
  sourceLabel: string;
}

/**
 * Dismissable callout shown once when derived answers are applied.
 * Lists each derived question, its pre-filled value, and the upstream source field.
 */
export function DerivationSummary({ entries, sourceLabel }: DerivationSummaryProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || entries.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-blue-900">
            {entries.length} {entries.length === 1 ? 'question' : 'questions'} answered from{' '}
            {sourceLabel}
          </h3>
          <p className="mt-1 text-xs text-blue-700">
            These were auto-filled and skipped. You can navigate back to review or override any
            value.
          </p>
          <ul className="mt-2 space-y-1">
            {entries.map((e) => (
              <li key={e.questionId} className="text-xs text-blue-800 flex gap-2">
                <span className="font-mono text-blue-600 shrink-0">{e.questionId}</span>
                <span className="truncate">
                  &rarr; <span className="font-medium">{e.derivedValue}</span>
                  <span className="text-blue-500 ml-1">({e.source})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-blue-400 hover:text-blue-600"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
