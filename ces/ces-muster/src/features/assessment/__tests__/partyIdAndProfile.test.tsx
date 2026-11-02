// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PL-1 C2 + C3 — AssessmentPage party_id threading and profile-answer
// persistence, driven through the real component + real Dexie (fake-indexeddb).
// No RTL in this repo — render via react-dom/client into a jsdom container and
// dispatch native events (same idiom as DiscoveryOffer.test.tsx).
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import AssessmentPage from '../AssessmentPage';
import { db } from '@/shared/db/schema';
import type { EngagementKind } from '@/shared/types/engagement';

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

/** Flush pending microtasks + Dexie promises. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Poll a condition, flushing between tries — the Dexie write chain spans ticks. */
async function waitFor(cond: () => boolean, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

/** Set a controlled input's value the way React expects (native setter + event). */
function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Set a controlled <select>'s value (React onChange fires on the change event). */
function setSelectValue(el: HTMLSelectElement, value: string): void {
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(
    el,
    value
  );
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('C2 — party_id threads on the new-session (non-resume) create path', () => {
  test('Begin Interview fires onEngagementReady with the real party_id', async () => {
    const onEngagementReady = vi.fn();
    await act(async () => {
      root.render(
        <AssessmentPage onEngagementReady={onEngagementReady} onComplete={() => {}} />
      );
    });
    await flush();

    // Fill the two required profile fields, then begin.
    await act(async () => {
      setInputValue(
        container.querySelector('input[placeholder="Acme Defense LLC"]') as HTMLInputElement,
        'Acme Defense LLC'
      );
      (
        container.querySelector('input[name="on_prem_ot"][value="no"]') as HTMLInputElement
      ).click();
    });

    await act(async () =>
      (container.querySelector('[data-testid="begin-interview"]') as HTMLButtonElement).click()
    );
    await waitFor(() => onEngagementReady.mock.calls.length > 0);
    // Guard: no validation error blocked the begin.
    expect(container.querySelector('.form-error')).toBeNull();

    // The callback carried a real party_id (3rd arg) — not null, not undefined.
    expect(onEngagementReady).toHaveBeenCalledTimes(1);
    const [, engagementId, partyId] = onEngagementReady.mock.calls[0] as [
      EngagementKind,
      string,
      string,
    ];
    expect(typeof partyId).toBe('string');
    expect(partyId.length).toBeGreaterThan(0);

    // And that party_id resolves to a real party attached to the engagement —
    // proving a contract created mid-new-session (which uses this id) would attach.
    const party = await db.assessed_parties.get(partyId);
    expect(party).toBeDefined();
    expect(party!.engagement_id).toBe(engagementId);
    expect(party!.name).toBe('Acme Defense LLC');
  });
});

describe('C3 — the three profile answers persist through begin and restore on resume', () => {
  test('answers set before Begin are written to the party record', async () => {
    const onEngagementReady = vi.fn();
    await act(async () => {
      root.render(
        <AssessmentPage onEngagementReady={onEngagementReady} onComplete={() => {}} />
      );
    });
    await flush();

    await act(async () => {
      setInputValue(
        container.querySelector('input[placeholder="Acme Defense LLC"]') as HTMLInputElement,
        'Profile Corp'
      );
      (container.querySelector('input[name="on_prem_ot"][value="no"]') as HTMLInputElement).click();
      (
        container.querySelector('input[name="covers_m365"][value="yes"]') as HTMLInputElement
      ).click();
      (
        container.querySelector('input[name="has_ssp"][value="unsure"]') as HTMLInputElement
      ).click();
      const empSelect = container.querySelector('select') as HTMLSelectElement;
      setSelectValue(empSelect, '50-250');
    });

    await act(async () =>
      (container.querySelector('[data-testid="begin-interview"]') as HTMLButtonElement).click()
    );
    await waitFor(() => onEngagementReady.mock.calls.length > 0);

    const [, , partyId] = onEngagementReady.mock.calls[0] as [EngagementKind, string, string];
    const party = await db.assessed_parties.get(partyId);
    expect(party!.employee_count).toBe('50-250');
    expect(party!.has_ssp).toBe('unsure');
    expect(party!.covers_m365).toBe('yes');
  });

  test('resume restores the three answers into the profile inputs', async () => {
    // Seed an in-progress session whose party carries all three answers.
    await db.engagements.add({
      id: 'eng-r1',
      engagement_kind: 'individual_contractor',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.assessed_parties.add({
      id: 'party-r1',
      engagement_id: 'eng-r1',
      name: 'Resume Corp',
      on_prem_ot: 'yes',
      created_at: '2026-01-01T00:00:00Z',
      employee_count: '250+',
      has_ssp: 'yes',
      covers_m365: 'no',
    });
    await db.interview_sessions.add({
      id: 'sess-r1',
      party_id: 'party-r1',
      facts: [],
      timing_segments: [],
      status: 'in_progress',
      created_at: '2026-01-01T00:00:00Z',
    });

    await act(async () => {
      root.render(
        <AssessmentPage
          existingSessionId="sess-r1"
          onEngagementReady={() => {}}
          onComplete={() => {}}
        />
      );
    });
    await waitFor(
      () => (container.querySelector('select') as HTMLSelectElement | null)?.value === '250+'
    );

    const empSelect = container.querySelector('select') as HTMLSelectElement;
    expect(empSelect.value).toBe('250+');
    expect(
      (container.querySelector('input[name="has_ssp"][value="yes"]') as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (container.querySelector('input[name="covers_m365"][value="no"]') as HTMLInputElement).checked
    ).toBe(true);
  });
});
