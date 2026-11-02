// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Workflow rail state: the six steps and their lock/unlock rules, as the legacy console's
// setRailState() calls apply them (ces-stamper/public/index.html):
//   page load: tenant, configure, assess ready; translate, execute, evidence locked
//   tenant selected (L6201-6215): tenant, configure, evidence ready (evidence is always open)
//   tenant done (L6230-6232): configure ready
//   assess done (L7604-7609): translate ready
//   translate done (L7705-7710): execute ready
//   execute done (L9226-9252): evidence ready

import { create } from 'zustand';
import { STAMPER_STEPS } from 'ces-ui-kit';
import type { RailStep, StepState } from 'ces-ui-kit';

export type StepId = 'tenant' | 'configure' | 'assess' | 'translate' | 'execute' | 'evidence';

export const STEP_IDS: readonly StepId[] = ['tenant', 'configure', 'assess', 'translate', 'execute', 'evidence'];

/** The step a completed step unlocks (only if that step is still locked). */
export const UNLOCKS: Readonly<Partial<Record<StepId, StepId>>> = {
  tenant: 'configure',
  assess: 'translate',
  translate: 'execute',
  execute: 'evidence',
};

export type StepStates = Readonly<Record<StepId, StepState>>;

export function initialStepStates(): StepStates {
  const states = {} as Record<StepId, StepState>;
  for (const step of STAMPER_STEPS) states[step.id as StepId] = step.state;
  return states;
}

export interface WorkflowState {
  tenant: string | null;
  steps: StepStates;
  /** Raw state write, the legacy setRailState(step, state). */
  setStepState: (id: StepId, state: StepState) => void;
  startStep: (id: StepId) => void;
  failStep: (id: StepId) => void;
  /** Marks the step done and unlocks its successor (UNLOCKS). */
  completeStep: (id: StepId) => void;
  selectTenant: (slug: string) => void;
  reset: () => void;
}

export const useWorkflowStore = create<WorkflowState>()((set) => ({
  tenant: null,
  steps: initialStepStates(),
  setStepState: (id, state) => set((s) => ({ steps: { ...s.steps, [id]: state } })),
  startStep: (id) => set((s) => ({ steps: { ...s.steps, [id]: 'running' } })),
  failStep: (id) => set((s) => ({ steps: { ...s.steps, [id]: 'failed' } })),
  completeStep: (id) =>
    set((s) => {
      const steps: Record<StepId, StepState> = { ...s.steps, [id]: 'done' };
      const next = UNLOCKS[id];
      if (next && steps[next] === 'locked') steps[next] = 'ready';
      return { steps };
    }),
  selectTenant: (slug) =>
    set((s) => ({
      tenant: slug,
      steps: { ...s.steps, tenant: 'ready', configure: 'ready', evidence: 'ready' },
    })),
  reset: () => set({ tenant: null, steps: initialStepStates() }),
}));

export function isUnlocked(steps: StepStates, id: StepId): boolean {
  return steps[id] !== 'locked';
}

/** Rail model for the kit's StepRail, in rail order (node ids railNode0-5). */
export function toRailSteps(steps: StepStates): RailStep[] {
  return STAMPER_STEPS.map((step) => ({ ...step, state: steps[step.id as StepId] }));
}
