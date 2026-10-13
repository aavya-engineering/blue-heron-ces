// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// PlanTab.tsx — G-MUSTER-PLAN-3 M0: the Plan surface. Runs the ONE vendored
// compile on the current readiness record (compilePlanForSession) and presents
// the in-scope Planner artifacts: a document list, a scrollable mission-plan
// viewer, and downloads through the shared blob/anchor seam.
//
// Score disclosure (REQ-MUSTER-SCORE-DISCLOSURE): this surface shows control
// directives and status only — never the SPRS number, never a task/command
// count read off the plan. The mission-plan rows render control_id + directive
// + step count; the artifacts (which carry no score) download, never render.
//
// Testids are the REQ-TESTER-MUSTER-SHOW-MP §4 contract, verbatim.
//
// FX-MU1: "Send to Stamper" pushes the generated MP + TM through muster-api's
// POST /api/plan/push into the tenant's Stamper plans folder; the downloads stay
// as the fallback when the push fails. FX-MU2: "Check Stamper progress" reads
// back the directive verdicts Stamper reported (GET /api/plan/status).
import { useState } from 'react';
import {
  pushPlanToStamper,
  fetchPlanProgress,
  type PlanPushOutcome,
  type PlanProgressOutcome,
} from './planPushService';
import PlanProgressView from './PlanProgressView';
import MusterSignIn from './MusterSignIn';
import { hasMusterToken, signOutOfMuster } from '@/shared/api/musterAuth';
import {
  compilePlanForSession,
  missionPlanDirectives,
  downloadArtifact,
  type PlanCompileResult,
  type PlanDoc,
} from './planCompileService';

