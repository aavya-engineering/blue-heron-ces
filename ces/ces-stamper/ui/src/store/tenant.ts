// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Tenant card (legacy card 0) state, plus the pieces cards 0-2 share: the one active event
// stream for connect, assess, baseline and preflight (activeEventSource) and the connection
// state. W8-SPAW: the status bar (#statusBar), the console log (#taskList) and the run log are
// not kept here; `showStatus`, `appendLog`, `clearLog` and the run-log helpers write to the one
// app-wide console store (./console), and the connection state is mirrored into the execute
// store's gate (`setConnected`). Plan paths live in the translate store (./translate).
// Behaviour source: ces-stamper/public/index.html (line numbers cited per function).

import { create } from 'zustand';
import type {
  EventSourceFactory,
  EventSourceLike,
  LogLevel,
  PrereqCertificate,
  PrereqModule,
  PrereqStatus,
} from 'ces-ui-kit';
import { stamperApi, stamperStreams } from '../api';
import { useWorkflowStore } from './workflow';
import {
  accumulateRunLog as accumulateConsoleRunLog,
  claimStreamSlot,
  closeStreamSlot,
  currentRunLog,
  finishRunLog,
  initRunLog as initConsoleRunLog,
  releaseStreamSlot,
  streamInSlot,
  useConsoleStore,
} from './console';
import type { ExecEvent, RunLog, StatusTone } from './console-events';
import { autoSaveRunLog, useExecuteStore } from './execute';
import { useTranslateStore } from './translate';

export { autoSaveRunLog, currentRunLog, finishRunLog };

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
export type StatusType = StatusTone;

/** One row of GET /api/tenants (tenant.routes.ts L127). */
export interface TenantSummary {
  slug: string;
  client_name: string;
  environment: string;
  cert_expires?: string;
}

export const DEV_SLUG = 'dev';
export const DEV_OPTION_LABEL = '-- No Tenant (Dev Mode) --';
export const LAST_TENANT_KEY = 'stamper_lastTenant';
export type FixtureSet = 'full' | 'synthetic';
export type CardBadgeClass = 'status-default' | 'status-running' | 'status-done' | 'status-error' | 'status-locked';

/** The select's option text (legacy loadTenants L6172). */
export function tenantOptionLabel(t: TenantSummary): string {
  return t.slug === DEV_SLUG ? DEV_OPTION_LABEL : `${t.client_name} (${t.environment})`;
}

/** Legacy `HH:MM:SS` log time (appendConnectionLog L6143). */
export function formatLogTime(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Legacy tenantConfigLabel title (setTenantConnectionState L6960). */
export function connectionTitle(message?: string, nextStep?: string): string {
  return message ? message + (nextStep ? ` — ${nextStep}` : '') : '';
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

// ---- Event streams (legacy activeEventSource: one at a time across connect/assess/baseline/preflight) ----

let eventSourceFactory: EventSourceFactory = (url) => new EventSource(url) as unknown as EventSourceLike;
// FIN-33: the active stream lives in the console store's one slot, shared with execute.

/** Test seam: replace how streams are opened (returns the previous factory). */
export function setEventSourceFactory(next: EventSourceFactory): EventSourceFactory {
  const previous = eventSourceFactory;
  eventSourceFactory = next;
  return previous;
}

/** Opens a stream with the legacy handlers: JSON `message` events, errors swallowed per event. */
export function openStream(url: string, onEvent: (d: StreamEvent) => void, onError: () => void): EventSourceLike {
  const source = eventSourceFactory(url);
  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(String(e.data)) as StreamEvent);
    } catch {
      /* legacy: try { ... } catch (_err) {} */
    }
  };
  source.onerror = () => onError();
  return source;
}

/** Opens the shared active stream (closing nothing: callers close first where legacy does). */
export function openActiveStream(url: string, onEvent: (d: StreamEvent) => void, onError: () => void): EventSourceLike {
  const source = openStream(url, onEvent, onError);
  claimStreamSlot('tenant', source);
  return source;
}

