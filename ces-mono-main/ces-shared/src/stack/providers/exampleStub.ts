// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G4 — example/proof stub stack provider.
//
// This is NOT a real stack and contains NO authored domain content (capability, not content). Its
// only purpose is to PROVE the stack-provider seam is genuinely pluggable — i.e. that the Microsoft
// path is just another registered provider, not special-cased. It declares the minimum valid
// capability set; the subsystems treat an unknown capability id as "no content" gracefully.

import type { StackProvider } from '../StackProvider.js';

export const EXAMPLE_STUB_STACK_ID = 'example-stub';

export const exampleStubProvider: StackProvider = {
  capabilities: {
    id: EXAMPLE_STUB_STACK_ID,
    displayName: 'Example Stub Stack (proof of pluggability — no content)',
    cloudEndpoints: {
      graph: 'https://graph.example.invalid',
      login: 'https://login.example.invalid',
    },
    controlSignalRegistryId: 'stub-empty',
    evaluatorSetId: 'stub-empty',
    vendorPlaybookId: 'stub-empty',
    techStackMapId: 'stub-empty',
    sspNarrativeSourceId: 'stub-empty',
    conventions: {
      cloudEnvironment: 'example',
      defaultLocation: 'none',
      identityModel: 'none',
      infrastructureModels: ['default'],
    },
  },
};
