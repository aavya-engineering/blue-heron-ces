// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// readinessResultService.ts — G-MUSTER-READINESS-1 M2: the readiness-result.v1
// exporter, beside statusPayloadService per the goal (same Dexie -> route ->
// score -> build -> download pattern as exportPipeline).
//
// FCA invariants enforced here, not just described:
//   - sprs_now counts ONLY attested/observed non-draft facts (scorableFacts
//     BEFORE routing — the GO-2 D2 discipline).
//   - facts[] in the payload is the TRANSPARENCY surface: it carries every
//     session fact INCLUDING unconfirmed drafts, with their draft provenance
//     strings and (when present) full attestation records — this payload's
//     schema marks drafts as drafts; StatusPayload (which cannot) excludes them.
//   - sprs_after is the SAME calculator re-run with registry-fixable gaps
//     flipped to met: a PROJECTION, labeled by field name and consumed as one.
//   - The built payload is VALIDATED against the published JSON schema before
//     it leaves this module (evidencePackageService precedent) — an invalid
//     readiness result must never download.
import Ajv from 'ajv';
import schema from '../../../public/schemas/readiness-result.schema.json';
import { db } from '@/shared/db/schema';
import type {
  Engagement,
  AssessedParty,
  InterviewSession,
  InterviewFact,
} from '@/shared/types/engagement';
import type {
  ReadinessConsent,
  ReadinessResult,
  ReadinessObservation,
  ReadinessGap,
} from '@/shared/types/readinessResult';
import { READINESS_SCHEMA_CURRENT } from '@/shared/types/readinessResult';
import type { DiscoveryResult } from '@/shared/types/discovery';
import type { QuestionNode } from '@/features/interview/questionGraphService';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { routeFacts } from '@/features/scoring/factRouter';
import { scorableFacts } from '@/features/scoring/draftSemantics';
import { computeSprs } from '@/features/scoring/sprsCalc';
import { REGISTRY_FIX_PATHS, REGISTRY_VERSIONS } from './registryFixPaths';

const ajvValidate = new Ajv({ strict: true }).compile(schema);

export const READINESS_ENGINE = { name: 'muster-readiness-exporter', version: '0.1.0' };
export const COVERAGE_DATASET = 'registry-objective-coverage-2026-07-10';

/**
 * Conservative per-requirement aggregation over routed, scorable facts:
 * a requirement is 'met' only when every contributing answer is 'yes';
 * any 'no' makes it not_met; anything else (unsure/unknown/other) leaves it
 * unknown — and computeSprs deducts for everything that is not 'met'.
 */
export function requirementStatuses(
  facts: InterviewFact[],
  graph: QuestionNode[]
): Array<{ requirement_id: string; status: string }> {
  const nodeMap = new Map(graph.map((n) => [n.id, n]));
  const byReq = new Map<string, string>();
  for (const fact of facts) {
    const reqs = nodeMap.get(fact.question_id)?.mapped_requirements ?? [];
    const status = fact.answer === 'yes' ? 'met' : fact.answer === 'no' ? 'not_met' : 'unknown';
    for (const req of reqs) {
      const prev = byReq.get(req);
      if (prev === 'not_met') continue; // most conservative sticks
      if (status === 'not_met') byReq.set(req, 'not_met');
      else if (status === 'unknown') byReq.set(req, 'unknown'); // downgrades met, keeps unknown
      else byReq.set(req, prev === undefined ? 'met' : prev); // met never upgrades anything
    }
  }
  return [...byReq.entries()].map(([requirement_id, status]) => ({ requirement_id, status }));
}

/**
 * Map thin discovery rows onto observation rows — the FALLBACK path for sessions
 * synthesized from a fixture or a bare results file (no live engine ran):
 * ran_entry_ids is empty and posture is inferred from confidence.
 *
 * When the muster-api discovery executor (DISCOVERY-1) has run, its full
 * observation rows are on the session (discovery_observations) and are used
 * verbatim by `sessionObservations` below — this stub is only for the
 * no-live-engine case it always was.
 */
function observationsFromDiscovery(results: DiscoveryResult[]): ReadinessObservation[] {
  return results.map((r) => ({
    control_id: r.control_id,
    objective_ids: r.objective_ids,
    confidence: r.confidence,
    ran_entry_ids: [],
    // FCA: unknown-confidence rows observe nothing usable — posture unknown.
    derived_posture: r.confidence === 'unknown' ? 'unknown' : 'met',
  }));
}

/**
 * The session's observations for the readiness result: prefer the discovery
 * executor's real rows (ran_entry_ids / raw_capture_ref / executor-derived
 * posture) when a live/sim walk produced them; otherwise fall back to
 * synthesizing them from the thin discovery_results (fixture / results-file
 * sessions). One seam, executor-first — this is the DISCOVERY-1 completion of
 * the "fills ran_entry_ids later" TODO.
 */
