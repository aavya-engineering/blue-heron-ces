// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// compilerBanks.ts — PLAN-2 M2 slice 3 + G-MUSTER-PLAN-3 M0: load the knowledge
// banks the vendored ces-planner compiler chain consumes. All are ALREADY
// vendored in public/knowledge/ (the ces-spine vendoring); this just parses
// them. SPA-only fetch against Vite's static assets — never an API origin (the
// zero-network guardrail holds). Module-cached like knowledgeLoader.
import { load } from 'js-yaml';
import type { CompilerBanks } from './tenantManifestAdapter';
import type { TechRefCMMCL2 } from '@/features/plan/engine/shared/types/domain';
import type { FedRAMPInheritanceTable } from '@/features/plan/engine/mpt/services/fedrampInheritance';
import { SCHEMA_FILES, type SchemaArtifact } from './planValidation';

const BANK_FILES = {
  cmmcRequirements: '/knowledge/domain CES CMMC Fundamental Requirements Store.yaml',
  evidenceMatrix: '/knowledge/domain Assessor Evidence Matrix.yaml',
  assessorKB: '/knowledge/domain Assessor Approach Knowledge Base.yaml',
  evidenceArchetypeCatalog: '/knowledge/domain Evidence Archetype Catalog.yaml',
  patterns: '/knowledge/domain Implementation Patterns.yaml',
  playbook: '/knowledge/vendor playbook Microsoft 365.yaml',
} as const;

// M0: the two stores wired into the compile this milestone. The tech ref is
// JSON (buildTechRefIndex consumes the raw shape); the FedRAMP table is YAML.
const TECH_REF_FILE = '/knowledge/gcc-high-g5-cmmc-2-tech-ref-structured.json';
const FEDRAMP_TABLE_FILE = '/knowledge/fedramp-inheritance-table.yaml';
// M1: the real primed SI Question Bank (sets_its_fields -> si_baseline.*).
const SI_BANK_FILE = '/knowledge/primed SI Question Bank.yaml';
// W4-MU1 (PLAN-3 M3): the primed TCP Question Bank (bindings.tenant_config).
const TCP_BANK_FILE = '/knowledge/primed TCP Question Bank.yaml';
// MG-08: the primed CUI Boundary Question Bank (bindings.manifest/policy).
const CUI_BANK_FILE = '/knowledge/primed CUI Boundary Question Bank.yaml';
// MG-09: the BTC Question Bank and Activation Package (BTC-lite).
const BTC_BANK_FILE = '/knowledge/primed BTC Question Bank.yaml';
const BTC_PACKAGE_FILE = '/knowledge/CES BTC Activation Package.yaml';
/** W3 (MG-27): ODP values for the TM verification expected values (same file as policyDocuments POLICY_BANK_FILE). */
const POLICY_BANK_FILE = '/knowledge/primed Policy Inputs Question Bank.yaml';

let cache: CompilerBanks | null = null;

export async function loadCompilerBanks(): Promise<CompilerBanks> {
  if (cache) return cache;
  const keys = Object.keys(BANK_FILES) as Array<keyof typeof BANK_FILES>;
  const schemaKeys = Object.keys(SCHEMA_FILES) as SchemaArtifact[];
  const [texts, techRef, fedrampText, siBankText, tcpBankText, cuiBankText, schemas, btcBankText, btcPackageText, policyBankText] = await Promise.all([
    Promise.all(keys.map((k) => fetch(BANK_FILES[k]).then((r) => r.text()))),
    fetch(TECH_REF_FILE).then((r) => r.json() as Promise<TechRefCMMCL2>),
    fetch(FEDRAMP_TABLE_FILE).then((r) => r.text()),
    fetch(SI_BANK_FILE).then((r) => r.text()),
    fetch(TCP_BANK_FILE).then((r) => r.text()),
    fetch(CUI_BANK_FILE).then((r) => r.text()),
    // MG-15: the copied Planner schemas for the pre-compile input check.
    Promise.all(schemaKeys.map((k) => fetch(SCHEMA_FILES[k]).then((r) => r.json() as Promise<object>))),
    fetch(BTC_BANK_FILE).then((r) => r.text()),
    fetch(BTC_PACKAGE_FILE).then((r) => r.text()),
    fetch(POLICY_BANK_FILE).then((r) => r.text()),
  ]);
  const banks = {} as Record<keyof typeof BANK_FILES, unknown>;
  keys.forEach((k, i) => {
    banks[k] = load(texts[i]);
  });
  cache = {
    ...(banks as CompilerBanks),
    techRef,
    inheritanceTable: load(fedrampText) as FedRAMPInheritanceTable,
    siQuestionBank: load(siBankText) as CompilerBanks['siQuestionBank'],
    tcpQuestionBank: load(tcpBankText) as CompilerBanks['tcpQuestionBank'],
    cuiQuestionBank: load(cuiBankText) as CompilerBanks['cuiQuestionBank'],
    inputSchemas: Object.fromEntries(schemaKeys.map((k, i) => [k, schemas[i]])) as CompilerBanks['inputSchemas'],
    btcQuestionBank: load(btcBankText),
    btcActivationPackage: load(btcPackageText),
    policyInputsBank: load(policyBankText),
  };
  return cache;
}

export function _resetCompilerBanksCache(): void {
  cache = null;
}
