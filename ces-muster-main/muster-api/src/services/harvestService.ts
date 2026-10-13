// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// harvestService.ts — Graph probe table + runHarvest.
//
// FCA guardrail (MUST NOT violate):
//   - Absence of evidence never scores as pass.
//   - A failed probe yields NO fact (absence, not 'no') — callers must not
//     treat missing facts as confirmation of compliance.
//   - Harvest facts never flip a question from 'unknown' to 'pass'.
//
// NOT-PROBEABLE probes (documented below, never produce facts):
//   mon-004 (Microsoft Sentinel SIEM): Sentinel is an Azure Monitor/Log Analytics
//     workspace resource exposed via Azure Resource Manager (ARM) API, not via
//     Microsoft Graph API. There is no /sentinel or equivalent endpoint on
//     graph.microsoft.us. Clients must self-report mon-004.
//   dp-002 (TLS in transit): Device compliance policies can require encryption
//     for device storage but do not authoritatively report TLS enforcement for
//     all network paths. No reliable Graph probe exists. Must be self-reported.

import type { GraphClient } from '../lib/graphClient.js';

export interface HarvestFact {
  question_id: string;
  answer: 'yes' | 'no';
  provenance: 'auto_detected';
  confidence: 'high';
  captured_at: string; // ISO 8601
  source: string;      // 'graph:<probe-name>'
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface PagedResponse {
  value: unknown[];
}

function isPaged(v: unknown): v is PagedResponse {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as Record<string, unknown>)['value'])
  );
}

interface CaPolicy {
  state: string;
  grantControls?: { builtInControls?: string[] } | null;
}

function mfaEnforced(policies: unknown[]): boolean {
  return policies.some((p) => {
    const policy = p as CaPolicy;
    return (
      policy.state === 'enabled' &&
      Array.isArray(policy.grantControls?.builtInControls) &&
      policy.grantControls!.builtInControls!.includes('mfa')
    );
  });
}

// ── Probe table ───────────────────────────────────────────────────────────────

type ProbeResult = HarvestFact | HarvestFact[];

interface Probe {
  name: string;
  path: string;
  run(data: unknown, capturedAt: string): ProbeResult;
}

const PROBES: readonly Probe[] = [
  {
    // Conditional Access policies → iam-001 (MFA) and iam-004 (remote access via CA).
    // A policy with state='enabled' and builtInControls includes 'mfa' counts as enforced.
    name: 'conditionalAccess',
    path: '/identity/conditionalAccess/policies',
    run(data, capturedAt): HarvestFact[] {
      const policies = isPaged(data) ? data.value : [];
      const answer: 'yes' | 'no' = mfaEnforced(policies) ? 'yes' : 'no';
      return [
        {
          question_id: 'iam-001',
          answer,
          provenance: 'auto_detected',
          confidence: 'high',
          captured_at: capturedAt,
          source: 'graph:conditionalAccess',
        },
        {
          question_id: 'iam-004',
          answer,
          provenance: 'auto_detected',
          confidence: 'high',
          captured_at: capturedAt,
          source: 'graph:conditionalAccess',
        },
      ];
    },
  },
  {
    // Intune managed devices → ep-001 (MDM enrollment).
    // count > 0 means at least one device is enrolled → 'yes'.
    name: 'intuneDevices',
    path: '/deviceManagement/managedDevices',
    run(data, capturedAt): HarvestFact {
      const devices = isPaged(data) ? data.value : [];
      return {
        question_id: 'ep-001',
        answer: devices.length > 0 ? 'yes' : 'no',
        provenance: 'auto_detected',
        confidence: 'high',
        captured_at: capturedAt,
        source: 'graph:intuneDevices',
      };
    },
  },
  {
    // Device compliance policies → ep-002 (endpoint protection).
    // At least one compliance policy configured → 'yes'.
    name: 'defenderCompliance',
    path: '/deviceManagement/deviceCompliancePolicies',
    run(data, capturedAt): HarvestFact {
      const policies = isPaged(data) ? data.value : [];
      return {
        question_id: 'ep-002',
        answer: policies.length > 0 ? 'yes' : 'no',
        provenance: 'auto_detected',
        confidence: 'high',
        captured_at: capturedAt,
        source: 'graph:defenderCompliance',
      };
    },
  },
];

// ── runHarvest ─────────────────────────────────────────────────────────────────

/**
 * Runs all Graph probes against the given client and returns harvested facts.
 *
 * Probe failures are per-probe non-fatal: a failed probe produces NO fact
 * (absence, not 'no'). FCA guardrail: callers must never treat a missing fact
 * as evidence of compliance.
 *
 * @param client - GraphClient implementation (real or mock).
 * @param now    - Clock injectable for testing; defaults to Date.now.
 */
export async function runHarvest(
  client: GraphClient,
  now: () => Date = () => new Date()
): Promise<HarvestFact[]> {
  const facts: HarvestFact[] = [];
  const capturedAt = now().toISOString();

  for (const probe of PROBES) {
    try {
      const data = await client.get(probe.path);
      const result = probe.run(data, capturedAt);
      if (Array.isArray(result)) {
        facts.push(...result);
      } else {
        facts.push(result);
      }
    } catch {
      // Per-probe non-fatal: a failed probe yields NO fact (absence, not 'no').
      // FCA guardrail: absence of evidence never scores as pass.
    }
  }

  return facts;
}
