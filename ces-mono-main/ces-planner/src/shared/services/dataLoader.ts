// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import yaml from 'js-yaml';
import { dbHelpers } from '../db/schema';
import { validationService } from '../validation/validators';
import type { SIQuestionBank, RRQuestionBank } from '../types/questions';
import type {
  CMMCRequirementsStore,
  EvidenceArchetypeCatalog,
  AssessorKnowledgeBase,
  EvidenceMatrix,
  TechStackMapping,
  CapabilityTaxonomy,
  ImplementationPatterns,
  VendorPlaybook,
  TechRefCMMCL2,
} from '../types/domain';
import type { GlossaryData, HelpOverlay } from '../types/help';

const DATA_BASE_PATH = '/data';

export const DATA_FILES = {
  SI_QUESTION_BANK: 'primed SI Question Bank.yaml',
  RR_QUESTION_BANK: 'primed RR Question Bank.yaml',
  CMMC_REQUIREMENTS: 'domain CES CMMC Fundamental Requirements Store.yaml',
  EVIDENCE_ARCHETYPES: 'domain Evidence Archetype Catalog.yaml',
  ASSESSOR_KB: 'domain Assessor Approach Knowledge Base.yaml',
  EVIDENCE_MATRIX: 'domain Assessor Evidence Matrix.yaml',
  TECH_STACK_MAPPING: 'domain Tech Stack Compliance Mapping.yaml',
  CAPABILITY_TAXONOMY: 'domain Capability Taxonomy.yaml',
  IMPLEMENTATION_PATTERNS: 'domain Implementation Patterns.yaml',
  VENDOR_PLAYBOOK_M365: 'vendor playbook Microsoft 365.yaml',
  TECH_REF_CMMC_L2: 'gcc-high-g5-cmmc-2-tech-ref-structured.json',
  CUI_QUESTION_BANK: 'primed CUI Boundary Question Bank.yaml',
  BTC_QUESTION_BANK: 'primed BTC Question Bank.yaml',
  BTC_ACTIVATION_PACKAGE: 'CES BTC Activation Package.yaml',
  GLOSSARY: 'help Glossary.yaml',
  CUI_HELP: 'help CUI Boundary Guidance.yaml',
  BTC_HELP: 'help BTC Guidance.yaml',
  TCP_QUESTION_BANK: 'primed TCP Question Bank.yaml',
  TCP_HELP: 'help TCP Guidance.yaml',
  FEDRAMP_INHERITANCE_TABLE: 'fedramp-inheritance-table.yaml',
};

export interface DataLoadResult<T> {
  data: T;
  fromCache: boolean;
  loadedAt: string;
}

class DataLoaderService {
  private loadingPromises: Map<string, Promise<DataLoadResult<unknown>>> = new Map();

  async loadSIQuestionBank(): Promise<DataLoadResult<SIQuestionBank>> {
    return this.loadData<SIQuestionBank>(
      'SI_QUESTION_BANK',
      DATA_FILES.SI_QUESTION_BANK,
      'SI_QUESTION_BANK'
    );
  }

  async loadRRQuestionBank(): Promise<DataLoadResult<RRQuestionBank>> {
    return this.loadData<RRQuestionBank>(
      'RR_QUESTION_BANK',
      DATA_FILES.RR_QUESTION_BANK,
      'RR_QUESTION_BANK'
    );
  }

  async loadCMMCRequirements(): Promise<DataLoadResult<CMMCRequirementsStore>> {
    return this.loadData<CMMCRequirementsStore>(
      'CMMC_REQUIREMENTS',
      DATA_FILES.CMMC_REQUIREMENTS,
      'CMMC_REQUIREMENTS'
    );
  }

  async loadEvidenceArchetypes(): Promise<DataLoadResult<EvidenceArchetypeCatalog>> {
    return this.loadData<EvidenceArchetypeCatalog>(
      'EVIDENCE_ARCHETYPES',
      DATA_FILES.EVIDENCE_ARCHETYPES,
      'EVIDENCE_ARCHETYPE_CATALOG'
    );
  }

  async loadAssessorKB(): Promise<DataLoadResult<AssessorKnowledgeBase>> {
    return this.loadData<AssessorKnowledgeBase>(
      'ASSESSOR_KB',
      DATA_FILES.ASSESSOR_KB,
      'ASSESSOR_KB'
    );
  }

  async loadEvidenceMatrix(): Promise<DataLoadResult<EvidenceMatrix>> {
    return this.loadData<EvidenceMatrix>(
      'EVIDENCE_MATRIX',
      DATA_FILES.EVIDENCE_MATRIX,
      'EVIDENCE_MATRIX'
    );
  }

  async loadTechStackMapping(): Promise<DataLoadResult<TechStackMapping>> {
    return this.loadData<TechStackMapping>(
      'TECH_STACK_MAPPING',
      DATA_FILES.TECH_STACK_MAPPING,
      'TECH_STACK_MAPPING'
    );
  }

  async loadCapabilityTaxonomy(): Promise<DataLoadResult<CapabilityTaxonomy>> {
    return this.loadData<CapabilityTaxonomy>(
      'CAPABILITY_TAXONOMY',
      DATA_FILES.CAPABILITY_TAXONOMY,
      'CAPABILITY_TAXONOMY'
    );
  }

  async loadImplementationPatterns(): Promise<DataLoadResult<ImplementationPatterns>> {
    return this.loadData<ImplementationPatterns>(
      'IMPLEMENTATION_PATTERNS',
      DATA_FILES.IMPLEMENTATION_PATTERNS,
      'IMPLEMENTATION_PATTERNS'
    );
  }

