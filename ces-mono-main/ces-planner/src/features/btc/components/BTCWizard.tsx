// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBTCStore } from '../stores/btcStore';
import { useBTCQuestions } from '../hooks/useBTCQuestions';
import { useActivationPackage } from '../hooks/useActivationPackage';
import { useRunlistBuilder } from '../hooks/useRunlistBuilder';
import { BTCQuestionPage } from './BTCQuestionPage';
import { BTCReview } from './BTCReview';
import { RunlistSidebar } from './RunlistSidebar';
import { generateBTCConfirmation } from '../services/btcOutputGenerator';
import { seedDefaultEvidence } from '../services/defaultEvidence';
import { autofillBTCAnswers, newTenantBTCAnswers } from '../services/autofillService';
import { deriveBTCDefaults } from '../services/btcSICUIDerivation';
import { reverseMapBTCConfirmation } from '../services/btcAnswerHydrator';
import { findNextUnskipped } from '@/shared/utils/wizardNavigation';
import { AutofillButton } from '@/features/rrt/components/AutofillButton';
import { useAppStore } from '@/shared/stores/appStore';
import { dbHelpers } from '@/shared/db/schema';
import { makeCesTuple } from '@/shared/identity/cesTuple';
import { DerivationSummary } from '@/shared/components/Display/DerivationSummary';
import type { DerivationEntry } from '@/shared/components/Display/DerivationSummary';
import { buildRecommendations } from '@/shared/utils/applyRecommendations';
import type { BTCAnswer } from '../types';
import type { BTCConfirmationOutput, SIBaseline, CUIBoundaryOutput } from '@/shared/types/artifacts';

