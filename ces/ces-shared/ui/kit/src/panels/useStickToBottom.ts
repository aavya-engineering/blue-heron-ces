// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useEffect, useRef } from 'react';

/**
 * Legacy scrollConsole / scrollTerminal: scroll to the bottom whenever `changeKey` changes.
 * With `pauseOnScrollUp` (the terminal), scrolling more than 40 px above the bottom pauses it.
 * Internal to the panels; not exported from the kit.
 */
export function useStickToBottom<T extends HTMLElement>(changeKey: string, pauseOnScrollUp: boolean) {
  const ref = useRef<T>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && (stick.current || !pauseOnScrollUp)) el.scrollTop = el.scrollHeight;
  }, [changeKey, pauseOnScrollUp]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return { ref, onScroll };
}
