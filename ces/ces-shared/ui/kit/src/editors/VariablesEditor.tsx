// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Unified variables editor. Design source: ces-stamper/public/unified-variables.html (Config and
// Variables tabs, search, dirty state, Resolve / Resolve All, Terms of Use PDF row).
// Props in, callbacks out: the screen does GET/PUT /api/tenants/:slug(/variables), /api/resolve-variable,
// /api/resolve-all-variables, /api/file-to-base64 and hands results back.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { TabNav } from '../shell/TabNav';
import { escId, Notice, type EditorNotice } from './shared';
import {
  classifyVariable,
  configToDraft,
  isShownVariable,
  serializeConfig,
  serializeVariables,
  TENANT_CONFIG_SECTIONS,
  TENANT_SLUG_PATTERN,
  TOU_BASE64_PATH,
  TOU_MAX_BYTES,
  TOU_NAME_PATH,
  VARIABLE_CATEGORY_LABELS,
  VARIABLE_CATEGORY_ORDER,
  variablesToDraft,
  variableTooltip,
  type ConfigField,
  type TenantConfig,
  type TenantVariables,
  type VariableCategory,
} from './variables';

export type VariablesTab = 'config' | 'variables';

/** Result of /api/resolve-variable or /api/resolve-all-variables, as the screen passes it back. */
export interface VariableResolution {
  resolved?: Record<string, unknown>;
  ambiguous?: Record<string, readonly string[]>;
  notFound?: readonly string[];
}

export interface TermsOfUseFile {
  fileName: string;
  base64: string;
}

type MaybeAsync<T> = Promise<T> | T;

export interface VariablesEditorProps {
  /** Tenant slug; null, '' or 'dev' shows the legacy "No tenant selected." state. */
  tenant: string | null;
  /** Config file path shown in the header (`#pathHint`). */
  pathHint?: string;
  /** Tenant config as loaded; a new object resets the Config form. */
  config: TenantConfig;
  /** Tenant variables as loaded; a new object resets the Variables form. */
  variables: TenantVariables;
  /** Names /api/resolvable-variables returned. */
  resolvable?: readonly string[];
  initialTab?: VariablesTab;
  onSaveConfig: (config: TenantConfig) => void;
  onSaveConfigAs: (slug: string, config: TenantConfig) => void;
  /** Legacy "Load" (browse tenant files); the screen passes the loaded config back as `config`. */
  onLoadConfig?: () => void;
  onSaveVariables: (variables: TenantVariables) => void;
  onResolve?: (name: string) => MaybeAsync<VariableResolution | void>;
  onResolveAll?: (names: string[]) => MaybeAsync<VariableResolution | void>;
  /** Legacy "Sample" button (POST /api/file-to-base64 with the sample notice PDF). */
  onLoadSampleTermsOfUse?: () => MaybeAsync<TermsOfUseFile | void>;
  /** Save/load outcome from the screen (replaces the legacy toast). */
  notice?: EditorNotice | null;
  headerControls?: ReactNode;
  /** Prepended to every legacy id (only needed when two editors share a page). */
  idPrefix?: string;
}

