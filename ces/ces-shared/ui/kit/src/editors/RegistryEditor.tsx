// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Registry editor. Design source: ces-stamper/public/registry-editor.html (M365/Infra toggle, entry_id
// search, entry navigation, seven form sections, Resolve GET/SET, Copy, variable status).
// Props in, callbacks out: the screen does GET /api/registry/:type, PUT /api/registry/:type/:entryId
// and POST /api/registry/resolve.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Notice, type EditorNotice } from './shared';
import {
  collectRegistryEntry,
  entryToDraft,
  REGISTRY_ENGINES,
  REGISTRY_IDEMPOTENCY,
  REGISTRY_ON_FAILURE,
  resolveBoxText,
  type CommandResolution,
  type RegistryDraft,
  type RegistryEntry,
  type RegistryType,
} from './registry';

type MaybeAsync<T> = Promise<T> | T;

export interface RegistryEditorProps {
  registryType: RegistryType;
  /** Entries of `registryType` as loaded. */
  entries: readonly RegistryEntry[];
  onRegistryTypeChange: (type: RegistryType) => void;
  /** Save: the collected entry, with the legacy keys (PUT /api/registry/:type/:entryId). */
  onSave: (type: RegistryType, entry: RegistryEntry) => void;
  /** Tenant slug; resolve needs one that is not 'dev'. */
  tenant?: string | null;
  onResolveCommand?: (which: 'get' | 'set', command: string) => MaybeAsync<CommandResolution>;
  /** Called with each entry shown, so the screen can run the variable check (POST /api/registry/resolve). */
  onEntryShown?: (entry: RegistryEntry) => void;
  /** Variable check result for the shown entry; null hides the indicator. */
  varStatus?: { unresolved: readonly string[] } | null;
  notice?: EditorNotice | null;
  headerControls?: ReactNode;
  /** Prepended to every legacy id (only needed when two editors share a page). */
  idPrefix?: string;
}

