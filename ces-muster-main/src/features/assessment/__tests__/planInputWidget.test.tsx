// @vitest-environment jsdom
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU MU-10 (F9 closed): the non-enum SIT residue is asked IN the interview.
// A typed input renders for each non-enum SIT node on the Plan Inputs tab; a
// valid value is recorded as the session fact (the one fact store the compile
// reads); an invalid value is refused with its reason and nothing is recorded.
//
// Real AssessmentPage resume path over real Dexie (fake-indexeddb).
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import AssessmentPage from '../AssessmentPage';
import { createSession } from '@/driver/sessionDriver';
import { db } from '@/shared/db/schema';

let container: HTMLDivElement;
let root: Root;

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

function typeAndBlur(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

const q = (sel: string) => container.querySelector(sel) as HTMLInputElement | null;

describe('MU-10 typed plan inputs in the interview', () => {
  test('a valid count is recorded as the session fact; an invalid one is refused', async () => {
    const handle = await createSession('individual_contractor', {
      stacks: [],
      party: { name: 'Typed Input Co', on_prem_ot: 'no' },
    });

    await act(async () => {
      root.render(
        <AssessmentPage existingSessionId={handle.sessionId} onEngagementReady={() => {}} onComplete={() => {}} />
      );
    });
    await waitFor(() => container.querySelector('[data-testid="tab-plan-input:si"]') !== null);
    const tab = container.querySelector('[data-testid="tab-plan-input:si"]') as HTMLButtonElement;
    await waitFor(() => !tab.disabled);
    await act(async () => tab.click());
    await waitFor(() => q('[data-testid="plan-input-SIT-022"]') !== null);

    // All eight non-enum SIT questions render a typed input.
    for (const id of ['G-03', 'G-04', 'G-06', 'S-11', 'SIT-022', 'SIT-023', 'SIT-024', 'SIT-025']) {
      expect(q(`[data-testid="plan-input-${id}"]`), id).not.toBeNull();
    }

    await act(async () => typeAndBlur(q('[data-testid="plan-input-SIT-022"]')!, '35'));
    await act(async () => typeAndBlur(q('[data-testid="plan-input-G-06"]')!, 'soon-ish'));
    await waitFor(() => false, 10);

    const facts = (await db.interview_sessions.get(handle.sessionId))!.facts;
    const f = facts.find((x) => x.question_id === 'SIT-022');
    expect(f?.answer).toBe('35');
    expect(f?.provenance).toBe('operator_interview');
    expect(facts.find((x) => x.question_id === 'G-06')).toBeUndefined();
    expect(container.querySelector('[data-testid="plan-input-error-G-06"]')?.textContent).toMatch(/YYYY-MM-DD/);
  });
});
