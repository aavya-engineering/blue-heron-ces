// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M3 — Discovery sub-tab: progress/summary view over a discovery run's
// results. W4-MU2 (MU-02): the rows are the REAL run's (passed in by App from
// discoveryRunService — the sim executor via muster-api), no longer the canned
// fixture. Rendering itself makes zero network calls.
//
// GO-2 M1: "Continue" now advances to the boundary confirm/correct step
// (BoundaryConfirmPanel), which owns fact synthesis AND staging — the confirm
// step is the single place the discovery branch writes the localStorage
// handoff, so boundary decisions ride the same write the synthesized facts do.
import type { DiscoveryResult } from '@/shared/types/discovery';

function confidenceBadgeClass(confidence: string): string {
  if (confidence === 'high') return 'badge badge-compliant';
  if (confidence === 'medium') return 'badge badge-review';
  if (confidence === 'low') return 'badge badge-risk';
  return 'badge badge-violation';
}

export default function DiscoverySubTab({
  results,
  onContinue,
}: {
  results: DiscoveryResult[];
  onContinue: () => void;
}) {
  const objectiveCount = results.reduce((n, r) => n + r.objective_ids.length, 0);
  const resolvedCount = results.filter((r) => r.confidence !== 'unknown').length;

  const handleContinue = () => {
    onContinue();
  };

  return (
    <div data-testid="discovery-sub-tab">
      <p data-testid="discovery-summary">
        {resolvedCount} of {results.length} controls resolved · {objectiveCount} objectives covered
      </p>
      <ul>
        {results.map((r) => (
          <li key={r.control_id} data-testid={`discovery-row-${r.control_id}`}>
            <span>{r.control_id}</span>
            <span className={confidenceBadgeClass(r.confidence)}>{r.confidence.toUpperCase()}</span>
            <span>{r.objective_ids.join(', ')}</span>
          </li>
        ))}
      </ul>
      <button
        className="btn btn-primary"
        data-testid="discovery-continue-btn"
        onClick={handleContinue}
      >
        Continue to Interview →
      </button>
    </div>
  );
}
