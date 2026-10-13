// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Shared inputs for fixture generation and comparison. Used by both
// scripts/generate-plan-fixtures.ts and the compare test so they
// cannot drift.
import type { MusterRequirementResult } from '../tenantManifestAdapter';
import { sitAnswers } from './planTestSupport';

export const FIXTURE_RESULTS: MusterRequirementResult[] = [
  { requirement_id: 'AC.L2-3.1.1', status: 'not_met' },
  { requirement_id: 'IA.L2-3.5.3', status: 'not_met' },
  { requirement_id: 'AU.L2-3.3.1', status: 'met' },
];

export const FIXTURE_SIT_ANSWERS = sitAnswers({ deploymentPosture: 'cloud_only' });

export const FROZEN_TIME = new Date('2026-01-15T00:00:00.000Z').getTime();

export function freezeEntropy(): { restore: () => void } {
  const realDateNow = Date.now;
  const realRandom = Math.random;
  const RealDate = globalThis.Date;

  let callCount = 0;
  function seededRandom(): number {
    callCount++;
    const x = Math.sin(0.42 * callCount) * 10000;
    return x - Math.floor(x);
  }

  // Freeze both Date.now() and new Date()
  const FrozenDate = function (...args: unknown[]) {
    if (args.length === 0) {
      return new RealDate(FROZEN_TIME);
    }
    // @ts-expect-error — spread into Date constructor
    return new RealDate(...args);
  } as unknown as DateConstructor;

  // Copy static methods and prototype
  Object.setPrototypeOf(FrozenDate, RealDate);
  Object.defineProperty(FrozenDate, 'prototype', { value: RealDate.prototype });
  FrozenDate.now = () => FROZEN_TIME;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;

  globalThis.Date = FrozenDate;
  Math.random = seededRandom;

  return {
    restore() {
      globalThis.Date = RealDate;
      Date.now = realDateNow;
      Math.random = realRandom;
    },
  };
}

// ── W4-MU1: the Infra Manifest golden (m365_azure + Tenant Config Profile) ──
// A separate compile with its own frozen entropy, so it never perturbs the
// three goldens above (Stamper's tests translate those byte-for-byte).
import type { InterviewFact } from '@/shared/types/engagement';
import type { CompilerBanks } from '../tenantManifestAdapter';
import type { SITAnswer } from '@/vendored/ces-planner/types/siBaseline';

function sit(id: string, value: string): SITAnswer {
  return {
    question_id: id,
    answer_type: 'enum',
    raw_answer: value,
    captured_at: '1970-01-01T00:00:00.000Z',
    provenance_class: 'client_assertion',
  };
}

export const INFRA_FIXTURE_SIT_ANSWERS: Record<string, SITAnswer> = {
  ...sitAnswers({ targetLevel: 'L2', cuiPresence: 'cui_present', deploymentPosture: 'cloud_only' }),
  'S-20': sit('S-20', 'gcc_high'),
  'SIT-020': sit('SIT-020', 'm365_azure'),
  'SIT-021': sit('SIT-021', 'g5'),
};

/** The TCP plan-input answers (tcpPlanInputNodes slug values). */
export const INFRA_FIXTURE_TCP_ANSWERS: Record<string, string> = {
  'TCP.TI.004': 'gcc_high',
  'TCP.LIC.001': 'm365_g5',
  'TCP.IA.004': 'entra_native',
  'TCP.IA.005': 'no',
  'TCP.PA.004': 'yes',
  'TCP.GA.004': 'dynamic',
  'TCP.DM.001': 'azure_ad_join',
};

export const INFRA_FIXTURE_CONTEXT = { orgName: 'Golden Fixture Co', tenantSlug: 'golden-fixture' };

function tcpFacts(): InterviewFact[] {
  return Object.entries(INFRA_FIXTURE_TCP_ANSWERS).map(([question_id, answer]) => ({
    question_id,
    question_text: question_id,
    answer,
    provenance: 'operator_interview',
    confidence: 'high',
    recorded_at: '1970-01-01T00:00:00.000Z',
  }));
}

/**
 * Build the Infra Manifest golden through the production path: the TCP
 * adapter (resolveTenantConfig, as planCompileService wires it) and the one
 * compile. Caller freezes entropy first. Shared by the script and the
 * freshness test so they cannot drift.
 */
export async function buildInfraGolden(banks: CompilerBanks) {
  const { buildPlanArtifacts } = await import('../tenantManifestAdapter');
  const { buildTenantConfigProfile } = await import('../tcpAdapter');
  const artifacts = buildPlanArtifacts(
    {
      sitAnswers: INFRA_FIXTURE_SIT_ANSWERS,
      requirementResults: FIXTURE_RESULTS,
      resolveTenantConfig: (si) =>
        buildTenantConfigProfile(tcpFacts(), banks.tcpQuestionBank!, si, INFRA_FIXTURE_CONTEXT).tenantConfig,
    },
    banks,
  );
  return { infrastructureManifest: artifacts.infrastructureManifest, tenantConfig: artifacts.tenantConfig };
}
