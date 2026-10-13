// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { StackShapeGate, type GatedResolver } from './StackShapeGate.js';

// Two resolver classes per Core Design (e)'s behavioral matrix.
const sentinelTierResolver: GatedResolver = { azureTier: 'sentinel' };
const fullTierResolver: GatedResolver = { azureTier: 'full' };

describe('StackShapeGate — three-shape x two-resolver-class matrix', () => {
  it('m365_only throws on a sentinel-tier resolver (Log Analytics / Sentinel)', () => {
    const gate = new StackShapeGate('m365_only');
    expect(() => gate.checkAccess(sentinelTierResolver)).toThrow();
  });

  it('m365_only throws on a full-tier resolver (storage/KeyVault/VNet/automation/managedIdentity)', () => {
    const gate = new StackShapeGate('m365_only');
    expect(() => gate.checkAccess(fullTierResolver)).toThrow();
  });

  it('m365_sentinel succeeds on a sentinel-tier resolver', () => {
    const gate = new StackShapeGate('m365_sentinel');
    expect(() => gate.checkAccess(sentinelTierResolver)).not.toThrow();
  });

  it('m365_sentinel throws on a full-tier resolver', () => {
    const gate = new StackShapeGate('m365_sentinel');
    expect(() => gate.checkAccess(fullTierResolver)).toThrow();
  });

  it('m365_azure succeeds on a sentinel-tier resolver', () => {
    const gate = new StackShapeGate('m365_azure');
    expect(() => gate.checkAccess(sentinelTierResolver)).not.toThrow();
  });

  it('m365_azure succeeds on a full-tier resolver', () => {
    const gate = new StackShapeGate('m365_azure');
    expect(() => gate.checkAccess(fullTierResolver)).not.toThrow();
  });
});
