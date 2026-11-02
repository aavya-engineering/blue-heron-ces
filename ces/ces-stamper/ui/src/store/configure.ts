// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Configure card (legacy card 1) state: the three plan paths and their hints, path persistence
// to the tenant config, the file picker and old-file cleanup, the launchers, Scan Variables and
// Bring to Baseline. Behaviour source: ces-stamper/public/index.html (line numbers per function).
// W8-SPAW: the path values (#configMissionPlanPath, #configManifestPath, #configInfraManifestPath),
// the executable-plan path (#outputPath) and the plan variables path live once, in the translate
// store; this card writes them through setPlanInputs, setOutputPath and setVariablesPath. The EP
// check after a path load is the execute store's tryUnlockExecuteFromEP (rail, card-4 badge, EP
// display), so the tenant change makes one /api/validate-file request, as legacy does.

import { create } from 'zustand';
import { ApiError, apiRequest, stamperApi, stamperStreams } from '../api';
import {
  DEV_SLUG,
  accumulateRunLog,
  autoSaveRunLog,
  closeActiveStream,
  initRunLog,
  openActiveStream,
  releaseActiveStream,
  useTenantStore,
} from './tenant';
import type { StreamEvent } from './tenant';
import { useTranslateStore } from './translate';
import { tryUnlockExecuteFromEP } from './execute';

export type PathType = 'missionPlan' | 'manifest' | 'infraManifest';
export type FileType = 'mp' | 'tm' | 'im';
export type Posture = 'm365_only' | 'm365_foundation' | 'm365_full_infra';

export const PATH_TYPES: readonly PathType[] = ['missionPlan', 'manifest', 'infraManifest'];

/** Legacy input ids (`'config' + Type + 'Path'`, saveConfigPath L6679). */
export const PATH_INPUT_IDS: Readonly<Record<PathType, string>> = {
  missionPlan: 'configMissionPlanPath',
  manifest: 'configManifestPath',
  infraManifest: 'configInfraManifestPath',
};

export const PATH_FILE_TYPES: Readonly<Record<PathType, FileType>> = { missionPlan: 'mp', manifest: 'tm', infraManifest: 'im' };

/** L10721-10730, L10803-10807. */
export const FILE_PICKER_LABELS: Readonly<Record<FileType, string>> = {
  mp: 'Select Mission Plan',
  tm: 'Select Tenant Manifest',
  im: 'Select Infrastructure Manifest',
};
export const FILE_PICKER_PATTERNS: Readonly<Record<FileType, string>> = {
  mp: 'manual-mission-plan',
  tm: 'tenant-manifest',
  im: 'infrastructure-manifest',
};
export const CLEANUP_NAMES: Readonly<Record<FileType, string>> = {
  mp: 'Mission Plans',
  tm: 'Tenant Manifests',
  im: 'Infrastructure Manifests',
};

