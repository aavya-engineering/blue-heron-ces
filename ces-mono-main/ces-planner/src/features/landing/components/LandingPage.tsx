// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/shared/stores/appStore';
import { useCustomer, useCustomers, useCreateCustomer } from '@/features/customer/hooks/useCustomers';
import { useWorkflowState } from '../hooks/useWorkflowState';
import { CustomerForm } from '@/features/customer/components/CustomerForm';
import type { CustomerFormData } from '@/features/customer/types';
import { WorkflowProgress } from './WorkflowProgress';
import { ActionCard } from './ActionCard';
import { GeneratedArtifactsPanel } from './GeneratedArtifactsPanel';
import { Card } from '@/shared/components/Display/Card';
import { Badge } from '@/shared/components/Display/Badge';
import { Alert } from '@/shared/components/Display/Alert';
import { ArtifactViewerModal } from '@/shared/components/Display/ArtifactViewerModal';
import { LoeRateEditor } from '@/shared/components/LoeRateEditor';
import { db, dbHelpers } from '@/shared/db/schema';
import { makeCesTuple } from '@/shared/identity/cesTuple';
import {
  countControlQuestionSets,
  generateRRQuestionSet,
} from '@/features/sit/services/questionSetGenerator';
import { generateArtifactId } from '@/shared/utils/idGenerator';
import { exportJson } from '@/shared/utils/exportJson';
import { persistRRQuestionSet } from '@/shared/services/artifactPersistence';
import { useRRQuestionBank, useCMMCRequirements, useAssessorKB } from '@/shared/hooks/useDataLoader';
import { useRRTStore } from '@/features/rrt/stores/rrtStore';
import { useSITStore } from '@/features/sit/stores/sitStore';
import { useTCPStore } from '@/features/tcp/stores/tcpStore';
import { useCUIStore } from '@/features/cui/stores/cuiStore';
import { useBTCStore } from '@/features/btc/stores/btcStore';
import { usePolicyStore } from '@/features/policy/stores/usePolicyStore';
import { useConsistencyCheck } from '@/shared/hooks/useConsistencyCheck';
import {
  useMissionPlanGenerator,
  PLAN_MODE_OPTIONS,
} from '@/features/mpt/hooks/useMissionPlanGenerator';
import { PolicyDocumentsPanel } from '@/features/mpt/components/PolicyDocumentsPanel';
import type { PolicyDocument } from '@/shared/types/artifacts';
import type { PlanMode } from '@/features/mpt/types';

