// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G7 — stack-aware tenant cost estimate (Planner consumes the stack-provider seam).
//
// Before G7 the Planner hard-coded the Microsoft/GCC-High cost model. This thin dispatcher routes
// through the shared stack seam (getActiveStackProvider): the Microsoft reference stack uses the
// authored G5 cost model (output IDENTICAL to before); any other registered stack has no authored
// cost model yet ("capability, not content"), so we return an explicit unsupported result instead
// of presenting wrong Microsoft numbers. The seam is FE-safe (pure types, no node:* imports).

import {
  getActiveStackProvider,
  defaultStackRegistry,
  DEFAULT_STACK_ID,
} from '../../../../../ces-shared/src/stack/index';
import type { CostEstimateInput, CostEstimateOutput } from '../types';
import { calculateG5Cost } from './g5CostCalculator';

export interface StackOption {
  id: string;
  displayName: string;
}

export type TenantCostResult =
  | { kind: 'estimate'; stackId: string; output: CostEstimateOutput }
  | { kind: 'unsupported'; stackId: string; displayName: string; message: string };

/** Stacks available to quote, from the shared registry (Microsoft reference + any registered stack). */
export function listStacks(): StackOption[] {
  return defaultStackRegistry.ids().map((id) => ({
    id,
    displayName: defaultStackRegistry.get(id).capabilities.displayName,
  }));
}

/** Infrastructure models (stances) the given stack supports — drives the stance selector. */
export function getStackInfrastructureModels(stackId: string | undefined): string[] {
  return getActiveStackProvider(stackId ? { stack: stackId } : undefined).capabilities.conventions
    .infrastructureModels;
}

/**
 * Stack-aware cost estimate. Microsoft/GCC-High (the default/reference stack) → authored G5 cost
 * model, byte-for-byte the previous behavior. Any other stack → explicit "no cost model authored".
 */
export function calculateTenantCost(input: CostEstimateInput): TenantCostResult {
  const provider = getActiveStackProvider(input.stackId ? { stack: input.stackId } : undefined);
  const stackId = provider.capabilities.id;

  if (stackId === DEFAULT_STACK_ID) {
    return { kind: 'estimate', stackId, output: calculateG5Cost(input) };
  }

  return {
    kind: 'unsupported',
    stackId,
    displayName: provider.capabilities.displayName,
    message:
      `No cost model has been authored for "${provider.capabilities.displayName}" yet. ` +
      `CES is multi-stack capable; pricing content for this stack has not been provided.`,
  };
}
