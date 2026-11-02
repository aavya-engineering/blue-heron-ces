// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // W5c7 test hygiene: a per-run temporary pipeline root (never %LOCALAPPDATA%\CES\pipeline), set before
  // any test module is imported, removed after the run; every test checks it (tests/setup/*.cjs).
  globalSetup: '<rootDir>/tests/setup/globalSetup.cjs',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.cjs',
  setupFiles: ['<rootDir>/tests/setup/env.cjs'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/guard.cjs'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        isolatedModules: true,
      },
    }],
  },
  moduleNameMapper: {
    // FIN-42: the ces-shared/secrets subpath from source (as ces-eo maps its ces-shared subpaths), so
    // tests resolve it before and after the ces-shared dist carries ./secrets.
    '^ces-shared/secrets$': '<rootDir>/../ces-shared/src/secrets/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
