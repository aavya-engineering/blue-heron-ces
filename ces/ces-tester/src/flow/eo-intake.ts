// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure FLOW-3 (GAP-CLOSURE-PLAN.md section 4, V84): EO's intake of the Muster push bundle
 * (POST /api/intake/muster). muster-api calls it after a push when CES_EO_URL and CES_EO_AUTH_TOKEN are set. FIN-19:
 * EO now starts at E3, so muster-api's own call is real and its receipt becomes out/eo-intake.json
 * (`intakeRecordFromPush`). Only when muster-api did not deliver does E7 post the same bundle itself, right after EO
 * answers /api/health: the files E4 pushed (Stamper's plans folder, read as
 * buildPushBody reads E3's folder, so the bytes are the pushed files'; since FIN-35 S-1 the three EO-only envelopes
 * from E3's out/plan, because muster-api no longer stores them for Stamper), their file names, and the policy texts the
 * pushed policy-set manifest hashes (E3's out/plan/policies/<name>.md). The outcome goes to out/eo-intake.json.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPushBody, HANDOFF_PREFIXES } from './mx-io.js';

export const EO_INTAKE_SCHEMA = 'ces-tester/eo-intake@1';

/** Each intake part's file prefix in the plans folder (the push body's names plus the three plan files). */
export const INTAKE_FILE_PREFIXES: Record<string, string> = {
  mission_plan: 'manual-mission-plan-',
  tenant_manifest: 'tenant-manifest-',
  infra_manifest: 'infrastructure-manifest-',
  ...HANDOFF_PREFIXES,
};

/**
 * FIN-19 (V114): the policy texts the policy-set manifest hashes, from E3's out/plan/policies/<name>.md, as the
 * push and intake bodies carry them ([{ name, markdown }]), plus the names with no file.
 */
export function manifestPolicyTexts(manifest: unknown, policiesDir: string): { policies: Array<{ name: string; markdown: string }>; missing: string[] } {
  const docs = (manifest as { artifact?: { documents?: Array<{ name: string }> } } | undefined)?.artifact?.documents ?? [];
  const policies: Array<{ name: string; markdown: string }> = [];
  const missing: string[] = [];
  for (const d of docs) {
    const file = path.join(policiesDir, path.basename(d.name));
    if (fs.existsSync(file)) policies.push({ name: d.name, markdown: fs.readFileSync(file, 'utf8') });
    else missing.push(d.name);
  }
  return { policies, missing };
}

/**
 * FIN-35 S-1 (GD-e, LOG-FIN-28 §3): the hand-off kinds muster-api no longer writes to Stamper's plans folder (EO's intake
 * only). The fallback intake takes them from E3's out/plan (the headless writer writes all six there).
 */
export const EO_ONLY_INTAKE_KINDS = ['si_baseline', 'tcp', 'readiness_posture'] as const;

/**
 * The intake body from the pushed plans folder and E3's policy texts; the EO-only envelopes (absent from the plans folder
 * since S-1) from `planDir` (E3's out/plan) when given.
 */
export function buildEoIntakeBody(plansDir: string, slug: string, policiesDir: string, planDir?: string): { body: Record<string, unknown>; policies: number; missing: string[] } {
  const body = buildPushBody(plansDir, slug);
  const files = fs.readdirSync(plansDir);
  const planFiles = planDir && fs.existsSync(planDir) ? fs.readdirSync(planDir) : [];
  const pick = (list: string[], prefix: string): string | undefined => list.filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort().pop();
  const fileNames: Record<string, string> = {};
  for (const [kind, prefix] of Object.entries(INTAKE_FILE_PREFIXES)) {
    const f = pick(files, prefix);
    if (f) fileNames[kind] = f;
    else if (planDir && (EO_ONLY_INTAKE_KINDS as readonly string[]).includes(kind)) {
      const g = pick(planFiles, prefix);
      if (g) {
        body[kind] = JSON.parse(fs.readFileSync(path.join(planDir, g), 'utf8'));
        fileNames[kind] = g;
      }
    }
  }
  body.file_names = fileNames;
  const manifest = body.policy_set_manifest;
  const { policies, missing } = manifestPolicyTexts(manifest, policiesDir);
  if (manifest) body.policies = policies;
  return { body, policies: policies.length, missing };
}

export interface EoIntakeRecord {
  schema: typeof EO_INTAKE_SCHEMA;
  at: string;
  by: string;
  url: string;
  status: 'delivered' | 'failed';
  http: number | null;
  sent: { parts: string[]; file_names: Record<string, string>; policies: number; policies_missing: string[] };
  receipt?: unknown;
  error?: string;
}

/** POST the bundle to EO's intake (with EO's bearer headers); writes and returns out/eo-intake.json. Never throws. */
export async function postEoIntake(
  eoUrl: string,
  headers: Record<string, string>,
  built: ReturnType<typeof buildEoIntakeBody>,
  outFile: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EoIntakeRecord> {
  const url = `${eoUrl}/api/intake/muster`;
  const parts = Object.keys(built.body).filter((k) => !['tenant_slug', 'file_names', 'policies'].includes(k));
  const record: EoIntakeRecord = {
    schema: EO_INTAKE_SCHEMA,
    at: new Date().toISOString(),
    by: 'ces-tester E7 (muster-api did not deliver the push bundle to EO at E4)',
    url,
    status: 'failed',
    http: null,
    sent: { parts, file_names: built.body.file_names as Record<string, string>, policies: built.policies, policies_missing: built.missing },
  };
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(built.body), signal: AbortSignal.timeout(300000) });
    const text = await res.text();
    record.http = res.status;
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (res.status === 201) { record.status = 'delivered'; record.receipt = json; }
    else record.error = (json ? JSON.stringify(json) : text).slice(0, 2000);
  } catch (e) {
    record.error = e instanceof Error ? e.message : String(e);
  }
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  return record;
}

/**
 * FIN-19 (V114): muster-api's own EO intake call (its push response's `eo_intake`, EO up since E3) as the
 * out/eo-intake.json record E7 would otherwise write. Null when muster-api did not deliver (E7 then posts itself).
 */
export function intakeRecordFromPush(
  pushResponse: unknown,
  eoUrl: string,
  built: ReturnType<typeof buildEoIntakeBody>,
  now: () => string = () => new Date().toISOString(),
): EoIntakeRecord | null {
  const eo = (pushResponse as { eo_intake?: { status?: string; http?: number; receipt?: unknown } } | null)?.eo_intake;
  if (!eo || eo.status !== 'delivered' || eo.http !== 201) return null;
  const parts = Object.keys(built.body).filter((k) => !['tenant_slug', 'file_names', 'policies'].includes(k));
  return {
    schema: EO_INTAKE_SCHEMA,
    at: now(),
    by: 'muster-api at E4 (its own EO intake call; EO up since E3)',
    url: `${eoUrl}/api/intake/muster`,
    status: 'delivered',
    http: 201,
    sent: { parts, file_names: built.body.file_names as Record<string, string>, policies: built.policies, policies_missing: built.missing },
    receipt: eo.receipt,
  };
}