/** Legacy updatePathHint (L6651): the file-name part of the path. */
export function pathHint(value: string): string {
  const parts = (value || '').replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

export interface BrowseFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

/** Legacy picker row meta: `<KB> KB · <yyyy-mm-dd>` (L10766). */
export function fileMeta(f: BrowseFile): string {
  return `${(f.size / 1024).toFixed(1)} KB · ${f.modified ? f.modified.substring(0, 10) : ''}`;
}

export interface VariableScanItem {
  variable: string;
  resolvable?: boolean;
  controlCount: number;
  entryCount: number;
  controlIds: string[];
}

export interface FilePickerState {
  open: boolean;
  target: PathType | null;
  title: string;
  dir: string;
  files: BrowseFile[];
  loading: boolean;
  /** Error text shown in the list (data.error, or "Failed to load files"). */
  error: string | null;
}

export interface Toast {
  message: string;
  type: 'info' | 'error' | 'success';
}

/** FIN-15: one recurring Bring-to-Baseline item (GET /api/baseline/cost-items, baseline.routes.ts). */
export interface BaselineCostItem {
  entry_id: string;
  resourceType: string;
  label: string;
  cost_key: string | null;
  estimate: string | null;
  estimate_basis: string;
  price_date: string;
  standard_alternative: string[];
  acked: boolean;
  acked_at?: string;
  operator?: string;
  /** The DP-2 text: `<entry id> <monthly cost>`. */
  expected_dp2: string | null;
}

/** FIN-15: the cost gate on Bring to Baseline (DP-1 = typed opt-in, DP-2 = typed for the run). */
export interface BaselineCostState {
  posture: Posture;
  items: BaselineCostItem[];
  priceDate: string;
  loading: boolean;
  error: string | null;
}

export interface ConfigureState {
  picker: FilePickerState;
  toast: Toast | null;
  posture: Posture;
  baselineRunning: boolean;
  baselineStatus: string;
  scan: { missing: VariableScanItem[]; count: number } | null;
  collapsed: boolean;
  /** FIN-15: the recurring items of the chosen posture (null until loaded). */
  baselineCost: BaselineCostState | null;
  /** FIN-15: the operator's name or ID, recorded on DP-1 and DP-2. */
  baselineOperator: string;
  /** FIN-15: DP-1 text being typed, per entry id (must equal the entry id). */
  baselineDp1Typed: Record<string, string>;
  /** FIN-15: DP-2 text being typed, per entry id (must equal `<entry id> <monthly cost>`). */
  baselineDp2Typed: Record<string, string>;

  /** Typing in a path field (legacy oninput: hint, then saveConfigPath). Writes the translate store. */
  setPath: (type: PathType, value: string) => void;
  saveConfigPath: (type: PathType) => Promise<void>;
  loadDevPaths: () => Promise<void>;
  loadTenantPaths: (slug: string) => Promise<void>;
  openFilePicker: (type: PathType) => Promise<void>;
  pickFile: (filePath: string) => void;
  closeFilePicker: () => void;
  deleteOldFiles: (fileType: FileType) => Promise<void>;
  showToast: (message: string, type?: Toast['type']) => void;
  launchVariables: () => void;
  launchRegistry: () => void;
  scanVariables: () => Promise<void>;
  setPosture: (posture: Posture) => void;
  /** FIN-15: GET /api/baseline/cost-items for the chosen posture. */
  loadBaselineCost: () => Promise<void>;
  setBaselineOperator: (operator: string) => void;
  setBaselineDp1Typed: (entryId: string, typed: string) => void;
  setBaselineDp2Typed: (entryId: string, typed: string) => void;
  /** FIN-15: POST /api/baseline/cost-ack (DP-1), then reload the list. */
  ackBaselineCost: (entryId: string) => Promise<void>;
  runBaseline: () => void;
  haltBaseline: () => void;
  toggleCard: () => void;
  reset: () => void;
}

const CLOSED_PICKER: FilePickerState = { open: false, target: null, title: 'Select File', dir: '', files: [], loading: false, error: null };

function initialState() {
  return {
    picker: CLOSED_PICKER,
    toast: null as Toast | null,
    posture: 'm365_only' as Posture,
    baselineRunning: false,
    baselineStatus: '',
    scan: null,
    collapsed: false,
    baselineCost: null as BaselineCostState | null,
    baselineOperator: '',
    baselineDp1Typed: {} as Record<string, string>,
    baselineDp2Typed: {} as Record<string, string>,
  };
}

/**
 * FIN-15: the Bring to Baseline stream URL. The operator and the typed DP-2 texts ride on the URL
 * (EventSource can only GET). With neither it is the plain URL, and the server refuses every
 * recurring resource (fail-closed).
 */
export function baselineStreamUrl(tenant: string, posture: string, operator: string, dp2: Record<string, string>): string {
  const base = stamperStreams.baseline(tenant, posture);
  const typed = Object.fromEntries(Object.entries(dp2).filter(([, v]) => v.trim() !== ''));
  if (Object.keys(typed).length === 0 && !operator.trim()) return base;
  const extra = new URLSearchParams();
  if (operator.trim()) extra.set('operator', operator.trim());
  if (Object.keys(typed).length > 0) extra.set('dp2', JSON.stringify(typed));
  return `${base}${base.includes('?') ? '&' : '?'}${extra.toString()}`;
}

/** The JSON body of a reply, including a non-2xx one (legacy reads r.json() regardless of status). */
async function bodyOf<T>(call: () => Promise<unknown>): Promise<T> {
  try {
    return (await call()) as T;
  } catch (err) {
    if (err instanceof ApiError && err.payload && typeof err.payload === 'object') return err.payload as T;
    throw err;
  }
}

function confirmDialog(message: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : false;
  } catch {
    return false;
  }
}

