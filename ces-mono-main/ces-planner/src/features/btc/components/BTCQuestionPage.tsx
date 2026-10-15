// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect, useMemo } from 'react';
import { BTCQuestionInput } from './BTCQuestionInput';
import { BTCEvidenceGate } from './BTCEvidenceGate';
import { BTCEvidenceCollector } from './BTCEvidenceCollector';
import { BTCGuidancePanel } from './BTCGuidancePanel';
import { GlossaryText } from '@/shared/components/Display/GlossaryText';
import { useGlossary } from '@/shared/hooks/useDataLoader';
import { validateAnswer } from '@/shared/utils/answerValidation';
import clsx from 'clsx';
import type { RunlistEntry, BTCAnswer } from '../types';
import type { BTCEvidenceRef } from '@/shared/types/artifacts';

interface BTCQuestionPageProps {
  entry: RunlistEntry;
  existingAnswer?: BTCAnswer;
  evidenceForQuestion: BTCEvidenceRef[];
  onAnswer: (answer: BTCAnswer) => void;
  onNext: () => void;
  onBack: () => void;
  onCancel: () => void;
  isFirst: boolean;
  isLast: boolean;
  progress: { current: number; total: number };
  isDerived?: boolean;
  isRecommended?: boolean;
  isPreviousRun?: boolean;
}

export function BTCQuestionPage({
  entry,
  existingAnswer,
  evidenceForQuestion,
  onAnswer,
  onNext,
  onBack,
  onCancel,
  isFirst,
  isLast,
  progress,
  isDerived,
  isRecommended,
  isPreviousRun,
}: BTCQuestionPageProps) {
  const [value, setValue] = useState<string | boolean>('');
  const [notes, setNotes] = useState('');
  const { data: glossaryData } = useGlossary();

  useEffect(() => {
    if (existingAnswer) {
      setValue(existingAnswer.raw_answer);
      setNotes(existingAnswer.notes || '');
    } else {
      setValue('');
      setNotes('');
    }
  }, [entry.question_id, existingAnswer]);

  const validation = useMemo(
    () =>
      validateAnswer(
        entry.question.answer_type,
        value,
        entry.question.options,
        entry.question_id,
      ),
    [entry.question.answer_type, entry.question.options, entry.question_id, value],
  );

  const isValid = () => {
    if (!validation.valid) return false;
    if (!entry.required) return true;
    if (typeof value === 'boolean') return true;
    if (typeof value === 'string') return value.trim() !== '';
    return false;
  };

  const evidenceGateMet =
    !entry.evidence_required || evidenceForQuestion.length > 0;

  const canProceed = isValid() && evidenceGateMet;

  const handleSubmit = () => {
    const answer: BTCAnswer = {
      question_id: entry.question_id,
      raw_answer: value,
      mode: entry.mode,
      evidence_ids: evidenceForQuestion.map((e) => e.evidence_id),
      captured_at: new Date().toISOString(),
      notes: notes || undefined,
    };
    onAnswer(answer);
    onNext();
  };

  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  const glossary = glossaryData?.glossary || [];
  const riskFlagLabels = glossaryData?.risk_flag_labels;
  const evidenceGuidance = entry.question.guidance?.evidence_guidance;

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div>
        <div className="flex items-center justify-between text-sm text-gray-500 mb-1">
          <span className="font-medium text-gray-700">{entry.domain}</span>
          <span>
            {progress.current} of {progress.total}
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
            onClick={onBack}
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
          disabled={!canProceed}
          className="px-6 py-2 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLast ? 'Review Confirmation' : 'Next'}
        </button>
      </div>

      {/* Question Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-6" data-question-id={entry.question_id}>
        {isPreviousRun && (
          <div className="mb-4 rounded-md bg-gray-50 border border-gray-300 px-3 py-2">
            <span className="text-sm text-gray-700">
              Pre-filled from your previous BTC Confirmation save.
            </span>
          </div>
        )}
        {isDerived && (
          <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-3 py-2">
            <span className="text-sm text-blue-800">
              This answer was derived from SI/CUI data. Submitting will override the derived value.
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
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-mono text-gray-400">{entry.question_id}</span>
          <span
            className={clsx(
              'text-xs px-1.5 py-0.5 rounded font-medium',
              entry.mode === 'full'
                ? 'bg-blue-100 text-blue-700'
                : entry.mode === 'minimal'
                  ? 'bg-gray-200 text-gray-600'
                  : 'bg-slate-100 text-slate-700'
            )}
          >
            {entry.mode}
          </span>
          {entry.required && (
            <span className="text-xs text-red-500 font-medium">Required</span>
          )}
        </div>

        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          {glossary.length > 0 ? (
            <GlossaryText text={entry.question.prompt} glossary={glossary} />
          ) : (
            entry.question.prompt
          )}
        </h2>
        {entry.question.help && (
          <p className="text-sm text-gray-500 mb-4">{entry.question.help}</p>
        )}

        <BTCQuestionInput question={entry.question} value={value} onChange={setValue} error={validation.error} />

        {/* Notes */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            placeholder="Additional context or observations..."
          />
        </div>
      </div>

      {/* Evidence Gate */}
      {entry.evidence_required && (
        <BTCEvidenceGate
          evidenceType={entry.evidence_type}
          evidenceSource={entry.evidence_source}
          attachedEvidence={evidenceForQuestion}
          evidenceGuidance={evidenceGuidance}
        />
      )}

      {/* Evidence Collector */}
      {entry.evidence_required && (
        <BTCEvidenceCollector
          questionId={entry.question_id}
          existingEvidence={evidenceForQuestion}
          evidenceHints={entry.question.bindings.evidence}
        />
      )}

      {/* Guidance */}
      <BTCGuidancePanel entry={entry} riskFlagLabels={riskFlagLabels} />
    </div>
  );
}
