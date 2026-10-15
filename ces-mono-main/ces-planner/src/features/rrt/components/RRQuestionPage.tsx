// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect } from 'react';
import type { RRQuestion, RRTAnswer, EvidenceItem } from '../types';
import { ProvenanceSelector } from './ProvenanceSelector';
import { EvidenceCollector } from './EvidenceCollector';
import { Badge } from '@/shared/components/Display/Badge';
import { Card } from '@/shared/components/Display/Card';

const ASSESSOR_METHOD_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  examine: { label: 'Examine', description: 'Review documentation and artifacts', icon: '📄' },
  interview: { label: 'Interview', description: 'Discuss with personnel', icon: '💬' },
  test: { label: 'Test', description: 'Validate through testing', icon: '🧪' },
};

const ENUM_VALUE_DESCRIPTIONS: Record<string, string> = {
  implemented: 'The practice is fully in place, operating as intended, and producing expected outcomes.',
  fully_implemented: 'The practice is fully in place, operating as intended, and producing expected outcomes.',
  partial: 'The practice is partially in place — some aspects are operational but gaps remain.',
  partially_implemented: 'The practice is partially in place — some aspects are operational but gaps remain.',
  not_implemented: 'The practice is not yet in place. No operational evidence exists.',
  not_applicable: 'The practice does not apply to this environment based on scope or boundary decisions.',
};

