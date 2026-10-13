// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G4 — Microsoft / Azure GCC High: the REFERENCE stack provider.
//
// This file is the sanctioned home for Microsoft/GCC-High stack literals (endpoints, cloud
// conventions). Stack-agnostic code resolves these via the provider rather than hard-coding them.
// The capability ids point at the EXISTING Microsoft assets so behavior is unchanged.

import { DEFAULT_STACK_ID, type StackProvider } from '../StackProvider.js';

export const microsoftGccHighProvider: StackProvider = {
  capabilities: {
    id: DEFAULT_STACK_ID, // 'microsoft-gcc-high'
    displayName: 'Microsoft 365 / Azure GCC High',
    cloudEndpoints: {
      graph: 'https://graph.microsoft.us',
      login: 'https://login.microsoftonline.us',
      exchange: 'O365USGovGCCHigh',
      arm: 'https://management.usgovcloudapi.net',
      compliance: 'https://ps.compliance.protection.office365.us/powershell-liveid/',
    },
    controlSignalRegistryId: 'cmmc-l2-control-signal-registry',
    evaluatorSetId: 'microsoft-evaluators',
    vendorPlaybookId: 'microsoft-365',
    techStackMapId: 'microsoft-tech-stack',
    sspNarrativeSourceId: 'microsoft-snippet',
    conventions: {
      cloudEnvironment: 'gcc_high',
      defaultLocation: 'usgovvirginia',
      identityModel: 'entra-id',
      infrastructureModels: ['m365_only', 'm365_sentinel', 'm365_azure'],
    },
  },
};
