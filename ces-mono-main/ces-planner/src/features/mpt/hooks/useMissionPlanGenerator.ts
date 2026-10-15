// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import { useAppStore } from '@/shared/stores/appStore';
import { useMPTStore } from '../stores/mptStore';
import { dbHelpers } from '@/shared/db/schema';
import { makeCesTuple } from '@/shared/identity/cesTuple';
import { compileGapSet } from '../services/gapCompiler';
import { compileTaskCatalog } from '../services/taskCompiler';
import { generateManualPlan } from '../services/manualPlanGenerator';
import { generateProposal } from '../services/proposalGenerator';
import { generateTenantManifest } from '../services/manifestGenerator';
import { generateInfrastructureManifest } from '../services/infraManifestGenerator';
import { validateArtifactAlignment } from '../services/validator';
import {
  persistManualMissionPlan,
  persistProposal,
  persistTenantManifest,
  persistInfrastructureManifest,
  persistExclusionsReport,
  persistTraceabilityReport,
  persistControlAssessmentReport,
  persistTechRefPlan,
} from '@/shared/services/artifactPersistence';
import { generateExclusionsReport } from '../services/exclusionsReportGenerator';
import { generateTraceabilityReport } from '../services/traceabilityReportGenerator';
import { generateControlAssessmentReport } from '../services/controlAssessmentReportGenerator';
import { compilePolicyContext } from '../services/policyContextCompiler';
import { renderAllPolicies } from '../services/policyRenderer';
import {
  useCMMCRequirements,
  useEvidenceMatrix,
  useAssessorKB,
  useCapabilityTaxonomy,
  useImplementationPatterns,
  useVendorPlaybook,
  useEvidenceArchetypes,
  useRRQuestionBank,
  useTechRef,
  useFedRAMPInheritanceTable,
} from '@/shared/hooks/useDataLoader';
import { buildTechRefIndex } from '@/shared/services/techRefIndex';
import type { PlanMode } from '../types';

