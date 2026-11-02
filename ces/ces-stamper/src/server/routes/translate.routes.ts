// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { translateForTenant, InvalidInfraManifestError } from '../../translators/translateForTenant.js';
import { StamperConfig } from '../../config/StamperConfig.js';
import { StamperEngine } from '../../core/StamperEngine.js';
import { resolveTenantJsonPath } from '../../config/ClientConfig.js';
import { CommandRegistry } from '../../registry/CommandRegistry.js';
import { ReadinessResult, tenantPlansDir } from '../../core/EvidenceReadinessAnalyzer.js';
import { writeJsonArtifact } from 'ces-shared/persistence/files';

/**
 * The plans directory a translate writes into. A tenant: its own plans dir under the pipeline root.
 * No tenant (dev): the dev plans dir the plan picker scans (`tenantPlansDir('dev')`, under
 * CES_PIPELINE_ROOT), or CES_STAMPER_PLAN_DATA_ROOT when a run sets it (W8-PIS). FIN-21: never the
 * repo's own ces-stamper/plan-data/ (the default of getPlanDataRoot() when that variable is unset).
 */
export function translatePlansDir(tenant: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (tenant && tenant !== 'dev') return tenantPlansDir(tenant);
  return env.CES_STAMPER_PLAN_DATA_ROOT ? path.resolve(env.CES_STAMPER_PLAN_DATA_ROOT) : tenantPlansDir('dev');
}