export default function PlanTab({
  completedSessionId,
}: {
  completedSessionId?: string | null;
}) {
  const [result, setResult] = useState<PlanCompileResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [showPlan, setShowPlan] = useState(false);
  const [sending, setSending] = useState(false);
  const [pushOutcome, setPushOutcome] = useState<PlanPushOutcome | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<PlanProgressOutcome | null>(null);
  // FX-MU4: sign-in state for muster-api (token lives in localStorage).
  const [signedIn, setSignedIn] = useState(hasMusterToken);

  /** A 401 means the stored token is missing/expired: drop it, re-show sign-in. */
  const onUnauthorized = (status: number) => {
    if (status === 401) {
      signOutOfMuster();
      setSignedIn(false);
    }
  };

  const generate = async () => {
    if (!completedSessionId) return;
    setGenerating(true);
    setError('');
    setResult(null);
    setShowPlan(false);
    setPushOutcome(null);
    setProgress(null);
    try {
      const r = await compilePlanForSession(completedSessionId);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const download = (doc: PlanDoc) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = result?.tenantSlug ?? 'tenant';
    const base =
      doc.kind === 'mission-plan' ? 'manual-mission-plan' : doc.kind;
    downloadArtifact(`${base}-${slug}-${ts}.json`, doc.artifact);
  };

  const sendToStamper = async () => {
    if (!result) return;
    setSending(true);
    setPushOutcome(null);
    try {
      const outcome = await pushPlanToStamper(result);
      setPushOutcome(outcome);
      if (!outcome.ok) onUnauthorized(outcome.status);
    } finally {
      setSending(false);
    }
  };

  const checkProgress = async () => {
    if (!result) return;
    setChecking(true);
    try {
      const outcome = await fetchPlanProgress(result);
      setProgress(outcome);
      if (!outcome.ok) onUnauthorized(outcome.status);
    } finally {
      setChecking(false);
    }
  };

  const directives = result ? missionPlanDirectives(result.artifacts.missionPlan) : [];

  return (
    <div className="page" data-testid="plan-tab">
      <div className="ces-titleblock" style={{ marginBottom: 16 }}>
        <span className="tb-title">Plan</span>
      </div>

      {!completedSessionId && (
        <p className="callout-warning" data-testid="plan-no-result-note">
          Complete a readiness assessment first — the plan is generated from the
          readiness record.
        </p>
      )}

      <p>
        Your plan is a build output of the readiness record: the mission plan and
        manifests are generated from what discovery observed and the interview
        recorded, not written by hand.
      </p>

      <button
        className="btn-primary"
        data-testid="plan-generate-btn"
        onClick={generate}
        disabled={!completedSessionId || generating}
      >
        Generate output documents
      </button>

      {generating && (
        <p data-testid="plan-generate-progress">Generating output documents…</p>
      )}

      {error && (
        <p className="callout-warning" data-testid="plan-generate-error">
          Generation failed: {error}
        </p>
      )}

      {result && result.defaultedInputs.length > 0 && (
        <p className="callout-warning" data-testid="plan-defaulted-inputs">
          {result.defaultedInputs.length} plan input
          {result.defaultedInputs.length === 1 ? '' : 's'} unanswered — left to
          generator defaults: {result.defaultedInputs.join(', ')}. Answer these in
          the interview to sharpen the plan.
        </p>
      )}

      {result && (
        <>
          <ul data-testid="plan-doc-list" style={{ listStyle: 'none', padding: 0 }}>
            {result.docs.map((doc) => (
              <li
                key={doc.kind}
                data-testid={`plan-doc-${doc.kind}`}
                style={{ marginBottom: 8 }}
              >
                <span>{doc.label}</span>
                {doc.kind === 'mission-plan' && (
                  <button
                    className="btn-secondary"
                    data-testid="plan-open-mission-plan"
                    onClick={() => setShowPlan(true)}
                    style={{ marginLeft: 8 }}
                  >
                    Open
                  </button>
                )}
                <button
                  className="btn-secondary"
                  data-testid={
                    doc.kind === 'mission-plan'
                      ? 'plan-download-mission-plan'
                      : `plan-download-${doc.kind}`
                  }
                  onClick={() => download(doc)}
                  style={{ marginLeft: 8 }}
                >
                  Download
                </button>
                {doc.validationWarnings.length > 0 && (
                  <ul
                    className="callout-warning"
                    data-testid={`plan-doc-warnings-${doc.kind}`}
                    style={{ marginTop: 4 }}
                  >
                    {doc.validationWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <div data-testid="plan-send-stamper" style={{ marginTop: 8 }}>
            <MusterSignIn signedIn={signedIn} onChange={setSignedIn} />
            <button
              className="btn-primary"
              data-testid="plan-send-stamper-btn"
              onClick={sendToStamper}
              disabled={sending}
            >
              Send to Stamper
            </button>
            {sending && (
              <p data-testid="plan-send-stamper-progress">Sending the plan to Stamper…</p>
            )}
            {pushOutcome?.ok && (
              <p data-testid="plan-send-stamper-success">
                Sent to Stamper: {pushOutcome.pushed.join(', ')}
              </p>
            )}
            {pushOutcome && !pushOutcome.ok && (
              <p className="callout-warning" data-testid="plan-send-stamper-error">
                Send to Stamper failed — {pushOutcome.message}. Use Download above
                and hand the files to Stamper instead.
              </p>
            )}
            <button
              className="btn-secondary"
              data-testid="plan-progress-refresh-btn"
              onClick={checkProgress}
              disabled={checking}
              style={{ marginLeft: 8 }}
            >
              Check Stamper progress
            </button>
            {progress && !progress.ok && (
              <p className="callout-warning" data-testid="plan-progress-error">
                Progress unavailable — {progress.message}.
              </p>
            )}
            {progress?.ok && <PlanProgressView progress={progress.progress} />}
          </div>

          {showPlan && (
            <div
              data-testid="mission-plan-view"
              style={{ maxHeight: 480, overflowY: 'auto', marginTop: 16 }}
            >
              <table>
                <thead>
                  <tr>
                    <th>Control</th>
                    <th>Directive</th>
                    <th>Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {directives.map((d, i) => (
                    <tr
                      key={d.control_id}
                      data-testid={
                        i === 0
                          ? 'mission-plan-row-first'
                          : i === directives.length - 1
                          ? 'mission-plan-row-last'
                          : `mission-plan-row-${d.control_id}`
                      }
                    >
                      <td>{d.control_id}</td>
                      <td>{d.directive}</td>
                      <td>{d.step_ids.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
