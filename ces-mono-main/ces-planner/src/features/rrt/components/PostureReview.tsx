// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReadinessPosture, RequirementStatus } from '@/shared/types/artifacts';
import { Card } from '@/shared/components/Display/Card';
import { Badge } from '@/shared/components/Display/Badge';
import { dbHelpers } from '@/shared/db/schema';
import { validateReadinessPosture } from '@/shared/validation/validators';
import { Alert } from '@/shared/components/Display/Alert';
import { generateArtifactId } from '@/shared/utils/idGenerator';
import { useAppStore } from '@/shared/stores/appStore';
import { persistReadinessPosture } from '@/shared/services/artifactPersistence';
import type { RRQuestion, RRTAnswer } from '../types';

interface PostureReviewProps {
  posture: ReadinessPosture;
  questionSetId: number;
  baselineId: number;
  onBack: () => void;
  allQuestions: Array<{ question: RRQuestion; activityName: string }>;
  answers: Record<string, RRTAnswer>;
  onGoToQuestion: (questionIndex: number) => void;
  cesId?: string;
}

export function PostureReview({
  posture,
  questionSetId,
  baselineId,
  onBack,
  allQuestions,
  answers,
  onGoToQuestion,
  cesId,
}: PostureReviewProps) {
  const navigate = useNavigate();
  const { setSelectedPostureId } = useAppStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<RequirementStatus | null>(null);

  // Build a set of requirement IDs per status for quick lookup
  const reqIdsByStatus = useMemo(() => {
    const map: Record<RequirementStatus, Set<string>> = {
      met: new Set(),
      partial: new Set(),
      not_met: new Set(),
      unknown: new Set(),
    };
    for (const r of posture.ces.requirement_results) {
      map[r.status]?.add(r.requirement_id);
    }
    return map;
  }, [posture.ces.requirement_results]);

  // Questions matching the selected status
  const matchingQuestions = useMemo(() => {
    if (!selectedStatus) return [];
    const reqIds = reqIdsByStatus[selectedStatus];
    return allQuestions
      .map((q, idx) => ({ ...q, index: idx }))
      .filter((q) => q.question.mapped_requirements?.some((r) => reqIds.has(r)));
  }, [selectedStatus, reqIdsByStatus, allQuestions]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      // Validate against schema (non-blocking)
      const validation = validateReadinessPosture(posture);
      if (!validation.valid) {
        console.warn('Schema validation warnings for Readiness Posture:', validation.errors);
      }

      const artifactId = generateArtifactId('readiness_posture');
      const { currentCustomerId } = useAppStore.getState();
      const id = await dbHelpers.createReadinessPosture({
        customerId: currentCustomerId!,
        questionSetId,
        baselineId,
        artifactId,
        cesId,
        data: posture,
        createdAt: new Date().toISOString(),
      });

      // Persist to local disk
      await persistReadinessPosture(posture, currentCustomerId!, artifactId);

      // Update app store with the new posture ID
      setSelectedPostureId(id);

      console.log('Readiness Posture saved with ID:', id);
      navigate('/dashboard');
    } catch (err) {
      console.error('Error saving posture:', err);
      setError(err instanceof Error ? err.message : 'Failed to save posture');
      setSaving(false);
    }
  };

  const summary = posture.ces.control_status_summary;
  const total = summary.met + summary.partial + summary.not_met + summary.unknown;

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold font-serif text-gray-900 mb-2">Review Readiness Posture</h1>
        <p className="text-gray-600">
          Review the assessment results before saving. This posture will be used for mission planning.
        </p>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="flex justify-between mb-6">
        <button
          onClick={onBack}
          disabled={saving}
          className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Back to Questions
        </button>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Saving...
            </>
          ) : (
            'Save Readiness Posture'
          )}
        </button>
      </div>

      <div className="space-y-6">
        <Card title="Control Status Summary">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            <div className="text-center">
              <div className="text-sm font-medium text-gray-500">Level</div>
              <div className="text-xl font-bold text-blue-600">
                {summary.level}
                <span className="text-sm font-normal text-gray-400 ml-1">/ {total}</span>
              </div>
            </div>
            {(
              [
                {
                  key: 'met' as const,
                  label: 'Met',
                  count: summary.met,
                  textColor: 'text-green-600',
                  activeRing: 'ring-2 ring-green-400 bg-green-50',
                },
                {
                  key: 'partial' as const,
                  label: 'Partial',
                  count: summary.partial,
                  textColor: 'text-yellow-600',
                  activeRing: 'ring-2 ring-yellow-400 bg-yellow-50',
                },
                {
                  key: 'not_met' as const,
                  label: 'Not Met',
                  count: summary.not_met,
                  textColor: 'text-red-600',
                  activeRing: 'ring-2 ring-red-400 bg-red-50',
                },
                {
                  key: 'unknown' as const,
                  label: 'Unknown',
                  count: summary.unknown,
                  textColor: 'text-gray-600',
                  activeRing: 'ring-2 ring-gray-400 bg-gray-100',
                },
              ]
            ).map(({ key, label, count, textColor, activeRing }) => (
              <button
                key={key}
                onClick={() => setSelectedStatus(selectedStatus === key ? null : key)}
                className={`text-center rounded-lg p-2 transition-all cursor-pointer ${
                  selectedStatus === key ? activeRing : 'hover:bg-gray-50'
                }`}
              >
                <div className={`text-3xl font-bold ${textColor}`}>{count}</div>
                <div className="text-sm text-gray-500">{label}</div>
              </button>
            ))}
            <div className="text-center">
              <div className="text-3xl font-bold text-primary-600">{total}</div>
              <div className="text-sm text-gray-500">Total</div>
            </div>
          </div>
        </Card>

        {selectedStatus && matchingQuestions.length > 0 && (
          <Card
            title={`Questions Contributing to '${
              selectedStatus === 'not_met'
                ? 'Not Met'
                : selectedStatus.charAt(0).toUpperCase() + selectedStatus.slice(1)
            }' (${matchingQuestions.length})`}
          >
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {matchingQuestions.map((q) => {
                const answer = answers[q.question.question_id];
                const answerDisplay = answer
                  ? typeof answer.answer === 'boolean'
                    ? answer.answer
                      ? 'Yes'
                      : 'No'
                    : String(answer.answer)
                  : 'Unanswered';
                return (
                  <button
                    key={q.question.question_id}
                    onClick={() => onGoToQuestion(q.index)}
                    className="w-full text-left flex items-center gap-3 p-2 rounded hover:bg-blue-50 transition-colors group"
                  >
                    <span className="flex-shrink-0 w-8 h-8 bg-gray-100 group-hover:bg-blue-100 rounded-full flex items-center justify-center text-xs font-mono text-gray-600">
                      {q.index + 1}
                    </span>
                    <span className="flex-shrink-0">
                      <Badge variant="info" size="sm">
                        {q.activityName}
                      </Badge>
                    </span>
                    <span className="flex-1 text-sm text-gray-800 truncate">
                      {q.question.question_text}
                    </span>
                    <span className="flex-shrink-0">
                      <Badge
                        variant={answer ? 'neutral' : 'warning'}
                        size="sm"
                      >
                        {answerDisplay.length > 20
                          ? answerDisplay.slice(0, 20) + '...'
                          : answerDisplay}
                      </Badge>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {posture.ces.key_findings.length > 0 && (
          <Card title="Key Findings">
            <div className="space-y-2">
              {posture.ces.key_findings.map((finding, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded border border-gray-200">
                  <Badge
                    variant={
                      finding.severity === 'critical' || finding.severity === 'high'
                        ? 'error'
                        : finding.severity === 'medium'
                        ? 'warning'
                        : 'neutral'
                    }
                  >
                    {finding.severity}
                  </Badge>
                  <span className="text-sm">{finding.statement}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="Requirement Results">
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {posture.ces.requirement_results.map((result) => (
              <div
                key={result.requirement_id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-200"
              >
                <div className="flex-1">
                  <span className="font-mono text-sm font-medium">{result.requirement_id}</span>
                  <div className="text-xs text-gray-500 mt-1">
                    Evidence: {result.evidence_refs.length} items
                    {result.notes && ` • ${result.notes}`}
                  </div>
                </div>
                <Badge
                  variant={
                    result.status === 'met'
                      ? 'success'
                      : result.status === 'not_met'
                      ? 'error'
                      : result.status === 'partial'
                      ? 'warning'
                      : 'neutral'
                  }
                >
                  {result.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Evidence Index">
          <p className="text-sm text-gray-600 mb-3">
            {posture.ces.evidence_index.length} evidence items collected
          </p>
          {posture.ces.evidence_index.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {posture.ces.evidence_index.map((evidence) => (
                <div
                  key={evidence.evidence_id}
                  className="p-2 bg-gray-50 rounded border border-gray-200"
                >
                  <p className="text-sm font-medium truncate">{evidence.location}</p>
                  <p className="text-xs text-gray-500">{evidence.source_system}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Metadata">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Snapshot ID</dt>
              <dd className="mt-1 text-sm text-gray-900 font-mono">{posture.ces.snapshot_id}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Version</dt>
              <dd className="mt-1 text-sm text-gray-900">{posture.ces.version}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Generated On</dt>
              <dd className="mt-1 text-sm text-gray-900">{posture.ces.generated_on}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">As Of Date</dt>
              <dd className="mt-1 text-sm text-gray-900">{posture.ces.as_of_date}</dd>
            </div>
          </dl>
        </Card>
      </div>

    </div>
  );
}