export function createTranslateRouter(
  _getCachedMergedRegistry: () => CommandRegistry | null,
  getLastReadinessResult: () => ReadinessResult | null
): Router {
  const router = Router();

  // GET /api/last-translate — retrieve last translate session paths from tenant config
  router.get('/api/last-translate', async (req: Request, res: Response) => {
    try {
      const tenant = req.query['tenant'] as string | undefined;
      if (!tenant || tenant === 'dev') {
        res.json({ ok: false });
        return;
      }

      const tenantCfgPath = await resolveTenantJsonPath(tenant);
      if (!fs.existsSync(tenantCfgPath)) {
        res.json({ ok: false });
        return;
      }

      const raw = JSON.parse(fs.readFileSync(tenantCfgPath, 'utf-8'));
      const paths = raw.last_session?.translate_paths;
      if (!paths) {
        res.json({ ok: false });
        return;
      }

      res.json({ ok: true, paths });
    } catch {
      res.json({ ok: false });
    }
  });

  // POST /api/translate — translate a mission plan + manifest into an executable plan
  router.post('/api/translate', async (req: Request, res: Response) => {
    try {
      const { missionPlan, manifest, output: outputParam, infraManifest, tenant, gapsOnly, automatedOnly } = req.body as {
        missionPlan: string;
        manifest: string;
        output?: string;
        infraManifest?: string;
        tenant?: string;
        gapsOnly?: boolean;
        automatedOnly?: boolean;
      };

      if (!missionPlan || !manifest) {
        res.status(400).json({ success: false, error: 'missionPlan and manifest are required' });
        return;
      }

      // Auto-generate output path into tenant plans dir (or the dev plans dir)
      const planDataDir = translatePlansDir(tenant);
      let output: string;
      if (outputParam && outputParam.trim()) {
        output = outputParam.trim();
      } else {
        if (!fs.existsSync(planDataDir)) fs.mkdirSync(planDataDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        output = path.join(planDataDir, `executable-plan-${ts}.json`);
      }

      // W8-STX: the one translate path, built the CLI's way (translateForTenant, mode 'gui');
      // only the post-processing below is the route's own.
      let translated: Awaited<ReturnType<typeof translateForTenant>>;
      try {
        translated = await translateForTenant({
          mode: 'gui',
          missionPlanPath: missionPlan,
          manifestPath: manifest,
          outputPath: output,
          tenant: tenant && tenant !== 'dev' ? tenant : undefined,
          infraManifestPath: infraManifest,
        });
      } catch (translateErr) {
        if (translateErr instanceof InvalidInfraManifestError) {
          res.status(400).json({ success: false, error: translateErr.message });
          return;
        }
        throw translateErr;
      }
      const result = translated.result;
      const usedInfraManifest = translated.infraManifestPath;
      const infraVarsMerged = result.variableMergeReport.fromInfraManifest ?? 0;

      // Apply readiness results if a prior assessment was run
      const lastReadinessResult = getLastReadinessResult();
      let preAccomplished = 0;
      if (lastReadinessResult && lastReadinessResult.accomplishedIds.length > 0) {
        try {
          const planRaw = fs.readFileSync(output, 'utf-8');
          const planData = JSON.parse(planRaw);
          const accomplishedSet = new Set(lastReadinessResult.accomplishedIds);

          for (const task of planData.execution_graph) {
            const taskDirective = task.action?.args?._directive as string | undefined;
            const isAutomatedTask = taskDirective === 'implement' || taskDirective === 'validate';
            const subs = task.action?.args?._sub_commands as Array<{ id: string; _pre_accomplished?: boolean }> | undefined;
            if (!subs) continue;
            for (const sub of subs) {
              if (accomplishedSet.has(sub.id)) {
                // Skip marking if automatedOnly mode and this is an automated task
                if (automatedOnly && isAutomatedTask) continue;
                sub._pre_accomplished = true;
                preAccomplished++;
              }
            }
          }

          if (preAccomplished > 0) {
            writeJsonArtifact(output, planData);
          }

          // Gaps Only: remove fully-accomplished tasks and strip accomplished sub-commands from partial tasks
          if (gapsOnly && preAccomplished > 0) {
            let gapsRemoved = 0;
            const removedTaskIds = new Set<string>();

            planData.execution_graph = planData.execution_graph.filter((task: any) => {
              const subs = task.action?.args?._sub_commands as Array<{ _pre_accomplished?: boolean }> | undefined;
              if (!subs || subs.length === 0) return true;
              const allAccomplished = subs.every(s => s._pre_accomplished);
              if (allAccomplished) {
                removedTaskIds.add(task.id);
                gapsRemoved++;
                return false;
              }
              // Partial: strip accomplished sub-commands
              task.action.args._sub_commands = subs.filter(s => !s._pre_accomplished);
              return true;
            });

            // Clean removed task IDs from depends_on arrays
            if (removedTaskIds.size > 0) {
              for (const task of planData.execution_graph) {
                if (task.depends_on && Array.isArray(task.depends_on)) {
                  task.depends_on = task.depends_on.filter((id: string) => !removedTaskIds.has(id));
                }
              }
            }

            writeJsonArtifact(output, planData);
            preAccomplished = 0; // reset — they're removed now, not just marked
            (planData as any)._gapsRemoved = gapsRemoved;
          }
        } catch {
          // Non-fatal: proceed without pre-accomplished marking
        }
      }

      // Embed source file provenance into the EP for traceability (no file copies)
      try {
        const epRaw = JSON.parse(fs.readFileSync(output, 'utf-8'));
        epRaw._source_paths = {
          mission_plan: missionPlan,
          tenant_manifest: manifest,
          infrastructure_manifest: usedInfraManifest || null,
          translated_at: new Date().toISOString(),
        };
        writeJsonArtifact(output, epRaw);
      } catch {
        // Non-fatal: proceed without provenance embedding
      }

      // Copy the EP into the plans dir only when it was written somewhere else (FIN-21: a plan
      // already in the plans dir, e.g. the auto-generated output, was copied a second time).
      const pdDir = planDataDir;
      let epCopyPath = output;
      if (path.resolve(path.dirname(output)).toLowerCase() !== path.resolve(pdDir).toLowerCase()) {
        try {
          if (!fs.existsSync(pdDir)) fs.mkdirSync(pdDir, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          epCopyPath = path.join(pdDir, `executable-plan-${ts}.json`);
          fs.copyFileSync(output, epCopyPath);
        } catch {
          epCopyPath = output; // Fallback to original path
        }
      }

      // Persist translate paths to tenant JSON for next-run recall
      if (tenant && tenant !== 'dev') {
        try {
          const tenantCfgPath = await resolveTenantJsonPath(tenant);
          if (fs.existsSync(tenantCfgPath)) {
            const raw = JSON.parse(fs.readFileSync(tenantCfgPath, 'utf-8'));
            raw.last_session = raw.last_session || {};
            raw.last_session.translate_paths = {
              missionPlan,
              manifest,
              output: epCopyPath,
              infraManifest: usedInfraManifest || undefined,
            };
            writeJsonArtifact(tenantCfgPath, raw, { trailingNewline: true });
          }
        } catch {
          // Non-fatal: proceed without path persistence
        }
      }

      // Re-read final task count from disk (may differ after gapsOnly filtering)
      let finalTaskCount = result.plan.execution_graph.length;
      let gapsRemoved = 0;
      if (gapsOnly) {
        try {
          const finalPlan = JSON.parse(fs.readFileSync(output, 'utf-8'));
          finalTaskCount = finalPlan.execution_graph.length;
          gapsRemoved = finalPlan._gapsRemoved || 0;
        } catch { /* use original count */ }
      }

      // Aggregate directive counts from EP — prefer plan-level _control_directives map,
      // fallback to task-iteration for old EPs without the map.
      let directiveCounts: { automated: number; excluded: number; nonstack: number } | undefined;
      try {
        const epRaw = JSON.parse(fs.readFileSync(output, 'utf-8'));
        const cdMap = epRaw.variables?._control_directives as Record<string, string> | undefined;
        if (cdMap && typeof cdMap === 'object' && Object.keys(cdMap).length > 0) {
          // New path: read directly from authoritative map
          const counts = { automated: 0, excluded: 0, nonstack: 0 };
          for (const val of Object.values(cdMap)) {
            if (val === 'automated') counts.automated++;
            else if (val === 'excluded') counts.excluded++;
            else if (val === 'nonstack') counts.nonstack++;
          }
          directiveCounts = counts;
        } else {
          // Fallback: task-iteration for old EPs without _control_directives
          const controlMap = new Map<string, string>();
          for (const task of (epRaw.execution_graph || [])) {
            const dir = task.action?.args?._directive as string | undefined;
            if (dir) {
              for (const cid of (task.controls || [])) {
                controlMap.set(cid, dir);
              }
            }
          }
          const counts = { automated: 0, excluded: 0, nonstack: 0 };
          for (const val of controlMap.values()) {
            if (val === 'automated') counts.automated++;
            else if (val === 'excluded') counts.excluded++;
            else if (val === 'nonstack') counts.nonstack++;
          }
          directiveCounts = counts;
        }
      } catch { /* Non-fatal: proceed without directive counts */ }

      res.json({
        success: true,
        planId: result.plan.plan_id,
        totalTasks: finalTaskCount,
        warnings: result.warnings,
        controlIssues: result.controlIssues ?? [], // FX2-ST3: quarantined controls (manual review)
        preAccomplished,
        infraVarsMerged,
        directiveCounts,
        gapsOnly: !!gapsOnly,
        automatedOnly: automatedOnly || false,
        gapsRemoved,
        planDataPaths: {
          missionPlan,
          manifest,
          output: epCopyPath,
          infraManifest: usedInfraManifest || undefined,
        },
        variableMergeReport: result.variableMergeReport,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // POST /api/validate — validate an executable plan without executing
  router.post('/api/validate', async (req: Request, res: Response) => {
    try {
      const { plan: planPath } = req.body as { plan: string };

      if (!planPath) {
        res.status(400).json({ success: false, error: 'plan path is required' });
        return;
      }

      const config = StamperConfig.fromTenantConfig({ dryRun: true });
      const engine = new StamperEngine(config);
      await engine.loadPlan(planPath);

      const plan = engine.getPlan();
      if (!plan) {
        res.status(500).json({ success: false, error: 'Plan not loaded after loadPlan()' });
        return;
      }

      const tasksByEngine = plan.execution_graph.reduce<Record<string, number>>((acc, task) => {
        acc[task.action.engine] = (acc[task.action.engine] ?? 0) + 1;
        return acc;
      }, {});

      res.json({
        success: true,
        planId: plan.plan_id,
        taskCount: plan.execution_graph.length,
        tasksByEngine
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  return router;
}
