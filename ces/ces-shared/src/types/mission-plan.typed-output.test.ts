// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-SH2 (REQ-ces-shared-mission-plan-typed-output, filed by ces-stamper):
// ManualMissionPlanSchema's parse output is typed, so consumers need no cast.
//
// This file is a TYPE-LEVEL test. vitest runs the runtime half; the last test
// compiles this very file with `tsc -p tsconfig.typetest.json`, so every
// expectTypeOf / @ts-expect-error below is enforced by the compiler (the main
// tsconfig excludes *.test.ts).

import { describe, it, expect, expectTypeOf } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { z } from 'zod';
import {
  ManualMissionPlanSchema,
  CesPlanMetaSchema,
  OutputsBlockSchema,
  CheckSchema,
  NormativeControlSchema,
  type ManualMissionPlanParsed,
  type ManualMissionPlanInput,
  type ManualMissionPlan,
  type CesPlanMeta,
  type OutputsBlock,
  type ManualStep,
  type TenantManifestBody,
  type HumanReadableMissionPlan,
} from './mission-plan.contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

type Parsed = z.infer<typeof ManualMissionPlanSchema>;

function loadStamperPlan(): unknown {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'stamper-mission-plan.json'), 'utf-8'));
}

describe('FX-SH2 typed ManualMissionPlanSchema output', () => {
  it('z.infer exposes the shared envelope and body types (type-level)', () => {
    expectTypeOf<Parsed>().toEqualTypeOf<ManualMissionPlanParsed>();
    expectTypeOf<Parsed['ces']>().toEqualTypeOf<CesPlanMeta>();
    expectTypeOf<Parsed['ces']['cesId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Parsed['ces']['artifact']>().toEqualTypeOf<'manual_mission_plan'>();
    expectTypeOf<Parsed['outputs']>().toEqualTypeOf<OutputsBlock>();
    expectTypeOf<Parsed['outputs']['human_readable_mission_plan']>().toEqualTypeOf<HumanReadableMissionPlan>();
    expectTypeOf<Parsed['outputs']['human_readable_mission_plan']['steps']>()
      .toEqualTypeOf<ManualStep[] | undefined>();
    expectTypeOf<Parsed['outputs']['tenant_manifest']>().toEqualTypeOf<TenantManifestBody | undefined>();
    expectTypeOf<ManualMissionPlan>().toEqualTypeOf<ManualMissionPlanInput>();
    expectTypeOf<z.infer<typeof CesPlanMetaSchema>>().toEqualTypeOf<CesPlanMeta>();
    expectTypeOf<z.infer<typeof OutputsBlockSchema>>().toEqualTypeOf<OutputsBlock>();
  });

  it('parse result is usable without a cast', () => {
    const parsed = ManualMissionPlanSchema.parse(loadStamperPlan());
    // No cast: these property accesses only compile because the output is typed.
    const cesId: string | undefined = parsed.ces.cesId;
    const steps: ManualStep[] | undefined = parsed.outputs.human_readable_mission_plan.steps;
    const tm: TenantManifestBody | undefined = parsed.outputs.tenant_manifest;
    // @ts-expect-error — cesId is string | undefined, not number (proves the output is not any/unknown)
    const bad: number = parsed.ces.cesId;
    void bad; void tm;
    expect(parsed.ces.artifact).toBe('manual_mission_plan');
    expect(typeof cesId === 'string' || cesId === undefined).toBe(true);
    expect(Array.isArray(steps)).toBe(true);
    expect(steps!.length).toBeGreaterThan(0);
    expect(typeof steps![0].id).toBe('string');
  });

  it('body sub-schemas are reachable through the mission-plan contract module', () => {
    expect(typeof CheckSchema.safeParse).toBe('function');
    expect(typeof NormativeControlSchema.safeParse).toBe('function');
  });

  it('the type-level assertions in this file compile (tsc -p tsconfig.typetest.json)', () => {
    const require = createRequire(import.meta.url);
    const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
    let out = '';
    try {
      execFileSync(process.execPath, [tsc, '-p', path.join(ROOT, 'tsconfig.typetest.json')], {
        cwd: ROOT, encoding: 'utf-8', stdio: 'pipe',
      });
    } catch (e: any) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(out, out).toBe('');
  }, 120_000);
});