/** Closes the one active stream, whoever opened it (legacy: a connect or assess closes an execute). */
export function closeActiveStream(): void {
  closeStreamSlot('tenant');
}

/** Legacy `evtSource.close(); activeEventSource = null;` from inside a stream's own handler. */
export function releaseActiveStream(source: EventSourceLike): void {
  releaseStreamSlot(source);
}

/** True while any stream (connect, assess, baseline, preflight or execute) is open. */
export function hasActiveStream(): boolean {
  return streamInSlot() !== null;
}

/** Server-sent event payloads are untyped JSON objects; handlers read the fields they need. */
export type StreamEvent = Record<string, any>;

// ---- Run log (legacy initRunLog L5285, accumulateRunLog L5304): the console store's one run log ----

/**
 * Legacy initRunLog: plan path from #outputPath (the translate store), tenant from the select,
 * mode and dry run from the Execute card (selectedExecMode, selectedDryRun). Preflight and
 * tenant operations override mode and plan path, as legacy does after the call.
 */
export function initRunLog(overrides: { mode?: string; planPath?: string } = {}): RunLog {
  const exec = useExecuteStore.getState();
  const builder = initConsoleRunLog({
    planPath: overrides.planPath ?? useTranslateStore.getState().outputPath.trim(),
    tenant: useTenantStore.getState().slug || DEV_SLUG,
    mode: overrides.mode ?? exec.mode,
    dryRun: exec.target === 'dryrun',
  });
  return builder.log;
}

/** Cards 0-2 stream non-execute events, so only the run log's console log grows (L5306). */
export function accumulateRunLog(d: StreamEvent): void {
  accumulateConsoleRunLog(d as ExecEvent);
}

// ---- Run-end toast (legacy notifyRunEnd L6087) ----

export type RunFlow = 'assess' | 'preflight';

export const RUN_QUIPS: Readonly<Record<string, readonly string[]>> = {
  assess_ok: [
    'Recon complete. Intel secured.',
    'Scanned and catalogued. Nice estate you got there.',
    "Assessment locked in. Now we know what we're working with.",
    'Evidence sweep done. Your infra has been thoroughly judged.',
    'Readiness check: passed the vibe check.',
  ],
  assess_fail: ['Assessment hit some bumps. Check the logs.', "Couldn't reach everything. Some infra is playing hard to get."],
  preflight_ok: [
    'All permissions verified. Green light.',
    "Preflight passed. You're cleared for takeoff.",
    'Permissions locked in. Ready to execute.',
    'Access granted across the board.',
    'Preflight clean. No blockers detected.',
  ],
  preflight_fail: ['Some permissions missing. Check the results above.', 'Preflight hit some gaps. Review before proceeding.'],
};

const RUN_TITLES: Record<RunFlow, [string, string]> = {
  assess: ['Assessment Complete', 'Assessment Finished (errors)'],
  preflight: ['Preflight Complete', 'Preflight Finished (errors)'],
};

export interface RunToast {
  title: string;
  quip: string;
  stats: string;
  success: boolean;
}

// ---- Store ----

export interface PrereqPanelState {
  modules: PrereqModule[];
  certificate: PrereqCertificate | null;
}

export interface TenantState {
  bootstrapped: boolean;
  tenants: TenantSummary[];
  /** The #tenantSelect value. */
  slug: string;
  connection: ConnectionState;
  /** #tenantConfigLabel title. */
  connectionTitle: string;
  gateAllowed: boolean;
  addTenantOpen: boolean;
  tenantJson: string;
  fixtureSet: FixtureSet;
  prereq: PrereqPanelState | null;
  /** Cached GET /api/tenants/:slug `config` (legacy tenantConfigOriginal). */
  tenantConfig: Record<string, unknown>;
  tenantVariables: Record<string, unknown>;
  preflightRunning: boolean;
  collapsed: boolean;
  toast: RunToast | null;

