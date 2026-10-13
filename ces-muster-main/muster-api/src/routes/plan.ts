// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// plan.ts — MS-R5 push + MS-R9 results ingest + FX-MU2 directive progress.
import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import {
  validateInfraManifest,
  validateMissionPlan,
  validateTenantManifest,
} from '../contracts/missionPlan.contract.js';
import { getStamperTenantSubdir } from '../vendored/ces-shared/storage/node.js';
import {
  validateExecutionResults,
  applyExecutionResults,
  directiveProgress,
  type IngestResult,
} from '../services/executionResultsService.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

type PlanDirective = { control_id: string; directive: string };

/** Find a pushed Mission Plan in a tenant's plans dir by its bare plan_id. */
function findPushedPlan(
  plansDir: string,
  planId: string,
): { plan_id: string; directives: PlanDirective[] } | null {
  const planFiles = fs.readdirSync(plansDir).filter(
    (f) => f.startsWith('manual-mission-plan-') && f.endsWith('.json'),
  );
  for (const f of planFiles) {
    const content = JSON.parse(fs.readFileSync(path.join(plansDir, f), 'utf-8'));
    const hrmp = content?.outputs?.human_readable_mission_plan;
    if (hrmp?.plan_id === planId) {
      return { plan_id: planId, directives: hrmp.control_directives ?? [] };
    }
  }
  return null;
}

/** Sidecar status file for a plan (written by POST /results). */
function statusSidecarPath(tenantSlug: string, planId: string): string {
  return path.join(getStamperTenantSubdir(tenantSlug, 'state'), `directive-status-${planId}.json`);
}

// FX2-MU1: role + tenant scoping for the plan hand-off.
//
// Roles reuse Muster's Role enum (prisma/schema.prisma):
//   push    — prime, bhd_operator (the roles that send a plan to Stamper; same
//             set as discovery/harvest);
//   results — bhd_operator (Stamper delivers with a Muster-issued operator token,
//             CES_MUSTER_API_TOKEN; that token's tenant must own the plan);
//   status  — any member of the owning tenant (all four roles).
//
// Tenant binding: a Stamper tenant_slug is a plan-data directory name, not a
// Muster tenant. The first push of a slug records the pushing caller's JWT
// tenant_id in <slug>/state/muster-owner.json (atomic create, flag 'wx');
// every later push/results/status must come from that same tenant_id. A slug
// that is unclaimed, owned by another tenant, or has no such plan all answer
// the SAME 404 body, so existence is not leaked.
const PUSH_ROLES = ['prime', 'bhd_operator'] as const;
const RESULTS_ROLES = ['bhd_operator'] as const;
const STATUS_ROLES = ['prime', 'bhd_operator', 'assessor_read_only', 'sub'] as const;

const NOT_FOUND = { error: 'No such plan for this tenant' } as const;

function ownerRecordPath(tenantSlug: string): string {
  return path.join(getStamperTenantSubdir(tenantSlug, 'state'), 'muster-owner.json');
}

function readOwner(tenantSlug: string): string | null {
  try {
    const rec = JSON.parse(fs.readFileSync(ownerRecordPath(tenantSlug), 'utf-8'));
    return typeof rec?.tenant_id === 'string' ? rec.tenant_id : null;
  } catch {
    return null;
  }
}

/** True when the slug is owned by `tenantId`. */
function ownedBy(tenantSlug: string, tenantId: string): boolean {
  return readOwner(tenantSlug) === tenantId;
}

/**
 * Claim an unclaimed slug for `tenantId` (atomic), or confirm it is already
 * ours. Returns false when another tenant owns it.
 */
function claimOrConfirm(tenantSlug: string, tenantId: string): boolean {
  const file = ownerRecordPath(tenantSlug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({ tenant_id: tenantId, claimed_at: new Date().toISOString() }, null, 2),
      { encoding: 'utf-8', flag: 'wx' },
    );
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    return ownedBy(tenantSlug, tenantId);
  }
}

