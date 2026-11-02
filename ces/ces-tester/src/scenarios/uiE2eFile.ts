// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// uiE2eFile.ts - W8-UIT1 (UI-TRACK.md §5): schema and loader for the `ui-e2e` scenario type
// (scenarios/ui/<slug>-<surface>-ui-e2e.json). A UI use case driven through a real console with Playwright,
// whose outcome must equal its headless twin (the same sim scenario through mx-e2e.ps1). Kept apart from
// scenarioFile.ts (frozen schema) and musterE2eFile.ts; run-scenario dispatches on `type`. The schema lives
// here as an object so the CLI build (dist/) needs no copied JSON file.
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import type { TenantStance } from '../stacksim-client/types.js';

const _require = createRequire(import.meta.url);

export const UI_E2E_TYPE = 'ui-e2e';

/** The Stamper use case's steps, in drive order. */
export const UI_E2E_STAMPER_STEPS = ['tenant', 'translate', 'approve', 'execute', 'ledger', 'evidence'] as const;
export type UiE2eStep = (typeof UI_E2E_STAMPER_STEPS)[number];

export type UiE2eVariantId = 'legacy' | 'spa';

export interface UiE2eVariant {
  id: UiE2eVariantId;
  /** Where the console is served on the Stamper GUI server: `/` (legacy) or `/app/` (SPA). */
  base_path: string;
  /** Path under the Stamper root that must exist for the variant to run (the SPA build); absent = always runs. */
  requires_built?: string;
}

export interface UiE2eScenario {
  type: typeof UI_E2E_TYPE;
  scenario_id: string;
  description?: string;
  surface: 'stamper';
  sim_scenario: string;
  stance: TenantStance;
  /** The headless twin's scenario id (scenarios/muster/<twin>.json); its outputs are read from <WS>/out. */
  twin: string;
  variants: UiE2eVariant[];
  steps: UiE2eStep[];
  /** Execute mode in the console: incremental = the legacy console's "Incremental" (per-task approval). */
  execute_mode: 'incremental' | 'auto';
}

export const UI_E2E_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'ces-tester/ui-e2e.schema.json',
  title: 'ces-tester ui-e2e scenario (W8-UIT1)',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'scenario_id', 'surface', 'sim_scenario', 'stance', 'twin', 'variants', 'steps', 'execute_mode'],
  properties: {
    type: { const: UI_E2E_TYPE },
    scenario_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
    description: { type: 'string' },
    surface: { enum: ['stamper'] },
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
          id: { enum: ['legacy', 'spa'] },
          base_path: { type: 'string', pattern: '^/([A-Za-z0-9_-]+/)*$' },
          requires_built: { type: 'string', minLength: 1 },
        },
      },
    },
    steps: { type: 'array', minItems: 1, items: { enum: [...UI_E2E_STAMPER_STEPS] } },
    execute_mode: { enum: ['incremental', 'auto'] },
  },
} as const;

let compiled: ValidateFunction | undefined;
function validator(): ValidateFunction {
  if (!compiled) {
    const ajvModule = _require('ajv') as { default?: unknown } & Record<string, unknown>;
    const AjvCtor = (ajvModule.default ?? ajvModule) as new (opts: { strict: boolean }) => {
      compile: (schema: unknown) => ValidateFunction;
    };
    compiled = new AjvCtor({ strict: true }).compile(UI_E2E_SCHEMA);
  }
  return compiled;
}

/** True when the file parses and declares `"type": "ui-e2e"`. A file that does not parse returns false. */
export async function isUiE2eFile(filePath: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as { type?: unknown };
    return raw?.type === UI_E2E_TYPE;
  } catch {
    return false;
  }
}

/**
 * Validate against the schema, then the two rules the schema cannot say: variant ids are unique, and the
 * steps are exactly the Stamper use case's steps in drive order (the driver runs them all, in that order).
 */
export function validateUiE2e(parsed: unknown, label = 'ui-e2e scenario'): UiE2eScenario {
  const validate = validator();
  if (!validate(parsed)) {
    throw new Error(`${label}: fails ui-e2e schema: ${JSON.stringify(validate.errors?.[0] ?? validate.errors)}`);
  }
  const sc = parsed as UiE2eScenario;
  const ids = sc.variants.map((v) => v.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${label}: duplicate variant id in [${ids.join(', ')}]`);
  if (sc.steps.join(',') !== UI_E2E_STAMPER_STEPS.join(',')) {
    throw new Error(`${label}: steps must be [${UI_E2E_STAMPER_STEPS.join(', ')}] in that order (got [${sc.steps.join(', ')}])`);
  }
  return sc;
}

export async function loadUiE2eFile(filePath: string): Promise<UiE2eScenario> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`${filePath}: not valid JSON (${e instanceof Error ? e.message : e})`);
  }
  return validateUiE2e(parsed, filePath);
}
