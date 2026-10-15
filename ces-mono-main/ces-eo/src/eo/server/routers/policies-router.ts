// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import express, { type Request, type Response } from 'express';
import type { EoConfig } from '../../config/EoConfig.js';
import { PolicyStore } from '../../policies/PolicyStore.js';
import type { PolicyDocument } from 'ces-shared/types/policy';
import {
  validateRequest,
  PolicyImportRequestSchema,
} from '../validation-schemas.js';
import {
  sendError,
  requireTenantScope,
  loadTimeline,
  saveTimeline,
  type TimelineEvent,
} from '../eo-router-utils.js';

export interface PoliciesRouterDeps {
  config: EoConfig;
  stamperRoot: string;
  policyStore: PolicyStore;
}

export function createPoliciesRouter(deps: PoliciesRouterDeps): express.Router {
  const { config, stamperRoot, policyStore } = deps;
  const router = express.Router();

  // ── Policy Import Endpoints ──

  // POST /api/policies/import — import Planner policy documents
  // Auth: guarded by the shared bearer-auth middleware (loopback-trusted / network-requires-token),
  // wired at app.use above (G-ENG-4). Set CES_EO_AUTH_TOKEN to require a token from the network.
  router.post('/api/policies/import', (req: Request, res: Response) => {
    const { tenantSlug: reqTenantSlug, policies } = req.body as {
      tenantSlug?: string;
      policies?: unknown[];
    };

    // FX-EO8: body.tenantSlug is required (400 missing / 404 unknown); no server-default fallback.
    const scope = requireTenantScope(req, res, stamperRoot, reqTenantSlug);
    if (!scope) return;
    const slug = scope.slug;

    if (!policies || !Array.isArray(policies) || policies.length === 0) {
      sendError(res, 400, 'policies array is required and must not be empty');
      return;
    }

    // Validate policy documents with Zod schema
    const validation = validateRequest(PolicyImportRequestSchema, policies);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.message);
      return;
    }

    try {
      const writtenPaths = policyStore.save(slug, validation.data as unknown as PolicyDocument[]);

      // Emit timeline event for policy import
      const timeline = loadTimeline(config.storageRoot, slug);
      const event: TimelineEvent = {
        eventId: `policy-import-${Date.now()}`,
        type: 'custom',
        title: `Imported ${validation.data.length} policies`,
        date: new Date().toISOString(),
        detail: 'Source: Planner (cse-fe-v2)',
      };
      timeline.events.push(event);
      saveTimeline(config.storageRoot, timeline);

      res.status(201).json({
        imported: validation.data.length,
        tenantSlug: slug,
        files: writtenPaths,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg);
    }
  });

  // GET /api/policies — list loaded policies for a tenant
  router.get('/api/policies', (req: Request, res: Response) => {
    const scope = requireTenantScope(req, res, stamperRoot); // FX-EO8: no default-tenant fallback
    if (!scope) return;
    const slug = scope.slug;

    try {
      const policies = policyStore.load(slug);
      const result = policies.map(p => ({
        template_id: p.template_id,
        title: p.title,
        markdown: p.markdown,
        completeness: p.completeness,
        domain: p.domain,
        nist_controls: p.nist_controls,
        loadedAt: new Date().toISOString(),
      }));
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg);
    }
  });

  return router;
}
