// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import clsx from 'clsx';
import type { PolicySectionDef, PolicyAnswer } from '../types';

interface PolicySectionProgressProps {
  sections: PolicySectionDef[];
  currentSectionIndex: number;
  currentQuestionIndex: number;
  answers: Record<string, PolicyAnswer>;
  sectionCompletionMap: Record<string, boolean>;
  onSectionClick: (index: number) => void;
  onQuestionClick: (sectionIndex: number, questionIndex: number) => void;
}

export function PolicySectionProgress({
  sections,
  currentSectionIndex,
  currentQuestionIndex,
  answers,
  sectionCompletionMap,
  onSectionClick,
  onQuestionClick,
}: PolicySectionProgressProps) {
  return (
    <nav className="w-64 shrink-0">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Sections
      </h3>
      <div className="space-y-3">
        {sections.map((section, sIdx) => {
          const isCurrent = sIdx === currentSectionIndex;
          const isComplete = sectionCompletionMap[section.id] ?? false;
          const answeredInSection = section.questions.filter((q) => answers[q.id]).length;
          const totalInSection = section.questions.length;

          return (
            <div key={section.id}>
              <button
                onClick={() => onSectionClick(sIdx)}
                className={clsx(
                  'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                  isCurrent
                    ? 'bg-primary-100 text-primary-900 font-medium'
                    : isComplete
                      ? 'bg-green-50 text-green-800 hover:bg-green-100'
                      : 'text-gray-700 hover:bg-gray-100',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{section.name}</span>
                  {isComplete ? (
                    <svg
                      className="w-4 h-4 text-green-600 shrink-0 ml-2"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <span className="text-xs text-gray-400 ml-2">
                      {answeredInSection}/{totalInSection}
                    </span>
                  )}
                </div>
              </button>
              {isCurrent && (
                <ul className="mt-1 ml-2 space-y-0.5">
                  {section.questions.map((q, qIdx) => {
                    const isCurrentQ = isCurrent && qIdx === currentQuestionIndex;
                    const isAnswered = !!answers[q.id];

                    return (
                      <li key={q.id}>
                        <button
                          onClick={() => onQuestionClick(sIdx, qIdx)}
                          className={clsx(
                            'w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center gap-1.5',
                            isCurrentQ
                              ? 'bg-primary-100 text-primary-900 font-medium'
                              : isAnswered
                                ? 'bg-green-50 text-green-800 hover:bg-green-100'
                                : 'text-gray-600 hover:bg-gray-100',
                          )}
                        >
                          <span className="truncate flex-1">{q.id}</span>
                          {isAnswered && (
                            <svg
                              className="w-3 h-3 text-green-500 shrink-0"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
