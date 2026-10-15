// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import type { TCPQuestionDef } from '../types';
import type { RiskFlagLabels } from '@/shared/types/help';

interface TCPGuidancePanelProps {
  question: TCPQuestionDef;
  riskFlagLabels?: RiskFlagLabels;
}

export function TCPGuidancePanel({ question, riskFlagLabels }: TCPGuidancePanelProps) {
  const [expanded, setExpanded] = useState(true);
  const guidance = question.guidance;

  const hasStructured =
    guidance?.description ||
    guidance?.why_it_matters ||
    guidance?.implications ||
    (guidance?.common_pitfalls && guidance.common_pitfalls.length > 0);

  const hasContent =
    hasStructured ||
    question.help ||
    question.roles.primary_respondents.length > 0 ||
    question.roles.validators.length > 0 ||
    question.risk_flags.length > 0;

  if (!hasContent) return null;

  const humanizeFlag = (flag: string) => riskFlagLabels?.[flag] || flag.replace(/_/g, ' ');

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
      >
        <span>Guidance</span>
        <span className="text-xs text-gray-400">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {hasStructured ? (
            <>
              {guidance!.description && (
                <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded p-3">
                  <h4 className="font-medium text-blue-900 mb-1">Description</h4>
                  <p>{guidance!.description}</p>
                </div>
              )}

              {guidance!.why_it_matters && (
                <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded p-3">
                  <h4 className="font-medium text-blue-900 mb-1">Why This Matters</h4>
                  <p>{guidance!.why_it_matters}</p>
                </div>
              )}

              {guidance!.common_pitfalls && guidance!.common_pitfalls.length > 0 && (
                <div className="text-sm bg-amber-50 border border-amber-200 rounded p-3">
                  <h4 className="font-medium text-amber-900 mb-1">Common Pitfalls</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {guidance!.common_pitfalls.map((pitfall, i) => (
                      <li key={i} className="text-amber-800">
                        {pitfall}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {guidance!.implications && (
                <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded p-3">
                  <h4 className="font-medium text-blue-900 mb-1">Manifest Impact</h4>
                  <p>{guidance!.implications}</p>
                </div>
              )}
            </>
          ) : (
            question.help && (
              <div className="text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded p-3">
                {question.help}
              </div>
            )
          )}

          {(question.roles.primary_respondents.length > 0 ||
            question.roles.validators.length > 0) && (
            <div className="text-sm">
              {question.roles.primary_respondents.length > 0 && (
                <p className="text-gray-600">
                  <span className="font-medium text-gray-700">Respondents: </span>
                  {question.roles.primary_respondents.join(', ')}
                </p>
              )}
              {question.roles.validators.length > 0 && (
                <p className="text-gray-600 mt-1">
                  <span className="font-medium text-gray-700">Validators: </span>
                  {question.roles.validators.join(', ')}
                </p>
              )}
            </div>
          )}

          {question.risk_flags.length > 0 && (
            <div className="space-y-1">
              {question.risk_flags.map((flag) => (
                <div
                  key={flag}
                  className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5"
                >
                  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>{humanizeFlag(flag)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
