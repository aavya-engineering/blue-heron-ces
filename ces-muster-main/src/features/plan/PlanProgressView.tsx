// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// PlanProgressView.tsx — FX-MU2: directive progress on the Plan tab, from the
// results Stamper sent back (muster-api GET /api/plan/status). Pure props-in
// view so it renders the same in the browser and in node tests.
//
// Score disclosure (REQ-MUSTER-SCORE-DISCLOSURE): verdict words and counts of
// directives only — never an SPRS number.
import type { DirectiveProgress } from './planPushService';

const VERDICT_LABEL: Record<string, string> = {
  sat: 'Satisfied',
  not_sat: 'Not satisfied',
  provisional: 'Provisional',
  not_applicable: 'Not applicable',
};

export default function PlanProgressView({ progress }: { progress: DirectiveProgress }) {
  const { counts, total } = progress;
  const done = total - counts.pending;
  return (
    <div data-testid="plan-progress" style={{ marginTop: 16 }}>
      <p data-testid="plan-progress-summary">
        Stamper progress: {done} of {total} directives reported
        {progress.runId ? ` (run ${progress.runId})` : ''} — {counts.sat} satisfied,{' '}
        {counts.not_sat} not satisfied, {counts.provisional} provisional,{' '}
        {counts.not_applicable} not applicable, {counts.pending} pending.
      </p>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Control</th>
              <th>Directive</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {progress.directives.map((d) => (
              <tr key={d.control_id} data-testid={`plan-progress-row-${d.control_id}`}>
                <td>{d.control_id}</td>
                <td>{d.directive}</td>
                <td data-testid={`plan-progress-verdict-${d.control_id}`}>
                  {d.verdict ? VERDICT_LABEL[d.verdict] ?? d.verdict : 'Pending'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
