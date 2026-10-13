// @vitest-environment jsdom
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU-2 (MS-5): the Tenant Config intake asks for the approver UPN, the
// terms-of-use file and the initial password — real AssessmentPage resume path
// over real Dexie (fake-indexeddb).
//   - UPN: a typed input; a valid UPN is recorded, an invalid one refused.
//   - ToU: a file input; a PDF is stored on the session, the fact is name+sha256;
//     a non-PDF is refused and nothing is recorded.
//   - Password: a Generate button (no text box). The value is shown once and is
//     NOT written to Dexie; the fact is the one-time reference.
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

function pickFile(el: HTMLInputElement, file: File): void {
  Object.defineProperty(el, 'files', { value: [file], configurable: true });
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const q = (sel: string) => container.querySelector(sel) as HTMLInputElement | null;

async function openTcpTab(): Promise<string> {
  const handle = await createSession('individual_contractor', {
    stacks: [],
    party: { name: 'Provisioning Intake Co', on_prem_ot: 'no' },
  });
  await act(async () => {
    root.render(<AssessmentPage existingSessionId={handle.sessionId} onEngagementReady={() => {}} onComplete={() => {}} />);
  });
  await waitFor(() => container.querySelector('[data-testid="tab-plan-input:tcp"]') !== null);
  const tab = container.querySelector('[data-testid="tab-plan-input:tcp"]') as HTMLButtonElement;
  await waitFor(() => !tab.disabled);
  await act(async () => tab.click());
  await waitFor(() => q('[data-testid="plan-input-TCP.MU.003"]') !== null);
  return handle.sessionId;
}

const facts = async (sessionId: string) => (await db.interview_sessions.get(sessionId))!.facts;

describe('FC-MU-2 MS-5 provisioning inputs in the Tenant Config intake', () => {
  test('approver UPN: valid recorded, invalid refused', async () => {
    const sessionId = await openTcpTab();
    await act(async () => typeAndBlur(q('[data-testid="plan-input-TCP.MU.001"]')!, 'not a upn'));
    await waitFor(() => false, 5);
    expect((await facts(sessionId)).find((f) => f.question_id === 'TCP.MU.001')).toBeUndefined();
    expect(container.querySelector('[data-testid="plan-input-error-TCP.MU.001"]')?.textContent).toMatch(/sign-in name/);
    await act(async () => typeAndBlur(q('[data-testid="plan-input-TCP.MU.001"]')!, 'approver@contoso.example'));
    await waitFor(() => false, 10);
    expect((await facts(sessionId)).find((f) => f.question_id === 'TCP.MU.001')?.answer).toBe('approver@contoso.example');
  });

  test('ToU file: a PDF is stored on the session and the fact is its name + sha256; a non-PDF is refused', async () => {
    const sessionId = await openTcpTab();
    const input = q('[data-testid="plan-input-TCP.MU.002"]')!;
    expect(input.type).toBe('file');

    await act(async () => pickFile(input, new File(['hello'], 'notes.txt', { type: 'text/plain' })));
    await waitFor(() => container.querySelector('[data-testid="plan-input-error-TCP.MU.002"]') !== null);
    expect(container.querySelector('[data-testid="plan-input-error-TCP.MU.002"]')?.textContent).toMatch(/PDF/);
    expect((await facts(sessionId)).find((f) => f.question_id === 'TCP.MU.002')).toBeUndefined();

    const pdf = '%PDF-1.4\n% terms of use\n%%EOF\n';
    await act(async () => pickFile(input, new File([pdf], 'Terms.pdf', { type: 'application/pdf' })));
    await waitFor(() => container.querySelector('[data-testid="plan-input-current-TCP.MU.002"]') !== null);
    const session = (await db.interview_sessions.get(sessionId))!;
    const fact = session.facts.find((f) => f.question_id === 'TCP.MU.002');
    expect(fact?.answer).toMatch(/^file:Terms\.pdf;sha256:[0-9a-f]{64}$/);
    expect(session.provisioning_inputs?.tou_file?.name).toBe('Terms.pdf');
    expect(atob(session.provisioning_inputs!.tou_file!.base64)).toBe(pdf);
    expect(fact!.answer).toContain(session.provisioning_inputs!.tou_file!.sha256);
  });

  test('initial password: generated, shown once, never written to Dexie; the fact is the reference', async () => {
    const sessionId = await openTcpTab();
    const button = q('[data-testid="plan-input-TCP.MU.003"]')!;
    expect(button.tagName).toBe('BUTTON'); // never a text box
    await act(async () => button.click());
    await waitFor(() => container.querySelector('[data-testid="plan-input-secret-value-TCP.MU.003"]') !== null);
    const password = container.querySelector('[data-testid="plan-input-secret-value-TCP.MU.003"]')!.textContent!;
    expect(password.length).toBeGreaterThanOrEqual(20);
    await waitFor(() => false, 10);

    const session = (await db.interview_sessions.get(sessionId))!;
    const fact = session.facts.find((f) => f.question_id === 'TCP.MU.003');
    expect(fact?.answer).toMatch(/^secretref:one-time:[0-9a-f-]{36}$/);
    const everything = JSON.stringify({
      sessions: await db.interview_sessions.toArray(),
      engagements: await db.engagements.toArray(),
      parties: await db.assessed_parties.toArray(),
      queued: await db.queued_answers.toArray(),
    });
    expect(everything).not.toContain(password);

    await act(async () => (container.querySelector('[data-testid="plan-input-secret-hide-TCP.MU.003"]') as HTMLButtonElement).click());
    expect(container.querySelector('[data-testid="plan-input-secret-value-TCP.MU.003"]')).toBeNull();
    expect(container.innerHTML).not.toContain(password);
  });
});
