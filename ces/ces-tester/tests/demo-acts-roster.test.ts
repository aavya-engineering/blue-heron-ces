// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the act-group roster.
 *
 * The roster's job is to DECLARE what each group arms, so ARM1 can check the
 * declaration against what `armingFor` actually derives from the group's slides.
 * These tests are the guard on that declaration: a group whose expectation and
 * whose slides disagree is a roster bug that would otherwise surface as a
 * mysterious mid-op timeout against a surface nobody brought up.
 */

import { describe, it, expect } from 'vitest';
import {
  ACT_GROUPS,
  ACT_GROUP_IDS,
  actGroup,
  AO_GUI_PORT,
  EO_PORT,
  STACKSIM_PORT,
  STAMPER_GUI_PORT,
  MUSTER_SPA_PORT,
} from '../src/demo/acts/act-roster.js';
import { armingFor } from '../src/demo/show/op-registry.js';
import { OP_CATALOG, validateParams } from '../src/demo/show/op-catalog.js';
import type { DemoOpId } from '../src/demo/show/deck-model.js';

describe('ACT_GROUPS', () => {
  it('carries exactly the ten act groups, cheap tier first', () => {
    // Pinned so adding a group is a deliberate edit rather than a drift. The
    // order is also the run order, and it is cheap-first on purpose: a broken
    // environment should surface in two minutes, not after a 13-minute execute.
    // GP-DEMO-4: Slice 1B added `ao-make-change` (D.12) after `ao-registry`;
    // Slice 1A added `eo-verify-evidence` (D.15) and Slice 1C added
    // `eo-show-change-captured` (D.16), both before the expensive Config pair.
    expect(ACT_GROUP_IDS).toEqual([
      'muster-readiness',
      'ao-registry',
      'ao-make-change',
      'eo-review',
      'eo-verify-evidence',
      'eo-show-change-captured',
      'simstack-create',
      'simstack-destroy',
      'muster-gui',
      'stamper',
    ]);
  });

  it('groups the ordering-dependent pairs into ONE lifecycle', () => {
    // eo-review warm hydrates the page live then walks; translate leaves the
    // backstage #outputPath execute needs. Split either and the harness measures
    // a degradation path instead of the act.
    expect(actGroup('eo-review')!.slides.map((s) => s.mode)).toEqual(['warm', 'live']);
    expect(actGroup('stamper')!.slides.map((s) => s.opId)).toEqual([
      'stamper-translate',
      'stamper-execute',
    ]);
  });

  it('keeps the Config pair off the visible pane by running both halves warm', () => {
    // Both ops touch ctx.pane ONLY on `live`, so warm is what makes ST1's
    // "zero visible-pane navigations" assertion meaningful rather than lucky.
    expect(actGroup('stamper')!.slides.every((s) => s.mode === 'warm')).toBe(true);
  });

  it('declares arming that matches what armingFor derives from its own op ids', () => {
    for (const group of ACT_GROUPS) {
      const derived = armingFor(new Set<DemoOpId>(group.opIds));
      expect(
        { id: group.id, ...derived },
        `${group.id}: declared arming disagrees with armingFor`,
      ).toEqual({ id: group.id, ...group.expectedArming });
    }
  });

  it('declares the ports its arming actually brings up — 4390 always', () => {
    for (const group of ACT_GROUPS) {
      const expected = [STACKSIM_PORT];
      if (group.expectedArming.withAoGui) expected.push(AO_GUI_PORT);
      if (group.expectedArming.withEo) expected.push(EO_PORT);
      if (group.expectedArming.withStamperGui) expected.push(STAMPER_GUI_PORT);
      if (group.expectedArming.withMuster) expected.push(MUSTER_SPA_PORT);
      expect([...group.expectedPorts].sort(), group.id).toEqual(expected.sort());
    }
  });

  it('drives only op ids it declares, in modes that are never staged', () => {
    for (const group of ACT_GROUPS) {
      expect(group.slides.length, group.id).toBeGreaterThan(0);
      for (const slide of group.slides) {
        expect(group.opIds, `${group.id}: slide op not declared`).toContain(slide.opId);
        // A staged slide never reaches an implementation, so it could not test one.
        expect(slide.mode, group.id).not.toBe('staged');
        expect(OP_CATALOG[slide.opId].modes, `${group.id}/${slide.opId}`).toContain(slide.mode);
      }
      // Every declared op id is actually exercised.
      for (const opId of group.opIds) {
        expect(group.slides.some((s) => s.opId === opId), `${group.id}: ${opId} unused`).toBe(true);
      }
    }
  });

  it('uses only params the catalog validates', () => {
    for (const group of ACT_GROUPS) {
      for (const slide of group.slides) {
        const { errors } = validateParams(slide.opId, slide.params ?? {});
        expect(errors, `${group.id}/${slide.opId}`).toEqual([]);
      }
    }
  });

  it('names a non-empty, unique check set including ARM1 and TD1', () => {
    for (const group of ACT_GROUPS) {
      expect(new Set(group.checkIds).size, group.id).toBe(group.checkIds.length);
      expect(group.checkIds, group.id).toContain('ARM1');
      expect(group.checkIds, group.id).toContain('TD1');
      expect(group.dossierEntries.length, group.id).toBeGreaterThan(0);
    }
  });

  it('looks a group up by id and returns undefined for one it does not carry', () => {
    expect(actGroup('ao-registry')?.opIds).toEqual(['ao-registry']);
    expect(actGroup('simstack')).toBeUndefined();
  });
});
