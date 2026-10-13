// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 Slice 2B — `simstack-destroy` (D.2): tear the ephemeral demo tenant
 * down cleanly — the "leave no trace" beat, and the rehearsal-reset primitive.
 *
 * **Wraps `teardownEphemeralSimTenant`, NOT `demo:reset`.** Three disjoint
 * teardown mechanisms exist (dossier D.2 box). This act removes exactly the
 * registry record (`<registryRoot>/sim/<slug>.json`) — idempotent, refuses live
 * slugs — and reports what it kept. It must NEVER shell to `demo:reset`, whose
 * `clear-runs` deletes `runs/` and with it the run's own evidence: the whole
 * point of this beat is that the environment is disposable but the PROOF is not.
 *
 * `keepEvidence` is hardcoded true (not a knob): this act removes the record and
 * nothing else. Every screenshot, artifact and report in `runDir` outlives it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { htmlDataUrl } from '../app-pane.js';
import { escapeHtml } from '../slide-render.js';
import { CAPTIONS } from '../captions.js';
import {
  createTenantRegistry,
  teardownEphemeralSimTenant,
  listSimTenants,
} from '../../../tenant-registry/index.js';
import { simstackRegistryRoot } from './simstack-create-op.js';
import type { OpDriveContext } from '../op-registry.js';

interface DestroyFacts {
  readonly slug: string;
  readonly removed: boolean;
  readonly simRecordsAfter: number;
  readonly runDirEntriesKept: number;
}

function readoutHtml(f: DestroyFacts): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>simstack-destroy — ${escapeHtml(f.slug)}</title>
<style>
html,body{margin:0;height:100%;background:#0a1930;color:#dce8f7;font-family:"Segoe UI",Segoe,Tahoma,Arial,sans-serif;}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;text-align:center;}
h1{font-size:22px;font-weight:600;margin:0;}
p{color:#9db2cc;font-size:14px;margin:0;max-width:52ch;line-height:1.5;}
.keep{color:#7ee0a1;} .gone{color:#ffb454;}
</style></head><body><div class="wrap">
<h1>Tenant torn down — ${escapeHtml(f.slug)}</h1>
<p class="gone">The registry record is ${f.removed ? 'gone' : 'STILL PRESENT (teardown did not complete)'}. The environment is disposable.</p>
<p class="keep">The proof is not. ${f.runDirEntriesKept} evidence entr${f.runDirEntriesKept === 1 ? 'y' : 'ies'} in the run directory — every screenshot, artifact and record — were kept.</p>
</div></body></html>`;
}

/**
 * `simstack-destroy` — remove the sim registry record, keep the evidence. Reads
 * only `ctx.armed`; no params.
 */
export async function runSimstackDestroyOp(ctx: OpDriveContext): Promise<void> {
  const slug = ctx.armed.slug;
  const registryRoot = simstackRegistryRoot(ctx.armed.runDir);
  const registry = createTenantRegistry({ registryRoot });

  // Wrap the registry teardown — never `demo:reset` (its clear-runs deletes the
  // run's evidence). Idempotent and live-slug-refusing by construction.
  await teardownEphemeralSimTenant(registry, slug);

  const after = await listSimTenants(registry);
  const removed = !after.some((r) => r.tenantSlug === slug);
  const runDirEntriesKept = fs.existsSync(ctx.armed.runDir)
    ? fs.readdirSync(ctx.armed.runDir).length
    : 0;

  const facts: DestroyFacts = {
    slug,
    removed,
    simRecordsAfter: after.length,
    runDirEntriesKept,
  };

  const outPath = path.join(ctx.armed.runDir, 'simstack-destroy.json');
  fs.writeFileSync(outPath, JSON.stringify({ ...facts, keepEvidence: true }, null, 2));
  ctx.artifact?.(outPath);

  await ctx.pane.goto(htmlDataUrl(readoutHtml(facts)));
  // Readout card: captions emitted AFTER the card goto, in corpus order; the
  // closer stands over the dwell. (Caption 2 says "stop the sim serve" — the
  // serve actually stops at the run's dispose(), not inside this op; the
  // approved text is kept as-is, noted in the implementation log.)
  const CAP = CAPTIONS['simstack-destroy'].steps;
  await ctx.caption?.(CAP[0]);
  await ctx.caption?.(CAP[1]);
  await ctx.caption?.(CAP[2]);

  ctx.log(
    `  op simstack-destroy: registry record for '${slug}' ${removed ? 'removed' : 'STILL PRESENT (teardown failed)'}; ` +
      `${after.length} sim record(s) remain; runDir evidence preserved (${runDirEntriesKept} entr${runDirEntriesKept === 1 ? 'y' : 'ies'}, keepEvidence=true)`,
  );
}
