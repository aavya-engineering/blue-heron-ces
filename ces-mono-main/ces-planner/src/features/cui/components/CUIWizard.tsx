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
import { useCUIStore } from '../stores/cuiStore';
import { useCUIQuestions } from '../hooks/useCUIQuestions';
import { CUISectionPage } from './CUISectionPage';
import { CUIReview } from './CUIReview';
import { SectionProgress } from './SectionProgress';
import { generateCUIBoundary } from '../services/cuiBoundaryGenerator';
import { autofillCUIAnswers } from '../services/autofillService';
import { deriveCUIDefaults, deriveCUITechnicalControls } from '../services/cuiSIDerivation';
import { reverseMapCUIBoundary } from '../services/cuiAnswerHydrator';
import { findNextUnskipped } from '@/shared/utils/wizardNavigation';
import { AutofillButton } from '@/features/rrt/components/AutofillButton';
import { useAppStore } from '@/shared/stores/appStore';
import { dbHelpers } from '@/shared/db/schema';
import { makeCesTuple } from '@/shared/identity/cesTuple';
import { DerivationSummary } from '@/shared/components/Display/DerivationSummary';
import type { DerivationEntry } from '@/shared/components/Display/DerivationSummary';
import { buildRecommendations } from '@/shared/utils/applyRecommendations';
import type { CUIAnswer } from '../types';
import type { CUIBoundaryOutput, SIBaseline } from '@/shared/types/artifacts';

