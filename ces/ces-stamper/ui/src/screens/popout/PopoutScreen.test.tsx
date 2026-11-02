// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Evidence pop-out page (legacy evidence-popout.html, PC-11): title, evidence_data in,
// evidence_ok / evidence_closed out, ready handshake. Fictional fixture data only.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PopoutScreen, { POPOUT_TITLE } from '.';
import { FIXTURE_EVIDENCE } from '../../store/spa3-mock-api';

let post: ReturnType<typeof vi.fn>;

function setOpener(value: unknown) {
  Object.defineProperty(window, 'opener', { value, configurable: true, writable: true });
}

function send(data: unknown, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  });
}

const byId = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  post = vi.fn();
  setOpener({ postMessage: post, closed: false });
});

afterEach(() => {
  cleanup();
  setOpener(null);
  vi.restoreAllMocks();
});

describe('Evidence pop-out (PC-11)', () => {
  it('sets the legacy title, shows the empty page, and tells the opener it is ready', () => {
    render(<PopoutScreen />);
    expect(document.title).toBe(POPOUT_TITLE);
    expect(POPOUT_TITLE).toBe('CES — Evidence Review');
    expect(byId('evidenceTitle')).toHaveTextContent('CES — Evidence Review');
    expect(byId('okButton')).toBeInTheDocument();
    expect(byId('ces-theme-toggle')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith({ type: 'evidence_popout_ready' }, '*');
  });

  it('renders evidence_data from the same origin only', () => {
    render(<PopoutScreen />);
    send({ type: 'evidence_data', evidence: FIXTURE_EVIDENCE }, 'http://elsewhere.example');
    expect(byId('evidenceTitle')).toHaveTextContent('CES — Evidence Review');
    send({ type: 'evidence_data', evidence: FIXTURE_EVIDENCE });
    expect(byId('evidenceTitle')).toHaveTextContent('ac-ca-baseline — Conditional Access baseline');
    expect(byId('cmmcControls')).toHaveTextContent('AC.L2-3.1.1');
    expect(byId('verdictBadge')).toHaveTextContent('SAT');
  });

  it('OK posts evidence_ok and closes; unload after OK posts nothing more', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<PopoutScreen />);
    send({ type: 'evidence_data', evidence: FIXTURE_EVIDENCE });
    await user.click(byId('okButton'));
    expect(post).toHaveBeenLastCalledWith({ type: 'evidence_ok' }, '*');
    expect(close).toHaveBeenCalled();
    const calls = post.mock.calls.length;
    window.dispatchEvent(new Event('beforeunload'));
    expect(post.mock.calls.length).toBe(calls);
  });

  it('closing without OK posts evidence_closed', () => {
    render(<PopoutScreen />);
    window.dispatchEvent(new Event('beforeunload'));
    expect(post).toHaveBeenLastCalledWith({ type: 'evidence_closed' }, '*');
  });

  it('works without an opener', () => {
    setOpener(null);
    render(<PopoutScreen />);
    expect(() => window.dispatchEvent(new Event('beforeunload'))).not.toThrow();
  });
});
