// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export interface OffboardingStep {
  id: string;
  label: string;
  completed: boolean;
  completedAt?: string;
  attestor?: string;
  notes?: string;
  evidenceArtifactId?: string;
  systemEvidenced?: boolean;
  adminOpsRowId?: string;
}

export interface OffboardingRun {
  runId: string;
  personnelId: string;
  personnelName: string;
  tenantSlug: string;
  triggerTime: string;
  currentStepIndex: number;
  steps: OffboardingStep[];
  slaStatus: 'green' | 'yellow' | 'red';
  state: 'in-progress' | 'completed' | 'cancelled';
}

export interface OffboardingProceduralOverlay {
  artifactId: string;
  runId: string;
  personnelId: string;
  personnelName: string;
  entraObjectId?: string;
  triggerTime: string;
  completionTime: string;
  attestor: string;
  steps: OffboardingStep[];
  slaStatus: 'pass' | 'fail';
  generator: { tool: 'offboarding_wizard'; version: string };
  metadata: Record<string, unknown>;
}

export const OFFBOARDING_STEPS: { id: string; label: string }[] = [
  { id: 'disable-entra-account', label: 'Disable Entra ID Account' },
  { id: 'revoke-active-sessions', label: 'Revoke Active Sessions' },
  { id: 'revoke-device-access', label: 'Revoke Device Access' },
  { id: 'remove-group-memberships', label: 'Remove Group Memberships' },
  { id: 'unassign-licenses', label: 'Unassign Licenses' },
  { id: 'cui-access-review', label: 'CUI Access Review (30-day lookback)' },
];
