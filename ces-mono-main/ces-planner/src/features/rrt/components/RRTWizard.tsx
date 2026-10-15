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
import { useRRTStore } from '../stores/rrtStore';
import { useRRTQuestions } from '../hooks/useRRTQuestions';
import { RRQuestionPage } from './RRQuestionPage';
import { PostureReview } from './PostureReview';
import { AutofillButton } from './AutofillButton';
import { RRTPreamble } from './RRTPreamble';
import { BulkReviewTable } from './BulkReviewTable';
import { generateReadinessPosture } from '../services/postureGenerator';
import { deriveActionStatuses, convertToRRTAnswers } from '../services/bulkAnswerDerivation';
import { adaptBTCEvidence } from '../services/btcEvidenceAdapter';
import { buildTechRefIndex, type TechRefIndex } from '@/shared/services/techRefIndex';
import { autofillRRTAnswers, generateMockEvidence } from '../services/autofillService';
import { useAppStore } from '@/shared/stores/appStore';
import type { BTCConfirmationOutput } from '@/shared/types/artifacts';
const { setSelectedPostureId } = useAppStore.getState();
import { dbHelpers } from '@/shared/db/schema';
import { makeCesTuple } from '@/shared/identity/cesTuple';
import { dataLoader } from '@/shared/services/dataLoader';
import { generateArtifactId } from '@/shared/utils/idGenerator';
import { persistReadinessPosture } from '@/shared/services/artifactPersistence';
import { validateReadinessPosture } from '@/shared/validation/validators';
import { RequirementDetailsPanel } from './RequirementDetailsModal';
import type { RRTAnswer, RRQuestion, PreambleAnswers } from '../types';

