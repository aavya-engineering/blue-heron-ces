// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30 (types only, tests only): ces-ao/node_modules carries its own vitest (4.1.9), which is the
// one this package's files resolve, while @testing-library/jest-dom/vitest augments the root copy
// (4.1.7). Augment the copy these tests actually use so tsc sees the jest-dom matchers.

import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
