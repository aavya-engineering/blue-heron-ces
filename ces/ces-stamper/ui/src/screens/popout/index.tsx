// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Evidence pop-out window (legacy ces-stamper/public/evidence-popout.html; PC-11). Renders outside
// the shell. Protocol as legacy: `evidence_data` in from the opener; `evidence_ok` (OK, then
// window.close) or `evidence_closed` (closed without OK) out. Added: on mount it posts
// `evidence_popout_ready` so the opener can resend data that arrived before React mounted.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EvidenceViewer, ThemeToggle } from 'ces-ui-kit';
import type { EvidenceInput } from 'ces-ui-kit';
import { POPOUT_MESSAGE } from '../../store/popout';

export const POPOUT_TITLE = 'CES — Evidence Review';

function openerOf(win: Window): Window | null {
  const opener = win.opener as Window | null;
  return opener && opener !== win && !opener.closed ? opener : null;
}

export default function PopoutScreen() {
  const [evidence, setEvidence] = useState<EvidenceInput | null>(null);
  const okClicked = useRef(false);

  useEffect(() => {
    const previous = document.title;
    document.title = POPOUT_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; evidence?: EvidenceInput } | null;
      if (data && data.type === POPOUT_MESSAGE.data) {
        okClicked.current = false; // a new review cycle
        setEvidence(data.evidence ?? null);
      }
    };
    const onBeforeUnload = () => {
      const opener = openerOf(window);
      if (!okClicked.current && opener) opener.postMessage({ type: POPOUT_MESSAGE.closed }, '*');
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('beforeunload', onBeforeUnload);
    openerOf(window)?.postMessage({ type: POPOUT_MESSAGE.ready }, '*');
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  const onOk = useCallback(() => {
    okClicked.current = true;
    openerOf(window)?.postMessage({ type: POPOUT_MESSAGE.ok }, '*');
    window.close();
  }, []);

  return (
    <main className="spa-screen spa-popout" data-screen="popout">
      <EvidenceViewer mode="popout" evidence={evidence} onOk={onOk} headerControls={<ThemeToggle />} />
    </main>
  );
}
