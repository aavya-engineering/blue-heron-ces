// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as path from 'path';
import { fileURLToPath } from 'node:url';

// When compiled to dist/server/, __dirname is dist/server/.
// Two levels up reaches the project root; then down to tests/fixtures/.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEV_MISSION_PLAN_PATH: string =
  path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'synthetic-mission-plan.json');

export const DEV_MANIFEST_PATH: string =
  path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'synthetic-tenant-manifest.json');

export const DEV_OUTPUT_PATH: string =
  path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'synthetic-mission-plan.executable.json');

// Full-registry fixtures: exercises all 118 registry commands across 14 CMMC families
export const FULL_REGISTRY_MISSION_PLAN_PATH: string =
  path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'full-registry-mission-plan.json');

export const FULL_REGISTRY_MANIFEST_PATH: string =
  path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'full-registry-manifest.json');

export const FULL_REGISTRY_OUTPUT_PATH: string =
  path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'full-registry-mission-plan.executable.json');