const SECTIONS = [
  { id: 'regSecCore', title: 'Core', collapsed: false },
  { id: 'regSecExec', title: 'Execution', collapsed: false },
  { id: 'regSecVars', title: 'Variables', collapsed: true },
  { id: 'regSecDeps', title: 'Dependencies', collapsed: true },
  { id: 'regSecFlags', title: 'Flags', collapsed: true },
  { id: 'regSecEvid', title: 'Evidence', collapsed: true },
  { id: 'regSecNotes', title: 'Notes', collapsed: true },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function RegistryEditor(props: RegistryEditorProps) {
  const { registryType, entries, tenant, idPrefix: p = '' } = props;
  const id = (name: string) => `${p}${name}`;
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.id, s.collapsed])),
  );
  const [resolveBox, setResolveBox] = useState<string | null>(null);
  const [notice, setNotice] = useState<EditorNotice | null>(props.notice ?? null);

  const term = search.toLowerCase().trim();
  const filtered = useMemo(
    () => (term ? entries.filter((e) => e.entry_id.toLowerCase().includes(term)) : entries),
    [entries, term],
  );
  const current: RegistryEntry | undefined = filtered[index];
  const [draft, setDraft] = useState<RegistryDraft | null>(() => (current ? entryToDraft(current) : null));

  useEffect(() => setSearch(''), [registryType]);
  useEffect(() => setIndex(0), [entries, term]);
  useEffect(() => {
    setDraft(current ? entryToDraft(current) : null);
    setResolveBox(null);
    if (current) props.onEntryShown?.(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  useEffect(() => setNotice(props.notice ?? null), [props.notice]);

  const set = <K extends keyof RegistryDraft>(key: K, value: RegistryDraft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const hasTenant = !!tenant && tenant !== 'dev';

  function save() {
    if (!draft) return;
    const result = collectRegistryEntry(draft);
    if ('error' in result) {
      setNotice({ kind: 'error', text: result.error });
      return;
    }
    props.onSave(registryType, result.entry);
  }

  async function resolve(which: 'get' | 'set') {
    if (!hasTenant) {
      setNotice({ kind: 'error', text: 'Select a tenant first' });
      return;
    }
    const cmd = (which === 'get' ? draft?.get_command : draft?.set_command)?.trim() ?? '';
    if (!cmd) {
      setNotice({ kind: 'error', text: `No ${which.toUpperCase()} command to resolve` });
      return;
    }
    if (!props.onResolveCommand) return;
    try {
      setResolveBox(resolveBoxText(which, await props.onResolveCommand(which, cmd)));
    } catch (err) {
      setNotice({ kind: 'error', text: `Resolve failed: ${errorText(err)}` });
    }
  }

  async function copy() {
    if (!resolveBox) {
      setNotice({ kind: 'error', text: 'Nothing to copy' });
      return;
    }
    try {
      await navigator.clipboard.writeText(resolveBox);
      setNotice({ kind: 'success', text: 'Copied to clipboard' });
    } catch {
      setNotice({ kind: 'error', text: 'Copy failed' });
    }
  }

  const field = (key: keyof RegistryDraft, label: string, control: ReactNode) => (
    <div className="ck-reg-field registry-field" key={key}>
      <label htmlFor={id(`reg_${key}`)}>{label}</label>
      {control}
    </div>
  );
  const text = (key: Exclude<keyof RegistryDraft, 'manual_only'>, label: string, rows?: number, readOnly?: boolean) =>
    field(
      key,
      label,
      rows ? (
        <textarea id={id(`reg_${key}`)} rows={rows} value={draft ? draft[key] : ''} onChange={(e) => set(key, e.target.value)} />
      ) : (
        <input
          id={id(`reg_${key}`)}
          type={key === 'layer_hint' || key === 'sequence_hint' ? 'number' : 'text'}
          readOnly={readOnly}
          value={draft ? draft[key] : ''}
          onChange={(e) => set(key, e.target.value)}
        />
      ),
    );
  const select = (key: 'engine' | 'idempotency' | 'on_failure', label: string, options: readonly string[]) =>
    field(
      key,
      label,
      <select id={id(`reg_${key}`)} value={draft ? draft[key] : ''} onChange={(e) => set(key, e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>,
    );

  const sectionBody: Record<SectionId, ReactNode> = {
    regSecCore: [text('entry_id', 'entry_id', undefined, true), text('control_ids', 'control_ids', 2), text('label', 'label')],
    regSecExec: [
      select('engine', 'engine', REGISTRY_ENGINES),
      text('get_command', 'get_command', 3),
      text('set_command', 'set_command', 3),
      select('idempotency', 'idempotency', REGISTRY_IDEMPOTENCY),
    ],
    regSecVars: [
      text('variables_required', 'variables_required', 2),
      text('variables_runtime', 'variables_runtime', 2),
      text('captures', 'captures (JSON)', 3),
    ],
    regSecDeps: [text('layer_hint', 'layer_hint'), text('sequence_hint', 'sequence_hint')],
    regSecFlags: [
      <div className="ck-reg-field ck-reg-check registry-field" key="manual_only">
        <label>
          <input
            type="checkbox"
            id={id('reg_manual_only')}
            checked={!!draft?.manual_only}
            onChange={(e) => set('manual_only', e.target.checked)}
          />{' '}
          manual_only
        </label>
      </div>,
      select('on_failure', 'on_failure', REGISTRY_ON_FAILURE),
    ],
    regSecEvid: [text('evidence_commands', 'evidence_commands (one per line)', 3), text('verification', 'verification (JSON)', 3)],
    regSecNotes: [text('notes', 'notes', 3)],
  };

  const unresolved = props.varStatus?.unresolved ?? [];
  const showVarStatus = hasTenant && !!current && !!props.varStatus;

  return (
    <div className="ck-editor ck-reg">
      <div className="ck-editor-header">
        <h1 className="ck-editor-title">Registry Editor</h1>
        <span className="ck-editor-spacer" />
        {props.headerControls}
      </div>
      <div className="ck-editor-bar ck-reg-bar">
        <div className="ck-reg-toggle" role="group" aria-label="Registry">
          <button
            type="button"
            className={registryType === 'm365' ? 'btn btn-primary' : 'btn btn-secondary'}
            id={id('regToggleM365')}
            aria-pressed={registryType === 'm365'}
            onClick={() => props.onRegistryTypeChange('m365')}
          >
            M365
          </button>
          <button
            type="button"
            className={registryType === 'infra' ? 'btn btn-primary' : 'btn btn-secondary'}
            id={id('regToggleInfra')}
            aria-pressed={registryType === 'infra'}
            onClick={() => props.onRegistryTypeChange('infra')}
          >
            Infra
          </button>
        </div>
        <input
          type="search"
          id={id('searchInput')}
          aria-label="Search entry_id"
          placeholder="Search entry_id..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn btn-ghost" title="Clear search" aria-label="Clear search" onClick={() => setSearch('')}>
          {'×'}
        </button>
        <span className="ck-editor-muted" id={id('searchResultsCount')}>
          {term ? `${filtered.length} of ${entries.length}` : ''}
        </span>
        <span className="ck-editor-mono" id={id('registryEntryCounter')} aria-live="polite">
          {`Entry ${filtered.length ? index + 1 : 0} of ${filtered.length}`}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          id={id('regPrevBtn')}
          title="Previous entry"
          aria-label="Previous entry"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          {'◀'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          id={id('regNextBtn')}
          title="Next entry"
          aria-label="Next entry"
          disabled={index >= filtered.length - 1}
          onClick={() => setIndex((i) => Math.min(filtered.length - 1, i + 1))}
        >
          {'▶'}
        </button>
        <span className="ck-editor-spacer" />
        <button type="button" className="btn btn-primary" id={id('regSaveBtn')} disabled={!current} onClick={save}>
          Save
        </button>
      </div>
      <div className="ck-editor-bar ck-reg-bar">
        <button type="button" className="btn btn-primary" onClick={() => resolve('get')}>
          Resolve GET
        </button>
        <button type="button" className="btn btn-primary" onClick={() => resolve('set')}>
          Resolve SET
        </button>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          Copy
        </button>
        {showVarStatus ? (
          <span
            className={unresolved.length > 0 ? 'ck-reg-varstatus ck-reg-varstatus-missing var-status has-missing' : 'ck-reg-varstatus ck-reg-varstatus-ok var-status all-resolved'}
            id={id('varStatusIndicator')}
          >
            <span id={id('varStatusIcon')} aria-hidden="true">
              {unresolved.length > 0 ? '⚠' : '✓'}
            </span>{' '}
            <span id={id('varStatusText')}>{unresolved.length > 0 ? `Missing: ${unresolved.join(', ')}` : 'All vars OK'}</span>
          </span>
        ) : null}
      </div>
      {resolveBox !== null ? (
        <pre className="ck-reg-resolve" id={id('registryResolveBox')}>
          {resolveBox}
        </pre>
      ) : null}
      <div className="ck-editor-scroll" id={id('registryFormContainer')}>
        {current && draft ? (
          SECTIONS.map((section) => {
            const isCollapsed = !!collapsed[section.id];
            return (
              <div className="ck-reg-section registry-section" id={id(section.id)} key={section.id} data-collapsed={isCollapsed}>
                <h2 className="ck-var-section-heading">
                  <button
                    type="button"
                    className="ck-var-section-toggle registry-section-header"
                    aria-expanded={!isCollapsed}
                    aria-controls={id(`${section.id}Body`)}
                    onClick={() => setCollapsed((c) => ({ ...c, [section.id]: !c[section.id] }))}
                  >
                    <span className="ck-var-chevron" aria-hidden="true">
                      {isCollapsed ? '▶' : '▼'}
                    </span>
                    {section.title}
                  </button>
                </h2>
                <div className="ck-var-body registry-section-body" id={id(`${section.id}Body`)} hidden={isCollapsed}>
                  {sectionBody[section.id]}
                </div>
              </div>
            );
          })
        ) : (
          <p className="ck-editor-muted ck-editor-center">No entries found.</p>
        )}
      </div>
      <Notice notice={notice} id={id('toast')} />
    </div>
  );
}
