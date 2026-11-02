// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVIDENCE_POPOUT_FEATURES,
  EVIDENCE_POPOUT_NAME,
  POPOUT_MESSAGE,
  launchRegistryEditor,
  launchUnifiedVariables,
  notifyOpener,
  openEvidencePopoutWindow,
  resetPopoutState,
} from './popout';

interface FakeWindow {
  win: Window;
  posted: unknown[];
  listeners: Record<string, Array<(e: unknown) => void>>;
}

function fakePopout(readyState: DocumentReadyState): FakeWindow {
  const posted: unknown[] = [];
  const listeners: FakeWindow['listeners'] = {};
  const win = {
    document: { readyState },
    postMessage: (msg: unknown) => posted.push(msg),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
  } as unknown as Window;
  return { win, posted, listeners };
}

function fakeOpener(popout: Window | null) {
  const listeners: Array<(e: MessageEvent) => void> = [];
  const open = vi.fn(() => popout);
  const opener = {
    open,
    addEventListener: (_type: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
  } as unknown as Window;
  return { opener, open, listeners };
}

const EVIDENCE = { complianceVerdict: 'SAT' };

beforeEach(() => resetPopoutState());
afterEach(() => vi.restoreAllMocks());

describe('evidence pop-out window (PC-11)', () => {
  it('opens the legacy window name and features at the SPA path and posts at once when loaded', () => {
    const pop = fakePopout('complete');
    const { opener, open } = fakeOpener(pop.win);
    expect(openEvidencePopoutWindow(EVIDENCE, opener)).toBe(pop.win);
    expect(open).toHaveBeenCalledWith('/app/popout', EVIDENCE_POPOUT_NAME, EVIDENCE_POPOUT_FEATURES);
    expect([EVIDENCE_POPOUT_NAME, EVIDENCE_POPOUT_FEATURES]).toEqual(['stamper-evidence-popout', 'width=900,height=700']);
    expect(pop.posted).toEqual([{ type: POPOUT_MESSAGE.data, evidence: EVIDENCE }]);
  });

  it('posts on load when still loading, and again when the page reports ready', () => {
    const pop = fakePopout('loading');
    const { opener, listeners } = fakeOpener(pop.win);
    openEvidencePopoutWindow(EVIDENCE, opener);
    expect(pop.posted).toEqual([]);
    pop.listeners['load']![0]!({});
    expect(pop.posted).toHaveLength(1);
    listeners[0]!({ data: { type: 'evidence_popout_ready' }, source: {} } as MessageEvent);
    expect(pop.posted).toHaveLength(1); // ready from another window is ignored
    listeners[0]!({ data: { type: 'evidence_popout_ready' }, source: pop.win } as MessageEvent);
    expect(pop.posted).toEqual([
      { type: 'evidence_data', evidence: EVIDENCE },
      { type: 'evidence_data', evidence: EVIDENCE },
    ]);
  });

  it('returns null when the pop-up is blocked', () => {
    const { opener } = fakeOpener(null);
    expect(openEvidencePopoutWindow(EVIDENCE, opener)).toBeNull();
  });
});

describe('opener notices and editor launchers', () => {
  it('posts to the opener only when there is one', () => {
    const post = vi.fn();
    const child = { opener: { postMessage: post } } as unknown as Window;
    notifyOpener({ type: 'variables-saved' }, child);
    expect(post).toHaveBeenCalledWith({ type: 'variables-saved' }, '*');
    expect(() => notifyOpener({ type: 'variables-saved' }, { opener: null } as unknown as Window)).not.toThrow();
  });

  it('opens the editors with the legacy window names and features', () => {
    const { opener, open } = fakeOpener(null);
    launchUnifiedVariables('ridgeline fixture', opener);
    launchRegistryEditor('ridgeline-fixture', opener);
    expect(open.mock.calls).toEqual([
      ['/app/variables?tenant=ridgeline%20fixture', 'unifiedVariables', 'width=850,height=750,resizable=yes,scrollbars=yes'],
      ['/app/registry?tenant=ridgeline-fixture&type=m365', 'registryEditor', 'width=950,height=750,resizable=yes,scrollbars=yes'],
    ]);
  });
});
