// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G13 — Slice 7: Google Workspace stack planner cost tests.
import { describe, it, expect } from 'vitest';
import { calculateTenantCost, listStacks, getStackInfrastructureModels } from './tenantCost';
import type { CostEstimateInput } from '../types';
import {
  GOOGLE_WORKSPACE_CLOUD_STACK_ID,
  googleWorkspaceCloudProvider,
} from '../../../../../ces-shared/src/stack/index';

const base: CostEstimateInput = { stance: 'm365_sentinel', user_count: 50, workload: 'light' };

describe('tenantCost — Google Workspace stack (G13)', () => {
  it('calculateTenantCost with google-workspace-cloud returns kind: unsupported', () => {
    const result = calculateTenantCost({ ...base, stackId: GOOGLE_WORKSPACE_CLOUD_STACK_ID });
    expect(result.kind).toBe('unsupported');
  });

  it('unsupported result has non-empty message', () => {
    const result = calculateTenantCost({ ...base, stackId: GOOGLE_WORKSPACE_CLOUD_STACK_ID });
    if (result.kind !== 'unsupported') throw new Error('Expected unsupported');
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('unsupported result has correct stackId', () => {
    const result = calculateTenantCost({ ...base, stackId: GOOGLE_WORKSPACE_CLOUD_STACK_ID });
    if (result.kind !== 'unsupported') throw new Error('Expected unsupported');
    expect(result.stackId).toBe(GOOGLE_WORKSPACE_CLOUD_STACK_ID);
  });

  it('unsupported result displayName matches provider displayName', () => {
    const result = calculateTenantCost({ ...base, stackId: GOOGLE_WORKSPACE_CLOUD_STACK_ID });
    if (result.kind !== 'unsupported') throw new Error('Expected unsupported');
    expect(result.displayName).toBe(googleWorkspaceCloudProvider.capabilities.displayName);
  });

  it('listStacks() includes the Google provider display name', () => {
    const stacks = listStacks();
    const googleStack = stacks.find((s) => s.id === GOOGLE_WORKSPACE_CLOUD_STACK_ID);
    expect(googleStack).toBeDefined();
    expect(googleStack!.displayName).toBe(googleWorkspaceCloudProvider.capabilities.displayName);
  });

  it('getStackInfrastructureModels returns Google models for google stack', () => {
    const models = getStackInfrastructureModels(GOOGLE_WORKSPACE_CLOUD_STACK_ID);
    expect(models).toContain('GoogleWorkspaceEnterprise');
    expect(models).toContain('GCP');
  });
});
