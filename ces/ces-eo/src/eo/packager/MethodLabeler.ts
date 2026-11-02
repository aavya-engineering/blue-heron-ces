// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EO-collection W4.1: NIST SP 800-171A assessment-method labels (examine / test / interview).
//
// Every objective in the shared reference lists all three methods, so the label comes from the
// evidence, not the objective:
// - test      = a live read or a collected record (an evaluator read the tenant now, or a collector
//               read the tenant now): every evidence-store fetch source not listed below. Collected (collect.*) records are examine.
// - examine   = a Stamper evidence file, a policy or disposition, or an evidence-store record of a
//               configuration artefact (CONFIGURATION_SOURCES).
// - interview = personnel, training and screening records (INTERVIEW_SOURCES and the ledger's
//               `personnel` / `training` sources).
// All source-to-method choices are in the two sets below, so a rule change is a one-line edit.

import { deciderOf } from '../assessment/DriftDetector.js';

export type AssessmentMethod = 'examine' | 'test' | 'interview';

/** Evidence-store sources (W1 fetch reads) that hold a configuration artefact: examined, not tested. */
export const CONFIGURATION_SOURCES: ReadonlySet<string> = new Set([
  'conditionalAccess', 'authMethods', 'compliancePolicies', 'dlpLabels', 'authorizationPolicy',
  'namedLocations', 'deviceConfigurations', 'appProtections', 'authStrength', 'agreements',
  'pimPolicies', 'transportRules', 'mailboxAudit', 'retentionPolicies', 'lifecycleWorkflows',
  'crossTenantPolicy', 'adminAuditLogConfig',
  // W5 cycle 5 (SC-3a): the alert policies and the site permissions are configuration artefacts.
  'protectionAlerts', 'sitePermissions',
]);

/** Evidence-store sources that are training or personnel records: the interview method. */
export const INTERVIEW_SOURCES: ReadonlySet<string> = new Set(['trainingUserCoverage']);

/** Synthetic-customer W2: C10's source id and the record endpoint of a confirmed AdminOps apply (adminOpsCollector.ts). */
export const ADMIN_OPS_SOURCE = 'collect.adminOps';
export const ADMIN_OPS_CONFIRMED_APPLY_ENDPOINT = 'adminops_evidence/apply_confirmed';

/**
 * The method an evidence-store record supports, by its source id. A C10 (AdminOps) record is a test
 * when it is an apply with a confirming read (its endpoint says so), else examine (reads, dry runs,
 * unconfirmed applies).
 */
export function methodForStoreSource(sourceId: string, endpoint?: string): AssessmentMethod {
  if (sourceId === ADMIN_OPS_SOURCE) return endpoint === ADMIN_OPS_CONFIRMED_APPLY_ENDPOINT ? 'test' : 'examine';
  if (INTERVIEW_SOURCES.has(sourceId)) return 'interview';
  if (CONFIGURATION_SOURCES.has(sourceId)) return 'examine';
  // NIST SP 800-171A: collected log and alert records are records an assessor reviews (examine); only a live read
  // that exercises the mechanism now is a test. Plan section 5 table; orchestrator decision 2026-10-28.
  if (sourceId.startsWith('collect.') || LOG_RECORD_SOURCES.has(sourceId)) return 'examine';
  return 'test';
}

/** Live reads whose payload is a set of log or alert records (not a mechanism exercised now): examined like
 *  collected records (NIST SP 800-171A; orchestrator decision 2026-10-28). */
export const LOG_RECORD_SOURCES = new Set<string>(['signInLogs', 'directoryAudits', 'securityAlerts', 'securityIncidents', 'riskDetections',
  // W5 cycle 5 (SC-3a): malware detections, remote wipe / retire actions and their audit events, terms-of-use
  // acceptances and access review decisions are records an assessor reviews.
  'windowsMalwareInformation', 'remoteActionAudits', 'intuneWipeAuditEvents', 'touAcceptances', 'accessReviews']);

/** A Stamper evidence file is a record of a configuration artefact: examine. */
export const STAMPER_FILE_METHOD: AssessmentMethod = 'examine';

export interface ObjectiveMethodInput {
  /** The ledger objective's source (`DeterminationSource`). */
  source: string;
  /** The control's `statusRationale` in the snapshot (digital-signal objectives only). */
  statusRationale?: string;
  /** Evidence-store source ids behind the objective. */
  storeSourceIds?: string[];
  /** True when Stamper evidence files sit behind the objective's control. */
  hasStamperFiles?: boolean;
}

/**
 * The method label of one ledger objective, or undefined when nothing stands behind it.
 * - personnel / training → interview; policy / disposition → examine; tenant-suite → test.
 * - digital-signal: the deciding tier (`Tier n … decides: <type>/<result>`): Tier 2 (live read) → test;
 *   Tier 3 decided by an AdminOps execution (a confirmed apply, AD-6) → test;
 *   Tier 1, 3, 4 (Stamper evidence) and Tier 5 (EO blob) → examine. With no deciding tier: from the
 *   evidence present (any test-kind store record → test; else the first store record's method; else a
 *   Stamper file → examine).
 * - none, or a digital-signal objective with no tier and no evidence → undefined (no label).
 */
export function methodForObjective(input: ObjectiveMethodInput): AssessmentMethod | undefined {
  switch (input.source) {
    case 'personnel':
    case 'training':
      return 'interview';
    case 'policy':
    case 'disposition':
      return 'examine';
    case 'tenant-suite':
      return 'test';
    case 'digital-signal': {
      const { tier, source } = deciderOf(input.statusRationale);
      if (tier === 2) return 'test';
      // Synthetic-customer W2 (AD-6): a Tier 3 AdminOps source exists only for an apply with a confirming read.
      if (tier === 3 && source !== null && source.startsWith('adminops_execution/')) return 'test';
      if (tier !== null) return 'examine';
      const store = (input.storeSourceIds ?? []).map((s) => methodForStoreSource(s));
      if (store.includes('test')) return 'test';
      if (store.length > 0) return store[0];
      return input.hasStamperFiles ? STAMPER_FILE_METHOD : undefined;
    }
    default:
      return undefined;
  }
}
