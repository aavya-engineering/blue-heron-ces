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
//
// FIN-28 (GOAL.md must-move 1; V122): the SPA push sends the same parts as the
// API push (ces-tester mx-io.ts pushPlans): MP, TM, IM, the six hand-off
// envelopes and, FIN-19's extra body field, the policy texts the policy-set
// manifest hashes (`policies`, forwarded by muster-api to EO's intake). The texts
// come from the same single render that built the two policy envelopes
// (attachPolicyHandoffWithTexts), so their SHA-256 values equal the manifest's.
import { api } from '@/shared/api/musterApi';
import type { PlanCompileResult } from './planCompileService';
import { checkOperatorValues, validatePlanAlignment } from './planValidation';
import {
  HANDOFF_KINDS,
  buildPolicyHandoffArtifacts,
  referenceHandoffArtifacts,
  type HandoffArtifact,
} from './artifactRefs';

/** A plan is ~2.5MB compact; allow well beyond the client's 3s default. */
export const PLAN_PUSH_TIMEOUT_MS = 30_000;

export interface PlanPushBody {
  tenant_slug: string;
  missionPlan: unknown;
  tenantManifest: unknown;
  /** W4-MU1: present only when the plan produced one (non-m365_only + TCP). */
  infraManifest?: unknown;
  /** MG-08: the CUI boundary the plan was compiled with (muster-api's gate cross-checks the TM zones). */
  cuiBoundary?: unknown;
  /** MG-15: an operator override of a blocked push; muster-api audits it and flags the pushed plan. */
  validationOverride?: { reason: string };
  /** MG-12: the compile's inputs, each with its cesId and SHA-256; the MP references them by id and hash. */
  si_baseline?: HandoffArtifact;
  tcp?: HandoffArtifact;
  readiness_posture?: HandoffArtifact;
  /** W7-MX2: the policy-inputs profile and policy-set manifest (attachPolicyHandoff), and the CUI Boundary. */
  policy_inputs_profile?: HandoffArtifact;
  policy_set_manifest?: HandoffArtifact;
  cui_boundary?: HandoffArtifact;
  /** FIN-28: the policy texts the policy-set manifest hashes (as the API push sends them, FIN-19). */
  policies?: PolicyText[];
}

/** FIN-28: one rendered policy document, named as in the policy-set manifest (`policies/<base>.md`). */
export interface PolicyText {
  name: string;
  markdown: string;
}

/**
 * FIN-28: the policy texts in manifest order (`policies/<base>.md`, sorted by base,
 * as buildPolicyHandoffArtifacts names them).
 */
export function policyTextsOf(documents: Record<string, string>): PolicyText[] {
  return Object.keys(documents)
    .sort()
    .map((base) => ({ name: `policies/${base}.md`, markdown: documents[base] }));
}

/**
 * FIN-28: planCompileService.attachPolicyHandoff (W7-MX2) plus the rendered texts.
 * Same single render and the same envelopes; it also returns the texts so the
 * push can carry them. Keep the two in step (LOG-FIN-28.md open item O-2).
 */
export async function attachPolicyHandoffWithTexts(result: PlanCompileResult, sessionId: string): Promise<PolicyText[]> {
  // Loaded on use: the push itself (muster-api's tests import it under Node) needs neither Dexie nor the renderer.
  const { db } = await import('@/shared/db/schema');
  const { loadPolicyBank, policyFileBase, renderPolicySet } = await import('./policy/policyDocuments');
  const session = await db.interview_sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const party = await db.assessed_parties.get(session.party_id);
  if (!party) throw new Error(`Party not found: ${session.party_id}`);
  const set = await renderPolicySet({ compile: result, facts: session.facts, party, bank: await loadPolicyBank() });
  const documents: Record<string, string> = {};
  for (const doc of set.documents) documents[policyFileBase(doc)] = doc.markdown;
  const policy = await buildPolicyHandoffArtifacts(
    { profileOutput: set.profile.output, documents },
    result.handoff.si_baseline?.cesId ?? party.engagement_id
  );
  referenceHandoffArtifacts(result.artifacts.missionPlan, policy);
  result.handoff = { ...result.handoff, ...policy };
  return policyTextsOf(documents);
}

