// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GATE-RUN: DP-1 for the GUI (COST-GATE-SPEC.md §3.4). The same file and rules as the CLI's
 * `stamper cost-ack` (giveDp1), so CLI and GUI plans stay equal (V72).
 *  - GET  /api/cost-gate/items?tenant=<slug>  every recurring catalogue entry, unticked unless a
 *    current DP-1 exists, with its estimate a month, basis, price date and standard alternative.
 *  - POST /api/cost-gate/ack  { tenant, entryId, typed, operator, noOtherMeans? }  `typed` must be
 *    the entry id; records cost-acks.json and a `dp: 1` cost-gate evidence record.
 */
import { Router, Request, Response } from 'express';
import { tenantBaseDir } from '../../core/EvidenceReadinessAnalyzer.js';
import { loadCostGateReference, readCostAcks, currentAckFor, CostGateError } from '../../core/CostGate.js';
import { dp1Summary, giveDp1 } from '../../cli/costAckCommand.js';

const SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export function createCostAckRouter(): Router {
  const router = Router();

  router.get('/api/cost-gate/items', (req: Request, res: Response) => {
    const tenant = String(req.query.tenant ?? '');
    if (!SLUG_RE.test(tenant)) return res.status(400).json({ error: 'tenant slug is required' });
    try {
      const ref = loadCostGateReference();
      const acks = readCostAcks(tenantBaseDir(tenant));
      const items = ref.catalogue.items
        .filter(i => i.cost_gate.recurring && !i.retired)
        .map(i => {
          const s = dp1Summary(i.item_id, ref);
          const ack = currentAckFor(i.item_id, acks, ref);
          return 'refused' in s
            ? { entry_id: i.item_id, label: i.label, kind: i.kind, acked: false, unavailable: s.refused }
            : { ...s, kind: i.kind, acked: !!ack, ...(ack ? { acked_at: ack.acked_at, operator: ack.operator } : {}) };
        });
      return res.json({ tenant, price_date: ref.estimates.price_date, items });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/api/cost-gate/ack', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { tenant?: string; entryId?: string; typed?: string; operator?: string; noOtherMeans?: string };
    if (!body.tenant || !body.entryId) return res.status(400).json({ error: 'tenant and entryId are required' });
    try {
      const { ack, evidencePath, summary } = giveDp1({
        tenant: body.tenant,
        entryId: body.entryId,
        typed: String(body.typed ?? ''),
        operator: String(body.operator ?? ''),
        ...(body.noOtherMeans ? { noOtherMeans: body.noOtherMeans } : {}),
      });
      return res.json({ ok: true, ack, evidencePath, estimate: summary.estimate, price_date: summary.price_date });
    } catch (err) {
      const status = err instanceof CostGateError ? 400 : 500;
      return res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