export function CUIWizard() {
  const navigate = useNavigate();
  const { sections, allQuestions, bankVersion, loading, error } = useCUIQuestions();
  const {
    currentSectionIndex,
    currentQuestionIndex,
    answers,
    sectionCompletionMap,
    setCurrentSectionIndex,
    setCurrentQuestionIndex,
    setAnswer,
    setSectionComplete,
  } = useCUIStore();
  const { currentCustomerId, selectedBaselineId } = useAppStore();
  const [showReview, setShowReview] = useState(false);
  const [boundary, setBoundary] = useState<CUIBoundaryOutput | null>(null);
  const [siBaseline, setSiBaseline] = useState<SIBaseline | null>(null);
  const [skipCUI, setSkipCUI] = useState(false);
  const [fciOnly, setFciOnly] = useState(false);
  const [derivationEntries, setDerivationEntries] = useState<DerivationEntry[]>([]);
  const [previousRunQuestionIds, setPreviousRunQuestionIds] = useState<Set<string>>(new Set());

  // Load previous CUI Boundary answers as defaults when store is empty
  useEffect(() => {
    if (sections.length === 0) return;
    if (Object.keys(useCUIStore.getState().answers).length > 0) return;
    if (!currentCustomerId || !selectedBaselineId) return;
    const loadPrevious = async () => {
      const all = await dbHelpers.getCUIBoundariesByCustomerAndBaseline(
        currentCustomerId,
        selectedBaselineId,
      );
      if (all.length === 0) return;
      const record = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const prevAnswers = reverseMapCUIBoundary(record.data, sections);
      const ids = new Set<string>();
      for (const [qid, answer] of Object.entries(prevAnswers)) {
        setAnswer(qid, answer);
        ids.add(qid);
      }
      if (ids.size > 0) setPreviousRunQuestionIds(ids);
    };
    loadPrevious();
  }, [sections, currentCustomerId, selectedBaselineId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Pre-populate empty answers from SI Baseline derivation
  useEffect(() => {
    if (!siBaseline || sections.length === 0) return;
    const { defaults, sourceLabels, skipCUI: skip, fciOnly: fci } = deriveCUIDefaults(
      siBaseline,
      sections,
    );
    setSkipCUI(skip);
    setFciOnly(fci);

    // Build prompt lookup
    const promptMap = new Map<string, string>();
    for (const section of sections) {
      for (const q of section.questions) {
        promptMap.set(q.id, q.prompt);
      }
    }

    // Only set answers that don't already have user-entered values
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
    const currentAnswers = useCUIStore.getState().answers;
    const recs = buildRecommendations(allQs, currentAnswers);
    if (Object.keys(recs).length === 0) return;
    for (const [qid, rec] of Object.entries(recs)) {
      setAnswer(qid, rec as CUIAnswer);
    }
  }, [sections, siBaseline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-derive CUI.OOS.002 when upstream peer answers change
  const upstreamKey = useMemo(
    () =>
      JSON.stringify([
        answers['CUI.DEV.001']?.raw_answer,
        answers['CUI.LC.EGR.001']?.raw_answer,
        answers['CUI.INT.002']?.raw_answer,
        answers['CUI.ID.001']?.raw_answer,
        answers['CUI.LC.STO.001']?.raw_answer,
        answers['CUI.ENF.001']?.raw_answer,
      ]),
    [answers],
  );

  useEffect(() => {
    const existing = answers['CUI.OOS.002'];
    if (existing && existing.provenance_class !== 'operator_inference') return;

    const text = deriveCUITechnicalControls(answers);
    if (!text) return;
    // Avoid no-op updates
    if (existing?.raw_answer === text) return;

    setAnswer('CUI.OOS.002', {
      question_id: 'CUI.OOS.002',
      answer_type: 'text',
      raw_answer: text,
      captured_at: new Date().toISOString(),
      provenance_class: 'operator_inference',
    });
  }, [upstreamKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute set of derived question IDs (provenance_class === 'operator_inference')
  const derivedQuestionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [qid, answer] of Object.entries(answers)) {
      if (answer.provenance_class === 'operator_inference') {
        ids.add(qid);
      }
    }
    return ids;
  }, [answers]);

  // Build flat question list for global index mapping
  const flatQuestions = useMemo(() => {
    const flat: { questionId: string; sectionIndex: number; questionIndex: number }[] = [];
    for (let si = 0; si < sections.length; si++) {
      for (let qi = 0; qi < sections[si].questions.length; qi++) {
        flat.push({ questionId: sections[si].questions[qi].id, sectionIndex: si, questionIndex: qi });
      }
    }
    return flat;
  }, [sections]);

  const currentGlobalIndex = useMemo(() => {
    return flatQuestions.findIndex(
      (fq) => fq.sectionIndex === currentSectionIndex && fq.questionIndex === currentQuestionIndex
    );
  }, [flatQuestions, currentSectionIndex, currentQuestionIndex]);

  const isQuestionSkipped = useCallback(
    (globalIndex: number) => derivedQuestionIds.has(flatQuestions[globalIndex]?.questionId),
    [derivedQuestionIds, flatQuestions]
  );

  // Auto-position to first non-derived question on initial load
  useEffect(() => {
    if (flatQuestions.length === 0 || derivedQuestionIds.size === 0) return;
    // Only reposition if current question is derived and we haven't moved yet
    if (currentSectionIndex === 0 && currentQuestionIndex === 0 && isQuestionSkipped(0)) {
      const next = findNextUnskipped(
        -1, // start before first
        flatQuestions.length,
        isQuestionSkipped,
        'forward'
      );
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
    [answers]
  );

  const allSectionsComplete = useMemo(
    () => sections.every((s) => isSectionComplete(s.id, s.questions)),
    [sections, isSectionComplete]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading CUI Boundary Questions...</p>
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
          <p>The CUI Question Bank is empty or failed to load.</p>
        </div>
      </div>
    );
  }

  if (!currentCustomerId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No Customer Selected</p>
          <p>Please select a customer before starting the CUI workflow.</p>
        </div>
      </div>
    );
  }

  if (skipCUI) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-lg text-center space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">
              SI Baseline indicates no CUI
            </h2>
            <p className="text-sm text-blue-800">
              The Strategic Intent Baseline indicates <strong>no CUI presence</strong>.
              CUI Boundary definition may not be needed for this engagement.
            </p>
            {fciOnly && (
              <p className="text-sm text-blue-700 mt-2">
                Only FCI (Federal Contract Information) was identified.
              </p>
            )}
          </div>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Skip CUI Boundary
            </button>
            <button
              onClick={() => setSkipCUI(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Continue Anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showReview && boundary) {
    return (
      <CUIReview
        boundary={boundary}
        bankVersion={bankVersion}
        customerId={currentCustomerId}
        onBack={() => setShowReview(false)}
      />
    );
  }

  const handleAutofill = () => {
    const allAnswers = autofillCUIAnswers(sections, siBaseline);
    for (const [questionId, answer] of Object.entries(allAnswers)) {
      setAnswer(questionId, answer);
    }
    const output = generateCUIBoundary(allAnswers, sections, bankVersion);
    setBoundary(output);
    setShowReview(true);
  };

  const handleAnswer = (answer: CUIAnswer) => {
    setAnswer(answer.question_id, answer);
  };

  const handleNextQuestion = () => {
    if (!currentSection) return;

    const next = findNextUnskipped(currentGlobalIndex, flatQuestions.length, isQuestionSkipped, 'forward');
    if (next !== null) {
      const { sectionIndex, questionIndex } = flatQuestions[next];
      // Mark current section complete if leaving it
      if (sectionIndex !== currentSectionIndex) {
        const sectionComplete = isSectionComplete(currentSection.id, currentSection.questions);
        setSectionComplete(currentSection.id, sectionComplete);
      }
      setCurrentSectionIndex(sectionIndex);
      setCurrentQuestionIndex(questionIndex);
    } else {
      // All remaining questions are derived — generate for review
      const sectionComplete = isSectionComplete(currentSection.id, currentSection.questions);
      setSectionComplete(currentSection.id, sectionComplete);
      const output = generateCUIBoundary(answers, sections, bankVersion);
      setBoundary(output);
      setShowReview(true);
    }
  };

  const handleBackWithSave = (answer: CUIAnswer) => {
    setAnswer(answer.question_id, answer);
  };

  const handleBackQuestion = () => {
    const prev = findNextUnskipped(currentGlobalIndex, flatQuestions.length, isQuestionSkipped, 'backward');
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
    useCUIStore.getState().reset();
    navigate('/dashboard');
  };

  // Compute global progress
  const answeredCount = allQuestions.filter((q) => answers[q.id]).length;

  const isFirstQuestion =
    findNextUnskipped(currentGlobalIndex, flatQuestions.length, isQuestionSkipped, 'backward') === null;
  const isLastQuestion =
    findNextUnskipped(currentGlobalIndex, flatQuestions.length, isQuestionSkipped, 'forward') === null;

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 max-w-5xl mx-auto relative">
      <div className="fixed top-4 right-4 z-50">
        <AutofillButton onAutofill={handleAutofill} />
      </div>
      <SectionProgress
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
        <CUISectionPage
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
