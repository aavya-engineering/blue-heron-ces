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
import { usePolicyStore } from '../stores/usePolicyStore';
import { usePolicyQuestions } from '../hooks/usePolicyQuestions';
import { PolicySectionPage } from './PolicySectionPage';
import { PolicyReview } from './PolicyReview';
import { PolicySectionProgress } from './PolicySectionProgress';
import { generatePolicyInputsOutput } from '../services/policyProfileGenerator';
import { buildRecommendations } from '@/shared/utils/applyRecommendations';
import { useAppStore } from '@/shared/stores/appStore';
import { dbHelpers } from '@/shared/db/schema';
import { reverseMapPolicyProfile } from '../services/policyAnswerHydrator';
import type { PolicyAnswer } from '../types';
import type { PolicyInputsOutput } from '../types';

export function PolicyInputsWizard() {
  const navigate = useNavigate();
  const { sections, allQuestions, bankVersion, loading, error } = usePolicyQuestions();
  const {
    currentSectionIndex,
    currentQuestionIndex,
    answers,
    sectionCompletionMap,
    setCurrentSectionIndex,
    setCurrentQuestionIndex,
    setAnswer,
    setSectionComplete,
  } = usePolicyStore();
  const { currentCustomerId } = useAppStore();
  const [showReview, setShowReview] = useState(false);
  const [output, setOutput] = useState<PolicyInputsOutput | null>(null);
  const [previousRunQuestionIds, setPreviousRunQuestionIds] = useState<Set<string>>(new Set());

  // Load previous Policy Inputs answers as defaults when store is empty
  useEffect(() => {
    if (sections.length === 0) return;
    if (Object.keys(usePolicyStore.getState().answers).length > 0) return;
    if (!currentCustomerId) return;
    const loadPrevious = async () => {
      const all = await dbHelpers.getPolicyInputsByCustomer(
        currentCustomerId,
      );
      if (all.length === 0) return;
      const record = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const prevAnswers = reverseMapPolicyProfile(record.data, sections);
      const ids = new Set<string>();
      for (const [qid, answer] of Object.entries(prevAnswers)) {
        setAnswer(qid, answer);
        ids.add(qid);
      }
      if (ids.size > 0) setPreviousRunQuestionIds(ids);
    };
    loadPrevious();
  }, [sections, currentCustomerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply recommended defaults for questions without any answer
  useEffect(() => {
    if (sections.length === 0) return;
    const allQs = sections.flatMap((s) => s.questions);
    const currentAnswers = usePolicyStore.getState().answers;
    const recs = buildRecommendations(allQs, currentAnswers);
    if (Object.keys(recs).length === 0) return;
    for (const [qid, rec] of Object.entries(recs)) {
      setAnswer(qid, rec as PolicyAnswer);
    }
  }, [sections]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Policy Inputs Questions...</p>
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
          <p>The Policy Inputs Question Bank is empty or failed to load.</p>
        </div>
      </div>
    );
  }

  if (!currentCustomerId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No Customer Selected</p>
          <p>Please select a customer before collecting Policy Inputs.</p>
        </div>
      </div>
    );
  }

  if (showReview && output) {
    return (
      <PolicyReview
        output={output}
        bankVersion={bankVersion}
        customerId={currentCustomerId}
        onBack={() => setShowReview(false)}
      />
    );
  }

  const handleAnswer = (answer: PolicyAnswer) => {
    setAnswer(answer.question_id, answer);
  };

  const handleNextQuestion = () => {
    if (!currentSection) return;

    const nextGlobal = currentGlobalIndex + 1;
    if (nextGlobal < flatQuestions.length) {
      const { sectionIndex, questionIndex } = flatQuestions[nextGlobal];
      if (sectionIndex !== currentSectionIndex) {
        const sectionComplete = isSectionComplete(currentSection.id, currentSection.questions);
        setSectionComplete(currentSection.id, sectionComplete);
      }
      setCurrentSectionIndex(sectionIndex);
      setCurrentQuestionIndex(questionIndex);
    } else {
      const sectionComplete = isSectionComplete(currentSection.id, currentSection.questions);
      setSectionComplete(currentSection.id, sectionComplete);
      const generated = generatePolicyInputsOutput(answers, sections, bankVersion);
      setOutput(generated);
      setShowReview(true);
    }
  };

  const handleBackQuestion = () => {
    const prevGlobal = currentGlobalIndex - 1;
    if (prevGlobal >= 0) {
      setCurrentSectionIndex(flatQuestions[prevGlobal].sectionIndex);
      setCurrentQuestionIndex(flatQuestions[prevGlobal].questionIndex);
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
    usePolicyStore.getState().reset();
    navigate('/dashboard');
  };

  const answeredCount = allQuestions.filter((q) => answers[q.id]).length;

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 max-w-5xl mx-auto">
      <PolicySectionProgress
        sections={sections}
        currentSectionIndex={currentSectionIndex}
        currentQuestionIndex={currentQuestionIndex}
        answers={answers}
        sectionCompletionMap={sectionCompletionMap}
        onSectionClick={handleSectionClick}
        onQuestionClick={handleQuestionClick}
      />
      <div className="flex-1">
        <PolicySectionPage
          question={currentQuestion}
          existingAnswer={answers[currentQuestion?.id]}
          onAnswer={handleAnswer}
          onNext={handleNextQuestion}
          onBack={handleBackQuestion}
          onCancel={handleCancel}
          isFirst={currentGlobalIndex === 0}
          isLast={currentGlobalIndex === flatQuestions.length - 1}
          sectionName={currentSection?.name}
          progress={{
            current: answeredCount,
            total: allQuestions.length,
            sectionCurrent: currentQuestionIndex + 1,
            sectionTotal: currentSection?.questions.length || 0,
          }}
          allSectionsComplete={allSectionsComplete}
          isRecommended={
            answers[currentQuestion?.id]?.provenance_class === 'system_recommendation'
          }
          isPreviousRun={previousRunQuestionIds.has(currentQuestion?.id) && answers[currentQuestion?.id]?.provenance_class === 'previous_run'}
        />
      </div>
    </div>
  );
}