function sessionObservations(session: InterviewSession): ReadinessObservation[] {
  if (session.discovery_observations && session.discovery_observations.length > 0) {
    return session.discovery_observations;
  }
  return observationsFromDiscovery(session.discovery_results ?? []);
}

/** FC-MU-3: manifest.consent (the Graph consent, else the first) + consents[] (all). */
function consentFields(consents: ReadinessConsent[]): Pick<ReadinessResult['manifest'], 'consent' | 'consents'> {
  if (consents.length === 0) return {};
  const primary = consents.find((c) => (c.area ?? 'graph') === 'graph') ?? consents[0];
  return { consent: primary, consents };
}

export function buildReadinessResult(
  engagement: Engagement,
  party: AssessedParty,
  session: InterviewSession,
  graph: QuestionNode[]
): ReadinessResult {
  const manifest = session.readiness_manifest;
  if (!manifest) {
    throw new Error(
      'Readiness export requires the Situation-tab manifest capture (mode, auth tier, operator, tenant) — none was recorded on this session.'
    );
  }

  // One-SPRS rule: computeSprs only, over routed SCORABLE facts (drafts excluded
  // before routing so a draft can never shadow a human fact out of the group).
  const routed = routeFacts(scorableFacts(session.facts));
  const rows = requirementStatuses(routed, graph);
  const sprsNow = computeSprs(rows);

  const gaps: ReadinessGap[] = sprsNow.deductions.map((d) => {
    const fixEntryIds = REGISTRY_FIX_PATHS[d.requirement_id] ?? [];
    return {
      requirement_id: d.requirement_id,
      weight: d.weight,
      fix_entry_ids: fixEntryIds,
      fixable: fixEntryIds.length > 0 ? 'registry' : 'manual',
    };
  });

  // sprs_after: SAME calculator, registry-fixable gaps flipped to met. A projection.
  const fixable = new Set(gaps.filter((g) => g.fixable === 'registry').map((g) => g.requirement_id));
  const projectedRows = rows.map((r) =>
    fixable.has(r.requirement_id) ? { ...r, status: 'met' } : r
  );
  const sprsAfter = computeSprs(projectedRows).sprs;

  const result: ReadinessResult = {
    // FC-MU-3: the current record version (1.1.0); the importer also takes 1.0.0.
    schema_version: READINESS_SCHEMA_CURRENT,
    manifest: {
      mode: manifest.mode,
      auth_tier: manifest.auth_tier,
      tenant: { slug: manifest.tenant_slug, kind: manifest.tenant_kind },
      operator: { name: manifest.operator_name, role: manifest.operator_role },
      ...(manifest.bhd_name ? { bhd_presence: { name: manifest.bhd_name } } : {}),
      engagement_id: engagement.id,
      party_id: party.id,
      engagement_kind: engagement.engagement_kind,
      started_at: session.created_at,
      ...(session.completed_at ? { completed_at: session.completed_at } : {}),
      // FC-MU-3: keep the live consents the session was built from. `consent`
      // stays the Graph one (the FC-MU-2 field); `consents` lists every area.
      ...consentFields(session.live_consents ?? []),
    },
    observations: sessionObservations(session),
    // Transparency surface: ALL facts, drafts included, provenance + attestation intact.
    facts: session.facts,
    derived: {
      sprs_now: sprsNow,
      gaps,
      sprs_after: sprsAfter,
    },
    provenance: {
      registry_versions: REGISTRY_VERSIONS,
      coverage_dataset: COVERAGE_DATASET,
      engine: READINESS_ENGINE,
      generated_at: new Date().toISOString(),
    },
  };

  const valid = ajvValidate(result);
  if (!valid) {
    throw new Error(
      `Readiness result failed schema validation: ${JSON.stringify(ajvValidate.errors)}`
    );
  }
  return result;
}

/** Dexie -> build. Returns the payload without downloading — used by tests. */
export async function executeReadinessExport(sessionId: string): Promise<ReadinessResult> {
  const session = await db.interview_sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const party = await db.assessed_parties.get(session.party_id);
  if (!party) throw new Error(`Party not found: ${session.party_id}`);
  const engagement = await db.engagements.get(party.engagement_id);
  if (!engagement) throw new Error(`Engagement not found: ${party.engagement_id}`);
  const graph = await loadQuestionGraph(session.selected_stacks ?? []);
  return buildReadinessResult(engagement, party, session, graph);
}

/** Full wiring: build payload and trigger browser download. */
export async function executeReadinessExportAndDownload(sessionId: string): Promise<void> {
  const payload = await executeReadinessExport(sessionId);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `readiness-result-${payload.manifest.party_id}-${payload.provenance.generated_at.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}