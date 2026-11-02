// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-ST4 — the `eo_render_directive` Stamper writes for document-renderable controls.
//
// Contract owner: EvidenceOps. EO's StamperEvidenceLoader reads `eo_render_directive` from the
// TOP LEVEL of a Stamper evidence JSON file and parses it with RenderDirectiveSchema
// (ces-eo/src/shared/types/render.types.ts): `directive_code` (an EO_RENDER_* code that selects the
// render template), `artifact_version`, `input_sources`, `output_target`, optional `depends_on`.
// Before W4-ST4 Stamper wrote `code: '<control id>'` nested under `metadata`, so no directive ever
// parsed and no render started (REQ-ces-stamper-eo-render-directive-shape, filed by ces-eo).
// `artifact_type` / `render_scope` are Stamper-side descriptors; EO's schema ignores them.

import { createHash } from 'crypto';
import type { StructuredEvidence, EvidenceOutcome, ComplianceVerdict, EoRenderDirective } from '../types/schema.types.js';

/** Per-control render directive for the seven document-renderable controls. */
export const EO_RENDER_DIRECTIVES: Readonly<Record<string, EoRenderDirective>> = {
  'IA.L2-3.5.8': {
    directive_code: 'EO_RENDER_PASSWORD_REUSE_POLICY',
    artifact_type: 'policy_document',
    artifact_version: '1.0',
    input_sources: ['entra_password_policy'],
    output_target: 'Password Policy - IA.L2-3.5.8.docx',
    render_scope: 'password_reuse_prohibition',
  },
  'CM.L2-3.4.4': {
    directive_code: 'EO_RENDER_SIA',
    artifact_type: 'sia_template',
    artifact_version: '1.0',
    input_sources: ['entra_audit_logs'],
    output_target: 'Security Impact Analysis Template - CM.L2-3.4.4.docx',
    render_scope: 'change_management_sia',
  },
  'CM.L2-3.4.8': {
    directive_code: 'EO_RENDER_DENY_BY_EXCEPTION_POLICY',
    artifact_type: 'policy_document',
    artifact_version: '1.0',
    input_sources: ['intune_app_control_policies'],
    output_target: 'Application Control Policy - CM.L2-3.4.8.docx',
    render_scope: 'deny_allow_list',
  },
  'AU.L2-3.3.6': {
    directive_code: 'EO_RENDER_AUDIT_REDUCTION_REPORT',
    artifact_type: 'policy_document',
    artifact_version: '1.0',
    input_sources: ['unified_audit_log'],
    output_target: 'Audit Review and Reporting Policy - AU.L2-3.3.6.docx',
    render_scope: 'audit_reduction_tools',
  },
  'CA.L2-3.12.2': {
    directive_code: 'EO_RENDER_POAM',
    artifact_type: 'poam',
    artifact_version: '1.0',
    input_sources: ['pipeline_not_sat_findings', 'manual_gate_items'],
    output_target: 'POA&M - CA.L2-3.12.2.docx',
    render_scope: 'full_poam',
  },
  'CA.L2-3.12.4': {
    directive_code: 'EO_RENDER_SSP',
    artifact_type: 'ssp',
    artifact_version: '1.0',
    input_sources: ['pipeline_control_narratives', 'evidence_manifests'],
    output_target: 'System Security Plan - CA.L2-3.12.4.docx',
    render_scope: 'full_ssp',
  },
  'RA.L2-3.11.2': {
    directive_code: 'EO_RENDER_VULN_SCAN_REPORT',
    artifact_type: 'scan_report',
    artifact_version: '1.0',
    input_sources: ['defender_for_cloud_findings'],
    output_target: 'Vulnerability Scan Report - RA.L2-3.11.2.pdf',
    render_scope: 'active_vulnerabilities',
  },
};

export interface DocumentRenderableEvidenceInput {
  controlIds: string[];
  primaryControlId: string;
  readiness: 'met' | 'not_met';
  justification: string;
  executorIdentity: string;
  /** Present only when the adequacy check passed; attached at the top level for EO. */
  directive?: EoRenderDirective;
  timestamp?: string;
}

/** Build the evidence record the execute route writes for a document-renderable task. */
export function buildDocumentRenderableEvidence(input: DocumentRenderableEvidenceInput): StructuredEvidence {
  const met = input.readiness === 'met';
  const rawResponse = JSON.stringify({
    control_id: input.primaryControlId,
    directive: 'document-renderable',
    readiness: input.readiness,
    justification: input.justification,
  });
  return {
    rawResponse,
    outcome: (met ? 'policy_compliance' : 'verification_pending') as EvidenceOutcome,
    outcomeRationale: input.justification,
    complianceVerdict: (met ? 'SAT' : 'NOT_SAT') as ComplianceVerdict,
    verdictRationale: met
      ? 'Signal verified — EO render directive attached for document generation'
      : 'Signal verification failed — control remains provisional',
    metadata: {
      controlIds: input.controlIds,
      timestamp: input.timestamp ?? new Date().toISOString(),
      executorIdentity: input.executorIdentity,
      commandExecuted: '',
      sha256Hash: createHash('sha256').update(rawResponse, 'utf8').digest('hex'),
    },
    ...(input.directive ? { eo_render_directive: input.directive } : {}),
  };
}
