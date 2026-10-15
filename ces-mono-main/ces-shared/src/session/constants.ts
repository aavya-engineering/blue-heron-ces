// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export type SessionType = 'graph' | 'exchange' | 'purview' | 'azure' | 'sharepoint' | 'teams';

export const ENGINE_SESSION_MAP: Record<string, SessionType> = {
  mgraph: 'graph',
  powershell: 'graph',
  exchange: 'exchange',
  ipps: 'purview',
  az: 'azure',
  cli: 'azure',
  spo: 'sharepoint',
  teams: 'teams',
};
