// M3 — canned Discovery results fixture (no live engine, M7 out of scope).
// Rows mirror the shape of registry-objective-coverage-2026-07-10.json and
// plausibly overlap the mapped_requirements values in questionGraph.ts's
// 25-node QUESTION_GRAPH, spanning identity/endpoint/policy clusters.
// At least one 'unknown' row is present to exercise both FCA clauses
// (never-prunes at factCoveragePruner, never-passes-to-met at sprsCalc).
// READINESS-1 M2: the type now lives in shared/types/discovery.ts (one model);
// re-exported here so every existing `from '@/__fixtures__/discoveryResults'`
// type import keeps working.
export type { DiscoveryResult } from '@/shared/types/discovery';
import type { DiscoveryResult } from '@/shared/types/discovery';

export const DISCOVERY_RESULTS_FIXTURE: DiscoveryResult[] = [
  // ── Identity / Access Management ─────────────────────────────────────────
  { control_id: 'AC.L2-3.1.13', objective_ids: ['AC.L2-3.1.13[a]'], confidence: 'high' },
  { control_id: 'IA.L2-3.5.3', objective_ids: ['IA.L2-3.5.3[a]'], confidence: 'high' },
  { control_id: 'AC.L1-3.1.1', objective_ids: ['AC.L1-3.1.1[a]', 'AC.L1-3.1.1[b]'], confidence: 'medium' },
  { control_id: 'AC.L1-3.1.2', objective_ids: ['AC.L1-3.1.2[a]'], confidence: 'medium' },
  { control_id: 'AC.L2-3.1.6', objective_ids: ['AC.L2-3.1.6[a]'], confidence: 'unknown' },
  // ── Endpoint Management ───────────────────────────────────────────────────
  { control_id: 'CM.L2-3.4.1', objective_ids: ['CM.L2-3.4.1[a]'], confidence: 'high' },
  { control_id: 'CM.L2-3.4.2', objective_ids: ['CM.L2-3.4.2[a]'], confidence: 'high' },
  { control_id: 'SI.L1-3.14.1', objective_ids: ['SI.L1-3.14.1[a]'], confidence: 'medium' },
  { control_id: 'SI.L2-3.14.2', objective_ids: ['SI.L2-3.14.2[a]'], confidence: 'low' },
  // ── Policy / Governance ───────────────────────────────────────────────────
  { control_id: 'CA.L2-3.12.4', objective_ids: ['CA.L2-3.12.4[a]'], confidence: 'medium' },
  { control_id: 'AT.L2-3.2.1', objective_ids: ['AT.L2-3.2.1[a]'], confidence: 'high' },
  { control_id: 'AT.L2-3.2.2', objective_ids: ['AT.L2-3.2.2[a]'], confidence: 'low' },
  { control_id: 'RA.L2-3.11.1', objective_ids: ['RA.L2-3.11.1[a]'], confidence: 'unknown' },
];
