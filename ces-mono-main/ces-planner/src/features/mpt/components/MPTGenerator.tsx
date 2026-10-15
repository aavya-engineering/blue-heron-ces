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
import { useAppStore } from '@/shared/stores/appStore';
import { useMPTStore } from '../stores/mptStore';
import { dbHelpers } from '@/shared/db/schema';
import { makeCesTuple } from '@/shared/identity/cesTuple';
import { compileGapSet } from '../services/gapCompiler';
import { compileTaskCatalog } from '../services/taskCompiler';
import { generateManualPlan } from '../services/manualPlanGenerator';
import { generateProposal } from '../services/proposalGenerator';
import { generateTenantManifest } from '../services/manifestGenerator';
import { validateArtifactAlignment } from '../services/validator';
import { GapAnalysisPanel } from './GapAnalysisPanel';
import { PlanViewer } from './PlanViewer';
import { Alert } from '@/shared/components/Display/Alert';
import { Card } from '@/shared/components/Display/Card';
import {
  useCMMCRequirements,
  useEvidenceMatrix,
  useAssessorKB,
  useCapabilityTaxonomy,
  useImplementationPatterns,
  useVendorPlaybook,
  useEvidenceArchetypes,
  useRRQuestionBank,
} from '@/shared/hooks/useDataLoader';
import type { PlanMode } from '../types';
import {
  persistManualMissionPlan,
  persistProposal,
  persistTenantManifest,
  persistExclusionsReport,
} from '@/shared/services/artifactPersistence';
import { generateExclusionsReport } from '../services/exclusionsReportGenerator';

