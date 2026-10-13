// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { Router } from 'express';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import { createLifecycleService, PartyLifecycleState } from '../services/lifecycleService.js';
import { withTenant } from '../lib/prisma.js';

// Lifecycle-transition actions (map URL slug → PartyLifecycleState)
const TRANSITION_ACTIONS: Record<string, PartyLifecycleState> = {
  'disposition-ready': 'ready',
  'disposition-validate': 'validate',
  'convert-to-enclave': 'convert_to_enclave',
  'schedule-reassessment': 'reassessment_due',
};

const ALL_ACTIONS = new Set([
  'send-nudge-now',
  'mark-abandoned',
  'disposition-ready',
  'disposition-validate',
  'convert-to-enclave',
  'schedule-reassessment',
  'opt-out',
]);

/**
 * Mount at: app.use('/api/parties/:id/actions', createActionsRouter(db))
 * Router uses mergeParams: true to inherit :id from parent route.
 * Handles POST /:action for all 7 party actions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createActionsRouter(db: any) {
  const router = Router({ mergeParams: true });

  router.post(
    '/:action',
    bearerAuth,
    requireRole('prime', 'bhd_operator'),
    async (req, res, next) => {
      try {
        const partyId = req.params.id;
        const action = req.params.action;

        if (!ALL_ACTIONS.has(action)) {
          res.status(400).json({ error: `Unknown action: ${action}` });
          return;
        }

        // Lifecycle-transition actions
        if (TRANSITION_ACTIONS[action]) {
          const to = TRANSITION_ACTIONS[action];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const party = await withTenant(req.user!.tenant_id, (tx: any) =>
            createLifecycleService(tx).transition(partyId, to, req.user!.sub)
          , db);
          res.json({ party, action });
          return;
        }

        if (action === 'mark-abandoned') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const disposition = await withTenant(req.user!.tenant_id, (tx: any) =>
            createLifecycleService(tx).markAbandoned(
              partyId,
              req.user!.sub,
              req.body?.notes as string | undefined
            )
          , db);
          res.json({ disposition, action });
          return;
        }

        if (action === 'opt-out') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const disposition = await withTenant(req.user!.tenant_id, (tx: any) =>
            createLifecycleService(tx).optOut(
              partyId,
              req.user!.sub,
              req.body?.notes as string | undefined
            )
          , db);
          res.json({ disposition, action });
          return;
        }

        if (action === 'send-nudge-now') {
          // Nudge placeholder: write NudgeEvent(nudge_type=escalation, channel=manual).
          // Full nudge evaluation is S2 scope.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nudge = await withTenant(req.user!.tenant_id, async (tx: any) => {
            const party = await tx.party.findUnique({ where: { id: partyId } });
            if (!party) return null;
            return tx.nudgeEvent.create({
              data: {
                party_id: partyId,
                engagement_id: party.engagement_id,
                nudge_type: 'escalation',
                channel: 'manual',
                payload: req.body?.payload ?? null,
              },
            });
          }, db);
          if (!nudge) {
            res.status(404).json({ error: 'Party not found' });
            return;
          }
          res.json({ nudge, action });
          return;
        }

        // Should never reach here given the ALL_ACTIONS guard above
        res.status(400).json({ error: 'Unhandled action' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('Illegal lifecycle transition') ||
          msg.includes('Cannot abandon') ||
          msg.includes('Cannot opt out') ||
          msg.includes('already')
        ) {
          res.status(422).json({ error: msg });
          return;
        }
        next(err);
      }
    }
  );

  return router;
}
