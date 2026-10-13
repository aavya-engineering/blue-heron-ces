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
import { loadProfile, resolveProfilePath } from '../../profiles/ProfileLoader.js';
import { ObjectStore } from '../../store/ObjectStore.js';
import { Ledger } from '../../ledger/Ledger.js';
import { StackShapeGate, type TenantStance } from '../../gating/StackShapeGate.js';
import { ResolverTable } from '../../resolvers/ResolverTable.js';
import { DirectoryAuditWriter } from '../../audit/DirectoryAuditWriter.js';
import { EvidenceHold } from '../../evidence/EvidenceHold.js';
import { EvidenceQuery } from '../../evidence/EvidenceQuery.js';
import { QueryServer } from '../../http/QueryServer.js';
import { FaultInjector } from '../../http/FaultInjector.js';
import { DEFAULT_SIM_PORT } from '../../config/SimTenantConfig.js';
import { acquireTenantLock } from '../../store/TenantLock.js';
import { parseFlags } from '../index.js';

export interface ServeArgs {
  stance: TenantStance;
  slug?: string;
  port?: number;
  host?: string;
  profilesDir?: string;
  tenantRoot?: string;
}

export interface ServeHandle {
  queryServer: QueryServer;
  port: number;
  store: ObjectStore;
  ledger: Ledger;
  evidenceQuery: EvidenceQuery;
  stop: () => Promise<void>;
}

/** `stacksim serve <m365_only|m365_sentinel|m365_azure> [--slug s] [--port n]` */
export async function runServe(argv: string[]): Promise<ServeHandle> {
  const [stance, ...rest] = argv;
  if (!stance) {
    throw new Error('stacksim serve: missing <profile> argument (m365_only|m365_sentinel|m365_azure)');
  }
  const flags = parseFlags(rest);
  return startServe({
    stance: stance as TenantStance,
    slug: typeof flags.slug === 'string' ? flags.slug : undefined,
    port: typeof flags.port === 'string' ? Number(flags.port) : undefined,
  });
}

/**
 * Starts the sole owner process of store.json/ledger.jsonl/evidence/ for a
 * tenant profile (Core Design (f)): builds ObjectStore/Ledger/
 * StackShapeGate/ResolverTable/EvidenceHold/EvidenceQuery and starts
 * QueryServer's HTTP surface (`/resolve`, `/ledger`, `/evidence` — M5 wires
 * the latter two, extending QueryServer per Core Design (d)/(f)).
 */
export async function startServe(args: ServeArgs): Promise<ServeHandle> {
  const profilesDir = args.profilesDir ?? path.join(process.cwd(), 'profiles');
  const profilePath = resolveProfilePath(args.stance, profilesDir);
  const profile = await loadProfile(profilePath);
  const slug = args.slug ?? profile.slug;

  const tenantRoot = args.tenantRoot ?? path.join(process.cwd(), '.stacksim', 'tenants', slug);
  // backlog-S1: serve is THE single writer — hold the tenant lock for the
  // server's whole lifetime so a concurrent seed/scenario fails loudly
  // instead of interleaving writes.
  const lock = await acquireTenantLock(tenantRoot, 'serve');
  try {
    const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    const ledger = new Ledger(path.join(tenantRoot, 'ledger.jsonl'));
    const gate = new StackShapeGate(profile.tenantStance);
    const auditWriter = new DirectoryAuditWriter(store, ledger);
    const evidenceHold = new EvidenceHold(path.join(tenantRoot, 'evidence'), ledger);
    const evidenceQuery = new EvidenceQuery(ledger, evidenceHold);
    const resolverTable = new ResolverTable(store, gate, undefined, auditWriter, evidenceHold);

    // backlog-S5: deterministic fault injection. Rules come from
    // <tenantRoot>/faults.json when present (written by a scenario's
    // faultInjection block) and can be replaced at runtime via POST /_faults.
    const faultInjector = new FaultInjector();
    const faultsPath = path.join(tenantRoot, 'faults.json');
    try {
      faultInjector.setRules(JSON.parse(await fs.readFile(faultsPath, 'utf8')) as never);
      console.log(`stacksim serve: loaded ${faultInjector.getRules().length} fault rule(s) from ${faultsPath}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    const queryServer = new QueryServer({
      resolverTable,
      ledger,
      evidenceQuery,
      faultInjector,
      store,
      tenantInfo: { slug, stance: profile.tenantStance, tenantRoot, startedAt: new Date().toISOString() },
    });
    const port = await queryServer.start(args.port ?? DEFAULT_SIM_PORT, args.host ?? '127.0.0.1');

    return {
      queryServer,
      port,
      store,
      ledger,
      evidenceQuery,
      stop: async () => {
        await queryServer.stop();
        await lock.release();
      },
    };
  } catch (err) {
    await lock.release();
    throw err;
  }
}
