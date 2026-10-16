// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router, Request, Response } from 'express';
import * as path from 'path';
import { CommandRegistry } from '../../registry/CommandRegistry.js';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { GapAnalyzer } from '../../core/GapAnalyzer.js';
import { DiscoveryResult } from '../../types/schema.types.js';
import { tenantPlansDir } from '../../core/EvidenceReadinessAnalyzer.js';

/**
 * Create gaps router for gap analysis and remediation planning.
 */
export function createGapsRouter(
  getCachedRegistries: () => CommandRegistry[],
  _saveAssessState: (slug: string, data: object) => void,
  loadAssessState: (slug: string) => Record<string, any> | null
): Router {
  const router = Router();

  /**
   * GET /api/compute-gaps?tenant=slug
   * Compute gap remediation plan from cached assess-state.json.
   * Fast computation endpoint (not SSE streaming).
   */
  router.get('/api/compute-gaps', (req: Request, res: Response) => {
    const tenantSlug = req.query.tenant as string;

    if (!tenantSlug) {
      return res.status(400).json({ error: 'Missing tenant parameter' });
    }

    try {
      // Load cached assess-state.json
      const assessState = loadAssessState(tenantSlug);
      if (!assessState) {
        return res.status(404).json({ error: 'No cached assess state found. Run assess first.' });
      }

      // Reconstruct discoveryResults Map from plain object
      const discoveryResultsObj = assessState.discoveryResults as Record<string, DiscoveryResult>;
      if (!discoveryResultsObj) {
        return res.status(400).json({ error: 'Assess state missing discoveryResults' });
      }
      const discoveryResults = new Map<string, DiscoveryResult>(Object.entries(discoveryResultsObj));

      // Get registries
      const registries = getCachedRegistries();
      if (registries.length === 0) {
        return res.status(500).json({ error: 'No registries loaded' });
      }

      // Extract infrastructure model from assess state (if available)
      const infrastructureModel = assessState.infrastructureModel || 'unknown';

      // Instantiate GapAnalyzer
      const analyzer = new GapAnalyzer(registries, discoveryResults, infrastructureModel);

      // Analyze gaps
      const gapPlan = analyzer.analyze(tenantSlug);

      // Persist to tenant plans directory
      const plansDir = tenantPlansDir(tenantSlug);
      const filename = `gap-remediation-${gapPlan.timestamp}.json`;
      const filepath = path.join(plansDir, filename);
      writeJsonArtifact(filepath, gapPlan);

      // Return JSON response
      return res.json({
        success: true,
        plan: gapPlan,
        saved_to: filepath,
      });
    } catch (error: any) {
      console.error('[gaps] Error computing gaps:', error);
      return res.status(500).json({ error: error.message || 'Failed to compute gaps' });
    }
  });

  return router;
}
