// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planPushService.ts — FX-MU1: the product calls the push. Sends the generated
// Mission Plan + Tenant Manifest to muster-api's POST /api/plan/push, which
// writes them into the tenant's Stamper plans folder (MS-R5). The Plan tab
// keeps the browser download as a fallback when this fails.
//
// Network-optional by design (musterApi.ts): only the operator's explicit
// "Send to Stamper" click reaches this; the interview path never does.
import { api } from '@/shared/api/musterApi';
import type { PlanCompileResult } from './planCompileService';

/** A plan is ~2.5MB compact; allow well beyond the client's 3s default. */
export const PLAN_PUSH_TIMEOUT_MS = 30_000;

export interface PlanPushBody {
  tenant_slug: string;
  missionPlan: unknown;
  tenantManifest: unknown;
  /** W4-MU1: present only when the plan produced one (non-m365_only + TCP). */
  infraManifest?: unknown;
}

export type PlanPushOutcome =
  | { ok: true; pushed: string[]; plansDir: string }
  | { ok: false; status: number; message: string };

/** The request body the route expects, built from the generated plan. */
export function planPushBody(result: PlanCompileResult): PlanPushBody {
  const body: PlanPushBody = {
    tenant_slug: result.tenantSlug,
    missionPlan: result.artifacts.missionPlan,
    tenantManifest: result.artifacts.tenantManifest,
  };
  if (result.artifacts.infrastructureManifest) body.infraManifest = result.artifacts.infrastructureManifest;
  return body;
}

/** Human-readable failure text, honest about why the push did not land. */
export function pushFailureMessage(status: number, error?: string): string {
  if (status === 0) return 'muster-api is not reachable (not running, blocked, or timed out)';
  if (status === 401) return 'muster-api rejected the request: no valid muster-api sign-in token';
  if (status === 413) return 'the plan is larger than muster-api accepts';
  return error ? `muster-api returned ${status}: ${error}` : `muster-api returned ${status}`;
}

export async function pushPlanToStamper(result: PlanCompileResult): Promise<PlanPushOutcome> {
  const res = await api.post<{ pushed: string[]; plansDir: string }>(
    '/plan/push',
    planPushBody(result),
    PLAN_PUSH_TIMEOUT_MS
  );
  if (!res.ok) {
    return { ok: false, status: res.status, message: pushFailureMessage(res.status, res.error) };
  }
  return { ok: true, pushed: res.data.pushed, plansDir: res.data.plansDir };
}

// ── FX-MU2: directive progress from Stamper's ingested results ─────────────

/** One plan directive with its latest Stamper verdict (null = pending). */
export interface DirectiveProgressRow {
  control_id: string;
  directive: string;
  verdict: string | null;
  outcome: string | null;
}

/** GET /api/plan/status response (muster-api executionResultsService). */
export interface DirectiveProgress {
  planId: string;
  runId: string | null;
  total: number;
  counts: Record<'sat' | 'not_sat' | 'provisional' | 'not_applicable' | 'pending', number>;
  directives: DirectiveProgressRow[];
}

export type PlanProgressOutcome =
  | { ok: true; progress: DirectiveProgress }
  | { ok: false; status: number; message: string };

/** The generated Mission Plan's bare plan_id (Stamper's results key). */
export function missionPlanId(result: PlanCompileResult): string | null {
  const id = (result.artifacts.missionPlan as {
    outputs?: { human_readable_mission_plan?: { plan_id?: unknown } };
  })?.outputs?.human_readable_mission_plan?.plan_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export async function fetchPlanProgress(result: PlanCompileResult): Promise<PlanProgressOutcome> {
  const planId = missionPlanId(result);
  if (!planId) return { ok: false, status: 0, message: 'the generated plan has no plan_id' };
  const qs = `tenant_slug=${encodeURIComponent(result.tenantSlug)}&plan_id=${encodeURIComponent(planId)}`;
  const res = await api.get<DirectiveProgress>(`/plan/status?${qs}`);
  if (!res.ok) {
    const message =
      res.status === 404
        ? 'Stamper has not received this plan yet — send it first'
        : pushFailureMessage(res.status, res.error);
    return { ok: false, status: res.status, message };
  }
  return { ok: true, progress: res.data };
}
