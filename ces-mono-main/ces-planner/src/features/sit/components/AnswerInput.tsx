// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useEffect, useState } from 'react';
import type { QuestionDefinition, EnumOption } from '../types';

type AnswerValue = string | number | string[] | Record<string, unknown> | boolean;

interface AnswerInputProps {
  question: QuestionDefinition;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}

function ValueGuide({ options }: { options: EnumOption[] }) {
  const [open, setOpen] = useState(false);
  const hasDetails = options.some(
    (o) => o.description || o.cmmc_attainment_impact || o.advisor_notes
  );
  if (!hasDetails) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
        {open ? 'Hide' : 'Show'} answer value guide
      </button>
      {open && (
        <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 bg-gray-50 text-sm">
          {options.map((opt) => (
            <div key={opt.value} className="px-3 py-2">
              <div className="font-medium text-gray-900">{opt.value}</div>
              {opt.description && (
                <p className="text-gray-600 text-xs mt-0.5">{opt.description}</p>
              )}
              {opt.cmmc_attainment_impact && (
                <p className="text-xs text-amber-700 mt-0.5">
                  <span className="font-medium">Impact:</span> {opt.cmmc_attainment_impact}
                </p>
              )}
              {opt.advisor_notes && (
                <p className="text-xs text-gray-500 italic mt-0.5">{opt.advisor_notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AnswerInput({ question, value, onChange }: AnswerInputProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (newValue: AnswerValue) => {
    setLocalValue(newValue);
    onChange(newValue);
  };

  switch (question.answer_type) {
    case 'boolean':
      return (
        <div className="flex gap-4">
          <label className="flex items-center">
            <input
              type="radio"
              checked={localValue === true}
              onChange={() => handleChange(true)}
              className="mr-2"
            />
            Yes
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              checked={localValue === false}
              onChange={() => handleChange(false)}
              className="mr-2"
            />
            No
          </label>
        </div>
      );

    case 'enum':
      return (
        <div className="space-y-2">
          {question.enum_values && <ValueGuide options={question.enum_values} />}
          <select
            value={typeof localValue === 'string' ? localValue : ''}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required={question.validation?.required}
          >
            <option value="">Select an option...</option>
            {question.enum_values?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
          {/* Show description of selected option */}
          {localValue && question.enum_values?.find(opt => opt.value === localValue)?.description && (
            <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
              {question.enum_values.find(opt => opt.value === localValue)?.description}
            </p>
          )}
        </div>
      );

    case 'multi_select': {
      const selectedValues = Array.isArray(localValue) ? localValue : [];

      return (
        <div className="space-y-3">
          {question.enum_values && <ValueGuide options={question.enum_values} />}
          <div className="space-y-2 border border-gray-200 rounded-lg p-3">
            {question.enum_values?.map((option) => {
              const checked = selectedValues.includes(option.value);
              return (
                <label key={option.value} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selectedValues, option.value]
                        : selectedValues.filter((value) => value !== option.value);
                      handleChange(next);
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="text-sm font-medium text-gray-900">{option.value}</span>
                    {option.description && (
                      <span className="block text-xs text-gray-600 mt-1">
                        {option.description}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      );
    }

    case 'structured_object': {
      const structuredValue =
        typeof localValue === 'object' && localValue !== null && !Array.isArray(localValue)
          ? (localValue as Record<string, unknown>)
          : {};

      const schemaEntries = Object.entries(question.structured_schema || {});

      if (schemaEntries.length === 0) {
        return (
          <textarea
            value={typeof localValue === 'string' ? localValue : ''}
            onChange={(e) => handleChange(e.target.value)}
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        );
      }

      return (
        <div className="space-y-4">
          {schemaEntries.map(([fieldKey, fieldDef]) => {
            const fieldValue = structuredValue[fieldKey];
            const label = fieldKey.replace(/_/g, ' ');

            if (fieldDef.type === 'enum') {
              return (
                <div key={fieldKey}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
                  <select
                    value={typeof fieldValue === 'string' ? fieldValue : ''}
                    onChange={(e) =>
                      handleChange({
                        ...structuredValue,
                        [fieldKey]: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select an option...</option>
                    {fieldDef.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            if (fieldDef.type === 'integer') {
              return (
                <div key={fieldKey}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
                  <input
                    type="number"
                    step={1}
                    inputMode="numeric"
                    value={typeof fieldValue === 'number' ? fieldValue : ''}
                    onChange={(e) =>
                      handleChange({
                        ...structuredValue,
                        [fieldKey]: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              );
            }

            if (fieldDef.type === 'date') {
              return (
                <div key={fieldKey}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
                  <input
                    type="date"
                    value={typeof fieldValue === 'string' ? fieldValue : ''}
                    onChange={(e) =>
                      handleChange({
                        ...structuredValue,
                        [fieldKey]: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              );
            }

            return (
              <div key={fieldKey}>
                <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
                <textarea
                  value={typeof fieldValue === 'string' ? fieldValue : ''}
                  onChange={(e) =>
                    handleChange({
                      ...structuredValue,
                      [fieldKey]: e.target.value,
                    })
                  }
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            );
          })}
        </div>
      );
    }

    case 'number':
      return (
        <input
          type="number"
          value={typeof localValue === 'number' ? localValue : ''}
          onChange={(e) => handleChange(parseFloat(e.target.value) || 0)}
          min={question.validation?.min}
          max={question.validation?.max}
          required={question.validation?.required}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      );

    case 'array':
      return (
        <div className="space-y-2">
          <textarea
            value={Array.isArray(localValue) ? localValue.join('\n') : ''}
            onChange={(e) => handleChange(e.target.value.split('\n').filter((v) => v.trim()))}
            placeholder="Enter one item per line..."
            rows={4}
            required={question.validation?.required}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-sm text-gray-500">Enter one item per line</p>
        </div>
      );

    case 'string':
    default:
      return (
        <textarea
          value={typeof localValue === 'string' ? localValue : ''}
          onChange={(e) => handleChange(e.target.value)}
          rows={3}
          required={question.validation?.required}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      );
  }
}
