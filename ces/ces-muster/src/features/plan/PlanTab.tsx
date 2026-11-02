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
// as the fallback when the push fails.
//
// MG-11 / MG-18 (D9): the exclusions, traceability and control-assessment
// reports and the tech-ref implementation guide download here, in Planner's
// download formats (reports/planReports.ts). MG-22: the CUI-vs-discovery
// staleness check runs on the session's facts after the compile and before a
// push; its warning shows with the compile's consistency warnings (warn only).
//
// MG-16 (D2): the 20 policy, SSP, POA&M and IR documents (policy/
// PolicyDocumentsPanel.tsx), singly or all at once as DOCX. MG-09 hand-off (e):
// the capture review of the evidenced BTC questions (btc/BtcCaptureReview.tsx).
//
// W7-MX2: the compile carries the policy-inputs profile and policy-set manifest
// envelopes (attachPolicyHandoff), so "Send to Stamper" pushes them with the
// CUI Boundary and the compile's three. The Readiness Posture and CUI Boundary
// envelopes (as pushed: <prefix>-<slug>-<ts>.json) and the BTC Confirmation
// (btc-confirmation-<slug>-<ts>.json) download from the hand-off list.
//
// FIN-28 (V122): "Send to Stamper" sends the same parts as the API push: the
// envelopes above plus the policy texts the policy-set manifest hashes
// (attachPolicyHandoffWithTexts, planPushService.ts), which muster-api forwards
// to EO's intake. The Readiness Posture download is `plan-download-readiness-posture`.
//
// FIN-32 (FLOW-7): the muster-api sign-in sits at the top of the tab (one form for both paths),
// and ApiCompilePanel compiles and sends through muster-api (POST /api/plan/compile, /push),
// the path the headless round takes. The in-browser compile stays until API-3b.
import { useState } from 'react';
import ApiCompilePanel from './ApiCompilePanel';
import {
  attachPolicyHandoffWithTexts,
  pushPlanToStamper,
  type PlanPushOutcome,
  type PolicyText,
} from './planPushService';
import MusterSignIn from './MusterSignIn';
import { hasMusterToken, signOutOfMuster } from '@/shared/api/musterAuth';
import {
  compilePlanForSession,
  missionPlanDirectives,
  downloadArtifact,
  type PlanCompileResult,
  type PlanDoc,
} from './planCompileService';
import { db } from '@/shared/db/schema';
import { renderReportsForCompile } from './reports/sessionReports';
import { REPORT_FILES } from './reports/planReports';
import { downloadText } from './reports/downloadText';
import { PLAN_HTML_VIEW_FILES, renderPlanHtmlViews } from './reports/planHtmlViews';
import { checkDiscoveryStaleness } from './planValidation';
import PolicyDocumentsPanel from './policy/PolicyDocumentsPanel';
import BtcCaptureReview from './btc/BtcCaptureReview';
import { formatEstimate, type RecurringCostNotice } from './recurringCostNotice';

/** CG-8: the plan's recurring-cost items (never blocks; the opt-in is taken in Stamper). */
function RecurringCostNoticeBlock({ notice, testId }: { notice: RecurringCostNotice | undefined; testId: string }) {
  if (!notice) return null;
  if (notice.items.length === 0) {
    return (
      <p data-testid={testId}>
        No recurring-cost items in this plan.
        {notice.licence_dependencies.length > 0 &&
          ` Licence needed, not bought by CES: ${notice.licence_dependencies.map((l) => l.licence).join(', ')}.`}
      </p>
    );
  }
  return (
    <div className="callout-warning" data-testid={testId}>
      <p>
        {notice.items.length} recurring-cost item{notice.items.length === 1 ? '' : 's'} in this plan, about{' '}
        {formatEstimate(notice.total_estimate_low, notice.total_estimate_high)} a month (price date {notice.price_date}). {notice.note}
      </p>
      <ul>
        {notice.items.map((i) => (
          <li key={i.item_id} data-testid={`${testId}-item-${i.item_id}`}>
            {i.label}: ~{formatEstimate(i.estimate_month_low, i.estimate_month_high)}/month. Needs your opt-in in Stamper.
          </li>
        ))}
      </ul>
      {notice.licence_dependencies.length > 0 && (
        <p>Licence needed, not bought by CES: {notice.licence_dependencies.map((l) => l.licence).join(', ')}.</p>
      )}
    </div>
  );
}
import { handoffFileName, type HandoffKind } from './artifactRefs';

