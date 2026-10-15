// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect, useMemo } from 'react';
import { TCPQuestionInput } from './TCPQuestionInput';
import { TCPGuidancePanel } from './TCPGuidancePanel';
import { GlossaryText } from '@/shared/components/Display/GlossaryText';
import { useGlossary } from '@/shared/hooks/useDataLoader';
import { validateAnswer } from '@/shared/utils/answerValidation';
import type { TCPQuestionDef, TCPAnswer } from '../types';

interface TCPSectionPageProps {
  question: TCPQuestionDef;
  existingAnswer?: TCPAnswer;
  onAnswer: (answer: TCPAnswer) => void;
  onNext: () => void;
  onBack: () => void;
  onBeforeBack?: (answer: TCPAnswer) => void;
  onCancel: () => void;
  isFirst: boolean;
  isLast: boolean;
  sectionName: string;
  progress: {
    current: number;
    total: number;
    sectionCurrent: number;
    sectionTotal: number;
  };
  allSectionsComplete: boolean;
  isDerived?: boolean;
  isRecommended?: boolean;
  isPreviousRun?: boolean;
}

export function TCPSectionPage({
  question,
  existingAnswer,
  onAnswer,
  onNext,
  onBack,
  onBeforeBack,
  onCancel,
  isFirst,
  isLast,
  sectionName,
  progress,
  allSectionsComplete,
  isDerived,
  isRecommended,
  isPreviousRun,
}: TCPSectionPageProps) {
  const [value, setValue] = useState<string | number | boolean | string[]>(
    getDefaultValue(question),
  );
  const [notes, setNotes] = useState('');
  const { data: glossaryData } = useGlossary();

  useEffect(() => {
    if (existingAnswer) {
      setValue(existingAnswer.raw_answer);
      setNotes(existingAnswer.notes || '');
    } else {
      setValue(getDefaultValue(question));
      setNotes('');
    }
  }, [question.id, existingAnswer]);

  const validation = useMemo(
    () => validateAnswer(question.answer_type, value, question.options, question.id),
    [question.answer_type, question.options, question.id, value],
  );

  const isValid = () => {
    if (!validation.valid) return false;
    if (!question.required) return true;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'number') return true;
    if (typeof value === 'boolean') return true;
    return value !== undefined && value !== null;
  };

  const handleSubmit = () => {
    const answer: TCPAnswer = {
      question_id: question.id,
      answer_type: question.answer_type,
      raw_answer: value,
      captured_at: new Date().toISOString(),
      provenance_class: 'client_assertion',
      notes: notes || undefined,
    };
    onAnswer(answer);
    onNext();
  };

  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  const glossary = glossaryData?.glossary || [];
  const riskFlagLabels = glossaryData?.risk_flag_labels;

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div>
        <div className="flex items-center justify-between text-sm text-gray-500 mb-1">
          <span className="font-medium text-gray-700">{sectionName}</span>
          <span>
            Question {progress.sectionCurrent} of {progress.sectionTotal} &middot;{' '}
            {progress.current} of {progress.total} overall
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-none h-2">
          <div
            className="bg-primary-600 h-2 rounded-none transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (onBeforeBack) {
                const answer: TCPAnswer = {
                  question_id: question.id,
                  answer_type: question.answer_type,
                  raw_answer: value,
                  captured_at: new Date().toISOString(),
                  provenance_class: 'client_assertion',
                  notes: notes || undefined,
                };
                onBeforeBack(answer);
              }
              onBack();
            }}
            disabled={isFirst}
            className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Back
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
        <button
          onClick={handleSubmit}
          disabled={!isValid()}
          className="px-6 py-2 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLast && allSectionsComplete ? 'Review Profile' : 'Next'}
        </button>
      </div>

      {/* Question */}
      <div className="bg-white rounded-lg border border-gray-200 p-6" data-question-id={question.id}>
        {isDerived && (
          <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-3 py-2">
            <span className="text-sm text-blue-800">
              This answer was derived from your SI Baseline. Submitting will override the derived
              value.
            </span>
          </div>
        )}
        {isRecommended && (
          <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
            <span className="text-sm text-amber-800">
              Pre-filled with the recommended default. Review and adjust before proceeding.
            </span>
          </div>
        )}
        {isPreviousRun && (
          <div className="mb-4 rounded-md bg-gray-50 border border-gray-300 px-3 py-2">
            <span className="text-sm text-gray-700">
              Pre-filled from your previous Tenant Config Profile.
            </span>
          </div>
        )}
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          {glossary.length > 0 ? (
            <GlossaryText text={question.prompt} glossary={glossary} />
          ) : (
            question.prompt
          )}
        </h2>
        {question.required && (
          <span className="text-xs text-red-500 font-medium">Required</span>
        )}
        {question.help && (
          <p className="mt-2 text-sm text-gray-500">{question.help}</p>
        )}

        <div className="mt-4">
          <TCPQuestionInput
            question={question}
            value={value}
            onChange={setValue}
            error={validation.error}
          />
        </div>

        {/* Notes */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            placeholder="Additional context or clarification..."
          />
        </div>
      </div>

      {/* Guidance */}
      <TCPGuidancePanel question={question} riskFlagLabels={riskFlagLabels} />
    </div>
  );
}

function getDefaultValue(
  question: TCPQuestionDef,
): string | number | boolean | string[] {
  switch (question.answer_type) {
    case 'multi_select':
    case 'list':
    case 'upn_list':
      return [];
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return '';
  }
}