export function MPTGenerator() {
  const navigate = useNavigate();
  const { currentCustomerId, selectedBaselineId, selectedBTCConfirmationId } = useAppStore();
  const { planMode, generatedArtifacts, setPlanMode, setArtifacts } = useMPTStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siBaseline, setSiBaseline] = useState<any>(null);
  const [readinessPosture, setReadinessPosture] = useState<any>(null);
  const [btcConfirmationData, setBtcConfirmationData] = useState<any>(null);
  const [gapSet, setGapSet] = useState<any>(null);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Load domain data via hooks
  const { data: cmmcRequirements } = useCMMCRequirements();
  const { data: evidenceMatrix } = useEvidenceMatrix();
  const { data: assessorKB } = useAssessorKB();
  const { data: capabilityTaxonomy } = useCapabilityTaxonomy();
  const { data: implementationPatterns } = useImplementationPatterns();
  const { data: vendorPlaybook } = useVendorPlaybook();
  const { data: evidenceArchetypes } = useEvidenceArchetypes();
  const { data: rrQuestionBank } = useRRQuestionBank();

  useEffect(() => {
    loadRequiredData();
  }, [currentCustomerId]);

  const loadRequiredData = async () => {
    if (!currentCustomerId) {
      setError('No customer selected');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const baseline = await dbHelpers.getLatestBaselineByCustomer(currentCustomerId);
      if (!baseline) {
        setError('No SI Baseline found. Please complete SIT first.');
        setLoading(false);
        return;
      }

      const posture = await dbHelpers.getPostureByBaseline(baseline.id!);
      if (!posture) {
        setError('No Readiness Posture found. Please complete RRT first.');
        setLoading(false);
        return;
      }

      setSiBaseline(baseline.data);
      setReadinessPosture(posture.data);

      // Load optional BTC confirmation (scoped to the active customer + baseline)
      if (selectedBTCConfirmationId) {
        const tuple = selectedBaselineId
          ? makeCesTuple(currentCustomerId, selectedBaselineId)
          : undefined;
        const btc = await dbHelpers.getBTCById(selectedBTCConfirmationId, tuple);
        if (btc) setBtcConfirmationData(btc.data);
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load required data');
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!siBaseline || !readinessPosture) {
      setError('Missing required data');
      return;
    }

    setLoading(true);
    setError(null);
    setValidationWarnings([]);

    try {
      // Domain data — enriched with capability taxonomy, patterns, and vendor playbook
      const vendorCapabilities = {
        taxonomy: capabilityTaxonomy,
        patterns: implementationPatterns,
        playbook: vendorPlaybook,
      };

      // Step 1: Compile gap set (pseudocode §4.2)
      const gaps = compileGapSet(
        siBaseline,
        readinessPosture,
        cmmcRequirements || { requirements: [] },
        evidenceMatrix || {},
        vendorCapabilities,
        btcConfirmationData ?? null,
      );
      setGapSet(gaps);

      // Step 2: Build task catalog (pseudocode §4.3)
      const taskCatalog = compileTaskCatalog(
        gaps,
        siBaseline,
        vendorCapabilities,
        assessorKB || {},
        cmmcRequirements || { requirements: [] },
        evidenceArchetypes,
        undefined,
        btcConfirmationData ?? null,
        evidenceMatrix || {},
      );
      console.log(`[MPT] Gap set: ${gaps.gaps.length} gaps → Task catalog: ${taskCatalog.tasks.length} tasks`);

      // Step 3: Generate deliverables (pseudocode §4.4–§4.7)
      const manualPlan = generateManualPlan(
        siBaseline,
        readinessPosture,
        taskCatalog,
        planMode,
        assessorKB || {},
        vendorCapabilities,
        undefined,
        undefined,
        undefined,
        gaps.scopeExclusions,
        undefined,
        gaps.warnings,
      );

      const proposal = generateProposal(
        siBaseline,
        planMode,
        manualPlan,
        taskCatalog,
      );

      const manifest = generateTenantManifest(
        siBaseline,
        planMode,
        taskCatalog,
        assessorKB || {},
      );

      // Step 4: Validate cross-artifact alignment (pseudocode §4.8)
      const validation = validateArtifactAlignment(manualPlan, proposal, manifest);
      if (!validation.valid) {
        setError(`Validation failed: ${validation.errors.join(', ')}`);
        setLoading(false);
        return;
      }
      if (validation.warnings.length > 0) {
        setValidationWarnings(validation.warnings);
      }

      // Step 5: Generate exclusions report
      const baseline_ = await dbHelpers.getLatestBaselineByCustomer(currentCustomerId!);
      const questionSetRecord = await dbHelpers.getQuestionSetByBaseline(baseline_!.id!);
      const exclusionsReport = questionSetRecord
        ? generateExclusionsReport(
            siBaseline,
            questionSetRecord.data,
            cmmcRequirements || { requirements: [] },
            rrQuestionBank || {},
          )
        : null;

      // Step 6: Save to database
      const posture_ = await dbHelpers.getPostureByBaseline(baseline_!.id!);
      const newPlanId = await dbHelpers.createMissionPlan({
        customerId: currentCustomerId!,
        baselineId: baseline_!.id!,
        postureId: posture_!.id!,
        data: {
          manual_plan: manualPlan,
          proposal,
          tenant_manifest: manifest,
        },
        createdAt: new Date().toISOString(),
      });

      // Persist all artifacts to local disk
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await Promise.all([
        persistManualMissionPlan(manualPlan, currentCustomerId!, `manual-${timestamp}`),
        persistProposal(proposal, currentCustomerId!, `proposal-${timestamp}`),
        persistTenantManifest(manifest, currentCustomerId!, `manifest-${timestamp}`),
        ...(exclusionsReport
          ? [persistExclusionsReport(exclusionsReport, currentCustomerId!, `exclusions-${timestamp}`)]
          : []),
      ]);

      useAppStore.getState().setSelectedMissionPlanId(newPlanId);

      setArtifacts({
        manualPlan,
        proposal,
        manifest,
      });

      setShowResults(true);
      setLoading(false);
    } catch (err) {
      console.error('Error generating mission plan:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate mission plan');
      setLoading(false);
    }
  };

  if (loading && !siBaseline) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading required data...</p>
        </div>
      </div>
    );
  }

  if (error && !siBaseline) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-red-600">
          <p className="text-xl font-semibold mb-2">Error</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-6xl mx-auto py-8 px-4">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Mission Plan Generated</h1>
            <p className="text-gray-600">All artifacts have been successfully generated and validated.</p>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 whitespace-nowrap"
          >
            Back to Dashboard
          </button>
        </div>

        {error && (
          <Alert variant="error" className="mb-6" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        {validationWarnings.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h4 className="text-sm font-medium text-yellow-900 mb-2">Validation Warnings</h4>
            <ul className="text-sm text-yellow-800 space-y-1">
              {validationWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {gapSet && <GapAnalysisPanel gapSet={gapSet} />}

        <div className="mt-6">
          {generatedArtifacts.manualPlan && <PlanViewer plan={generatedArtifacts.manualPlan} />}
        </div>

      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Mission Planning Tool (MPT)</h1>
        <p className="text-gray-600">
          Generate the complete mission plan including Manual Plan, Proposal, and Tenant Manifest.
        </p>
      </div>

      {error && (
        <Alert variant="error" className="mb-6" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card title="Plan Configuration">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Plan Mode</label>
            <select
              value={planMode}
              onChange={(e) => setPlanMode(e.target.value as PlanMode)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="harden_existing">Harden Existing</option>
              <option value="build_new">Build New</option>
              <option value="migrate">Migrate</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>

          {siBaseline && readinessPosture && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded">
              <h4 className="text-sm font-medium text-blue-900 mb-2">Ready to Generate</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>SI Baseline: loaded</li>
                <li>Readiness Posture: loaded</li>
                <li>
                  Control Status: {readinessPosture.ces?.control_status_summary?.met ?? '?'} met,{' '}
                  {readinessPosture.ces?.control_status_summary?.not_met ?? '?'} not_met
                </li>
                <li>
                  Domain Data: {cmmcRequirements ? 'CMMC Requirements loaded' : 'using defaults'},{' '}
                  {assessorKB ? 'Assessor KB loaded' : 'using defaults'}
                </li>
                <li>
                  Vendor Data:{' '}
                  {implementationPatterns ? 'Patterns loaded' : 'using defaults'},{' '}
                  {vendorPlaybook ? 'M365 Playbook loaded' : 'using defaults'}
                </li>
              </ul>
            </div>
          )}
        </div>
      </Card>

      <div className="mt-8">
        <button
          onClick={handleGenerate}
          disabled={loading || !siBaseline || !readinessPosture}
          className="w-full px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
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
              Generating Mission Plan...
            </>
          ) : (
            'Generate Mission Plan'
          )}
        </button>
      </div>
    </div>
  );
}
