// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Flow-through X2 (MS-R10): vite-node entry that runs Muster's REAL generator
 * for a scenario and writes the Mission Plan + Tenant Manifest where Stamper's
 * picker reads (`<outDir>/plans/manual-mission-plan-<slug>-<ts>.json`, the
 * muster-api push naming). Spawned by muster-plan-source.ts — Muster sources
 * are TypeScript behind an `@/` alias, so this cannot run under plain node.
 *
 * Inputs (env): FT_PLAN_CASE (path to a MusterPlanCase JSON), FT_OUT_DIR, FT_SLUG.
 * Output: one `FT_RESULT <json>` line on stdout. Before writing, both artifacts
 * are parsed with ces-shared's mission-plan contract (the boundary schema).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findCesRoot } from './ces-root.js';
import { generateMusterPlan, type MusterPlanCase } from './muster-plan-generator.js';

async function main(): Promise<void> {
  const casePath = process.env.FT_PLAN_CASE;
  const outDir = process.env.FT_OUT_DIR;
  const slug = process.env.FT_SLUG;
  if (!casePath || !outDir || !slug) throw new Error('FT_PLAN_CASE, FT_OUT_DIR and FT_SLUG are required');
  const planCase = JSON.parse(fs.readFileSync(casePath, 'utf8')) as MusterPlanCase;
  const cesRoot = findCesRoot();
  const out = await generateMusterPlan(planCase, cesRoot);

  const shared: any = await import(
    pathToFileURL(path.join(cesRoot, 'ces-shared', 'dist', 'types', 'mission-plan.contract.js')).href
  );
  const mpParse = shared.ManualMissionPlanSchema.safeParse(out.missionPlan);
  const tmParse = shared.TenantManifestSchema.safeParse(out.tenantManifest);
  if (!mpParse.success) throw new Error(`ces-shared rejects Muster MP: ${JSON.stringify(mpParse.error.issues)}`);
  if (!tmParse.success) throw new Error(`ces-shared rejects Muster TM: ${JSON.stringify(tmParse.error.issues)}`);

  const plansDir = path.join(outDir, 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const missionPlanPath = path.join(plansDir, `manual-mission-plan-${slug}-${ts}.json`);
  const manifestPath = path.join(plansDir, `tenant-manifest-${slug}-${ts}.json`);
  fs.writeFileSync(missionPlanPath, JSON.stringify(out.missionPlan, null, 2), 'utf8');
  fs.writeFileSync(manifestPath, JSON.stringify(out.tenantManifest, null, 2), 'utf8');
  process.stdout.write(`FT_RESULT ${JSON.stringify({ missionPlanPath, manifestPath, provenance: out.provenance })}\n`);
}

main().catch((e) => {
  process.stderr.write(`muster-plan-gen failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
