// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Test-resolution shim (NOT a mock of behaviour): re-exports the real ces-shared
// AdminOps evidence contract source so ts-jest (CommonJS) can load it; the package's
// dist is ESM-only. Remove once package.json jest.moduleNameMapper maps
// ^ces-shared/types/adminops-evidence$ (docs/requirements/REQ-ces-eo-jest-shared-contract-mapper.md).
export * from '../../../../../ces-shared/src/types/adminops-evidence.contract';
