// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTCPStore } from '../stores/tcpStore';
import { useTCPQuestions } from '../hooks/useTCPQuestions';
import { TCPSectionPage } from './TCPSectionPage';
import { TCPReview } from './TCPReview';
import { TCPSectionProgress } from './TCPSectionProgress';
import { generateTenantConfigProfile } from '../services/tcpProfileGenerator';
import { autofillTCPAnswers } from '../services/autofillService';
import { deriveTCPDefaults } from '../services/tcpSIDerivation';
import { findNextUnskipped } from '@/shared/utils/wizardNavigation';
import { AutofillButton } from '@/features/rrt/components/AutofillButton';
import { useAppStore } from '@/shared/stores/appStore';
import { dbHelpers } from '@/shared/db/schema';
import { makeCesTuple } from '@/shared/identity/cesTuple';
import { DerivationSummary } from '@/shared/components/Display/DerivationSummary';
import type { DerivationEntry } from '@/shared/components/Display/DerivationSummary';
import { buildRecommendations } from '@/shared/utils/applyRecommendations';
import type { TCPAnswer } from '../types';
import { reverseMapProfile } from '../services/tcpAnswerHydrator';
import type { TenantConfigProfileOutput, SIBaseline } from '@/shared/types/artifacts';

export function TCPWizard() {
  const navigate = useNavigate();
  const { sections, allQuestions, bankVersion, loading, error } = useTCPQuestions();
  const {
    currentSectionIndex,
    currentQuestionIndex,
    answers,
    sectionCompletionMap,
    setCurrentSectionIndex,
    setCurrentQuestionIndex,
    setAnswer,
    setSectionComplete,
  } = useTCPStore();
  const { currentCustomerId, selectedBaselineId, selectedTenantConfigId } = useAppStore();
  const [showReview, setShowReview] = useState(false);
  const [profile, setProfile] = useState<TenantConfigProfileOutput | null>(null);
  const [siBaseline, setSiBaseline] = useState<SIBaseline | null>(null);
  const [derivationEntries, setDerivationEntries] = useState<DerivationEntry[]>([]);
  const [previousRunQuestionIds, setPreviousRunQuestionIds] = useState<Set<string>>(new Set());

  // Load SI Baseline from IndexedDB
  useEffect(() => {
    const loadBaseline = async () => {
      if (!currentCustomerId) return;
      const baseline = selectedBaselineId
        ? await dbHelpers.getBaselineById(
            selectedBaselineId,
            makeCesTuple(currentCustomerId, selectedBaselineId),
          )
        : await dbHelpers.getLatestBaselineByCustomer(currentCustomerId);
      if (baseline) setSiBaseline(baseline.data);
    };
    loadBaseline();
  }, [currentCustomerId, selectedBaselineId]);

  // Load previous TCP profile answers as defaults when store is empty
  useEffect(() => {
    if (sections.length === 0) return;
    if (Object.keys(useTCPStore.getState().answers).length > 0) return;
    if (!currentCustomerId || !selectedBaselineId) return;
    const loadPrevious = async () => {
      // If a specific profile is selected, use it; otherwise find the most recent
      let record;
      if (selectedTenantConfigId) {
        record = await dbHelpers.getTenantConfigById(
          selectedTenantConfigId,
          makeCesTuple(currentCustomerId, selectedBaselineId),
        );
      } else {
        const all = await dbHelpers.getTenantConfigsByCustomerAndBaseline(
          currentCustomerId,
          selectedBaselineId,
        );
        if (all.length > 0) {
          record = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        }
      }
      if (!record) return;
      const prevAnswers = reverseMapProfile(record.data, sections);
      const ids = new Set<string>();
      for (const [qid, answer] of Object.entries(prevAnswers)) {
        setAnswer(qid, answer);
        ids.add(qid);
      }
      if (ids.size > 0) setPreviousRunQuestionIds(ids);
    };
    loadPrevious();
  }, [sections, selectedTenantConfigId, currentCustomerId, selectedBaselineId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-populate empty answers from SI Baseline derivation
  useEffect(() => {
    if (!siBaseline || sections.length === 0) return;
    const { defaults, sourceLabels } = deriveTCPDefaults(siBaseline, sections);

    const promptMap = new Map<string, string>();
    for (const section of sections) {
      for (const q of section.questions) {
        promptMap.set(q.id, q.prompt);
      }
    }

    const applied: DerivationEntry[] = [];
    for (const [questionId, answer] of Object.entries(defaults)) {
      if (
        !answers[questionId] ||
        answers[questionId].provenance_class === 'system_recommendation' ||
        answers[questionId].provenance_class === 'previous_run'
      ) {
        setAnswer(questionId, answer);
        applied.push({
          questionId,
          questionPrompt: promptMap.get(questionId) || questionId,
          derivedValue: String(answer.raw_answer),
          source: sourceLabels[questionId] || 'SI Baseline',
        });
      }
    }
    if (applied.length > 0) setDerivationEntries(applied);
  }, [siBaseline, sections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply recommended defaults for questions without any answer
  useEffect(() => {
    if (sections.length === 0) return;
    const allQs = sections.flatMap((s) => s.questions);
    const currentAnswers = useTCPStore.getState().answers;
    const recs = buildRecommendations(allQs, currentAnswers);
    if (Object.keys(recs).length === 0) return;
    for (const [qid, rec] of Object.entries(recs)) {
      setAnswer(qid, rec as TCPAnswer);
    }
  }, [sections, siBaseline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived question IDs
  const derivedQuestionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [qid, answer] of Object.entries(answers)) {
      if (answer.provenance_class === 'operator_inference') {
        ids.add(qid);
      }
    }
    return ids;
  }, [answers]);

  // Flat question list
  const flatQuestions = useMemo(() => {
    const flat: { questionId: string; sectionIndex: number; questionIndex: number }[] = [];
    for (let si = 0; si < sections.length; si++) {
      for (let qi = 0; qi < sections[si].questions.length; qi++) {
        flat.push({
          questionId: sections[si].questions[qi].id,
          sectionIndex: si,
          questionIndex: qi,
        });
      }
    }
    return flat;
  }, [sections]);

  const currentGlobalIndex = useMemo(() => {
    return flatQuestions.findIndex(
      (fq) => fq.sectionIndex === currentSectionIndex && fq.questionIndex === currentQuestionIndex,
    );
  }, [flatQuestions, currentSectionIndex, currentQuestionIndex]);

  const isQuestionSkipped = useCallback(
    (globalIndex: number) => derivedQuestionIds.has(flatQuestions[globalIndex]?.questionId),
    [derivedQuestionIds, flatQuestions],
  );

  // Auto-position to first non-derived question on initial load
  useEffect(() => {
    if (flatQuestions.length === 0 || derivedQuestionIds.size === 0) return;
    if (currentSectionIndex === 0 && currentQuestionIndex === 0 && isQuestionSkipped(0)) {
      const next = findNextUnskipped(-1, flatQuestions.length, isQuestionSkipped, 'forward');
      if (next !== null) {
        setCurrentSectionIndex(flatQuestions[next].sectionIndex);
        setCurrentQuestionIndex(flatQuestions[next].questionIndex);
      }
    }
  }, [flatQuestions, derivedQuestionIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentSection = sections[currentSectionIndex];
  const currentQuestion = currentSection?.questions[currentQuestionIndex];

  const isSectionComplete = useCallback(
    (_sectionId: string, sectionQuestions: { id: string; required: boolean }[]) => {
      return sectionQuestions
        .filter((q) => q.required)
        .every((q) => {
          const a = answers[q.id];
          if (!a) return false;
          if (Array.isArray(a.raw_answer)) return a.raw_answer.length > 0;
          if (typeof a.raw_answer === 'string') return a.raw_answer.trim() !== '';
          return a.raw_answer !== undefined && a.raw_answer !== null;
        });
    },
    [answers],
  );

  const allSectionsComplete = useMemo(
    () => sections.every((s) => isSectionComplete(s.id, s.questions)),
    [sections, isSectionComplete],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading TCP Questions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-red-600">
          <p className="text-xl font-semibold mb-2">Error Loading Questions</p>
          <p>{error?.message ?? String(error)}</p>
        </div>
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No Questions Available</p>
          <p>The TCP Question Bank is empty or failed to load.</p>
        </div>
      </div>
    );
  }

  if (!currentCustomerId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No Customer Selected</p>
          <p>Please select a customer before starting the TCP workflow.</p>
        </div>
      </div>
    );
  }

  if (showReview && profile) {
    return (
      <TCPReview
        profile={profile}
        bankVersion={bankVersion}
        customerId={currentCustomerId}
        onBack={() => setShowReview(false)}
      />
    );
  }

  const handleAutofill = () => {
    const allAnswers = autofillTCPAnswers(sections, siBaseline);
    for (const [questionId, answer] of Object.entries(allAnswers)) {
      setAnswer(questionId, answer);
    }
    const output = generateTenantConfigProfile(allAnswers, sections, bankVersion);
    setProfile(output);
    setShowReview(true);
  };

  const handleAnswer = (answer: TCPAnswer) => {
    setAnswer(answer.question_id, answer);
  };

  const handleNextQuestion = () => {
    if (!currentSection) return;

    const next = findNextUnskipped(
      currentGlobalIndex,
      flatQuestions.length,
      isQuestionSkipped,
      'forward',
    );
    if (next !== null) {
      const { sectionIndex, questionIndex } = flatQuestions[next];
      if (sectionIndex !== currentSectionIndex) {
        const sectionComplete = isSectionComplete(currentSection.id, currentSection.questions);
        setSectionComplete(currentSection.id, sectionComplete);
      }
      setCurrentSectionIndex(sectionIndex);
      setCurrentQuestionIndex(questionIndex);
    } else {
      const sectionComplete = isSectionComplete(currentSection.id, currentSection.questions);
      setSectionComplete(currentSection.id, sectionComplete);
      const output = generateTenantConfigProfile(answers, sections, bankVersion);
      setProfile(output);
      setShowReview(true);
    }
  };

  const handleBackWithSave = (answer: TCPAnswer) => {
    setAnswer(answer.question_id, answer);
  };

  const handleBackQuestion = () => {
    const prev = findNextUnskipped(
      currentGlobalIndex,
      flatQuestions.length,
      isQuestionSkipped,
      'backward',
    );
    if (prev !== null) {
      setCurrentSectionIndex(flatQuestions[prev].sectionIndex);
      setCurrentQuestionIndex(flatQuestions[prev].questionIndex);
    }
  };

  const handleSectionClick = (sectionIndex: number) => {
    setCurrentSectionIndex(sectionIndex);
    setCurrentQuestionIndex(0);
  };

  const handleQuestionClick = (sectionIndex: number, questionIndex: number) => {
    setCurrentSectionIndex(sectionIndex);
    setCurrentQuestionIndex(questionIndex);
  };

  const handleCancel = () => {
    useTCPStore.getState().reset();
    navigate('/dashboard');
  };

  const answeredCount = allQuestions.filter((q) => answers[q.id]).length;

  const isFirstQuestion =
    findNextUnskipped(currentGlobalIndex, flatQuestions.length, isQuestionSkipped, 'backward') ===
    null;
  const isLastQuestion =
    findNextUnskipped(currentGlobalIndex, flatQuestions.length, isQuestionSkipped, 'forward') ===
    null;

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 max-w-5xl mx-auto relative">
      <div className="fixed top-4 right-4 z-50">
        <AutofillButton onAutofill={handleAutofill} />
      </div>
      <TCPSectionProgress
        sections={sections}
        currentSectionIndex={currentSectionIndex}
        currentQuestionIndex={currentQuestionIndex}
        answers={answers}
        sectionCompletionMap={sectionCompletionMap}
        onSectionClick={handleSectionClick}
        onQuestionClick={handleQuestionClick}
        derivedQuestionIds={derivedQuestionIds}
      />
      <div className="flex-1">
        <DerivationSummary entries={derivationEntries} sourceLabel="your SI Baseline" />
        <TCPSectionPage
          question={currentQuestion}
          existingAnswer={answers[currentQuestion?.id]}
          onAnswer={handleAnswer}
          onNext={handleNextQuestion}
          onBack={handleBackQuestion}
          onBeforeBack={handleBackWithSave}
          onCancel={handleCancel}
          isFirst={isFirstQuestion}
          isLast={isLastQuestion}
          sectionName={currentSection?.name}
          progress={{
            current: answeredCount,
            total: allQuestions.length,
            sectionCurrent: currentQuestionIndex + 1,
            sectionTotal: currentSection?.questions.length || 0,
          }}
          allSectionsComplete={allSectionsComplete}
          isDerived={derivedQuestionIds.has(currentQuestion?.id)}
          isRecommended={answers[currentQuestion?.id]?.provenance_class === 'system_recommendation'}
          isPreviousRun={previousRunQuestionIds.has(currentQuestion?.id) && answers[currentQuestion?.id]?.provenance_class === 'previous_run'}
        />
      </div>
    </div>
  );
}
