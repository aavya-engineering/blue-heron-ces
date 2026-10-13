// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M2 gate — DiscoveryOffer transitions. Run/Skip buttons fire their callbacks.
// No React Testing Library dependency in this repo — render via react-dom/client
// into a jsdom container (default test environment) and dispatch native clicks.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DiscoveryOffer from '../DiscoveryOffer';
import { DISCOVERY_OFFER_COPY } from '../discoveryOfferCopy';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('DiscoveryOffer', () => {
  it('renders copy from discoveryOfferCopy.ts', () => {
    act(() => {
      root.render(<DiscoveryOffer onRunDiscovery={() => {}} onSkip={() => {}} onImportResults={() => {}} />);
    });
    expect(container.textContent).toContain(DISCOVERY_OFFER_COPY.heading);
  });

  it('discovery-run-btn fires onRunDiscovery', () => {
    const onRunDiscovery = vi.fn();
    act(() => {
      root.render(<DiscoveryOffer onRunDiscovery={onRunDiscovery} onSkip={() => {}} onImportResults={() => {}} />);
    });
    const btn = container.querySelector('[data-testid="discovery-run-btn"]') as HTMLButtonElement;
    act(() => btn.click());
    expect(onRunDiscovery).toHaveBeenCalledTimes(1);
  });

  it('discovery-skip-btn fires onSkip', () => {
    const onSkip = vi.fn();
    act(() => {
      root.render(<DiscoveryOffer onRunDiscovery={() => {}} onSkip={onSkip} onImportResults={() => {}} />);
    });
    const btn = container.querySelector('[data-testid="discovery-skip-btn"]') as HTMLButtonElement;
    act(() => btn.click());
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  // W4-MU2 (MU-02): a real run is async and can fail — the offer shows both.
  it('while a run is in progress the button is disabled; a failed run shows its reason', () => {
    act(() => {
      root.render(
        <DiscoveryOffer onRunDiscovery={() => {}} onSkip={() => {}} onImportResults={() => {}} runBusy />
      );
    });
    const btn = container.querySelector('[data-testid="discovery-run-btn"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    act(() => {
      root.render(
        <DiscoveryOffer
          onRunDiscovery={() => {}}
          onSkip={() => {}}
          onImportResults={() => {}}
          runError="muster-api is not reachable"
        />
      );
    });
    expect(container.querySelector('[data-testid="discovery-run-error"]')?.textContent).toContain(
      'muster-api is not reachable'
    );
    // The file import stays available after a failed run.
    expect(container.querySelector('[data-testid="discovery-import-input"]')).not.toBeNull();
  });
});
