// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
export const GOOGLE_WORKSPACE_CLOUD_STACK_ID = 'google-workspace-cloud';
export const googleWorkspaceCloudProvider = {
    capabilities: {
        id: GOOGLE_WORKSPACE_CLOUD_STACK_ID,
        displayName: 'Google Workspace / Google Cloud',
        cloudEndpoints: {
            graph: 'https://admin.googleapis.com',
            login: 'https://accounts.google.com/o/oauth2/v2/auth',
            exchange: 'https://oauth2.googleapis.com/token',
        },
        controlSignalRegistryId: 'google-workspace-control-signal-registry',
        evaluatorSetId: 'google-workspace-evaluators',
        vendorPlaybookId: 'google-workspace-playbook',
        techStackMapId: 'google-workspace-techstack',
        sspNarrativeSourceId: 'google-workspace-ssp-narrative',
        conventions: {
            cloudEnvironment: 'GoogleCommercial',
            defaultLocation: 'us-central1',
            identityModel: 'GoogleWorkspace',
            infrastructureModels: ['GoogleWorkspaceEnterprise', 'GCP'],
        },
    },
};
//# sourceMappingURL=googleWorkspaceCloud.js.map