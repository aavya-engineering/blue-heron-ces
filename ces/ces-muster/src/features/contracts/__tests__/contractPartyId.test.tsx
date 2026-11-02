// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PL-1 C2 — a contract created mid-new-session carries the real
// party_id that App threads down (previously null except on resume). The api
// module is mocked so the page comes online and we can inspect the POST body.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const { post } = vi.hoisted(() => ({
  post: vi.fn(async (_path: string, _body?: unknown) => ({ ok: true, data: { id: 'c-1' } })),
}));
vi.mock('@/shared/api/musterApi', () => ({
  api: {
    get: vi.fn(async () => ({ ok: true, data: [] })),
    post,
    put: vi.fn(async () => ({ ok: true, data: {} })),
    delete: vi.fn(async () => ({ ok: true, data: {} })),
  },
}));

import ContractsPage from '../ContractsPage';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  post.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function setInputValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('C2 — ContractsPage POSTs the threaded party_id', () => {
  test('create sends party_id from props (the mid-new-session party)', async () => {
    await act(async () => {
      root.render(<ContractsPage engagementKind="individual_contractor" partyId="party-new-1" />);
    });
    await flush();

    // Open the create form.
    await act(async () =>
      (container.querySelector('[data-testid="contracts-add-btn"]') as HTMLButtonElement).click()
    );
    // Fill the three required fields.
    setInputValue(
      container.querySelector('[data-testid="contract-number-input"]') as HTMLInputElement,
      'W911NF-24-C-0001'
    );
    setInputValue(
      container.querySelector('[data-testid="program-name-input"]') as HTMLInputElement,
      'CUI Cyber Program'
    );
    setInputValue(
      container.querySelector('[data-testid="cmmc-level-select"]') as HTMLSelectElement,
      '2'
    );
    await act(async () =>
      (container.querySelector('[data-testid="contract-submit-btn"]') as HTMLButtonElement).click()
    );
    await flush();

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/contracts');
    expect(body.party_id).toBe('party-new-1');
    // individual_contractor → prime_ref null (unchanged behavior).
    expect(body.prime_ref).toBeNull();
  });
});
