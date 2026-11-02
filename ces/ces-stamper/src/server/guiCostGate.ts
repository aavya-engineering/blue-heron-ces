// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-16: DP-2 in the Stamper GUI (COST-GATE-SPEC.md §3.5, "GUI"). DP-2 = the operator's
 * run-time typed confirmation of a recurring cost; DP-1 = the plan-time opt-in (§3.4).
 *
 * PowerShellAdapter asks DP-2 through a CostGateRuntime (CostGateDp2.ts). The CLI sets a terminal
 * runtime; this module is the GUI's: its `promptDp2` parks the prompt as a pending cost approval
 * (gate key `cost::<entry id>`, also registered in the shared approvalGate map so /api/abort
 * refuses it), and POST /api/approve with `gateType: 'cost'` answers it with the typed text.
 * The typed rule and the evidence record stay CostGateDp2.runDp2's: the text must be
 * `<entry id> <monthly cost>` exactly as shown; anything else refuses.
 *
 * FD-1 (FINISH-PLAN.md §5, founder 10-31): a scripted (browser-automation) confirmation is
 * accepted only on a `kind: 'sim'` tenant; live tenants keep a human operator. The SPA sends
 * `automated: navigator.webdriver === true`.
 *
 * Fail-closed: an unanswered prompt is refused after a timeout (CES_COST_DP2_TIMEOUT_MS, default
 * 10 minutes), so no run hangs and no cost starts without an answer.
 */
import type { CostGateRuntime, Dp2Answer, Dp2Prompt } from '../adapters/CostGateDp2.js';

export type ApprovalDecision = 'approve' | 'skip' | 'accomplish';
export type ApprovalGateMap = Map<string, (decision: ApprovalDecision) => void>;

export const COST_GATE_KEY_PREFIX = 'cost::';
export const DEFAULT_DP2_TIMEOUT_MS = 10 * 60 * 1000;

export function costGateKey(entryId: string): string {
  return `${COST_GATE_KEY_PREFIX}${entryId}`;
}

/** What GET /api/cost-gate/pending shows the execute screen's DP-2 dialog. */
export interface PendingCostPrompt extends Dp2Prompt {
  gateKey: string;
  requestedAt: string;
}

/** The body of POST /api/approve for a cost gate. */
export interface CostApproveBody {
  entryId?: string;
  typed?: string;
  operator?: string;
  tenant?: string;
  decision?: string;
  automated?: boolean;
}

export interface CostApproveResult {
  status: number;
  body: { ok: boolean; error?: string; outcome?: 'accepted' | 'refused'; gateKey?: string };
}

interface Pending {
  prompt: PendingCostPrompt;
  finish: (answer: Dp2Answer | undefined) => void;
}

const SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export interface GuiCostGate {
  /** The runtime PowerShellAdapter uses for GUI runs; its mode follows the current run (manual outside a run). */
  runtime: CostGateRuntime;
  pending(): PendingCostPrompt[];
  answer(body: CostApproveBody): Promise<CostApproveResult>;
  /**
   * GET /api/execute calls this once the run's mode and tenant are parsed: an `auto` run refuses
   * DP-2 (evaluateDp2), and the FD-1 sim check judges the run's tenant, not the one the client sends.
   * Returns the restore function for the route's `finally`.
   */
  beginRun(run: { mode: 'manual' | 'auto'; tenant?: string }): () => void;
}

