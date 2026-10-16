// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G13 — Slice 1 vitest: Google Workspace Cloud provider registration and validation.
import { describe, it, expect } from 'vitest';
import {
  googleWorkspaceCloudProvider,
  GOOGLE_WORKSPACE_CLOUD_STACK_ID,
} from './googleWorkspaceCloud.js';
import {
  validateStackCapabilities,
  defaultStackRegistry,
  getActiveStackProvider,
  getStackProvider,
} from '../index.js';

describe('googleWorkspaceCloudProvider', () => {
  it('has the correct stack id', () => {
    expect(googleWorkspaceCloudProvider.capabilities.id).toBe('google-workspace-cloud');
    expect(GOOGLE_WORKSPACE_CLOUD_STACK_ID).toBe('google-workspace-cloud');
  });

  it('passes validateStackCapabilities without throwing', () => {
    expect(() => validateStackCapabilities(googleWorkspaceCloudProvider.capabilities)).not.toThrow();
  });

  it('is registered in the defaultStackRegistry', () => {
    expect(defaultStackRegistry.has('google-workspace-cloud')).toBe(true);
  });

  it('getStackProvider returns the Google provider', () => {
    const provider = getStackProvider('google-workspace-cloud');
    expect(provider.capabilities.id).toBe('google-workspace-cloud');
  });

  it('getActiveStackProvider with google stack returns Google provider', () => {
    const provider = getActiveStackProvider({ stack: 'google-workspace-cloud' });
    expect(provider.capabilities.id).toBe('google-workspace-cloud');
  });

  it('all nine capability fields are non-empty strings', () => {
    const c = googleWorkspaceCloudProvider.capabilities;
    expect(c.id.length).toBeGreaterThan(0);
    expect(c.displayName.length).toBeGreaterThan(0);
    expect(c.controlSignalRegistryId.length).toBeGreaterThan(0);
    expect(c.evaluatorSetId.length).toBeGreaterThan(0);
    expect(c.vendorPlaybookId.length).toBeGreaterThan(0);
    expect(c.techStackMapId.length).toBeGreaterThan(0);
    expect(c.sspNarrativeSourceId.length).toBeGreaterThan(0);
    expect(c.cloudEndpoints.graph.length).toBeGreaterThan(0);
    expect(c.cloudEndpoints.login.length).toBeGreaterThan(0);
  });

  it('contains real Google OAuth and Admin SDK endpoints', () => {
    const endpoints = googleWorkspaceCloudProvider.capabilities.cloudEndpoints;
    expect(endpoints.graph).toBe('https://admin.googleapis.com');
    expect(endpoints.login).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(endpoints.exchange).toBe('https://oauth2.googleapis.com/token');
  });

  it('has correct Google conventions', () => {
    const conv = googleWorkspaceCloudProvider.capabilities.conventions;
    expect(conv.cloudEnvironment).toBe('GoogleCommercial');
    expect(conv.identityModel).toBe('GoogleWorkspace');
    expect(conv.defaultLocation).toBe('us-central1');
    expect(conv.infrastructureModels).toContain('GoogleWorkspaceEnterprise');
    expect(conv.infrastructureModels).toContain('GCP');
  });
});
