// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// recipes.ts — /recipes routes: GET /recipes, POST /recipes/ingest.
//
// Wiring: see muster-api/WIRING_T1.md — do NOT edit app.ts directly.
//
// GET  /api/recipes             — list recipes from INDEX.json (all authenticated roles)
// POST /api/recipes/ingest      — verify + ingest recipe output → ConfigFacts
//                                 Roles: prime | bhd_operator | sub
// GET  /api/recipes/collector-kit          — W4-MU2 (MU-19): the signed read-only
//                                 collector script (text/plain download) generated
//                                 from Stamper's registry get-entries.
// GET  /api/recipes/collector-kit/manifest — its signing manifest (sha256).
//                                 Roles: prime | bhd_operator
//
// DONE-WHEN #8 gate:
//   POST /recipes/ingest requires header 'x-concierge-session: true' UNLESS
//   env RECIPES_SELF_SERVE=true (default: absent = OFF). This gate stays OFF
//   until concierge-assisted validation results are recorded in the repo.
//   See docs/recipes-concierge-validation.md (to be created on validation).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import { RECIPES_DIR, type RecipeManifest } from '../lib/recipeSigning.js';
import { ingest, SignatureError } from '../services/recipeIngestService.js';
import { buildKitManifest, generateCollectorScript } from '../services/collectorKitService.js';
import { loadRegistryGetEntries } from '../services/discoveryWiring.js';
import type { RegistryGetEntry } from '../services/discoveryService.js';

const ingestBodySchema = z.object({
  recipe_name: z.string().min(1),
  output: z.unknown(),
});

function loadIndex(): Array<{ name: string; version: string; manifest_sha256: string }> {
  const indexPath = join(RECIPES_DIR, 'INDEX.json');
  return JSON.parse(readFileSync(indexPath, 'utf-8')) as Array<{
    name: string;
    version: string;
    manifest_sha256: string;
  }>;
}

function loadManifest(recipeName: string): RecipeManifest {
  const manifestPath = join(RECIPES_DIR, recipeName, 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as RecipeManifest;
}

/**
 * createRecipesRouter — router factory.
 * Exported for tests; default export is the production instance.
 */
export function createRecipesRouter(
  loadEntries: () => RegistryGetEntry[] = loadRegistryGetEntries
): Router {
  const router = Router();

  // W4-MU2 (MU-19): the collector kit's entry point. Generated on request
  // from the live Stamper registry (never a checked-in script), so the kit an
  // operator hands a customer always matches the registry discovery walks.
  function kit(): { script: string; manifest: ReturnType<typeof buildKitManifest> } | null {
    const entries = loadEntries();
    if (entries.length === 0) return null;
    const script = generateCollectorScript(entries);
    return { script, manifest: buildKitManifest(script) };
  }

  router.get(
    '/collector-kit',
    bearerAuth,
    requireRole('prime', 'bhd_operator'),
    (_req, res, next) => {
      try {
        const k = kit();
        if (!k) {
          res.status(503).json({ error: 'No Stamper registry get-entries available to build the kit' });
          return;
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="muster-collector-kit.ps1"');
        res.setHeader('X-Collector-Kit-Sha256', k.manifest.sha256);
        res.send(k.script);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    '/collector-kit/manifest',
    bearerAuth,
    requireRole('prime', 'bhd_operator'),
    (_req, res, next) => {
      try {
        const k = kit();
        if (!k) {
          res.status(503).json({ error: 'No Stamper registry get-entries available to build the kit' });
          return;
        }
        res.json(k.manifest);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/recipes — list all known recipes from INDEX.json.
  // Any authenticated role may read the index.
  router.get('/', bearerAuth, (_req, res, next) => {
    try {
      const index = loadIndex();
      res.json({ recipes: index });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/recipes/ingest {recipe_name, output}
  // Roles: prime | bhd_operator | sub.
  //
  // DONE-WHEN #8 gate:
  //   Requires header 'x-concierge-session: true' unless RECIPES_SELF_SERVE=true.
  //   This keeps self-serve recipe execution behind concierge-assisted validation.
  router.post(
    '/ingest',
    bearerAuth,
    requireRole('prime', 'bhd_operator', 'sub'),
    (req, res, next) => {
      try {
        // DONE-WHEN #8 feature-flag check
        const selfServe = process.env.RECIPES_SELF_SERVE === 'true';
        const hasConciergeHeader = req.headers['x-concierge-session'] === 'true';

        if (!selfServe && !hasConciergeHeader) {
          res.status(403).json({
            error: 'Concierge session required',
            detail:
              'Self-serve recipe execution is disabled (DONE-WHEN #8). ' +
              "Provide 'x-concierge-session: true' header for concierge-assisted sessions, " +
              'or set RECIPES_SELF_SERVE=true after concierge validation is recorded in docs/.',
          });
          return;
        }

        // Validate request body
        const parseResult = ingestBodySchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(400).json({ error: parseResult.error.flatten() });
          return;
        }

        const { recipe_name, output } = parseResult.data;

        // Load manifest from disk (authoritative source)
        let manifest: RecipeManifest;
        try {
          manifest = loadManifest(recipe_name);
        } catch {
          res.status(404).json({ error: `Recipe not found: ${recipe_name}` });
          return;
        }

        // Ingest: verifies signature + maps output → facts
        const facts = ingest({ recipeName: recipe_name, output, manifest });
        res.json({ facts });
      } catch (err) {
        if (err instanceof SignatureError) {
          res.status(400).json({ error: 'signature_invalid' });
          return;
        }
        next(err);
      }
    }
  );

  return router;
}

// Default export: production router instance.
export default createRecipesRouter();