export function RRTWizard() {
  const navigate = useNavigate();
  const { questionSet, activities, loading, error } = useRRTQuestions();
  const {
    currentStep,
    answers,
    setAnswer,
    setCurrentStep,
    setQuestionSet,
    wizardPhase,
    setWizardPhase,
    actionStatuses,
    setPreambleAnswers,
    setActionStatuses,
    updateActionStatus,
    setBulkAnswers,
  } = useRRTStore();
  const { currentCustomerId, selectedBaselineId, selectedBTCConfirmationId } = useAppStore();
  const [showReview, setShowReview] = useState(false);
  const [posture, setPosture] = useState<any>(null);
  const [siBaseline, setSiBaseline] = useState<any>(null);
  const [btcConfirmation, setBtcConfirmation] = useState<BTCConfirmationOutput | null>(null);
  const [baselineId, setBaselineId] = useState<number | null>(null);
  const [questionSetId, setQuestionSetId] = useState<number | null>(null);
  const [siBaselineArtifactId, setSiBaselineArtifactId] = useState<string | undefined>(undefined);
  const [questionSetArtifactId, setQuestionSetArtifactId] = useState<string | undefined>(
    undefined
  );
  const [cesId, setCesId] = useState<string | undefined>(undefined);
  const [derivationLoading, setDerivationLoading] = useState(false);
  const [techRefIndex, setTechRefIndex] = useState<TechRefIndex | null>(null);

  // Floating requirement detail panels — persist across question navigation
  const [openPanels, setOpenPanels] = useState<string[]>([]);
  const [focusOrder, setFocusOrder] = useState<string[]>([]);
  const BASE_Z = 100;

  const handleOpenRequirement = useCallback((reqId: string) => {
    setOpenPanels((prev) => (prev.includes(reqId) ? prev : [...prev, reqId]));
    setFocusOrder((prev) => [...prev.filter((id) => id !== reqId), reqId]);
  }, []);

  const handleClosePanel = useCallback((reqId: string) => {
    setOpenPanels((prev) => prev.filter((id) => id !== reqId));
    setFocusOrder((prev) => prev.filter((id) => id !== reqId));
  }, []);

  const handleFocusPanel = useCallback((reqId: string) => {
    setFocusOrder((prev) => [...prev.filter((id) => id !== reqId), reqId]);
  }, []);

  // Flatten all questions from activities
  const allQuestions = useMemo(() => {
    const questions: Array<{ question: RRQuestion; activityName: string }> = [];
    activities.forEach((activity) => {
      activity.questions?.forEach((q) => {
        questions.push({
          question: { ...q, source_activity_id: activity.activity_id },
          activityName: activity.activity_name,
        });
      });
    });
    return questions;
  }, [activities]);

  useEffect(() => {
    if (questionSet) {
      setQuestionSet(questionSet);
    }
  }, [questionSet, setQuestionSet]);

  useEffect(() => {
    const loadBaselineData = async () => {
      if (!currentCustomerId) return;

      const baseline = selectedBaselineId
        ? await dbHelpers.getBaselineById(
            selectedBaselineId,
            makeCesTuple(currentCustomerId, selectedBaselineId),
          )
        : await dbHelpers.getLatestBaselineByCustomer(currentCustomerId);
      if (baseline) {
        setSiBaseline(baseline.data);
        setBaselineId(baseline.id!);
        setSiBaselineArtifactId((baseline as any).artifactId);
        setCesId(baseline.cesId || baseline.data?.ces?.cesId);

        const qSet = await dbHelpers.getQuestionSetByBaseline(baseline.id!);
        if (qSet) {
          setQuestionSetId(qSet.id!);
          setQuestionSetArtifactId((qSet as any).artifactId);
        }
      }
    };

    loadBaselineData();
  }, [currentCustomerId, selectedBaselineId]);

  // Load BTC Confirmation from IndexedDB
  useEffect(() => {
    const loadBTC = async () => {
      if (!selectedBTCConfirmationId) {
        setBtcConfirmation(null);
        return;
      }
      const tuple =
        currentCustomerId && selectedBaselineId
          ? makeCesTuple(currentCustomerId, selectedBaselineId)
          : undefined;
      const btc = await dbHelpers.getBTCById(selectedBTCConfirmationId, tuple);
      if (btc) setBtcConfirmation(btc.data);
    };
    loadBTC();
  }, [selectedBTCConfirmationId, currentCustomerId, selectedBaselineId]);

  // Convert BTC evidence and add to RRT evidence items (idempotent)
  const btcAdaptedEvidence = useMemo(() => {
    if (!btcConfirmation?.btc_confirmation?.evidence_refs) return [];
    return adaptBTCEvidence(btcConfirmation.btc_confirmation.evidence_refs);
  }, [btcConfirmation]);

  useEffect(() => {
    if (btcAdaptedEvidence.length === 0) return;
    const store = useRRTStore.getState();
    const existingIds = new Set(store.evidenceItems.map((e) => e.evidence_id));
    const newItems = btcAdaptedEvidence.filter((item) => !existingIds.has(item.evidence_id));
    if (newItems.length > 0) {
      useRRTStore.setState({
        evidenceItems: [...store.evidenceItems, ...newItems],
      });
    }
  }, [btcAdaptedEvidence]);

  // -----------------------------------------------------------------------
  // Phase handlers
  // -----------------------------------------------------------------------

  const handlePreambleComplete = async (preamble: PreambleAnswers) => {
    setPreambleAnswers(preamble);
    setDerivationLoading(true);

    try {
      const [patternsResult, playbookResult, techRefResult] = await Promise.all([
        dataLoader.loadImplementationPatterns(),
        dataLoader.loadVendorPlaybook(),
        dataLoader.loadTechRef(),
      ]);

      const index = buildTechRefIndex(techRefResult.data);
      setTechRefIndex(index);

      const derived = deriveActionStatuses(
        patternsResult.data,
        playbookResult.data,
        preamble,
        siBaseline,
        index,
        btcConfirmation?.btc_confirmation?.risk_flags
      );

      setActionStatuses(derived);
      setWizardPhase('review');
    } catch (err) {
      console.error('Failed to derive action statuses:', err);
    } finally {
      setDerivationLoading(false);
    }
  };

  const handleAcceptReview = () => {
    if (!questionSet || !siBaseline) {
      console.error('Missing required data for posture generation');
      return;
    }

    const syntheticAnswers = convertToRRTAnswers(actionStatuses);
    setBulkAnswers(syntheticAnswers);

    const generatedPosture = generateReadinessPosture(
      syntheticAnswers,
      [],
      questionSet,
      siBaseline,
      siBaselineArtifactId,
      questionSetArtifactId,
      btcAdaptedEvidence.length > 0 ? btcAdaptedEvidence : undefined,
      cesId,
    );
    setPosture(generatedPosture);
    setWizardPhase('posture_review');
  };

  const handleBackFromReview = () => {
    setWizardPhase('preamble');
  };

  // -----------------------------------------------------------------------
  // Dev-mode autofill (bypasses wizard entirely)
  // -----------------------------------------------------------------------

  const handleAutofill = async () => {
    if (!questionSet || !siBaseline || !baselineId || !questionSetId) return;

    // Load all domain data sources in parallel for context-aware answers
    const [assessorKBResult, cmmcReqResult, evidenceMatrixResult, techStackResult] =
      await Promise.allSettled([
        dataLoader.loadAssessorKB(),
        dataLoader.loadCMMCRequirements(),
        dataLoader.loadEvidenceMatrix(),
        dataLoader.loadTechStackMapping(),
      ]);

    const assessorKB =
      assessorKBResult.status === 'fulfilled' ? assessorKBResult.value.data : null;
    const cmmcRequirements =
      cmmcReqResult.status === 'fulfilled' ? cmmcReqResult.value.data : null;
    const evidenceMatrix =
      evidenceMatrixResult.status === 'fulfilled' ? evidenceMatrixResult.value.data : null;
    const techStackMapping =
      techStackResult.status === 'fulfilled' ? techStackResult.value.data : null;

    const domainContext = { assessorKB, cmmcRequirements, evidenceMatrix, techStackMapping };

    // Generate answers using domain data
    const autoAnswers = autofillRRTAnswers(questionSet, siBaseline, domainContext);
    const mockEvidence = generateMockEvidence(autoAnswers, questionSet, domainContext);

    // Generate posture from answers
    const generatedPosture = generateReadinessPosture(
      autoAnswers,
      mockEvidence,
      questionSet,
      siBaseline,
      siBaselineArtifactId,
      questionSetArtifactId,
      btcAdaptedEvidence.length > 0 ? btcAdaptedEvidence : undefined,
      cesId,
    );

    // Validate (non-blocking)
    const validation = validateReadinessPosture(generatedPosture);
    if (!validation.valid) {
      console.warn('Schema validation warnings for auto-generated posture:', validation.errors);
    }

    // Save to database
    const artifactId = generateArtifactId('readiness_posture');
    const newPostureId = await dbHelpers.createReadinessPosture({
      customerId: currentCustomerId!,
      questionSetId,
      baselineId,
      artifactId,
      cesId,
      data: generatedPosture,
      createdAt: new Date().toISOString(),
    });

    // Persist to local disk
    await persistReadinessPosture(generatedPosture, currentCustomerId!, artifactId);

    // Update app store with the new posture ID
    setSelectedPostureId(newPostureId);

    // Navigate to dashboard as if session completed
    navigate('/dashboard');
  };

  // -----------------------------------------------------------------------
  // Loading / error / empty states (unchanged)
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading RR Question Set...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-red-600">
          <p className="text-xl font-semibold mb-2">Error Loading Questions</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (allQuestions.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-gray-600">
          <p className="text-xl font-semibold mb-2">No Questions Available</p>
          <p>The RR Question Set is empty or failed to load.</p>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Derivation loading spinner
  // -----------------------------------------------------------------------

  if (derivationLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Deriving action statuses from preamble...</p>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Phase-based rendering
  // -----------------------------------------------------------------------

  const handleCancel = () => {
    useRRTStore.getState().reset();
    navigate('/dashboard');
  };

  // Preamble phase
  if (wizardPhase === 'preamble') {
    return (
      <div>
        <div className="fixed top-20 right-4 z-10">
          <AutofillButton onAutofill={handleAutofill} />
        </div>
        <RRTPreamble
          siBaseline={siBaseline}
          onComplete={handlePreambleComplete}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  // Review phase
  if (wizardPhase === 'review') {
    return (
      <div>
        <div className="fixed top-20 right-4 z-10">
          <AutofillButton onAutofill={handleAutofill} />
        </div>
        <BulkReviewTable
          actionStatuses={actionStatuses}
          techRefIndex={techRefIndex}
          onUpdateStatus={updateActionStatus}
          onAcceptAll={handleAcceptReview}
          onBack={handleBackFromReview}
        />
      </div>
    );
  }

  // Posture review phase
  if (wizardPhase === 'posture_review' && posture && baselineId && questionSetId) {
    return (
      <PostureReview
        posture={posture}
        questionSetId={questionSetId}
        baselineId={baselineId}
        onBack={() => setWizardPhase('review')}
        allQuestions={allQuestions}
        answers={answers}
        onGoToQuestion={(questionIndex) => {
          setCurrentStep(questionIndex);
          setWizardPhase('deep_dive');
        }}
        cesId={cesId}
      />
    );
  }

  // Deep dive phase (existing question-by-question flow)
  const handleGoToQuestion = (questionIndex: number) => {
    setCurrentStep(questionIndex);
    setShowReview(false);
  };

  if (showReview && posture && baselineId && questionSetId) {
    return (
      <PostureReview
        posture={posture}
        questionSetId={questionSetId}
        baselineId={baselineId}
        onBack={() => setShowReview(false)}
        allQuestions={allQuestions}
        answers={answers}
        onGoToQuestion={handleGoToQuestion}
        cesId={cesId}
      />
    );
  }

  const currentQ = allQuestions[currentStep];
  const existingAnswer = answers[currentQ.question.question_id];

  const handleAnswer = (answer: RRTAnswer) => {
    setAnswer(currentQ.question.question_id, answer);
  };

  const handleNext = () => {
    if (currentStep === allQuestions.length - 1) {
      // Generate posture for review
      if (!questionSet || !siBaseline) {
        alert('Missing required data for posture generation');
        return;
      }

      const generatedPosture = generateReadinessPosture(
        answers,
        [],
        questionSet,
        siBaseline,
        siBaselineArtifactId,
        questionSetArtifactId,
        btcAdaptedEvidence.length > 0 ? btcAdaptedEvidence : undefined,
        cesId,
      );
      setPosture(generatedPosture);
      setShowReview(true);
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      // Back from first question returns to review table
      setWizardPhase('review');
    }
  };

  return (
    <div>
      <div className="fixed top-20 right-4 z-10">
        <AutofillButton onAutofill={handleAutofill} />
      </div>

      <RRQuestionPage
        question={currentQ.question}
        activityName={currentQ.activityName}
        existingAnswer={existingAnswer}
        onAnswer={handleAnswer}
        onNext={handleNext}
        onBack={handleBack}
        onCancel={handleCancel}
        isFirst={currentStep === 0}
        isLast={currentStep === allQuestions.length - 1}
        progress={{
          current: currentStep + 1,
          total: allQuestions.length,
        }}
        onOpenRequirement={handleOpenRequirement}
        onSeek={(index) => setCurrentStep(index)}
      />

      {/* Floating requirement detail panels */}
      {openPanels.map((reqId, idx) => (
        <RequirementDetailsPanel
          key={reqId}
          requirementId={reqId}
          index={idx}
          zIndex={BASE_Z + focusOrder.indexOf(reqId)}
          onClose={handleClosePanel}
          onFocus={handleFocusPanel}
        />
      ))}
    </div>
  );
}
