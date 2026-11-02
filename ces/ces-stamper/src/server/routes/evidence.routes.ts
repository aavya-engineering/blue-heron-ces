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
import * as fs from 'fs';
import { CommandRegistry } from '../../registry/CommandRegistry.js';
import { CommandEntry } from '../../registry/command-registry.types.js';
import { evidenceFileForEntry, evidenceDirForTenant } from '../../core/EvidenceReadinessAnalyzer.js';
import { resolveSharedDataPath } from '../../core/sharedData.js';

export function createEvidenceRouter(
  getCachedMergedRegistry: () => CommandRegistry | null
): Router {
  const router = Router();

  // GET /api/evidence-scan — scan evidence directory against all 110 CMMC controls
  router.get('/api/evidence-scan', (req: Request, res: Response) => {
    try {
      const tenant = req.query['tenant'] as string | undefined;
      if (!tenant) {
        res.status(400).json({ error: 'tenant query param required' });
        return;
      }

      // Evidence directory
      const evidenceDir = evidenceDirForTenant(tenant || 'dev');

      // Use cached merged registry (loaded at server startup)
      const mergedRegistry = getCachedMergedRegistry();

      // Load CMMC controls reference (FX2-ST1: canonical ces-shared copy)
      const cmmcPath = resolveSharedDataPath('cmmc-l2-controls.reference.json');
      const cmmcRef = JSON.parse(fs.readFileSync(cmmcPath, 'utf-8'));

      let totalEntriesCount = 0;
      let entriesWithEvidenceCount = 0;
      let controlsWithEvidenceCount = 0;

      const families = (cmmcRef.families as any[]).map((fam: any) => {
        const familyControls = (cmmcRef.controls as any[]).filter((c: any) => c.family === fam.abbreviation);
        let familyControlsWithEvidence = 0;

        const controls = familyControls.map((ctrl: any) => {
          if (!mergedRegistry) {
            res.status(500).json({ error: 'Registry not loaded' });
            return;
          }
          const entries = mergedRegistry.lookupByControl(ctrl.control_id);
          let controlHasEvidence = false;
          let allEntriesHaveEvidence = entries.length > 0;

          const entryDetails = entries.map((entry: CommandEntry) => {
            totalEntriesCount++;
            const relPath = evidenceFileForEntry(entry.entry_id, entry.label);
            const txtPath = path.join(evidenceDir, relPath);
            const jsonPath = txtPath.replace(/\.txt$/, '.json');
            const actualPath = fs.existsSync(txtPath) ? txtPath : (fs.existsSync(jsonPath) ? jsonPath : null);
            const exists = actualPath !== null;
            let fileInfo: { sizeBytes: number; modifiedAt: string; ageHours: number } | null = null;

            if (exists) {
              try {
                const stat = fs.statSync(actualPath!);
                const ageMs = Date.now() - stat.mtime.getTime();
                fileInfo = {
                  sizeBytes: stat.size,
                  modifiedAt: stat.mtime.toISOString(),
                  ageHours: Math.round(ageMs / 3600000 * 10) / 10,
                };
              } catch { /* stat failed */ }
              entriesWithEvidenceCount++;
              controlHasEvidence = true;
            } else {
              allEntriesHaveEvidence = false;
            }

            return {
              entryId: entry.entry_id,
              label: entry.label,
              engine: entry.engine,
              evidenceFile: relPath,
              evidenceExists: exists,
              fileInfo,
            };
          });

          // Check for control-level evidence (excluded/non-stack controls)
          if (!controlHasEvidence) {
            const controlEvidPath = path.join(evidenceDir, `cmmc_controls/${ctrl.control_id.toLowerCase()}.json`);
            if (fs.existsSync(controlEvidPath)) {
              controlHasEvidence = true;
            }
          }

          if (controlHasEvidence) {
            controlsWithEvidenceCount++;
            familyControlsWithEvidence++;
          }

          return {
            controlId: ctrl.control_id,
            practice: ctrl.practice.split('\n')[0],
            cmmc_level: ctrl.cmmc_level,
            hasEvidence: controlHasEvidence,
            allCovered: allEntriesHaveEvidence && entries.length > 0,
            entries: entryDetails,
          };
        });

        return {
          abbreviation: fam.abbreviation,
          name: fam.name,
          controlCount: familyControls.length,
          controlsWithEvidence: familyControlsWithEvidence,
          controls,
        };
      });

      const totalControls = cmmcRef.total_controls;
      const coveragePct = totalControls > 0 ? Math.round((controlsWithEvidenceCount / totalControls) * 100) : 0;

      res.json({
        summary: {
          totalControls,
          controlsWithEvidence: controlsWithEvidenceCount,
          coveragePct,
          totalEntries: totalEntriesCount,
          entriesWithEvidence: entriesWithEvidenceCount,
        },
        families,
        evidenceDir,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/evidence-content — return raw content of a single evidence file
  router.get('/api/evidence-content', (req: Request, res: Response) => {
    try {
      const tenant = req.query['tenant'] as string | undefined;
      const entryId = req.query['entryId'] as string | undefined;
      if (!tenant || !entryId) {
        res.status(400).json({ error: 'tenant and entryId query params required' });
        return;
      }

      const evidenceDir = evidenceDirForTenant(tenant || 'dev');

      const relPath = evidenceFileForEntry(entryId);
      const fullPath = path.resolve(evidenceDir, relPath);

      // Security: ensure resolved path stays within evidence directory
      const resolvedEvDir = path.resolve(evidenceDir);
      if (!fullPath.startsWith(resolvedEvDir)) {
        res.status(403).json({ error: 'Path traversal not allowed' });
        return;
      }

      // Determine which files exist (.txt and/or .json sibling)
      const jsonSibling = fullPath.replace(/\.txt$/, '.json');
      const txtExists = fs.existsSync(fullPath);
      const jsonExists = fullPath.endsWith('.txt') && fs.existsSync(jsonSibling);

      if (!txtExists && !jsonExists) {
        res.status(404).json({ error: `Evidence file not found: ${relPath}` });
        return;
      }

      // Read primary content (prefer .txt for raw output display)
      const primaryPath = txtExists ? fullPath : jsonSibling;
      const content = fs.readFileSync(primaryPath, 'utf-8');
      const stat = fs.statSync(primaryPath);
      const format = req.query['format'] as string | undefined;
      let isJson = false;
      let parsedEvidence: any = null;

      // Try parsing StructuredEvidence from .json sibling (has outcome, verdict, metadata)
      if (jsonExists) {
        try {
          parsedEvidence = JSON.parse(fs.readFileSync(jsonSibling, 'utf-8'));
          isJson = true;
        } catch { /* JSON parse failed */ }
      } else if (primaryPath.endsWith('.json')) {
        // Primary IS the .json file
        try {
          parsedEvidence = JSON.parse(content);
          isJson = true;
        } catch { /* JSON parse failed — treat as plain text */ }
      }

      // Return raw if requested
      if (format === 'raw') {
        res.json({
          entryId,
          file: relPath,
          fullPath: primaryPath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          isJson,
          content,
        });
        return;
      }

      // Return parsed or raw depending on format
      res.json({
        entryId,
        file: relPath,
        fullPath: primaryPath,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        isJson,
        content,
        ...(parsedEvidence ? { structured: parsedEvidence } : {})
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