// plan_id is used in a filename: keep it to a safe charset.
const PLAN_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function hyphenatedTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function createPlanRouter() {
  const router = Router();

  router.post('/push', bearerAuth, requireRole(...PUSH_ROLES), (req, res, next) => {
    try {
      const { tenant_slug, missionPlan, tenantManifest, infraManifest } = req.body ?? {};

      if (typeof tenant_slug !== 'string' || !SLUG_RE.test(tenant_slug)) {
        res.status(400).json({ error: 'tenant_slug must match /^[a-z0-9][a-z0-9-]{0,63}$/' });
        return;
      }

      if (!missionPlan || typeof missionPlan !== 'object') {
        res.status(400).json({ error: 'missionPlan is required' });
        return;
      }
      if (!tenantManifest || typeof tenantManifest !== 'object') {
        res.status(400).json({ error: 'tenantManifest is required' });
        return;
      }

      const mpResult = validateMissionPlan(missionPlan);
      if (!mpResult.ok) {
        res.status(400).json({ error: 'Mission Plan contract violation', details: mpResult.errors });
        return;
      }
      const tmResult = validateTenantManifest(tenantManifest);
      if (!tmResult.ok) {
        res.status(400).json({ error: 'Tenant Manifest contract violation', details: tmResult.errors });
        return;
      }

      // W4-MU1 (MS-R7): the Infrastructure Manifest is optional (absent for
      // m365_only plans) but, when sent, must pass the shared contract too.
      if (infraManifest !== undefined && infraManifest !== null) {
        if (typeof infraManifest !== 'object') {
          res.status(400).json({ error: 'infraManifest must be an object when present' });
          return;
        }
        const imResult = validateInfraManifest(infraManifest);
        if (!imResult.ok) {
          res.status(400).json({ error: 'Infrastructure Manifest contract violation', details: imResult.errors });
          return;
        }
      }

      // FX2-MU1: the slug must be unclaimed (we claim it) or ours.
      if (!claimOrConfirm(tenant_slug, req.user!.tenant_id)) {
        res.status(404).json(NOT_FOUND);
        return;
      }

      const plansDir = getStamperTenantSubdir(tenant_slug, 'plans');
      fs.mkdirSync(plansDir, { recursive: true });

      const ts = hyphenatedTimestamp();
      const mpFilename = `manual-mission-plan-${tenant_slug}-${ts}.json`;
      const tmFilename = `tenant-manifest-${tenant_slug}-${ts}.json`;

      fs.writeFileSync(path.join(plansDir, mpFilename), JSON.stringify(missionPlan, null, 2), 'utf-8');
      fs.writeFileSync(path.join(plansDir, tmFilename), JSON.stringify(tenantManifest, null, 2), 'utf-8');
      const pushed = [mpFilename, tmFilename];

      // Same <slug>-<ts> suffix as the TM file: Stamper's CLI finds the infra
      // manifest by replacing `tenant-manifest` in the TM path, preferring the
      // `infrastructure-manifest` prefix.
      if (infraManifest) {
        const imFilename = `infrastructure-manifest-${tenant_slug}-${ts}.json`;
        fs.writeFileSync(path.join(plansDir, imFilename), JSON.stringify(infraManifest, null, 2), 'utf-8');
        pushed.push(imFilename);
      }

      res.status(201).json({ pushed, plansDir });
    } catch (err) {
      next(err);
    }
  });

  // MS-R9: ingest execution results from Stamper.
  router.post('/results', bearerAuth, requireRole(...RESULTS_ROLES), (req, res, next) => {
    try {
      const { tenant_slug } = req.body ?? {};

      if (typeof tenant_slug !== 'string' || !SLUG_RE.test(tenant_slug)) {
        res.status(400).json({ error: 'tenant_slug must match /^[a-z0-9][a-z0-9-]{0,63}$/' });
        return;
      }

      const validation = validateExecutionResults(req.body.manifest);
      if (!validation.ok) {
        res.status(400).json({ error: 'Execution results contract violation', details: validation.errors });
        return;
      }
      const manifest = validation.manifest;

      // FX2-MU1: only the owning tenant may post results for its plans.
      const plansDir = getStamperTenantSubdir(tenant_slug, 'plans');
      if (!ownedBy(tenant_slug, req.user!.tenant_id) || !fs.existsSync(plansDir)) {
        res.status(404).json(NOT_FOUND);
        return;
      }

      // Locate the plan by planId in the tenant's plans dir.
      const matchedPlan = findPushedPlan(plansDir, manifest.planId);

      if (!matchedPlan) {
        res.status(404).json(NOT_FOUND);
        return;
      }

      const result = applyExecutionResults(matchedPlan.directives, manifest);

      // Write a sidecar status file.
      if (!PLAN_ID_RE.test(manifest.planId)) {
        res.status(400).json({ error: 'planId has characters not allowed in a status file name' });
        return;
      }
      const sidecar = statusSidecarPath(tenant_slug, manifest.planId);
      fs.mkdirSync(path.dirname(sidecar), { recursive: true });
      fs.writeFileSync(
        sidecar,
        JSON.stringify({ planId: manifest.planId, runId: manifest.runId, ...result }, null, 2),
        'utf-8',
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // FX-MU2: directive progress for the Plan tab — every directive of the pushed
  // plan with the verdict from Stamper's latest ingested results (or pending).
  router.get('/status', bearerAuth, requireRole(...STATUS_ROLES), (req, res, next) => {
    try {
      const tenant_slug = req.query.tenant_slug;
      const plan_id = req.query.plan_id;
      if (typeof tenant_slug !== 'string' || !SLUG_RE.test(tenant_slug)) {
        res.status(400).json({ error: 'tenant_slug must match /^[a-z0-9][a-z0-9-]{0,63}$/' });
        return;
      }
      if (typeof plan_id !== 'string' || !PLAN_ID_RE.test(plan_id)) {
        res.status(400).json({ error: 'plan_id is required' });
        return;
      }
      const plansDir = getStamperTenantSubdir(tenant_slug, 'plans');
      // FX2-MU1: members of the owning tenant only.
      const plan =
        ownedBy(tenant_slug, req.user!.tenant_id) && fs.existsSync(plansDir)
          ? findPushedPlan(plansDir, plan_id)
          : null;
      if (!plan) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      const sidecar = statusSidecarPath(tenant_slug, plan_id);
      const latest = fs.existsSync(sidecar)
        ? (JSON.parse(fs.readFileSync(sidecar, 'utf-8')) as IngestResult & { runId?: string })
        : null;
      res.status(200).json(directiveProgress(plan.plan_id, plan.directives, latest));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
