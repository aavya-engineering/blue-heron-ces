// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// PH-12 (LOG-PH12-INT.md item 4): a Met-By-Prohibition scope exclusion's normative control (its per-objective
// postcheck rows) has no plan step by design; the server-side push gate does not block it, and still blocks
// any other normative control no step covers.
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runPushGate } from '../src/services/planPushAudit.js';
import { validateArtifactAlignment } from '../src/services/artifactAlignmentValidator.js';
import { validateArtifactAlignment as spaValidate } from '@/features/plan/engine/mpt/services/validator';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));

const NC = {
  control_id: 'MP.L2-3.8.5',
  required_state: 'MP.L2-3.8.5 — met by prohibition: Removable media prohibited by policy',
  verification: [{ id: 'chk_x', description: 'x', method: 'config_export', expected: 'x', on_fail: 'x' }],
  evidence_artifacts: [],
};
const exclusion = (kind: string) => ({ requirement_id: 'MP.L2-3.8.5', justification: 'Removable media prohibited by policy', si_field: 'removable_media_posture', si_value: 'blocked', kind });

function pair(kind: string | null) {
  const m = JSON.parse(JSON.stringify(mp));
  const t = JSON.parse(JSON.stringify(tm));
  const hp = m.outputs.human_readable_mission_plan;
  hp.steps = hp.steps.filter((s: { control_coverage?: Array<{ control_id: string }> }) => !(s.control_coverage ?? []).some((c) => c.control_id === 'MP.L2-3.8.5'));
  hp.scope_exclusions = [...(hp.scope_exclusions ?? []).filter((e: { requirement_id: string }) => e.requirement_id !== 'MP.L2-3.8.5'), ...(kind ? [exclusion(kind)] : [])];
  t.tenant_manifest.normative_controls = [...t.tenant_manifest.normative_controls.filter((n: { control_id: string }) => n.control_id !== 'MP.L2-3.8.5'), NC];
  return { m, t };
}
const mismatch = /^MP_TM_CONTROL_MISMATCH: Tenant manifest normative control "MP\.L2-3\.8\.5" not present in manual plan control coverage$/;

describe('PH-12 push gate and Met-By-Prohibition normative controls', () => {
  test('the baseline fixture pair still passes clean', () => {
    expect(runPushGate(mp, tm)).toEqual({ blocking: [], warnings: [] });
  });

  test('a prohibition scope exclusion with its normative control is not blocked', () => {
    const { m, t } = pair('prohibition');
    expect(runPushGate(m, t).blocking.filter((b) => mismatch.test(b))).toEqual([]);
  });

  test('without the exclusion, or with a capability-absent one, the mismatch still blocks', () => {
    for (const kind of [null, 'capability-absent']) {
      const { m, t } = pair(kind);
      expect(runPushGate(m, t).blocking.filter((b) => mismatch.test(b))).toHaveLength(1);
    }
  });

  test('the muster-api copy and the SPA copy agree on check 4', () => {
    for (const kind of [null, 'prohibition', 'capability-absent']) {
      const { m, t } = pair(kind);
      expect(validateArtifactAlignment(m, t).warnings).toEqual(spaValidate(m, t).warnings);
    }
  });
});
