// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import clsx from 'clsx';
import type { RunlistEntry, BTCAnswer } from '../types';
import type { BTCEvidenceRef } from '@/shared/types/artifacts';

interface RunlistSidebarProps {
  entries: RunlistEntry[];
  currentIndex: number;
  answers: Record<string, BTCAnswer>;
  evidenceItems: BTCEvidenceRef[];
  onEntryClick: (index: number) => void;
  derivedQuestionIds?: Set<string>;
  skippableQuestionIds?: Set<string>;
}

export function RunlistSidebar({
  entries,
  currentIndex,
  answers,
  evidenceItems,
  onEntryClick,
  derivedQuestionIds,
  skippableQuestionIds,
}: RunlistSidebarProps) {
  // Group by section
  const sections = new Map<string, { name: string; entries: { entry: RunlistEntry; index: number }[] }>();
  entries.forEach((entry, idx) => {
    const existing = sections.get(entry.section_id);
    if (existing) {
      existing.entries.push({ entry, index: idx });
    } else {
      sections.set(entry.section_id, {
        name: entry.domain,
        entries: [{ entry, index: idx }],
      });
    }
  });

  const evidenceByQuestion = new Map<string, number>();
  for (const e of evidenceItems) {
    evidenceByQuestion.set(e.question_id, (evidenceByQuestion.get(e.question_id) || 0) + 1);
  }

  return (
    <nav className="w-64 shrink-0">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Verification Runlist
      </h3>
      <div className="space-y-4">
        {Array.from(sections.entries()).map(([sectionId, section]) => {
          const answeredCount = section.entries.filter(({ entry }) => answers[entry.question_id]).length;
          const allAnswered = answeredCount === section.entries.length;

          return (
            <div key={sectionId}>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1 flex items-center justify-between">
                <span className="truncate">{section.name}</span>
                {allAnswered && (
                  <svg className="w-3.5 h-3.5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </h4>
              <ul className="space-y-0.5">
                {section.entries.map(({ entry, index }) => {
                  const isCurrent = index === currentIndex;
                  const isAnswered = !!answers[entry.question_id];
                  const evidenceCount = evidenceByQuestion.get(entry.question_id) || 0;
                  const needsEvidence = entry.evidence_required && evidenceCount === 0;
                  const isDerived = derivedQuestionIds?.has(entry.question_id);
                  const isSkippable = skippableQuestionIds?.has(entry.question_id);

                  return (
                    <li key={entry.question_id}>
                      <button
                        onClick={() => onEntryClick(index)}
                        className={clsx(
                          'w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-1.5',
                          isCurrent
                            ? 'bg-primary-100 text-primary-900 font-medium'
                            : isAnswered
                              ? 'bg-green-50 text-green-800 hover:bg-green-100'
                              : 'text-gray-600 hover:bg-gray-100'
                        )}
                      >
                        <span className="truncate flex-1">{entry.question_id}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          {isDerived && (
                            <span
                              className="text-[10px] px-1 rounded bg-blue-100 text-blue-700 font-medium"
                              title="Derived from SI/CUI"
                            >
                              SI
                            </span>
                          )}
                          {isSkippable && (
                            <span
                              className="text-[10px] px-1 rounded bg-gray-100 text-gray-500 italic"
                              title="Auto-skipped"
                            >
                              skip
                            </span>
                          )}
                          {entry.mode !== 'full' && (
                            <span
                              className={clsx(
                                'text-[10px] px-1 rounded',
                                entry.mode === 'minimal'
                                  ? 'bg-gray-200 text-gray-600'
                                  : 'bg-slate-100 text-slate-700'
                              )}
                            >
                              {entry.mode}
                            </span>
                          )}
                          {needsEvidence && (
                            <svg className="w-3 h-3 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                          {evidenceCount > 0 && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded">
                              {evidenceCount}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