  /** Writes the console store's #statusBar. */
  showStatus: (message: string, type?: StatusType) => void;
  clearStatus: () => void;
  /** Appends a row to the console store's #taskList. */
  appendLog: (message: string, level?: LogLevel) => void;
  /** Clears the console store's #taskList (and the prerequisites panel inside it). */
  clearLog: () => void;
  setConnectionState: (state: ConnectionState, message?: string, nextStep?: string) => void;
  setSlug: (slug: string) => void;
  toggleCard: () => void;
  setFixtureSet: (value: FixtureSet) => void;
  openAddTenant: () => void;
  closeAddTenant: () => void;
  setTenantJson: (text: string) => void;
  /** GET /api/tenants; picks the stored last tenant or dev. False when the load failed. */
  loadTenants: () => Promise<boolean>;
  loadTenantConfig: (slug: string) => Promise<void>;
  loadTenantVariables: (slug: string) => Promise<void>;
  toggleGate: (allow: boolean) => void;
  resetGate: () => void;
  connect: (slug: string) => void;
  installModule: (name: string, skipAutoCheck?: boolean) => Promise<boolean>;
  installAll: (names: string[]) => Promise<void>;
  importCert: (certPath: string, password: string) => Promise<void>;
  checkAllPrereqsInstalled: () => void;
  preflight: () => void;
  notifyRunEnd: (flow: RunFlow, success: boolean, stats: string) => void;
  dismissToast: () => void;
  reset: () => void;
}

const DEV_TENANT: TenantSummary = { slug: DEV_SLUG, client_name: 'Dev Mode (no credentials)', environment: 'dev' };

