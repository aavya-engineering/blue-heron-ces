// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Concrete engine/CLI-alias map -- verbatim from
 * `ces-shared/src/session/constants.ts:3-12` (`ENGINE_SESSION_MAP`). M0
 * declared only the `EngineSessionMap` type shape; M1 supplies the concrete
 * constant so consumers of this package do not re-declare it.
 */

import type { EngineSessionMap } from '../connection.js';

export const ENGINE_SESSION_MAP: EngineSessionMap = {
  mgraph: 'graph',
  powershell: 'graph',
  exchange: 'exchange',
  ipps: 'purview',
  az: 'azure',
  cli: 'azure',
  spo: 'sharepoint',
  teams: 'teams',
};