/** W7-MX2: the hand-off envelopes the Plan tab downloads as pushed. */
const HANDOFF_DOWNLOADS: ReadonlyArray<{ kind: HandoffKind; id: string; label: string }> = [
  { kind: 'readiness_posture', id: 'readiness-posture', label: 'Readiness Posture' },
  { kind: 'cui_boundary', id: 'cui-boundary', label: 'CUI Boundary' },
];

/** MG-11 / MG-18: the report downloads (Planner's formats: exclusions as text, the rest as HTML). */
const REPORT_DOWNLOADS = [
  { id: 'exclusions-report', label: 'Exclusions report', file: REPORT_FILES.exclusionsText, mime: 'text/plain;charset=utf-8' },
  { id: 'traceability-report', label: 'Traceability report', file: REPORT_FILES.traceabilityHtml, mime: 'text/html;charset=utf-8' },
  {
    id: 'control-assessment-report',
    label: 'Control assessment report',
    file: REPORT_FILES.controlAssessmentHtml,
    mime: 'text/html;charset=utf-8',
  },
  {
    id: 'tech-ref-guide',
    label: 'Tech-ref implementation guide',
    file: REPORT_FILES.techRefHtml,
    mime: 'text/html;charset=utf-8',
  },
  // W8-FMT: Planner's HTML views of the Mission Plan and Tenant Manifest.
  { id: 'mission-plan-html', label: 'Mission Plan (HTML view)', file: PLAN_HTML_VIEW_FILES.missionPlan, mime: 'text/html;charset=utf-8' },
  { id: 'tenant-manifest-html', label: 'Tenant Manifest (HTML view)', file: PLAN_HTML_VIEW_FILES.tenantManifest, mime: 'text/html;charset=utf-8' },
] as const;

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
  // MG-15 (D10): the reason for overriding a blocked push (audited by muster-api).
  const [overrideReason, setOverrideReason] = useState('');
  // FX-MU4: sign-in state for muster-api (token lives in localStorage).
  const [signedIn, setSignedIn] = useState(hasMusterToken);
  // MG-11 / MG-18: rendered report files (file name -> content), built on first download.
  const [reports, setReports] = useState<Record<string, string> | null>(null);
  const [reportError, setReportError] = useState('');
  // MG-22: the session-fact staleness warnings (CONSISTENCY_CUI_STALE_VS_DISCOVERY).
  const [staleness, setStaleness] = useState<string[]>([]);
  /** FIN-28: the policy texts the policy-set manifest hashes; the push carries them (as the API push does). */
  const [policyTexts, setPolicyTexts] = useState<PolicyText[]>([]);

  const sessionStaleness = async (): Promise<string[]> => {
    if (!completedSessionId) return [];
    try {
      const session = await db.interview_sessions.get(completedSessionId);
      return session ? checkDiscoveryStaleness(session.facts) : [];
    } catch {
      return []; // a warn-only check never fails the compile or the push
    }
  };

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
    setPolicyTexts([]);
    setShowPlan(false);
    setPushOutcome(null);
    setReports(null);
    setReportError('');
    setStaleness([]);
    try {
      // MG-22 hand-off (b): the compile's warnings carry the staleness check now.
      const r = await compilePlanForSession(completedSessionId);
      // W7-MX2: the two policy envelopes, referenced from the MP before it is shown or pushed.
      // FIN-28: the same render also returns the texts the manifest hashes, for the push.
      setPolicyTexts(await attachPolicyHandoffWithTexts(r, completedSessionId));
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

  /** W7-MX2: a hand-off envelope under its push name, or the BTC Confirmation. */
  const downloadHandoff = (kind: HandoffKind) => {
    if (!result?.handoff[kind]) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadArtifact(handoffFileName(kind, result.tenantSlug, ts), result.handoff[kind]);
  };
  const downloadBtcConfirmation = () => {
    if (!result?.artifacts.btcConfirmation) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadArtifact(`btc-confirmation-${result.tenantSlug}-${ts}.json`, result.artifacts.btcConfirmation);
  };

  const downloadReport = async (r: (typeof REPORT_DOWNLOADS)[number]) => {
    if (!result || !completedSessionId) return;
    setReportError('');
    try {
      let files = reports;
      if (!files) {
        const session = await db.interview_sessions.get(completedSessionId);
        if (!session) throw new Error(`Session not found: ${completedSessionId}`);
        files = { ...(await renderReportsForCompile(result, session)), ...renderPlanHtmlViews(result.artifacts) };
        setReports(files);
      }
      const content = files[r.file];
      if (content === undefined) throw new Error(`${r.label} was not generated (no RR Question Set)`);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dot = r.file.lastIndexOf('.');
      downloadText(`${r.file.slice(0, dot)}-${result.tenantSlug}-${ts}${r.file.slice(dot)}`, content, r.mime);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : String(e));
    }
  };

  const sendToStamper = async (override?: { reason: string }) => {
    if (!result) return;
    setSending(true);
    setPushOutcome(null);
    try {
      // MG-22: re-check staleness on the facts as they are at push time (warn only).
      setStaleness(await sessionStaleness());
      const outcome = await pushPlanToStamper(result, override, policyTexts);
      setPushOutcome(outcome);
      if (!outcome.ok) onUnauthorized(outcome.status);
    } finally {
      setSending(false);
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

      <div data-testid="plan-signin" style={{ margin: '8px 0 16px' }}>
        <MusterSignIn signedIn={signedIn} onChange={setSignedIn} />
      </div>

      <h3>Compile in this browser</h3>

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

      {result && <RecurringCostNoticeBlock notice={result.recurringCostNotice} testId="plan-recurring-cost-notice" />}

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

          <div data-testid="plan-handoff-downloads" style={{ marginTop: 8 }}>
            <span>Hand-off artifacts</span>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {HANDOFF_DOWNLOADS.filter((h) => result.handoff?.[h.kind]).map((h) => (
                <li key={h.id} data-testid={`plan-handoff-${h.id}`} style={{ marginBottom: 8 }}>
                  <span>{h.label}</span>
                  <button
                    className="btn-secondary"
                    data-testid={`plan-download-${h.id}`}
                    onClick={() => downloadHandoff(h.kind)}
                    style={{ marginLeft: 8 }}
                  >
                    Download
                  </button>
                </li>
              ))}
              {result.artifacts?.btcConfirmation && (
                <li data-testid="plan-handoff-btc-confirmation" style={{ marginBottom: 8 }}>
                  <span>BTC Confirmation</span>
                  <button
                    className="btn-secondary"
                    data-testid="plan-download-btc-confirmation"
                    onClick={downloadBtcConfirmation}
                    style={{ marginLeft: 8 }}
                  >
                    Download
                  </button>
                </li>
              )}
            </ul>
          </div>

          <div data-testid="plan-reports" style={{ marginTop: 8 }}>
            <span>Assessor reports</span>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {REPORT_DOWNLOADS.map((r) => (
                <li key={r.id} data-testid={`plan-report-${r.id}`} style={{ marginBottom: 8 }}>
                  <span>{r.label}</span>
                  <button
                    className="btn-secondary"
                    data-testid={`plan-download-${r.id}`}
                    onClick={() => downloadReport(r)}
                    style={{ marginLeft: 8 }}
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
            {reportError && (
              <p className="callout-warning" data-testid="plan-report-error">
                Report generation failed: {reportError}
              </p>
            )}
          </div>

          {completedSessionId && <PolicyDocumentsPanel result={result} sessionId={completedSessionId} />}

          {completedSessionId && result.artifacts?.btcConfirmation && (
            <BtcCaptureReview
              btcConfirmation={result.artifacts.btcConfirmation}
              sessionId={completedSessionId}
              onReviewed={() => void generate()}
            />
          )}

          {(staleness.length > 0 || (result.validation?.warnings ?? []).some((w) => w.startsWith('CONSISTENCY_'))) && (
            <ul className="callout-warning" data-testid="plan-consistency-warnings">
              {[...new Set([...(result.validation?.warnings ?? []).filter((w) => w.startsWith('CONSISTENCY_')), ...staleness])].map(
                (w, i) => (
                  <li key={i}>{w}</li>
                )
              )}
            </ul>
          )}

          <RecurringCostNoticeBlock notice={result.recurringCostNotice} testId="plan-send-stamper-cost-notice" />
          <div data-testid="plan-send-stamper" style={{ marginTop: 8 }}>
            <button
              className="btn-primary"
              data-testid="plan-send-stamper-btn"
              onClick={() => sendToStamper()}
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
            {pushOutcome && !pushOutcome.ok && pushOutcome.blocking && (
              <div data-testid="plan-send-stamper-override">
                <input
                  type="text"
                  data-testid="plan-send-stamper-override-reason"
                  placeholder="Reason for sending anyway (recorded in the audit log)"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
                <button
                  className="btn-secondary"
                  data-testid="plan-send-stamper-override-btn"
                  disabled={sending || overrideReason.trim() === ''}
                  onClick={() => sendToStamper({ reason: overrideReason })}
                >
                  Override and send
                </button>
              </div>
            )}
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

      <ApiCompilePanel completedSessionId={completedSessionId} signedIn={signedIn} onUnauthorized={onUnauthorized} />
    </div>
  );
}
