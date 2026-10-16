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
import { fileURLToPath } from 'node:url';
import { tenantPlansDir, tenantLogsDir } from '../../core/EvidenceReadinessAnalyzer.js';
import { getPlanDataRoot } from '../../config/paths.js';
import { getCesPipelineRoot } from 'ces-shared/storage/node';
import { listTenantRecordsWithPaths } from '../../tenant/stamperTenants.js';
import { getRegistryRoot } from 'ces-tenant';
import {
  DEV_MISSION_PLAN_PATH,
  DEV_MANIFEST_PATH,
  DEV_OUTPUT_PATH,
  FULL_REGISTRY_MISSION_PLAN_PATH,
  FULL_REGISTRY_MANIFEST_PATH,
  FULL_REGISTRY_OUTPUT_PATH
} from '../devFixtures.js';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { resolveSharedDataPath } from '../../core/sharedData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Check if `child` path is equal to or under `parent` path (handles Windows vs Unix separators). */
function isUnder(child: string, parent: string): boolean {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(resolvedParent + path.sep);
}

export function createUtilityRouter(): Router {
  const router = Router();

  // GET /api/browse — list JSON files for the file picker
  //   ?tenant=slug  — scans BOTH tenant plans dir AND workspace plan-data/
  //   ?pattern=prefix — filter to files matching prefix-*.json (e.g. "manual-mission-plan")
  //   ?dir=path — explicit directory override (skips dual-dir scan)
  router.get('/api/browse', (req: Request, res: Response) => {
    try {
      const dir = req.query['dir'] as string | undefined;
      const tenant = req.query['tenant'] as string | undefined;
      const pattern = req.query['pattern'] as string | undefined;

      // When pattern is supplied, filter to files matching `{pattern}[-_]*.json`; otherwise all .json
      // Muster uses _ separators (manual-mission-plan_slug_ts.json); legacy uses -
      const patternRegex = pattern ? new RegExp(`^${pattern}[-_].*\\.json$`) : null;

      // Collect directories to scan
      const dirsToScan: string[] = [];
      if (dir) {
        // Explicit dir — single directory mode
        dirsToScan.push(dir);
      } else {
        // Tenant mode: scan tenant plans dir (dev defaults to ./plan-data/dev/plans/)
        const tDir = tenantPlansDir(tenant || 'dev');
        if (fs.existsSync(tDir)) dirsToScan.push(tDir);
      }

      if (dirsToScan.length === 0 || dirsToScan.every(d => !fs.existsSync(d))) {
        res.status(404).json({ ok: false, error: 'No plan directories found' });
        return;
      }

      // Scan all dirs, de-dup by filename (prefer newest)
      const seen = new Map<string, { name: string; path: string; size: number; modified: string }>();
      for (const scanDir of dirsToScan) {
        if (!fs.existsSync(scanDir)) continue;
        for (const f of fs.readdirSync(scanDir)) {
          if (patternRegex ? !patternRegex.test(f) : !f.endsWith('.json')) continue;
          const fullPath = path.join(scanDir, f);
          const stat = fs.statSync(fullPath);
          const entry = { name: f, path: fullPath, size: stat.size, modified: stat.mtime.toISOString() };
          const existing = seen.get(f);
          if (!existing || entry.modified > existing.modified) {
            seen.set(f, entry);
          }
        }
      }

      const files = Array.from(seen.values())
        .sort((a, b) => b.modified.localeCompare(a.modified));

      res.json({ ok: true, dir: dirsToScan[0], files });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // DELETE /api/browse-cleanup — delete all but most recent file matching a pattern
  //   ?tenant=slug  — tenant slug for scoping to tenant plans dir
  //   ?pattern=prefix — file prefix like 'manual-mission-plan'
  router.delete('/api/browse-cleanup', (req: Request, res: Response) => {
    try {
      const tenant = req.query['tenant'] as string | undefined;
      const pattern = req.query['pattern'] as string | undefined;

      if (!pattern) {
        res.status(400).json({ ok: false, error: 'pattern query parameter is required' });
        return;
      }

      // Resolve scan directory (same logic as GET /api/browse)
      const scanDir = tenantPlansDir(tenant || 'dev');
      if (!fs.existsSync(scanDir)) {
        res.status(404).json({ ok: false, error: 'Plan directory not found' });
        return;
      }

      // Security: validate scanDir is under plan-data/
      const planDataDir = getPlanDataRoot();
      if (!isUnder(scanDir, planDataDir)) {
        res.status(403).json({ ok: false, error: 'Access denied — directory outside allowed scope' });
        return;
      }

      // Read directory, filter by pattern prefix, sort by mtime descending
      const patternRegex = new RegExp(`^${pattern}[-_].*\\.json$`);
      const files = fs.readdirSync(scanDir)
        .filter(f => patternRegex.test(f))
        .map(f => {
          const fullPath = path.join(scanDir, f);
          const stat = fs.statSync(fullPath);
          return { name: f, path: fullPath, mtime: stat.mtime.getTime() };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length <= 1) {
        res.json({ ok: true, deleted: 0, kept: files.length === 1 ? files[0].name : null, errors: [] });
        return;
      }

      // Keep newest (files[0]), delete the rest
      const kept = files[0].name;
      const toDelete = files.slice(1);
      const errors: string[] = [];
      let deleted = 0;

      for (const f of toDelete) {
        const targetPath = path.resolve(f.path);
        if (!isUnder(targetPath, planDataDir)) {
          errors.push(`Skipped ${f.name} — outside allowed directory`);
          continue;
        }
        try {
          fs.unlinkSync(targetPath);
          deleted++;
        } catch (e) {
          errors.push(`Failed to delete ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      res.json({ ok: true, deleted, kept, errors });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/browse-file — read a single file's contents (for tenant config load-from-file)
  router.get('/api/browse-file', (req: Request, res: Response) => {
    try {
      const filePath = req.query['path'] as string | undefined;
      if (!filePath) {
        res.status(400).json({ ok: false, error: 'path query parameter is required' });
        return;
      }
      // Only allow reading from the plan-data directory or the ces-tenant
      // registry root (tenant records live there post-G-TENANT-M1)
      const planDataDir = getPlanDataRoot();
      const resolved = path.resolve(filePath);
      if (!isUnder(resolved, planDataDir) && !isUnder(resolved, getRegistryRoot())) {
        res.status(403).json({ ok: false, error: 'Access denied — only tenant config files can be read' });
        return;
      }
      if (!fs.existsSync(resolved)) {
        res.status(404).json({ ok: false, error: 'File not found' });
        return;
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      res.json({ ok: true, path: resolved, content });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/tenants-browse — list tenant config files (ces-tenant registry records) for the file picker
  router.get('/api/tenants-browse', async (_req: Request, res: Response) => {
    try {
      const entries = await listTenantRecordsWithPaths();
      const files: { name: string; path: string; size: number; modified: string }[] = [];
      for (const { record, path: cfgPath } of entries) {
        if (!fs.existsSync(cfgPath)) continue;
        const stat = fs.statSync(cfgPath);
        files.push({
          name: `${record.tenantSlug}.json`,
          path: cfgPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
      files.sort((a, b) => b.modified.localeCompare(a.modified));

      res.json({ ok: true, dir: getRegistryRoot(), files });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/dev-paths — return fixture paths for the browser to auto-fill
  // Use ?full=true for full-registry fixtures (all 118 commands)
  router.get('/api/dev-paths', (req: Request, res: Response) => {
    const full = req.query['full'] === 'true';
    if (full) {
      res.json({
        missionPlan: FULL_REGISTRY_MISSION_PLAN_PATH,
        manifest: FULL_REGISTRY_MANIFEST_PATH,
        output: FULL_REGISTRY_OUTPUT_PATH
      });
    } else {
      res.json({
        missionPlan: DEV_MISSION_PLAN_PATH,
        manifest: DEV_MANIFEST_PATH,
        output: DEV_OUTPUT_PATH
      });
    }
  });

  // GET /api/plan-data-paths — scan plan directories and return latest executable plan + variables JSON
  //   Scans ./plan-data/<slug>/plans/ for the selected tenant (or dev).
  router.get('/api/plan-data-paths', (req: Request, res: Response) => {
    try {
      const tenant = req.query['tenant'] as string | undefined;
      const primaryDir = tenantPlansDir(tenant || 'dev');

      // Collect dirs to scan
      const dirsToScan: string[] = [];
      if (fs.existsSync(primaryDir)) dirsToScan.push(primaryDir);

      if (dirsToScan.length === 0) {
        res.status(404).json({ ok: false, error: `No plan directories found` });
        return;
      }

      // Helper: list files matching a pattern across all dirs
      const listAcrossDirs = (pattern: RegExp) => {
        const all: { name: string; path: string; modified: string }[] = [];
        for (const dir of dirsToScan) {
          for (const f of fs.readdirSync(dir)) {
            if (!pattern.test(f)) continue;
            const fullPath = path.join(dir, f);
            const stat = fs.statSync(fullPath);
            all.push({ name: f, path: fullPath, modified: stat.mtime.toISOString() });
          }
        }
        return all.sort((a, b) => b.modified.localeCompare(a.modified));
      };

      const executablePlans = listAcrossDirs(/^executable-plan-.*\.json$/);
      const variableFiles = listAcrossDirs(/^variables-.*\.json$/);

      const latestByPattern = (pattern: RegExp): string | null => {
        const matches = listAcrossDirs(pattern);
        return matches.length > 0 ? matches[0].path : null;
      };

      res.json({
        ok: true,
        dir: primaryDir,
        executablePlan: executablePlans.length > 0 ? executablePlans[0].path : null,
        variablesFile: variableFiles.length > 0 ? variableFiles[0].path : null,
        missionPlan: latestByPattern(/^manual-mission-plan[-_].*\.json$/),
        manifest: latestByPattern(/^tenant-manifest[-_].*\.json$/),
        infraManifest: latestByPattern(/^infra(?:structure)?-manifest[-_].*\.json$/),
        allExecutablePlans: executablePlans,
        allVariableFiles: variableFiles
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/file-to-base64 — read a file under public/data/ and return its base64 encoding
  router.post('/api/file-to-base64', (req: Request, res: Response) => {
    try {
      const filePath = req.body?.filePath as string | undefined;
      if (!filePath) {
        res.status(400).json({ ok: false, error: 'filePath is required' });
        return;
      }
      // Security: restrict to files under public/data/
      const publicDataDir = path.resolve(__dirname, '..', '..', '..', 'public', 'data');
      const resolved = path.resolve(publicDataDir, path.basename(filePath));
      if (!resolved.startsWith(publicDataDir)) {
        res.status(403).json({ ok: false, error: 'Access denied — only files under public/data/ are allowed' });
        return;
      }
      if (!fs.existsSync(resolved)) {
        res.status(404).json({ ok: false, error: `File not found: ${path.basename(filePath)}` });
        return;
      }
      const buf = fs.readFileSync(resolved);
      res.json({ ok: true, base64: buf.toString('base64'), fileName: path.basename(resolved) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/validate-file — check if an EP file exists on disk (security-scoped)
  router.get('/api/validate-file', (req: Request, res: Response) => {
    try {
      const filePath = req.query['path'] as string | undefined;
      if (!filePath) {
        res.status(400).json({ ok: false, error: 'path query parameter is required' });
        return;
      }
      if (filePath.includes('..')) {
        res.status(403).json({ ok: false, error: 'Access denied — path traversal not allowed' });
        return;
      }
      const resolved = path.resolve(filePath);
      const workspacePlanData = getPlanDataRoot();
      const pipelineRoot = getCesPipelineRoot();
      if (!isUnder(resolved, workspacePlanData) && !isUnder(resolved, pipelineRoot)) {
        res.status(403).json({ ok: false, error: 'Access denied — path outside allowed directories' });
        return;
      }
      const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
      res.json({ ok: true, exists });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/read-plan-file — read a JSON file from allowed plan directories (for CMMC editor)
  router.get('/api/read-plan-file', (req: Request, res: Response) => {
    try {
      const filePath = req.query['path'] as string | undefined;
      if (!filePath) {
        res.status(400).json({ ok: false, error: 'path query parameter is required' });
        return;
      }
      if (filePath.includes('..')) {
        res.status(403).json({ ok: false, error: 'Access denied — path traversal not allowed' });
        return;
      }
      const resolved = path.resolve(filePath);
      const workspacePlanData = getPlanDataRoot();
      const pipelineRoot = getCesPipelineRoot();
      if (!isUnder(resolved, workspacePlanData) && !isUnder(resolved, pipelineRoot)) {
        res.status(403).json({ ok: false, error: 'Access denied — path outside allowed directories' });
        return;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.status(404).json({ ok: false, error: 'File not found' });
        return;
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      res.json(JSON.parse(content));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/save-run-log — persist run log JSON to disk alongside plan file
  router.post('/api/save-run-log', (req: Request, res: Response) => {
    try {
      const log = req.body?.log;
      if (!log) {
        res.status(400).json({ ok: false, error: 'No log payload' });
        return;
      }
      const logTenant = (log.tenant || log.executionMetadata?.tenant) as string | undefined;
      const dir = tenantLogsDir(logTenant || 'dev');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `run-log-${ts}.json`;
      const filePath = path.join(dir, filename);
      writeJsonArtifact(filePath, log);
      res.json({ ok: true, path: filePath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/cmmc-controls — serve the full 110-control CMMC L2 reference for the editor
  router.get('/api/cmmc-controls', (_req: Request, res: Response) => {
    try {
      const refPath = resolveSharedDataPath('cmmc-l2-controls.reference.json');
      if (!fs.existsSync(refPath)) {
        res.status(404).json({ ok: false, error: 'CMMC reference file not found' });
        return;
      }
      const data = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  return router;
}
