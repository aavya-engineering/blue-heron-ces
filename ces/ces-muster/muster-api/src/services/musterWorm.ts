// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// musterWorm.ts — gap closure FLOW-1: Muster's write-once records in ces.db
// ({CES_PIPELINE_ROOT}/ces.db, ces-shared CesRepository). Two collections, both
// in ces-shared's DEFAULT_WORM_COLLECTIONS, so a record is written once and
// never overwritten, updated or deleted:
//   muster_plan_push — one row per accepted plan push: the SHA-256 of every
//                      pushed file as it lies in Stamper's plans folder;
//   muster_discovery — one row per completed discovery run: the SHA-256 of the
//                      readiness-result envelope as `mu discovery` writes it
//                      (JSON.stringify(envelope, null, 2), UTF-8).
// The repository is opened and closed per write: muster-api writes rarely, and
// a held SQLite handle would lock the file on Windows.
import { createHash } from 'node:crypto';
import { CesRepository, getCesDbPath } from 'ces-shared/persistence/node';

export const MUSTER_PLAN_PUSH = 'muster_plan_push';
export const MUSTER_DISCOVERY = 'muster_discovery';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Write one record to a WORM collection of ces.db, scoped by tenant slug. Throws CesWormError if the id exists. */
export function writeMusterWorm(collection: string, id: string, tenantSlug: string, data: unknown): void {
  const repo = new CesRepository(getCesDbPath());
  try {
    repo.put(collection, { id, ces: { tenantSlug }, data });
  } finally {
    repo.close();
  }
}

export interface DiscoveryWormRecord {
  event: 'discovery';
  at: string;
  tenant_slug: string;
  tenant_kind: 'sim' | 'live';
  /** SHA-256 of JSON.stringify(envelope, null, 2) as UTF-8: the bytes of `mu discovery --out`. */
  result_sha256: string;
  result_bytes: number;
  postures: { met: number; unknown: number; not_met: number };
}

/** Record one completed discovery run (id = `<slug>:<at>:<hash prefix>`). Returns the record written. */
export function recordDiscovery(input: {
  tenant_slug: string;
  tenant_kind: 'sim' | 'live';
  envelope: unknown;
  postures: { met: number; unknown: number; not_met: number };
  at?: string;
}): DiscoveryWormRecord {
  const text = JSON.stringify(input.envelope, null, 2);
  const record: DiscoveryWormRecord = {
    event: 'discovery',
    at: input.at ?? new Date().toISOString(),
    tenant_slug: input.tenant_slug,
    tenant_kind: input.tenant_kind,
    result_sha256: sha256Hex(text),
    result_bytes: Buffer.byteLength(text, 'utf-8'),
    postures: input.postures,
  };
  writeMusterWorm(
    MUSTER_DISCOVERY,
    `${record.tenant_slug}:${record.at}:${record.result_sha256.slice(0, 12)}`,
    record.tenant_slug,
    record,
  );
  return record;
}
