// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect } from 'react';
import { db } from '@/shared/db/schema';
import { nanoid } from '@/shared/utils/nanoid';
import { loadQuestionGraph, type QuestionNode } from '@/features/interview/questionGraphService';
import { useTimingContext } from '@/features/timer/timingCore';
import { createEngagement } from '@/features/intake/engagementService';
import { executeExportAndDownload } from '@/features/export/exportPipeline';
import type {
  EngagementKind,
  AssessedParty,
  InterviewSession,
  InterviewFact,
} from '@/shared/types/engagement';
import { updateAnswer, validateForm, computeStoppedSegments } from './quickSessionHelpers';

import { SERVICE_OPTIONS } from '@/features/assessment/AssessmentPage';

export default function QuickSession() {
  const [kind, setKind] = useState<EngagementKind>('individual_contractor');
  const [partyName, setPartyName] = useState('');
  const [uei, setUei] = useState('');
  const [cage, setCage] = useState('');
  const [onPremOt, setOnPremOt] = useState<'' | 'yes' | 'no' | 'unsure'>('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<QuestionNode[]>([]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const { segments, startSegment, stopSegment } = useTimingContext();

  useEffect(() => {
    startSegment('interview');
  }, [startSegment]);

  useEffect(() => {
    void loadQuestionGraph(selectedServices).then(setQuestions);
  }, [selectedServices]);

  const toggleService = (id: string) => {
    if (id === 'none') {
      setSelectedServices(['none']);
      return;
    }
    setSelectedServices((prev) => {
      const without = prev.filter((s) => s !== 'none');
      return without.includes(id) ? without.filter((s) => s !== id) : [...without, id];
    });
  };

  const handleExport = async () => {
    if (!validateForm(partyName, onPremOt)) {
      setError('Party name and on-prem/OT selection are required.');
      return;
    }
    setExporting(true);
    setError('');

    const stoppedSegments = computeStoppedSegments(segments, 'interview');
    stopSegment('interview');

    const engagement = await createEngagement(kind);

    const party: AssessedParty = {
      id: nanoid(),
      engagement_id: engagement.id,
      name: partyName,
      ...(uei ? { uei } : {}),
      ...(cage ? { cage } : {}),
      on_prem_ot: onPremOt as 'yes' | 'no' | 'unsure',
      created_at: new Date().toISOString(),
    };
    await db.assessed_parties.add(party);

    const facts: InterviewFact[] = questions
      .filter((q) => answers[q.id] !== undefined)
      .map((q) => ({
        question_id: q.id,
        question_text: q.text,
        answer: answers[q.id],
        provenance: 'operator_interview',
        confidence: answers[q.id] === 'unknown' ? 'unknown' : 'high',
        recorded_at: new Date().toISOString(),
      }));

    const sessionId = nanoid();
    const now = new Date().toISOString();
    const session: InterviewSession = {
      id: sessionId,
      party_id: party.id,
      facts,
      timing_segments: stoppedSegments,
      status: 'complete',
      created_at: now,
      selected_stacks: selectedServices,
      completed_at: now,
      current_question_index: Object.keys(answers).length,
    };
    await db.interview_sessions.add(session);

    await executeExportAndDownload(sessionId);
    setExporting(false);
  };

  return (
    <div className="page">
      <div className="ces-titleblock" style={{ marginBottom: 20 }}>
        <h1 className="tb-title" style={{ margin: 0 }}>Quick Session</h1>
        <span className="tb-designator">CONCIERGE / SINGLE PASS</span>
      </div>

      {/* Section (a): Sub Info */}
      <section>
        <div className="ces-titleblock" style={{ marginBottom: 12 }}>
          <h2 className="tb-title" style={{ margin: 0 }}>Subcontractor Information</h2>
        </div>
        <div className="field">
          <label className="field-label">
            Party Name <span className="req">*</span>
            <input type="text" value={partyName} onChange={(e) => setPartyName(e.target.value)} />
          </label>
        </div>
        <div className="field">
          <label className="field-label">
            UEI
            <input type="text" value={uei} onChange={(e) => setUei(e.target.value)} />
          </label>
        </div>
        <div className="field">
          <label className="field-label">
            CAGE Code
            <input type="text" value={cage} onChange={(e) => setCage(e.target.value)} />
          </label>
        </div>
        <div className="field">
          <span className="field-label">Engagement Kind</span>
          <div className="option-stack">
            <label className="radio-option">
              <input
                type="radio"
                name="kind"
                value="individual_contractor"
                checked={kind === 'individual_contractor'}
                onChange={() => setKind('individual_contractor')}
              />
              Individual Contractor
            </label>
            <label className="radio-option">
              <input
                type="radio"
                name="kind"
                value="prime_and_subs"
                checked={kind === 'prime_and_subs'}
                onChange={() => setKind('prime_and_subs')}
              />
              Prime and Subs
            </label>
          </div>
        </div>
      </section>

      {/* Section (b): Scope */}
      <section style={{ marginTop: 32 }}>
        <div className="ces-titleblock" style={{ marginBottom: 12 }}>
          <h2 className="tb-title" style={{ margin: 0 }}>Scope</h2>
        </div>
        <div className="field">
          <span className="field-label">
            Does the organization have on-premises Operational Technology (OT)?
          </span>
          <div className="option-stack">
            {(['yes', 'no', 'unsure'] as const).map((v) => (
              <label key={v} className="radio-option">
                <input
                  type="radio"
                  name="onPremOt"
                  value={v}
                  checked={onPremOt === v}
                  onChange={() => setOnPremOt(v)}
                />
                {v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Unsure'}
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* Section (c): Service Inventory + Interview Questions */}
      <section style={{ marginTop: 32 }}>
        <div className="ces-titleblock" style={{ marginBottom: 12 }}>
          <h2 className="tb-title" style={{ margin: 0 }}>Service Inventory</h2>
        </div>
        <p style={{ color: 'var(--co-text-muted)' }}>
          Which services does this organization use? (Select all that apply)
        </p>
        <div className="option-stack" style={{ marginBottom: 24 }}>
          {SERVICE_OPTIONS.map(({ id, label }) => (
            <label key={id} className="check-option">
              <input
                type="checkbox"
                checked={selectedServices.includes(id)}
                onChange={() => toggleService(id)}
              />
              {label}
            </label>
          ))}
        </div>

        {questions.length > 0 && (
          <>
            <div className="ces-titleblock" style={{ marginBottom: 12 }}>
              <h2 className="tb-title" style={{ margin: 0 }}>Interview Questions</h2>
            </div>
            {questions.map((q) => (
              <div key={q.id} className="question-card">
                <p className="q-text">{q.text}</p>
                <div className="option-stack">
                  {(['yes', 'no', 'unknown'] as const).map((v) => (
                    <label key={v} className="radio-option">
                      <input
                        type="radio"
                        name={q.id}
                        value={v}
                        checked={answers[q.id] === v}
                        onChange={() => setAnswers(updateAnswer(answers, q.id, v))}
                      />
                      {v === 'unknown' ? "I don't know" : v === 'yes' ? 'Yes' : 'No'}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      {/* Section (d): Export */}
      <section style={{ marginTop: 32, paddingBottom: 48 }}>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" onClick={() => void handleExport()} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export StatusPayload'}
        </button>
      </section>
    </div>
  );
}
