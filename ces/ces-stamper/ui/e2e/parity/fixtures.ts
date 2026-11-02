// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The parity specs' `test` (W8-PIS): Playwright's test plus one automatic fixture that leaves
// the shared GUI server as it found it. Every page in the test's context records the
// EventSources it opens; on teardown each is closed, then POST /api/abort (the server's own
// reset: it sets the halt flag and answers every pending approval gate with skip, so a manual
// run a failed test left waiting does not hold the next test's /api/execute). Every step is
// bounded; the fixture has its own timeout.

import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

export { expect } from '@playwright/test';

const TEARDOWN_STEP_MS = 5_000;

/** Wraps window.EventSource so the page keeps a list of the streams it opened. */
function trackEventSources(): void {
  const w = window as unknown as { EventSource?: typeof EventSource; __cesParitySources?: EventSource[] };
  const Native = w.EventSource;
  if (!Native || w.__cesParitySources) return;
  const sources: EventSource[] = [];
  w.__cesParitySources = sources;
  w.EventSource = class extends Native {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      sources.push(this);
    }
  };
}

async function bounded<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([work.catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function closeEventSources(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await bounded(
    page.evaluate(() => {
      const list = (window as unknown as { __cesParitySources?: EventSource[] }).__cesParitySources ?? [];
      for (const source of list) source.close();
    }),
    TEARDOWN_STEP_MS,
  );
}

export const test = base.extend<{ parityTeardown: void }>({
  parityTeardown: [
    async ({ context, request }, use) => {
      await context.addInitScript(trackEventSources);
      await use();
      for (const page of context.pages()) await closeEventSources(page);
      await bounded(request.post('/api/abort', { timeout: TEARDOWN_STEP_MS }), TEARDOWN_STEP_MS);
    },
    { auto: true, timeout: 20_000 },
  ],
});
