// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Window messaging for the W8-SPA3 screens (PC-11, PLAN §5):
// - the evidence pop-out: same window name and features as legacy openEvidencePopout
//   (index.html L11101), same messages as evidence-popout.html (evidence_data in; evidence_ok,
//   evidence_closed out), plus a ready handshake (evidence_popout_ready) so data sent before the
//   React page mounts is not lost;
// - opener notices from the editors (config-saved, variables-saved, registry-saved);
// - the window launchers the Configure card uses for the two editors (index.html L4826-4840).

export const EVIDENCE_POPOUT_PATH = '/app/popout';
export const EVIDENCE_POPOUT_NAME = 'stamper-evidence-popout';
export const EVIDENCE_POPOUT_FEATURES = 'width=900,height=700';

export const POPOUT_MESSAGE = {
  data: 'evidence_data',
  ok: 'evidence_ok',
  closed: 'evidence_closed',
  ready: 'evidence_popout_ready',
} as const;

export type OpenerNotice =
  | { type: 'config-saved'; tenant: string }
  | { type: 'variables-saved' }
  | { type: 'registry-saved'; registryType: string };

/** Posts to the window that opened this one, as the legacy editors do (`window.opener.postMessage(…, '*')`). */
export function notifyOpener(message: OpenerNotice, win: Window = window): void {
  const opener = win.opener as Window | null;
  if (opener && opener !== win) opener.postMessage(message, '*');
}

interface PendingPopout {
  win: Window;
  evidence: unknown;
}

let pending: PendingPopout | null = null;
let readyListenerFor: Window | null = null;

function postEvidence(target: PendingPopout): void {
  target.win.postMessage({ type: POPOUT_MESSAGE.data, evidence: target.evidence }, '*');
}

function ensureReadyListener(opener: Window): void {
  if (readyListenerFor === opener) return;
  readyListenerFor = opener;
  opener.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (!pending || !data || data.type !== POPOUT_MESSAGE.ready) return;
    if (event.source !== pending.win) return;
    postEvidence(pending);
  });
}

/**
 * Opens (or reuses) the named pop-out window and hands it the evidence record. Returns null when
 * the browser blocked the window (legacy: "Popup blocked. Please allow popups for this site.").
 */
export function openEvidencePopoutWindow(evidence: unknown, opener: Window = window): Window | null {
  const win = opener.open(EVIDENCE_POPOUT_PATH, EVIDENCE_POPOUT_NAME, EVIDENCE_POPOUT_FEATURES);
  if (!win) return null;
  pending = { win, evidence };
  ensureReadyListener(opener);
  const target = pending;
  // Legacy: post now if the window has loaded, else on load. The ready handshake covers the
  // React mount, which can come after both.
  try {
    if (win.document.readyState === 'complete') postEvidence(target);
    else win.addEventListener('load', () => postEvidence(target), { once: true });
  } catch {
    // Window not yet scriptable; the ready handshake delivers the data.
  }
  return win;
}

/** Test seam: forget the pending pop-out and the opener listener. */
export function resetPopoutState(): void {
  pending = null;
  readyListenerFor = null;
}

export const UNIFIED_VARIABLES_WINDOW = { name: 'unifiedVariables', features: 'width=850,height=750,resizable=yes,scrollbars=yes' };
export const REGISTRY_EDITOR_WINDOW = { name: 'registryEditor', features: 'width=950,height=750,resizable=yes,scrollbars=yes' };

/** Legacy launchUnifiedVariables: same window name and features, SPA path. Caller checks the tenant (not '' or 'dev'). */
export function launchUnifiedVariables(tenant: string, opener: Window = window): Window | null {
  return opener.open(
    `/app/variables?tenant=${encodeURIComponent(tenant)}`,
    UNIFIED_VARIABLES_WINDOW.name,
    UNIFIED_VARIABLES_WINDOW.features,
  );
}

/** Legacy launchRegistryEditor: same window name and features, SPA path, type m365. */
export function launchRegistryEditor(tenant: string, opener: Window = window): Window | null {
  return opener.open(
    `/app/registry?tenant=${encodeURIComponent(tenant)}&type=m365`,
    REGISTRY_EDITOR_WINDOW.name,
    REGISTRY_EDITOR_WINDOW.features,
  );
}
