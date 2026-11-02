// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: the execute rows of the Console tab (#taskList): step rows, their sub-command rows,
// the verbose log panel, approval rows (kit ApprovalCard, single mode), layer approvals and the
// completion banner. Legacy ids and classes are kept (step-row-<id>, step-status-<id>,
// sub-cmd-<task>-<sub>, sub-status-<task>-<sub>, live-out-<task>-<sub>, approval rows from the
// kit). Data comes from the console store; nothing here fetches.

import { ApprovalCard, escId } from 'ces-ui-kit';
import type { ApprovalDecision } from 'ces-ui-kit';
import type { ConsoleItem, StepView, SubLine, SubView, VerbosePanel } from '../../store/console-events';
import { safeSubId } from '../../store/console-events';
import type { ApprovalTargetKey } from '../../store/console';

const KNOWN_ENGINES = ['mgraph', 'exchange', 'ipps', 'powershell', 'azure', 'az', 'manual_gate', 'spo', 'teams'];

const IDEMPOTENCY_BADGES: Record<string, { cls: string; text: string }> = {
  safe: { cls: 'idemp-safe', text: 'idempotent' },
  'get-then-set': { cls: 'idemp-safe', text: 'idempotent' },
  best_effort: { cls: 'idemp-best-effort', text: 'best-effort' },
  unsafe_requires_gate: { cls: 'idemp-unsafe', text: 'unsafe' },
  unsafe: { cls: 'idemp-unsafe', text: 'unsafe' },
  'evidence-only': { cls: 'idemp-evidence', text: 'evidence' },
};

const SUCCESS_BANNER = { art: '  >>  STAMPED  <<  ', quip: 'All systems nominal. Compliance achieved.' };
const FAIL_BANNER = {
  art: '  x-----------x  \n  | NOT TODAY  |  \n  x-----------x  ',
  quip: 'Some tasks need attention. Check the failures above.',
};

export type Decide = (target: ApprovalTargetKey, decision: ApprovalDecision) => void;

export interface RowOptions {
  verbose: boolean;
  onDecide: Decide;
  onToggleStep: (taskId: string) => void;
}

function EngineBadge({ engine }: { engine?: string }) {
  if (!engine) return null;
  const cls = KNOWN_ENGINES.includes(engine) ? `badge-${engine}` : 'badge-other';
  return <span className={`engine-badge ${cls}`}>{engine}</span>;
}

function DirectiveBadge({ directive }: { directive?: string }) {
  if (directive === 'excluded') return <span className="directive-badge excluded">EXCLUDED</span>;
  if (directive === 'nonstack') return <span className="directive-badge nonstack">NON-STACK</span>;
  return <span className="directive-badge automated">AUTO</span>;
}

function IdempotencyBadge({ idempotency }: { idempotency?: string }) {
  if (!idempotency) return null;
  const m = IDEMPOTENCY_BADGES[idempotency] ?? { cls: 'idemp-evidence', text: idempotency };
  return <span className={`idemp-badge ${m.cls}`}>{m.text}</span>;
}

function truncate(text: string, max: number, verbose: boolean): string {
  return verbose ? text : text.substring(0, max);
}

function Line({ line, verbose }: { line: SubLine; verbose: boolean }) {
  if ('verboseOnly' in line && line.verboseOnly && !verbose) return null;
  switch (line.kind) {
    case 'stream':
      return (
        <>
          <div className="sub-cmd-stream-line">
            <span className={`stream-phase-badge ${line.badgeCls}`}>{line.badge}</span>
            <span className="stream-cmd-text">{truncate(line.command, 300, verbose)}</span>
            <span className="stream-duration">{line.durationMs}ms</span>
          </div>
          {truncate(line.stdout, 500, verbose).trim() ? (
            <div className={`sub-cmd-stream-output${verbose ? ' verbose' : ''}`}>{truncate(line.stdout, 500, verbose)}</div>
          ) : null}
          {line.stderr ? <div className={`sub-cmd-stream-output error${verbose ? ' verbose' : ''}`}>{truncate(line.stderr, 300, verbose)}</div> : null}
          {line.savePath ? <div className="stream-save-path">{`✓ ${line.savePath}`}</div> : null}
        </>
      );
    case 'note':
      return (
        <>
          <div className="sub-cmd-stream-line">
            <span className={`stream-phase-badge ${line.badgeCls}`}>{line.badge}</span>
            <span className="stream-cmd-text">{line.text}</span>
          </div>
          {line.output ? <div className="sub-cmd-stream-output">{line.output}</div> : null}
        </>
      );
    case 'captures':
      return (
        <div className="sub-cmd-captures">
          <span className="stream-phase-badge capture">CAPTURE</span>{' '}
          {line.pairs.map(([k, v], i) => (
            <span key={`${k}-${i}`}>
              <span className="cap-key">{k}</span>=<span className="cap-val">{v}</span>
              {i < line.pairs.length - 1 ? '  ' : ''}
            </span>
          ))}
        </div>
      );
    case 'verify':
      return (
        <div className="sub-cmd-verification">
          <span className={`stream-phase-badge verify ${line.confCls}`}>VERIFY</span>
          <span className={`verify-confidence ${line.confCls}`}>{line.confidence}</span>
          <span className="verify-score">{line.score}</span>
          <span className="verify-checks">{line.checks}</span>
          <span className="verify-reason">{line.reason}</span>
        </div>
      );
  }
}

