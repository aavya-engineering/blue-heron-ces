// Shared helpers for the walkthrough's driver steps (PLAN.md section 3, kind "driver").
// Every driver step acts through a module screen with Playwright (UI ONLY rule, PLAN.md section 10 item 7).
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Thrown when a screen the step needs is not there on this build. The step is then shown as
 * "not yet drivable" with its manual instruction (content/steps.json), and the log carries a
 * PUNCH-LIST candidate. Never substitute an API call or a CLI for the missing screen.
 */
export class NotDrivable extends Error {
  constructor(message, pointer) {
    super(message);
    this.name = 'NotDrivable';
    this.pointer = pointer ?? '';
  }
}

/** Wait for a selector the step relies on; a missing control means "not yet drivable", not a failure. */
export async function requireOnScreen(raw, selector, what, timeoutMs = 20_000, pointer = '') {
  try {
    await raw.locator(selector).first().waitFor({ state: 'attached', timeout: timeoutMs });
  } catch {
    throw new NotDrivable(`the screen has no ${what} (${selector}) on this build`, pointer);
  }
}

/** Save a full-page screenshot of the visible pane into the step folder and register it. */
export async function shot(ctx, name) {
  const file = path.join(ctx.workDir, name);
  try {
    await ctx.raw.screenshot({ path: file, fullPage: true });
    ctx.artifact(file);
    return file;
  } catch (err) {
    ctx.log(`  screenshot ${name} not written: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** Click something that starts a browser download; save the file into the step folder and register it. */
export async function clickAndSave(ctx, selector, timeoutMs = 60_000) {
  const [dl] = await Promise.all([ctx.raw.waitForEvent('download', { timeout: timeoutMs }), ctx.raw.locator(selector).first().click()]);
  const file = path.join(ctx.workDir, dl.suggestedFilename());
  await dl.saveAs(file);
  ctx.artifact(file);
  return file;
}

/** Write a small JSON facts file into the step folder and register it. */
export function writeFacts(ctx, name, facts) {
  const file = path.join(ctx.workDir, name);
  fs.writeFileSync(file, JSON.stringify(facts, null, 2));
  ctx.artifact(file);
  return file;
}

/** The text of the first match, trimmed, or '' when absent. */
export async function textOf(raw, selector) {
  try {
    return ((await raw.locator(selector).first().textContent({ timeout: 5_000 })) ?? '').trim();
  } catch {
    return '';
  }
}

export const tid = (id) => `[data-testid="${id}"]`;

/**
 * Where the browser opens a module. Shape A: the configured URL. Shape B: the module's forwarder on this machine
 * (remote.mjs), so the module sits at the root of an origin as on the kit ports.
 */
export function browserUrl(ctx, module) {
  const r = ctx.engine?.remote;
  if (r) return r.origins[module];
  const u = ctx.cfg.urls;
  if (module === 'muster') return u.musterSpa.replace(/\/+$/, '');
  if (module === 'stamper') return `${u.stamper.replace(/\/+$/, '')}${u.stamperBasePath ?? ''}`;
  return String(u[module]).replace(/\/+$/, '');
}
