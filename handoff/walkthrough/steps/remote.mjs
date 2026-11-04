// Shape B replacements for the engine acts that read or write module folders (PLAN.md section 11.3 item 3 and
// 11.6 item 3; the op audit table in docs/context/IMPLEMENTATION_LOG.md). Each one still acts through the module's
// screen with the engine's own exported driver functions and selectors; only the facts the acts used to read from
// disk come from the module's own HTTP answers instead.
//
// - sim-readout: simstack-create read the tenant record under runDir\tenant-root (absent in shape B, so its card
//   would say "record unreadable"). Here the card is built from the simulator's and the modules' own answers.
// - st-translate: stamper-translate seeds the plan variables with a plain Node fetch and, when that fails, silently
//   writes them to a file on THIS machine that Stamper never reads. Here the seed goes through the walkthrough's
//   client with the bearer and no file fallback, and the plan paths are the ones Stamper itself lists for the tenant
//   (its /api/plan-data-paths answer, the route the console uses to prefill the same fields).
// - st-execute: stamper-execute judges the execution report it reads from disk. Here the report is read through
//   Stamper's /api/read-plan-file, saved into the step folder, and its unapplied tasks are shown as findings.
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NotDrivable, writeFacts } from './common.mjs';
import { testerRootOf, remoteBase, bearerFor } from '../remote.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function dist(cfg, rel) {
  return import(pathToFileURL(path.join(testerRootOf(cfg), 'dist', 'src', rel)).href);
}

