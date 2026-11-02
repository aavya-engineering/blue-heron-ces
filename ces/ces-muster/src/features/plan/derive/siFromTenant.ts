// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// siFromTenant.ts — MG-13: SI values read off the tenant's own configuration.
// The tenant facts arrive as facts on TCP plan-input nodes: the harvest
// prefill (muster-api harvestService TENANT_PROBES, provenance auto_detected,
// source `graph:<probe>`) or the operator's answer. A value drawn from a
// discovered fact carries `derived:si:discovery:<source>` (SITAnswer
// system_observation); from an asked one, `derived:si:tcp:<field>`
// (client_assertion). Pure: reads facts only.
import type { InterviewFact } from '@/shared/types/engagement';

export interface TenantSourcedValue {
  value: string;
  factProvenance: string;
  sitProvenance: 'system_observation' | 'client_assertion';
}

/** The last explicit fact for a question ("I'm not sure" is not an answer). */
export function lastFact(facts: InterviewFact[] | null | undefined, questionId: string): InterviewFact | null {
  const list = facts ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    if (f.question_id === questionId && f.confidence !== 'unknown') return f;
  }
  return null;
}

/** Provenance for an SI value drawn from a TCP-node fact. */
export function tenantSourced(f: InterviewFact, tcpField: string, value: string): TenantSourcedValue {
  if (f.provenance === 'auto_detected') {
    return { value, factProvenance: `derived:si:discovery:${f.source ?? 'harvest'}`, sitProvenance: 'system_observation' };
  }
  return { value, factProvenance: `derived:si:tcp:${tcpField}`, sitProvenance: 'client_assertion' };
}

const MOBILE = /^(ios|ipados|ios\/ipados|android)/i;

/**
 * S-25 mobile device presence from the platforms in scope (TCP.DM.004) and the
 * enrollment type (TCP.DM.001): a mobile platform under BYOD enrollment →
 * byod_and_company; under corporate enrollment → company_managed_only; no
 * mobile platform → no_mobile_devices. Null when no platform list is held.
 */
export function mobilePresence(platformsAnswer: string, enrollment: string | null): string | null {
  const platforms = platformsAnswer.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (platforms.length === 0) return null;
  if (!platforms.some((p) => MOBILE.test(p))) return 'no_mobile_devices';
  return enrollment === 'enroll_only' ? 'byod_and_company' : 'company_managed_only';
}
