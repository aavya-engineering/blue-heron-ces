// readiness-result.v1 fixtures — G-MUSTER-READINESS-1 M1 acceptance gate 1.
// Three producer flavors against the ONE schema (the payload IS the import-file
// format; no second format ever): canned fixture, admin-run script upload, and a
// ces-tester run. Entry ids, EMX archetype names, and control ids are real values
// from the Stamper registries / registry-objective-coverage-2026-07-10 dataset.

import type { ReadinessResult } from '@/shared/types/readinessResult';

/** Flavor 1 — canned demo fixture (sim tenant, lite tier, no live commands ran). */
export const READINESS_RESULT_CANNED: ReadinessResult = {
  schema_version: 'readiness-result/1.0.0',
  manifest: {
    mode: 'independent',
    auth_tier: 'lite',
    tenant: { slug: 'stacksim-demo', kind: 'sim' },
    operator: { name: 'Demo Operator', role: 'assessor' },
    engagement_id: 'eng-fixture-1',
    party_id: 'party-fixture-1',
    engagement_kind: 'prime_and_subs',
    started_at: '2026-07-11T10:00:00Z',
    completed_at: '2026-07-11T11:15:00Z',
  },
  observations: [
    {
      control_id: 'AC.L1-3.1.1',
      objective_ids: ['AC.L1-3.1.1[a]', 'AC.L1-3.1.1[b]'],
      confidence: 'medium',
      ran_entry_ids: [],
      derived_posture: 'partial',
      objective_coverage: { 'AC.L1-3.1.1[a]': 'A', 'AC.L1-3.1.1[b]': 'A' },
      residual_must_have: [
        'EMX-IAM-005 (Access review evidence)',
        'EMX-IAM-004 (Joiner-mover-leaver (JML) procedure and samples)',
      ],
    },
    {
      control_id: 'AC.L2-3.1.6',
      objective_ids: ['AC.L2-3.1.6[a]'],
      confidence: 'unknown',
      ran_entry_ids: [],
      derived_posture: 'unknown',
    },
  ],
  derived: {
    sprs_now: {
      sprs: 102,
      assessed_count: 2,
      deductions: [
        { requirement_id: 'AC.L1-3.1.1', weight: 5 },
        { requirement_id: 'AC.L2-3.1.6', weight: 3 },
      ],
    },
    gaps: [
      {
        requirement_id: 'AC.L1-3.1.1',
        weight: 5,
        fix_entry_ids: ['tenant:AC.L2-3.1.1.group-create', 'tenant:AC.L2-3.1.1.member-add'],
        fixable: 'registry',
      },
      { requirement_id: 'AC.L2-3.1.6', weight: 3, fix_entry_ids: [], fixable: 'manual' },
    ],
    sprs_after: 105,
  },
  provenance: {
    registry_versions: { 'cmmc-l2-commands': '2026-07-08', 'infra-commands': '2026-07-08' },
    coverage_dataset: 'registry-objective-coverage-2026-07-10',
    engine: { name: 'muster-canned-fixture', version: '1.0.0' },
    generated_at: '2026-07-11T11:15:05Z',
  },
};

/**
 * Flavor 2 — admin-run script upload (GO-2 M3: script-upload == import-file, one
 * mechanism). Live tenant, script-upload tier, facts with attestation extension.
 */