/** Step 1 in shape B: what the simulator serves, and whether each module lists the tenant. */
export async function simReadoutRemote(ctx) {
  const { cfg, http } = ctx;
  const sim = cfg.urls.stacksim.replace(/\/+$/, '');
  const hdr = { headers: { 'x-walkthrough-module': 'stacksim' } };
  await ctx.caption('Simulator: read what the simulated tenant answers, through its address');
  const policy = await http.request(`${sim}/v1.0/policies/authorizationPolicy`, hdr);
  const orgR = await http.request(`${sim}/v1.0/organization`, hdr);
  const caR = await http.request(`${sim}/v1.0/identity/conditionalAccess/policies/caPolicy-1`, hdr);
  const j = (r) => { try { return r.json(); } catch { return null; } };
  const org = j(orgR)?.value?.[0] ?? {};
  const ca = j(caR) ?? {};
  const listed = async (module, route) => {
    if (module === 'stamper' && !bearerFor(cfg, module)) return 'not checked (Stamper token not set)';
    const body = await http.moduleJson(cfg, module, route, { timeoutMs: 15_000 });
    if (!body) return `no 2xx JSON answer from ${remoteBase(cfg, module)}${route}`;
    const list = Array.isArray(body) ? body : Array.isArray(body.tenants) ? body.tenants : [];
    return list.some((t) => (t?.slug ?? t?.id ?? t) === cfg.tenantSlug) ? 'listed' : 'not listed (ask the module owner to register the tenant)';
  };
  const facts = {
    slug: cfg.tenantSlug,
    simUrl: sim,
    policyAnswered: policy.status === 200,
    tenantId: org.id ?? null,
    organisation: org.displayName ?? null,
    caPolicy1: { status: caR.status, state: typeof ca.state === 'string' ? ca.state : null, displayName: ca.displayName ?? null },
    tenantListedBy: { stamper: await listed('stamper', '/api/tenants'), ao: await listed('ao', '/api/tenants') },
  };
  writeFacts(ctx, 'simstack-readout.json', facts);
  const row = (k, v) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
  const { htmlDataUrl } = await dist(cfg, 'demo/show/app-pane.js');
  await ctx.page.goto(htmlDataUrl(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Simulated tenant ${esc(facts.slug)}</title>
<style>html,body{margin:0;background:#0a1930;color:#dce8f7;font-family:"Segoe UI",system-ui,sans-serif}.w{padding:32px;max-width:76ch;margin:0 auto}
h1{font-size:22px;font-weight:600;margin:0 0 4px}.s{color:#9db2cc;font-size:13px;margin:0 0 18px}table{border-collapse:collapse;width:100%;font-size:13px}
td{border-bottom:1px solid #1e3a5c;padding:6px 8px;vertical-align:top}td:first-child{color:#9db2cc;width:22ch}</style></head><body><div class="w">
<h1>Simulated tenant: ${esc(facts.slug)}</h1><p class="s">Read from the simulator's own answers at its address. Nothing was changed.</p><table>
${row('Simulator', `${sim} (authorizationPolicy ${facts.policyAnswered ? 'answered' : 'did not answer'})`)}
${row('Tenant id', facts.tenantId ?? '(none)')}
${row('Organisation', facts.organisation ?? '(none)')}
${row('MFA policy caPolicy-1', facts.caPolicy1.state ? `${facts.caPolicy1.displayName ?? ''} state ${facts.caPolicy1.state}` : `HTTP ${facts.caPolicy1.status}`)}
${row('Stamper lists the tenant', facts.tenantListedBy.stamper)}
${row('AdminOps lists the tenant', facts.tenantListedBy.ao)}
</table></div></body></html>`));
  await ctx.caption(`The simulated tenant answers: ${facts.organisation ?? facts.slug}; caPolicy-1 is ${facts.caPolicy1.state ?? 'not readable'}`);
  if (!facts.policyAnswered) return { ok: false, error: `the simulator did not answer ${sim}/v1.0/policies/authorizationPolicy` };
  return { ok: true };
}

/** A FetchLike (stamper-plan-variables.ts) that reaches Stamper's address with the bearer, never a local file. */
function stamperFetch(ctx) {
  const { cfg, http } = ctx;
  const local = ctx.engine.remote.origins.stamper;
  const remote = remoteBase(cfg, 'stamper');
  return async (url, init = {}) => {
    const target = url.startsWith(local) ? `${remote}${url.slice(local.length)}` : url;
    const t = bearerFor(cfg, 'stamper');
    const r = await http.request(target, {
      method: init.method ?? 'GET',
      body: init.body,
      timeoutMs: 60_000,
      headers: { accept: 'application/json', 'x-walkthrough-module': 'stamper', ...(init.headers ?? {}), ...(t ? { authorization: `Bearer ${t}` } : {}) },
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json() };
  };
}

async function backstageOf(ctx) {
  const b = ctx.engine.backstage();
  if (!b) throw new Error('the Stamper window was not opened by Prepare (no backstage pane)');
  const app = await dist(ctx.cfg, 'demo/show/app-pane.js');
  const theatre = await dist(ctx.cfg, 'demo/show/theatrical-page.js');
  const hud = app.hudSurfaceOf(b);
  const caption = async (text) => {
    ctx.emitCaption(text);
    await theatre.paneCaption.show(hud, text).catch(() => undefined);
  };
  return { b, caption };
}

/** Step 10 in shape B: connect, assess, seed and translate on the Stamper console, through its address. */
export async function stTranslateRemote(ctx) {
  const { cfg } = ctx;
  const slug = cfg.tenantSlug;
  const paths = await ctx.http.moduleJson(cfg, 'stamper', `/api/plan-data-paths?tenant=${encodeURIComponent(slug)}`);
  if (!paths?.missionPlan || !paths?.manifest) {
    throw new NotDrivable(`Stamper lists no pushed mission plan and tenant manifest for ${slug} yet (run step 9, "Push the plan", first)`, 'Stamper GET /api/plan-data-paths');
  }
  writeFacts(ctx, 'st-translate-plan.json', { tenant: slug, missionPlan: path.basename(paths.missionPlan.replace(/\\/g, '/')), manifest: path.basename(paths.manifest.replace(/\\/g, '/')), listedBy: 'Stamper /api/plan-data-paths' });
  const driver = await dist(cfg, 'demo/stamper-ui-driver.js');
  const vars = await dist(cfg, 'demo/stamper-plan-variables.js');
  const op = await dist(cfg, 'demo/show/ops/stamper-translate-op.js');
  const app = await dist(cfg, 'demo/show/app-pane.js');
  const { b, caption } = await backstageOf(ctx);
  const base = ctx.engine.remote.origins.stamper;
  await ctx.caption('Stamper (Configuration): connect, assess and translate the pushed plan');
  await b.goto(base);
  const fetchImpl = stamperFetch(ctx);
  const t0 = Date.now();
  const result = await driver.runStamperUiFlow(b.page, {
    baseUrl: base,
    slug,
    missionPlanPath: paths.missionPlan,
    manifestPath: paths.manifest,
    pipelineRoot: ctx.workDir,
    phase: 'through-translate',
    screenshotDir: ctx.workDir,
    caption,
    // API only: a seed that does not reach Stamper must fail the step, not land in a file Stamper never reads.
    seedVariables: (o) => vars.seedPlanVariables({ slug: o.slug, seed: o.seed, baseUrl: o.baseUrl, fetchImpl }),
  });
  for (const s of result.screenshots) ctx.artifact(s);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const taskCount = op.translatedTaskCount(result.translateResponse);
  writeFacts(ctx, 'st-translate.json', { seconds: Number(seconds), taskCount: taskCount ?? null, variableSeed: result.variableSeed ? { route: result.variableSeed.route, added: result.variableSeed.added.length, kept: result.variableSeed.kept.length, total: result.variableSeed.total } : null });
  ctx.state.stamperTranslated = true;
  await caption(`Translated in ${seconds} s: ${taskCount ?? 'unknown'} tasks, ready to execute`);
  // The card goes to the headless readout pane: the Stamper window keeps the connected console execute needs.
  await ctx.engine.readout.goto(app.htmlDataUrl(op.readoutHtml({ slug, taskCount, missionPlanPath: path.basename(paths.missionPlan.replace(/\\/g, '/')), manifestPath: path.basename(paths.manifest.replace(/\\/g, '/')), seconds })));
  return { ok: true };
}

/** Step 11 in shape B: execute the translated plan on the same Stamper page; the report is read through Stamper. */
export async function stExecuteRemote(ctx) {
  const { cfg } = ctx;
  const slug = cfg.tenantSlug;
  const driver = await dist(cfg, 'demo/stamper-ui-driver.js');
  const exec = await dist(cfg, 'demo/show/ops/stamper-execute-op.js');
  const { b, caption } = await backstageOf(ctx);
  const pre = await exec.readExecutePreconditions(b.page);
  if (!ctx.state.stamperTranslated || !pre.ready) {
    throw new NotDrivable('the Stamper window has no translated plan in this session (run step 10, "Translate", first)', 'walkthrough step order');
  }
  const listReports = async () => {
    const r = await ctx.http.moduleJson(cfg, 'stamper', `/api/browse?tenant=${encodeURIComponent(slug)}&pattern=execution-report`);
    return Array.isArray(r?.files) ? r.files : [];
  };
  const before = new Set((await listReports()).map((f) => f.name));
  await ctx.caption('Stamper (Configuration): execute the translated plan against the simulated tenant');
  const t0 = Date.now();
  const result = await driver.runStamperUiFlow(b.page, {
    baseUrl: ctx.engine.remote.origins.stamper,
    slug,
    missionPlanPath: '',
    manifestPath: '',
    pipelineRoot: ctx.workDir,
    phase: 'execute-only',
    screenshotDir: ctx.workDir,
    caption,
  });
  for (const s of result.screenshots) ctx.artifact(s);
  const fresh = (await listReports()).filter((f) => !before.has(f.name) && f.name.endsWith('.json'));
  const newest = fresh.sort((a, b2) => String(b2.name).localeCompare(String(a.name)))[0];
  if (!newest) {
    return { ok: false, error: `Stamper wrote no new execution report for ${slug} (badge read ${JSON.stringify(result.executeBadge ?? '')}); the badge is never the judge` };
  }
  const report = await ctx.http.moduleJson(cfg, 'stamper', `/api/read-plan-file?path=${encodeURIComponent(newest.path)}`);
  if (!report) return { ok: false, error: `Stamper listed ${newest.name} but did not return it through /api/read-plan-file` };
  const file = writeFacts(ctx, String(newest.name).replace(/[^A-Za-z0-9._-]/g, '_'), report);
  const parsed = driver.parseExecutionReport(report);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  ctx.log(`  st-execute: execution report ${path.basename(file)} read through Stamper (status ${parsed.status ?? 'unknown'}, ${parsed.completedTasks ?? '?'} of ${parsed.totalTasks ?? '?'} applied in ${seconds} s)`);
  await caption(`Execute finished: ${parsed.completedTasks ?? '?'} of ${parsed.totalTasks ?? '?'} tasks applied; the report is the judge, not the badge`);
  const findings = parsed.failures.map((f) => ({
    task: f.entryId ?? f.taskId,
    reason: /leaver/i.test(`${f.entryId ?? ''} ${f.taskId}`)
      ? 'Not applied: the leaver flow has no screen yet (a known issue, listed in KNOWN-ISSUES.md as KI-18), so no leaver was removed before this run. It shows here as an honest gap.'
      : 'Not applied by this run; see the execution report.',
  }));
  return findings.length ? { ok: true, findings } : { ok: true };
}