function openWindow(url: string, name: string, features: string): void {
  try {
    if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(url, name, features);
  } catch {
    /* pop-up blocked */
  }
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useConfigureStore = create<ConfigureState>()((set, get) => ({
  ...initialState(),

  setPath: (type, value) => {
    useTranslateStore.getState().setPlanInputs({ [type]: value });
    void get().saveConfigPath(type);
  },

  // L6675: GET the tenant config, write last_session.translate_paths[type], PUT it back.
  saveConfigPath: async (type) => {
    const tenant = useTenantStore.getState().slug;
    if (!tenant || tenant === DEV_SLUG) return;
    const value = useTranslateStore.getState()[type].trim();
    try {
      const data = (await stamperApi.getTenant(tenant)) as { ok?: boolean; config?: Record<string, unknown> };
      if (!data || !data.ok) return;
      const cfg = (data.config || {}) as Record<string, any>;
      if (!cfg['last_session']) cfg['last_session'] = {};
      if (!cfg['last_session'].translate_paths) cfg['last_session'].translate_paths = {};
      cfg['last_session'].translate_paths[type] = value;
      await stamperApi.updateTenant(tenant, JSON.stringify(cfg, null, 2));
    } catch {
      /* legacy: .catch(function() {}) */
    }
  },

  // L6713: dev mode keeps the user's paths (no request).
  loadDevPaths: async () => {},

  // L6751
  loadTenantPaths: async (slug) => {
    try {
      const data = (await stamperApi.lastTranslate(slug)) as {
        ok?: boolean;
        paths?: { missionPlan?: string; manifest?: string; output?: string; infraManifest?: string; variables?: string };
      };
      if (data && data.ok && data.paths) {
        const p = data.paths;
        const t = useTranslateStore.getState();
        t.setPlanInputs({
          missionPlan: p.missionPlan || t.missionPlan,
          manifest: p.manifest || t.manifest,
          infraManifest: p.infraManifest || t.infraManifest,
        });
        t.setOutputPath(p.output || t.outputPath);
        t.setVariablesPath(p.variables || t.variablesPath);
      }
      await tryUnlockExecuteFromEP();
    } catch {
      /* non-fatal (legacy comment L6782) */
    }
  },

  // L10732
  openFilePicker: async (type) => {
    const fileType = PATH_FILE_TYPES[type];
    set({ picker: { ...CLOSED_PICKER, open: true, target: type, title: FILE_PICKER_LABELS[fileType], loading: true } });
    const slug = useTenantStore.getState().slug || '';
    const query: { tenant?: string; pattern?: string } = {};
    if (slug && slug !== DEV_SLUG) query.tenant = slug;
    query.pattern = FILE_PICKER_PATTERNS[fileType];
    try {
      const data = await bodyOf<{ ok?: boolean; error?: string; dir?: string; files?: BrowseFile[] }>(() => stamperApi.browse(query));
      if (get().picker.target !== type) return;
      if (!data || !data.ok) {
        set((s) => ({ picker: { ...s.picker, loading: false, error: (data && data.error) || 'Error' } }));
        return;
      }
      set((s) => ({ picker: { ...s.picker, loading: false, dir: data.dir || '', files: data.files || [] } }));
    } catch {
      set((s) => ({ picker: { ...s.picker, loading: false, error: 'Failed to load files' } }));
    }
  },

  // L10779
  pickFile: (filePath) => {
    const target = get().picker.target;
    if (target) {
      useTranslateStore.getState().setPlanInputs({ [target]: filePath });
      try {
        window.localStorage.setItem(`stamper_${PATH_INPUT_IDS[target]}`, filePath);
      } catch {
        /* storage unavailable */
      }
      void get().saveConfigPath(target);
    }
    get().closeFilePicker();
  },

  closeFilePicker: () => set({ picker: CLOSED_PICKER }),

  // L10809
  deleteOldFiles: async (fileType) => {
    const pattern = FILE_PICKER_PATTERNS[fileType];
    const displayName = CLEANUP_NAMES[fileType] || 'files';
    if (!pattern) return;
    const slug = useTenantStore.getState().slug || '';
    const tenant = slug && slug !== DEV_SLUG ? slug : undefined;
    let data: { ok?: boolean; files?: BrowseFile[] };
    try {
      data = await bodyOf(() => stamperApi.browse(tenant ? { tenant, pattern } : { pattern }));
    } catch {
      get().showToast('Could not preview files for cleanup', 'error');
      return;
    }
    if (!data || !data.ok || !data.files || data.files.length <= 1) {
      get().showToast(`No old ${displayName.toLowerCase()} to clean up`, 'info');
      return;
    }
    const count = data.files.length - 1;
    if (!confirmDialog(`Delete all but most recent ${displayName}?\n\nThis will permanently remove ${count} file${count > 1 ? 's' : ''}.`)) {
      return;
    }
    try {
      const result = await bodyOf<{ ok?: boolean; deleted?: number; kept?: string; error?: string }>(() =>
        stamperApi.browseCleanup(pattern, tenant),
      );
      if (result && result.ok) {
        get().showToast(`Deleted ${result.deleted} old file${result.deleted !== 1 ? 's' : ''}, kept: ${result.kept}`);
      } else {
        get().showToast((result && result.error) || 'Cleanup failed', 'error');
      }
    } catch {
      get().showToast('Cleanup request failed', 'error');
    }
  },

  // L4930 (3-second toast; green unless error)
  showToast: (message, type = 'success') => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { message, type } });
    toastTimer = setTimeout(() => set({ toast: null }), 3000);
  },

  // L4826: legacy opens /unified-variables.html; the SPA opens its own variables screen.
  launchVariables: () => {
    const tenant = useTenantStore.getState().slug;
    if (!tenant || tenant === DEV_SLUG) {
      get().showToast('Select a tenant first', 'error');
      return;
    }
    openWindow(`/app/variables?tenant=${encodeURIComponent(tenant)}`, 'unifiedVariables', 'width=850,height=750,resizable=yes,scrollbars=yes');
  },

  // L4836
  launchRegistry: () => {
    const tenant = useTenantStore.getState().slug;
    openWindow(
      `/app/registry?tenant=${encodeURIComponent(tenant)}&type=m365`,
      'registryEditor',
      'width=950,height=750,resizable=yes,scrollbars=yes',
    );
  },

  // L4843
  scanVariables: async () => {
    const tenantStore = useTenantStore.getState();
    const tenant = tenantStore.slug;
    if (!tenant || tenant === DEV_SLUG) {
      tenantStore.showStatus('Select a tenant first', 'error');
      return;
    }
    tenantStore.showStatus('Scanning variables across all registry entries...', 'running');
    try {
      const data = await bodyOf<{ ok?: boolean; error?: string; missingCount?: number; missing?: VariableScanItem[] }>(() =>
        stamperApi.validateVariables(tenant),
      );
      if (!data || !data.ok) {
        tenantStore.showStatus(`Scan failed: ${(data && data.error) || 'Unknown error'}`, 'error');
        return;
      }
      if (data.missingCount === 0) {
        tenantStore.showStatus('All required variables present', 'done');
        set({ scan: null });
        return;
      }
      set({ scan: { missing: data.missing || [], count: data.missingCount ?? 0 } });
      tenantStore.showStatus(`Variable scan complete: ${data.missingCount} missing`, 'error');
    } catch (err) {
      tenantStore.showStatus(`Scan failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  },

  setPosture: (posture) => set({ posture, baselineCost: null, baselineDp1Typed: {}, baselineDp2Typed: {} }),

  loadBaselineCost: async () => {
    const tenant = useTenantStore.getState().slug;
    const posture = get().posture;
    if (!tenant || tenant === DEV_SLUG) return;
    set({ baselineCost: { posture, items: [], priceDate: '', loading: true, error: null } });
    try {
      const data = await bodyOf<{ items?: BaselineCostItem[]; price_date?: string; error?: string }>(() =>
        apiRequest('GET', '/api/baseline/cost-items', { query: { tenant, posture } }),
      );
      if (get().posture !== posture) return;
      set({ baselineCost: { posture, items: data.items ?? [], priceDate: data.price_date ?? '', loading: false, error: data.error ?? null } });
    } catch (err) {
      set({ baselineCost: { posture, items: [], priceDate: '', loading: false, error: err instanceof Error ? err.message : String(err) } });
    }
  },

  setBaselineOperator: (operator) => set({ baselineOperator: operator }),
  setBaselineDp1Typed: (entryId, typed) => set((s) => ({ baselineDp1Typed: { ...s.baselineDp1Typed, [entryId]: typed } })),
  setBaselineDp2Typed: (entryId, typed) => set((s) => ({ baselineDp2Typed: { ...s.baselineDp2Typed, [entryId]: typed } })),

  ackBaselineCost: async (entryId) => {
    const tenantStore = useTenantStore.getState();
    const tenant = tenantStore.slug;
    const typed = get().baselineDp1Typed[entryId] ?? '';
    try {
      const data = await bodyOf<{ ok?: boolean; error?: string; estimate?: string }>(() =>
        apiRequest('POST', '/api/baseline/cost-ack', { body: { tenant, entryId, typed, operator: get().baselineOperator } }),
      );
      if (!data.ok) {
        tenantStore.showStatus(data.error ?? `DP-1 refused for ${entryId}`, 'error');
        return;
      }
      tenantStore.showStatus(`DP-1 recorded for ${entryId} (about ${data.estimate ?? '?'} a month).`, 'success');
      set((s) => ({ baselineDp1Typed: { ...s.baselineDp1Typed, [entryId]: '' } }));
      await get().loadBaselineCost();
    } catch (err) {
      tenantStore.showStatus(`DP-1 failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  },

  // L6955 doBaseline + L7005 handleBaselineEvent
  runBaseline: () => {
    const tenantStore = useTenantStore.getState();
    const tenant = tenantStore.slug;
    if (!tenant || tenant === DEV_SLUG) {
      tenantStore.showStatus('Select a tenant before running baseline.', 'error');
      return;
    }
    if (tenantStore.connection !== 'connected') {
      tenantStore.showStatus('Connect to a tenant before running baseline.', 'error');
      return;
    }
    const posture = get().posture;
    tenantStore.showStatus('Running baseline provisioning...', 'info');
    set({ baselineRunning: true, baselineStatus: 'Discovery in progress...' });
    tenantStore.clearLog();
    initRunLog();

    let discovered = 0;
    let existing = 0;
    let missing = 0;
    const log = (message: string, level: 'info' | 'success' | 'warn' | 'error') => useTenantStore.getState().appendLog(message, level);
    const finish = (statusText?: string) => {
      closeActiveStream();
      set((s) => ({ baselineRunning: false, baselineStatus: statusText ?? s.baselineStatus }));
    };

    const handle = (d: StreamEvent) => {
      const type = d['type'];
      if (type === 'connection_log') {
        log(String(d['message']), d['phase'] === 'error' ? 'error' : 'info');
      } else if (type === 'discovery_progress') {
        discovered++;
        if (d['exists']) existing++;
        else missing++;
        const icon = d['exists'] ? '✓' : d['error'] ? '⚠' : '✗';
        const level = d['exists'] ? 'success' : d['error'] ? 'warn' : 'info';
        let msg = `${icon} [${d['resourceType']}] ${d['resourceName']}${d['error'] ? ` (${d['error']})` : d['exists'] ? ' exists' : ' missing'}`;
        if (d['resourceId']) msg += ` (id: ${String(d['resourceId']).substring(0, 60)}...)`;
        if (d['durationMs'] > 0) msg += ` [${d['durationMs']}ms]`;
        log(msg, level);
        set({ baselineStatus: `Discovering ${discovered} resources (${existing} existing, ${missing} missing)` });
      } else if (type === 'gap_summary') {
        log('--- Gap Summary ---', 'info');
        log(`Total: ${d['total']} | Existing: ${d['existing']} | Missing: ${d['missing']} resources`, 'info');
        const typeStr = Object.entries((d['byResourceType'] as Record<string, unknown>) || {})
          .map(([k, v]) => `${k}:${v}`)
          .join(', ');
        if (typeStr) log(`By resource type: ${typeStr}`, 'info');
        set({ baselineStatus: `Provisioning ${d['missing']} missing resources...` });
      } else if (type === 'execution_progress') {
        const ok = d['exitCode'] === 0;
        let msg = `${ok ? '✓' : '✗'} [${d['phase']}] ${d['resourceName']} (${d['resourceType']})`;
        if (d['stdout']) msg += `: ${String(d['stdout']).substring(0, 120)}`;
        if (d['stderr']) msg += ` | stderr: ${String(d['stderr']).substring(0, 80)}`;
        if (d['captures']) msg += ` | captures: ${JSON.stringify(d['captures'])}`;
        log(msg, ok ? 'success' : 'error');
      } else if (type === 'cost_gate') {
        // FIN-15: a recurring resource passed or was refused at the cost gate (DP-1 + DP-2).
        if (d['allowed']) log(`[${d['resourceType']}] ${d['resourceName']}: recurring cost confirmed (about ${d['estimate'] ?? '?'} a month)`, 'warn');
        else log(`[${d['resourceType']}] ${d['resourceName']}: not built, ${d['reason']}`, 'warn');
      } else if (type === 'baseline_error') {
        log(`[ERROR] ${d['phase']}: ${d['error']}${d['resourceName'] ? ` (${d['resourceName']})` : ''}`, 'error');
      } else if (type === 'baseline_complete') {
        const durSec = (Number(d['duration']) / 1000).toFixed(1);
        log('--- Baseline Complete ---', 'info');
        const gated = Number(d['cost_gated_off'] ?? 0);
        log(
          `Duration: ${durSec}s | Succeeded: ${d['succeeded']} | Failed: ${d['failed']} | Skipped: ${d['skipped']}${gated > 0 ? ` | Cost-gated off: ${gated}` : ''}`,
          d['failed'] > 0 ? 'warn' : 'success',
        );
        useTenantStore.getState().showStatus('Baseline complete.', d['failed'] > 0 ? 'error' : 'success');
        finish(`Complete: ${d['succeeded']} succeeded, ${d['failed']} failed, ${d['skipped']} skipped (${durSec}s)`);
        void autoSaveRunLog();
      } else if (type === 'error') {
        log(String(d['message']), 'error');
        useTenantStore.getState().showStatus(`Baseline error: ${d['message']}`, 'error');
        finish(`Error: ${d['message']}`);
        void autoSaveRunLog();
      }
    };

    const source = openActiveStream(
      baselineStreamUrl(tenant, posture, get().baselineOperator, get().baselineDp2Typed),
      (d) => {
        accumulateRunLog(d);
        handle(d);
      },
      () => {
        useTenantStore.getState().showStatus('Baseline connection error.', 'error');
        releaseActiveStream(source);
        set({ baselineRunning: false, baselineStatus: 'Connection error' });
      },
    );
  },

  // L7071
  haltBaseline: () => {
    closeActiveStream();
    void stamperApi.abort().catch(() => undefined);
    useTenantStore.getState().showStatus('Baseline halted by operator.', 'error');
    set({ baselineRunning: false, baselineStatus: 'Halted by operator' });
  },

  toggleCard: () => set((s) => ({ collapsed: !s.collapsed })),

  reset: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set(initialState());
  },
}));

/** Bring to Baseline is enabled only for a connected, non-dev tenant (setTenantConnectionState L4964). */
export function baselineEnabled(connection: string, slug: string, running: boolean): boolean {
  return !running && connection === 'connected' && Boolean(slug) && slug !== DEV_SLUG;
}
