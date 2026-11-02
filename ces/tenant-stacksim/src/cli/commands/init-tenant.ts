// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import * as path from 'node:path';
import { loadProfile, resolveProfilePath } from '../../profiles/ProfileLoader.js';
import { writeSimTenantConfig, type WriteSimTenantConfigResult } from '../../config/SimTenantConfig.js';
import type { TenantStance } from '../../gating/StackShapeGate.js';
import { parseFlags } from '../index.js';

export interface InitTenantArgs {
  stance: TenantStance;
  slug?: string;
  port?: number;
  emitPlanData?: boolean;
  /** backlog-S3: opt-in write of the flat ~/.stamper/tenants file (TenantProbe compat). */
  emitFlat?: boolean;
  profilesDir?: string;
  projectRoot?: string;
  homeDir?: string;
}

/** `stacksim init-tenant <m365_only|m365_sentinel|m365_azure> [--slug s] [--port n] [--emit-plan-data] [--plan-data-root dir] [--tenantprobe-flat]`
 *
 * DEPRECATED FOR ORCHESTRATED USE (G-TENANT-M4 RESOLUTION, founder decision
 * 2026-07-11 — docs/goals/G-TENANT-M4.md): this command's direct config
 * writes (plan-data and the flat ~/.stamper path) are a STANDALONE-DEV
 * CONVENIENCE only. Orchestrated runs register sim tenants through
 * ces-tester -> ces-tenant's registry (ephemeral kind:'sim' lifecycle,
 * physically separate sim/ root — the structural A9 closure lives THERE).
 * tenant-stacksim stays tenant-ignorant and zero-dependency; the command
 * is kept, not deleted, per the resolution.
 *
 * --plan-data-root points the nested plan-data emit at another project's
 * root (e.g. ../ces-stamper, whose GUI tenant picker scans
 * <root>/plan-data/<slug>/<slug>.json) instead of process.cwd(); it implies
 * --emit-plan-data.
 *
 * backlog-S3: --tenantprobe-flat opts IN to writing the flat
 * `~/.stamper/tenants/<slug>.json` — the REAL Stamper config directory,
 * which TenantProbe.psm1 hardcodes and Stamper's GuiServer migrates into
 * plan-data at startup. Without the flag, nothing is written there. Callers
 * who pass it own deleting the file when done. */
export async function runInitTenant(argv: string[]): Promise<WriteSimTenantConfigResult> {
  const [stance, ...rest] = argv;
  if (!stance) {
    throw new Error('stacksim init-tenant: missing <profile> argument (m365_only|m365_sentinel|m365_azure)');
  }
  const flags = parseFlags(rest);
  const planDataRoot = typeof flags['plan-data-root'] === 'string' ? flags['plan-data-root'] : undefined;
  const emitFlat = flags['tenantprobe-flat'] === true;
  const result = await initTenant({
    stance: stance as TenantStance,
    slug: typeof flags.slug === 'string' ? flags.slug : undefined,
    port: typeof flags.port === 'string' ? Number(flags.port) : undefined,
    emitPlanData: flags['emit-plan-data'] === true || planDataRoot !== undefined,
    emitFlat,
    projectRoot: planDataRoot,
  });
  if (result.flatPath || result.planDataPath) {
    console.warn(
      'stacksim init-tenant: DEPRECATED for orchestrated use — direct config writes are a standalone-dev convenience only. ' +
        "Orchestrated runs register sim tenants via ces-tester (ces-tenant registry, kind:'sim'). " +
        'See docs/goals/G-TENANT-M4.md RESOLUTION 2026-07-11.',
    );
  }
  if (result.flatPath) {
    console.warn(
      `stacksim init-tenant: wrote ${result.flatPath} into the REAL Stamper config dir (--tenantprobe-flat) — delete it when the sim run is done.`,
    );
  }
  return result;
}

export async function initTenant(args: InitTenantArgs): Promise<WriteSimTenantConfigResult> {
  const profilesDir = args.profilesDir ?? path.join(process.cwd(), 'profiles');
  const profilePath = resolveProfilePath(args.stance, profilesDir);
  const profile = await loadProfile(profilePath);
  const slug = args.slug ?? profile.slug;

  return writeSimTenantConfig(
    { slug, tenantStance: profile.tenantStance, port: args.port },
    { emitPlanData: args.emitPlanData, emitFlat: args.emitFlat, projectRoot: args.projectRoot, homeDir: args.homeDir },
  );
}
