// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Unified variables screen state (legacy ces-stamper/public/unified-variables.html):
//   init L749 (no requests for '' or 'dev'), loadTenantConfig L788, saveConfig L873,
//   saveConfigAs L910, loadTenantFromFile L945, loadTenantFromPath L968, loadResolvableVariables L991,
//   loadTenantVariables L1004, saveVariables L1110, resolveAllVariables L1215,
//   resolveVariable L1292, Terms of Use sample L1402.
// Routes (PC-12, corrected in LOG-W8-SPA3): GET /api/resolvable-variables, GET/PUT /api/tenants/:slug,
// POST /api/tenants, GET /api/tenants-browse, GET /api/browse-file, GET/PUT /api/tenants/:slug/variables,
// POST /api/resolve-variable, POST /api/resolve-all-variables, POST /api/file-to-base64.

import { create } from 'zustand';
import type { EditorNotice, TenantConfig, TenantVariables, TermsOfUseFile, VariableResolution } from 'ces-ui-kit';
import { stamperApi } from '../api';
import { errorText, replyOf } from './replies';
import type { OkReply } from './replies';
import { notifyOpener } from './popout';

/** The sample notice the legacy "Sample" button loads (unified-variables.html L1409). */
export const SAMPLE_TOU_FILE = 'CUI-System-Access-Notice.pdf';

export interface TenantFile {
  name: string;
  path: string;
  size?: number;
  modified?: string;
}

export interface VariablesState {
  tenant: string | null;
  config: TenantConfig;
  pathHint: string;
  variables: TenantVariables;
  resolvable: readonly string[];
  notice: EditorNotice | null;
  /** Files offered by Load (GET /api/tenants-browse); null when the picker is closed. */
  browseFiles: readonly TenantFile[] | null;
  load: (tenant: string | null) => Promise<void>;
  reloadConfig: () => Promise<void>;
  saveConfig: (config: TenantConfig) => Promise<void>;
  saveConfigAs: (slug: string, config: TenantConfig) => Promise<void>;
  browseConfigs: () => Promise<void>;
  closeBrowse: () => void;
  loadConfigFromPath: (filePath: string) => Promise<void>;
  saveVariables: (variables: TenantVariables) => Promise<void>;
  resolve: (name: string) => Promise<VariableResolution | void>;
  resolveAll: (names: string[]) => Promise<VariableResolution | void>;
  loadSampleTermsOfUse: () => Promise<TermsOfUseFile | void>;
  reset: () => void;
}

const EMPTY: TenantConfig = Object.freeze({}) as TenantConfig;

const initial = {
  tenant: null,
  config: EMPTY,
  pathHint: '',
  variables: EMPTY as TenantVariables,
  resolvable: [] as readonly string[],
  notice: null,
  browseFiles: null,
};

export function isEditableTenant(tenant: string | null | undefined): tenant is string {
  return !!tenant && tenant !== 'dev';
}

const fail = (text: string): EditorNotice => ({ kind: 'error', text });
const ok = (text: string): EditorNotice => ({ kind: 'success', text });

