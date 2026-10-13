// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M2 gate — number-drift guard. Asserts cited figures appear verbatim in
// DISCOVERY_OFFER_COPY (Verification step 6).
import { describe, it, expect } from 'vitest';
import { DISCOVERY_OFFER_COPY } from '../discoveryOfferCopy';

describe('discoveryOfferCopy', () => {
  it('cites 41.6%, 87.3%, 150, and 37 verbatim', () => {
    const all = JSON.stringify(DISCOVERY_OFFER_COPY);
    expect(all).toContain('41.6%');
    expect(all).toContain('87.3%');
    expect(all).toContain('150');
    expect(all).toContain('37');
  });

  it('exposes run and skip button labels', () => {
    expect(DISCOVERY_OFFER_COPY.runButtonLabel).toBeTruthy();
    expect(DISCOVERY_OFFER_COPY.skipButtonLabel).toBeTruthy();
  });
});
