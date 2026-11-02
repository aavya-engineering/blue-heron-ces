// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/** One captured stream of a run-log entry (legacy `_runLog.entries[].streams[]`). */
export interface RunLogStream {
  phase: string;
  command?: string;
  stdout?: string;
  stderr?: string;
}

/** The run-log entry fields the legacy Error Log reads (`_runLog.entries[]`). */
export interface RunLogEntry {
  status: string;
  taskId: string;
  subId?: string;
  controls?: readonly string[];
  command?: string;
  streams?: readonly RunLogStream[];
  outcome?: string;
  outcomeRationale?: string;
  message?: string;
}

export interface ErrorLogProps {
  /** Every run-log entry; only `status === 'fail'` ones are shown. Nothing renders when none failed. */
  entries: readonly RunLogEntry[] | null | undefined;
  /** Legacy ids `errorLogPanel` and `errorLogContent`. */
  id?: string;
  contentId?: string;
}

const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  failed_remediation_available: 'NOT SAT (remediation available)',
  failed_no_remediation: 'NOT SAT (no remediation)',
  partial_success: 'PARTIAL',
  verification_pending: 'PENDING',
};

const RESPONSE_PHASES: Readonly<Record<string, string>> = {
  get_command: 'GET',
  set_command: 'SET',
  post_set_get: 'POST-SET',
};

/** The legacy renderErrorLogPanel derivation for one failed entry. */
function describe(entry: RunLogEntry) {
  const streams = entry.streams ?? [];
  const cmdStream = streams.find((s) => s.phase === 'set_command') ?? streams.find((s) => s.phase === 'get_command');
  const command = cmdStream?.command ? cmdStream.command : (entry.command ?? '');

  let response = '';
  for (const st of streams) {
    const label = RESPONSE_PHASES[st.phase];
    if (!label) continue;
    let out = '';
    if (st.stdout) out += st.stdout;
    if (st.stderr) out += (out ? '\n' : '') + 'STDERR: ' + st.stderr;
    if (out) response += (response ? `\n--- ${label} ---\n` : '') + out;
  }

  const verify = streams.find((s) => s.phase === 'verification');
  let reason = entry.outcomeRationale || entry.message || '';
  if (!reason && verify?.stdout) {
    try {
      const parsed = JSON.parse(verify.stdout) as { details?: unknown };
      reason = parsed.details ? JSON.stringify(parsed.details, null, 2) : verify.stdout;
    } catch {
      reason = verify.stdout;
    }
  }

  return {
    command,
    response: response.trim() ? response.substring(0, 3000) : '',
    badge: entry.outcome ? (OUTCOME_LABELS[entry.outcome] ?? entry.outcome) : 'FAIL',
    reason: reason.substring(0, 1000),
    verification: verify?.stdout?.trim() ? verify.stdout.substring(0, 3000) : '',
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="ck-error-row">
      <div className="ck-error-row-label">{label}</div>
      {/* Scrolls past 200 px, so it is focusable for keyboard scrolling. */}
      <div className="ck-error-row-value" tabIndex={0}>
        {value}
      </div>
    </div>
  );
}

/** Legacy post-run Error Log panel: one card per failed entry with command, tenant response, determination, verification. */
export function ErrorLog({ entries, id = 'errorLogPanel', contentId = 'errorLogContent' }: ErrorLogProps) {
  const failed = (entries ?? []).filter((e) => e.status === 'fail');
  if (failed.length === 0) return null;

  return (
    <section id={id} className="panel ck-panel ck-error-log" aria-labelledby={`${id}Title`}>
      <h2 id={`${id}Title`} className="ck-panel-title ck-error-log-title">
        Error Log
      </h2>
      <div id={contentId}>
        {failed.map((entry, index) => {
          const d = describe(entry);
          return (
            <article key={`${entry.taskId}-${entry.subId ?? ''}-${index}`} className="ck-error-entry">
              <div className="ck-error-id">
                {(entry.controls ?? []).map((c) => (
                  <span key={c} className="ck-error-control">
                    {c}
                  </span>
                ))}
                <span className="ck-error-sub">{entry.subId || entry.taskId}</span>
              </div>
              {d.command ? <Row label="Command Sent" value={d.command} /> : null}
              {d.response ? <Row label="Tenant Response" value={d.response} /> : null}
              <div className="ck-error-row">
                <div className="ck-error-row-label">Stamper Determination</div>
                <div className="ck-error-determination">
                  <span className="ck-verdict-badge ck-verdict-badge-fail">{d.badge}</span>
                  {d.reason ? <span className="ck-error-reason">{d.reason}</span> : null}
                </div>
              </div>
              {d.verification ? <Row label="Verification Detail" value={d.verification} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