export const READINESS_RESULT_SCRIPT_UPLOAD: ReadinessResult = {
  schema_version: 'readiness-result/1.0.0',
  manifest: {
    mode: 'self-hosted',
    auth_tier: 'script-upload',
    tenant: { slug: 'vfsgov-xtra', kind: 'live' },
    operator: { name: 'J. Admin', role: 'tenant-admin' },
    engagement_id: 'eng-su-1',
    party_id: 'party-su-1',
    engagement_kind: 'individual_contractor',
    started_at: '2026-07-11T14:00:00Z',
  },
  observations: [
    {
      control_id: 'IA.L2-3.5.3',
      objective_ids: ['IA.L2-3.5.3[a]', 'IA.L2-3.5.3[c]'],
      confidence: 'high',
      ran_entry_ids: ['tenant:AC.L1-3.1.1.ca-policy-evidence'],
      raw_capture_ref: 'captures/su-1/ia-3.5.3-ca-policies.json',
      derived_posture: 'met',
      objective_coverage: { 'IA.L2-3.5.3[a]': 'A', 'IA.L2-3.5.3[c]': 'A' },
    },
  ],
  facts: [
    {
      question_id: 'iam-001',
      question_text: 'Does your org enforce MFA?',
      answer: 'yes',
      provenance: 'discovery-inferred',
      confidence: 'high',
      recorded_at: '2026-07-11T14:20:00Z',
      attestation: {
        drafted_by: 'discovery inference',
        confirmed_by: 'J. Admin',
        confirmed_on: '2026-07-11',
      },
    },
    {
      question_id: 'pol-002',
      question_text: 'Is there a documented access review procedure?',
      answer: 'draft: appears to exist per exported policy list',
      provenance: 'document-extraction',
      confidence: 'medium',
      recorded_at: '2026-07-11T14:25:00Z',
      // Unconfirmed draft: no attestation — must never contribute to a passing score.
    },
  ],
  derived: {
    sprs_now: { sprs: 110, assessed_count: 1, deductions: [] },
    gaps: [],
    sprs_after: 110,
  },
  provenance: {
    registry_versions: { 'cmmc-l2-commands': '2026-07-08' },
    coverage_dataset: 'registry-objective-coverage-2026-07-10',
    engine: { name: 'muster-script-upload', version: '0.1.0' },
    generated_at: '2026-07-11T14:30:00Z',
  },
};

/** Flavor 3 — ces-tester run (sim tenant, cert-app-only tier, tester as engine). */
export const READINESS_RESULT_TESTER: ReadinessResult = {
  schema_version: 'readiness-result/1.0.0',
  manifest: {
    mode: 'independent',
    auth_tier: 'cert-app-only',
    tenant: { slug: 'stacksim-local', kind: 'sim' },
    operator: { name: 'ces-tester', role: 'orchestrator' },
    engagement_id: 'eng-tester-m2',
    party_id: 'party-tester-m2',
    engagement_kind: 'prime_and_subs',
    started_at: '2026-07-11T16:29:13Z',
    completed_at: '2026-07-11T16:33:34Z',
  },
  observations: [
    {
      control_id: 'CM.L2-3.4.1',
      objective_ids: ['CM.L2-3.4.1[a]'],
      confidence: 'high',
      ran_entry_ids: ['infra:AZ-ID-001', 'infra:AZ-ID-002'],
      raw_capture_ref: 'runs/m2/captures/cm-3.4.1.json',
      derived_posture: 'met',
      objective_coverage: { 'CM.L2-3.4.1[a]': 'A' },
    },
    {
      control_id: 'RA.L2-3.11.1',
      objective_ids: ['RA.L2-3.11.1[a]'],
      confidence: 'unknown',
      ran_entry_ids: [],
      derived_posture: 'unknown',
      residual_must_have: ['EMX-GRC-001 (Risk assessment report)'],
    },
  ],
  derived: {
    sprs_now: {
      sprs: 107,
      assessed_count: 2,
      deductions: [{ requirement_id: 'RA.L2-3.11.1', weight: 3 }],
    },
    gaps: [
      { requirement_id: 'RA.L2-3.11.1', weight: 3, fix_entry_ids: [], fixable: 'manual' },
    ],
    sprs_after: 107,
  },
  provenance: {
    registry_versions: { 'cmmc-l2-commands': '2026-07-08', 'infra-commands': '2026-07-08' },
    coverage_dataset: 'registry-objective-coverage-2026-07-10',
    engine: { name: 'ces-tester', version: '0.1.0' },
    generated_at: '2026-07-11T16:33:35Z',
  },
};
