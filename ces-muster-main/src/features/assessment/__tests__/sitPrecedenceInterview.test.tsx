// @vitest-environment jsdom
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU MU-10 precedence, interview half: an explicit operator answer always
// beats a derivation (founder default 2026-09-27). The compile honours the
// operator's SIT answer; the interview must therefore NOT prune that question
// off screen because a derivation covers it — the operator's answer stays
// visible and editable. A SIT question nobody answered is still pruned by its
// derivation (the derivation still applies where there is no answer).
//
// Real AssessmentPage resume path over real Dexie (fake-indexeddb); the session
// is built with the production session driver.
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import AssessmentPage from '../AssessmentPage';
import { createSession, answer } from '@/driver/sessionDriver';
import { deriveSitFacts } from '@/features/plan/siDerivation';
import { db } from '@/shared/db/schema';

let container: HTMLDivElement;
let root: Root;
const STACKS = ['m365_e5_gcc'];

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function waitFor(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

describe('MU-10 precedence in the interview', () => {
  test('an operator-answered SIT-020 stays on screen with its answer; un-answered derived S-20 is pruned', async () => {
    // Precondition: these stacks derive BOTH SIT-020 and S-20.
    const derivedIds = deriveSitFacts({ selectedStacks: STACKS }).derivedIds;
    expect(derivedIds).toEqual(expect.arrayContaining(['SIT-020', 'S-20']));

    const handle = await createSession('individual_contractor', {
      stacks: STACKS,
      party: { name: 'Precedence Interview Co', on_prem_ot: 'no' },
    });
    await answer(handle, 'SIT-020', 'm365_sentinel');

    await act(async () => {
      root.render(
        <AssessmentPage existingSessionId={handle.sessionId} onEngagementReady={() => {}} onComplete={() => {}} />
      );
    });
    await waitFor(() => container.querySelector('[data-testid="tab-plan-input:si"]') !== null);
    const tab = container.querySelector('[data-testid="tab-plan-input:si"]') as HTMLButtonElement;
    await waitFor(() => !tab.disabled);
    await act(async () => tab.click());
    await waitFor(() => container.querySelector('input[name="SIT-020"]') !== null);

    const checked = container.querySelector('input[name="SIT-020"]:checked') as HTMLInputElement | null;
    expect(checked?.value).toBe('m365_sentinel');
    expect(container.querySelector('input[name="S-20"]')).toBeNull();
  });

  // Interview/compile parity for the fact-reading derivations: bnd-001 = yes
  // derives G-02 (CUI presence), so the interview does not ask G-02 again.
  test('bnd-001 answered yes derives G-02, so the interview prunes G-02', async () => {
    const handle = await createSession('individual_contractor', {
      stacks: [],
      party: { name: 'Derived CUI Co', on_prem_ot: 'no' },
    });
    await answer(handle, 'bnd-001', 'yes');

    await act(async () => {
      root.render(
        <AssessmentPage existingSessionId={handle.sessionId} onEngagementReady={() => {}} onComplete={() => {}} />
      );
    });
    await waitFor(() => container.querySelector('[data-testid="tab-plan-input:si"]') !== null);
    const tab = container.querySelector('[data-testid="tab-plan-input:si"]') as HTMLButtonElement;
    await waitFor(() => !tab.disabled);
    await act(async () => tab.click());
    await waitFor(() => container.querySelector('input[name="G-05"]') !== null);

    expect(container.querySelector('input[name="G-05"]')).not.toBeNull(); // the tab rendered
    expect(container.querySelector('input[name="G-02"]')).toBeNull();
  });
});
