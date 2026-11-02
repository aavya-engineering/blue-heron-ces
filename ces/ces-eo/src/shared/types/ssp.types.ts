// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Extended SSP types for directive-aware control implementations.
 * Extends the base ControlImplementation from ces-shared/types/ssp
 * with directive-specific fields for SPRS calculation.
 */

import type { ControlImplementation, InfraResource, SystemSecurityPlan, BoundarySection, MissionPlanStep, ObjectiveStatus } from 'ces-shared/types/ssp';
import type { DirectiveType, ExtendedDirectiveMetadata } from './directive.types.js';

/**
 * ControlImplementation with optional directive fields.
 * The base ControlImplementation.status field is preserved for backward compat.
 * sprsValue is a new field distinct from status (status is assessment state,
 * sprsValue is SPRS-specific determination).
 */
export interface DirectiveControlImplementation extends ControlImplementation {
  directive?: DirectiveType;
  directiveMetadata?: ExtendedDirectiveMetadata;
  sprsValue?: 'MET' | 'NOT_MET' | 'N/A';
  sprsRationale?: string;
  /** EVC.5: "manual evidence (unverified)" listing: EC items for this control with their
   *  catalog ids. Kept OUT of `evidenceReferences` so the quality scorecard, SPRS and every
   *  status are unchanged (DEC-7). Omitted when there are none. */
  manualEvidence?: ManualEvidenceEntry[];
  /** W1.2: every source whose verdict disagrees with `status`. Omitted when there are none. */
  contraryEvidence?: ContraryEvidenceEntry[];
  /** W1.4: narrative phrases that negate a met status. Never changes status. Omitted when there are none. */
  consistencyFlags?: ConsistencyFlag[];
  /** Founder decision 2026-10-27: met on a presence-only evaluator's verdict (counted, labelled;
   *  the narrative carries a "Presence only:" sentence). Omitted otherwise. */
  presenceOnly?: true;
  /** W5 cycle 2: the deciding evaluator's evidence sentence, verbatim (met: the basis of the
   *  determination; not met: the finding). Kept out of `implementationNarrative`, so the negation
   *  guard (SC-1) never reads it. Set for met and not met controls only; omitted otherwise. */
  assessmentFinding?: string;
  /** W3.2: objectives with the ledger's provenance (EO-local objective type). */
  assessmentObjectives: EoObjectiveStatus[];
}

/**
 * W3.2: one 800-171A determination with provenance. `source` and `rationale` are the
 * determination ledger's; `statement` is one sentence that never contradicts the control
 * status (B7 (d)). When the ledger's own status for the objective disagrees with the
 * control-consistent status, it is kept in `ledgerStatus` and named in `rationale`.
 */
export interface EoObjectiveStatus extends ObjectiveStatus {
  source?: string;
  rationale?: string;
  statement?: string;
  ledgerStatus?: ObjectiveStatus['status'];
}

export interface ContraryEvidenceEntry {
  sourceKind: string;
  /** Signal id(s) for a live read; the source label for an imported or Stamper source. */
  id: string;
  verdict: 'satisfied' | 'other_than_satisfied';
  read: string;
}

export interface ConsistencyFlag {
  kind: 'narrative-negation';
  phrase: string;
  excerpt: string;
}

export interface ManualEvidenceEntry {
  itemId: string;
  filename: string;
  form_id?: string;
  emx_ids?: string[];
  catalog?: 'validated' | 'unavailable';
  verification: 'unverified';
}

export type { InheritanceSection } from '../../eo/ssp/FedRampInheritanceGenerator.js';

export interface SectionTwoNarrative {
  sectionNumber: string;
  content: string;
}

/** Authorization boundary zone structure for diagram generation */
export interface AuthorizationBoundary {
  zones: Array<{ name: string; description: string; components: string[] }>;
  externalConnections: string[];
}

/** CUI data flow structure for diagram generation */
export interface CuiDataFlows {
  ingress: Array<{ source: string; destination: string; cuiType: string; protocol: string }>;
  egress: Array<{ source: string; destination: string; cuiType: string; protocol: string }>;
  internal: Array<{ source: string; destination: string; cuiType: string }>;
}

