// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// M3 index pass. For one tenant it reads — READ-ONLY — Stamper's
//   state/execution-results-*.json  (validated against execution-results 1.x)
//   evidence/**                     (every file hashed; *.json must parse)
// plus EC's own items/, records SHA-256s in EC's integrity ledger, and raises findings:
//   HASH_DRIFT   a file's bytes changed since the last index (or an EC item no longer
//                matches the sha recorded at ingest)                          severity high
//   STALE        evidence older than EC_STALE_DAYS (default 90)              severity low
//   UNPARSEABLE  a file that cannot be read, or fails parsing / its contract  severity high
//   EMPTY_READ   the pass found nothing readable → run status 'empty', never 'success'
//                                                                            severity high
// Index results are ledger-only: they never become EcEvidenceItems (EO already loads
// Stamper evidence; promoting it would double-count). EC assigns no verdicts.
//
// The only fs calls against Stamper's tree are readdirSync / statSync / readFileSync.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getStamperTenantRoot } from 'ces-shared/storage/node';
import { ExecutionResultsManifestSchema } from 'ces-shared/types/execution-results';
import { EcEvidenceItemSchema, type EcFinding, type EcRun } from 'ces-shared/types/evidence-collector';

import { getStaleDays } from './config.js';
import {
  appendRun,
  applyFindings,
  itemsDir,
  loadLedgerState,
  saveLedgerState,
  sha256Hex,
  tenantRoot,
  upsertLedger,
  type FindingInput,
} from './store.js';

export const CHECK = {
  hashDrift: 'HASH_DRIFT',
  stale: 'STALE',
  unparseable: 'UNPARSEABLE',
  emptyRead: 'EMPTY_READ',
} as const;

/** Checks whose open findings auto-resolve once the condition clears. HASH_DRIFT needs human review. */
const RESOLVABLE = [CHECK.stale, CHECK.unparseable, CHECK.emptyRead];

const MANIFEST_RE = /^execution-results-.+\.json$/;
const DELIVERY_SIDECAR_RE = /\.delivery\.json$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IndexPassOptions {
  now?: () => Date;
  staleDays?: number;
}

export interface IndexPassResult {
  run: EcRun;
  tenantSlug: string;
  filesSeen: number;
  newFindings: EcFinding[];
}

interface Candidate {
  origin: 'stamper' | 'ec';
  relPath: string; // forward-slash, relative to the origin root
  absPath: string;
  kind: 'manifest' | 'evidence' | 'ec-item';
}

function walkFiles(dir: string, base: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(abs, base, out);
    else if (e.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
}

function stamperCandidates(slug: string): Candidate[] {
  const root = getStamperTenantRoot(slug);
  const out: Candidate[] = [];
  const stateDir = path.join(root, 'state');
  if (fs.existsSync(stateDir)) {
    for (const name of fs.readdirSync(stateDir).sort()) {
      if (!MANIFEST_RE.test(name) || DELIVERY_SIDECAR_RE.test(name)) continue;
      out.push({ origin: 'stamper', relPath: `state/${name}`, absPath: path.join(stateDir, name), kind: 'manifest' });
    }
  }
  const evidence: string[] = [];
  walkFiles(path.join(root, 'evidence'), root, evidence);
  for (const rel of evidence.sort()) {
    out.push({ origin: 'stamper', relPath: rel, absPath: path.join(root, ...rel.split('/')), kind: 'evidence' });
  }
  return out;
}

function ecItemCandidates(slug: string): Candidate[] {
  const dir = itemsDir(slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.bin'))
    .sort()
    .map((n) => ({ origin: 'ec' as const, relPath: `items/${n}`, absPath: path.join(dir, n), kind: 'ec-item' as const }));
}

/**
 * Parse check + evidence timestamp for one file. Returns `error` when the file fails
 * parsing (UNPARSEABLE); `timestamp` is the best evidence date (manifest completedAt,
 * item collectedAt, else file mtime).
 */
function inspect(c: Candidate, bytes: Buffer, mtime: Date): { error?: string; timestamp: Date; recordedSha?: string } {
  if (c.kind === 'manifest') {
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString('utf-8'));
    } catch (err) {
      return { error: `invalid JSON: ${(err as Error).message}`, timestamp: mtime };
    }
    const parsed = ExecutionResultsManifestSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        error: `not a valid execution-results manifest (${issue?.path.join('.') || '(root)'}: ${issue?.message})`,
        timestamp: mtime,
      };
    }
    const t = new Date(parsed.data.completedAt);
    return { timestamp: Number.isNaN(t.getTime()) ? mtime : t };
  }
  if (c.kind === 'evidence') {
    if (c.relPath.toLowerCase().endsWith('.json')) {
      try {
        JSON.parse(bytes.toString('utf-8'));
      } catch (err) {
        return { error: `invalid JSON: ${(err as Error).message}`, timestamp: mtime };
      }
    }
    return { timestamp: mtime };
  }
  // EC item: its metadata must still parse against the strict contract.
  const metaPath = c.absPath.replace(/\.bin$/, '.json');
  try {
    const meta = EcEvidenceItemSchema.parse(JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
    const t = new Date(meta.collectedAt);
    return { timestamp: Number.isNaN(t.getTime()) ? mtime : t, recordedSha: meta.sha256 };
  } catch (err) {
    return { error: `item metadata unreadable or invalid: ${(err as Error).message}`, timestamp: mtime };
  }
}

