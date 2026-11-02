// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Registry editor screen state (legacy ces-stamper/public/registry-editor.html):
//   init L409 (?tenant, ?type, default m365), switchRegistryType L422, checkVariableResolution L606,
//   resolveRegistryCmd L652, saveRegistryEntry L728.
// Routes (PC-13): GET /api/registry/:type, PUT /api/registry/:type/:entryId, POST /api/registry/resolve.
// The legacy page never calls GET /api/registry/:type/:entryId.

import { create } from 'zustand';
import type { CommandResolution, EditorNotice, RegistryEntry, RegistryType } from 'ces-ui-kit';
import { stamperApi } from '../api';
import { errorText, replyOf } from './replies';
import { notifyOpener } from './popout';

export function registryTypeOf(raw: string | null | undefined): RegistryType {
  return raw === 'infra' ? 'infra' : 'm365';
}

/** Legacy variable check: GET and SET commands joined by a newline; skipped without a real tenant or commands. */
export function variableCheckCommand(entry: RegistryEntry, tenant: string | null | undefined): string | null {
  if (!tenant || tenant === 'dev') return null;
  const combined = `${entry.get_command || ''}\n${entry.set_command || ''}`;
  return combined.trim() ? combined : null;
}

/**
 * Legacy save updates the cached entry in place (registryEntries[i] and filteredEntries[i]).
 * The kit editor holds references to the cached objects, so the saved values replace the object's
 * contents: the editor stays on the same entry and shows the saved values when it comes back to it.
 */
export function replaceEntryContents(target: RegistryEntry, saved: RegistryEntry): void {
  for (const key of Object.keys(target)) delete (target as Record<string, unknown>)[key];
  Object.assign(target, saved);
}

export interface RegistryState {
  tenant: string | null;
  registryType: RegistryType;
  entries: RegistryEntry[];
  varStatus: { unresolved: readonly string[] } | null;
  notice: EditorNotice | null;
  init: (tenant: string | null, type: RegistryType) => Promise<void>;
  loadType: (type: RegistryType) => Promise<void>;
  save: (type: RegistryType, entry: RegistryEntry) => Promise<void>;
  resolveCommand: (command: string) => Promise<CommandResolution>;
  checkEntry: (entry: RegistryEntry) => Promise<void>;
  reset: () => void;
}

const initial = {
  tenant: null,
  registryType: 'm365' as RegistryType,
  entries: [] as RegistryEntry[],
  varStatus: null,
  notice: null,
};

let checkSeq = 0;
let loadSeq = 0;

export const useRegistryStore = create<RegistryState>()((set, get) => ({
  ...initial,
  init: async (tenant, type) => {
    set({ ...initial, tenant });
    await get().loadType(type);
  },
  loadType: async (type) => {
    const seq = ++loadSeq;
    set({ registryType: type, varStatus: null });
    try {
      const data = await replyOf<{ entries?: RegistryEntry[] }>(() => stamperApi.listRegistry(type));
      if (seq !== loadSeq) return;
      set({ entries: data.entries || [] });
    } catch (err) {
      if (seq !== loadSeq) return;
      set({ entries: [], notice: { kind: 'error', text: `Failed to load registry: ${errorText(err)}` } });
    }
  },
  save: async (type, entry) => {
    try {
      const data = (await stamperApi.putRegistryEntry(type, entry.entry_id, entry)) as { entry?: RegistryEntry };
      const saved = data?.entry ?? entry;
      const cached = get().entries.find((e) => e.entry_id === entry.entry_id);
      if (cached) replaceEntryContents(cached, saved);
      set({ notice: { kind: 'success', text: 'Entry saved successfully' } });
      notifyOpener({ type: 'registry-saved', registryType: type });
    } catch (err) {
      set({ notice: { kind: 'error', text: `Save failed: ${errorText(err) || 'Save failed'}` } });
    }
  },
  // The editor checks the tenant and the command first and prefixes errors with "Resolve failed: ".
  resolveCommand: async (command) => {
    const data = (await stamperApi.resolveRegistryCommand(command, get().tenant ?? undefined)) as {
      resolved?: string;
      unresolved?: string[];
    };
    return { resolved: data?.resolved ?? '', unresolved: data?.unresolved ?? [] };
  },
  checkEntry: async (entry) => {
    const seq = ++checkSeq;
    const command = variableCheckCommand(entry, get().tenant);
    if (command === null) {
      set({ varStatus: null });
      return;
    }
    try {
      const data = (await stamperApi.resolveRegistryCommand(command, get().tenant ?? undefined)) as {
        unresolved?: string[];
      };
      if (seq !== checkSeq) return;
      set({ varStatus: { unresolved: data?.unresolved ?? [] } });
    } catch {
      if (seq === checkSeq) set({ varStatus: null });
    }
  },
  reset: () => {
    checkSeq++;
    loadSeq++;
    set({ ...initial, entries: [] });
  },
}));
