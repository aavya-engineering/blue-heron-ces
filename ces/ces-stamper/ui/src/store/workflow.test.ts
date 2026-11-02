// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { beforeEach, describe, expect, it } from 'vitest';
import { STEP_IDS, initialStepStates, isUnlocked, toRailSteps, useWorkflowStore } from './index';

const store = () => useWorkflowStore.getState();

beforeEach(() => {
  store().reset();
});

describe('workflow store (rail lock/unlock, legacy setRailState rules)', () => {
  it('starts as the legacy markup: steps 1-3 ready, 4-6 locked, no tenant', () => {
    expect(store().tenant).toBeNull();
    expect(STEP_IDS.map((id) => store().steps[id])).toEqual(['ready', 'ready', 'ready', 'locked', 'locked', 'locked']);
    expect(initialStepStates()).toEqual(store().steps);
  });

  it('selecting a tenant opens tenant, configure and evidence (evidence is always open)', () => {
    store().selectTenant('s1-mach');
    expect(store().tenant).toBe('s1-mach');
    expect(store().steps.evidence).toBe('ready');
    expect(store().steps.translate).toBe('locked');
    expect(store().steps.execute).toBe('locked');
  });

  it('assess done unlocks translate; translate done unlocks execute; execute done unlocks evidence', () => {
    store().startStep('assess');
    expect(store().steps.assess).toBe('running');
    expect(isUnlocked(store().steps, 'translate')).toBe(false);
    store().completeStep('assess');
    expect(store().steps.assess).toBe('done');
    expect(store().steps.translate).toBe('ready');
    expect(store().steps.execute).toBe('locked');
    store().completeStep('translate');
    expect(store().steps.execute).toBe('ready');
    expect(store().steps.evidence).toBe('locked');
    store().completeStep('execute');
    expect(store().steps.evidence).toBe('ready');
  });

  it('tenant done readies configure', () => {
    store().setStepState('configure', 'locked');
    store().completeStep('tenant');
    expect(store().steps.tenant).toBe('done');
    expect(store().steps.configure).toBe('ready');
  });

  it('a failed step unlocks nothing; completing never relocks or overrides a later step', () => {
    store().failStep('assess');
    expect(store().steps.assess).toBe('failed');
    expect(store().steps.translate).toBe('locked');
    store().setStepState('translate', 'done');
    store().completeStep('assess');
    expect(store().steps.translate).toBe('done');
  });

  it('reset restores the initial state', () => {
    store().selectTenant('s2-eng');
    store().completeStep('assess');
    store().reset();
    expect(store().tenant).toBeNull();
    expect(store().steps).toEqual(initialStepStates());
  });

  it('toRailSteps gives the kit rail model in rail order', () => {
    store().completeStep('assess');
    const rail = toRailSteps(store().steps);
    expect(rail.map((s) => s.id)).toEqual([...STEP_IDS]);
    expect(rail[2].state).toBe('done');
    expect(rail[3].state).toBe('ready');
  });
});
