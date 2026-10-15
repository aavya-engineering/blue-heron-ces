// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect } from 'react';
import type { TCPQuestionDef } from '../types';

interface TCPQuestionInputProps {
  question: TCPQuestionDef;
  value: string | number | boolean | string[];
  onChange: (value: string | number | boolean | string[]) => void;
  error?: string;
}

export function TCPQuestionInput({ question, value, onChange, error }: TCPQuestionInputProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (newValue: string | number | boolean | string[]) => {
    setLocalValue(newValue);
    onChange(newValue);
  };

  const optionHelp = question.option_help;

  switch (question.answer_type) {
    case 'guid': {
      const strVal = typeof localValue === 'string' ? localValue : '';
      return (
        <div>
          <input
            type="text"
            value={strVal}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={`w-full px-3 py-2 text-sm font-mono border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
          />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
      );
    }

    case 'upn_list':
      return (
        <div>
          <textarea
            value={Array.isArray(localValue) ? localValue.join('\n') : String(localValue)}
            onChange={(e) => {
              const lines = e.target.value
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
              handleChange(lines);
            }}
            rows={4}
            className={`w-full px-3 py-2 text-sm font-mono border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
            placeholder="user@domain.com&#10;admin@domain.com"
          />
          {error ? (
            <p className="text-xs text-red-500 mt-1">{error}</p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">One UPN per line</p>
          )}
        </div>
      );

    case 'boolean':
      return (
        <div className="space-y-2">
          {['Yes', 'No'].map((option) => {
            const boolVal = option === 'Yes';
            const isSelected = localValue === boolVal;
            return (
              <label
                key={option}
                className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="radio"
                  name={question.id}
                  checked={isSelected}
                  onChange={() => handleChange(boolVal)}
                  className="mt-0.5 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">{option}</span>
              </label>
            );
          })}
        </div>
      );

    case 'single_select':
      return (
        <div className="space-y-2">
          {question.options.map((option) => {
            const help = optionHelp?.[option];
            const isSelected = localValue === option;
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
      );

    case 'multi_select': {
      const hasNoneOption = question.options.includes('None');
      return (
        <div className="space-y-2 border border-gray-200 rounded-md p-3">
          {question.options.map((option) => {
            const selected = Array.isArray(localValue) && localValue.includes(option);
            const help = optionHelp?.[option];
            const isNoneSelected = Array.isArray(localValue) && localValue.includes('None');
            const disabledByNone = hasNoneOption && option !== 'None' && isNoneSelected;
            return (
              <div key={option}>
                <label
                  className={`flex items-start gap-3 p-1 ${disabledByNone ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabledByNone}
                    onChange={() => {
                      const current = Array.isArray(localValue) ? localValue : [];
                      if (hasNoneOption && option === 'None') {
                        handleChange(['None']);
                      } else {
                        const next = selected
                          ? current.filter((v) => v !== option)
                          : [...current.filter((v) => v !== 'None'), option];
                        handleChange(next);
                      }
                    }}
                    className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <span className="text-sm text-gray-700">{option}</span>
                    {help?.description && (
                      <p className="text-xs text-gray-400 mt-0.5">{help.description}</p>
                    )}
                  </div>
                </label>
                {selected && help?.implication && (
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

    case 'list':
      return (
        <div>
          <textarea
            value={Array.isArray(localValue) ? localValue.join('\n') : String(localValue)}
            onChange={(e) => {
              const lines = e.target.value
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
              handleChange(lines);
            }}
            rows={4}
            className={`w-full px-3 py-2 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
            placeholder="Enter one item per line..."
          />
          {error ? (
            <p className="text-xs text-red-500 mt-1">{error}</p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">One item per line</p>
          )}
        </div>
      );

    case 'number':
      return (
        <div>
          <input
            type="number"
            value={typeof localValue === 'number' ? localValue : 0}
            onChange={(e) => handleChange(Number(e.target.value))}
            min={0}
            className={`w-48 px-3 py-2 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
          />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
      );

    case 'text':
    default:
      return (
        <div>
          <textarea
            value={typeof localValue === 'string' ? localValue : String(localValue)}
            onChange={(e) => handleChange(e.target.value)}
            rows={3}
            className={`w-full px-3 py-2 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
            placeholder="Enter your response..."
          />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
      );
  }
}