export function useMissionPlanGenerator() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const { planMode, setPlanMode, setArtifacts } = useMPTStore();
  const { currentCustomerId, selectedBaselineId, selectedPostureId, selectedCUIBoundaryId, selectedBTCConfirmationId, selectedTenantConfigId, selectedPolicyInputsId } = useAppStore();

  // All 9 data loader hooks (called unconditionally per Rules of Hooks)
  const { data: cmmcRequirements } = useCMMCRequirements();
  const { data: evidenceMatrix } = useEvidenceMatrix();
  const { data: assessorKB } = useAssessorKB();
  const { data: capabilityTaxonomy } = useCapabilityTaxonomy();
  const { data: implementationPatterns } = useImplementationPatterns();
  const { data: vendorPlaybook } = useVendorPlaybook();
  const { data: evidenceArchetypes } = useEvidenceArchetypes();
  const { data: rrQuestionBank } = useRRQuestionBank();
  const { data: techRef } = useTechRef();
  const { data: fedRAMPInheritanceTable } = useFedRAMPInheritanceTable();

  const generate = async (): Promise<boolean> => {
    if (!currentCustomerId) {
      setError('No customer selected');
      return false;
    }

    setLoading(true);
    setError(null);
    setStatusText('Loading baseline and posture...');

    try {
      // Load SI Baseline + Readiness Posture from DB (prefer user-selected IDs)
      const baseline = selectedBaselineId
        ? await dbHelpers.getBaselineById(
            selectedBaselineId,
            makeCesTuple(currentCustomerId, selectedBaselineId),
          )
        : await dbHelpers.getLatestBaselineByCustomer(currentCustomerId);
      if (!baseline) {
        setError('No SI Baseline found. Please complete SIT first.');
        setLoading(false);
        setStatusText(null);
        return false;
      }

      const posture = selectedPostureId
        ? await dbHelpers.getPostureById(
            selectedPostureId,
            makeCesTuple(currentCustomerId, baseline.id!),
          )
        : await dbHelpers.getPostureByBaseline(baseline.id!);
      if (!posture) {
        setError('No Readiness Posture found. Please complete RRT first.');
        setLoading(false);
        setStatusText(null);
        return false;
      }

      const siBaseline = baseline.data;
      const readinessPosture = posture.data;
      const cesId = baseline.cesId || baseline.data?.ces?.cesId;

      // Scope downstream / customer-scoped reads to the active tuple (G1/ADR-001 ownership).
      const tuple = selectedBaselineId
        ? makeCesTuple(currentCustomerId, selectedBaselineId)
        : undefined;

      // Load optional CUI boundary, BTC confirmation, and tenant config profile
      const cuiBoundary = selectedCUIBoundaryId
        ? await dbHelpers.getCUIBoundaryById(selectedCUIBoundaryId, tuple)
        : null;
      const btcConfirmation = selectedBTCConfirmationId
        ? await dbHelpers.getBTCById(selectedBTCConfirmationId, tuple)
        : null;
      const tenantConfig = selectedTenantConfigId
        ? await dbHelpers.getTenantConfigById(selectedTenantConfigId, tuple)
        : null;

      // Load optional policy inputs (customer-scoped — baseline part of the tuple is ignored)
      const policyInputsRecord = selectedPolicyInputsId
        ? await dbHelpers.getPolicyInputsById(selectedPolicyInputsId, tuple)
        : null;

      // Domain data
      const vendorCapabilities = {
        taxonomy: capabilityTaxonomy,
        patterns: implementationPatterns,
        playbook: vendorPlaybook,
      };

      // Step 1: Compile gap set
      setStatusText('Compiling gaps...');
      const { gaps, scopeExclusions, controlDispositions, warnings: scopeWarnings } = compileGapSet(
        siBaseline,
        readinessPosture,
        cmmcRequirements || { requirements: [] },
        evidenceMatrix || {},
        vendorCapabilities,
        btcConfirmation?.data ?? null,
        cuiBoundary?.data ?? null,
        fedRAMPInheritanceTable ?? null,
      );

      // Step 2: Build task catalog
      setStatusText('Building task catalog...');
      const techRefIdx = techRef ? buildTechRefIndex(techRef) : undefined;
      const { tasks, controlDispositions: updatedDispositions } = compileTaskCatalog(
        { gaps, scopeExclusions, controlDispositions },
        siBaseline,
        vendorCapabilities,
        assessorKB || {},
        cmmcRequirements || { requirements: [] },
        evidenceArchetypes,
        techRefIdx,
        btcConfirmation?.data ?? null,
        evidenceMatrix || {},
        tenantConfig?.data ?? null,
        controlDispositions,
      );
      const taskCatalog = { tasks };
      console.log(
        `[MPT] Gap set: ${gaps.length} gaps -> Task catalog: ${taskCatalog.tasks.length} tasks`,
      );

      // Step 3: Generate deliverables
      setStatusText('Generating plan...');

      // Generate infrastructure manifest when TCP is available
      const infraManifest = tenantConfig?.data
        ? generateInfrastructureManifest(siBaseline, tenantConfig.data)
        : null;
      if (infraManifest) {
        console.log(`[MPT] Infrastructure manifest: ${infraManifest.infrastructure_manifest.registry_coverage.covered_entry_ids.length} registry entries covered`);
      }

      const manualPlan = generateManualPlan(
        siBaseline,
        readinessPosture,
        taskCatalog,
        planMode,
        assessorKB || {},
        vendorCapabilities,
        cuiBoundary?.data ?? null,
        btcConfirmation?.data ?? null,
        tenantConfig?.data ?? null,
        scopeExclusions,
        updatedDispositions,
        scopeWarnings,
        cesId,
      );

      const proposal = generateProposal(siBaseline, planMode, manualPlan, taskCatalog, cuiBoundary?.data ?? null, btcConfirmation?.data ?? null, tenantConfig?.data ?? null, cesId);

      const manifest = generateTenantManifest(
        siBaseline,
        planMode,
        taskCatalog,
        assessorKB || {},
        cuiBoundary?.data ?? null,
        btcConfirmation?.data ?? null,
        tenantConfig?.data ?? null,
        cesId,
      );

      // Step 4: Validate cross-artifact alignment
      setStatusText('Validating...');
      const validation = validateArtifactAlignment(manualPlan, proposal, manifest, btcConfirmation?.data ?? null, cuiBoundary?.data ?? null, tenantConfig?.data ?? null);
      if (!validation.valid) {
        setError(`Validation failed: ${validation.errors.join(', ')}`);
        setLoading(false);
        setStatusText(null);
        return false;
      }

      // Step 5: Generate exclusions report
      setStatusText('Generating exclusions report...');
      const questionSetRecord = await dbHelpers.getQuestionSetByBaseline(baseline.id!);
      const exclusionsReport = questionSetRecord
        ? generateExclusionsReport(
            siBaseline,
            questionSetRecord.data,
            cmmcRequirements || { requirements: [] },
            rrQuestionBank || {},
          )
        : null;

      // Step 6: Generate traceability report
      setStatusText('Generating traceability report...');
      const targetLevel = siBaseline.si_baseline?.target?.target_cmmc_level || 'L2';
      const infrastructure_model = siBaseline.si_baseline?.dependencies?.infrastructure_model || 'm365_azure';
      const traceabilityReport = generateTraceabilityReport(
        cmmcRequirements || { requirements: [] },
        taskCatalog,
        targetLevel,
        infrastructure_model,
      );

      // Step 6B: Generate control assessment report
      setStatusText('Generating control assessment report...');
      const controlAssessmentReport = generateControlAssessmentReport(
        cmmcRequirements || { requirements: [] },
        { gaps, scopeExclusions, controlDispositions },
        taskCatalog,
        assessorKB || {},
        readinessPosture,
        targetLevel,
      );

      // Step 7: Generate policy documents (if policy inputs are available)
      let policyDocuments: Array<{ template_id: string; title: string; markdown: string; completeness: number }> | undefined;
      if (policyInputsRecord) {
        setStatusText('Generating policy documents...');
        try {
          const policyCtx = compilePolicyContext({
            policyInputs: policyInputsRecord.data,
            siBaseline,
            tenantConfig: tenantConfig?.data ?? undefined,
            cuiBoundary: cuiBoundary?.data ?? undefined,
            btcConfirmation: btcConfirmation?.data ?? undefined,
            readinessPosture,
          });
          const rendered = await renderAllPolicies(policyCtx);
          policyDocuments = rendered.map((d) => ({
            template_id: d.template_id,
            title: d.title,
            markdown: d.markdown,
            completeness: d.completeness,
          }));
          console.log(`[MPT] Generated ${policyDocuments.length} policy documents`);
        } catch (err) {
          console.warn('Policy document generation failed (non-fatal):', err);
        }
      }

      // Step 8: Save to database
      setStatusText('Saving artifacts...');
      const newPlanId = await dbHelpers.createMissionPlan({
        customerId: currentCustomerId,
        baselineId: baseline.id!,
        postureId: posture.id!,
        cesId,
        data: {
          manual_plan: manualPlan,
          proposal,
          tenant_manifest: manifest,
          ...(infraManifest ? { infrastructure_manifest: infraManifest } : {}),
          ...(policyDocuments ? { policy_documents: policyDocuments } : {}),
        },
        createdAt: new Date().toISOString(),
      });

      // Persist all artifacts to local disk
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await Promise.all([
        persistManualMissionPlan(manualPlan, currentCustomerId, `manual-${timestamp}`),
        persistProposal(proposal, currentCustomerId, `proposal-${timestamp}`),
        persistTenantManifest(manifest, currentCustomerId, `manifest-${timestamp}`),
        ...(infraManifest
          ? [persistInfrastructureManifest(infraManifest, currentCustomerId, `infra-manifest-${timestamp}`)]
          : []),
        ...(exclusionsReport
          ? [persistExclusionsReport(exclusionsReport, currentCustomerId, `exclusions-${timestamp}`)]
          : []),
        persistTraceabilityReport(traceabilityReport, currentCustomerId, `traceability-${timestamp}`),
        persistControlAssessmentReport(controlAssessmentReport, currentCustomerId, `assessment-${timestamp}`),
      ]);

      // Step 9: Generate Tech Ref Implementation Guide
      setStatusText('Generating tech ref implementation guide...');
      const { compileTechRefPlan } = await import('@/shared/utils/exportTechRefPlan');
      const techRefPlan = compileTechRefPlan(
        techRef || { control_families: [] },
        readinessPosture,
        evidenceMatrix || {},
        evidenceArchetypes || {},
      );
      await persistTechRefPlan(techRefPlan, currentCustomerId, `techref-plan-${timestamp}`);

      useAppStore.getState().setSelectedMissionPlanId(newPlanId);

      setArtifacts({ manualPlan, proposal, manifest });

      setLoading(false);
      setStatusText(null);
      return true;
    } catch (err) {
      console.error('Error generating mission plan:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate mission plan');
      setLoading(false);
      setStatusText(null);
      return false;
    }
  };

  return { generate, loading, error, statusText, planMode, setPlanMode };
}

export const PLAN_MODE_OPTIONS: Array<{ id: number; label: string; value: PlanMode }> = [
  { id: 0, label: 'Harden Existing', value: 'harden_existing' },
  { id: 1, label: 'Build New', value: 'build_new' },
  { id: 2, label: 'Migrate', value: 'migrate' },
  { id: 3, label: 'Hybrid', value: 'hybrid' },
];
