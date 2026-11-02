// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discoveryEnvelope.ts — GP-DEMO-2: minimal readiness-result.v1 envelope
// assembly for `mu discovery --sim`, mirroring the SPA's buildReadinessResult
// (src/features/export/readinessResultService.ts). The SPA builder is
// Dexie-session + browser-DOM coupled (session/party/engagement records,
// URL.createObjectURL) and cannot import cleanly into this Node CLI, so this
// module replicates ONLY the envelope shape plus the schema-required derived
// (SPRS) block — reusing the real, unforked muster-api SPRS calculator
// (services/sprsCalc.ts) so the score is never fabricated or re-derived
// differently. Every observation field is passed through verbatim from the
// DISCOVERY-1 executor (discoveryService.runDiscovery); this module adds no new
// discovery logic, only envelope plumbing + schema validation.
import Ajv from 'ajv';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { computeSprs } from './sprsCalc.js';
import type { DiscoveryObservation, CaptureSink } from './discoveryService.js';

// Anchor the schema to THIS module's location, not process.cwd() — the CLI is
// spawned from arbitrary cwds (ces-tester's eval leg runs it from its own
// root, where a cwd-relative '..' resolved to the WRONG public/). From
// muster-api/{src|dist}/services the ces-muster repo root is 3 levels up in
// both layouts, so this is stable for tsx (src) and compiled (dist) runs.
const SCHEMA_PATH = resolve(__dirname, '..', '..', '..', 'public', 'schemas', 'readiness-result.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
const ajvValidate = new Ajv({ strict: true }).compile(schema);

export const ENGINE = { name: 'muster-discovery-cli', version: '0.1.0' };
// Same dataset id the SPA readinessResultService.ts uses (COVERAGE_DATASET) —
// there is only one coverage dataset in play; mirrored here, not re-chosen.
export const COVERAGE_DATASET = 'registry-objective-coverage-2026-07-10';

const POSTURE_RANK: Record<string, number> = { met: 0, unknown: 1, partial: 2, not_met: 3 };

/**
 * Worst-posture-wins aggregation of possibly-duplicate control_id rows into one
 * requirement status each, before scoring. Mirrors the SPA's requirementStatuses
 * conservative rule ("most conservative sticks": not_met beats everything, an
 * unknown/partial downgrades a met, met never upgrades anything) — necessary
 * because a control can be covered by more than one registry entry, and
 * computeSprs expects one row per requirement.
 */
function aggregatePostures(
  observations: DiscoveryObservation[]
): Array<{ requirement_id: string; status: string }> {
  const worst = new Map<string, string>();
  for (const o of observations) {
    const prev = worst.get(o.control_id);
    if (prev === undefined || POSTURE_RANK[o.derived_posture] > POSTURE_RANK[prev]) {
      worst.set(o.control_id, o.derived_posture);
    }
  }
  return [...worst.entries()].map(([requirement_id, status]) => ({ requirement_id, status }));
}

export interface BuildDiscoveryReadinessResultInput {
  observations: DiscoveryObservation[];
  slug: string;
  startedAt: string;
  completedAt: string;
  registryVersions: Record<string, string>;
  /**
   * FC-MU-2: present only for a LIVE run (liveDiscoveryRun). The manifest then
   * says tenant.kind 'live', auth_tier 'device-code', names the engagement, and
   * records the customer's consent. Absent → the sim envelope, unchanged.
   */
  live?: {
    engagementId: string;
    consent: EnvelopeConsent;
    /** FC-MU-3 (1.1.0): every area consent the run used. */
    consents?: EnvelopeConsent[];
  };
}

/** A live device-code consent as the readiness record carries it. */
export interface EnvelopeConsent {
  consented_by: string;
  consented_at: string;
  scopes: string[];
  tenant_id: string;
  auth_tier: 'device-code';
  client_id?: string;
  /** FC-MU-3: the area the consent covers. */
  area?: 'graph' | 'exchange' | 'purview' | 'azure' | 'teams';
  /** FC-MU-5: the reader roles proven at consent time. */
  reader_roles?: string[];
  /** FC-MU-5: the Azure subscription the reader check covered. */
  subscription_id?: string;
}

/**
 * Assemble + schema-validate the readiness-result.v1 envelope for a CLI
 * discovery-only run. There is no interview session behind a CLI run, so
 * `facts[]` (optional per schema) is omitted entirely rather than fabricated.
 */
export function buildDiscoveryReadinessResult(input: BuildDiscoveryReadinessResultInput): unknown {
  const rows = aggregatePostures(input.observations);
  const sprsNow = computeSprs(rows);

  // No REGISTRY_FIX_PATHS data at this layer (an SPA-only fixture module) — every
  // gap is conservatively 'manual' (never claim a registry fix without evidence),
  // so sprs_after (the same calculator re-run with registry-fixable gaps flipped
  // to met) equals sprs_now here: there are no registry-fixable gaps to flip.
  const gaps = sprsNow.deductions.map((d) => ({
    requirement_id: d.requirement_id,
    weight: d.weight,
    fix_entry_ids: [] as string[],
    fixable: 'manual' as const,
  }));

  const result = {
    // FC-MU-3: the current record version (the SPA importer also takes 1.0.0).
    schema_version: 'readiness-result/1.1.0',
    manifest: input.live
      ? {
          mode: 'independent',
          auth_tier: 'device-code',
          tenant: { slug: input.slug, kind: 'live' },
          operator: { name: 'muster-api', role: 'live-discovery' },
          engagement_id: input.live.engagementId,
          party_id: `mu-discovery-${input.slug}`,
          engagement_kind: 'prime_and_subs',
          started_at: input.startedAt,
          completed_at: input.completedAt,
          consent: input.live.consent,
          ...(input.live.consents && input.live.consents.length > 0 ? { consents: input.live.consents } : {}),
        }
      : {
          mode: 'independent',
          auth_tier: 'cert-app-only',
          tenant: { slug: input.slug, kind: 'sim' },
          operator: { name: 'ces-tester', role: 'orchestrator' },
          engagement_id: `mu-discovery-${input.slug}`,
          party_id: `mu-discovery-${input.slug}`,
          engagement_kind: 'prime_and_subs',
          started_at: input.startedAt,
          completed_at: input.completedAt,
        },
    observations: input.observations,
    derived: {
      sprs_now: sprsNow,
      gaps,
      sprs_after: sprsNow.sprs,
    },
    provenance: {
      registry_versions: input.registryVersions,
      coverage_dataset: COVERAGE_DATASET,
      engine: ENGINE,
      generated_at: input.completedAt,
    },
  };

  const valid = ajvValidate(result);
  if (!valid) {
    throw new Error(`discovery readiness-result failed schema validation: ${JSON.stringify(ajvValidate.errors)}`);
  }
  return result;
}

/**
 * Disk-backed CaptureSink: persists raw command stdout under
 * <outDir>/captures/ and returns a relative pointer. Raw output is NEVER
 * inlined into an observation — discoveryService.ts's runDiscovery already
 * enforces that at the call site; this is just where the pointer resolves to.
 */
export function fileCaptureSink(outDir: string): CaptureSink {
  return {
    write(entryId: string, stdout: string): string {
      const safe = entryId.replace(/[^a-zA-Z0-9._-]/g, '_');
      const rel = join('captures', `${safe}.txt`);
      writeFileSync(join(outDir, rel), stdout, 'utf-8');
      return rel.replace(/\\/g, '/');
    },
  };
}
