// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Evidence screen state (legacy card 5, ces-stamper/public/index.html):
//   doEvidenceScan L10864, renderEvidenceSummary L10891, refreshEvidenceScanUI L10906,
//   renderEvidenceFamilies L10933, renderFamilyControls L10988, renderControlEvidenceFiles L11027,
//   openEvidenceOverlay L11459, openEvidencePopout L11073, updateVerdictBadge L11124,
//   filterControlsBySearch L11515, formatFileSize L10851, formatAge L10857.
// Routes: GET /api/evidence-scan?tenant, GET /api/evidence-content?tenant&entryId (PC-10, PC-11).

import { create } from 'zustand';
import type { EvidenceRecord } from 'ces-ui-kit';
import { stamperApi } from '../api';
import { useWorkflowStore } from './workflow';
import { errorText } from './replies';
import { openEvidencePopoutWindow } from './popout';

export interface EvidenceFileInfo {
  sizeBytes: number;
  modifiedAt: string;
  ageHours: number;
}

export interface EvidenceScanEntry {
  entryId: string;
  label: string;
  engine: string;
  evidenceFile: string;
  evidenceExists: boolean;
  fileInfo: EvidenceFileInfo | null;
}

export interface EvidenceScanControl {
  controlId: string;
  practice: string;
  cmmc_level?: number | string;
  hasEvidence: boolean;
  allCovered: boolean;
  entries: EvidenceScanEntry[];
}

export interface EvidenceScanFamily {
  abbreviation: string;
  name: string;
  controlCount: number;
  controlsWithEvidence: number;
  controls: EvidenceScanControl[];
}

export interface EvidenceScanSummary {
  totalControls: number;
  controlsWithEvidence: number;
  coveragePct: number;
  totalEntries: number;
  entriesWithEvidence: number;
}

export interface EvidenceScanResult {
  summary: EvidenceScanSummary;
  families: EvidenceScanFamily[];
  evidenceDir?: string;
}

/** GET /api/evidence-content reply (evidence.routes.ts). */
export interface EvidenceContentReply {
  entryId?: string;
  file?: string;
  fullPath?: string;
  sizeBytes?: number;
  modifiedAt?: string;
  isJson?: boolean;
  content?: string;
  structured?: EvidenceRecord;
}

// ---- Pure rules (legacy functions) ----

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** File row meta: "size · age", or "Not found". */
export function fileMeta(entry: EvidenceScanEntry): string {
  return entry.fileInfo ? `${formatFileSize(entry.fileInfo.sizeBytes)} · ${formatAge(entry.fileInfo.ageHours)}` : 'Not found';
}

export type Tone = 'green' | 'amber' | 'red' | 'grey';

/** Family badge (legacy L10944-10956). */
export function familyBadge(fam: EvidenceScanFamily): { tone: Tone; text: string } {
  if (fam.controlsWithEvidence === fam.controlCount && fam.controlCount > 0) {
    return { tone: 'green', text: `${fam.controlCount}/${fam.controlCount}` };
  }
  if (fam.controlsWithEvidence > 0) return { tone: 'amber', text: `${fam.controlsWithEvidence}/${fam.controlCount}` };
  if (fam.controlCount > 0) return { tone: 'red', text: `0/${fam.controlCount}` };
  return { tone: 'grey', text: `0/${fam.controlCount}` };
}

/** Control badge: count of entries with evidence (legacy L11001-11003). */
export function controlBadge(ctrl: EvidenceScanControl): { tone: Tone; text: string } {
  const count = ctrl.entries.filter((e) => e.evidenceExists).length;
  return { tone: count > 0 ? 'green' : 'grey', text: `${count} file${count !== 1 ? 's' : ''}` };
}

export interface SummaryView {
  controls: number;
  withEvidence: { value: number; tone: Tone | null };
  missing: { value: number; tone: Tone };
  coverage: { text: string; tone: Tone };
}

/** Stat tiles (legacy renderEvidenceSummary). */
export function summaryView(summary: EvidenceScanSummary): SummaryView {
  const missing = summary.totalControls - summary.controlsWithEvidence;
  return {
    controls: summary.totalControls,
    withEvidence: { value: summary.controlsWithEvidence, tone: summary.controlsWithEvidence > 0 ? 'green' : null },
    missing: { value: missing, tone: missing > 0 ? 'red' : 'green' },
    coverage: {
      text: `${summary.coveragePct}%`,
      tone: summary.coveragePct === 100 ? 'green' : summary.coveragePct > 0 ? 'amber' : 'red',
    },
  };
}

/** Controls in ascending lexical order of controlId (legacy L10992). */
export function sortControls(controls: readonly EvidenceScanControl[]): EvidenceScanControl[] {
  return controls.slice().sort((a, b) => a.controlId.localeCompare(b.controlId));
}

/**
 * Search (legacy filterControlsBySearch): a control shows when its id contains the query
 * (case-insensitive, trimmed); a family with no visible control is hidden. Empty query: all shown.
 */
export function controlMatches(controlId: string, query: string): boolean {
  const q = query.toLowerCase().trim();
  return q === '' || controlId.toLowerCase().includes(q);
}

export function visibleFamilies(families: readonly EvidenceScanFamily[], query: string): EvidenceScanFamily[] {
  if (query.toLowerCase().trim() === '') return families.slice();
  return families.filter((fam) => fam.controls.some((c) => controlMatches(c.controlId, query)));
}