function VerboseLogPanel({ vlp }: { vlp: VerbosePanel }) {
  return (
    <details className="verbose-log-panel" open>
      <summary className="verbose-log-header">Verbose Log</summary>
      <div className="verbose-log-content">
        <div className="verbose-log-section">
          <div className="verbose-log-section-label">Control IDs</div>
          <div className="verbose-log-control-ids">
            {vlp.controls.length > 0 ? (
              vlp.controls.map((c) => (
                <span key={c} className="verbose-log-control-pill">
                  {c}
                </span>
              ))
            ) : (
              <span className="spa-muted">No control IDs</span>
            )}
          </div>
        </div>
        <div className="verbose-log-section">
          <div className="verbose-log-section-label">Execution Phases</div>
          {vlp.items.map((item, i) =>
            item.kind === 'chunk' ? (
              <div key={i} className="verbose-log-stdout">
                {item.text}
              </div>
            ) : (
              <div key={i}>
                <div className={`verbose-log-phase-label ${item.cls}`}>{item.label}</div>
                {item.command ? <div className="verbose-log-command">{item.command}</div> : null}
                {item.stdout ? <div className="verbose-log-stdout">{item.stdout}</div> : null}
                {item.stderr ? <div className="verbose-log-stdout verbose-log-stderr">{item.stderr}</div> : null}
              </div>
            ),
          )}
        </div>
        {vlp.verdicts.length > 0 ? (
          <div className="verbose-log-section">
            <div className="verbose-log-section-label">Verdict</div>
            {vlp.verdicts.map((v, i) => (
              <div key={i} className="verbose-log-verdict">
                {v.badgeCls ? <span className={`verdict-badge ${v.badgeCls}`}>{v.label}</span> : <span className="verbose-log-verdict-label">{v.label}</span>}
                {v.detail ? <span className="verbose-log-verdict-detail">{v.detail}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function SubRow({ sub, options }: { sub: SubView; options: RowOptions }) {
  const safe = safeSubId(sub.taskId, sub.subId);
  return (
    <div className={`sub-cmd-row${sub.awaiting ? ' awaiting-approval' : ''}`} id={`sub-cmd-${safe}`}>
      <div className="sub-cmd-header">
        <span className="sub-cmd-label">{sub.label}</span>
        <span className="sub-cmd-tag">
          {sub.tagIndex ? (
            <>
              <span className="tag-index">{sub.tagIndex}</span>{' '}
            </>
          ) : null}
          {sub.subId}
        </span>
        <span className={`sub-cmd-status${sub.status ? ` ${sub.status.cls}` : ''}`} id={`sub-status-${safe}`}>
          {sub.status?.text ?? ''}
        </span>
        {sub.verdict ? <span className={`verdict-badge ${sub.verdict.cls}`}>{sub.verdict.text}</span> : null}
      </div>
      {sub.command !== undefined ? (
        <div className="sub-cmd-command-line">
          <span className="sub-cmd-engine">{sub.engine}</span>
          <span className="sub-cmd-arrow">{'▸'}</span>
          <span className="sub-cmd-command">{sub.command}</span>
        </div>
      ) : null}
      {sub.vlp ? <VerboseLogPanel vlp={sub.vlp} /> : null}
      {sub.lines.map((line, i) => (
        <Line key={i} line={line} verbose={options.verbose} />
      ))}
      {sub.liveOut !== null && options.verbose ? (
        <div className="sub-cmd-live-output" id={`live-out-${safe}`}>
          {sub.liveOut}
        </div>
      ) : null}
      {sub.approval ? (
        <ApprovalCard
          mode="single"
          scope="sub"
          taskId={sub.taskId}
          subId={sub.subId}
          preCheck={sub.approval.preCheck}
          idempotency={sub.approval.idempotency}
          onDecision={(decision) => options.onDecide({ scope: 'sub', taskId: sub.taskId, subId: sub.subId }, decision)}
        />
      ) : null}
    </div>
  );
}

export function StepBlock({ step, subs, options }: { step: StepView; subs: Record<string, SubView>; options: RowOptions }) {
  const safe = escId(step.taskId);
  return (
    <div className="spa-step" data-task-id={step.taskId}>
      <button
        type="button"
        className="step-row"
        id={`step-row-${safe}`}
        aria-expanded={step.expanded}
        aria-controls={`sub-container-${safe}`}
        onClick={() => options.onToggleStep(step.taskId)}
      >
        <span className="step-toggle" id={`toggle-${safe}`} aria-hidden="true">
          {step.expanded ? '▼' : '▶'}
        </span>
        <span className="step-id">{step.taskId}</span>
        <EngineBadge engine={step.engine} />
        <DirectiveBadge directive={step.directive} />
        <IdempotencyBadge idempotency={step.idempotency} />
        <span className="step-label">{step.label}</span>
        <span className="step-cmd-count">{step.countLabel}</span>
        <span className={`step-status ${step.status.cls}`} id={`step-status-${safe}`}>
          {step.status.text}
        </span>
      </button>
      {step.approval ? (
        <ApprovalCard
          mode="single"
          scope="task"
          taskId={step.taskId}
          idempotency={step.approval.idempotency}
          onDecision={(decision) => options.onDecide({ scope: 'task', taskId: step.taskId }, decision)}
        />
      ) : null}
      {step.impact ? <div className="downstream-impact">{step.impact}</div> : null}
      {step.stateDiffs.map((diff, i) => (
        <div key={i} className="state-diff-panel">
          <div className="state-col state-before">
            <div className="state-col-label">Before</div>
            <pre>{diff.before}</pre>
          </div>
          <div className="state-col state-after">
            <div className="state-col-label">After</div>
            <pre>{diff.after}</pre>
          </div>
        </div>
      ))}
      <div className="sub-cmd-container expanded" id={`sub-container-${safe}`} hidden={!step.expanded}>
        {step.subKeys.map((key) => (subs[key] ? <SubRow key={key} sub={subs[key]} options={options} /> : null))}
      </div>
    </div>
  );
}

const LOG_ICONS = { info: 'ℹ', success: '✓', warn: '⚠', error: '✗' } as const;

/** A console row after the first execute row, with the kit ConsoleView's markup and classes. */
export function LogRow({ item, last }: { item: Extract<ConsoleItem, { kind: 'log' }>; last: boolean }) {
  const pending = last && item.message.endsWith('...');
  return (
    <div className={`connection-log-row ck-log-row${item.end ? ' spa-end-row' : ''}`} data-level={item.level}>
      <span className="log-time ck-log-time">{item.time}</span>
      <span className={`log-icon ${item.level} ck-log-icon ck-log-${item.level}`} role="img" aria-label={item.level}>
        {LOG_ICONS[item.level]}
      </span>
      <span className="log-msg ck-log-msg">
        {item.message}
        {pending ? <span className="ck-log-spinner" aria-hidden="true" /> : null}
      </span>
    </div>
  );
}

export function ConsoleRow({
  item,
  last,
  steps,
  subs,
  options,
}: {
  item: ConsoleItem;
  last: boolean;
  steps: Record<string, StepView>;
  subs: Record<string, SubView>;
  options: RowOptions;
}) {
  switch (item.kind) {
    case 'log':
      return <LogRow item={item} last={last} />;
    case 'step':
      return steps[item.taskId] ? <StepBlock step={steps[item.taskId]} subs={subs} options={options} /> : null;
    case 'task-approval':
      return (
        <ApprovalCard
          mode="single"
          scope="task"
          taskId={item.taskId}
          idempotency={item.idempotency}
          onDecision={(decision) => options.onDecide({ scope: 'task', taskId: item.taskId }, decision)}
        />
      );
    case 'layer':
      return (
        <ApprovalCard
          mode="single"
          scope="layer"
          layer={item.layer}
          taskCount={item.taskCount}
          onDecision={(decision) => options.onDecide({ scope: 'layer', layer: item.layer }, decision)}
        />
      );
    case 'banner': {
      const b = item.success ? SUCCESS_BANNER : FAIL_BANNER;
      return (
        <div className={`completion-banner ${item.success ? 'success' : 'fail'}`} role="status">
          <div className="banner-art">{b.art}</div>
          <div className="banner-msg">{b.quip}</div>
          <div className="banner-stats">{item.text}</div>
        </div>
      );
    }
  }
}
