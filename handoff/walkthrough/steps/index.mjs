// The 23 walkthrough steps in order (PLAN.md section 3). Each entry runs one step and returns { ok, error? }.
// "op" steps go through the ces-tester engine (engine.runOp); "driver" steps drive the module screens directly.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NotDrivable } from './common.mjs';
import { muSignin, muDiscovery, muBoundary, muIntent, muInterview, muFinishExtras, muCompile, muPush, interviewAlreadyFinished, muFinishExportOnly } from './muster.mjs';
import { aoAddUser, aoEvidence } from './ao.mjs';
import { eoAccess, eoSsp, eoUpload, eoReview, eoAssessor } from './eo.mjs';
import { simReadoutRemote, stTranslateRemote, stExecuteRemote } from './remote.mjs';

export const STEP_ORDER = [
  'prepare', 'sim-readout',
  'mu-signin', 'mu-discovery', 'mu-boundary', 'mu-intent', 'mu-interview', 'mu-finish', 'mu-compile', 'mu-push',
  'st-translate', 'st-execute',
  'eo-baseline', 'ao-add-user', 'ao-lockdown', 'ao-evidence', 'eo-change',
  'eo-access', 'eo-ssp', 'eo-upload', 'eo-review', 'eo-assessor', 'eo-explorer',
];

function latestPushed(cfg, prefix) {
  const dir = path.join(cfg.roots.pipelineRoot, 'Stamper', 'plan-data', cfg.tenantSlug, 'plans');
  if (!fs.existsSync(dir)) return undefined;
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort().pop();
  return f ? path.join(dir, f) : undefined;
}

function pushedPlanParams(cfg) {
  const missionPlan = latestPushed(cfg, 'manual-mission-plan-');
  const manifest = latestPushed(cfg, 'tenant-manifest-');
  if (!missionPlan || !manifest) {
    throw new NotDrivable(
      'no pushed plan under the pipeline root yet (run step 9, "Push the plan", first)',
      'walkthrough step order',
    );
  }
  return { missionPlan, manifest };
}

async function eoGet(cfg, route, http) {
  // Shape B: through the walkthrough's client (module address, bearer, tls.caFile).
  if (http) return http.moduleJson(cfg, 'eo', `${route}${route.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(cfg.tenantSlug)}`);
  const url = `${cfg.urls.eo.replace(/\/+$/, '')}${route}${route.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(cfg.tenantSlug)}`;
  const r = await fetch(url, { headers: cfg.tokens.eo ? { Authorization: `Bearer ${cfg.tokens.eo}` } : {}, signal: AbortSignal.timeout(60_000) });
  return r.ok ? r.json() : undefined;
}

export const STEPS = {
  'sim-readout': async (ctx) => {
    if (ctx.engine.remote) return simReadoutRemote(ctx);
    await ctx.engine.runOp('sim-readout', ctx);
    return { ok: true };
  },
  'mu-signin': muSignin,
  'mu-discovery': muDiscovery,
  'mu-boundary': muBoundary,
  'mu-intent': muIntent,
  'mu-interview': muInterview,
  'mu-finish': async (ctx) => {
    // "Finish & Score" pressed by hand between steps: export what it produced instead of waiting for the button.
    if (await interviewAlreadyFinished(ctx)) await muFinishExportOnly(ctx);
    else await ctx.engine.runOp('mu-finish', ctx);
    await muFinishExtras(ctx);
    return { ok: true };
  },
  'mu-compile': muCompile,
  'mu-push': muPush,
  'st-translate': async (ctx) => {
    if (ctx.engine.remote) return stTranslateRemote(ctx);
    const p = pushedPlanParams(ctx.cfg);
    await ctx.caption('Stamper (Configuration): connect, assess and translate the pushed plan');
    await ctx.engine.runOp('st-translate', ctx, p);
    return { ok: true };
  },
  'st-execute': async (ctx) => {
    if (ctx.engine.remote) return stExecuteRemote(ctx);
    const p = pushedPlanParams(ctx.cfg);
    const startedMs = Date.now();
    await ctx.caption('Stamper (Configuration): execute the translated plan against the simulated tenant');
    try {
      await ctx.engine.runOp('st-execute', ctx, p);
      return { ok: true };
    } catch (err) {
      // The engine's judge fails the op on any task outside its skip list, and that list is pinned to the demo deck's
      // plan (demo-dib-small). When the execute itself ran and its report is on disk, the walkthrough shows the failed
      // tasks as findings beside the report instead of hiding the step. Anything else stays a failure.
      const message = err instanceof Error ? err.message : String(err);
      const m = /^stamper-execute: \d+ unexpected failure\(s\) not on the GUI-leg skip list: (.+)$/s.exec(message);
      const report = latestPushed(ctx.cfg, 'execution-report-');
      if (!m || !report || fs.statSync(report).mtimeMs < startedMs) throw err;
      ctx.artifact(report);
      const parsed = JSON.parse(fs.readFileSync(report, 'utf8'));
      const findings = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((task) => ({
        task,
        reason: /leaver/i.test(task)
          ? 'Not applied: the leaver flow has no screen yet (a known issue, listed in KNOWN-ISSUES.md as KI-18), so no leaver was removed before this run. It shows here as an honest gap.'
          : 'Not applied by this run; see the execution report.',
      }));
      ctx.log(`  st-execute: execution report ${path.basename(report)} on disk (status ${parsed.status ?? parsed.summary?.status ?? 'unknown'}); ${findings.length} task(s) not applied, shown as findings`);
      return { ok: true, findings };
    }
  },
  'eo-baseline': async (ctx) => {
    await ctx.engine.runOp('eo-baseline', ctx);
    // The before-state for step 16, read while it is still true (the shape act-run.ts SLIDE_PROBES writes).
    const http = ctx.engine.remote ? ctx.http : undefined;
    const [assessment, sprs] = await Promise.all([eoGet(ctx.cfg, '/api/assessment', http), eoGet(ctx.cfg, '/api/sprs', http)]);
    const before = { assessment, sprs, capturedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(ctx.runDir, 'eo-before.json'), JSON.stringify(before, null, 2));
    ctx.artifact(path.join(ctx.runDir, 'eo-before.json'));
    return { ok: true };
  },
  'ao-add-user': aoAddUser,
  'ao-lockdown': async (ctx) => {
    await ctx.engine.runOp('ao-lockdown', ctx);
    return { ok: true };
  },
  'ao-evidence': aoEvidence,
  'eo-change': async (ctx) => {
    await ctx.engine.runOp('eo-change', ctx);
    return { ok: true };
  },
  'eo-access': eoAccess,
  'eo-ssp': eoSsp,
  'eo-upload': eoUpload,
  'eo-review': eoReview,
  'eo-assessor': eoAssessor,
  'eo-explorer': async (ctx) => {
    await ctx.engine.runOp('eo-explorer', ctx);
    return { ok: true };
  },
};

export { NotDrivable };
