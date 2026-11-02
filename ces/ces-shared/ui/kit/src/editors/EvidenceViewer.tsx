// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Evidence viewer. Design sources: ces-stamper/public/evidence-popout.html (pop-out mode) and the
// index.html evidence overlays (#evidenceViewerOverlay L12654, #evidenceModalOverlay L12595).
// Props in, callbacks out: the screen fetches /api/evidence-content and owns window.open/postMessage.
import { useEffect, useRef, type ReactNode } from 'react';
import {
  DEFAULT_EVIDENCE_TITLE,
  evidenceControls,
  evidenceTitle,
  normalizeEvidence,
  verificationTone,
  type EvidenceInput,
  type EvidenceRecord,
} from './evidence';
import { CommandOutput, JsonView } from './shared';

export interface EvidenceNav {
  /** Zero-based position of the shown entry. */
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

interface CommonProps {
  evidence: EvidenceInput | null;
  /** Prepended to every legacy id (only needed when two viewers share a page). */
  idPrefix?: string;
}

export interface EvidenceOverlayProps extends CommonProps {
  mode: 'overlay';
  open: boolean;
  /** Close button, Escape key and backdrop click. */
  onClose: () => void;
  /** Prev/next bar of the legacy evidence modal; shown when total > 1. */
  nav?: EvidenceNav;
}

export interface EvidencePopoutProps extends CommonProps {
  mode: 'popout';
  /** The OK button (legacy posts `evidence_ok` to the opener and closes the window). */
  onOk: () => void;
  /** Slot at the right of the header, e.g. the ThemeToggle. */
  headerControls?: ReactNode;
}

export type EvidenceViewerProps = EvidenceOverlayProps | EvidencePopoutProps;

type Ids = ((name: string) => string) | null;

function KvGrid({ rows, id }: { rows: Array<[string, unknown]>; id?: string }) {
  return (
    <dl className="ck-ev-kv" id={id}>
      {rows.map(([key, value]) => (
        <div className="ck-ev-kv-row" key={key}>
          <dt>{key}</dt>
          <dd>{String(value || 'N/A')}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ id, label, children }: { id?: string; label?: string; children: ReactNode }) {
  return (
    <section className="ck-ev-section" id={id}>
      {label ? <h3 className="ck-ev-label">{label}</h3> : null}
      {children}
    </section>
  );
}

function Collapsible({ id, label, open, children }: { id?: string; label: string; open: boolean; children: ReactNode }) {
  return (
    <details className="ck-ev-section ck-ev-collapsible" id={id} open={open}>
      <summary className="ck-ev-label">{label}</summary>
      {children}
    </details>
  );
}

/** `output` = legacy formatCmdOutput; `text` = escaped text; `template` = escaped text, muted. */
function CommandBox({ label, value, kind }: { label: string; value: unknown; kind: 'output' | 'text' | 'template' }) {
  return (
    <div className="ck-ev-command">
      <h3 className="ck-ev-label">{label}</h3>
      <div className={kind === 'template' ? 'ck-ev-cmd ck-ev-cmd-muted' : 'ck-ev-cmd'}>
        {kind === 'output' ? <CommandOutput value={value} /> : <pre>{String(value)}</pre>}
      </div>
    </div>
  );
}

function EvidenceBody({ record, ids }: { record: EvidenceRecord; ids: Ids }) {
  const id = (name: string) => (ids ? ids(name) : undefined);
  if (record.noEvidence) {
    return (
      <Section>
        <p className="ck-ev-empty-title">No Evidence Found</p>
        <p className="ck-ev-muted">No evidence file exists for this entry.</p>
        <code className="ck-ev-path">{record.expectedPath || 'Unknown path'}</code>
      </Section>
    );
  }

  const verdict = record.complianceVerdict || 'PENDING';
  const meta = record.metadata;
  const reg = record.registryEntry;
  const executed = meta?.commandExecuted || '';
  const fd = record.failureDiagnostics;
  const svd = record.verificationResult?.stateVerificationDetails;
  const evidenceCommands = reg?.evidence_commands ?? [];
  const hasCommands =
    (executed && !executed.startsWith('[manual')) ||
    !!meta?.preStateOutput ||
    !!reg?.get_command ||
    !!reg?.set_command ||
    evidenceCommands.length > 0;

  const metaRows: Array<[string, unknown]> = meta
    ? [
        ['Timestamp', meta.timestamp],
        ['Executor', meta.executorIdentity],
        ['Environment', meta.environment],
        ['SHA-256', meta.sha256Hash],
        ['State Changed', meta.stateChanged != null ? String(meta.stateChanged) : 'N/A'],
        ...Object.entries(meta.moduleVersions ?? {}).map(([mod, version]): [string, unknown] => [`Module: ${mod}`, version]),
      ]
    : [];

  return (
    <>
      <Section id={id('verdictSection')}>
        <div className="ck-ev-verdict-row">
          <span id={id('verdictBadge')} className={`ck-ev-verdict verdict-badge verdict-${verdict}`} data-verdict={verdict}>
            {verdict}
          </span>
          <div className="ck-ev-verdict-text">
            <div className="ck-ev-outcome" id={id('outcomeLabel')}>
              {record.outcome ? `Outcome: ${record.outcome.replace(/_/g, ' ')}` : ''}
            </div>
            <div className="ck-ev-muted" id={id('outcomeRationale')}>
              {record.outcomeRationale || ''}
            </div>
            <div className="ck-ev-muted" id={id('verdictRationale')}>
              {record.verdictRationale || ''}
            </div>
          </div>
        </div>
      </Section>

      {svd ? (
        <Section label="State Verification">
          <div className={`ck-ev-verification ck-ev-tone-${verificationTone(record)}`}>
            <dl className="ck-ev-kv">
              <div className="ck-ev-kv-row">
                <dt>Method</dt>
                <dd>{svd.method}</dd>
              </div>
              <div className="ck-ev-kv-row">
                <dt>Confidence</dt>
                <dd className="ck-ev-confidence">{svd.confidence}</dd>
              </div>
              <div className="ck-ev-kv-row">
                <dt>Score</dt>
                <dd>{`${svd.confidenceScore ?? ''}/100`}</dd>
              </div>
              {svd.expectedValue ? (
                <div className="ck-ev-kv-row">
                  <dt>Expected</dt>
                  <dd>{svd.expectedValue}</dd>
                </div>
              ) : null}
              {svd.matchedValue ? (
                <div className="ck-ev-kv-row">
                  <dt>Matched</dt>
                  <dd>{svd.matchedValue}</dd>
                </div>
              ) : null}
            </dl>
            <p className="ck-ev-muted">{record.verificationResult?.reason}</p>
            {svd.rawExtract ? (
              <details>
                <summary className="ck-ev-muted">Raw Extract</summary>
                <pre className="ck-ev-pre">{svd.rawExtract}</pre>
              </details>
            ) : null}
          </div>
        </Section>
      ) : null}

      {fd ? (
        <Section id={id('failureSection')} label="Failure Diagnostics">
          <div className="ck-ev-failure">
            <div className="ck-ev-failure-root">{`Root Cause: ${fd.rootCause || 'unknown'}`}</div>
            <div className="ck-ev-failure-category">{fd.failureCategory || ''}</div>
            {fd.remediationSteps && fd.remediationSteps.length > 0 ? (
              <ul className="ck-ev-remediation">
                {fd.remediationSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </Section>
      ) : null}

      {hasCommands ? (
        <Section id={id('commandSection')}>
          {executed && !executed.startsWith('[manual') ? <CommandBox label="Command Executed (SET)" value={executed} kind="text" /> : null}
          {meta?.preStateOutput ? <CommandBox label="GET Command Result (Pre-State)" value={meta.preStateOutput} kind="output" /> : null}
          {reg?.get_command ? <CommandBox label="GET Command (Template)" value={reg.get_command} kind="template" /> : null}
          {reg?.set_command ? <CommandBox label="SET Command (Template)" value={reg.set_command} kind="template" /> : null}
          {evidenceCommands.map((cmd, i) => (
            <CommandBox
              key={i}
              label={`Evidence Command${evidenceCommands.length > 1 ? ` ${i + 1}` : ''} (Template)`}
              value={cmd}
              kind="template"
            />
          ))}
        </Section>
      ) : null}

      {record.rawResponse ? (
        <Section id={id('resultsSection')} label="Results Received (Raw Response)">
          <div className="ck-ev-cmd">
            <CommandOutput value={record.rawResponse} />
          </div>
        </Section>
      ) : null}

      {meta?.stateChanged && meta.preStateOutput && meta.postStateOutput ? (
        <Section id={id('stateDiffSection')} label="State Change (Before / After)">
          <div className="ck-ev-diff">
            <div>
              <h4 className="ck-ev-column-label">Before (GET command)</h4>
              <CommandOutput value={meta.preStateOutput} id={id('preState')} />
            </div>
            <div>
              <h4 className="ck-ev-column-label">After (POST-SET GET)</h4>
              <CommandOutput value={meta.postStateOutput} id={id('postState')} />
            </div>
          </div>
        </Section>
      ) : null}

      {reg ? (
        <Collapsible id={id('registrySection')} label="Registry Entry" open>
          <KvGrid
            id={id('registryMetadata')}
            rows={[
              ['Entry ID', reg.entry_id],
              ['Label', reg.label],
              ['Engine', reg.engine],
              ['Layer', reg.layer_hint != null ? `L${reg.layer_hint}` : 'N/A'],
              ['Sequence', reg.sequence_hint != null ? String(reg.sequence_hint) : 'N/A'],
              ['Idempotency', reg.idempotency],
              ['On Failure', reg.on_failure],
              ['Controls', (reg.control_ids || []).join(', ') || 'None'],
            ]}
          />
        </Collapsible>
      ) : null}

      {meta ? (
        <Collapsible id={id('metadataSection')} label="Metadata" open>
          <KvGrid id={id('metadataGrid')} rows={metaRows} />
        </Collapsible>
      ) : null}

      <Collapsible id={id('fullEvidenceSection')} label="Full Evidence JSON" open={false}>
        <JsonView value={record} id={id('fullEvidence')} />
      </Collapsible>
    </>
  );
}

function ControlPills({ controls, id }: { controls: string[]; id?: string }) {
  return (
    <div className="ck-ev-controls" id={id}>
      {controls.map((control) => (
        <span className="ck-ev-pill cmmc-control-pill" key={control}>
          {control}
        </span>
      ))}
    </div>
  );
}

function Overlay({ evidence, open, onClose, nav, idPrefix = '' }: EvidenceOverlayProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const record = evidence == null ? null : normalizeEvidence(evidence);
  const titleId = `${idPrefix}evidenceViewerTitle`;
  return (
    <div
      className="ck-ev-overlay visible"
      id={`${idPrefix}evidenceViewerOverlay`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ck-ev-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ck-ev-dialog-header">
          <h2 className="ck-ev-title" id={titleId}>
            {record ? evidenceTitle(record) : DEFAULT_EVIDENCE_TITLE}
          </h2>
          {nav && nav.total > 1 ? (
            <span className="ck-ev-nav" id={`${idPrefix}evidenceModalNav`}>
              <button
                type="button"
                className="btn btn-ghost"
                id={`${idPrefix}evidenceNavPrevBtn`}
                title="Previous entry"
                aria-label="Previous entry"
                disabled={nav.index === 0}
                onClick={nav.onPrev}
              >
                {'«'}
              </button>
              <span id={`${idPrefix}evidenceNavCounter`}>{`${nav.index + 1}/${nav.total}`}</span>
              <button
                type="button"
                className="btn btn-ghost"
                id={`${idPrefix}evidenceNavNextBtn`}
                title="Next entry"
                aria-label="Next entry"
                disabled={nav.index === nav.total - 1}
                onClick={nav.onNext}
              >
                {'»'}
              </button>
            </span>
          ) : null}
          <button ref={closeRef} type="button" className="ck-ev-close" title="Close" aria-label="Close evidence" onClick={onClose}>
            {'×'}
          </button>
        </div>
        <div className="ck-ev-body" id={`${idPrefix}evidenceViewerBody`}>
          {record ? (
            <>
              <ControlPills controls={evidenceControls(record)} />
              <EvidenceBody record={record} ids={null} />
            </>
          ) : (
            <p className="ck-ev-muted ck-ev-none">No evidence data available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Popout({ evidence, onOk, headerControls, idPrefix = '' }: EvidencePopoutProps) {
  const record = evidence == null ? null : normalizeEvidence(evidence);
  const ids = (name: string) => `${idPrefix}${name}`;
  return (
    <div className="ck-ev-popout evidence-container">
      <div className="ck-ev-popout-header">
        <div>
          <h1 className="ck-ev-title" id={ids('evidenceTitle')}>
            {record ? evidenceTitle(record) : `CES — ${DEFAULT_EVIDENCE_TITLE}`}
          </h1>
          <ControlPills controls={record ? evidenceControls(record) : []} id={ids('cmmcControls')} />
        </div>
        {headerControls}
      </div>
      {record ? <EvidenceBody record={record} ids={ids} /> : null}
      <button type="button" className="btn btn-primary ck-ev-ok" id={ids('okButton')} onClick={onOk}>
        OK
      </button>
    </div>
  );
}

/** Evidence review in the legacy overlay (`mode="overlay"`) or the pop-out window page (`mode="popout"`). */
export function EvidenceViewer(props: EvidenceViewerProps) {
  return props.mode === 'overlay' ? <Overlay {...props} /> : <Popout {...props} />;
}
