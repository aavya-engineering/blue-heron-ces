// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect } from 'react';
import { dataLoader } from '@/shared/services/dataLoader';
import type {
  CMMCRequirement,
  EvidenceArchetype,
  AssessorApproach,
  EvidenceMatrixEntry,
  PatternEntry,
  PlaybookEntry,
  CapabilityEntry,
} from '@/shared/types/domain';

export interface RequirementDetails {
  requirement: CMMCRequirement;
  evidenceArchetypes: Map<string, EvidenceArchetype>;
  assessorApproach: AssessorApproach | null;
  evidenceMatrix: EvidenceMatrixEntry | null;
  implementationPatterns: PatternEntry[];
  vendorPlaybookEntries: PlaybookEntry[];
  capability: CapabilityEntry | null;
}

/**
 * Loads full requirement details and resolves cross-referenced domain entities.
 */
export function useRequirementDetails(requirementId: string | null) {
  const [details, setDetails] = useState<RequirementDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requirementId) {
      setDetails(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Load all domain data in parallel
        const [
          reqStore,
          archetypeCatalog,
          assessorKB,
          evidenceMatrix,
          implPatterns,
          vendorPlaybook,
          capTaxonomy,
        ] = await Promise.all([
          dataLoader.loadCMMCRequirements(),
          dataLoader.loadEvidenceArchetypes(),
          dataLoader.loadAssessorKB(),
          dataLoader.loadEvidenceMatrix(),
          dataLoader.loadImplementationPatterns(),
          dataLoader.loadVendorPlaybook(),
          dataLoader.loadCapabilityTaxonomy(),
        ]);

        if (cancelled) return;

        // Find the requirement
        const allRequirements =
          reqStore.data.ces?.requirements || reqStore.data.requirements || [];
        const requirement = allRequirements.find((r) => r.requirement_id === requirementId);

        if (!requirement) {
          setError(`Requirement ${requirementId} not found`);
          setLoading(false);
          return;
        }

        // Collect all archetype IDs referenced by this requirement
        const archetypeIds = new Set<string>();
        requirement.assessment_objectives?.forEach((obj) => {
          obj.evidence_archetypes?.forEach((id) => archetypeIds.add(id));
        });
        requirement.design_for_assessment?.forEach((d) => {
          d.evidence_archetypes?.forEach((id) => archetypeIds.add(id));
        });
        requirement.evidence_minimum?.must_have?.forEach((id) => archetypeIds.add(id));
        requirement.evidence_minimum?.nice_to_have?.forEach((id) => archetypeIds.add(id));

        // Build a case-insensitive lookup index for evidence archetypes
        const allArchetypes =
          archetypeCatalog.data.archetypes ||
          archetypeCatalog.data.evidence_archetypes ||
          [];
        const archetypeByUpperId = new Map<string, EvidenceArchetype>();
        for (const a of allArchetypes) {
          archetypeByUpperId.set(a.archetype_id.toUpperCase(), a);
        }

        // Resolve archetype IDs (case-insensitive)
        const archetypeMap = new Map<string, EvidenceArchetype>();
        for (const id of archetypeIds) {
          const found = archetypeByUpperId.get(id.toUpperCase());
          if (found) archetypeMap.set(id, found);
        }

        // Also resolve evidence matrix archetype IDs
        const allMappings = evidenceMatrix.data.mappings || [];
        const matrixEntry =
          allMappings.find((m) => m.requirement_id === requirementId) || null;
        if (matrixEntry) {
          for (const id of matrixEntry.evidence_archetype_ids || []) {
            if (!archetypeMap.has(id)) {
              const found = archetypeByUpperId.get(id.toUpperCase());
              if (found) archetypeMap.set(id, found);
            }
          }
        }

        // Find assessor approach for this requirement
        const allApproaches = assessorKB.data.approaches || [];
        const assessorApproach =
          allApproaches.find((a) => a.requirement_id === requirementId) || null;

        // Find implementation patterns by practice_id
        const practiceId = requirement.references?.cmmc_practice_id;
        const allPatterns = implPatterns.data.patterns || [];
        const patterns = practiceId
          ? allPatterns.filter((p) => p.practice_id === practiceId)
          : [];

        // Find vendor playbook entries matching pattern action IDs
        const patternActionIds = new Set(
          patterns.flatMap((p) => p.actions?.map((a) => a.id) || [])
        );
        const allPlaybookEntries = vendorPlaybook.data.playbook || [];
        const playbookEntries = allPlaybookEntries.filter((e) =>
          patternActionIds.has(e.action_id)
        );

        // Find the capability that contains this practice
        const allCapabilities = capTaxonomy.data.capabilities || [];
        const capability =
          allCapabilities.find((c) =>
            c.practices?.some(
              (p) => p.id === requirementId || p.id === practiceId
            )
          ) || null;

        if (cancelled) return;

        setDetails({
          requirement,
          evidenceArchetypes: archetypeMap,
          assessorApproach,
          evidenceMatrix: matrixEntry,
          implementationPatterns: patterns,
          vendorPlaybookEntries: playbookEntries,
          capability,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load requirement details');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requirementId]);

  return { details, loading, error };
}
