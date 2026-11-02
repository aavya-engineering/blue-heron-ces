// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// engagementMigrate.ts — FIN-25 (DB-3): the ONE-TIME move of Muster's
// engagement layer from the retired Postgres database into ces.db.
//
// Two steps, run once, from muster-api/:
//
//   1. export — reads each of the 13 Postgres tables with `psql` (no Prisma
//      needed; prisma/ is removed) into one JSON array per table:
//        npx tsx src/cli/engagementMigrate.ts export --url <postgres-url> --out <dir>
//      psql must be on PATH. The URL is split into libpq PG* environment
//      variables for the psql child (the password never goes on argv) and is
//      never written to disk.
//
//   2. import — writes those rows into ces.db through the tenant-scoped store:
//        npx tsx src/cli/engagementMigrate.ts import --in <dir> [--db <ces.db>] [--dry-run]
//      Default target: {CES_PIPELINE_ROOT}/ces.db. Idempotent: a row whose id
//      is already in ces.db is skipped, so a re-run writes nothing new. Rows
//      whose tenant cannot be resolved (sessions, contracts, nudges and
//      dispositions carry no tenant_id; it comes from their party) are reported
//      as orphans and not written. The report lists read / written / skipped /
//      orphaned per table.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MODELS, MusterStore } from '../lib/musterStore.js';

/** Postgres table → store model, in dependency order (parents first). */
export const TABLES: ReadonlyArray<{ table: string; model: string; tenantFrom: 'tenant_id' | 'id' | 'party' }> = [
  { table: 'tenants', model: 'tenant', tenantFrom: 'id' },
  { table: 'users', model: 'user', tenantFrom: 'tenant_id' },
  { table: 'engagements', model: 'engagement', tenantFrom: 'tenant_id' },
  { table: 'parties', model: 'party', tenantFrom: 'tenant_id' },
  { table: 'interview_sessions', model: 'interviewSession', tenantFrom: 'party' },
  { table: 'contracts', model: 'contract', tenantFrom: 'party' },
  { table: 'nudge_events', model: 'nudgeEvent', tenantFrom: 'party' },
  { table: 'dispositions', model: 'disposition', tenantFrom: 'party' },
  { table: 'hil_items', model: 'hilItem', tenantFrom: 'tenant_id' },
  { table: 'touch_events', model: 'touchEvent', tenantFrom: 'tenant_id' },
  { table: 'delivery_artifacts', model: 'deliveryArtifact', tenantFrom: 'tenant_id' },
  { table: 'delivery_grants', model: 'deliveryGrant', tenantFrom: 'tenant_id' },
  { table: 'delivery_audit_entries', model: 'deliveryAuditEntry', tenantFrom: 'tenant_id' },
];

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** One Postgres JSON value → the store's shape (timestamps → Date, bytea → Buffer). */
export function normalizeValue(key: string, v: unknown): unknown {
  if (typeof v !== 'string') return v;
  // row_to_json renders bytea as "\\x<hex>".
  if (key === 'content' && v.startsWith('\\x')) return Buffer.from(v.slice(2), 'hex');
  // timestamp(3) without time zone: Prisma wrote UTC.
  if (TIMESTAMP_RE.test(v)) return new Date(`${v.replace(' ', 'T')}Z`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)$/.test(v)) return new Date(v);
  return v;
}

export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normalizeValue(k, v)]));
}

export interface TableReport {
  read: number;
  written: number;
  skipped: number;
  orphaned: number;
}

/** Import an export folder (one `<table>.json` array per table) into the store. */
export async function importExport(
  store: MusterStore,
  inDir: string,
  opts: { dryRun?: boolean } = {}
): Promise<Record<string, TableReport>> {
  const report: Record<string, TableReport> = {};
  const partyTenant = new Map<string, string>();

  for (const { table, model, tenantFrom } of TABLES) {
    const file = join(inDir, `${table}.json`);
    const rows: Record<string, unknown>[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : [];
    const r: TableReport = { read: rows.length, written: 0, skipped: 0, orphaned: 0 };
    report[table] = r;

    for (const raw of rows) {
      const row = normalizeRow(raw);
      if (table === 'parties') partyTenant.set(String(row.id), String(row.tenant_id));
      const tenantId =
        tenantFrom === 'id' ? row.id : tenantFrom === 'tenant_id' ? row.tenant_id : partyTenant.get(String(row.party_id));
      if (typeof tenantId !== 'string' || tenantId === '') {
        r.orphaned++;
        continue;
      }
      // Any id already in ces.db (in any tenant) is left alone: the import is idempotent.
      const def = (MODELS as Record<string, { collection: string }>)[model];
      if (store.repo.findById(def.collection, String(row.id))) {
        r.skipped++;
        continue;
      }
      if (!opts.dryRun) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (store.forTenant(tenantId) as any)[model].create({ data: row });
      }
      r.written++;
    }
  }
  return report;
}

/** A postgres:// URL → libpq environment variables (keeps the password off argv). */
export function pgEnv(url: string): Record<string, string> {
  const u = new URL(url);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('expected a postgres:// URL');
  const env: Record<string, string> = {};
  if (u.hostname) env.PGHOST = decodeURIComponent(u.hostname);
  if (u.port) env.PGPORT = u.port;
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const dbName = u.pathname.replace(/^\//, '');
  if (dbName) env.PGDATABASE = decodeURIComponent(dbName);
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** Export every table from Postgres with psql into `<outDir>/<table>.json`. */
export function exportFromPostgres(url: string, outDir: string, psql = 'psql'): Record<string, number> {
  mkdirSync(outDir, { recursive: true });
  const env = { ...process.env, ...pgEnv(url) };
  const counts: Record<string, number> = {};
  for (const { table } of TABLES) {
    const sql = `SELECT coalesce(json_agg(t), '[]'::json) FROM ${table} t`;
    const out = execFileSync(psql, ['--no-psqlrc', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      env,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 1024,
    });
    const rows = JSON.parse(out.trim() || '[]') as unknown[];
    writeFileSync(join(outDir, `${table}.json`), JSON.stringify(rows, null, 2), 'utf-8');
    counts[table] = rows.length;
  }
  return counts;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === 'export') {
    const url = arg(argv, 'url') ?? process.env.DATABASE_URL;
    const out = arg(argv, 'out');
    if (!url || !out) {
      console.error('usage: engagementMigrate export --url <postgres-url> --out <dir>');
      return 2;
    }
    console.log(JSON.stringify({ exported: exportFromPostgres(url, resolve(out)) }, null, 2));
    return 0;
  }
  if (cmd === 'import') {
    const inDir = arg(argv, 'in');
    if (!inDir) {
      console.error('usage: engagementMigrate import --in <dir> [--db <ces.db>] [--dry-run]');
      return 2;
    }
    const store = new MusterStore(arg(argv, 'db'));
    try {
      const report = await importExport(store, resolve(inDir), { dryRun: argv.includes('--dry-run') });
      console.log(JSON.stringify({ dry_run: argv.includes('--dry-run'), report }, null, 2));
      const orphans = Object.values(report).reduce((n, r) => n + r.orphaned, 0);
      return orphans > 0 ? 1 : 0;
    } finally {
      store.close();
    }
  }
  console.error('usage: engagementMigrate <export|import> ...');
  return 2;
}

const invokedDirectly = process.argv[1] && /engagementMigrate\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(String(err));
      process.exit(1);
    }
  );
}
