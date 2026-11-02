// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-35 (finishing plan PH-3 harness): schema and loader for the AO, EO and Muster `ui-e2e` scenarios
 * (scenarios/ui/<slug>-<surface>-ui-e2e.json, surface ao | eo | muster). The Stamper surface keeps its own loader
 * (src/scenarios/uiE2eFile.ts, outside this slice's row); `runUiE2eCli` (ui-e2e-run.ts) peeks the raw `surface` and
 * sends these three here. Same `type` ("ui-e2e") so the CLI's `isUiE2eFile` dispatch is unchanged.
 *
 * Steps (drive order, all run; EU-AO / EU-EO / EU-MU in FINISH-PLAN.md §3.4 FIN-35):
 * - ao:     open, tenant, ops (each of the twin's E7A ops: dry run, then apply), evidence
 * - eo:     connect, assess, ssp, docx, upload, review, assessor
 * - muster: signin, begin, discovery, interview, boundary, compile, push
 * Variants: `legacy` (the module's current page at `/`) and `kit` (the kit console at `/app/`, FIN-30..32), each with
 * an optional `requires_built` file (relative to the module root) that must exist for it to run.
 */
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import type { TenantStance } from '../stacksim-client/types.js';

const _require = createRequire(import.meta.url);

export const UI_CONSOLE_TYPE = 'ui-e2e';
export type UiConsoleSurface = 'ao' | 'eo' | 'muster';
export const UI_CONSOLE_SURFACES: readonly UiConsoleSurface[] = ['ao', 'eo', 'muster'];

export const UI_CONSOLE_STEPS = {
  ao: ['open', 'tenant', 'ops', 'evidence'],
  eo: ['connect', 'assess', 'ssp', 'docx', 'upload', 'review', 'assessor'],
  muster: ['signin', 'begin', 'discovery', 'interview', 'boundary', 'compile', 'push'],
} as const satisfies Record<UiConsoleSurface, readonly string[]>;

/** The harness step id per surface (steps.json / mx-e2e.ps1 Record). */
export const UI_CONSOLE_STEP_ID: Record<UiConsoleSurface, string> = { ao: 'EU-AO', eo: 'EU-EO', muster: 'EU-MU' };

export type UiConsoleVariantId = 'legacy' | 'kit';

export interface UiConsoleVariant {
  id: UiConsoleVariantId;
  base_path: string;
  /** Path under the module root (ces-ao, ces-eo, ces-muster) that must exist; absent = always runs. */
  requires_built?: string;
}

/** Where the headed window sits on the operator's desktop (one window per console). */
export interface UiConsoleWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UiConsoleScenario {
  type: typeof UI_CONSOLE_TYPE;
  scenario_id: string;
  description?: string;
  surface: UiConsoleSurface;
  sim_scenario: string;
  stance: TenantStance;
  /** The headless twin's scenario id (scenarios/muster/<twin>.json); its outputs are read from <WS>/out. */
  twin: string;
  variants: UiConsoleVariant[];
  steps: string[];
  window?: UiConsoleWindow;
}

export const UI_CONSOLE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'ces-tester/ui-e2e-console.schema.json',
  title: 'ces-tester ui-e2e console scenario (FIN-35: AO, EO, Muster)',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'scenario_id', 'surface', 'sim_scenario', 'stance', 'twin', 'variants', 'steps'],
  properties: {
    type: { const: UI_CONSOLE_TYPE },
    scenario_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
    description: { type: 'string' },
    surface: { enum: [...UI_CONSOLE_SURFACES] },
    sim_scenario: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' },
    stance: { enum: ['m365_only', 'm365_sentinel', 'm365_azure'] },
    twin: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
    variants: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'base_path'],
        properties: {
          id: { enum: ['legacy', 'kit'] },
          base_path: { type: 'string', pattern: '^/([A-Za-z0-9_-]+/)*$' },
          requires_built: { type: 'string', minLength: 1 },
        },
      },
    },
    steps: { type: 'array', minItems: 1, items: { type: 'string' } },
    window: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: { type: 'integer', minimum: 0 },
        y: { type: 'integer', minimum: 0 },
        width: { type: 'integer', minimum: 640 },
        height: { type: 'integer', minimum: 480 },
      },
    },
  },
} as const;

let compiled: ValidateFunction | undefined;
function validator(): ValidateFunction {
  if (!compiled) {
    const ajvModule = _require('ajv') as { default?: unknown } & Record<string, unknown>;
    const AjvCtor = (ajvModule.default ?? ajvModule) as new (opts: { strict: boolean }) => { compile: (schema: unknown) => ValidateFunction };
    compiled = new AjvCtor({ strict: true }).compile(UI_CONSOLE_SCHEMA);
  }
  return compiled;
}

/** The raw `surface` of a parsed ui-e2e file, when it is one of the three console surfaces; else null. Pure. */
export function consoleSurfaceOf(parsed: unknown): UiConsoleSurface | null {
  const s = (parsed as { surface?: unknown } | null)?.surface;
  return typeof s === 'string' && (UI_CONSOLE_SURFACES as readonly string[]).includes(s) ? (s as UiConsoleSurface) : null;
}

/** Schema, then: unique variant ids; steps exactly the surface's steps in drive order. */
export function validateUiConsole(parsed: unknown, label = 'ui-e2e console scenario'): UiConsoleScenario {
  const validate = validator();
  if (!validate(parsed)) throw new Error(`${label}: fails ui-e2e console schema: ${JSON.stringify(validate.errors?.[0] ?? validate.errors)}`);
  const sc = parsed as UiConsoleScenario;
  const ids = sc.variants.map((v) => v.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${label}: duplicate variant id in [${ids.join(', ')}]`);
  const want = UI_CONSOLE_STEPS[sc.surface];
  if (sc.steps.join(',') !== want.join(',')) throw new Error(`${label}: steps must be [${want.join(', ')}] in that order (got [${sc.steps.join(', ')}])`);
  return sc;
}

export async function loadUiConsoleFile(filePath: string): Promise<UiConsoleScenario> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`${filePath}: not valid JSON (${e instanceof Error ? e.message : e})`);
  }
  return validateUiConsole(parsed, filePath);
}
