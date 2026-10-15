// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSITStore } from '../stores/sitStore';
import { useSITQuestions } from '../hooks/useSITQuestions';
import { QuestionPage } from './QuestionPage';
import { BaselineReview } from './BaselineReview';
import { generateSIBaseline } from '../services/baselineGenerator';
import { reverseMapBaseline } from '../services/sitAnswerHydrator';
import { buildRecommendations } from '@/shared/utils/applyRecommendations';
import { useAppStore } from '@/shared/stores/appStore';
import { dbHelpers } from '@/shared/db/schema';
import { makeCesTuple } from '@/shared/identity/cesTuple';
import type { SITAnswer } from '../types';

export function SITWizard() {
  const navigate = useNavigate();
  const { questions, questionBank, loading, error } = useSITQuestions();
  const { currentStep, answers, setAnswer, setCurrentStep, setQuestionBank } = useSITStore();
  const { currentCustomerId, selectedBaselineId } = useAppStore();
  const [showReview, setShowReview] = useState(false);
  const [baseline, setBaseline] = useState<any>(null);
  const [previousRunQuestionIds, setPreviousRunQuestionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (questionBank) {
      setQuestionBank(questionBank);
    }
  }, [questionBank, setQuestionBank]);

  // Load previous SI Baseline answers as defaults when store is empty
  useEffect(() => {
    if (questions.length === 0) return;
    if (Object.keys(useSITStore.getState().answers).length > 0) return;
    if (!currentCustomerId) return;
    const loadPrevious = async () => {
      let record;
      if (selectedBaselineId) {
        record = await dbHelpers.getBaselineById(
          selectedBaselineId,
          makeCesTuple(currentCustomerId, selectedBaselineId),
        );
      } else {
        const all = await dbHelpers.getBaselinesByCustomer(currentCustomerId);
        if (all.length > 0) {
          record = all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
        }
      }
      if (!record) return;
      const prevAnswers = reverseMapBaseline(record.data, questions);
      const ids = new Set<string>();
      for (const [qid, answer] of Object.entries(prevAnswers)) {
        setAnswer(qid, answer);
        ids.add(qid);
      }
      if (ids.size > 0) setPreviousRunQuestionIds(ids);
    };
    loadPrevious();
  }, [questions, currentCustomerId, selectedBaselineId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply recommended defaults for questions without any answer
  useEffect(() => {
    if (questions.length === 0) return;
    const currentAnswers = useSITStore.getState().answers;
    const mappedQs = questions.map((q) => ({ id: q.question_id, answer_type: q.answer_type, recommended: q.recommended }));
    const recs = buildRecommendations(mappedQs, currentAnswers);
    if (Object.keys(recs).length === 0) return;
    for (const [qid, rec] of Object.entries(recs)) {
      setAnswer(qid, rec as SITAnswer);
    }
  }, [questions]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading SI Question Bank...</p>
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

  if (questions.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No Questions Available</p>
          <p>The SI Question Bank is empty or failed to load.</p>
        </div>
      </div>
    );
  }

  if (!currentCustomerId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No Customer Selected</p>
          <p>Please select a customer before starting the SIT workflow.</p>
        </div>
      </div>
    );
  }

  if (showReview && baseline) {
    return (
      <BaselineReview
        baseline={baseline}
        customerId={currentCustomerId}
        onBack={() => setShowReview(false)}
      />
    );
  }

  const currentQuestion = questions[currentStep];
  const existingAnswer = answers[currentQuestion.question_id];

  const handleAnswer = (answer: SITAnswer) => {
    setAnswer(currentQuestion.question_id, answer);
  };

  const handleNext = () => {
    if (currentStep === questions.length - 1) {
      // Generate baseline for review
      const generatedBaseline = generateSIBaseline(answers, questionBank, currentCustomerId);
      setBaseline(generatedBaseline);
      setShowReview(true);
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBackWithSave = (answer: SITAnswer) => {
    setAnswer(currentQuestion.question_id, answer);
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCancel = () => {
    useSITStore.getState().reset();
    navigate('/dashboard');
  };

  return (
    <QuestionPage
      question={currentQuestion}
      existingAnswer={existingAnswer}
      onAnswer={handleAnswer}
      onNext={handleNext}
      onBack={handleBack}
      onBeforeBack={handleBackWithSave}
      onCancel={handleCancel}
      isFirst={currentStep === 0}
      isLast={currentStep === questions.length - 1}
      progress={{
        current: currentStep + 1,
        total: questions.length,
      }}
      isPreviousRun={previousRunQuestionIds.has(currentQuestion.question_id)}
      isRecommended={answers[currentQuestion?.question_id]?.provenance_class === 'system_recommendation'}
    />
  );
}
