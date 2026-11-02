// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// ApiCompilePanel — FIN-32 (FLOW-7, V125): compile and send the plan through muster-api, the
// path the headless round takes (apiCompile.ts). The operator is signed in (PlanTab holds the
// sign-in); the session's typed answers, a fresh read-only discovery and an optional
// organisation-content file go to POST /api/plan/compile; the compiled files download here
// (the CUI Boundary first, GOAL ruling 1) and "Send to Stamper" pushes them with
// POST /api/plan/push. Sim tenants only (see apiCompile.ts). Nothing is read back from
// Stamper or EO.
import { useEffect, useState } from 'react';
import { db } from '@/shared/db/schema';
import { downloadBlob } from './policy/downloadBlob';
import {
  answersFileFromFacts,
  compiledFileBlob,
  compileOnApi,
  fileTestId,
  pickFile,
  pushCompiledOnApi,
  type AnswerRow,
  type ApiCompileResponse,
  type ApiCompiledFile,
} from './apiCompile';

interface SessionTarget {
  slug: string;
  kind: 'live' | 'sim';
  answers: AnswerRow[];
  stacks: string[];
}

type PushState =
  | { ok: true; pushed: string[]; sent: string[] }
  | { ok: false; message: string; blocking: boolean; sent: string[] };

export default function ApiCompilePanel({
  completedSessionId,
  signedIn,
  onUnauthorized,
}: {
  completedSessionId?: string | null;
  signedIn: boolean;
  onUnauthorized: (status: number) => void;
}) {
  const [target, setTarget] = useState<SessionTarget | null>(null);
  const [targetNote, setTargetNote] = useState('');
  const [orgContent, setOrgContent] = useState<{ name: string; text: string } | null>(null);
  const [orgContentError, setOrgContentError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [compiled, setCompiled] = useState<ApiCompileResponse | null>(null);
  const [sentAnswers, setSentAnswers] = useState<AnswerRow[]>([]);
  const [pushing, setPushing] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  useEffect(() => {
    if (!completedSessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const session = await db.interview_sessions.get(completedSessionId);
        const m = session?.readiness_manifest;
        if (cancelled) return;
        if (!session || !m) {
          setTargetNote('This session recorded no tenant (Situation tab: tenant slug and kind).');
          return;
        }
        setTarget({
          slug: m.tenant_slug,
          kind: m.tenant_kind,
          answers: answersFileFromFacts(session.facts, m.tenant_slug),
          stacks: session.selected_stacks ?? [],
        });
      } catch (e) {
        if (!cancelled) setTargetNote(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [completedSessionId]);

  const simOnly = target !== null && target.kind !== 'sim';
  const canCompile = !!target && !simOnly && signedIn && !busy;

  const loadOrgContent = async (file: File | undefined) => {
    setOrgContentError('');
    if (!file) {
      setOrgContent(null);
      return;
    }
    const text = await file.text();
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object');
      setOrgContent({ name: file.name, text });
    } catch (e) {
      setOrgContent(null);
      setOrgContentError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const compile = async () => {
    if (!target) return;
    setBusy(true);
    setError('');
    setCompiled(null);
    setPush(null);
    setOverrideReason('');
    try {
      const r = await compileOnApi({
        slug: target.slug,
        answers: target.answers,
        orgContentText: orgContent?.text,
        stacks: target.stacks,
      });
      setSentAnswers(target.answers);
      if (!r.ok) {
        setError(r.message);
        onUnauthorized(r.status);
        return;
      }
      setCompiled(r.data);
    } finally {
      setBusy(false);
    }
  };

  const send = async (override?: { reason: string }) => {
    if (!compiled || !target) return;
    setPushing(true);
    setPush(null);
    try {
      const r = await pushCompiledOnApi(compiled.files, target.slug, override);
      if (r.ok) setPush({ ok: true, pushed: r.data.pushed ?? [], sent: r.sent });
      else {
        setPush({ ok: false, message: r.message, blocking: r.blocking === true, sent: r.sent });
        onUnauthorized(r.status);
      }
    } catch (e) {
      setPush({ ok: false, message: e instanceof Error ? e.message : String(e), blocking: false, sent: [] });
    } finally {
      setPushing(false);
    }
  };

  const download = (f: ApiCompiledFile) => downloadBlob(f.name.split('/').pop() ?? f.name, compiledFileBlob(f));
  const cuiBoundary = compiled ? pickFile(compiled.files, 'cui-boundary-') : undefined;
  const btcConfirmation = compiled ? pickFile(compiled.files, 'btc-confirmation-') : undefined;

  return (
    <section data-testid="plan-api" style={{ marginTop: 16 }} aria-labelledby="plan-api-heading">
      <h3 id="plan-api-heading">Compile and send through muster-api</h3>
      <p>
        muster-api reads the tenant again (discovery, read-only), compiles the plan from that read and
        your typed answers, and sends it to Stamper. Simulator tenants only; a live tenant uses the
        in-browser plan above.
      </p>

      {!completedSessionId && <p data-testid="plan-api-no-session">Finish the interview first.</p>}
      {targetNote && (
        <p className="callout-warning" data-testid="plan-api-target-note">
          {targetNote}
        </p>
      )}
      {target && (
        <p data-testid="plan-api-target">
          Tenant <code data-testid="plan-api-slug">{target.slug}</code> ({target.kind}):{' '}
          <span data-testid="plan-api-answers-count">{target.answers.length}</span> typed answers will be sent.
        </p>
      )}
      {simOnly && (
        <p className="callout-warning" data-testid="plan-api-sim-only">
          This tenant is live. Compiling through muster-api is for simulator tenants only.
        </p>
      )}
      {!signedIn && target && !simOnly && (
        <p className="callout-warning" data-testid="plan-api-signin-needed">
          Sign in to muster-api (above) to compile and send.
        </p>
      )}

      <label style={{ display: 'block', margin: '8px 0' }}>
        Organisation content file (optional, JSON):{' '}
        <input
          type="file"
          accept=".json,application/json"
          data-testid="plan-api-org-content"
          onChange={(e) => void loadOrgContent(e.target.files?.[0])}
        />
      </label>
      {orgContent && <p data-testid="plan-api-org-content-name">Loaded: {orgContent.name}</p>}
      {orgContentError && (
        <p className="callout-warning" data-testid="plan-api-org-content-error">
          {orgContentError}
        </p>
      )}

      <button className="btn-primary" data-testid="plan-api-compile-btn" disabled={!canCompile} onClick={() => void compile()}>
        Compile on muster-api
      </button>
      {busy && <p data-testid="plan-api-compile-progress">Reading the tenant and compiling the plan…</p>}
      {error && (
        <p className="callout-warning" data-testid="plan-api-compile-error">
          Compile failed: {error}
        </p>
      )}

      {compiled && (
        <div data-testid="plan-api-result">
          <p data-testid="plan-api-compile-summary">
            Compiled {compiled.files.length} files{compiled.summary ? ` (${compiled.summary})` : ''}.
          </p>
          {compiled.cost_notice_lines && compiled.cost_notice_lines.length > 0 && (
            <ul className="callout-warning" data-testid="plan-api-cost-notice">
              {compiled.cost_notice_lines.map((l, i) => (
                <li key={i}>{l.replace(/^MX_COST_NOTICE /, '')}</li>
              ))}
              <li>Each recurring-cost item needs your opt-in in Stamper.</li>
            </ul>
          )}

          <ul style={{ listStyle: 'none', padding: 0 }}>
            <li style={{ marginBottom: 8 }}>
              <span>CUI Boundary</span>{' '}
              {cuiBoundary ? (
                <button className="btn-secondary" data-testid="plan-api-download-cui-boundary" onClick={() => download(cuiBoundary)}>
                  Download
                </button>
              ) : (
                <span data-testid="plan-api-no-cui-boundary">not produced (no CUI in scope, or CUI presence not confirmed)</span>
              )}
            </li>
            {btcConfirmation && (
              <li style={{ marginBottom: 8 }}>
                <span>BTC Confirmation</span>{' '}
                <button className="btn-secondary" data-testid="plan-api-download-btc-confirmation" onClick={() => download(btcConfirmation)}>
                  Download
                </button>
              </li>
            )}
            <li style={{ marginBottom: 8 }}>
              <span>Answers sent ({sentAnswers.length})</span>{' '}
              <button
                className="btn-secondary"
                data-testid="plan-api-download-answers"
                onClick={() =>
                  downloadBlob(
                    `interview-answers-${target?.slug ?? 'tenant'}.json`,
                    new Blob([JSON.stringify(sentAnswers, null, 2)], { type: 'application/json' })
                  )
                }
              >
                Download
              </button>
            </li>
          </ul>

          <details data-testid="plan-api-files">
            <summary>All compiled files ({compiled.files.length})</summary>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {compiled.files.map((f) => (
                <li key={f.name} data-testid={`plan-api-file-${fileTestId(f.name)}`} style={{ marginBottom: 4 }}>
                  <code>{f.name}</code>{' '}
                  <button className="btn-secondary" data-testid={`plan-api-download-${fileTestId(f.name)}`} onClick={() => download(f)}>
                    Download
                  </button>
                </li>
              ))}
            </ul>
          </details>

          <div data-testid="plan-api-push" style={{ marginTop: 8 }}>
            <button
              className="btn-primary"
              data-testid="plan-api-push-btn"
              disabled={!signedIn || pushing}
              onClick={() => void send()}
            >
              Send to Stamper
            </button>
            {pushing && <p data-testid="plan-api-push-progress">Sending the plan to Stamper…</p>}
            {push?.ok && (
              <p data-testid="plan-api-push-success">
                Sent to Stamper: <span data-testid="plan-api-pushed">{push.pushed.join(', ')}</span>
              </p>
            )}
            {push && !push.ok && (
              <p className="callout-warning" data-testid="plan-api-push-error">
                Send to Stamper failed: {push.message}. The files above can be downloaded and handed to Stamper.
              </p>
            )}
            {push && !push.ok && push.blocking && (
              <div data-testid="plan-api-push-override">
                <input
                  type="text"
                  aria-label="Reason for sending anyway"
                  data-testid="plan-api-push-override-reason"
                  placeholder="Reason for sending anyway (recorded in the audit log)"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
                <button
                  className="btn-secondary"
                  data-testid="plan-api-push-override-btn"
                  disabled={pushing || overrideReason.trim() === ''}
                  onClick={() => void send({ reason: overrideReason })}
                >
                  Override and send
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
