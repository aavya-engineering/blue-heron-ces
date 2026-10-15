// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Service to persist generated artifacts to disk during development.
 * Files are saved to the `customers/{customerName}/{inputs|outputs}/` folder in the project root.
 * Files are never overwritten - each save creates a new timestamped file.
 */

import { dbHelpers } from '@/shared/db/schema';

export type ArtifactType =
  | 'customer'
  | 'si-baseline'
  | 'cui-boundary'
  | 'btc-confirmation'
  | 'rr-question-set'
  | 'readiness-posture'
  | 'manual-mission-plan'
  | 'proposal'
  | 'tenant-manifest'
  | 'infrastructure-manifest'
  | 'exclusions-report'
  | 'traceability-report'
  | 'control-assessment-report'
  | 'tech-ref-plan'
  | 'tenant-config-profile'
  | 'policy-inputs';

const OUTPUT_TYPES = new Set<ArtifactType>([
  'manual-mission-plan',
  'proposal',
  'tenant-manifest',
  'infrastructure-manifest',
  'exclusions-report',
  'traceability-report',
  'control-assessment-report',
  'tech-ref-plan',
]);

interface PersistArtifactOptions {
  type: ArtifactType;
  data: unknown;
  customerId?: number | string;
  artifactId?: string;
}

interface PersistResult {
  success: boolean;
  path?: string;
  skipped?: boolean;
  error?: string;
}

/**
 * Persist an artifact to the local file system via the dev server API.
 * Only works during development (Vite dev server must be running).
 * Auto-resolves the customer name from IndexedDB using the provided customerId.
 */
export async function persistArtifact(options: PersistArtifactOptions): Promise<PersistResult> {
  try {
    // Resolve customer name from DB
    let customerName = 'unknown';
    if (options.customerId) {
      const cid =
        typeof options.customerId === 'string'
          ? parseInt(options.customerId, 10)
          : options.customerId;
      if (!isNaN(cid)) {
        const customer = await dbHelpers.getCustomerById(cid);
        if (customer) {
          customerName = customer.name;
        }
      }
    }

    // Determine category
    const category: 'inputs' | 'outputs' = OUTPUT_TYPES.has(options.type) ? 'outputs' : 'inputs';

    const response = await fetch('/api/save-artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: options.type,
        data: options.data,
        customerName,
        category,
        artifactId: options.artifactId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Failed to persist artifact (${options.type}):`, errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();

    if (result.success) {
      if (result.skipped) {
        console.log(`Artifact already exists, skipped: ${result.path}`);
      } else {
        console.log(`Artifact persisted to: ${result.path}`);
      }
    }

    return result;
  } catch (err) {
    // Silently fail in production or when API is unavailable
    console.warn(`Could not persist artifact (${options.type}):`, err);
    return { success: false, error: String(err) };
  }
}

/**
 * Convenience wrappers for specific artifact types
 */
export const persistCustomer = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'customer', data, customerId, artifactId });

export const persistSIBaseline = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'si-baseline', data, customerId, artifactId });

export const persistRRQuestionSet = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'rr-question-set', data, customerId, artifactId });

export const persistReadinessPosture = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'readiness-posture', data, customerId, artifactId });

export const persistManualMissionPlan = (
  data: unknown,
  customerId?: number,
  artifactId?: string,
) => persistArtifact({ type: 'manual-mission-plan', data, customerId, artifactId });

export const persistProposal = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'proposal', data, customerId, artifactId });

export const persistTenantManifest = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'tenant-manifest', data, customerId, artifactId });

export const persistExclusionsReport = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'exclusions-report', data, customerId, artifactId });

export const persistTraceabilityReport = (
  data: unknown,
  customerId?: number,
  artifactId?: string,
) => persistArtifact({ type: 'traceability-report', data, customerId, artifactId });

export const persistTechRefPlan = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'tech-ref-plan', data, customerId, artifactId });

export const persistCUIBoundary = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'cui-boundary', data, customerId, artifactId });

export const persistBTCConfirmation = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'btc-confirmation', data, customerId, artifactId });

export const persistInfrastructureManifest = (
  data: unknown,
  customerId?: number,
  artifactId?: string,
) => persistArtifact({ type: 'infrastructure-manifest', data, customerId, artifactId });

export const persistTenantConfigProfile = (
  data: unknown,
  customerId?: number,
  artifactId?: string,
) => persistArtifact({ type: 'tenant-config-profile', data, customerId, artifactId });

export const persistPolicyInputs = (data: unknown, customerId?: number, artifactId?: string) =>
  persistArtifact({ type: 'policy-inputs', data, customerId, artifactId });

export const persistControlAssessmentReport = (
  data: unknown,
  customerId?: number,
  artifactId?: string,
) => persistArtifact({ type: 'control-assessment-report', data, customerId, artifactId });
