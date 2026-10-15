// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Type definitions for EO render directives, render status, render context,
 * input source specs, and template interface.
 */

import { z } from 'zod';

// --- Render Directive (from Stamper evidence files) ---

export const RenderDirectiveSchema = z.object({
  directive_code: z.string(),
  artifact_version: z.string().default('1.0'),
  input_sources: z.array(z.string()),
  output_target: z.string(),
  depends_on: z.array(z.string()).default([]),
});

export type RenderDirective = z.infer<typeof RenderDirectiveSchema>;

// --- Render Result ---

export interface RenderResult {
  state: 'rendered' | 'failed' | 'skipped';
  artifact_path?: string;
  failure_reason?: string;
  retry_safe?: boolean;
}

// --- Render Status (appended to evidence files) ---

export interface RenderStatus {
  directive_code: string;
  state: RenderResult['state'];
  artifact_path?: string;
  failure_reason?: string;
  rendered_at: string;
  artifact_version: string;
}

// --- Render Context ---

export interface RenderContext {
  tenantSlug: string;
  tenantName: string;
  complianceRepoPath: string;
  assessmentSnapshot: unknown;
  renderedArtifacts: Map<string, RenderResult>;
  date: string;
}

// --- Input Source Spec ---

export interface InputSourceSpec {
  rawPath: string;
  prefix: string;
  segments: string[];
}

// --- Resolver Response ---

export type ResolverResponse =
  | { resolved: true; data: unknown }
  | { resolved: false; reason: string };

// --- Template Interface ---

export interface IRenderTemplate {
  readonly directiveCodes: string[];
  render(
    directive: RenderDirective,
    resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult>;
}

// --- Directive codes ---

export const DIRECTIVE_CODES = {
  PASSWORD_REUSE_POLICY: 'EO_RENDER_PASSWORD_REUSE_POLICY',
  DENY_BY_EXCEPTION_POLICY: 'EO_RENDER_DENY_BY_EXCEPTION_POLICY',
  SIA: 'EO_RENDER_SIA',
  AUDIT_REDUCTION_REPORT: 'EO_RENDER_AUDIT_REDUCTION_REPORT',
  POAM: 'EO_RENDER_POAM',
  SSP: 'EO_RENDER_SSP',
  VULN_SCAN_REPORT: 'EO_RENDER_VULN_SCAN_REPORT',
  PERSONNEL_SCREENING_POLICY: 'EO_RENDER_POLICY_PERSONNEL_SCREENING',
  PERSONNEL_TERMINATION_POLICY: 'EO_RENDER_POLICY_PERSONNEL_TERMINATION',
  PERSONNEL_TRAINING_POLICY: 'EO_RENDER_POLICY_PERSONNEL_TRAINING',
  RISK_ASSESSMENT_POLICY: 'EO_RENDER_POLICY_RISK_ASSESSMENT',
  RISK_ASSESSMENT_REPORT: 'EO_RENDER_DOC_RISK_ASSESSMENT_REPORT',
} as const;