/** Run one index pass for an (already rail-admitted) tenant. Always records an EcRun. */
export function runIndexPass(slug: string, opts: IndexPassOptions = {}): IndexPassResult {
  tenantRoot(slug); // slug guard first — throws BadTenantSlugError before any path is built
  const now = (opts.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const staleDays = opts.staleDays ?? getStaleDays();
  const runId = `ecr-${crypto.randomUUID()}`;

  try {
    const candidates = [...stamperCandidates(slug), ...ecItemCandidates(slug)];
    const ledger = loadLedgerState(slug);
    const raised: FindingInput[] = [];
    let hashed = 0;

    for (const c of candidates) {
      const label = `${c.origin}:${c.relPath}`;
      let bytes: Buffer;
      let mtime: Date;
      try {
        bytes = fs.readFileSync(c.absPath);
        mtime = fs.statSync(c.absPath).mtime;
      } catch (err) {
        raised.push({
          checkId: CHECK.unparseable,
          subject: label,
          severity: 'high',
          detail: `${label}: unreadable (${(err as Error).message})`,
        });
        continue;
      }
      const sha = sha256Hex(bytes);
      hashed++;

      const update = upsertLedger(slug, ledger, c.origin, c.relPath, sha, nowIso);
      if (update.previousSha && update.previousSha !== sha) {
        raised.push({
          checkId: CHECK.hashDrift,
          subject: `${label}@${sha}`,
          severity: 'high',
          detail: `${label}: sha256 changed since last index (${update.previousSha} -> ${sha})`,
        });
      }

      const info = inspect(c, bytes, mtime);
      if (info.error) {
        raised.push({ checkId: CHECK.unparseable, subject: label, severity: 'high', detail: `${label}: ${info.error}` });
      }
      if (info.recordedSha && info.recordedSha !== sha) {
        raised.push({
          checkId: CHECK.hashDrift,
          // distinct subject from the ledger-drift finding above so dedupe keeps both
          subject: `${label}@${sha}#vs-ingest`,
          severity: 'high',
          detail: `${label}: content sha256 ${sha} does not match the sha256 recorded at ingest (${info.recordedSha})`,
        });
      }
      const ageDays = (now.getTime() - info.timestamp.getTime()) / DAY_MS;
      if (ageDays > staleDays) {
        raised.push({
          checkId: CHECK.stale,
          subject: label,
          severity: 'low',
          detail: `${label}: evidence dated ${info.timestamp.toISOString()} is ${Math.floor(ageDays)} days old (EC_STALE_DAYS=${staleDays})`,
        });
      }
    }

    saveLedgerState(slug, ledger);

    const empty = hashed === 0;
    if (empty) {
      raised.push({
        checkId: CHECK.emptyRead,
        subject: slug,
        severity: 'high',
        detail:
          candidates.length === 0
            ? `index pass for '${slug}' found no Stamper execution results, no Stamper evidence and no EC items`
            : `index pass for '${slug}' found ${candidates.length} file(s) but none were readable`,
      });
    }
    const newFindings = applyFindings(slug, raised, RESOLVABLE, nowIso);
    const run = appendRun(slug, {
      runId,
      startedAt: nowIso,
      runType: 'index',
      status: empty ? 'empty' : 'success',
      artifactsWritten: hashed,
    });
    return { run, tenantSlug: slug, filesSeen: candidates.length, newFindings };
  } catch (err) {
    console.error(`[ces-ec] index pass failed for '${slug}': ${(err as Error).message}`);
    const run = appendRun(slug, { runId, startedAt: nowIso, runType: 'index', status: 'failed', artifactsWritten: 0 });
    return { run, tenantSlug: slug, filesSeen: 0, newFindings: [] };
  }
}