  async loadVendorPlaybook(): Promise<DataLoadResult<VendorPlaybook>> {
    return this.loadData<VendorPlaybook>(
      'VENDOR_PLAYBOOK_M365',
      DATA_FILES.VENDOR_PLAYBOOK_M365,
      'VENDOR_PLAYBOOK_M365'
    );
  }

  async loadTechRef(): Promise<DataLoadResult<TechRefCMMCL2>> {
    return this.loadData<TechRefCMMCL2>(
      'TECH_REF_CMMC_L2',
      DATA_FILES.TECH_REF_CMMC_L2,
      'TECH_REF_CMMC_L2'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadCUIQuestionBank(): Promise<DataLoadResult<any>> {
    return this.loadData(
      'CUI_QUESTION_BANK',
      DATA_FILES.CUI_QUESTION_BANK,
      'CUI_QUESTION_BANK'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadBTCQuestionBank(): Promise<DataLoadResult<any>> {
    return this.loadData(
      'BTC_QUESTION_BANK',
      DATA_FILES.BTC_QUESTION_BANK,
      'BTC_QUESTION_BANK'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadBTCActivationPackage(): Promise<DataLoadResult<any>> {
    return this.loadData(
      'BTC_ACTIVATION_PACKAGE',
      DATA_FILES.BTC_ACTIVATION_PACKAGE,
      'BTC_ACTIVATION_PACKAGE'
    );
  }

  async loadGlossary(): Promise<DataLoadResult<GlossaryData>> {
    return this.loadData<GlossaryData>('GLOSSARY', DATA_FILES.GLOSSARY, 'GLOSSARY');
  }

  async loadCUIHelpOverlay(): Promise<DataLoadResult<HelpOverlay>> {
    return this.loadData<HelpOverlay>('CUI_HELP', DATA_FILES.CUI_HELP, 'CUI_HELP');
  }

  async loadBTCHelpOverlay(): Promise<DataLoadResult<HelpOverlay>> {
    return this.loadData<HelpOverlay>('BTC_HELP', DATA_FILES.BTC_HELP, 'BTC_HELP');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadTCPQuestionBank(): Promise<DataLoadResult<any>> {
    return this.loadData(
      'TCP_QUESTION_BANK',
      DATA_FILES.TCP_QUESTION_BANK,
      'TCP_QUESTION_BANK',
    );
  }

  async loadTCPHelpOverlay(): Promise<DataLoadResult<HelpOverlay>> {
    return this.loadData<HelpOverlay>('TCP_HELP', DATA_FILES.TCP_HELP, 'TCP_HELP');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadFedRAMPInheritanceTable(): Promise<DataLoadResult<any>> {
    return this.loadData(
      'FEDRAMP_INHERITANCE_TABLE',
      DATA_FILES.FEDRAMP_INHERITANCE_TABLE,
      'FEDRAMP_INHERITANCE_TABLE',
    );
  }

  private async loadData<T>(
    cacheKey: string,
    fileName: string,
    schemaKey: string
  ): Promise<DataLoadResult<T>> {
    // Check if already loading
    if (this.loadingPromises.has(cacheKey)) {
      return this.loadingPromises.get(cacheKey) as Promise<DataLoadResult<T>>;
    }

    // Start loading
    const loadPromise = this._loadDataInternal<T>(cacheKey, fileName, schemaKey);
    this.loadingPromises.set(cacheKey, loadPromise as Promise<DataLoadResult<unknown>>);

    try {
      const result = await loadPromise;
      return result;
    } finally {
      this.loadingPromises.delete(cacheKey);
    }
  }

  private async _loadDataInternal<T>(
    cacheKey: string,
    fileName: string,
    schemaKey: string
  ): Promise<DataLoadResult<T>> {
    // In dev mode, always re-fetch to pick up YAML changes immediately
    const isQuestionBank = cacheKey.includes('QUESTION_BANK');
    if (!import.meta.env.DEV) {
      // Check cache first (production only)
      const cached = isQuestionBank
        ? await dbHelpers.getQuestionBank(cacheKey)
        : await dbHelpers.getDomainData(cacheKey);

      if (cached && cached.data) {
        return {
          data: cached.data as T,
          fromCache: true,
          loadedAt: cached.loadedAt,
        };
      }
    }

    // Fetch and parse YAML
    const url = encodeURI(`${DATA_BASE_PATH}/${fileName}`);
    console.log(`Fetching ${fileName} from ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${fileName}: ${response.statusText}`);
    }

    const yamlText = await response.text();
    const data = yaml.load(yamlText) as T;

    // Validate against schema if validation service is initialized
    if (validationService) {
      try {
        const validation = validationService.validateDomainData(schemaKey, data);
        if (!validation.valid) {
          console.warn(`Validation warnings for ${fileName}:`, validation.errors);
          // Continue anyway - validation is informational for YAML files
        }
      } catch (error) {
        console.warn(`Could not validate ${fileName}:`, error);
        // Continue anyway
      }
    }

    // Cache in IndexedDB
    const loadedAt = new Date().toISOString();
    const version = (data as { metadata?: { version?: string } }).metadata?.version || '1.0.0';

    if (isQuestionBank) {
      await dbHelpers.setQuestionBank({
        name: cacheKey,
        version,
        data,
        loadedAt,
      });
    } else {
      await dbHelpers.setDomainData({
        name: cacheKey,
        version,
        data,
        loadedAt,
      });
    }

    return {
      data,
      fromCache: false,
      loadedAt,
    };
  }

  async clearCache(): Promise<void> {
    await dbHelpers.clearCache();
    this.loadingPromises.clear();
  }
}

export const dataLoader = new DataLoaderService();
