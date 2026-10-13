// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// BoundaryConfirmPanel — G-MUSTER-GO-2 M1 (rung 1): the confirm/correct UI.
// "Your tenant suggests..." — Muster DRAFTS the CUI boundary from discovery
// footprints and asks for correction, not creation. Zero network calls: the
// drafts come from inferBoundaryDrafts over the in-memory discovery results;
// continuing stages facts through the same localStorage seam the Discovery
// tab already uses (storeDiscoveryFacts -> AssessmentPage mount-effect).
import { useState } from 'react';
import type { DiscoveryResult } from '@/__fixtures__/discoveryResults';
import type { InterviewFact } from '@/shared/types/engagement';
import { synthesizeFactsFromDiscovery } from '@/features/interview/discoveryFactJoin';
import { inferBoundaryDrafts } from '@/features/interview/boundaryInference';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { storeDiscoveryConsents, storeDiscoveryFacts, storeDiscoveryResults } from '@/features/assessment/assessmentHelpers';
import type { ReadinessConsent } from '@/shared/types/readinessResult';
import { processBoundaryDecisions, type BoundaryDecision } from './boundaryConfirm';

const CORRECT_OPTIONS = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
  { label: 'Unsure', value: 'unsure' },
  { label: "I don't know", value: 'unknown' },
];

function decisionBadge(decision: BoundaryDecision | undefined): {
  label: string;
  cls: string;
} {
  if (decision?.kind === 'confirm') return { label: 'CONFIRMED', cls: 'badge badge-compliant' };
  if (decision?.kind === 'correct') return { label: 'CORRECTED', cls: 'badge badge-review' };
  return { label: 'UNCONFIRMED DRAFT', cls: 'badge badge-risk' };
}

export default function BoundaryConfirmPanel({
  results,
  onContinue,
  payloadFacts = [],
  payloadConsents = [],
}: {
  results: DiscoveryResult[];
  onContinue: () => void;
  /** PLAN-2 M1: facts[] from an imported readiness-result payload — staged
   * LAST so a payload row (possibly attested) wins the prefill over a
   * synthesized row for the same question. Provenance preserved verbatim. */
  payloadFacts?: InterviewFact[];
  /** FC-MU-3: the live consents of an imported / API-run readiness record. */
  payloadConsents?: ReadinessConsent[];
}) {
  const [drafts] = useState<InterviewFact[]>(() => inferBoundaryDrafts(results));
  const [decisions, setDecisions] = useState<Record<string, BoundaryDecision>>({});
  const [confirmerName, setConfirmerName] = useState('');
  const [correcting, setCorrecting] = useState<Record<string, boolean>>({});

  const decide = (questionId: string, decision: BoundaryDecision) => {
    setDecisions((prev) => ({ ...prev, [questionId]: decision }));
    setCorrecting((prev) => ({ ...prev, [questionId]: false }));
  };

  const handleContinue = () => {
    const synthesized = synthesizeFactsFromDiscovery(results, QUESTION_GRAPH);
    const boundaryFacts = processBoundaryDecisions(drafts, decisions, confirmerName.trim());
    // PLAN-2 M1: payload facts LAST — within one staged batch the last write
    // wins the prefill maps, so an already-recorded (possibly attested)
    // payload fact overrides a same-question synthesized row.
    storeDiscoveryFacts([...synthesized, ...boundaryFacts, ...payloadFacts]);
    // READINESS-1 M2: the raw rows ride along so the session can persist them
    // for the readiness exporter's observations[].
    storeDiscoveryResults(results);
    // FC-MU-3: the record's live consents ride along so a re-export keeps them.
    storeDiscoveryConsents(payloadConsents);
    onContinue();
  };

  const hasConfirm = Object.values(decisions).some((d) => d.kind === 'confirm');
  const nameMissing = hasConfirm && confirmerName.trim() === '';

  return (
    <div data-testid="boundary-confirm-panel">
      <div className="ces-titleblock" style={{ marginBottom: 12 }}>
        <span className="tb-title">Confirm your CUI boundary</span>
      </div>
      <p>
        Drafted from your tenant's discovery footprints — correct anything wrong, confirm
        what's right. Unconfirmed drafts stay drafts: they defer questions but never count
        toward your score until a named person confirms them.
      </p>

      <label style={{ display: 'block', margin: '12px 0' }}>
        Confirmations recorded under (your name):{' '}
        <input
          data-testid="boundary-confirmer-name"
          type="text"
          value={confirmerName}
          onChange={(e) => setConfirmerName(e.target.value)}
          placeholder="Jane Assessor"
        />
      </label>
      {nameMissing && (
        <p className="badge badge-violation" data-testid="boundary-name-required">
          A name is required to record confirmations.
        </p>
      )}

      {drafts.length === 0 && (
        <p data-testid="boundary-no-drafts">
          No boundary could be drafted from the available discovery evidence — the boundary
          questions will be asked in the interview.
        </p>
      )}

      {drafts.map((draft) => {
        const decision = decisions[draft.question_id];
        const badge = decisionBadge(decision);
        const shownAnswer =
          decision?.kind === 'correct' ? decision.answer : draft.answer;
        return (
          <div
            key={draft.question_id}
            data-testid={`boundary-draft-${draft.question_id}`}
            style={{ border: '1px solid var(--co-border)', borderRadius: 0, padding: 12, marginBottom: 10 }}
          >
            <p style={{ marginTop: 0 }}>{draft.question_text}</p>
            <p>
              Drafted answer: <strong data-testid={`boundary-answer-${draft.question_id}`}>{shownAnswer}</strong>{' '}
              <span className={badge.cls} data-testid={`boundary-status-${draft.question_id}`}>
                {badge.label}
              </span>
            </p>
            {correcting[draft.question_id] ? (
              <span>
                {CORRECT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className="btn"
                    data-testid={`boundary-correct-${draft.question_id}-${opt.value}`}
                    onClick={() => decide(draft.question_id, { kind: 'correct', answer: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </span>
            ) : (
              <span>
                <button
                  className="btn btn-primary"
                  data-testid={`boundary-confirm-${draft.question_id}`}
                  disabled={confirmerName.trim() === ''}
                  onClick={() => decide(draft.question_id, { kind: 'confirm' })}
                >
                  Confirm
                </button>{' '}
                <button
                  className="btn"
                  data-testid={`boundary-correct-${draft.question_id}`}
                  onClick={() =>
                    setCorrecting((prev) => ({ ...prev, [draft.question_id]: true }))
                  }
                >
                  Correct
                </button>
              </span>
            )}
          </div>
        );
      })}

      <button
        className="btn btn-primary"
        data-testid="boundary-continue-btn"
        disabled={nameMissing}
        onClick={handleContinue}
      >
        Continue to Interview →
      </button>
    </div>
  );
}