function initialState() {
  return {
    bootstrapped: false,
    tenants: [DEV_TENANT],
    slug: DEV_SLUG,
    connection: 'disconnected' as ConnectionState,
    connectionTitle: '',
    gateAllowed: false,
    addTenantOpen: false,
    tenantJson: '',
    fixtureSet: 'full' as FixtureSet,
    prereq: null,
    tenantConfig: {},
    tenantVariables: {},
    preflightRunning: false,
    collapsed: false,
    toast: null,
  };
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function setPrereqStatus(name: string | null, status: PrereqStatus) {
  useTenantStore.setState((s) => {
    if (!s.prereq) return {};
    if (name === null) {
      return s.prereq.certificate ? { prereq: { ...s.prereq, certificate: { ...s.prereq.certificate, status } } } : {};
    }
    return { prereq: { ...s.prereq, modules: s.prereq.modules.map((m) => (m.name === name ? { ...m, status } : m)) } };
  });
}

export const useTenantStore = create<TenantState>()((set, get) => ({
  ...initialState(),

  showStatus: (message, type = 'info') => useConsoleStore.getState().setStatus(message, type),
  clearStatus: () => useConsoleStore.getState().clearStatus(),

  appendLog: (message, level = 'info') => useConsoleStore.getState().appendLog(message, level),
  clearLog: () => {
    useConsoleStore.getState().clearLog();
    set({ prereq: null });
  },

  // The execute store's gate follows this one state (legacy tenantConnectionState).
  setConnectionState: (state, message, nextStep) => {
    set({ connection: state, connectionTitle: state === 'disconnected' ? '' : connectionTitle(message, nextStep) });
    useExecuteStore.getState().setConnected(state === 'connected');
  },

  setSlug: (slug) => set({ slug }),
  toggleCard: () => set((s) => ({ collapsed: !s.collapsed })),
  setFixtureSet: (value) => set({ fixtureSet: value }),
  openAddTenant: () => set({ addTenantOpen: true }),
  closeAddTenant: () => set({ addTenantOpen: false, tenantJson: '' }),
  setTenantJson: (text) => set({ tenantJson: text }),

  // L6163
  loadTenants: async () => {
    try {
      const tenants = (await stamperApi.listTenants()) as TenantSummary[];
      if (!Array.isArray(tenants)) throw new Error('tenants.forEach is not a function');
      const last = storage()?.getItem(LAST_TENANT_KEY) ?? null;
      const slug = last && tenants.some((t) => t.slug === last) ? last : DEV_SLUG;
      set({ tenants, slug });
      return true;
    } catch (e) {
      get().showStatus(`Failed to load tenants: ${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
  },

  // L6312
  loadTenantConfig: async (slug) => {
    set({ tenantConfig: {} });
    const workflow = useWorkflowStore.getState();
    if (slug === DEV_SLUG) {
      workflow.setStepState('configure', 'done');
      return;
    }
    try {
      const data = (await stamperApi.getTenant(slug)) as { ok?: boolean; config?: Record<string, unknown> };
      if (!data || !data.ok) return;
      set({ tenantConfig: data.config || {} });
      useWorkflowStore.getState().setStepState('configure', 'done');
    } catch {
      useWorkflowStore.getState().setStepState('configure', 'failed');
    }
  },

  // L6245
  loadTenantVariables: async (slug) => {
    if (!slug || slug === DEV_SLUG) return;
    try {
      const data = (await stamperApi.getTenantVariables(slug)) as { ok?: boolean; variables?: Record<string, unknown> };
      if (data && data.ok) set({ tenantVariables: data.variables || {} });
    } catch {
      /* legacy: catch (e) {} */
    }
  },

  // L4995
  toggleGate: (allow) => {
    set({ gateAllowed: allow });
    if (allow) {
      const slug = get().slug;
      if (slug && slug !== DEV_SLUG) get().connect(slug);
    } else {
      closeActiveStream();
      get().setConnectionState('disconnected');
    }
  },
  resetGate: () => set({ gateAllowed: false }),

  // L6339 doTenantConnect + L6372 handleConnectEvent
  connect: (slug) => {
    closeActiveStream();
    get().clearLog();
    get().setConnectionState('connecting', `Connecting to ${slug}...`, 'Checking prerequisites');
    get().showStatus('Connecting to tenant...', 'info');
    const source = openActiveStream(
      stamperStreams.connect(slug),
      (d) => handleConnectEvent(d),
      () => {
        get().showStatus('Connection stream error.', 'error');
        get().setConnectionState('error', 'Connection failed', 'Check network and retry');
        releaseActiveStream(source);
      },
    );
  },

  // L6565
  installModule: (name, skipAutoCheck = false) =>
    new Promise<boolean>((resolve) => {
      setPrereqStatus(name, 'working');
      const source = openStream(
        stamperStreams.installPrereq(name),
        (d) => {
          if (d['type'] === 'install_progress') {
            get().appendLog(String(d['message']), 'info');
          } else if (d['type'] === 'install_done') {
            source.close();
            if (d['success']) {
              setPrereqStatus(name, 'done');
              get().appendLog(`${name} installed successfully`, 'success');
              if (!skipAutoCheck) get().checkAllPrereqsInstalled();
              resolve(true);
            } else {
              setPrereqStatus(name, 'failed');
              get().appendLog(`${name} installation failed`, 'error');
              resolve(false);
            }
          }
        },
        () => {
          source.close();
          setPrereqStatus(name, 'failed');
          resolve(false);
        },
      );
    }),

  // L6610 (module rows only; see LOG-W8-SPA1 deviations)
  installAll: async (names) => {
    for (const name of names) await get().installModule(name, true);
    get().checkAllPrereqsInstalled();
  },

  // L6501
  importCert: async (certPath, password) => {
    if (!password) {
      get().appendLog('Enter the PFX password to import', 'warn');
      return;
    }
    setPrereqStatus(null, 'working');
    try {
      await stamperApi.importCert(certPath, password, (d) => {
        if (d['type'] === 'install_progress') {
          get().appendLog(String(d['message']), 'info');
        } else if (d['type'] === 'install_done') {
          if (d['success']) {
            setPrereqStatus(null, 'done');
            get().appendLog('Certificate imported successfully', 'success');
            get().checkAllPrereqsInstalled();
          } else {
            setPrereqStatus(null, 'failed');
            get().appendLog('Certificate import failed — check password', 'error');
          }
        }
      });
    } catch {
      setPrereqStatus(null, 'failed');
    }
  },

  // L6626
  checkAllPrereqsInstalled: () => {
    const panel = get().prereq;
    if (!panel) return;
    const statuses = [...(panel.certificate ? [panel.certificate.status] : []), ...panel.modules.map((m) => m.status)];
    if (!statuses.every((s) => s === 'done')) return;
    get().appendLog('All prerequisites satisfied — retrying connection...', 'info');
    const slug = get().slug;
    if (slug && slug !== DEV_SLUG) {
      set({ prereq: null });
      get().connect(slug);
    }
  },

  // L7119 doPreflight + L7155 handlePreflightEvent
  preflight: () => {
    const slug = get().slug;
    if (!slug || slug === DEV_SLUG) {
      get().showStatus('Select a tenant before running preflight.', 'error');
      return;
    }
    set({ preflightRunning: true });
    get().showStatus('Running preflight permission check...', 'info');
    get().clearLog();
    initRunLog({ mode: 'preflight', planPath: '' });
    const source = openActiveStream(
      stamperStreams.preflight(slug),
      (d) => handlePreflightEvent(d),
      () => {
        releaseActiveStream(source);
        set({ preflightRunning: false });
        finishRunLog();
      },
    );
  },

  notifyRunEnd: (flow, success, stats) => {
    const [ok, fail] = RUN_TITLES[flow];
    const title = success ? ok : fail;
    const list = RUN_QUIPS[`${flow}${success ? '_ok' : '_fail'}`] ?? ['Done.'];
    const quip = list[Math.floor(Math.random() * list.length)] ?? 'Done.';
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { title, quip, stats, success } });
    toastTimer = setTimeout(() => set({ toast: null }), 6000);
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body: quip + (stats ? `\n${stats}` : ''), icon: '/favicon.ico' });
      }
    } catch {
      /* legacy: catch (_e) {} */
    }
    if (typeof document !== 'undefined') {
      const original = document.title;
      document.title = `${success ? '✓ ' : '✗ '}${title}`;
      setTimeout(() => {
        document.title = original;
      }, 4000);
    }
  },
  dismissToast: () => set({ toast: null }),

  reset: () => {
    closeActiveStream();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set(initialState());
  },
}));

function handleConnectEvent(d: StreamEvent): void {
  const s = useTenantStore.getState();
  const type = d['type'];
  if (type === 'prereq_check') {
    const level: LogLevel = d['installed'] ? 'success' : d['required'] ? 'error' : 'warn';
    const ver = d['version'] ? ` v${d['version']}` : '';
    s.appendLog(`${d['module']}${ver} — ${d['installed'] ? 'installed' : 'not found'}`, level);
  } else if (type === 'prereq_blocked') {
    s.appendLog(String(d['message']), 'error');
    s.setConnectionState('error', d['cert_missing'] ? 'Missing prerequisites' : 'Missing modules', 'Install required prerequisites');
    s.showStatus(String(d['message']), 'error');
    const missing: string[] = Array.isArray(d['missing']) ? d['missing'] : [];
    useTenantStore.setState({
      prereq: {
        modules: missing.map((name) => ({ name, status: 'missing' as PrereqStatus })),
        certificate: d['cert_missing']
          ? { thumbprint: String(d['thumbprint'] || ''), path: String(d['cert_path'] || ''), status: 'missing' }
          : null,
      },
    });
    closeActiveStream();
  } else if (type === 'connection_log') {
    const phase = d['phase'];
    const message = String(d['message'] ?? '');
    if (phase === 'config_loaded') {
      s.setConnectionState('connecting', `Config loaded — ${d['tenant']}`, 'Checking prerequisites');
      s.appendLog(message, 'info');
    } else if (phase === 'prereqs_ok' || phase === 'connected_graph' || phase === 'connected_exchange') {
      s.appendLog(message, 'success');
    } else if (phase === 'connecting_graph' || phase === 'connecting_exchange') {
      s.appendLog(message, 'info');
    } else if (phase === 'error_graph' || phase === 'error_exchange') {
      s.appendLog(message, 'error');
    } else if (phase === 'done') {
      const errors = useConsoleStore.getState().items.filter((r) => r.kind === 'log' && r.level === 'error').length;
      if (errors > 0) {
        s.setConnectionState('error', `${d['tenant']} — partial connection`, 'Some sessions failed');
        s.showStatus('Connection check complete — some sessions failed', 'error');
      } else {
        s.setConnectionState('connected', String(d['tenant']), '');
        s.showStatus('Connected to tenant', 'success');
        s.appendLog('Tenant connection complete — all sessions active', 'success');
        const workflow = useWorkflowStore.getState();
        workflow.setStepState('tenant', 'done');
        workflow.setStepState('configure', 'done');
      }
      closeActiveStream();
    } else {
      s.appendLog(String(d['message'] || phase), 'info');
    }
  } else if (type === 'error') {
    s.setConnectionState('error', 'Connection failed', String(d['message']));
    s.showStatus(`Connection error: ${d['message']}`, 'error');
    s.appendLog(String(d['message']), 'error');
    closeActiveStream();
  }
}

function handlePreflightEvent(d: StreamEvent): void {
  accumulateRunLog(d);
  const s = useTenantStore.getState();
  const type = d['type'];
  if (type === 'connection_log') {
    const level: LogLevel = d['phase'] === 'connected' ? 'success' : d['phase'] === 'error' ? 'error' : 'info';
    s.appendLog(String(d['message']), level);
  } else if (type === 'preflight_check') {
    const ok = d['status'] === 'granted' || d['status'] === 'assigned';
    const label = d['phase'] === 'directory_role' ? '[Role] ' : '[Perm] ';
    let msg = `${label}${d['name']} — ${d['status']}`;
    if (d['detail']) msg += ` (${d['detail']})`;
    s.appendLog(`${ok ? '✓' : '✗'} ${msg}`, ok ? 'success' : 'warn');
  } else if (type === 'preflight_action') {
    const ok = d['result'] === 'granted' || d['result'] === 'assigned';
    const label = d['phase'] === 'directory_role' ? '[Role Grant] ' : '[Perm Grant] ';
    let msg = `${label}${d['name']} — ${d['result']}`;
    if (d['error']) msg += ` (${d['error']})`;
    s.appendLog(`${ok ? '✓' : '✗'} ${msg}`, ok ? 'success' : 'error');
  } else if (type === 'preflight_summary') {
    const gp = d['graphPermissions'] ?? {};
    const dr = d['directoryRoles'] ?? {};
    s.appendLog('--- Preflight Summary ---', 'info');
    s.appendLog(
      `Graph Permissions: ${gp.alreadyGranted} existing, ${gp.newlyGranted} granted, ${gp.failed} failed (of ${gp.total})`,
      gp.failed > 0 ? 'warn' : 'success',
    );
    s.appendLog(
      `Directory Roles: ${dr.alreadyAssigned} existing, ${dr.newlyAssigned} assigned, ${dr.failed} failed (of ${dr.total})`,
      dr.failed > 0 ? 'warn' : 'success',
    );
  } else if (type === 'preflight_done') {
    closeActiveStream();
    useTenantStore.setState({ preflightRunning: false });
    s.showStatus('Preflight complete.', 'success');
    s.appendLog('Preflight complete.', 'success');
    s.notifyRunEnd('preflight', true, '');
    void autoSaveRunLog();
  } else if (type === 'error') {
    s.appendLog(String(d['message']), 'error');
    s.showStatus(`Preflight error: ${d['message']}`, 'error');
    closeActiveStream();
    useTenantStore.setState({ preflightRunning: false });
    finishRunLog();
    s.notifyRunEnd('preflight', false, '');
    void autoSaveRunLog();
  }
}

/** Card 0 badge: legacy only ever shows "Pending" for cards 0 and 1 (onTenantChange L6206). */
export const CARD0_BADGE: { text: string; className: CardBadgeClass } = { text: 'Pending', className: 'status-default' };

export function rememberTenant(slug: string): void {
  try {
    storage()?.setItem(LAST_TENANT_KEY, slug);
  } catch {
    /* storage unavailable */
  }
}