export function createGuiCostGate(opts: {
  approvalGate: ApprovalGateMap;
  lookupTenantKind: (slug: string) => Promise<string | undefined>;
  timeoutMs?: number;
  now?: () => Date;
  log?: (line: string) => void;
}): GuiCostGate {
  const waiting = new Map<string, Pending>();
  let currentRun: { mode: 'manual' | 'auto'; tenant?: string } | undefined;
  const envTimeout = Number(process.env['CES_COST_DP2_TIMEOUT_MS']);
  const timeoutMs = opts.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_DP2_TIMEOUT_MS);
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((line: string) => console.log(line));

  const promptDp2 = (prompt: Dp2Prompt): Promise<Dp2Answer | undefined> =>
    new Promise<Dp2Answer | undefined>((resolve) => {
      const gateKey = costGateKey(prompt.entryId);
      // A second prompt for the same entry refuses the first (one open DP-2 per entry).
      waiting.get(gateKey)?.finish(undefined);
      let done = false;
      const finish = (answer: Dp2Answer | undefined) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (waiting.get(gateKey)?.finish === finish) waiting.delete(gateKey);
        if (opts.approvalGate.get(gateKey) === onGate) opts.approvalGate.delete(gateKey);
        resolve(answer);
      };
      // /api/abort resolves every approvalGate entry with 'skip': that refuses the cost.
      const onGate = (_decision: ApprovalDecision) => finish(undefined);
      const timer = setTimeout(() => {
        log(`[CostGate] DP-2 for ${prompt.entryId} not answered in ${timeoutMs} ms: refused`);
        finish(undefined);
      }, timeoutMs);
      if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref();
      waiting.set(gateKey, { prompt: { ...prompt, gateKey, requestedAt: now().toISOString() }, finish });
      opts.approvalGate.set(gateKey, onGate);
      log(`[CostGate] DP-2 pending for ${prompt.entryId}: about ${prompt.estimate} a month (price date ${prompt.priceDate})`);
    });

  async function answer(body: CostApproveBody): Promise<CostApproveResult> {
    const entryId = typeof body.entryId === 'string' ? body.entryId : '';
    if (!entryId) return { status: 400, body: { ok: false, error: 'entryId is required for a cost gate' } };
    const gateKey = costGateKey(entryId);
    const p = waiting.get(gateKey);
    if (!p) return { status: 404, body: { ok: false, error: `No pending approval for: ${gateKey}` } };

    if (body.decision === 'skip') {
      p.finish(undefined);
      return { status: 200, body: { ok: true, outcome: 'refused', gateKey } };
    }
    if (typeof body.typed !== 'string' || body.typed.trim() === '') {
      return { status: 400, body: { ok: false, error: `typed is required: type "${p.prompt.expected}"` } };
    }
    const operator = typeof body.operator === 'string' ? body.operator.trim() : '';
    if (!operator) return { status: 400, body: { ok: false, error: 'operator is required for a cost gate' } };

    if (body.automated === true) {
      // The run's tenant (server side) decides; the body's tenant is used only outside a run.
      const slug = currentRun ? (currentRun.tenant ?? '') : (typeof body.tenant === 'string' ? body.tenant : '');
      const kind = SLUG_RE.test(slug) ? await opts.lookupTenantKind(slug) : undefined;
      if (kind !== 'sim') {
        // FD-1: a scripted DP-2 never starts a cost on a non-sim tenant. Refuse and record.
        p.finish({ typed: '', operator });
        log(`[CostGate] DP-2 for ${entryId} refused: scripted confirmation on tenant "${slug || '(none)'}" (kind ${kind ?? 'no record'})`);
        return {
          status: 403,
          body: { ok: false, outcome: 'refused', gateKey, error: `DP-2 refused: a scripted confirmation is accepted only on a kind:'sim' tenant (tenant "${slug || '(none)'}" is ${kind ?? 'not registered'})` },
        };
      }
    }

    // runDp2 checks the typed text against `<entry id> <monthly cost>` and writes the evidence.
    const accepted = body.typed.trim().replace(/\s+/g, ' ') === p.prompt.expected;
    p.finish({ typed: body.typed, operator });
    return accepted
      ? { status: 200, body: { ok: true, outcome: 'accepted', gateKey } }
      : { status: 200, body: { ok: true, outcome: 'refused', gateKey, error: `typed text does not match "${p.prompt.expected}"; the cost was refused` } };
  }

  const runtime: CostGateRuntime = {
    get mode() { return currentRun?.mode ?? 'manual'; },
    interactive: true,
    promptDp2,
  };

  function beginRun(run: { mode: 'manual' | 'auto'; tenant?: string }): () => void {
    const previous = currentRun;
    currentRun = { ...run };
    return () => { currentRun = previous; };
  }

  return {
    runtime,
    pending: () => [...waiting.values()].map(w => w.prompt),
    answer,
    beginRun,
  };
}