/** MG-15: an operator's override of the push gate — a reason is mandatory. */
export interface PlanPushOverride {
  reason: string;
}

export type PlanPushOutcome =
  | { ok: true; pushed: string[]; plansDir: string; overridden?: boolean }
  | { ok: false; status: number; message: string; blocking?: string[] };

/** The request body the route expects, built from the generated plan. */
export function planPushBody(
  result: PlanCompileResult,
  override?: PlanPushOverride,
  policies?: PolicyText[]
): PlanPushBody {
  const body: PlanPushBody = {
    tenant_slug: result.tenantSlug,
    missionPlan: result.artifacts.missionPlan,
    tenantManifest: result.artifacts.tenantManifest,
  };
  if (result.artifacts.infrastructureManifest) body.infraManifest = result.artifacts.infrastructureManifest;
  if (result.artifacts.cuiBoundary) body.cuiBoundary = result.artifacts.cuiBoundary;
  if (override) body.validationOverride = { reason: override.reason };
  // W7-MX2: every hand-off envelope the result carries (six kinds).
  const handoff = result.handoff ?? {};
  for (const kind of HANDOFF_KINDS) {
    const envelope = handoff[kind];
    if (envelope) body[kind] = envelope;
  }
  // FIN-28: the texts travel only with the manifest that hashes them (EO checks each against it).
  if (policies && policies.length > 0 && body.policy_set_manifest) body.policies = policies;
  return body;
}

/**
 * MG-15 (D10): the push gate, run on the artifacts being sent (never a cached
 * verdict). Structural errors and MP<->TM control mismatches block unless the
 * operator overrides with a reason; muster-api re-runs the same gate.
 */
export function pushGate(result: PlanCompileResult): string[] {
  return [
    ...validatePlanAlignment(
      result.artifacts.missionPlan,
      result.artifacts.tenantManifest,
      result.artifacts.cuiBoundary,
      result.artifacts.tenantConfig,
      result.artifacts.btcConfirmation
    ).blocking,
    // FX-11: defaulted operator values (unless sim-only), read off the TM being sent.
    ...checkOperatorValues(result.artifacts.tenantManifest).blocking,
  ];
}

/** Human-readable failure text, honest about why the push did not land. */
export function pushFailureMessage(status: number, error?: string): string {
  if (status === 0) return 'muster-api is not reachable (not running, blocked, or timed out)';
  if (status === 401) return 'muster-api rejected the request: no valid muster-api sign-in token';
  if (status === 413) return 'the plan is larger than muster-api accepts';
  return error ? `muster-api returned ${status}: ${error}` : `muster-api returned ${status}`;
}

export async function pushPlanToStamper(
  result: PlanCompileResult,
  override?: PlanPushOverride,
  policies?: PolicyText[]
): Promise<PlanPushOutcome> {
  const blocking = pushGate(result);
  const reason = override?.reason.trim() ?? '';
  if (blocking.length > 0 && !reason) {
    return {
      ok: false,
      status: 0,
      message: `plan validation blocked the push (${blocking.join('; ')}); override with a reason to send anyway`,
      blocking,
    };
  }
  const res = await api.post<{ pushed: string[]; plansDir: string; override?: boolean }>(
    '/plan/push',
    planPushBody(result, blocking.length > 0 ? { reason } : undefined, policies),
    PLAN_PUSH_TIMEOUT_MS
  );
  if (!res.ok) {
    return { ok: false, status: res.status, message: pushFailureMessage(res.status, res.error) };
  }
  return { ok: true, pushed: res.data.pushed, plansDir: res.data.plansDir, overridden: res.data.override === true };
}
