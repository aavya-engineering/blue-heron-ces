// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { PolicyDocument } from 'ces-shared/types/policy';
import type { PhysicalSecurityData } from '../../shared/types/ssp.types.js';
import type { TrainingStore } from '../personnel/TrainingStore.js';
import type { ScreeningElementStore } from '../personnel/ScreeningElementStore.js';

/**
 * Extraction helpers for manual gate controls.
 * Each extractor attempts to pull data from available stores/manifests
 * and returns a narrative + sources, or null if insufficient data.
 */
export class ManualGateExtractors {

  static extractTrainingNarrative(
    controlId: string,
    trainingStore: TrainingStore,
    tenantSlug: string
  ): { narrative: string; sources: string[] } | null {
    try {
      const catalog = trainingStore.loadCatalog(tenantSlug);
      if (!catalog || !catalog.courses || catalog.courses.length === 0) return null;

      const courseNames = catalog.courses.map(c => c.title).join(', ');

      return {
        narrative: `Security awareness training program established with ${catalog.courses.length} required courses: ${courseNames}. Training compliance tracked via Evidence Ops Personnel Card. See Appendix G (Training Matrix) for detailed completion records.`,
        sources: ['Training catalog', 'Training completion records'],
      };
    } catch {
      return null;
    }
  }

  static extractScreeningNarrative(
    controlId: string,
    screeningStore: ScreeningElementStore,
    tenantSlug: string,
    personnelIds: string[]
  ): { narrative: string; sources: string[] } | null {
    if (!personnelIds || personnelIds.length === 0) return null;

    try {
      let clearedCount = 0;
      const total = personnelIds.length;

      for (const personId of personnelIds) {
        const readiness = screeningStore.getReadiness(tenantSlug, personId);
        if (readiness && readiness.packageComplete) {
          clearedCount++;
        }
      }

      return {
        narrative: `Personnel screening conducted per 7-element framework. ${clearedCount}/${total} personnel cleared. Elements verified: E1-E7 (employment history, education, references, identity, criminal history, credit check, AO sign-off). See Appendix F (Screening Ledger) for detailed records.`,
        sources: ['Screening element records', 'AO determinations'],
      };
    } catch {
      return null;
    }
  }

  static extractPhysicalSecurityNarrative(
    controlId: string,
    physicalSecurity: PhysicalSecurityData
  ): { narrative: string; sources: string[] } | null {
    if (!physicalSecurity) return null;

    return {
      narrative: `Physical security controls implemented at ${physicalSecurity.facilityType}. Access controls: ${physicalSecurity.accessControls.join(', ')}. Visitor management: ${physicalSecurity.visitorManagement}. Additional notes: ${physicalSecurity.notes}`,
      sources: ['Infrastructure manifest physical security section'],
    };
  }

  static extractMaintenanceNarrative(
    controlId: string,
    policies: PolicyDocument[]
  ): { narrative: string; sources: string[] } | null {
    const maPolicy = policies.find(p => p.domain === 'MA');
    if (!maPolicy) return null;

    const excerpt = maPolicy.markdown.substring(0, 300);
    return {
      narrative: `Maintenance procedures defined in MA policy: ${excerpt}... See Appendix E for full MA policy document.`,
      sources: [maPolicy.title],
    };
  }

  static extractIncidentResponseNarrative(
    controlId: string,
    policies: PolicyDocument[]
  ): { narrative: string; sources: string[] } | null {
    const irPolicy = policies.find(p => p.domain === 'IR' || p.template_id === 'irp');
    if (!irPolicy) return null;

    const excerpt = irPolicy.markdown.substring(0, 300);
    // Try to extract escalation path from markdown
    const escalationMatch = irPolicy.markdown.match(/escalat[^.]*\./i);
    const escalationPath = escalationMatch ? escalationMatch[0] : 'See IRP for escalation procedures';

    return {
      narrative: `Incident response procedures defined in IRP: ${excerpt}... Escalation path: ${escalationPath}. See Appendix E for full IR policy.`,
      sources: [irPolicy.title],
    };
  }

  static extractPolicyBasedNarrative(
    family: string,
    policies: PolicyDocument[]
  ): { narrative: string; sources: string[] } | null {
    const policy = policies.find(p => p.domain.toUpperCase() === family.toUpperCase());
    if (!policy) return null;

    const excerpt = policy.markdown.substring(0, 300);
    return {
      narrative: `Policy-based implementation: ${excerpt}... See Appendix E for full ${family} policy document.`,
      sources: [policy.title],
    };
  }
}
