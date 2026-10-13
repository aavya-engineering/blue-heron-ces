// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 Slice 2A — `simstack-create` (D.1): present the deliberately
 * half-configured demo tenant so the story's gap is SHOWN, not asserted.
 *
 * **This is a READOUT over the already-armed environment, not a live re-seed.**
 * Arming seeds the sim BEFORE it serves (an exclusive lock — `needle-run.ts`),
 * so an op cannot re-seed while the serve is up. This op therefore presents what
 * prep built and proves it: the sim answers, the registry record is usable, and
 * the deliberate report-only gap is present. Re-seeding here would be dishonest
 * and would fork the arming path ACT-HARNESS.md forbids.
 *
 * **The gap is report-only, never absent.** `build-demo-scenario.mjs` PATCHes
 * `caPolicy-1` to `state: 'enabledForReportingButNotEnforced'` — the MFA policy
 * EXISTS and is report-only ("set up six months ago and never enforced"), which
 * is why presence-based reads (Muster, EO) score `IA.L2-3.5.3` as met. The demo
 * gap is depth (not enforced), not absence.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { htmlDataUrl } from '../app-pane.js';
import { escapeHtml } from '../slide-render.js';
import { CAPTIONS } from '../captions.js';
import {
  simRecordPath,
  readSimTenantAuthFields,
  missingSimTenantAuthFields,
  type SimTenantAuthFields,
} from '../../sim-tenant-record.js';
import type { OpDriveContext } from '../op-registry.js';

/** The report-only gap the story chases: `caPolicy-1` in report-only state. */
export const SIMSTACK_GAP_POLICY_ID = 'caPolicy-1';
export const SIMSTACK_GAP_STATE = 'enabledForReportingButNotEnforced';

/** The registry root arming authors the sim record under. */
export function simstackRegistryRoot(runDir: string): string {
  return path.join(runDir, 'tenant-root');
}

interface SimstackFacts {
  readonly slug: string;
  readonly simUrl: string;
  readonly policyAnswered: boolean;
  readonly gapPolicyId: string;
  readonly gapState?: string;
  readonly gapPresent: boolean;
  readonly authFields: SimTenantAuthFields;
  readonly missingAuthFields: readonly string[];
}

function readoutHtml(f: SimstackFacts): string {
  const row = (k: string, v: string): string =>
    `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>simstack-create — ${escapeHtml(f.slug)}</title>
<style>
html,body{margin:0;height:100%;background:#0a1930;color:#dce8f7;font-family:"Segoe UI",Segoe,Tahoma,Arial,sans-serif;}
.wrap{padding:32px;max-width:70ch;margin:0 auto;}
h1{font-size:22px;font-weight:600;margin:0 0 4px;}
.sub{color:#9db2cc;font-size:13px;margin:0 0 20px;}
table{border-collapse:collapse;width:100%;font-size:13px;}
td{border-bottom:1px solid #1e3a5c;padding:6px 8px;vertical-align:top;}
td:first-child{color:#9db2cc;width:16ch;}
.gap{margin-top:20px;border:1px solid #ffb454;border-radius:8px;padding:12px 14px;color:#ffe;background:#14243c;}
.gap b{color:#ffb454;}
</style></head><body><div class="wrap">
<h1>Tenant stood up — ${escapeHtml(f.slug)}</h1>
<p class="sub">Presented from what preparation built. Nothing re-seeded on stage.</p>
<table>
${row('Sim serve', `${f.simUrl} — authorizationPolicy ${f.policyAnswered ? 'answered' : 'NO ANSWER'}`)}
${row('Tenant id', f.authFields.tenantId ?? '(none)')}
${row('App id', f.authFields.appId ?? '(none)')}
${row('Cert path', f.authFields.certPath ?? '(none)')}
${row('Auth fields', f.missingAuthFields.length === 0 ? 'all four valid' : `INVALID: ${f.missingAuthFields.join(', ')}`)}
</table>
<div class="gap"><b>The gap we are going to chase.</b> There is an MFA policy (<code>${escapeHtml(f.gapPolicyId)}</code>). Its state is <b>${escapeHtml(f.gapState ?? '(unknown)')}</b> — set up months ago in report-only mode and never enforced. Not missing. Just never finished.</div>
</div></body></html>`;
}

async function fetchOk(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function fetchState(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const body = (await res.json()) as { state?: unknown };
    return typeof body.state === 'string' ? body.state : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `simstack-create` — present the armed tenant and prove the report-only gap.
 * Reads only `ctx.armed`; no params.
 */
export async function runSimstackCreateOp(ctx: OpDriveContext): Promise<void> {
  const simUrl = ctx.armed.simUrl;
  if (!simUrl) {
    throw new Error('the stacksim serve is not armed — prep did not bring it up (see arm-sim.ts)');
  }
  const slug = ctx.armed.slug;
  const recordPath = simRecordPath(simstackRegistryRoot(ctx.armed.runDir), slug);

  const policyAnswered = await fetchOk(`${simUrl}/v1.0/policies/authorizationPolicy`);
  const gapState = await fetchState(
    `${simUrl}/v1.0/identity/conditionalAccess/policies/${SIMSTACK_GAP_POLICY_ID}`,
  );

  let authFields: SimTenantAuthFields = {};
  let missing: readonly string[] = ['record unreadable'];
  try {
    authFields = readSimTenantAuthFields(JSON.parse(fs.readFileSync(recordPath, 'utf8')));
    missing = missingSimTenantAuthFields(authFields);
  } catch {
    /* leaves the "record unreadable" marker */
  }

  const facts: SimstackFacts = {
    slug,
    simUrl,
    policyAnswered,
    gapPolicyId: SIMSTACK_GAP_POLICY_ID,
    gapState,
    gapPresent: gapState === SIMSTACK_GAP_STATE,
    authFields,
    missingAuthFields: missing,
  };

  const outPath = path.join(ctx.armed.runDir, 'simstack-create.json');
  fs.writeFileSync(outPath, JSON.stringify(facts, null, 2));
  ctx.artifact?.(outPath);

  await ctx.pane.goto(htmlDataUrl(readoutHtml(facts)));
  // A readout card, not a live GUI: the narration is emitted AFTER the card goto
  // (a load wipes the band) and in corpus order. The op has no slow step to pace
  // against, so the closer stands over the slide's dwell — the card itself
  // carries the full readout. The MFA gap is framed report-only, never missing.
  const CAP = CAPTIONS['simstack-create'].steps;
  await ctx.caption?.(CAP[0]);
  await ctx.caption?.(CAP[1]);
  await ctx.caption?.(CAP[2]);
  await ctx.caption?.(CAP[3]);

  ctx.log(
    `  op simstack-create: '${slug}' materialized (policy ${policyAnswered ? 'answered' : 'NO ANSWER'}); ` +
      `gap ${facts.gapPresent ? `${SIMSTACK_GAP_POLICY_ID}=${SIMSTACK_GAP_STATE}` : `MISSING (got ${gapState ?? 'none'})`}; ` +
      `auth ${missing.length === 0 ? 'all four valid' : `INVALID: ${missing.join(', ')}`}`,
  );
}
