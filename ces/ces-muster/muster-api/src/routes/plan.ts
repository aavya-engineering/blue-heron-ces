// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// plan.ts — MS-R5 push.
import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bearerAuth, requireRole } from '../middleware/auth.js';
import {
  validateInfraManifest,
  validateMissionPlan,
  validateTenantManifest,
} from '../contracts/missionPlan.contract.js';
import { getStamperTenantSubdir } from 'ces-shared/storage/node';
import { secretEnv } from 'ces-shared/secrets';
import { RecurringCostNoticeSchema } from 'ces-shared/types/cost-gate';
import { appendPlanPushAudit, recordPlanPush, runPushGate } from '../services/planPushAudit.js';
import {
  checkHandoff,
  handoffFileName,
  HANDOFF_KINDS,
  MP_REF_KEY,
  POLICY_HANDOFF_KINDS,
  storedForStamper,
} from '../services/planHandoff.js';
import { compilePlan, PlanCompileError, validateCompileInput } from '../services/planCompileService.js';
import { resolveIssuedSecret } from '../services/initialPasswordIssuer.js';
import { emitCompileInterviews } from '../services/interviewRecordService.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// FX2-MU1: role + tenant scoping for the plan hand-off.
//
// Roles reuse Muster's roles (prime, sub, bhd_operator, assessor_read_only):
//   push    — prime, bhd_operator (the roles that send a plan to Stamper; same
//             set as discovery/harvest);
//   results — bhd_operator (the operator token Stamper uses for
//             /secrets/resolve, CES_MUSTER_SECRETS_TOKEN).
//
// Tenant binding: a Stamper tenant_slug is a plan-data directory name, not a
// Muster tenant. The first push of a slug records the pushing caller's JWT
// tenant_id in <slug>/state/muster-owner.json (atomic create, flag 'wx');
// every later push must come from that same tenant_id. A push to a slug
// owned by another tenant answers 404, so existence is not leaked.
const PUSH_ROLES = ['prime', 'bhd_operator'] as const;
const RESULTS_ROLES = ['bhd_operator'] as const;

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

function hyphenatedTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * W3.3a: a copy of the MP whose policy-kind refs (inputs.<kind>_ref) carry the
 * file name the route stores each accepted envelope under. Unchanged (the same
 * object) when no policy envelope was accepted.
 */
function withPolicyRefFileNames(
  missionPlan: Record<string, unknown>,
  accepted: ReturnType<typeof checkHandoff>['accepted'],
  slug: string,
  ts: string
): Record<string, unknown> {
  const kinds = POLICY_HANDOFF_KINDS.filter((k) => accepted[k]);
  if (kinds.length === 0) return missionPlan;
  const inputs = { ...((missionPlan.inputs ?? {}) as Record<string, unknown>) };
  for (const kind of kinds) {
    inputs[MP_REF_KEY[kind]] = {
      ...(inputs[MP_REF_KEY[kind]] as Record<string, unknown>),
      file_name: handoffFileName(kind, slug, ts),
    };
  }
  return { ...missionPlan, inputs };
}

/** GC-FLOW-3: what happened to the EO intake call after a push (the push response's `eo_intake`). */
export type EoIntakeOutcome =
  | { status: 'not_configured' }
  | { status: 'delivered'; http: number; receipt: unknown }
  | { status: 'failed'; http?: number; error: string };

/**
 * GC-FLOW-3: POST the push bundle to EO's intake ({CES_EO_URL}/api/intake/muster, bearer CES_EO_AUTH_TOKEN).
 * Not configured (either variable unset) → not_configured, no call. Never rejects.
 */
