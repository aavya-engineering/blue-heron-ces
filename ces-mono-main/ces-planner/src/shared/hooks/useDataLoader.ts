// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useEffect, useState } from 'react';
import { dataLoader } from '../services/dataLoader';
import type { SIQuestionBank, RRQuestionBank } from '../types/questions';
import type {
  CMMCRequirementsStore,
  EvidenceArchetypeCatalog,
  AssessorKnowledgeBase,
  EvidenceMatrix,

  CapabilityTaxonomy,
  ImplementationPatterns,
  VendorPlaybook,
  TechRefCMMCL2,
} from '../types/domain';
import type { GlossaryData, HelpOverlay } from '../types/help';

interface UseDataLoaderState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  fromCache: boolean;
}

function useDataLoader<T>(
  loader: () => Promise<{ data: T; fromCache: boolean; loadedAt: string }>,
  key: string // Add a stable key to prevent re-renders
): UseDataLoaderState<T> {
  const [state, setState] = useState<UseDataLoaderState<T>>({
    data: null,
    loading: true,
    error: null,
    fromCache: false,
  });

  useEffect(() => {
    let mounted = true;

    loader()
      .then((result) => {
        if (mounted) {
          setState({
            data: result.data,
            loading: false,
            error: null,
            fromCache: result.fromCache,
          });
        }
      })
      .catch((error) => {
        if (mounted) {
          console.error(`[useDataLoader] Failed to load ${key}:`, error);
          setState({
            data: null,
            loading: false,
            error: error as Error,
            fromCache: false,
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, [key]); // Use stable key instead of loader function

  return state;
}

export function useSIQuestionBank(): UseDataLoaderState<SIQuestionBank> {
  return useDataLoader(() => dataLoader.loadSIQuestionBank(), 'SI_QUESTION_BANK');
}

export function useRRQuestionBank(): UseDataLoaderState<RRQuestionBank> {
  return useDataLoader(() => dataLoader.loadRRQuestionBank(), 'RR_QUESTION_BANK');
}

export function useCMMCRequirements(): UseDataLoaderState<CMMCRequirementsStore> {
  return useDataLoader(() => dataLoader.loadCMMCRequirements(), 'CMMC_REQUIREMENTS');
}

export function useEvidenceArchetypes(): UseDataLoaderState<EvidenceArchetypeCatalog> {
  return useDataLoader(() => dataLoader.loadEvidenceArchetypes(), 'EVIDENCE_ARCHETYPES');
}

export function useAssessorKB(): UseDataLoaderState<AssessorKnowledgeBase> {
  return useDataLoader(() => dataLoader.loadAssessorKB(), 'ASSESSOR_KB');
}

export function useEvidenceMatrix(): UseDataLoaderState<EvidenceMatrix> {
  return useDataLoader(() => dataLoader.loadEvidenceMatrix(), 'EVIDENCE_MATRIX');
}


export function useCapabilityTaxonomy(): UseDataLoaderState<CapabilityTaxonomy> {
  return useDataLoader(() => dataLoader.loadCapabilityTaxonomy(), 'CAPABILITY_TAXONOMY');
}

export function useImplementationPatterns(): UseDataLoaderState<ImplementationPatterns> {
  return useDataLoader(() => dataLoader.loadImplementationPatterns(), 'IMPLEMENTATION_PATTERNS');
}

export function useVendorPlaybook(): UseDataLoaderState<VendorPlaybook> {
  return useDataLoader(() => dataLoader.loadVendorPlaybook(), 'VENDOR_PLAYBOOK_M365');
}

export function useTechRef(): UseDataLoaderState<TechRefCMMCL2> {
  return useDataLoader(() => dataLoader.loadTechRef(), 'TECH_REF_CMMC_L2');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCUIQuestionBank(): UseDataLoaderState<any> {
  return useDataLoader(() => dataLoader.loadCUIQuestionBank(), 'CUI_QUESTION_BANK');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useBTCQuestionBank(): UseDataLoaderState<any> {
  return useDataLoader(() => dataLoader.loadBTCQuestionBank(), 'BTC_QUESTION_BANK');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useBTCActivationPackage(): UseDataLoaderState<any> {
  return useDataLoader(() => dataLoader.loadBTCActivationPackage(), 'BTC_ACTIVATION_PACKAGE');
}

export function useGlossary(): UseDataLoaderState<GlossaryData> {
  return useDataLoader(() => dataLoader.loadGlossary(), 'GLOSSARY');
}

export function useCUIHelpOverlay(): UseDataLoaderState<HelpOverlay> {
  return useDataLoader(() => dataLoader.loadCUIHelpOverlay(), 'CUI_HELP');
}

export function useBTCHelpOverlay(): UseDataLoaderState<HelpOverlay> {
  return useDataLoader(() => dataLoader.loadBTCHelpOverlay(), 'BTC_HELP');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useTCPQuestionBank(): UseDataLoaderState<any> {
  return useDataLoader(() => dataLoader.loadTCPQuestionBank(), 'TCP_QUESTION_BANK');
}

export function useTCPHelpOverlay(): UseDataLoaderState<HelpOverlay> {
  return useDataLoader(() => dataLoader.loadTCPHelpOverlay(), 'TCP_HELP');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useFedRAMPInheritanceTable(): UseDataLoaderState<any> {
  return useDataLoader(() => dataLoader.loadFedRAMPInheritanceTable(), 'FEDRAMP_INHERITANCE_TABLE');
}
