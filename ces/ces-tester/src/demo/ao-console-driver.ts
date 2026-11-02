// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-35 EU-AO: the AO kit console (ces-ao/ui, served at /app/ by AoServer, FIN-30) driven as an operator, op by op,
 * in the twin's order (the scenario's `adminops_ops`, as E7A ran them through the CLI): open the command from the
 * search, pick the sim tenant, fill the parameters the record names, 1 · DRY RUN, then 2 · APPLY (the SPA unlocks
 * APPLY only after a dry run of the same request and sends `confirmApply` itself). Hooks from LOG-FIN-30.md (`dry-run`,
 * `apply`, `search-cmd-<id>`, `form-title[data-command-id]`, `tenant-select`, `param-<name>`, `result-status`).
 * Two-person approval is off (founder ruling 2026-10-31), so a T3 op runs the T2 sequence, as the twin does.
 *
 * Judged facts come from the browser's own traffic (the POST /api/execute/<id> bodies), never from the DOM.
 */
import type { ConsolePage } from './console-window.js';
import { waitForCondition } from './ui-page.js';

export const AO_KIT = {
  search: '[data-testid="command-search"]',
  searchResult: (id: string) => `[data-testid="search-cmd-${id}"]`,
  formTitle: (id: string) => `[data-testid="form-title"][data-command-id="${id}"]`,
  tenantSelect: '[data-testid="tenant-select"]',
  tenantOption: (slug: string) => `[data-testid="tenant-select"] option[value="${slug}"]`,
  param: (name: string) => `[data-testid="param-${name}"]`,
  dryRun: '[data-testid="dry-run"]',
  apply: '[data-testid="apply"]',
  resultStatus: '[data-testid="result-status"]',
  cancel: '[data-testid="form-cancel"]',
} as const;

export interface AoConsoleOp {
  readonly op: string;
  readonly tier: 'T2' | 'T3';
  /** name -> value, read from the registry record (never typed from the scenario). */
  readonly params: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

export interface AoConsoleCall {
  readonly call: 'dry_run' | 'apply';
  readonly http: number;
  readonly body: unknown;
  readonly badge?: string;
}

export interface AoConsoleOpResult {
  readonly op: string;
  readonly calls: AoConsoleCall[];
  readonly error?: string;
}

const T = { form: 60_000, exec: 300_000 } as const;

/** The CLI-shaped result object of one web execute body (the route wraps the executor result in `result`). Pure. */
export function cliShapeOf(body: unknown): Record<string, unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  const inner = (b.result && typeof b.result === 'object' ? b.result : b) as Record<string, unknown>;
  return { ...inner, ...(b.evidencePersisted !== undefined ? { evidencePersisted: b.evidencePersisted } : {}), ...(b.evidencePath !== undefined ? { evidencePath: b.evidencePath } : {}) };
}

/** One op through the console. Never throws for an op: the error is recorded and the next op still runs. */
export async function driveAoConsoleOp(page: ConsolePage, slug: string, op: AoConsoleOp): Promise<AoConsoleOpResult> {
  const calls: AoConsoleCall[] = [];
  try {
    await page.caption(`AdminOps: ${op.op} (${op.tier}) — open the command`);
    await page.waitForSelector(AO_KIT.search, T.form);
    await page.fill(AO_KIT.search, op.op);
    await page.waitForSelector(AO_KIT.searchResult(op.op), T.form);
    await page.click(AO_KIT.searchResult(op.op));
    await page.waitForSelector(AO_KIT.formTitle(op.op), T.form);
    await page.waitForSelector(AO_KIT.tenantOption(slug), T.form);
    await page.selectOption(AO_KIT.tenantSelect, slug);
    const stuck = await page.inputValue(AO_KIT.tenantSelect);
    if (stuck !== slug) throw new Error(`tenant-select did not stick on ${slug} (read "${stuck}")`);
    for (const p of op.params) {
      const sel = AO_KIT.param(p.name);
      if ((await page.count(sel)) === 0) throw new Error(`no parameter field param-${p.name}`);
      const ro = await page.getAttribute(sel, 'readonly');
      const cur = await page.inputValue(sel).catch(() => '');
      if (ro !== null) {
        if (cur !== p.value) throw new Error(`param-${p.name} is tenant-sourced and shows "${cur}", the record holds "${p.value}"`);
        continue;
      }
      if (cur !== p.value) await page.fill(sel, p.value);
    }
    await page.caption(`AdminOps: ${op.op} — 1 · DRY RUN`);
    const d = await page.waitForResponseFull(`/api/execute/${op.op}`, () => page.click(AO_KIT.dryRun), T.exec, 'POST');
    calls.push({ call: 'dry_run', http: d.status, body: d.json, badge: (await page.textContent(AO_KIT.resultStatus))?.trim() ?? undefined });
    if (d.status >= 400) throw new Error(`dry run HTTP ${d.status}`);
    await waitForCondition(`APPLY to unlock after the ${op.op} dry run`, async () => (await page.getAttribute(AO_KIT.apply, 'disabled')) === null, T.form);
    await page.caption(`AdminOps: ${op.op} — 2 · APPLY (the live write on the simulated tenant)`);
    const a = await page.waitForResponseFull(`/api/execute/${op.op}`, () => page.click(AO_KIT.apply), T.exec, 'POST');
    calls.push({ call: 'apply', http: a.status, body: a.json, badge: (await page.textContent(AO_KIT.resultStatus))?.trim() ?? undefined });
    return { op: op.op, calls };
  } catch (e) {
    return { op: op.op, calls, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if ((await page.count(AO_KIT.cancel).catch(() => 0)) > 0) await page.click(AO_KIT.cancel).catch(() => undefined);
  }
}

export async function driveAoConsole(page: ConsolePage, slug: string, ops: readonly AoConsoleOp[]): Promise<AoConsoleOpResult[]> {
  const out: AoConsoleOpResult[] = [];
  for (const op of ops) out.push(await driveAoConsoleOp(page, slug, op));
  return out;
}