export async function deliverToEoIntake(
  bundle: Record<string, unknown>,
  env: NodeJS.ProcessEnv = secretEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<EoIntakeOutcome> {
  const url = env.CES_EO_URL?.trim();
  const token = env.CES_EO_AUTH_TOKEN?.trim();
  if (!url || !token) return { status: 'not_configured' };
  try {
    const res = await fetchImpl(`${url.replace(/\/+$/, '')}/api/intake/muster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(bundle),
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    if (res.status === 201) return { status: 'delivered', http: 201, receipt: body };
    return { status: 'failed', http: res.status, error: typeof body === 'string' ? body : JSON.stringify(body).slice(0, 500) };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

// --- FIN-17: Muster's own calls, recorded -------------------------------------------------------
// Muster's outbound calls (the EO intake at push, the interview records at compile) and the
// SP-7 secret-reference reads are appended, one JSON line each, to
// <CES_PIPELINE_ROOT>/<slug>/state/muster-eo-calls.jsonl. Append-only, never rewritten here. A line
// holds Muster's own request outcome (status, HTTP code, EO's receipt id and per-file hash match)
// and never a secret value. This is Muster's record of what it sent, not a results loop: nothing
// in it is read back into the plan.

export function musterCallLogPath(tenantSlug: string): string {
  return path.join(getStamperTenantSubdir(tenantSlug, 'state'), 'muster-eo-calls.jsonl');
}

/** Append one record; a write failure never fails the request (it is reported on stderr). */
export function appendMusterCallRecord(tenantSlug: string, record: Record<string, unknown>): void {
  try {
    const file = musterCallLogPath(tenantSlug);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch (err) {
    process.stderr.write(`muster-eo-calls.jsonl append failed for ${tenantSlug}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/** FIN-17 (V114): which pushed files EO's receipt names with the same SHA-256 as the pushed bytes. */
export interface EoIntakeCheck {
  receipt_id: string | null;
  matched: string[];
  mismatched: string[];
  missing: string[];
}

export function intakeReceiptCheck(
  outcome: EoIntakeOutcome,
  pushedFiles: Array<{ name: string; sha256: string }>,
): EoIntakeCheck | null {
  if (outcome.status !== 'delivered') return null;
  const receipt = (outcome.receipt ?? {}) as { receipt_id?: unknown; items?: Array<{ file_name?: unknown; sha256?: unknown }> };
  const byName = new Map<string, string>();
  for (const it of Array.isArray(receipt.items) ? receipt.items : []) {
    if (typeof it?.file_name === 'string' && typeof it.sha256 === 'string') byName.set(it.file_name, it.sha256);
  }
  const out: EoIntakeCheck = { receipt_id: typeof receipt.receipt_id === 'string' ? receipt.receipt_id : null, matched: [], mismatched: [], missing: [] };
  for (const f of pushedFiles) {
    const got = byName.get(f.name);
    if (got === undefined) out.missing.push(f.name);
    else (got === f.sha256 ? out.matched : out.mismatched).push(f.name);
  }
  return out;
}

/** "$4.56" / "$32" (the SPA notice's formatEstimate rule, src/features/plan/recurringCostNotice.ts). */
function costDollars(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/**
 * CG-8 / FIN-17: the push's `COST_RECURRING: N items, ~$low-$high/month` line, re-read from the
 * pushed Mission Plan's typed recurring_cost_notice. Null when the plan has no notice, an
 * unreadable one, or 0 items. Same text as the SPA's noticeSummary. Informational: never blocks.
 */
export function pushCostRecurringLine(missionPlan: unknown): string | null {
  const parsed = RecurringCostNoticeSchema.safeParse((missionPlan as { recurring_cost_notice?: unknown } | null)?.recurring_cost_notice);
  if (!parsed.success || parsed.data.items.length === 0) return null;
  const n = parsed.data;
  const est = n.total_estimate_low === n.total_estimate_high
    ? costDollars(n.total_estimate_low)
    : `${costDollars(n.total_estimate_low)}-${costDollars(n.total_estimate_high)}`;
  return `COST_RECURRING: ${n.items.length} items, ~${est}/month`;
}

export function createPlanRouter() {
  const router = Router();

  router.post('/push', bearerAuth, requireRole(...PUSH_ROLES), (req, res, next) => {
    try {
      const { tenant_slug, missionPlan, tenantManifest, infraManifest, cuiBoundary, validationOverride } =
        req.body ?? {};

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

      // MG-12: the SI Baseline / TCP / Readiness Posture envelopes (optional),
      // checked against their hashes and the MP's references before any write.
      const handoff = checkHandoff(missionPlan, req.body ?? {});
      if (handoff.errors.length > 0) {
        res.status(400).json({ error: 'Plan hand-off artifact violation', details: handoff.errors });
        return;
      }

      // MG-15 (D10): cross-artifact gate. Structural errors and MP<->TM control
      // mismatches block the push unless an operator overrides with a reason;
      // the override is audited and the pushed plan carries a flag.
      const gate = runPushGate(missionPlan, tenantManifest, cuiBoundary);
      let override: { reason: string } | null = null;
      if (gate.blocking.length > 0) {
        const reason =
          validationOverride && typeof validationOverride.reason === 'string' ? validationOverride.reason.trim() : '';
        if (!reason) {
          res.status(409).json({
            error: `Plan validation blocked the push: ${gate.blocking.join('; ')}`,
            code: 'PLAN_VALIDATION_BLOCKED',
            errors: gate.blocking,
            warnings: gate.warnings,
          });
          return;
        }
        override = { reason };
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

      const at = new Date().toISOString();
      const pushedPlan = override
        ? {
            ...missionPlan,
            validation_override: {
              overridden: true,
              reason: override.reason,
              by: req.user!.sub,
              at,
              overridden_errors: gate.blocking,
            },
          }
        : missionPlan;
      // W3.3a: the policy kinds' MP refs name the file each envelope is stored under.
      const storedPlan = withPolicyRefFileNames(pushedPlan, handoff.accepted, tenant_slug, ts);
      fs.writeFileSync(path.join(plansDir, mpFilename), JSON.stringify(storedPlan, null, 2), 'utf-8');
      fs.writeFileSync(path.join(plansDir, tmFilename), JSON.stringify(tenantManifest, null, 2), 'utf-8');
      const pushed = [mpFilename, tmFilename];
      // GC-FLOW-3: the bundle EO's intake receives (the stored MP, as Stamper has it) and each part's pushed file name.
      const eoBundle: Record<string, unknown> = { tenant_slug, missionPlan: storedPlan, tenantManifest };
      const eoFileNames: Record<string, string> = { mission_plan: mpFilename, tenant_manifest: tmFilename };

      // Same <slug>-<ts> suffix as the TM file: Stamper's CLI finds the infra
      // manifest by replacing `tenant-manifest` in the TM path, preferring the
      // `infrastructure-manifest` prefix.
      if (infraManifest) {
        const imFilename = `infrastructure-manifest-${tenant_slug}-${ts}.json`;
        fs.writeFileSync(path.join(plansDir, imFilename), JSON.stringify(infraManifest, null, 2), 'utf-8');
        pushed.push(imFilename);
        eoBundle.infraManifest = infraManifest;
        eoFileNames.infra_manifest = imFilename;
      }

      // MG-12: the hand-off envelopes, same <slug>-<ts> suffix, beside the MP/TM/IM.
      for (const kind of HANDOFF_KINDS) {
        const envelope = handoff.accepted[kind];
        if (!envelope) continue;
        const name = handoffFileName(kind, tenant_slug, ts);
        // FIN-35 S-1 (GD-e, LOG-FIN-28 §3): only what Stamper reads (plus the interim policy-inputs profile) goes to
        // its plans folder; EO's intake gets all six. si_baseline, tcp and readiness_posture are EO-only.
        if (storedForStamper(kind)) {
          fs.writeFileSync(path.join(plansDir, name), JSON.stringify(envelope, null, 2), 'utf-8');
          pushed.push(name);
        }
        eoBundle[kind] = envelope;
        eoFileNames[kind] = name;
      }

      if (override) {
        appendPlanPushAudit({
          event: 'plan_push_validation_override',
          at,
          user: { sub: req.user!.sub, tenant_id: req.user!.tenant_id, role: req.user!.role },
          tenant_slug,
          reason: override.reason,
          overridden_errors: gate.blocking,
          warnings: gate.warnings,
          pushed,
        });
      }
      // CG-8 / FIN-17: the recurring-cost line rides the push warnings (201 body and push record).
      const costLine = pushCostRecurringLine(missionPlan);
      const pushWarnings = [...gate.warnings, ...handoff.warnings, ...(costLine ? [costLine] : [])];
      // FLOW-1: every accepted push, write-once in ces.db (muster_plan_push).
      const pushRecord = recordPlanPush({
        at,
        user: { sub: req.user!.sub, tenant_id: req.user!.tenant_id, role: req.user!.role },
        tenant_slug,
        plansDir,
        pushed,
        override: override ? { reason: override.reason, overridden_errors: gate.blocking } : null,
        warnings: pushWarnings,
      });

      // GC-FLOW-3: when an EO URL and token are configured, deliver the accepted bundle to EO's intake. The policy
      // texts travel only when the push carried them (body.policies, checked by EO against the policy-set manifest).
      // An EO failure never fails the push: EO's file pickup from the plans folder stays the fallback.
      if (Array.isArray(req.body?.policies)) eoBundle.policies = req.body.policies;
      eoBundle.file_names = eoFileNames;
      const body201 = { pushed, plansDir, override: override !== null, warnings: pushWarnings };
      void deliverToEoIntake(eoBundle).then((eo_intake) => {
        // FIN-17 (V114): record Muster's own intake call and whether EO's receipt hashes equal the pushed files.
        const eo_intake_check = intakeReceiptCheck(eo_intake, pushRecord.files);
        appendMusterCallRecord(tenant_slug, {
          event: 'eo_intake',
          at: new Date().toISOString(),
          tenant_slug,
          mission_plan: mpFilename,
          status: eo_intake.status,
          http: 'http' in eo_intake ? (eo_intake.http ?? null) : null,
          ...(eo_intake.status === 'failed' ? { error: eo_intake.error } : {}),
          check: eo_intake_check,
          pushed: pushRecord.files,
        });
        res.status(201).json({ ...body201, eo_intake, eo_intake_check });
      });
    } catch (err) {
      next(err);
    }
  });

  // API-3a: compile a plan from a discovery result (the plan-from-discovery runner's
  // output, returned as files). Same roles as the push. FLOW-5 (a): a sim plan's
  // initial password is a muster-api-issued reference; the value stays in memory here.
  router.post('/compile', bearerAuth, requireRole(...PUSH_ROLES), async (req, res, next) => {
    try {
      const v = validateCompileInput(req.body);
      if (!v.ok) {
        res.status(400).json({ error: v.error });
        return;
      }
      const result = await compilePlan(v.input, { tenantId: req.user!.tenant_id });
      // NS-2: one interview record per answered question goes to EO (status only comes back).
      const eo_interviews = await emitCompileInterviews(v.input.tenant_slug, v.input.interview_answers, req.body?.interviewee, req.user!);
      // FIN-17: record the interview-record send outcome (and the SP-7 reference terms), unless the
      // slug belongs to another tenant (then nothing is written there; the response still carries it).
      const owner = readOwner(v.input.tenant_slug);
      if (owner === null || owner === req.user!.tenant_id) {
        appendMusterCallRecord(v.input.tenant_slug, {
          event: 'eo_interviews',
          at: new Date().toISOString(),
          tenant_slug: v.input.tenant_slug,
          ...eo_interviews,
          initial_password: result.initial_password_ref
            ? { ref: result.initial_password_ref, ...(result.initial_password_terms ?? {}) }
            : null,
        });
      }
      res.status(200).json({ tenant_slug: v.input.tenant_slug, ...result, eo_interviews });
    } catch (err) {
      if (err instanceof PlanCompileError) {
        res.status(422).json({ error: err.message, detail: err.detail });
        return;
      }
      next(err);
    }
  });

  // FLOW-5 (a): Stamper resolves a muster-api-issued secret reference at execute time
  // (the operator token, CES_MUSTER_SECRETS_TOKEN). Only the issuing tenant, for the
  // slug it was issued to; anything else answers the same 404. Never logged or cached.
  router.post('/secrets/resolve', bearerAuth, requireRole(...RESULTS_ROLES), (req, res, next) => {
    try {
      const { tenant_slug, ref } = req.body ?? {};
      if (typeof tenant_slug !== 'string' || !SLUG_RE.test(tenant_slug) || typeof ref !== 'string') {
        res.status(400).json({ error: 'tenant_slug and ref are required' });
        return;
      }
      const secret = resolveIssuedSecret(ref, tenant_slug, req.user!.tenant_id);
      res.setHeader('Cache-Control', 'no-store');
      if (!secret) {
        res.status(404).json({ error: 'No such secret reference for this tenant' });
        return;
      }
      // SP-7: the read counter (no value) goes to Muster's call record.
      appendMusterCallRecord(tenant_slug, { event: 'secret_read', at: new Date().toISOString(), tenant_slug, ref, read: secret.read, max_reads: secret.max_reads });
      res.status(200).json({ ref, variable: secret.variable, value: secret.value });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