export const useVariablesStore = create<VariablesState>()((set, get) => {
  async function loadResolvable(): Promise<void> {
    try {
      const data = await replyOf<OkReply & { variables?: string[] }>(() => stamperApi.resolvableVariables());
      if (data.ok && Array.isArray(data.variables)) set({ resolvable: data.variables });
    } catch {
      // Legacy logs and carries on with no resolvable names.
    }
  }

  async function loadConfig(slug: string): Promise<void> {
    try {
      const data = await replyOf<OkReply & { config?: TenantConfig; path?: string }>(() => stamperApi.getTenant(slug));
      if (get().tenant !== slug) return;
      if (!data.ok) {
        set({ notice: fail(`Failed to load config: ${data.error || 'Unknown'}`) });
        return;
      }
      set({ config: data.config || {}, pathHint: data.path || '' });
    } catch (err) {
      set({ notice: fail(`Failed to load config: ${errorText(err)}`) });
    }
  }

  async function loadVariables(slug: string): Promise<void> {
    try {
      const data = await replyOf<OkReply & { variables?: TenantVariables }>(() => stamperApi.getTenantVariables(slug));
      if (get().tenant !== slug) return;
      set({ variables: data.ok ? data.variables || {} : {} });
    } catch {
      if (get().tenant === slug) set({ variables: {} });
    }
  }

  return {
    ...initial,
    load: async (tenant) => {
      set({ ...initial, tenant: tenant ?? null });
      if (!isEditableTenant(tenant)) return;
      // Legacy issues the three requests in this order without waiting (init L758-760).
      await Promise.all([loadResolvable(), loadConfig(tenant), loadVariables(tenant)]);
    },
    reloadConfig: async () => {
      const { tenant } = get();
      if (isEditableTenant(tenant)) await loadConfig(tenant);
    },
    saveConfig: async (config) => {
      const { tenant } = get();
      if (!isEditableTenant(tenant)) return;
      try {
        const data = await replyOf(() => stamperApi.updateTenant(tenant, JSON.stringify(config, null, 2)));
        if (!data.ok) {
          set({ notice: fail(`Save failed: ${data.error || 'Unknown'}`) });
          return;
        }
        set({ config, notice: ok('Config saved') });
        notifyOpener({ type: 'config-saved', tenant });
      } catch (err) {
        set({ notice: fail(`Save failed: ${errorText(err)}`) });
      }
    },
    saveConfigAs: async (slug, config) => {
      try {
        const data = await replyOf(() => stamperApi.createTenant(JSON.stringify(config, null, 2)));
        if (!data.ok) {
          set({ notice: fail(`Save As failed: ${data.error || 'Unknown'}`) });
          return;
        }
        set({ notice: ok(`Saved as: ${slug}`) });
        notifyOpener({ type: 'config-saved', tenant: slug });
      } catch (err) {
        set({ notice: fail(`Save As failed: ${errorText(err)}`) });
      }
    },
    browseConfigs: async () => {
      try {
        const data = await replyOf<OkReply & { files?: TenantFile[] }>(() => stamperApi.browseTenants());
        if (!data.ok || !data.files || data.files.length === 0) {
          set({ notice: fail('No tenant files found'), browseFiles: null });
          return;
        }
        set({ browseFiles: data.files });
      } catch (err) {
        set({ notice: fail(`Failed to browse: ${errorText(err)}`) });
      }
    },
    closeBrowse: () => set({ browseFiles: null }),
    loadConfigFromPath: async (filePath) => {
      set({ browseFiles: null });
      try {
        const data = await replyOf<OkReply & { content?: string }>(() => stamperApi.browseFile(filePath));
        if (!data.ok) {
          set({ notice: fail(`Failed to load: ${data.error || 'Unknown'}`) });
          return;
        }
        const cfg = JSON.parse(data.content ?? '') as TenantConfig;
        const name = filePath.split(/[/\\]/).pop() ?? filePath;
        set({ config: cfg, pathHint: filePath, notice: ok(`Loaded from ${name}`) });
      } catch (err) {
        set({ notice: fail(`Failed to load: ${errorText(err)}`) });
      }
    },
    saveVariables: async (variables) => {
      const { tenant } = get();
      if (!isEditableTenant(tenant)) return;
      try {
        const data = await replyOf(() => stamperApi.putTenantVariables(tenant, variables));
        if (!data.ok) {
          set({ notice: fail(`Save failed: ${data.error || 'Unknown'}`) });
          return;
        }
        set({ variables, notice: ok('Variables saved') });
        notifyOpener({ type: 'variables-saved' });
      } catch (err) {
        set({ notice: fail(`Save failed: ${errorText(err)}`) });
      }
    },
    // The editor shows its own resolve notices; errors are thrown so it prefixes "Resolve failed: ".
    resolve: async (name) => {
      const { tenant } = get();
      if (!isEditableTenant(tenant)) {
        set({ notice: fail('No tenant selected') });
        return;
      }
      const data = await replyOf<
        OkReply & { resolved?: Record<string, unknown>; ambiguous?: boolean; candidates?: string[] }
      >(() => stamperApi.resolveVariable({ variable: name, tenant }));
      if (data.ambiguous && data.candidates) return { ambiguous: { [name]: data.candidates } };
      if (!data.ok) throw new Error(data.error || 'Unknown');
      if (data.resolved && data.resolved[name]) {
        // Legacy reloads the Config tab after a resolve (L1313).
        void get().reloadConfig();
        return { resolved: data.resolved };
      }
      return undefined;
    },
    resolveAll: async (names) => {
      const { tenant } = get();
      if (!isEditableTenant(tenant)) {
        set({ notice: fail('No tenant selected') });
        return;
      }
      const data = await replyOf<
        OkReply & { resolved?: Record<string, unknown>; ambiguous?: Record<string, string[]>; notFound?: string[] }
      >(() => stamperApi.resolveAllVariables(names, tenant));
      if (!data.ok) throw new Error(data.error || 'Unknown');
      // Legacy reloads the Config tab to show newly discovered resources (L1282).
      void get().reloadConfig();
      return { resolved: data.resolved ?? {}, ambiguous: data.ambiguous ?? {}, notFound: data.notFound ?? [] };
    },
    loadSampleTermsOfUse: async () => {
      try {
        const data = await replyOf<OkReply & { base64?: string; fileName?: string }>(() =>
          stamperApi.fileToBase64(SAMPLE_TOU_FILE),
        );
        if (!data.ok) {
          set({ notice: fail(`Failed to load sample TOU: ${data.error}`) });
          return undefined;
        }
        return { fileName: data.fileName ?? SAMPLE_TOU_FILE, base64: data.base64 ?? '' };
      } catch (err) {
        set({ notice: fail(`Error loading sample TOU: ${errorText(err)}`) });
        return undefined;
      }
    },
    reset: () => set({ ...initial }),
  };
});
