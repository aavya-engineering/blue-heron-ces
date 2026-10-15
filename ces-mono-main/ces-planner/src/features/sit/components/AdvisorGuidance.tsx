// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import type { QuestionDefinition } from '../types';

interface AdvisorGuidanceProps {
  question: QuestionDefinition;
}

export function AdvisorGuidance({ question }: AdvisorGuidanceProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const guidance = question.advisor_guidance;
  if (!guidance) return null;

  const hasContent =
    guidance.description ||
    guidance.reason ||
    (guidance.pitfalls && guidance.pitfalls.length > 0) ||
    guidance.implications ||
    (guidance.rr_implications && guidance.rr_implications.length > 0) ||
    (guidance.mpt_gate_implications && guidance.mpt_gate_implications.length > 0);

  if (!hasContent) return null;

  return (
    <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-blue-100 transition-colors"
      >
        <span className="font-medium text-blue-900">Advisor Guidance</span>
        <svg
          className={`w-5 h-5 text-blue-700 transform transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="px-4 py-3 space-y-4 border-t border-blue-200">
          {guidance.description && (
            <div>
              <h4 className="text-sm font-medium text-blue-900 mb-1">Description</h4>
              <p className="text-sm text-blue-800">{guidance.description}</p>
            </div>
          )}

          {guidance.reason && (
            <div>
              <h4 className="text-sm font-medium text-blue-900 mb-1">Why This Matters</h4>
              <p className="text-sm text-blue-800">{guidance.reason}</p>
            </div>
          )}

          {guidance.pitfalls && guidance.pitfalls.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-red-900 mb-1">Common Pitfalls</h4>
              <ul className="list-disc list-inside space-y-1">
                {guidance.pitfalls.map((pitfall, index) => (
                  <li key={index} className="text-sm text-red-800">
                    {pitfall}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {guidance.implications && (
            <div>
              <h4 className="text-sm font-medium text-blue-900 mb-1">CMMC Impact</h4>
              <p className="text-sm text-blue-800">{guidance.implications}</p>
            </div>
          )}

          {guidance.rr_implications && guidance.rr_implications.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-blue-900 mb-1">Readiness Recon Implications</h4>
              <ul className="list-disc list-inside space-y-1">
                {guidance.rr_implications.map((implication, index) => (
                  <li key={index} className="text-sm text-blue-800">
                    {implication}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {guidance.mpt_gate_implications && guidance.mpt_gate_implications.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-amber-900 mb-1">Mission Planning Gate Implications</h4>
              <ul className="list-disc list-inside space-y-1">
                {guidance.mpt_gate_implications.map((implication, index) => (
                  <li key={index} className="text-sm text-amber-800">
                    {implication}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