/** W2.5: one answer of the TM CUI-boundary questionnaire (`boundary_zones.definitions[]`). Not a zone. */
export interface BoundaryFact {
  key: string;
  value: string;
  type?: string;
}

/** W2.5: a boundary zone built from TM `assets[]`, `tenant_identity` or the IM network. */
export interface EoBoundaryZone {
  name: string;
  type?: string;
  description: string;
  components: string[];
}

/** W2.5 (F10): EO-local boundary section; the ces-shared `BoundarySection` is not edited. */
export interface EoBoundarySection extends BoundarySection {
  zoneDetails?: EoBoundaryZone[];
  cuiBoundaryVersion?: string;
  boundaryFacts?: BoundaryFact[];
}

/** W2.4: one POA&M item as §14 lists it. */
export interface EoPoamSummaryItem {
  control_id: string;
  nist_ref: string;
  weight: number;
  deficiencyDescription: string;
  plannedCorrectiveAction: string;
  responsibleParty: string;
  estimatedCompletionDate: string;
  status: string;
}

/** W2.4: one eligibility blocker (a control that must be MET; it cannot go on the POA&M). */
export interface EoPoamSummaryBlocker {
  control_id: string;
  nist_ref: string;
  weight: number;
  reason: string;
}

/** W2.4: where one ledger-deficient control went: a POA&M item, a blocker, or no POA&M (with the reason). */
export interface EoLedgerPoamDisposition {
  controlId: string;
  deficientObjectives: number;
  snapshotStatus?: string;
  disposition: 'poam_item' | 'blocker' | 'no_poam';
  noPoamReason?: string;
}

/** W2.4 (F10): §14 POA&M summary, EO-local; extends the ces-shared four-field summary. */
export interface EoPoamSummary extends NonNullable<SystemSecurityPlan['poamSummary']> {
  poamId: string;
  generatedAt: string;
  sprsScore: number;
  eligible: boolean;
  scoreThresholdMet: boolean;
  weightRuleMet: boolean;
  prohibitedControlsMet: boolean;
  items: EoPoamSummaryItem[];
  blockers: EoPoamSummaryBlocker[];
  /** Present when the determination ledger was passed: every ledger-deficient control, accounted for. */
  ledgerReconciliation?: {
    ledgerDeficiencies: number;
    deficientControls: number;
    asItems: number;
    asBlockers: number;
    noPoam: number;
    controls: EoLedgerPoamDisposition[];
  };
}

/** W2.5 (F10): EO-local SSP extension; never cast back to the ces-shared type. */
export interface EoSystemSecurityPlan extends SystemSecurityPlan {
  authorizationBoundary: EoBoundarySection;
  /** W2.4: §14, built from the passed POA&M (and ledger). */
  poamSummary?: EoPoamSummary;
  /** W3.5: §8 family overviews with the VPN / wireless claims gated on the SI posture. */
  familyOverviews?: Record<string, string>;
  /** W3.5: each gated overview claim and what the SI posture made of it. */
  familyOverviewGating?: EoOverviewGate[];
}

/** W3.5: one family-overview claim gated on a Strategic-Intent (SI) baseline posture field. */
export interface EoOverviewGate {
  family: string;
  postureField: 'remote_access_posture' | 'wireless_posture';
  posture: string;
  kept: boolean;
  claim: string;
  printed: string;
}

/** W2.2: an MP step as EO reads it; keeps the owner role and effort the ces-shared step type omits. */
export interface EoMissionPlanStep extends MissionPlanStep {
  owner_role?: string;
  estimated_effort_hours?: number;
  effort_estimate?: unknown;
}

/** Type alias for system component (maps to InfraResource) */
export type SystemComponent = InfraResource;

/** Physical security data for PE control narratives */
export interface PhysicalSecurityData {
  facilityType: string;
  accessControls: string[];
  visitorManagement: string;
  notes: string;
}