export function BTCWizard() {
  const navigate = useNavigate();
  const { sections, virtualQuestions, bankVersion, loading: bankLoading, error: bankError } = useBTCQuestions();
  const { rules, packageVersion, loading: rulesLoading, error: rulesError } = useActivationPackage();
  const { currentCustomerId, selectedBaselineId, selectedCUIBoundaryId } = useAppStore();
  const {
    currentRunlistIndex,
    answers,
    evidenceItems,
    setCurrentRunlistIndex,
    setAnswer,
    setRunlist,
  } = useBTCStore();

  const [siOutputs, setSiOutputs] = useState<Record<string, unknown> | null>(null);
  const [cuiOutputs, setCuiOutputs] = useState<Record<string, unknown> | null>(null);
  const [siBaseline, setSiBaseline] = useState<SIBaseline | null>(null);
  const [cuiBoundaryData, setCuiBoundaryData] = useState<CUIBoundaryOutput | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [confirmation, setConfirmation] = useState<BTCConfirmationOutput | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [derivationEntries, setDerivationEntries] = useState<DerivationEntry[]>([]);
  const [previousRunQuestionIds, setPreviousRunQuestionIds] = useState<Set<string>>(new Set());

  // Load previous BTC Confirmation answers as defaults when store is empty
  useEffect(() => {
    if (Object.keys(useBTCStore.getState().answers).length > 0) return;
    if (!currentCustomerId || !selectedBaselineId) return;
    const loadPrevious = async () => {
      const all = await dbHelpers.getBTCsByCustomerAndBaseline(
        currentCustomerId,
        selectedBaselineId,
      );
      if (all.length === 0) return;
      const record = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const prevAnswers = reverseMapBTCConfirmation(record.data);
      const ids = new Set<string>();
      for (const [qid, answer] of Object.entries(prevAnswers)) {
        setAnswer(qid, answer);
        ids.add(qid);
      }
      if (ids.size > 0) setPreviousRunQuestionIds(ids);
    };
    loadPrevious();
  }, [currentCustomerId, selectedBaselineId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load SI baseline and CUI boundary data
  useEffect(() => {
    async function loadData() {
      if (!selectedBaselineId || !selectedCUIBoundaryId) {
        setLoadingData(false);
        return;
      }

      try {
        const baselineTuple = currentCustomerId
          ? makeCesTuple(currentCustomerId, selectedBaselineId)
          : undefined;
        const baseline = await dbHelpers.getBaselineById(selectedBaselineId, baselineTuple);
        const cuiBoundary = await dbHelpers.getCUIBoundaryById(selectedCUIBoundaryId, baselineTuple);

        if (baseline?.data) {
          setSiBaseline(baseline.data);
          // Extract SI outputs for activation rules
          const si = baseline.data.si_baseline;
          setSiOutputs({
            isolation_philosophy: si?.scope?.boundary_strategy || '',
            external_collaboration_posture:
              si?.operations?.collaboration_mode === 'teams_first'
                ? 'Controlled external sharing'
                : si?.operations?.collaboration_mode === 'email_first'
                  ? 'Controlled external sharing'
                  : 'No external sharing',
            third_party_tolerance: si?.scope?.external_service_providers?.length
              ? 'MSP allowed (controlled)'
              : 'No third parties',
            automation_ambition: 'Baseline automation',
          });
        }

        if (cuiBoundary?.data) {
          setCuiBoundaryData(cuiBoundary.data);
          setCuiOutputs(cuiBoundary.data.cui_boundary as Record<string, unknown>);
        }
      } catch (err) {
        console.error('Failed to load BTC input data:', err);
      } finally {
        setLoadingData(false);
      }
    }

    loadData();
  }, [selectedBaselineId, selectedCUIBoundaryId, currentCustomerId]);

  const runlist = useRunlistBuilder(siOutputs, cuiOutputs, sections, virtualQuestions, rules);

  // Store runlist when it changes and seed default evidence
  useEffect(() => {
    if (runlist) {
      setRunlist(runlist);
      // Seed default evidence for questions that require it (idempotent — skips if evidence exists)
      const store = useBTCStore.getState();
      const newEvidence = seedDefaultEvidence(runlist.entries, store.evidenceItems);
      for (const ev of newEvidence) {
        store.addEvidence(ev);
      }
    }
  }, [runlist, setRunlist]);

  // Pre-populate answers from SI/CUI derivation
  useEffect(() => {
    if (!siBaseline || !runlist || runlist.entries.length === 0) return;
    const { defaults, sourceLabels } = deriveBTCDefaults(
      siBaseline,
      cuiBoundaryData,
      runlist.entries,
    );

    // Build prompt lookup from runlist
    const promptMap = new Map<string, string>();
    for (const entry of runlist.entries) {
      promptMap.set(entry.question_id, entry.question.prompt);
    }

    // Only set answers that don't already have user-entered values
    const currentAnswers = useBTCStore.getState().answers;
    const applied: DerivationEntry[] = [];
    for (const [questionId, answer] of Object.entries(defaults)) {
      if (
        !currentAnswers[questionId] ||
        currentAnswers[questionId].provenance_class === 'system_recommendation' ||
        currentAnswers[questionId].provenance_class === 'previous_run'
      ) {
        setAnswer(questionId, answer);
        applied.push({
          questionId,
          questionPrompt: promptMap.get(questionId) || questionId,
          derivedValue: String(answer.raw_answer),
          source: sourceLabels[questionId] || 'SI/CUI data',
        });
      }
    }
    if (applied.length > 0) setDerivationEntries(applied);
  }, [siBaseline, cuiBoundaryData, runlist]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply recommended defaults for questions without any answer
  useEffect(() => {
    if (!runlist || runlist.entries.length === 0) return;
    const questions = runlist.entries.map((e) => e.question);
    const currentAnswers = useBTCStore.getState().answers;
    const recs = buildRecommendations(questions, currentAnswers);
    if (Object.keys(recs).length === 0) return;
    for (const [qid, rec] of Object.entries(recs)) {
      const entry = runlist.entries.find((e) => e.question_id === qid);
      if (!entry) continue;
      const btcAnswer: BTCAnswer = {
        question_id: qid,
        raw_answer: rec.raw_answer as string | boolean,
        mode: entry.mode,
        evidence_ids: [],
        captured_at: rec.captured_at,
        provenance_class: 'system_recommendation',
      };
      setAnswer(qid, btcAnswer);
    }
  }, [runlist, siBaseline, cuiBoundaryData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute derived and skippable question sets
  const derivedQuestionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [qid, answer] of Object.entries(answers)) {
      if (answer.provenance_class === 'operator_inference') {
        ids.add(qid);
      }
    }
    return ids;
  }, [answers]);

  const skippableQuestionIds = useMemo(() => {
    if (!siBaseline || !runlist) return new Set<string>();
    const { skippableIds } = deriveBTCDefaults(siBaseline, cuiBoundaryData, runlist.entries);
    // Only skip questions that are still derived (not overridden by user)
    const active = new Set<string>();
    for (const id of skippableIds) {
      if (derivedQuestionIds.has(id)) active.add(id);
    }
    return active;
  }, [siBaseline, cuiBoundaryData, runlist, derivedQuestionIds]);

  const isEntrySkipped = useCallback(
    (index: number) => {
      if (!runlist) return false;
      return skippableQuestionIds.has(runlist.entries[index]?.question_id);
    },
    [runlist, skippableQuestionIds],
  );

  // Auto-position to first non-skipped entry on initial load
  useEffect(() => {
    if (!runlist || skippableQuestionIds.size === 0) return;
    if (currentRunlistIndex === 0 && isEntrySkipped(0)) {
      const next = findNextUnskipped(-1, runlist.entries.length, isEntrySkipped, 'forward');
      if (next !== null) setCurrentRunlistIndex(next);
    }
  }, [runlist, skippableQuestionIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = bankLoading || rulesLoading || loadingData;
  const error = bankError || rulesError;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading BTC Question Bank & Activation Rules...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-red-600">
          <p className="text-xl font-semibold mb-2">Error Loading BTC Data</p>
          <p>{error?.message ?? String(error)}</p>
        </div>
      </div>
    );
  }

  if (!currentCustomerId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No Customer Selected</p>
          <p>Please select a customer before starting the BTC workflow.</p>
        </div>
      </div>
    );
  }

  if (!selectedCUIBoundaryId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No CUI Boundary Selected</p>
          <p>Please complete a CUI Boundary Definition before starting BTC verification.</p>
        </div>
      </div>
    );
  }

  if (!runlist || runlist.entries.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No Questions Available</p>
          <p>The BTC runlist is empty. This may indicate a data loading issue.</p>
        </div>
      </div>
    );
  }

  if (showReview && confirmation) {
    return (
      <BTCReview
        confirmation={confirmation}
        customerId={currentCustomerId}
        onBack={() => setShowReview(false)}
      />
    );
  }

  const currentEntry = runlist.entries[currentRunlistIndex];

  const handleAutofill = () => {
    const allAnswers = autofillBTCAnswers(runlist.entries, answers);
    for (const [questionId, answer] of Object.entries(allAnswers)) {
      setAnswer(questionId, answer);
    }
    const output = generateBTCConfirmation(
      allAnswers,
      evidenceItems,
      runlist,
      bankVersion,
      packageVersion
    );
    setConfirmation(output);
    setShowReview(true);
  };

  const handleNewTenant = () => {
    const allAnswers = newTenantBTCAnswers(runlist.entries);
    for (const [questionId, answer] of Object.entries(allAnswers)) {
      setAnswer(questionId, answer);
    }
    const output = generateBTCConfirmation(
      allAnswers,
      evidenceItems,
      runlist,
      bankVersion,
      packageVersion,
    );
    setConfirmation(output);
    setShowReview(true);
  };

  const handleAnswer = (answer: BTCAnswer) => {
    setAnswer(answer.question_id, answer);
  };

  const handleNext = () => {
    const next = findNextUnskipped(
      currentRunlistIndex,
      runlist.entries.length,
      isEntrySkipped,
      'forward',
    );
    if (next !== null) {
      setCurrentRunlistIndex(next);
    } else {
      // All remaining are skipped — generate confirmation for review
      const output = generateBTCConfirmation(
        answers,
        evidenceItems,
        runlist,
        bankVersion,
        packageVersion,
      );
      setConfirmation(output);
      setShowReview(true);
    }
  };

  const handleBack = () => {
    const prev = findNextUnskipped(
      currentRunlistIndex,
      runlist.entries.length,
      isEntrySkipped,
      'backward',
    );
    if (prev !== null) setCurrentRunlistIndex(prev);
  };

  const handleEntryClick = (index: number) => {
    setCurrentRunlistIndex(index);
  };

  const handleCancel = () => {
    useBTCStore.getState().reset();
    navigate('/dashboard');
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 max-w-5xl mx-auto relative">
      <div className="fixed top-4 right-4 z-50">
        <AutofillButton onAutofill={handleAutofill} />
      </div>
      <RunlistSidebar
        entries={runlist.entries}
        currentIndex={currentRunlistIndex}
        answers={answers}
        evidenceItems={evidenceItems}
        onEntryClick={handleEntryClick}
        derivedQuestionIds={derivedQuestionIds}
        skippableQuestionIds={skippableQuestionIds}
      />
      <div className="flex-1">
        <DerivationSummary entries={derivationEntries} sourceLabel="SI Baseline & CUI Boundary" />
        <div className="mb-4">
          <button
            onClick={handleNewTenant}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            New Tenant — Fill Defaults
          </button>
        </div>
        <BTCQuestionPage
          entry={currentEntry}
          existingAnswer={answers[currentEntry.question_id]}
          evidenceForQuestion={evidenceItems.filter(
            (e) => e.question_id === currentEntry.question_id
          )}
          onAnswer={handleAnswer}
          onNext={handleNext}
          onBack={handleBack}
          onCancel={handleCancel}
          isFirst={
            findNextUnskipped(currentRunlistIndex, runlist.entries.length, isEntrySkipped, 'backward') === null
          }
          isLast={
            findNextUnskipped(currentRunlistIndex, runlist.entries.length, isEntrySkipped, 'forward') === null
          }
          isDerived={derivedQuestionIds.has(currentEntry.question_id)}
          isRecommended={answers[currentEntry.question_id]?.provenance_class === 'system_recommendation'}
          isPreviousRun={previousRunQuestionIds.has(currentEntry.question_id) && answers[currentEntry.question_id]?.provenance_class === 'previous_run'}
          progress={{
            current: currentRunlistIndex + 1,
            total: runlist.entries.length,
          }}
        />
      </div>
    </div>
  );
}
