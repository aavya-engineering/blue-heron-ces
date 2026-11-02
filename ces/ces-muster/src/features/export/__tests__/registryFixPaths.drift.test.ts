// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W5c3: the fix-path extract (which also decides the manual -> implement
// promotion, plan/derive/directivePromotion.ts) must match Stamper's registry:
// every entry with a non-empty set_command, on each of its control_ids, plus
// (W5c4) every `verify_only` entry: it runs and asserts the state another
// entry in the plan creates, so it configures its control. Read-only over the
// sibling ces-stamper checkout; skipped where it is not present.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGISTRY_FIX_PATHS } from '../registryFixPaths';
import { RENDERABLE_STATE_ENTRIES, STAMPER_RENDERABLE_CONTROLS } from '@/features/plan/derive/directivePromotion';

const REGISTRY = resolve(__dirname, '../../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');

describe.skipIf(!existsSync(REGISTRY))('registryFixPaths vs the Stamper registry', () => {
  it('lists every set-command or verify-only entry on each of its controls, and nothing else', () => {
    const entries = (JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
      entries: Array<{ entry_id: string; control_ids: string[]; set_command?: string; verify_only?: boolean }>;
    }).entries;
    const expected: Record<string, string[]> = {};
    for (const e of entries) {
      if (!(e.set_command ?? '').trim() && e.verify_only !== true) continue;
      for (const c of e.control_ids) (expected[c] ??= []).push(`tenant:${e.entry_id}`);
    }
    const norm = (m: Record<string, string[]>): Record<string, string[]> =>
      Object.fromEntries(
        Object.keys(m)
          .sort()
          .map((k): [string, string[]] => [k, [...new Set(m[k])].sort()])
      );
    expect(norm(REGISTRY_FIX_PATHS)).toEqual(norm(expected));
  });

  it('W5c5: RENDERABLE_STATE_ENTRIES = the state-verified configuring entries on a Stamper-renderable control', () => {
    const entries = (JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
      entries: Array<{ entry_id: string; control_ids: string[]; set_command?: string; verify_only?: boolean; verification?: { postcheck_mode?: string } }>;
    }).entries;
    // PH-13: ONE reviewed exception (control + entry), never a general loosening. Any other
    // state-verified configuring entry on a renderable control must still be listed.
    const REVIEWED_EXCEPTIONS: Array<{ control: string; entry: string; reason: string }> = [
      {
        control: 'RA.L2-3.11.2',
        entry: 'SI.L1-3.14.1.mde-onboarding',
        reason:
          "RA.L2-3.11.2 keeps its rendered document: its document objectives (scan frequency, remediation timelines) need the policy text; mde-onboarding's state is supplementary evidence (PH-13 orchestrator decision, LOG-PH13-UNIT.md)",
      },
    ];
    const excepted = (c: string, id: string) => REVIEWED_EXCEPTIONS.some((x) => x.control === c && x.entry === id);
    const stateConfiguring = entries.filter(
      (e) => ((e.set_command ?? '').trim() || e.verify_only === true) && e.verification?.postcheck_mode === 'state'
    );
    const expected = stateConfiguring
      .filter((e) => e.control_ids.some((c) => STAMPER_RENDERABLE_CONTROLS.has(c) && !excepted(c, e.entry_id)))
      .map((e) => e.entry_id)
      .sort();
    expect([...RENDERABLE_STATE_ENTRIES].sort()).toEqual(expected);
    // The exception stays live and exact: the pair still exists as a state-verified configuring entry
    // on a renderable control, and the excepted entry is not in the promoting set.
    for (const x of REVIEWED_EXCEPTIONS) {
      expect(STAMPER_RENDERABLE_CONTROLS.has(x.control), x.control).toBe(true);
      expect(stateConfiguring.find((e) => e.entry_id === x.entry)?.control_ids, x.entry).toContain(x.control);
      expect(RENDERABLE_STATE_ENTRIES.has(x.entry), x.entry).toBe(false);
      expect(x.reason.length).toBeGreaterThan(0);
    }
  });

  it('W5c6: SC.L2-3.13.10 is configured by the key-vault entry only; no infrastructure entry is in the (tenant) extract', () => {
    expect(REGISTRY_FIX_PATHS['SC.L2-3.13.10']).toEqual(['tenant:SC.L2-3.13.10.key-vault']);
    const infra = resolve(REGISTRY, '..', 'infra-cmmc-l2-commands.registry.json');
    if (!existsSync(infra)) return;
    const ids = new Set((JSON.parse(readFileSync(infra, 'utf8')) as { entries: Array<{ entry_id: string }> }).entries.map((e) => e.entry_id));
    const listed = Object.values(REGISTRY_FIX_PATHS).flat().map((e) => e.replace(/^tenant:/, ''));
    expect(listed.filter((e) => ids.has(e))).toEqual([]);
  });

  it('W5c4: the verify-only RA.L2-3.11.3 entry stays a configuring path', () => {
    const entries = (JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
      entries: Array<{ entry_id: string; set_command?: string; verify_only?: boolean }>;
    }).entries;
    const ra = entries.find((e) => e.entry_id === 'RA.L2-3.11.3.vuln-remediation');
    expect(ra?.verify_only).toBe(true);
    expect((ra?.set_command ?? '').trim()).toBe('');
    // PH-12 (LOG-PH12-INT.md item 3, R5 C): Defender onboarding also lists RA.L2-3.11.3 (a SET entry).
    expect(REGISTRY_FIX_PATHS['RA.L2-3.11.3']).toEqual(['tenant:RA.L2-3.11.3.vuln-remediation', 'tenant:SI.L1-3.14.1.mde-onboarding']);
  });
});