function RRValueGuide({ options }: { options: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1">
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
            <div key={opt} className="px-3 py-2">
              <div className="font-medium text-gray-900">{opt}</div>
              {ENUM_VALUE_DESCRIPTIONS[opt] && (
                <p className="text-gray-600 text-xs mt-0.5">{ENUM_VALUE_DESCRIPTIONS[opt]}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RRQuestionPageProps {
  question: RRQuestion;
  activityName: string;
  existingAnswer?: RRTAnswer;
  onAnswer: (answer: RRTAnswer) => void;
  onNext: () => void;
  onBack: () => void;
  onCancel?: () => void;
  isFirst: boolean;
  isLast: boolean;
  progress: { current: number; total: number };
  onOpenRequirement?: (requirementId: string) => void;
  onSeek?: (questionIndex: number) => void;
}

export function RRQuestionPage({
  question,
  activityName,
  existingAnswer,
  onAnswer,
  onNext,
  onBack,
  onCancel,
  isFirst,
  isLast,
  progress,
  onOpenRequirement,
  onSeek,
}: RRQuestionPageProps) {
  const [value, setValue] = useState<any>(existingAnswer?.answer || '');
  const [provenance, setProvenance] = useState<RRTAnswer['provenance_class']>(
    existingAnswer?.provenance_class || 'auto_collected'
  );
  const [notes, setNotes] = useState(existingAnswer?.notes || '');
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);

  useEffect(() => {
    if (existingAnswer) {
      setValue(existingAnswer.answer);
      setProvenance(existingAnswer.provenance_class);
      setNotes(existingAnswer.notes || '');
      return;
    }

    const normalizedType = question.answer_type === 'yes_no' ? 'boolean' : question.answer_type;
    if (normalizedType === 'enum') {
      setValue('not_implemented');
    } else if (normalizedType === 'multi_select') {
      setValue([]);
    } else {
      setValue('');
    }
    setProvenance('auto_collected');
    setNotes('');
  }, [existingAnswer, question.question_id, question.answer_type]);

  const handleSubmit = () => {
    const answer: RRTAnswer = {
      question_id: question.question_id,
      answer: value,
      provenance_class: provenance,
      mapped_requirements: question.mapped_requirements || [],
      assessor_methods_satisfied: question.assessor_methods || [],
      expected_evidence_archetypes: question.expected_evidence_archetypes || [],
      evidence_ids: evidence.map((e) => e.evidence_id),
      notes: notes || undefined,
    };

    onAnswer(answer);
    onNext();
  };

  const renderInput = () => {
    const normalizedType = question.answer_type === 'yes_no' ? 'boolean' : question.answer_type;

    switch (normalizedType) {
      case 'boolean':
        return (
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                checked={value === true}
                onChange={() => setValue(true)}
                className="mr-2"
              />
              Yes
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                checked={value === false}
                onChange={() => setValue(false)}
                className="mr-2"
              />
              No
            </label>
          </div>
        );

      case 'enum': {
        const hasGuide = question.enum_values?.some((o) => ENUM_VALUE_DESCRIPTIONS[o]);
        return (
          <div className="space-y-2">
            {hasGuide && <RRValueGuide options={question.enum_values || []} />}
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select an option...</option>
              {question.enum_values?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        );
      }

      case 'multi_select': {
        const selectedValues = Array.isArray(value) ? value : [];
        return (
          <div className="space-y-2 border border-gray-200 rounded-lg p-3">
            {question.enum_values?.map((opt) => {
              const checked = selectedValues.includes(opt);
              return (
                <label key={opt} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selectedValues, opt]
                        : selectedValues.filter((value: string) => value !== opt);
                      setValue(next);
                    }}
                    className="mt-1"
                  />
                  <span className="text-sm font-medium text-gray-900">{opt}</span>
                </label>
              );
            })}
          </div>
        );
      }

      case 'url':
        return (
          <input
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        );

      case 'structured_json':
        return (
          <textarea
            value={typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2)}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
          />
        );

      case 'free_text':
        return (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        );

      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        );

      case 'array':
        return (
          <textarea
            value={Array.isArray(value) ? value.join('\n') : ''}
            onChange={(e) => setValue(e.target.value.split('\n').filter((v) => v.trim()))}
            rows={4}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        );

      case 'evidence_upload':
        return (
          <div className="text-sm text-gray-600">
            Use the Evidence section below to attach artifacts for this question.
          </div>
        );

      default:
        return (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        );
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      {/* Progress header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-500">
            Question {progress.current} of {progress.total}
          </span>
          {onSeek ? (
            <input
              type="range"
              min={1}
              max={progress.total}
              value={progress.current}
              onChange={(e) => onSeek(Number(e.target.value) - 1)}
              className="flex-1 mx-4 h-2 cursor-pointer accent-green-600 bg-slate-200"
              style={{
                borderRadius: '0px',
                WebkitAppearance: 'none',
                appearance: 'none',
              }}
            />
          ) : (
            <div className="flex-1 mx-4 bg-gray-200 rounded-none h-2">
              <div
                className="bg-green-600 h-2 rounded-none transition-all"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
        <Badge variant="info">{activityName}</Badge>
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between mb-6">
        <button
          onClick={onBack}
          disabled={isFirst}
          className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>

        <button
          onClick={handleSubmit}
          className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          {isLast ? 'Review Posture' : 'Next'}
        </button>
      </div>

      {/* Two-column layout: Main question + Advisory sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main question panel (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6" data-question-id={question.question_id}>
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Has the client done this:
            </p>
            <h2 className="text-2xl font-bold font-serif text-gray-900 mb-4">{question.question_text}</h2>

            {question.description && (
              <p className="text-gray-600 mb-4">{question.description}</p>
            )}

            {/* Advisor Guidance */}
            {question.advisor_description && (
              <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded">
                <div className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">💡</span>
                  <div>
                    <h4 className="text-sm font-medium text-green-900 mb-1">Advisor Guidance</h4>
                    <p className="text-sm text-green-800">{question.advisor_description}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Mapped Requirements */}
            {question.mapped_requirements && question.mapped_requirements.length > 0 && (
              <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded">
                <h4 className="text-sm font-medium text-blue-900 mb-2">Mapped Requirements</h4>
                <div className="flex flex-wrap gap-2">
                  {question.mapped_requirements.map((req) => (
                    <button
                      key={req}
                      onClick={() => onOpenRequirement?.(req)}
                      className="cursor-pointer hover:ring-2 hover:ring-blue-400 rounded-none transition-shadow"
                    >
                      <Badge variant="info" size="sm">
                        {req}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Assessor Methods */}
            {question.assessor_methods && question.assessor_methods.length > 0 && (
              <div className="mb-6 p-3 bg-slate-50 border border-slate-200 rounded">
                <h4 className="text-sm font-medium text-slate-900 mb-2">Assessor Methods</h4>
                <div className="flex flex-wrap gap-3">
                  {question.assessor_methods.map((method) => {
                    const info = ASSESSOR_METHOD_LABELS[method] || { label: method, description: '', icon: '📋' };
                    return (
                      <div key={method} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded border border-slate-200">
                        <span>{info.icon}</span>
                        <span className="text-sm font-medium text-slate-900">{info.label}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-700 mt-2">
                  Assessors will use these methods to validate your response.
                </p>
              </div>
            )}

            {/* Answer input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Answer</label>
              {renderInput()}
            </div>

            {/* Provenance */}
            <div className="mb-6">
              <ProvenanceSelector value={provenance} onChange={setProvenance} />
            </div>

            {/* Evidence collection */}
            <div className="mb-6">
              <EvidenceCollector
                evidence={evidence}
                onAdd={(e) => setEvidence([...evidence, e])}
                onRemove={(id) => setEvidence(evidence.filter((e) => e.evidence_id !== id))}
              />
            </div>

            {/* Notes */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Add any additional context or notes..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Advisory sidebar (1/3 width) */}
        <div className="space-y-4">
          {/* Why This Matters */}
          {question.advisor_reason_rrt && (
            <Card title="Why This Matters">
              <p className="text-sm text-gray-700">{question.advisor_reason_rrt}</p>
            </Card>
          )}

          {/* CMMC Impact */}
          {question.advisor_cmmc_impact && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-amber-900 mb-2 flex items-center gap-2">
                <span>⚠️</span> CMMC Impact
              </h4>
              <p className="text-sm text-amber-800">{question.advisor_cmmc_impact}</p>
            </div>
          )}

          {/* Expected Evidence — enriched from evidence_requests */}
          {question.expected_evidence && question.expected_evidence.length > 0 && (
            <Card title="Expected Evidence">
              <div className="space-y-3">
                {question.expected_evidence.map((ev, idx) => {
                  const matchedReq = question.evidence_requests?.find(
                    (r) => r.evidence_type === ev.archetype_id || r.archetype_id === ev.archetype_id
                  );
                  const archetypeLabel = ev.archetype_id
                    ? ev.archetype_id.replace(/^emx-/i, '').replace(/-(\d+)$/, ' #$1').replace(/-/g, ' ')
                    : 'Evidence';
                  return (
                    <div key={idx} className="p-3 bg-gray-50 rounded border border-gray-200">
                      <div className="flex items-start gap-2">
                        <span className="text-green-600 mt-0.5">📎</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900 capitalize">
                            {archetypeLabel}
                          </p>
                          {matchedReq?.description && (
                            <p className="text-xs text-gray-600 mt-1">{matchedReq.description}</p>
                          )}
                          {matchedReq?.acceptable_forms && matchedReq.acceptable_forms.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs text-gray-500 mb-1">Acceptable forms:</p>
                              <div className="flex flex-wrap gap-1">
                                {matchedReq.acceptable_forms.map((form) => (
                                  <span key={form} className="px-2 py-0.5 bg-gray-200 rounded text-xs text-gray-700">
                                    {form}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {matchedReq?.collection_method && (
                            <p className="text-xs text-gray-500 mt-2">
                              <span className="font-medium">Collection:</span> {matchedReq.collection_method}
                            </p>
                          )}
                          {matchedReq?.advisor_notes && (
                            <p className="text-xs text-gray-500 italic mt-1">
                              {matchedReq.advisor_notes}
                            </p>
                          )}
                          {!matchedReq && ev.minimum_fields && ev.minimum_fields.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs text-gray-500 mb-1">Required fields:</p>
                              <div className="flex flex-wrap gap-1">
                                {ev.minimum_fields.map((field) => (
                                  <span key={field} className="px-2 py-0.5 bg-gray-200 rounded text-xs text-gray-700">
                                    {field}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Steps/Guidance */}
          {question.steps && question.steps.length > 0 && (
            <Card title="Guidance Steps">
              <ol className="space-y-2">
                {question.steps.map((step, idx) => (
                  <li key={idx} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium">
                      {step.step_number || idx + 1}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">{step.instruction}</p>
                      {step.expected_output && (
                        <p className="text-xs text-gray-500 mt-1">→ {step.expected_output}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* Produces RRT Fields (technical reference) */}
          {question.produces_rrt_fields && question.produces_rrt_fields.length > 0 && (
            <details className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <summary className="text-xs font-medium text-gray-500 cursor-pointer">
                Technical: RRT Fields
              </summary>
              <div className="mt-2 space-y-1">
                {question.produces_rrt_fields.map((field) => (
                  <code key={field} className="block text-xs text-gray-600 font-mono">
                    {field}
                  </code>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Cancel button */}
      {onCancel && (
        <div className="flex justify-end mt-6">
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
