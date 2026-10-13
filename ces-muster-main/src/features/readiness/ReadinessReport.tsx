// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// ReadinessReport — G-MUSTER-READINESS-1 M3: the customer readiness report.
// Renders exactly what the payload carries (SPRS now / two-tier gaps / SPRS
// after as a labeled PROJECTION), never recomputes a number (one-SPRS rule:
// derived.* comes from computeSprs via the exporter).
//
// FCA guardrails, rendered not just documented:
//   - every fact line carries its provenance badge; unconfirmed drafts render
//     "UNCONFIRMED DRAFT"; attested facts render the GO-2 M4 record string
//     ("drafted by [source], confirmed by [name] on [date]") verbatim;
//   - sprs_after always carries the word PROJECTION;
//   - the FCA disclaimer footer is unconditional;
//   - the SPRS weights are now the authoritative methodology values (single
//     source: ces-shared sprs-weights/2.0.0, per SPRS-SCORING-METHODOLOGY.md);
//     READINESS-1 M4 is satisfied and the prior "pending BHD validation" banner
//     is retired (2026-07-12).
import type { ReadinessResult } from '@/shared/types/readinessResult';
import { isUnconfirmedDraft, attestationRecord, DRAFT_PROVENANCES } from '@/features/scoring/draftSemantics';
import { RESIDUAL_MUST_HAVE } from '@/features/export/residualMustHave';

function provenanceBadge(provenance: string): string {
  if (provenance === 'auto_detected') return 'AUTO';
  if (provenance === 'captured') return 'CAPTURED';
  if (DRAFT_PROVENANCES.has(provenance)) return 'DRAFT';
  return 'OP';
}

export default function ReadinessReport({ result }: { result: ReadinessResult }) {
  const registryGaps = result.derived.gaps.filter((g) => g.fixable === 'registry');
  const manualGaps = result.derived.gaps.filter((g) => g.fixable === 'manual');
  const facts = result.facts ?? [];

  return (
    <div data-testid="readiness-report">
      <p className="eyebrow" data-testid="sprs-methodology-note">
        SPRS scored per NIST SP 800-171 R2 DoD Assessment Methodology v1.2.1 / 32 CFR 170.24
        (single authoritative table; see SPRS-SCORING-METHODOLOGY.md).
      </p>

      <h3>SPRS now</h3>
      <p data-testid="readiness-report-sprs-now">
        <strong>{result.derived.sprs_now.sprs}</strong> ({result.derived.sprs_now.assessed_count}{' '}
        requirements assessed; only attested or observed non-draft facts count)
      </p>

      <h3>Gaps — remediable by configuration ({registryGaps.length})</h3>
      <table data-testid="readiness-report-registry-gaps">
        <thead>
          <tr><th>Requirement</th><th>Weight</th><th>Fix path (registry set-commands)</th></tr>
        </thead>
        <tbody>
          {registryGaps.map((g) => (
            <tr key={g.requirement_id} data-testid={`gap-registry-${g.requirement_id}`}>
              <td>{g.requirement_id}</td>
              <td>{g.weight}</td>
              <td>{g.fix_entry_ids.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Gaps — collect list ({manualGaps.length})</h3>
      <p className="eyebrow">
        Documents, interviews, records, or attestations that no command can produce.
      </p>
      <table data-testid="readiness-report-manual-gaps">
        <thead>
          <tr><th>Requirement</th><th>Weight</th><th>What to collect</th></tr>
        </thead>
        <tbody>
          {manualGaps.map((g) => (
            <tr key={g.requirement_id} data-testid={`gap-manual-${g.requirement_id}`}>
              <td>{g.requirement_id}</td>
              <td>{g.weight}</td>
              <td>{(RESIDUAL_MUST_HAVE[g.requirement_id] ?? ['Documentary evidence (see assessor)']).join('; ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>SPRS after remediation</h3>
      <p data-testid="readiness-report-sprs-after">
        <strong>{result.derived.sprs_after}</strong> — a PROJECTION, conditional on
        remediating every registry-fixable gap above. Not a score the organization has.
      </p>

      {facts.length > 0 && (
        <>
          <h3>Session facts ({facts.length})</h3>
          <ul data-testid="readiness-report-facts">
            {facts.map((f) => (
              <li key={f.question_id} data-testid={`report-fact-${f.question_id}`}>
                <span className="badge" title={`Provenance: ${f.provenance}`}>
                  {provenanceBadge(f.provenance)}
                </span>{' '}
                {f.question_text} — <strong>{f.answer}</strong>{' '}
                {isUnconfirmedDraft(f) && (
                  <span className="badge badge-risk" data-testid={`report-draft-${f.question_id}`}>
                    UNCONFIRMED DRAFT
                  </span>
                )}
                {f.attestation && (
                  <em data-testid={`report-attestation-${f.question_id}`}>
                    {' '}({attestationRecord(f.attestation)})
                  </em>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <footer className="callout-warning" data-testid="readiness-report-fca-footer">
        Self-assessed readiness indicator — not a certification, not an SPRS submission, and
        not a quote-binding gap report. Discovery evidence plausibly evidences objectives;
        plausibly evidences is not assessor-accepted. Unknown answers never pass; unconfirmed
        drafts never contribute to any score.
      </footer>
    </div>
  );
}