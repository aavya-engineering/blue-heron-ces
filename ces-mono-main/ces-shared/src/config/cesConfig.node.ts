// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Node-only CES config loader. Imports node:fs/path — do NOT import from FE/browser code.

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  type CesConfig,
  CES_CONFIG_FILENAME,
  CES_CONFIG_PATH_ENV,
  CesConfigError,
  EMPTY_CES_CONFIG,
  validateCesConfig,
} from './cesConfig.contract.js';
import { getCesPipelineRoot } from '../storage/node.js';

/**
 * Resolve the CES config file path: CES_CONFIG_PATH env var if set, else
 * {pipelineRoot}/ces.config.json.
 */
export function getCesConfigPath(): string {
  const fromEnv = process.env[CES_CONFIG_PATH_ENV];
  if (fromEnv && fromEnv.length > 0) return path.resolve(fromEnv);
  return path.join(getCesPipelineRoot(), CES_CONFIG_FILENAME);
}

/**
 * Load + validate the CES config. When the file is absent, returns EMPTY_CES_CONFIG (a system
 * with no bindings yet is valid). A present-but-malformed file throws CesConfigError — we never
 * silently ignore a bad config. Pass an explicit `configPath` to bypass env/default resolution.
 */
export function loadCesConfig(configPath?: string): CesConfig {
  const filePath = configPath ? path.resolve(configPath) : getCesConfigPath();
  if (!fs.existsSync(filePath)) {
    return EMPTY_CES_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    throw new CesConfigError(`failed to parse ${filePath}: ${(err as Error).message}`);
  }
  return validateCesConfig(parsed);
}
