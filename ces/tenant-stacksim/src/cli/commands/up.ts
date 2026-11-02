// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { seedTenant } from './seed.js';
import { startServe, type ServeHandle } from './serve.js';
import type { TenantStance } from '../../gating/StackShapeGate.js';
import { loadProfile, resolveProfilePath } from '../../profiles/ProfileLoader.js';
import { parseFlags } from '../index.js';

export interface UpArgs {
  stance?: TenantStance;
  slug?: string;
  port?: number;
  profilesDir?: string;
  tenantRoot?: string;
}

export interface UpResult {
  handle: ServeHandle;
  slug: string;
  stance: TenantStance;
  seeded: boolean;
}

/** `stacksim up [profile] [--slug s] [--port n]` — one-command launch:
 * seeds the tenant iff it doesn't exist yet (an existing store.json is
 * NEVER re-seeded — scenario-built or mutated state survives restarts),
 * then serves it. Profile defaults to m365_azure. `npm run stacksim` wraps
 * this behind a fresh build. */
export async function runUp(argv: string[]): Promise<UpResult> {
  const [stanceArg, ...rest] = argv.filter((a) => !a.startsWith('--'));
  const flags = parseFlags(argv);
  const result = await upTenant({
    stance: (stanceArg as TenantStance) || undefined,
    slug: typeof flags.slug === 'string' ? flags.slug : undefined,
    port: typeof flags.port === 'string' ? Number(flags.port) : undefined,
  });

  const base = `http://127.0.0.1:${result.handle.port}`;
  console.log('');
  console.log(`stacksim up: ${result.seeded ? 'seeded fresh tenant' : 'reusing existing tenant state'} "${result.slug}" (${result.stance})`);
  console.log(`  server:        ${base}`);
  console.log(`  inspector:     ${base}/   (live read-only view: collections, ledger tape, faults)`);
  console.log(`  graph REST:    ${base}/v1.0  (set GRAPH_BASE_URL here)`);
  console.log(`  oauth token:   ${base}/{tenantId}/oauth2/v2.0/token`);
  console.log(`  fault admin:   POST ${base}/_faults`);
  console.log(`  stamper:       npx tsx src/cli/index.ts gui --stacksim   (from ces-stamper; pick "${result.slug}")`);
  console.log('  Ctrl+C to stop.');
  return result;
}

export async function upTenant(args: UpArgs): Promise<UpResult> {
  const stance: TenantStance = args.stance ?? 'm365_azure';
  const profilesDir = args.profilesDir ?? path.join(process.cwd(), 'profiles');
  const profile = await loadProfile(resolveProfilePath(stance, profilesDir));
  const slug = args.slug ?? profile.slug;
  const tenantRoot = args.tenantRoot ?? path.join(process.cwd(), '.stacksim', 'tenants', slug);

  let seeded = false;
  try {
    await fs.access(path.join(tenantRoot, 'store.json'));
  } catch {
    await seedTenant({ stance, slug, profilesDir, tenantRoot });
    seeded = true;
  }

  const handle = await startServe({ stance, slug, port: args.port, profilesDir, tenantRoot });
  return { handle, slug, stance, seeded };
}
