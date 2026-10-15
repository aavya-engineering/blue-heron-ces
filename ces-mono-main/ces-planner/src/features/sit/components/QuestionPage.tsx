// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect } from 'react';
import type { QuestionDefinition, SITAnswer } from '../types';
import { AnswerInput } from './AnswerInput';
import { AdvisorGuidance } from './AdvisorGuidance';
import { toISODateTime } from '@/shared/utils/dateFormatter';

interface QuestionPageProps {
  question: QuestionDefinition;
  existingAnswer?: SITAnswer;
  onAnswer: (answer: SITAnswer) => void;
  onNext: () => void;
  onBack: () => void;
  onBeforeBack?: (answer: SITAnswer) => void;
  onCancel?: () => void;
  isFirst: boolean;
  isLast: boolean;
  progress: { current: number; total: number };
  isPreviousRun?: boolean;
  isRecommended?: boolean;
}

export function QuestionPage({
  question,
  existingAnswer,
  onAnswer,
  onNext,
  onBack,
  onBeforeBack,
  onCancel,
  isFirst,
  isLast,
  progress,
  isPreviousRun,
  isRecommended,
}: QuestionPageProps) {
  const [value, setValue] = useState<string | number | string[] | Record<string, unknown> | boolean>(
    () => {
      if (existingAnswer?.raw_answer !== undefined) return existingAnswer.raw_answer;
      if (question.answer_type === 'multi_select') return [];
      if (question.answer_type === 'structured_object') return {};
      return '';
    }
  );
  const [provenance, setProvenance] = useState<SITAnswer['provenance_class']>(
    existingAnswer?.provenance_class || 'client_assertion'
  );
  const [notes, setNotes] = useState(existingAnswer?.notes || '');

  // Reset form state when question changes
  useEffect(() => {
    if (existingAnswer) {
      setValue(existingAnswer.raw_answer);
      setProvenance(existingAnswer.provenance_class);
      setNotes(existingAnswer.notes || '');
    } else {
      // Clear values when moving to a question with no existing answer
      if (question.answer_type === 'multi_select') {
        setValue([]);
      } else if (question.answer_type === 'structured_object') {
        setValue({});
      } else {
        setValue('');
      }
      setProvenance('client_assertion');
      setNotes('');
    }
  }, [question.question_id, existingAnswer]);

  const handleSubmit = () => {
    const answer: SITAnswer = {
      question_id: question.question_id,
      answer_type: question.answer_type,
      raw_answer: value,
      captured_at: toISODateTime(new Date()),
      provenance_class: provenance,
      notes: notes || undefined,
    };

    onAnswer(answer);
    onNext();
  };

  const isValid = () => {
    if (question.validation?.required) {
      if (Array.isArray(value)) return value.length > 0;
      if (question.answer_type === 'structured_object') {
        if (typeof value !== 'object' || value === null) return false;
        return Object.values(value).some((entry) => entry !== '' && entry !== null && entry !== undefined);
      }
      return value !== '' && value !== null && value !== undefined;
    }
    return true;
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-500">
            Question {progress.current} of {progress.total}
          </span>
          <div className="flex-1 mx-4 bg-gray-200 rounded-none h-2">
            <div
              className="bg-blue-600 h-2 rounded-none transition-all"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between mb-6">
        <button
          onClick={() => {
            if (onBeforeBack) {
              const answer: SITAnswer = {
                question_id: question.question_id,
                answer_type: question.answer_type,
                raw_answer: value,
                captured_at: toISODateTime(new Date()),
                provenance_class: provenance,
                notes: notes || undefined,
              };
              onBeforeBack(answer);
            }
            onBack();
          }}
          disabled={isFirst}
          className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>

        <button
          onClick={handleSubmit}
          disabled={!isValid()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLast ? 'Review Baseline' : 'Next'}
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-question-id={question.question_id}>
        {isPreviousRun && (
          <div className="mb-4 rounded-md bg-gray-50 border border-gray-300 px-3 py-2">
            <span className="text-sm text-gray-700">
              Pre-filled from your previous SI Baseline.
            </span>
          </div>
        )}
        {isRecommended && (
          <div className="mb-4 rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
            <span className="text-sm text-amber-700">
              Pre-filled with recommended default — please review.
            </span>
          </div>
        )}
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{question.question_text}</h2>

        {question.description && (
          <p className="text-gray-600 mb-6">{question.description}</p>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Your Answer</label>
          <AnswerInput question={question} value={value} onChange={setValue} />
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Provenance (Source of Information)
          </label>
          <select
            value={provenance}
            onChange={(e) => setProvenance(e.target.value as SITAnswer['provenance_class'])}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="client_assertion">Client Assertion</option>
            <option value="operator_observation">Operator Observation</option>
            <option value="operator_inference">Operator Inference</option>
            <option value="assumption">Assumption</option>
            <option value="system_observation">System Observation</option>
          </select>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Notes (Optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Add any additional context or notes..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <AdvisorGuidance question={question} />
      </div>

      {onCancel && (
        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="px-6 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
