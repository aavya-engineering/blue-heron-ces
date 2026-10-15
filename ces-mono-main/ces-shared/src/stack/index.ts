// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G4 — stack-provider seam entry point. FE-safe (no node:* imports).
//
// Exposes the default registry (Microsoft reference + example proof stub) and helpers to resolve
// the active stack provider from config. Consumers import from 'ces-shared/stack'.

export * from './StackProvider.js';
import { StackRegistry, resolveStackId, type StackProvider, type StackId } from './StackProvider.js';
import { microsoftGccHighProvider } from './providers/microsoftGccHigh.js';
import { exampleStubProvider } from './providers/exampleStub.js';
import { googleWorkspaceCloudProvider } from './providers/googleWorkspaceCloud.js';

export { microsoftGccHighProvider } from './providers/microsoftGccHigh.js';
export { exampleStubProvider, EXAMPLE_STUB_STACK_ID } from './providers/exampleStub.js';
export { googleWorkspaceCloudProvider, GOOGLE_WORKSPACE_CLOUD_STACK_ID } from './providers/googleWorkspaceCloud.js';

/** The default registry: Microsoft (reference) + the example proof stub + Google Workspace. */
export const defaultStackRegistry = new StackRegistry();
defaultStackRegistry.register(microsoftGccHighProvider);
defaultStackRegistry.register(exampleStubProvider);
defaultStackRegistry.register(googleWorkspaceCloudProvider);

/** Resolve a provider by stack id from the default registry. */
export function getStackProvider(id: StackId): StackProvider {
  return defaultStackRegistry.get(id);
}

/** Resolve the active provider from config (stack id via resolveStackId; default = Microsoft). */
export function getActiveStackProvider(config: { stack?: string } | undefined): StackProvider {
  return getStackProvider(resolveStackId(config));
}
