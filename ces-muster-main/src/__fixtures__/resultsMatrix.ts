// M6 fixture-only stand-in — NEVER production rendering logic.
// Finding 3: ResultsMatrixArtifact is shaped to match EO's actual output
// (ces-eo/src/eo/ssp/SharedResponsibilityMatrixGenerator.ts, cited in the
// goal's Grounding section) — the minimal shape a real consumed artifact
// would need to satisfy DONE-WHEN #6. ReadinessTab.tsx never hand-builds a
// matrix from raw objective/requirement data; it only ever maps over an
// already-shaped ResultsMatrixArtifact[]. Swappable for a real EO
// import/API call later with zero renderer changes (M7/sibling dependency).
export interface ResultsMatrixArtifact {
  control_id: string;
  objective_id: string;
  status: 'met' | 'not_met' | 'not_assessed';
}

export const RESULTS_MATRIX_FIXTURE: ResultsMatrixArtifact[] = [
  { control_id: 'AC.L2-3.1.13', objective_id: 'AC.L2-3.1.13[a]', status: 'met' },
  { control_id: 'IA.L2-3.5.3', objective_id: 'IA.L2-3.5.3[a]', status: 'met' },
  { control_id: 'AC.L1-3.1.1', objective_id: 'AC.L1-3.1.1[a]', status: 'not_met' },
  { control_id: 'AC.L1-3.1.1', objective_id: 'AC.L1-3.1.1[b]', status: 'not_met' },
  { control_id: 'AC.L2-3.1.6', objective_id: 'AC.L2-3.1.6[a]', status: 'not_assessed' },
  { control_id: 'CM.L2-3.4.1', objective_id: 'CM.L2-3.4.1[a]', status: 'met' },
  { control_id: 'SI.L1-3.14.1', objective_id: 'SI.L1-3.14.1[a]', status: 'not_met' },
  { control_id: 'CA.L2-3.12.4', objective_id: 'CA.L2-3.12.4[a]', status: 'not_assessed' },
  { control_id: 'AT.L2-3.2.1', objective_id: 'AT.L2-3.2.1[a]', status: 'met' },
  { control_id: 'RA.L2-3.11.1', objective_id: 'RA.L2-3.11.1[a]', status: 'not_assessed' },
];
