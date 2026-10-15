// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { BTCEvidenceRef } from '@/shared/types/artifacts';
import type { RunlistEntry } from '../types';

/**
 * Evidence location hints per question ID, derived from bank validations and bindings.
 * Questions with bindings.evidence get specific export names; others get generic hints.
 */
const EVIDENCE_HINTS: Record<string, { location: string; binding_key?: string }> = {
  'BTC.ID.001': { location: 'Global Admin export from Entra', binding_key: 'ga_export' },
  'BTC.ID.002': {
    location: 'Privileged role assignments export from Entra/PIM',
    binding_key: 'pim_roles_export',
  },
  'BTC.ID.003': { location: 'Guest account query from Entra' },
  'BTC.ID.004': {
    location: 'Break-glass account config export from Entra/CA',
    binding_key: 'breakglass_doc',
  },
  'BTC.DEV.001': {
    location: 'Enrolled devices export from Intune',
    binding_key: 'device_export',
  },
  'BTC.DEV.002': { location: 'Access log query from Sentinel/Unified Audit' },
  'BTC.DEV.002.CA_ENFORCEMENT_PROOF': {
    location: 'CA policy export from Entra/Conditional Access',
    binding_key: 'ca_policy_export',
  },
  'BTC.DEV.003': { location: 'Device hardening config export from Intune' },
  'BTC.LOG.001': { location: 'Unified Audit Log status query' },
  'BTC.LOG.002': { location: 'Sentinel workspace data source check' },
  'BTC.LOG.003': { location: 'Retention policy config export from Purview/Unified Audit' },
  'BTC.LOG.004': { location: 'Tamper protection config export from Defender/Sentinel' },
  'BTC.DEVOPS.001': { location: 'Repository inventory from Git platform' },
  'BTC.DEVOPS.002': { location: 'Pipeline inventory from CI/CD platform' },
  'BTC.DEVOPS.003': { location: 'Artifact storage check from artifact store' },
  'BTC.INT.001': { location: 'Integration inventory from M365/Azure' },
  'BTC.INT.002': { location: 'Service principal export from Entra' },
  'BTC.INT.003': { location: 'Email forwarding config export from Exchange' },
  'BTC.INT.004': { location: 'Backup configuration from backup platform' },
};

/**
 * Seeds default evidence placeholders for runlist entries that require evidence.
 * Idempotent — skips questions that already have at least one evidence item.
 * Returns only the *new* evidence items to add.
 */
export function seedDefaultEvidence(
  entries: RunlistEntry[],
  existingEvidence: BTCEvidenceRef[],
): BTCEvidenceRef[] {
  const existingByQuestion = new Set(existingEvidence.map((e) => e.question_id));
  const newEvidence: BTCEvidenceRef[] = [];

  for (const entry of entries) {
    if (!entry.evidence_required || !entry.enabled) continue;
    if (existingByQuestion.has(entry.question_id)) continue;

    const hint = EVIDENCE_HINTS[entry.question_id];
    const location = hint?.location ?? `${entry.evidence_type ?? 'evidence'} from ${entry.evidence_source ?? 'source system'}`;
    const sourceSystem = entry.evidence_source ?? 'Unknown';

    newEvidence.push({
      evidence_id: `default-${entry.question_id}`,
      source_system: sourceSystem,
      location,
      hash_sha256: '',
      captured_at: new Date().toISOString(),
      question_id: entry.question_id,
      notes: 'Auto-generated placeholder — replace with actual evidence export.',
    });
  }

  return newEvidence;
}