export type VerdictTone = 'sat' | 'not-sat' | 'none';

/** File-row verdict badge (legacy updateVerdictBadge). */
export function verdictBadge(verdict: unknown): { tone: VerdictTone; text: string } {
  if (verdict === 'SAT') return { tone: 'sat', text: 'SAT' };
  if (verdict === 'NOT_SAT') return { tone: 'not-sat', text: 'NOT SAT' };
  return { tone: 'none', text: 'NO VERDICT' };
}

/** Legacy parse of an evidence-content reply: structured sibling, else JSON content, else raw. */
export function parseEvidenceReply(data: EvidenceContentReply): EvidenceRecord {
  if (data.structured) return data.structured;
  if (data.isJson) {
    try {
      return JSON.parse(data.content ?? '') as EvidenceRecord;
    } catch {
      return { rawResponse: data.content };
    }
  }
  return { rawResponse: data.content };
}

export const EXPANDED_FAMILIES_KEY = 'evidenceExpandedFamilies';

/** Expanded families survive a rescan within the session (legacy sessionStorage key). */
export function readExpandedFamilies(): string[] {
  try {
    const stored = window.sessionStorage.getItem(EXPANDED_FAMILIES_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeExpandedFamilies(expanded: readonly string[]): void {
  try {
    window.sessionStorage.setItem(EXPANDED_FAMILIES_KEY, JSON.stringify(expanded));
  } catch {
    // Storage blocked: expansion is then per render only.
  }
}

// ---- Store ----

export type ScanStatus = 'idle' | 'running' | 'done' | 'failed';

export interface StatusMessage {
  kind: 'error';
  text: string;
}

export interface EvidenceState {
  tenant: string | null;
  status: ScanStatus;
  scan: EvidenceScanResult | null;
  /** Verdicts learned by opening evidence (entryId to complianceVerdict). */
  verdicts: Readonly<Record<string, unknown>>;
  /** Legacy showStatus(…, 'error') text. */
  message: StatusMessage | null;
  overlay: { open: boolean; entryId: string | null; evidence: EvidenceRecord | null };
  /** Tenant change clears the card as legacy does on tenant selection (L6217-6222). */
  setTenant: (tenant: string | null) => void;
  scanEvidence: () => Promise<void>;
  openOverlay: (entryId: string) => Promise<void>;
  closeOverlay: () => void;
  openPopout: (entryId: string) => Promise<void>;
  reset: () => void;
}

const initial = {
  tenant: null,
  status: 'idle' as ScanStatus,
  scan: null,
  verdicts: {},
  message: null,
  overlay: { open: false, entryId: null, evidence: null },
};

async function loadEvidence(tenant: string, entryId: string): Promise<EvidenceRecord> {
  const data = (await stamperApi.evidenceContent(tenant, entryId)) as EvidenceContentReply;
  return parseEvidenceReply(data ?? {});
}

export const useEvidenceStore = create<EvidenceState>()((set, get) => ({
  ...initial,
  setTenant: (tenant) => {
    if (get().tenant === tenant) return;
    set({ ...initial, tenant });
  },
  scanEvidence: async () => {
    const { tenant } = get();
    if (!tenant) return;
    const workflow = useWorkflowStore.getState();
    workflow.startStep('evidence');
    set({ status: 'running', message: null });
    try {
      const data = (await stamperApi.evidenceScan(tenant)) as EvidenceScanResult;
      if (get().tenant !== tenant) return;
      set({ status: 'done', scan: data, verdicts: {} });
      useWorkflowStore.getState().completeStep('evidence');
    } catch (err) {
      if (get().tenant !== tenant) return;
      set({ status: 'failed', message: { kind: 'error', text: `Evidence scan failed: ${errorText(err)}` } });
      useWorkflowStore.getState().failStep('evidence');
    }
  },
  openOverlay: async (entryId) => {
    const { tenant } = get();
    if (!tenant) return;
    try {
      const evidence = await loadEvidence(tenant, entryId);
      set((s) => ({
        overlay: { open: true, entryId, evidence },
        verdicts: { ...s.verdicts, [entryId]: evidence.complianceVerdict },
      }));
    } catch (err) {
      set({ message: { kind: 'error', text: `Error loading evidence: ${errorText(err)}` } });
    }
  },
  closeOverlay: () => set({ overlay: { open: false, entryId: null, evidence: null } }),
  openPopout: async (entryId) => {
    const { tenant } = get();
    if (!tenant) return;
    try {
      const evidence = await loadEvidence(tenant, entryId);
      const win = openEvidencePopoutWindow(evidence);
      if (!win) {
        set({ message: { kind: 'error', text: 'Popup blocked. Please allow popups for this site.' } });
        return;
      }
      set((s) => ({ verdicts: { ...s.verdicts, [entryId]: evidence.complianceVerdict } }));
    } catch (err) {
      set({ message: { kind: 'error', text: `Error loading evidence: ${errorText(err)}` } });
    }
  },
  reset: () => set({ ...initial }),
}));

/** Card status badge text (legacy updateCardStatus(5, …), L6213, L10870, L10883, L10887). */
export function cardStatusText(state: Pick<EvidenceState, 'tenant' | 'status' | 'scan'>): string {
  if (state.status === 'running') return 'Scanning...';
  if (state.status === 'done' && state.scan) return `${state.scan.summary.coveragePct}% Coverage`;
  if (state.status === 'failed') return 'Error';
  return state.tenant ? 'Ready' : 'Locked';
}
