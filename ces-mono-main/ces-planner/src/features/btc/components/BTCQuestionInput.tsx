// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect } from 'react';
import type { BTCQuestionDef } from '../types';

interface BTCQuestionInputProps {
  question: BTCQuestionDef;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  error?: string;
}

export function BTCQuestionInput({ question, value, onChange, error }: BTCQuestionInputProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (newValue: string | boolean) => {
    setLocalValue(newValue);
    onChange(newValue);
  };

  const optionHelp = question.option_help;

  if (question.answer_type === 'boolean') {
    const boolOptions = ['Yes', 'No'] as const;
    return (
      <div className="space-y-2">
        {boolOptions.map((option) => {
          const isSelected =
            (option === 'Yes' && localValue === true) ||
            (option === 'No' && localValue === false);
          const help = optionHelp?.[option];
          return (
            <div key={option}>
              <label className="flex items-start gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer">
                <input
                  type="radio"
                  name={question.id}
                  value={option}
                  checked={isSelected}
                  onChange={() => handleChange(option === 'Yes')}
                  className="mt-0.5 text-primary-600 focus:ring-primary-500"
                />
                <div>
                  <span className="text-sm text-gray-700">{option}</span>
                  {help?.description && (
                    <p className="text-xs text-gray-400 mt-0.5">{help.description}</p>
                  )}
                </div>
              </label>
              {isSelected && help?.implication && (
                <div className="ml-8 mt-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
                  {help.implication}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // single_select
  return (
    <div>
      <div className="space-y-2">
        {question.options.map((option) => {
          const isSelected = localValue === option;
          const help = optionHelp?.[option];
          return (
            <div key={option}>
              <label className="flex items-start gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer">
                <input
                  type="radio"
                  name={question.id}
                  value={option}
                  checked={isSelected}
                  onChange={(e) => handleChange(e.target.value)}
                  className="mt-0.5 text-primary-600 focus:ring-primary-500"
                />
                <div>
                  <span className="text-sm text-gray-700">{option}</span>
                  {help?.description && (
                    <p className="text-xs text-gray-400 mt-0.5">{help.description}</p>
                  )}
                </div>
              </label>
              {isSelected && help?.implication && (
                <div className="ml-8 mt-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
                  {help.implication}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
