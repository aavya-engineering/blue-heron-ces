// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// delivery.ts — GP-MUSTER-2 M2: two routers, two trust models.
//
// createDeliveryRouter — the OPERATOR lane (/api/delivery): JWT bearerAuth +
// requireRole('bhd_operator'), withTenant RLS. Registers artifacts, issues and
// revokes grants, runs purges, reads the audit trail.
//
// createPortalRouter — the GRANTEE lane (/portal): no platform account. The
// bearer credential is the grant token itself (256-bit capability, stored only
// as sha256). Download-only by construction: the router defines exactly two
// GETs and no mutating route. Grant resolution runs on the raw client (the
// grants table carries no tenant RLS policy — see migration 005); everything
// after resolution runs under withTenant(grant.tenant_id).
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import { withTenant } from '../lib/prisma.js';
import { createDeliveryService, type DeliveryGrantRow } from '../services/deliveryService.js';

const registerArtifactSchema = z.object({
  engagement_id: z.string().min(1),
  kind: z.enum(['readiness_result', 'readiness_report', 'capture']),
  filename: z.string().min(1),
  content_base64: z.string().min(1),
});

const issueGrantSchema = z.object({
  engagement_id: z.string().min(1),
  grantee_name: z.string().min(1),
  grantee_email: z.string().email(),
  expires_in_days: z.number().int().min(1).max(30).optional(),
});

const purgeEngagementSchema = z.object({
  engagement_id: z.string().min(1),
  reason: z.string().min(1),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDeliveryRouter(db: any) {
  const router = Router();

  // POST /api/delivery/artifacts — stage an artifact for delivery.
  router.post('/artifacts', bearerAuth, requireRole('bhd_operator'), async (req, res, next) => {
    try {
      const parsed = registerArtifactSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' });
        return;
      }
      const { engagement_id, kind, filename, content_base64 } = parsed.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await withTenant(req.user!.tenant_id, (tx: any) =>
        createDeliveryService(tx).registerArtifact({
          tenant_id: req.user!.tenant_id,
          engagement_id,
          kind,
          filename,
          content: Buffer.from(content_base64, 'base64'),
          actor: req.user!.sub,
        })
      , db);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/delivery/grants — issue a named grant; token visible ONCE.
  router.post('/grants', bearerAuth, requireRole('bhd_operator'), async (req, res, next) => {
    try {
      const parsed = issueGrantSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await withTenant(req.user!.tenant_id, (tx: any) =>
        createDeliveryService(tx).issueGrant({
          tenant_id: req.user!.tenant_id,
          ...parsed.data,
          issued_by: req.user!.sub,
        })
      , db);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/delivery/grants/:id/revoke
  router.post(
    '/grants/:id/revoke',
    bearerAuth,
    requireRole('bhd_operator'),
    async (req, res, next) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const revoked = await withTenant(req.user!.tenant_id, (tx: any) =>
          createDeliveryService(tx).revokeGrant({
            tenant_id: req.user!.tenant_id,
            grant_id: req.params.id,
            actor: req.user!.sub,
          })
        , db);
        if (!revoked) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        res.json({ revoked_at: revoked.revoked_at });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/delivery/purge-expired — retention sweep (90 days, policy rule 6).
  router.post('/purge-expired', bearerAuth, requireRole('bhd_operator'), async (req, res, next) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await withTenant(req.user!.tenant_id, (tx: any) =>
        createDeliveryService(tx).purgeExpired({
          tenant_id: req.user!.tenant_id,
          actor: req.user!.sub,
        })
      , db);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/delivery/purge — close-out purge with recorded reason (rule 7).
  router.post('/purge', bearerAuth, requireRole('bhd_operator'), async (req, res, next) => {
    try {
      const parsed = purgeEngagementSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await withTenant(req.user!.tenant_id, (tx: any) =>
        createDeliveryService(tx).purgeEngagement({
          tenant_id: req.user!.tenant_id,
          ...parsed.data,
          actor: req.user!.sub,
        })
      , db);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/delivery/audit?engagement_id= — the trail (never purged).
  router.get('/audit', bearerAuth, requireRole('bhd_operator'), async (req, res, next) => {
    try {
      const engagementId = req.query.engagement_id;
      if (typeof engagementId !== 'string' || engagementId.length === 0) {
        res.status(400).json({ error: 'engagement_id query parameter is required' });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = await withTenant(req.user!.tenant_id, (tx: any) =>
        createDeliveryService(tx).auditTrail({
          tenant_id: req.user!.tenant_id,
          engagement_id: engagementId,
        })
      , db);
      res.json(entries);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Attach the resolved grant to the request, or 401. Expired/revoked
 * presentations are audited under their engagement (policy rule 5); unknown
 * tokens have no attributable engagement and are simply refused. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grantAuth(db: any) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }
    try {
      const resolution = await createDeliveryService(db).resolveGrant(header.slice(7));
      if (!resolution.ok) {
        if (resolution.grant) {
          const grant = resolution.grant;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await withTenant(grant.tenant_id, (tx: any) =>
            createDeliveryService(tx).auditDeniedGrant(grant, resolution.reason)
          , db);
        }
        res.status(401).json({ error: 'Invalid or expired delivery grant' });
        return;
      }
      (req as Request & { grant: DeliveryGrantRow }).grant = resolution.grant;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPortalRouter(db: any) {
  const router = Router();
  const auth = grantAuth(db);

  // GET /portal/artifacts — this engagement's deliverables, metadata only.
  router.get('/artifacts', auth, async (req, res, next) => {
    try {
      const grant = (req as Request & { grant: DeliveryGrantRow }).grant;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const artifacts = await withTenant(grant.tenant_id, (tx: any) =>
        createDeliveryService(tx).listArtifacts(grant)
      , db);
      res.json(artifacts);
    } catch (err) {
      next(err);
    }
  });

  // GET /portal/artifacts/:id — the bytes. Every outcome audited.
  router.get('/artifacts/:id', auth, async (req, res, next) => {
    try {
      const grant = (req as Request & { grant: DeliveryGrantRow }).grant;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await withTenant(grant.tenant_id, (tx: any) =>
        createDeliveryService(tx).pullArtifact(grant, req.params.id)
      , db);
      if (!result.ok) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.content);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