function matches(query: string, label: string, value: string): boolean {
  return !query || label.toLowerCase().includes(query) || value.toLowerCase().includes(query);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function VariablesEditor(props: VariablesEditorProps) {
  const { tenant, config, variables, idPrefix: p = '' } = props;
  const resolvable = useMemo(() => new Set(props.resolvable ?? []), [props.resolvable]);
  const [tab, setTab] = useState<VariablesTab>(props.initialTab ?? 'config');
  const [search, setSearch] = useState('');
  const [configDraft, setConfigDraft] = useState(() => configToDraft(config));
  const [varDraft, setVarDraft] = useState(() => variablesToDraft(variables));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(TENANT_CONFIG_SECTIONS.map((s) => [s.prefix, !!s.collapsed])),
  );
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<EditorNotice | null>(props.notice ?? null);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setConfigDraft(configToDraft(config)), [config]);
  useEffect(() => setVarDraft(variablesToDraft(variables)), [variables]);
  useEffect(() => setNotice(props.notice ?? null), [props.notice]);

  const query = search.toLowerCase().trim();
  const id = (name: string) => `${p}${name}`;

  if (!tenant || tenant === 'dev') {
    return (
      <div className="ck-editor ck-vars">
        <div className="ck-editor-header">
          <h1 className="ck-editor-title">Variables</h1>
          {props.headerControls}
        </div>
        <div id={id('emptyState')} className="ck-editor-empty">
          <p>No tenant selected.</p>
        </div>
      </div>
    );
  }

  const serializedConfig = serializeConfig(configDraft, config);
  const configDirty = JSON.stringify(serializedConfig) !== JSON.stringify(config);
  const serializedVars = serializeVariables(varDraft);
  // Hidden keys (`_*`, `config_intent.*`) are not in the form, so they do not count as a change (LOG-W8-KIT3 deviation 4).
  const shownOriginal = Object.fromEntries(Object.entries(variables).filter(([name]) => isShownVariable(name)));
  const varsDirty = JSON.stringify(serializedVars) !== JSON.stringify(shownOriginal);

  const setConfigValue = (path: string, value: string) => setConfigDraft((d) => ({ ...d, [path]: value }));
  const setVarValue = (name: string, value: string) => setVarDraft((d) => ({ ...d, [name]: value }));
  const toggleSection = (prefix: string) => setCollapsed((c) => ({ ...c, [prefix]: !c[prefix] }));
  const toggleReveal = (key: string) => setRevealed((r) => ({ ...r, [key]: !r[key] }));

  function applyResolved(resolution: VariableResolution | void): number {
    const resolved = resolution?.resolved ?? {};
    setVarDraft((d) => {
      const next = { ...d };
      for (const [name, value] of Object.entries(resolved)) {
        if (name in next) next[name] = String(value);
      }
      return next;
    });
    return Object.keys(resolved).filter((name) => name in varDraft).length;
  }

  async function resolveOne(name: string) {
    if (!props.onResolve) return;
    try {
      const result = await props.onResolve(name);
      const ambiguous = result?.ambiguous?.[name];
      if (ambiguous) {
        setNotice({ kind: 'error', text: `Multiple ${name} found: ${ambiguous.join(', ')}. Copy and paste the desired value.` });
        return;
      }
      if (result?.resolved && result.resolved[name]) {
        applyResolved({ resolved: { [name]: result.resolved[name] } });
        setNotice({ kind: 'success', text: `Resolved ${name}` });
      }
    } catch (err) {
      setNotice({ kind: 'error', text: `Resolve failed: ${errorText(err)}` });
    }
  }

  async function resolveAll() {
    const empty = Object.keys(varDraft).filter((name) => varDraft[name] === '' && resolvable.has(name));
    if (empty.length === 0) {
      setNotice({ kind: 'error', text: 'No empty resolvable variables to resolve' });
      return;
    }
    if (!props.onResolveAll) return;
    try {
      const result = await props.onResolveAll(empty);
      const count = applyResolved(result);
      let text = `Resolved ${count} variable${count !== 1 ? 's' : ''}`;
      const ambiguous = Object.entries(result?.ambiguous ?? {});
      const notFound = result?.notFound?.length ?? 0;
      if (ambiguous.length > 0) {
        text += `. ${ambiguous.length} ambiguous: ${ambiguous.map(([v, c]) => `${v}: [${c.join(', ')}]`).join('; ')}`;
      }
      if (notFound > 0) text += `. ${notFound} not found`;
      setNotice({ kind: 'success', text });
    } catch (err) {
      setNotice({ kind: 'error', text: `Batch resolve failed: ${errorText(err)}` });
    }
  }

  function confirmSaveAs() {
    const slug = (saveAs ?? '').trim();
    if (!slug) return;
    if (!TENANT_SLUG_PATTERN.test(slug)) {
      setNotice({ kind: 'error', text: 'Invalid slug' });
      return;
    }
    const cfg = serializeConfig(configDraft, config);
    cfg.client = { ...((cfg.client as Record<string, unknown>) ?? {}), slug };
    props.onSaveConfigAs(slug, cfg);
    setSaveAs(null);
  }

  function onTouFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setNotice({ kind: 'error', text: 'Only PDF files accepted' });
      input.value = '';
      return;
    }
    if (file.size > TOU_MAX_BYTES) {
      setNotice({ kind: 'error', text: 'PDF must be under 3 MB' });
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] || '';
      setConfigDraft((d) => ({ ...d, [TOU_NAME_PATH]: file.name, [TOU_BASE64_PATH]: base64 }));
    };
    reader.readAsDataURL(file);
  }

  async function loadSampleTou() {
    if (!props.onLoadSampleTermsOfUse) return;
    try {
      const result = await props.onLoadSampleTermsOfUse();
      if (result) setConfigDraft((d) => ({ ...d, [TOU_NAME_PATH]: result.fileName, [TOU_BASE64_PATH]: result.base64 }));
    } catch (err) {
      setNotice({ kind: 'error', text: `Error loading sample TOU: ${errorText(err)}` });
    }
  }

  function clearTou() {
    setConfigDraft((d) => ({ ...d, [TOU_NAME_PATH]: '', [TOU_BASE64_PATH]: '' }));
    if (fileRef.current) fileRef.current.value = '';
  }

  function sectionHeader(prefix: string, isCollapsed: boolean, children: ReactNode, count: ReactNode, countId?: string) {
    return (
      <h2 className="ck-var-section-heading">
        <button
          type="button"
          className="ck-var-section-toggle var-category-header"
          id={id(`${prefix}Toggle`)}
          aria-expanded={!isCollapsed}
          aria-controls={id(`${prefix}Body`)}
          onClick={() => toggleSection(prefix)}
        >
          <span className="ck-var-chevron" aria-hidden="true">
            {isCollapsed ? '▶' : '▼'}
          </span>
          {children}
          <span className="ck-var-count" id={countId}>
            {count}
          </span>
        </button>
      </h2>
    );
  }

  function configInput(field: ConfigField, inputId: string) {
    const value = configDraft[field.path] ?? '';
    if (field.kind === 'select') {
      return (
        <select id={inputId} data-path={field.path} value={value} onChange={(e) => setConfigValue(field.path, e.target.value)}>
          <option value="">--</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    const secret = field.kind === 'password';
    return (
      <>
        <input
          id={inputId}
          type={secret && !revealed[field.path] ? 'password' : 'text'}
          data-path={field.path}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => setConfigValue(field.path, e.target.value)}
        />
        {secret && field.path !== 'resources.initial_password' ? (
          <button
            type="button"
            className="ck-var-eye var-eye"
            aria-label={`Show ${field.label}`}
            aria-pressed={!!revealed[field.path]}
            onClick={() => toggleReveal(field.path)}
          >
            {'\u{1F441}'}
          </button>
        ) : null}
      </>
    );
  }

  // ── Config tab ──
  let configVisibleTotal = 0;
  const configSections = TENANT_CONFIG_SECTIONS.map((section) => {
    const paths = [...section.fields.map((x) => x.path), ...(section.termsOfUse ? [TOU_NAME_PATH, TOU_BASE64_PATH] : [])];
    const filled = paths.filter((path) => (configDraft[path] ?? '').trim()).length;
    const rows = section.fields.filter((field) => matches(query, field.label, configDraft[field.path] ?? ''));
    const touName = configDraft[TOU_NAME_PATH] ?? '';
    const touVisible = !!section.termsOfUse && matches(query, 'terms_of_use', touName);
    const visible = rows.length + (touVisible ? 1 : 0);
    configVisibleTotal += visible;
    if (query && visible === 0) return null;
    const isCollapsed = query ? false : !!collapsed[section.prefix];
    return (
      <div className="ck-var-section config-section" key={section.prefix}>
        {sectionHeader(section.prefix, isCollapsed, section.title, `${filled}/${paths.length}`, id(`${section.prefix}Count`))}
        <div className="ck-var-body var-category-body" id={id(`${section.prefix}Body`)} hidden={isCollapsed}>
          {rows.map((field) => {
            const inputId = id(`cfg-${field.path}`);
            return (
              <div className={field.resourceId ? 'ck-var-field ck-var-field-wide config-field resource-id' : 'ck-var-field config-field'} key={field.path}>
                <label htmlFor={inputId} title={field.tooltip} data-tooltip={field.tooltip}>
                  {field.label}
                </label>
                {configInput(field, inputId)}
              </div>
            );
          })}
          {touVisible ? (
            <div className="ck-var-field ck-var-tou tou-upload-row">
              <span className="ck-var-tou-label" title="Terms of Use PDF file. User acceptance agreement displayed at login (3MB max).">
                terms_of_use
              </span>
              <span className="ck-var-tou-name" id={id('touFileLabel')}>
                {touName || 'No file selected'}
              </span>
              <button type="button" className="btn btn-secondary" id={id('touBrowseBtn')} onClick={() => fileRef.current?.click()}>
                Browse
              </button>
              {props.onLoadSampleTermsOfUse ? (
                <button type="button" className="btn btn-secondary" id={id('touLoadSampleBtn')} title="Load sample CUI TOU from project" onClick={loadSampleTou}>
                  Sample
                </button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                id={id('touFileInput')}
                accept=".pdf"
                aria-label="Terms of Use PDF"
                className="ck-sr-only"
                tabIndex={-1}
                onChange={onTouFile}
              />
              {touName ? (
                <button type="button" className="btn btn-ghost" id={id('touClearBtn')} aria-label="Clear Terms of Use file" onClick={clearTou}>
                  {'×'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  });

  // ── Variables tab ──
  const groups: Record<VariableCategory, string[]> = { cui: [], tcp: [], si: [] };
  for (const name of Object.keys(varDraft)) groups[classifyVariable(name)].push(name);
  let varVisibleTotal = 0;
  const varSections = VARIABLE_CATEGORY_ORDER.filter((cat) => groups[cat].length > 0).map((cat) => {
    const prefix = `var${cat.toUpperCase()}`;
    const names = groups[cat].filter((name) => matches(query, name, varDraft[name] ?? ''));
    varVisibleTotal += names.length;
    if (query && names.length === 0) return null;
    const isCollapsed = query ? false : !!collapsed[prefix];
    return (
      <div className="ck-var-section config-section" key={cat}>
        {sectionHeader(
          prefix,
          isCollapsed,
          <>
            <span className={`ck-var-cat ck-var-cat-${cat} var-cat-badge ${cat}`}>{cat.toUpperCase()}</span>
            <span>{VARIABLE_CATEGORY_LABELS[cat]}</span>
          </>,
          `${groups[cat].length} vars`,
        )}
        <div className="ck-var-body var-category-body" id={id(`${prefix}Body`)} hidden={isCollapsed}>
          {names.map((name) => {
            const value = varDraft[name] ?? '';
            const empty = value === '';
            const canResolve = resolvable.has(name);
            const secret = cat === 'si';
            const inputId = id(`var-${escId(name)}`);
            const tooltip = variableTooltip(name, cat);
            return (
              <div className={empty ? 'ck-var-field ck-var-missing var-row var-missing' : 'ck-var-field var-row'} key={name}>
                <label htmlFor={inputId} title={`${name}: ${tooltip}`} data-tooltip={tooltip}>
                  {name}
                </label>
                {empty && !canResolve ? (
                  <span className="ck-var-missing-badge var-missing-badge" title="Required by registry entries" aria-label="Required by registry entries">
                    !
                  </span>
                ) : null}
                <input
                  id={inputId}
                  type={secret && !revealed[`var:${name}`] ? 'password' : 'text'}
                  data-var={name}
                  data-resolvable={canResolve ? 'true' : undefined}
                  value={value}
                  onChange={(e) => setVarValue(name, e.target.value)}
                />
                {secret ? (
                  <button
                    type="button"
                    className="ck-var-eye var-eye"
                    title="Show/hide"
                    aria-label={`Show ${name}`}
                    aria-pressed={!!revealed[`var:${name}`]}
                    onClick={() => toggleReveal(`var:${name}`)}
                  >
                    {'\u{1F441}'}
                  </button>
                ) : null}
                {canResolve ? (
                  <button
                    type="button"
                    className="ck-var-resolve var-check-btn"
                    title="Auto-resolve from tenant"
                    aria-label={`Resolve ${name} from tenant`}
                    onClick={() => resolveOne(name)}
                  >
                    {'\u{1F50D}'}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  });

  return (
    <div className="ck-editor ck-vars">
      <div className="ck-editor-header">
        <h1 className="ck-editor-title">Variables</h1>
        <span className="ck-editor-muted">Tenant:</span>
        <span className="ck-editor-mono" id={id('tenantName')}>
          {tenant}
        </span>
        <span className="ck-editor-path" id={id('pathHint')} title={props.pathHint}>
          {props.pathHint ?? ''}
        </span>
        {props.headerControls}
      </div>
      <TabNav
        tabs={[
          { id: 'config', label: 'Config', controls: id('configTab') },
          { id: 'variables', label: 'Variables', controls: id('variablesTab') },
        ]}
        active={tab}
        onChange={(next) => setTab(next as VariablesTab)}
        label="Variables editor"
        idPrefix={id('varsTab-')}
      />
      <div className="ck-editor-search">
        <input
          type="search"
          id={id('searchInput')}
          aria-label="Filter by name or value"
          placeholder="Filter by name or value..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div id={id('configTab')} role="tabpanel" aria-labelledby={id('varsTab-config')} hidden={tab !== 'config'} className="ck-editor-panel">
        <div className="ck-editor-scroll" id={id('configFormScroll')}>
          {configSections}
        </div>
        {query && configVisibleTotal === 0 ? (
          <p className="ck-editor-muted" id={id('configNoResults')}>
            No matches
          </p>
        ) : null}
        <div className="ck-editor-bar" id={id('configBtnBar')}>
          {props.onLoadConfig ? (
            <button type="button" className="btn btn-secondary" onClick={props.onLoadConfig}>
              Load
            </button>
          ) : null}
          {configDirty ? (
            <span className="ck-editor-dirty" id={id('configDirtyHint')}>
              Unsaved changes
            </span>
          ) : null}
          <span className="ck-editor-spacer" />
          <button type="button" className="btn btn-primary" id={id('configSaveBtn')} disabled={!configDirty} onClick={() => props.onSaveConfig(serializedConfig)}>
            Save
          </button>
          {saveAs === null ? (
            <button type="button" className="btn btn-secondary" onClick={() => setSaveAs('')}>
              Save As
            </button>
          ) : (
            <span className="ck-editor-saveas">
              <input
                type="text"
                id={id('saveAsSlug')}
                aria-label="New tenant slug (letters, numbers, hyphens, underscores)"
                placeholder="new-tenant-slug"
                value={saveAs}
                onChange={(e) => setSaveAs(e.target.value)}
              />
              <button type="button" className="btn btn-primary" onClick={confirmSaveAs}>
                Save As
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setSaveAs(null)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>

      <div id={id('variablesTab')} role="tabpanel" aria-labelledby={id('varsTab-variables')} hidden={tab !== 'variables'} className="ck-editor-panel">
        <div className="ck-editor-scroll" id={id('variablesFormScroll')}>
          {Object.keys(varDraft).length === 0 ? (
            <div className="ck-editor-empty">
              <p>No plan variables yet. Variables are created after running Translate.</p>
            </div>
          ) : (
            varSections
          )}
        </div>
        {query && varVisibleTotal === 0 && Object.keys(varDraft).length > 0 ? (
          <p className="ck-editor-muted" id={id('variablesNoResults')}>
            No matches
          </p>
        ) : null}
        <div className="ck-editor-bar" id={id('variablesBtnBar')}>
          <button type="button" className="btn btn-primary" id={id('resolveAllBtn')} onClick={resolveAll}>
            Resolve All
          </button>
          {varsDirty ? (
            <span className="ck-editor-dirty" id={id('variablesDirtyHint')}>
              Unsaved changes
            </span>
          ) : null}
          <span className="ck-editor-spacer" />
          <button type="button" className="btn btn-primary" id={id('variablesSaveBtn')} disabled={!varsDirty} onClick={() => props.onSaveVariables(serializedVars)}>
            Save
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setVarDraft(variablesToDraft(variables))}>
            Cancel
          </button>
        </div>
      </div>
      <Notice notice={notice} id={id('toast')} />
    </div>
  );
}