export function LandingPage() {
  const navigate = useNavigate();
  const {
    currentCustomerId,
    currentCesId,
    selectedBaselineId,
    setSelectedBaselineId,
    selectedTenantConfigId,
    setSelectedTenantConfigId,
    selectedCUIBoundaryId,
    setSelectedCUIBoundaryId,
    selectedBTCConfirmationId,
    setSelectedBTCConfirmationId,
    selectedQuestionSetId,
    setSelectedQuestionSetId,
    selectedPostureId,
    setSelectedPostureId,
    selectedPolicyInputsId,
    setSelectedPolicyInputsId,
    selectedMissionPlanId,
    setSelectedMissionPlanId,
  } = useAppStore();
  const { customer, loading: customerLoading } = useCustomer(currentCustomerId);
  const { customers } = useCustomers();
  const { createCustomer } = useCreateCustomer();
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const workflowState = useWorkflowState(
    currentCustomerId,
    selectedBaselineId,
    selectedTenantConfigId,
    selectedCUIBoundaryId,
    selectedBTCConfirmationId,
    selectedPolicyInputsId,
    selectedQuestionSetId,
    selectedPostureId,
    selectedMissionPlanId,
  );
  const { data: rrQuestionBank } = useRRQuestionBank();
  const { data: cmmcRequirements } = useCMMCRequirements();
  const { data: assessorKB } = useAssessorKB();
  const rrtAnswers = useRRTStore((s) => s.answers);
  const rrtIsComplete = useRRTStore((s) => s.isComplete);
  const rrtInProgress = Object.keys(rrtAnswers).length > 0 && !rrtIsComplete;
  const [baselines, setBaselines] = useState<any[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [viewerData, setViewerData] = useState<{ title: string; data: any } | null>(null);
  const [showLoeEditor, setShowLoeEditor] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [policyDocs, setPolicyDocs] = useState<PolicyDocument[]>([]);

  const {
    generate: generateMissionPlan,
    loading: mptLoading,
    error: mptError,
    statusText: mptStatusText,
    planMode,
    setPlanMode,
  } = useMissionPlanGenerator();

  const { issues: consistencyIssues } = useConsistencyCheck(
    selectedBaselineId,
    selectedCUIBoundaryId,
    selectedBTCConfirmationId,
    selectedPostureId,
  );

  const loadBaselines = useCallback(async () => {
    if (!currentCustomerId) return;
    const storedBaselines = await dbHelpers.getBaselinesByCustomer(currentCustomerId);
    const sorted = [...storedBaselines].sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    setBaselines(sorted);
    if (!selectedBaselineId && sorted.length > 0) {
      const firstWithId = sorted.find(
        (baseline) => baseline.id !== undefined && baseline.id !== null
      );
      setSelectedBaselineId(firstWithId?.id ?? null);
      // Set cesId from the first baseline
      const cesId = firstWithId?.cesId || firstWithId?.data?.ces?.cesId || null;
      useAppStore.getState().setCurrentCesId(cesId);
    }
  }, [currentCustomerId, selectedBaselineId, setSelectedBaselineId]);

  useEffect(() => {
    loadBaselines();
  }, [loadBaselines]);

  // Auto-select first tenant config when none is selected
  useEffect(() => {
    if (!selectedTenantConfigId && workflowState.availableTenantConfigs.length > 0) {
      const first = workflowState.availableTenantConfigs.find(
        (tc) => tc.id !== undefined && tc.id !== null,
      );
      if (first?.id != null) setSelectedTenantConfigId(first.id);
    }
  }, [selectedTenantConfigId, workflowState.availableTenantConfigs, setSelectedTenantConfigId]);

  // Auto-select first CUI boundary when none is selected
  useEffect(() => {
    if (!selectedCUIBoundaryId && workflowState.availableCUIBoundaries.length > 0) {
      const first = workflowState.availableCUIBoundaries.find(
        (cb) => cb.id !== undefined && cb.id !== null
      );
      if (first?.id != null) setSelectedCUIBoundaryId(first.id);
    }
  }, [selectedCUIBoundaryId, workflowState.availableCUIBoundaries, setSelectedCUIBoundaryId]);

  // Auto-select first BTC confirmation when none is selected
  useEffect(() => {
    if (!selectedBTCConfirmationId && workflowState.availableBTCConfirmations.length > 0) {
      const first = workflowState.availableBTCConfirmations.find(
        (btc) => btc.id !== undefined && btc.id !== null
      );
      if (first?.id != null) setSelectedBTCConfirmationId(first.id);
    }
  }, [selectedBTCConfirmationId, workflowState.availableBTCConfirmations, setSelectedBTCConfirmationId]);

  // Auto-select first policy inputs when none is selected
  useEffect(() => {
    if (!selectedPolicyInputsId && workflowState.availablePolicyInputs.length > 0) {
      const first = workflowState.availablePolicyInputs.find(
        (pi) => pi.id !== undefined && pi.id !== null,
      );
      if (first?.id != null) setSelectedPolicyInputsId(first.id);
    }
  }, [selectedPolicyInputsId, workflowState.availablePolicyInputs, setSelectedPolicyInputsId]);

  // Auto-select first question set when none is selected
  useEffect(() => {
    if (!selectedQuestionSetId && workflowState.availableQuestionSets.length > 0) {
      const first = workflowState.availableQuestionSets.find(
        (qs) => qs.id !== undefined && qs.id !== null
      );
      if (first?.id != null) setSelectedQuestionSetId(first.id);
    }
  }, [selectedQuestionSetId, workflowState.availableQuestionSets, setSelectedQuestionSetId]);

  // Auto-select first posture when none is selected
  useEffect(() => {
    if (!selectedPostureId && workflowState.availablePostures.length > 0) {
      const first = workflowState.availablePostures.find(
        (p) => p.id !== undefined && p.id !== null
      );
      if (first?.id != null) setSelectedPostureId(first.id);
    }
  }, [selectedPostureId, workflowState.availablePostures, setSelectedPostureId]);

  // Load policy documents from selected mission plan
  useEffect(() => {
    async function loadPolicyDocs() {
      if (!selectedMissionPlanId) {
        setPolicyDocs([]);
        return;
      }
      try {
        const tuple =
          currentCustomerId && selectedBaselineId
            ? makeCesTuple(currentCustomerId, selectedBaselineId)
            : undefined;
        const mp = await dbHelpers.getMissionPlanById(selectedMissionPlanId, tuple);
        setPolicyDocs(mp?.data?.policy_documents ?? []);
      } catch {
        setPolicyDocs([]);
      }
    }
    loadPolicyDocs();
  }, [selectedMissionPlanId, refreshTrigger, currentCustomerId, selectedBaselineId]);

  // Clear delete confirmation when selection changes
  useEffect(() => {
    setConfirmingDelete(null);
  }, [selectedBaselineId, selectedTenantConfigId, selectedCUIBoundaryId, selectedPolicyInputsId, selectedQuestionSetId, selectedPostureId]);

  const baselineOptions = useMemo(() => {
    return baselines
      .filter((baseline) => baseline.id !== undefined && baseline.id !== null)
      .map((baseline) => ({
        id: baseline.id as number,
        label: formatBaselineLabel(baseline),
      }));
  }, [baselines]);

  const questionSetOptions = useMemo(() => {
    return workflowState.availableQuestionSets
      .filter((qs) => qs.id !== undefined && qs.id !== null)
      .map((qs) => {
        const counts = countControlQuestionSets(qs.data);
        const parts: string[] = [];
        if (counts.l2 > 0) parts.push(`${counts.l2} L2 Control Question Sets`);
        if (counts.l1 > 0) parts.push(`${counts.l1} L1 Control Question Sets`);
        const label = parts.length > 0 ? parts.join(', ') : 'No controls';
        return {
          id: qs.id as number,
          label: `${new Date(qs.createdAt).toISOString().slice(0, 10)} — ${label}`,
        };
      });
  }, [workflowState.availableQuestionSets]);

  const postureOptions = useMemo(() => {
    return workflowState.availablePostures
      .filter((p) => p.id !== undefined && p.id !== null)
      .map((p) => {
        const parentQs = questionSetOptions.find((qs) => qs.id === p.questionSetId);
        return {
          id: p.id as number,
          label: parentQs ? parentQs.label : formatPostureLabel(p),
        };
      });
  }, [workflowState.availablePostures, questionSetOptions]);

  const cuiBoundaryOptions = useMemo(() => {
    return workflowState.availableCUIBoundaries
      .filter((cb) => cb.id !== undefined && cb.id !== null)
      .map((cb) => ({
        id: cb.id as number,
        label: `${new Date(cb.createdAt).toISOString().slice(0, 10)} — CUI Boundary`,
      }));
  }, [workflowState.availableCUIBoundaries]);

  const btcConfirmationOptions = useMemo(() => {
    return workflowState.availableBTCConfirmations
      .filter((btc) => btc.id !== undefined && btc.id !== null)
      .map((btc) => ({
        id: btc.id as number,
        label: `${new Date(btc.createdAt).toISOString().slice(0, 10)} — BTC Confirmation`,
      }));
  }, [workflowState.availableBTCConfirmations]);

  const tenantConfigOptions = useMemo(() => {
    return workflowState.availableTenantConfigs
      .filter((tc) => tc.id !== undefined && tc.id !== null)
      .map((tc) => ({
        id: tc.id as number,
        label: `${new Date(tc.createdAt).toISOString().slice(0, 10)} — Tenant Config Profile`,
      }));
  }, [workflowState.availableTenantConfigs]);

  const policyInputsOptions = useMemo(() => {
    return workflowState.availablePolicyInputs
      .filter((pi) => pi.id !== undefined && pi.id !== null)
      .map((pi) => ({
        id: pi.id as number,
        label: `${new Date(pi.createdAt).toISOString().slice(0, 10)} — Policy Inputs`,
      }));
  }, [workflowState.availablePolicyInputs]);

  // Show spinner only while a selected customer is still loading
  if (currentCustomerId && (customerLoading || !customer)) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mb-3"></div>
          <p className="text-sm text-gray-600">Loading customer...</p>
        </div>
      </div>
    );
  }

  // --- Baseline handlers ---
  const handleViewBaseline = async () => {
    if (!selectedBaselineId) return;
    const tuple = currentCustomerId
      ? makeCesTuple(currentCustomerId, selectedBaselineId)
      : undefined;
    const baseline = await dbHelpers.getBaselineById(selectedBaselineId, tuple);
    if (baseline) setViewerData({ title: 'SI Baseline', data: baseline.data });
  };

  const handleExportBaseline = async () => {
    if (!selectedBaselineId) return;
    const tuple = currentCustomerId
      ? makeCesTuple(currentCustomerId, selectedBaselineId)
      : undefined;
    const baseline = await dbHelpers.getBaselineById(selectedBaselineId, tuple);
    if (baseline) exportJson(baseline.data, `si-baseline-${selectedBaselineId}.json`);
  };

  const handleDeleteBaseline = async () => {
    if (!selectedBaselineId) return;
    // Cascade: delete all downstream question sets, postures, and mission plans
    const questionSets = await db.rr_question_sets
      .where('baselineId')
      .equals(selectedBaselineId)
      .toArray();
    for (const qs of questionSets) {
      if (qs.id != null) {
        const postures = await db.readiness_postures
          .where('questionSetId')
          .equals(qs.id)
          .toArray();
        for (const posture of postures) {
          if (posture.id != null) {
            await db.mission_plans.where('postureId').equals(posture.id).delete();
          }
        }
        await db.readiness_postures.where('questionSetId').equals(qs.id).delete();
      }
    }
    // Cascade CUI boundaries and BTC confirmations
    const cuiBoundaries = await db.cui_boundaries
      .where('baselineId')
      .equals(selectedBaselineId)
      .toArray();
    for (const cb of cuiBoundaries) {
      if (cb.id != null) {
        await db.btc_confirmations.where('cuiBoundaryId').equals(cb.id).delete();
      }
    }
    await db.cui_boundaries.where('baselineId').equals(selectedBaselineId).delete();
    await db.btc_confirmations.where('baselineId').equals(selectedBaselineId).delete();
    await db.tenant_config_profiles.where('baselineId').equals(selectedBaselineId).delete();
    await db.rr_question_sets.where('baselineId').equals(selectedBaselineId).delete();
    await db.mission_plans.where('baselineId').equals(selectedBaselineId).delete();
    await db.si_baselines.delete(selectedBaselineId);
    setSelectedTenantConfigId(null);
    setSelectedPolicyInputsId(null);
    setSelectedBaselineId(null);
    setConfirmingDelete(null);
    await loadBaselines();
  };

  // --- Question set handlers ---
  const handleNewQuestionSet = async () => {
    if (!selectedBaselineId || !rrQuestionBank) return;
    setGenerating(true);
    setGenError(null);
    try {
      const baselineTuple = currentCustomerId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
      const baseline = await dbHelpers.getBaselineById(selectedBaselineId, baselineTuple);
      if (!baseline) throw new Error('Baseline not found');
      const cuiBoundaryForQS = selectedCUIBoundaryId
        ? await dbHelpers.getCUIBoundaryById(selectedCUIBoundaryId, baselineTuple)
        : null;
      const cesId = baseline.cesId || baseline.data?.ces?.cesId;
      const questionSet = await generateRRQuestionSet(
        baseline.data,
        rrQuestionBank,
        baseline.id!,
        () => {},
        {
          cmmcRequirements: cmmcRequirements ?? undefined,
          assessorKB: assessorKB ?? undefined,
        },
        cuiBoundaryForQS?.data ?? null,
        cesId,
      );
      const artifactId = generateArtifactId('rr_question_set');
      const newId = await dbHelpers.createRRQuestionSet({
        customerId: currentCustomerId!,
        baselineId: baseline.id!,
        artifactId,
        cesId,
        data: questionSet,
        createdAt: new Date().toISOString(),
      });
      await persistRRQuestionSet(questionSet, currentCustomerId!, artifactId);
      setSelectedQuestionSetId(newId);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate question set');
    } finally {
      setGenerating(false);
    }
  };

  const handleViewQuestionSet = async () => {
    if (!selectedQuestionSetId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const qs = await dbHelpers.getQuestionSetById(selectedQuestionSetId, tuple);
    if (qs) setViewerData({ title: 'RR Question Set', data: qs.data });
  };

  const handleExportQuestionSet = async () => {
    if (!selectedQuestionSetId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const qs = await dbHelpers.getQuestionSetById(selectedQuestionSetId, tuple);
    if (qs) exportJson(qs.data, `rr-question-set-${selectedQuestionSetId}.json`);
  };

  const handleDeleteQuestionSet = async () => {
    if (!selectedQuestionSetId) return;
    // Cascade: delete associated postures and mission plans
    const postures = await db.readiness_postures
      .where('questionSetId')
      .equals(selectedQuestionSetId)
      .toArray();
    for (const posture of postures) {
      if (posture.id != null) {
        await db.mission_plans.where('postureId').equals(posture.id).delete();
      }
    }
    await db.readiness_postures.where('questionSetId').equals(selectedQuestionSetId).delete();
    await db.rr_question_sets.delete(selectedQuestionSetId);
    setSelectedMissionPlanId(null);
    setSelectedPostureId(null);
    setSelectedQuestionSetId(null);
    setConfirmingDelete(null);
  };

  // --- Posture handlers ---
  const handleViewPosture = async () => {
    if (!selectedPostureId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const posture = await dbHelpers.getPostureById(selectedPostureId, tuple);
    if (posture) setViewerData({ title: 'Readiness Posture', data: posture.data });
  };

  const handleExportPosture = async () => {
    if (!selectedPostureId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const posture = await dbHelpers.getPostureById(selectedPostureId, tuple);
    if (posture) exportJson(posture.data, `readiness-posture-${selectedPostureId}.json`);
  };

  const handleDeletePosture = async () => {
    if (!selectedPostureId) return;
    // Cascade: delete mission plans where postureId matches
    await db.mission_plans.where('postureId').equals(selectedPostureId).delete();
    await db.readiness_postures.delete(selectedPostureId);
    setSelectedMissionPlanId(null);
    setSelectedPostureId(null);
    setConfirmingDelete(null);
  };


  // --- CUI Boundary handlers ---
  const handleViewCUIBoundary = async () => {
    if (!selectedCUIBoundaryId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const cb = await dbHelpers.getCUIBoundaryById(selectedCUIBoundaryId, tuple);
    if (cb) setViewerData({ title: 'CUI Boundary', data: cb.data });
  };

  const handleExportCUIBoundary = async () => {
    if (!selectedCUIBoundaryId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const cb = await dbHelpers.getCUIBoundaryById(selectedCUIBoundaryId, tuple);
    if (cb) exportJson(cb.data, `cui-boundary-${selectedCUIBoundaryId}.json`);
  };

  const handleDeleteCUIBoundary = async () => {
    if (!selectedCUIBoundaryId) return;
    await dbHelpers.deleteCUIBoundary(selectedCUIBoundaryId);
    setSelectedCUIBoundaryId(null);
    setConfirmingDelete(null);
  };

  // --- BTC Confirmation handlers ---
  const handleViewBTCConfirmation = async () => {
    if (!selectedBTCConfirmationId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const btc = await dbHelpers.getBTCById(selectedBTCConfirmationId, tuple);
    if (btc) setViewerData({ title: 'BTC Confirmation', data: btc.data });
  };

  const handleExportBTCConfirmation = async () => {
    if (!selectedBTCConfirmationId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const btc = await dbHelpers.getBTCById(selectedBTCConfirmationId, tuple);
    if (btc) exportJson(btc.data, `btc-confirmation-${selectedBTCConfirmationId}.json`);
  };

  const handleDeleteBTCConfirmation = async () => {
    if (!selectedBTCConfirmationId) return;
    await dbHelpers.deleteBTC(selectedBTCConfirmationId);
    setSelectedBTCConfirmationId(null);
    setConfirmingDelete(null);
  };

  // --- Tenant Config Profile handlers ---
  const handleViewTenantConfig = async () => {
    if (!selectedTenantConfigId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const tc = await dbHelpers.getTenantConfigById(selectedTenantConfigId, tuple);
    if (tc) setViewerData({ title: 'Tenant Config Profile', data: tc.data });
  };

  const handleExportTenantConfig = async () => {
    if (!selectedTenantConfigId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const tc = await dbHelpers.getTenantConfigById(selectedTenantConfigId, tuple);
    if (tc) exportJson(tc.data, `tenant-config-${selectedTenantConfigId}.json`);
  };

  const handleDeleteTenantConfig = async () => {
    if (!selectedTenantConfigId) return;
    await dbHelpers.deleteTenantConfigProfile(selectedTenantConfigId);
    setSelectedTenantConfigId(null);
    setConfirmingDelete(null);
  };

  // --- Policy Inputs handlers ---
  const handleViewPolicyInputs = async () => {
    if (!selectedPolicyInputsId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const pi = await dbHelpers.getPolicyInputsById(selectedPolicyInputsId, tuple);
    if (pi) setViewerData({ title: 'Policy Inputs', data: pi.data });
  };

  const handleExportPolicyInputs = async () => {
    if (!selectedPolicyInputsId) return;
    const tuple =
      currentCustomerId && selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;
    const pi = await dbHelpers.getPolicyInputsById(selectedPolicyInputsId, tuple);
    if (pi) exportJson(pi.data, `policy-inputs-${selectedPolicyInputsId}.json`);
  };

  const handleDeletePolicyInputs = async () => {
    if (!selectedPolicyInputsId) return;
    await dbHelpers.deletePolicyInputs(selectedPolicyInputsId);
    setSelectedPolicyInputsId(null);
    setConfirmingDelete(null);
  };

  const nextStepId = !workflowState.hasBaseline
    ? 'sit'
    : !workflowState.hasQuestionSet
      ? 'rrt-question-set'
      : !workflowState.hasPosture
        ? 'rrt'
        : !workflowState.hasMissionPlan
          ? 'mpt'
          : null;

  const steps = [
    {
      id: 'sit',
      name: 'Strategic Intent Tool (SIT)',
      description: 'Capture compliance goals and constraints',
      completed: workflowState.hasBaseline,
    },
    {
      id: 'rrt-question-set',
      name: 'CES Scenario-Specific RR Question Set',
      description: 'Derive scenario-specific questions from SI Baseline',
      completed: workflowState.hasQuestionSet,
    },
    {
      id: 'rrt',
      name: 'Readiness Recon Tool (RRT)',
      description: 'Assess current compliance posture',
      completed: workflowState.hasPosture,
    },
    {
      id: 'mpt',
      name: 'Mission Planning Tool (MPT)',
      description: 'Generate actionable compliance roadmap',
      completed: workflowState.hasMissionPlan,
    },
  ];

  const hasBaseline = baselineOptions.length > 0;
  const hasQs = questionSetOptions.length > 0;
  const hasPostures = postureOptions.length > 0;

  return (
    <div className="space-y-8">
      {(genError || mptError) && (
        <Alert variant="error" onClose={() => setGenError(null)}>
          {genError || mptError}
        </Alert>
      )}

      {consistencyIssues.length > 0 && (
        <Alert variant="warning" title="Cross-Tool Consistency Issues">
          <ul className="list-disc list-inside space-y-1">
            {consistencyIssues.map((issue) => (
              <li key={issue.id}>{issue.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col items-center justify-center gap-3">
          <WorkflowProgress steps={steps} />
          {selectedBaselineId && currentCesId && (
            <div className="text-xs text-gray-500">
              <span className="font-semibold">CES-ID:</span>
              <span className="ml-1.5 font-mono text-gray-600">{currentCesId}</span>
            </div>
          )}
        </div>

        {showCustomerForm ? (
          <Card title="Customer">
            <CustomerForm
              onSubmit={async (data: CustomerFormData) => {
                try {
                  const id = await createCustomer(data);
                  setShowCustomerForm(false);
                  useAppStore.getState().setCustomer(id);
                } catch {
                  alert('Failed to create customer.');
                }
              }}
              onCancel={() => setShowCustomerForm(false)}
            />
          </Card>
        ) : (
          <Card title="Customer" className={customer ? 'bg-green-100' : undefined}>
            <div className="space-y-3">
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 min-h-[64px] flex items-center">
                {customer ? (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full gap-1">
                    <div>
                      <p className="font-medium text-gray-900">{customer.name}</p>
                      {customer.email && (
                        <p className="text-sm text-gray-500 mt-0.5">{customer.email}</p>
                      )}
                    </div>
                    {customer.targetLevel && <Badge variant="info">{customer.targetLevel}</Badge>}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">
                    No customer selected. Create a new customer or select an existing one to
                    continue.
                  </p>
                )}
              </div>
              <select
                value={currentCustomerId ?? ''}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  if (id) useAppStore.getState().setCustomer(id);
                }}
                disabled={!customer && customers.length === 0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
              >
                {!customer && (
                  <option value="">
                    {customers.length === 0 ? 'No customers yet' : 'Select a customer...'}
                  </option>
                )}
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.targetLevel ? ` (${c.targetLevel})` : ''}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setShowCustomerForm(true)}
                  className="w-full py-2.5 text-sm font-medium rounded-none bg-primary-600 text-white hover:bg-primary-700"
                >
                  Create New
                </button>
              </div>
            </div>
          </Card>
        )}
        <Card
          title="Choose a Strategic Intent"
          className={
            !customer
              ? 'bg-gray-200'
              : hasBaseline
                ? 'bg-green-100'
                : nextStepId === 'sit'
                  ? 'bg-green-50'
                  : 'bg-gray-200'
          }
        >
          <div className="space-y-3">
            <select
              value={selectedBaselineId ?? ''}
              disabled={!customer}
              onChange={async (e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                setSelectedBaselineId(id);
                if (id) {
                  const tuple = currentCustomerId
                    ? makeCesTuple(currentCustomerId, id)
                    : undefined;
                  const baseline = await dbHelpers.getBaselineById(id, tuple);
                  const cesId = baseline?.cesId || baseline?.data?.ces?.cesId || null;
                  useAppStore.getState().setCurrentCesId(cesId);
                } else {
                  useAppStore.getState().setCurrentCesId(null);
                }
              }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {!hasBaseline ? (
                <option value="">No baselines yet</option>
              ) : selectedBaselineId === null ? (
                <option value="">Select a baseline...</option>
              ) : null}
              {baselineOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {confirmingDelete === 'baseline' && selectedBaselineId && (
              <p className="text-xs text-red-600 font-medium">
                Delete {baselineOptions.find((o) => o.id === selectedBaselineId)?.label ?? 'this baseline'}?
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                onClick={() => { useSITStore.getState().reset(); navigate('/sit'); }}
                disabled={!customer}
                className="w-full py-2.5 text-sm font-medium rounded-none bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                New
              </button>
              <button
                onClick={handleViewBaseline}
                disabled={!selectedBaselineId}
                className="w-full py-2.5 text-sm font-medium rounded-none border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                View
              </button>
              <button
                onClick={handleExportBaseline}
                disabled={!selectedBaselineId}
                className="w-full py-2.5 text-sm font-medium rounded-none border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Export
              </button>
              {confirmingDelete === 'baseline' ? (
                <>
                  <button
                    onClick={() => setConfirmingDelete(null)}
                    className="w-full py-2.5 text-sm font-medium rounded-none border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteBaseline}
                    className="w-full py-2.5 text-sm font-medium rounded-none bg-red-600 text-white hover:bg-red-700"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <>
                  <div />
                  <button
                    onClick={() => setConfirmingDelete('baseline')}
                    disabled={!selectedBaselineId}
                    className="w-full py-2.5 text-sm font-medium rounded-none border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </Card>

        <Card
          title="Tenant Configuration Profile"
          className={
            !workflowState.hasBaseline
              ? 'bg-gray-200'
              : tenantConfigOptions.length > 0
                ? 'bg-green-100'
                : 'bg-green-50'
          }
        >
          <div className="space-y-3">
            <select
              value={selectedTenantConfigId ?? ''}
              disabled={!workflowState.hasBaseline}
              onChange={(e) =>
                setSelectedTenantConfigId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {tenantConfigOptions.length === 0 ? (
                <option value="">No tenant configs yet</option>
              ) : selectedTenantConfigId === null ? (
                <option value="">Select a tenant config...</option>
              ) : null}
              {tenantConfigOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {confirmingDelete === 'tenantconfig' && selectedTenantConfigId && (
              <p className="text-xs text-red-600 font-medium">
                Delete this tenant config profile?
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                onClick={() => { useTCPStore.getState().reset(); navigate('/tcp'); }}
                disabled={!workflowState.hasBaseline}
                className="w-full py-2.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                New
              </button>
              <button
                onClick={handleViewTenantConfig}
                disabled={!selectedTenantConfigId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                View
              </button>
              <button
                onClick={handleExportTenantConfig}
                disabled={!selectedTenantConfigId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Export
              </button>
              {confirmingDelete === 'tenantconfig' ? (
                <>
                  <button
                    onClick={() => setConfirmingDelete(null)}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteTenantConfig}
                    className="w-full py-2.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <>
                  <div />
                  <button
                    onClick={() => setConfirmingDelete('tenantconfig')}
                    disabled={!selectedTenantConfigId}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
            {!workflowState.hasBaseline && (
              <p className="text-xs text-gray-500 italic">
                Complete SI Baseline to unlock tenant configuration.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="CUI Boundary Definition"
          className={
            !workflowState.hasBaseline
              ? 'bg-gray-200'
              : cuiBoundaryOptions.length > 0
                ? 'bg-green-100'
                : 'bg-green-50'
          }
        >
          <div className="space-y-3">
            <select
              value={selectedCUIBoundaryId ?? ''}
              disabled={!workflowState.hasBaseline}
              onChange={(e) =>
                setSelectedCUIBoundaryId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {cuiBoundaryOptions.length === 0 ? (
                <option value="">No CUI boundaries yet</option>
              ) : selectedCUIBoundaryId === null ? (
                <option value="">Select a CUI boundary...</option>
              ) : null}
              {cuiBoundaryOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {confirmingDelete === 'cuiboundary' && selectedCUIBoundaryId && (
              <p className="text-xs text-red-600 font-medium">
                Delete this CUI boundary and its BTC confirmations?
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                onClick={() => { useCUIStore.getState().reset(); navigate('/cui'); }}
                disabled={!workflowState.hasBaseline}
                className="w-full py-2.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                New
              </button>
              <button
                onClick={handleViewCUIBoundary}
                disabled={!selectedCUIBoundaryId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                View
              </button>
              <button
                onClick={handleExportCUIBoundary}
                disabled={!selectedCUIBoundaryId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Export
              </button>
              {confirmingDelete === 'cuiboundary' ? (
                <>
                  <button
                    onClick={() => setConfirmingDelete(null)}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteCUIBoundary}
                    className="w-full py-2.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <>
                  <div />
                  <button
                    onClick={() => setConfirmingDelete('cuiboundary')}
                    disabled={!selectedCUIBoundaryId}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
            {!workflowState.hasBaseline && (
              <p className="text-xs text-gray-500 italic">
                Complete SI Baseline to unlock CUI boundary definition.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Boundary Topology Confirmation"
          className={
            !workflowState.hasCUIBoundary
              ? 'bg-gray-200'
              : btcConfirmationOptions.length > 0
                ? 'bg-green-100'
                : 'bg-green-50'
          }
        >
          <div className="space-y-3">
            <select
              value={selectedBTCConfirmationId ?? ''}
              disabled={!workflowState.hasCUIBoundary}
              onChange={(e) =>
                setSelectedBTCConfirmationId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {btcConfirmationOptions.length === 0 ? (
                <option value="">No BTC confirmations yet</option>
              ) : selectedBTCConfirmationId === null ? (
                <option value="">Select a BTC confirmation...</option>
              ) : null}
              {btcConfirmationOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {confirmingDelete === 'btcconfirmation' && selectedBTCConfirmationId && (
              <p className="text-xs text-red-600 font-medium">
                Delete this BTC confirmation?
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                onClick={() => { useBTCStore.getState().reset(); navigate('/btc'); }}
                disabled={!workflowState.hasCUIBoundary}
                className="w-full py-2.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                New
              </button>
              <button
                onClick={handleViewBTCConfirmation}
                disabled={!selectedBTCConfirmationId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                View
              </button>
              <button
                onClick={handleExportBTCConfirmation}
                disabled={!selectedBTCConfirmationId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Export
              </button>
              {confirmingDelete === 'btcconfirmation' ? (
                <>
                  <button
                    onClick={() => setConfirmingDelete(null)}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteBTCConfirmation}
                    className="w-full py-2.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <>
                  <div />
                  <button
                    onClick={() => setConfirmingDelete('btcconfirmation')}
                    disabled={!selectedBTCConfirmationId}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
            {!workflowState.hasCUIBoundary && (
              <p className="text-xs text-gray-500 italic">
                Complete CUI boundary definition to unlock BTC verification.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Collect Policy Inputs"
          className={
            !currentCustomerId
              ? 'bg-gray-200'
              : policyInputsOptions.length > 0
                ? 'bg-green-100'
                : 'bg-green-50'
          }
        >
          <div className="space-y-3">
            <select
              value={selectedPolicyInputsId ?? ''}
              disabled={!currentCustomerId}
              onChange={(e) =>
                setSelectedPolicyInputsId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {policyInputsOptions.length === 0 ? (
                <option value="">No policy inputs yet</option>
              ) : selectedPolicyInputsId === null ? (
                <option value="">Select policy inputs...</option>
              ) : null}
              {policyInputsOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {confirmingDelete === 'policyinputs' && selectedPolicyInputsId && (
              <p className="text-xs text-red-600 font-medium">
                Delete this policy inputs record?
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                onClick={() => { usePolicyStore.getState().reset(); navigate('/policy-inputs'); }}
                disabled={!currentCustomerId}
                className="w-full py-2.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                New
              </button>
              <button
                onClick={handleViewPolicyInputs}
                disabled={!selectedPolicyInputsId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                View
              </button>
              <button
                onClick={handleExportPolicyInputs}
                disabled={!selectedPolicyInputsId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Export
              </button>
              {confirmingDelete === 'policyinputs' ? (
                <>
                  <button
                    onClick={() => setConfirmingDelete(null)}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeletePolicyInputs}
                    className="w-full py-2.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <>
                  <div />
                  <button
                    onClick={() => setConfirmingDelete('policyinputs')}
                    disabled={!selectedPolicyInputsId}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
            {!currentCustomerId && (
              <p className="text-xs text-gray-500 italic">
                Select a customer to collect policy inputs.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Generate Readiness Posture Questions"
          className={
            workflowState.hasQuestionSet
              ? 'bg-green-100'
              : nextStepId === 'rrt-question-set'
                ? 'bg-green-50'
                : !workflowState.hasBaseline
                  ? 'bg-gray-200'
                  : undefined
          }
        >
          <div className="space-y-3">
            <select
              value={selectedQuestionSetId ?? ''}
              onChange={(e) =>
                setSelectedQuestionSetId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              {!hasQs ? (
                <option value="">No question sets yet</option>
              ) : selectedQuestionSetId === null ? (
                <option value="">Select a question set...</option>
              ) : null}
              {questionSetOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {confirmingDelete === 'questionset' && selectedQuestionSetId && (
              <p className="text-xs text-red-600 font-medium">
                Delete {questionSetOptions.find((o) => o.id === selectedQuestionSetId)?.label ?? 'this question set'}?
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                onClick={handleNewQuestionSet}
                disabled={!selectedBaselineId || !rrQuestionBank || generating}
                className="w-full py-2.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? 'Generating...' : 'New'}
              </button>
              <button
                onClick={handleViewQuestionSet}
                disabled={!selectedQuestionSetId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                View
              </button>
              <button
                onClick={handleExportQuestionSet}
                disabled={!selectedQuestionSetId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Export
              </button>
              {confirmingDelete === 'questionset' ? (
                <>
                  <button
                    onClick={() => setConfirmingDelete(null)}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteQuestionSet}
                    className="w-full py-2.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <>
                  <div />
                  <button
                    onClick={() => setConfirmingDelete('questionset')}
                    disabled={!selectedQuestionSetId}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
            {!workflowState.hasBaseline && !hasQs && (
              <p className="text-xs text-gray-500 italic">
                Complete previous steps to unlock this action.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Create Readiness Posture"
          className={
            hasPostures
              ? 'bg-green-100'
              : nextStepId === 'rrt'
                ? 'bg-green-50'
                : !workflowState.hasQuestionSet
                  ? 'bg-gray-200'
                  : undefined
          }
        >
          <div className="space-y-3">
            <select
              value={selectedPostureId ?? ''}
              onChange={(e) =>
                setSelectedPostureId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              {!hasPostures ? (
                <option value="">No postures yet</option>
              ) : selectedPostureId === null ? (
                <option value="">Select a posture...</option>
              ) : null}
              {postureOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {confirmingDelete === 'posture' && selectedPostureId && (
              <p className="text-xs text-red-600 font-medium">
                Delete {postureOptions.find((o) => o.id === selectedPostureId)?.label ?? 'this posture'}?
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              <button
                onClick={() => navigate('/rrt')}
                disabled={!workflowState.hasQuestionSet}
                className="w-full py-2.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Start
              </button>
              <button
                onClick={() => navigate('/rrt')}
                disabled={!rrtInProgress}
                className="w-full py-2.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Resume
              </button>
              <button
                onClick={handleViewPosture}
                disabled={!selectedPostureId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                View
              </button>
              <button
                onClick={handleExportPosture}
                disabled={!selectedPostureId}
                className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Export
              </button>
              {confirmingDelete === 'posture' ? (
                <>
                  <button
                    onClick={() => setConfirmingDelete(null)}
                    className="w-full py-2.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeletePosture}
                    className="w-full py-2.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmingDelete('posture')}
                  disabled={!selectedPostureId}
                  className="w-full py-2.5 text-sm font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Delete
                </button>
              )}
            </div>
            {!workflowState.hasQuestionSet && !hasPostures && (
              <p className="text-xs text-gray-500 italic">
                Complete previous steps to unlock this action.
              </p>
            )}
          </div>
        </Card>

        <ActionCard
          title="Mission Planner"
          description={getMPTDescription(workflowState.hasCUIBoundary, workflowState.hasBTCConfirmation, workflowState.hasPolicyInputs, workflowState.hasTenantConfig)}
          buttonText="Create Mission Plan"
          onAction={async () => {
            const success = await generateMissionPlan();
            if (success) setRefreshTrigger((t) => t + 1);
          }}
          enabled={workflowState.hasPosture}
          completed={workflowState.hasMissionPlan}
          nextStep={nextStepId === 'mpt'}
          onEditRates={() => setShowLoeEditor(true)}
          loading={mptLoading}
          statusText={mptStatusText ?? undefined}
          pickerLabel="Plan Mode"
          pickerOptions={PLAN_MODE_OPTIONS}
          pickerValue={PLAN_MODE_OPTIONS.find((o) => o.value === planMode)?.id ?? null}
          onPickerChange={(id) => {
            const opt = PLAN_MODE_OPTIONS.find((o) => o.id === id);
            if (opt) setPlanMode(opt.value as PlanMode);
          }}
        />

        <Card title="Tenant Cost Estimator" className="bg-blue-50">
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Estimate monthly GCC High G5 costs with line-item breakdown by infrastructure stance
              and workload tier.
            </p>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => navigate('/cost-estimator')}
                className="w-full py-2.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700"
              >
                Open Estimator
              </button>
            </div>
          </div>
        </Card>
      </div>

      <GeneratedArtifactsPanel refreshTrigger={refreshTrigger} />

      {policyDocs.length > 0 && (
        <PolicyDocumentsPanel documents={policyDocs} orgName={customer?.name} />
      )}

      <ArtifactViewerModal
        open={viewerData !== null}
        onClose={() => setViewerData(null)}
        title={viewerData?.title ?? ''}
        data={viewerData?.data}
      />

      <LoeRateEditor open={showLoeEditor} onClose={() => setShowLoeEditor(false)} />
    </div>
  );
}

function formatPostureLabel(posture: any): string {
  const date = posture.createdAt
    ? new Date(posture.createdAt).toISOString().slice(0, 10)
    : 'unknown-date';
  const data = posture.data;
  const summary = data?.readiness_posture?.summary || data?.summary;
  if (summary) {
    const parts: string[] = [];
    if (summary.implemented > 0) parts.push(`${summary.implemented} impl`);
    if (summary.partial > 0) parts.push(`${summary.partial} partial`);
    if (summary.not_implemented > 0) parts.push(`${summary.not_implemented} gap`);
    if (parts.length > 0) return `${date} — ${parts.join(', ')}`;
  }
  return `${date} — Posture ${posture.id}`;
}

function formatBaselineLabel(baseline: any): string {
  const createdAt = baseline.createdAt ? new Date(baseline.createdAt) : null;
  const dateLabel = createdAt ? createdAt.toISOString().slice(0, 10) : 'unknown-date';

  const data = baseline.data || baseline.baseline || baseline;
  const target = data?.ces?.target || data?.si_baseline?.target || {};
  const scope = data?.ces?.scope || data?.si_baseline?.scope || {};
  const operations = data?.ces?.operating_assumptions || data?.si_baseline?.operations || {};
  const dependencies = data?.ces?.dependencies || data?.si_baseline?.dependencies || {};
  const risk = data?.ces?.risk_acceptance || data?.si_baseline?.risk_acceptance || {};
  const assessment = data?.ces?.assessment || data?.si_baseline?.assessment || {};

  const level = target.target_cmmc_level || target.level || 'L?';

  const candidates: Array<string | undefined> = [
    target.cui_presence,
    scope.boundary_strategy,
    scope.deployment_posture,
    operations.collaboration_mode,
    operations.byod_posture,
    data?.ces?.evidence?.evidence_posture_target ||
      data?.si_baseline?.evidence?.evidence_posture_target,
    dependencies.tenant_model_preference,
    risk.poam_policy_intent,
    assessment.assessment_route,
  ];

  const attributes = candidates
    .filter((value): value is string => Boolean(value))
    .slice(0, 4)
    .map((value) => abbreviateValue(value));

  const fileName = [level, ...attributes].join('-');
  return `${dateLabel}_${fileName}`;
}

function abbreviateValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 12);
}

function getMPTDescription(hasCUI: boolean, hasBTC: boolean, hasPolicyInputs?: boolean, hasTCP?: boolean): string {
  const artifacts = ['Manual Plan', 'Proposal', 'Tenant Manifest'];
  if (hasTCP) artifacts.push('Infrastructure Manifest');
  const base = `Generate ${artifacts.join(', ')}.`;
  const extras: string[] = [];
  if (hasPolicyInputs) extras.push('Policy documents will be auto-generated.');
  if (hasCUI && hasBTC && extras.length > 0) return `${base} ${extras.join(' ')}`;
  if (hasCUI && hasBTC) return base;
  const missing: string[] = [];
  if (!hasCUI) missing.push('CUI Boundary not defined');
  if (!hasBTC) missing.push('BTC not verified');
  return `${base}${extras.length > 0 ? ' ' + extras.join(' ') : ''} Note: ${missing.join('; ')} — plan will not include boundary context.`;
}
