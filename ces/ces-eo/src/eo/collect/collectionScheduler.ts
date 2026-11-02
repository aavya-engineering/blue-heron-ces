// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-24 (EO-collection plan W2.0a): continuous collection.
 *
 * One scheduler for every registered tenant. On each tick, for each tenant in turn (one read at a
 * time, FX-15):
 *  1. it binds the tenant's session: the operator's when one is bound, otherwise an app-only session
 *     (the tenant's own certificate credential, no interactive step) opened by the injected
 *     `ensureSession`;
 *  2. assess tick (first tick, then every `assessIntervalMs`, D-11 = daily): it runs EO's own
 *     `GET /api/assess` for the tenant over loopback. That one path runs every collector, the live
 *     reads, writes the assessment snapshot and drift.json, and reconciles the POA&M. The scheduler
 *     then reads the drift record and, when a control regressed or declined, writes a notice that
 *     names the POA&M items now carrying it;
 *     collect tick (all other ticks): it runs only the collectors whose declared cadence
 *     (`cadenceMinutes`: 15 min, 60 min, 1 day) has elapsed since their store watermark;
 *  3. it reads EC's open findings and records each HASH_DRIFT once as an EO integrity finding
 *     (ecIntegrity.ts), with a notice;
 *  3b. PH-13 P13-LV: it reads AdminOps' leaver-flow escalations (unconfirmed or failed leavers, ces.db
 *     adminops_leaver_escalations, read only) and records each once as an EO leaver finding
 *     (leaverEscalations.ts), with a notice naming the open POA&M items of PS.L2-3.9.2;
 *  4. it writes one tick record.
 *
 * Ticks, notices and integrity findings are write-once rows in ces.db (CesRepository WORM list) and
 * are mirrored as append-only JSONL under `<storageRoot>/collection-schedule/<slug>/`.
 *
 * No silent auto-fix: the scheduler never writes to a tenant. Re-applying a drifted setting is an
 * operator action in Stamper or AdminOps; the notice says so.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import express, { type Request, type Response } from 'express';
import { getCesRepository } from 'ces-shared/persistence/node';
import { EvidenceStore } from '../evidence/store/EvidenceStore.js';
import type { CollectorInfo } from '../evidence/store/types.js';
import type { DriftRecord, ControlDrift } from '../assessment/DriftDetector.js';
import type { PoamLedger } from '../poam/PoamLifecycle.js';
import type { Collector, CollectorReader } from './Collector.js';
import { REGISTERED_COLLECTORS } from './collectors.js';
import { DUE_SLACK_MS, dueCollectors, runCollectors } from './CollectorRunner.js';
import { recordHashDriftFindings, listIntegrityFindings, type EcFindingLike, type EoIntegrityFinding } from './ecIntegrity.js';
import { readAoLeaverEscalations, recordLeaverFindings, listLeaverFindings, type AoLeaverEscalationLike, type EoLeaverFinding } from './leaverEscalations.js';

export const SCHEDULER_COLLECTIONS = {
  ticks: 'eo_collection_ticks',
  notices: 'eo_collection_notices',
} as const;

/** Header the scheduler's loopback assess carries, so EO's in-flight guard does not count it as an operator call. */
export const SCHEDULER_HEADER = 'x-ces-collection-scheduler';

export const NO_AUTO_FIX = 'operator action: re-apply the setting through Stamper or AdminOps; EO never changes the tenant';

// ─── Options ─────────────────────────────────────────────────────

export interface SchedulerOptions {
  enabled: boolean;
  /** Delay before the first tick. */
  firstTickMs: number;
  /** Period of the later ticks (collector cadence check). */
  tickMs: number;
  /** How often a tick runs the full assess (live reads + snapshot + drift + POA&M). */
  assessIntervalMs: number;
  /** Only these tenant slugs (unset = every registered tenant). */
  tenantAllowlist?: string[];
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * Options from the environment.
 *  - enabled / assess interval: EO's existing D-11 switch and hours (ENABLE_SCHEDULED_SIGNAL_CAPTURE,
 *    SIGNAL_CAPTURE_INTERVAL_HOURS; on, 24 h by default), passed in from EoConfig;
 *  - CES_EO_COLLECT_FIRST_TICK_SEC: first tick (default = the assess interval, i.e. the old
 *    timer's first fire). A proof round sets a short value to see a tick;
 *  - CES_EO_COLLECT_TICK_MIN: later ticks (default 15, the shortest declared cadence);
 *  - CES_EO_COLLECT_TENANTS: comma-separated allowlist of tenant slugs (default: all registered).
 */
export function readSchedulerOptions(
  env: Record<string, string | undefined>,
  base: { enabled: boolean; intervalHours: number },
): SchedulerOptions {
  const assessIntervalMs = Math.max(60_000, base.intervalHours * 3_600_000);
  const firstSec = num(env.CES_EO_COLLECT_FIRST_TICK_SEC);
  const tickMin = num(env.CES_EO_COLLECT_TICK_MIN);
  const allow = (env.CES_EO_COLLECT_TENANTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    enabled: base.enabled,
    firstTickMs: firstSec !== undefined ? firstSec * 1000 : assessIntervalMs,
    tickMs: Math.max(1_000, (tickMin ?? 15) * 60_000),
    assessIntervalMs,
    ...(allow.length ? { tenantAllowlist: allow } : {}),
  };
}

// ─── Records ─────────────────────────────────────────────────────

export type TickMode = 'assess' | 'collect' | 'deferred' | 'not_connected' | 'error';

export interface TickCollectorRow {
  planId: string;
  status: string;
  newItems: number;
  records: number;
  cadenceMinutes?: number;
  error?: string;
}

export interface DriftedControl {
  controlId: string;
  change: 'regression' | 'decline';
  from: string;
  to: string;
  /** Open POA&M ledger items of this control after the reconcile; empty = not on the POA&M. */
  poamItems: Array<{ key: string; objectiveId: string; openedAt: string; lastEvent: string | null }>;
}

export interface CollectionTick {
  schema: 'ces-eo/collection-tick@1';
  tickId: string;
  tenantSlug: string;
  tenantId: string | null;
  at: string;
  mode: TickMode;
  session: 'operator' | 'app_only' | 'none';
  /** Collectors run on this tick (assess tick: every collector, as the assess ran them). */
  collectors: TickCollectorRow[];
  /** Collectors skipped because their cadence has not elapsed. */
  notDue: Array<{ planId: string; cadenceMinutes: number; lastCollectedAt: string; nextDueAt: string }>;
  assess?: {
    ok: boolean;
    error?: string;
    snapshotId: string | null;
    drift: null | {
      previousSnapshotId: string | null;
      baseline: boolean;
      summary: DriftRecord['summary'];
      drifted: DriftedControl[];
    };
    poamId: string | null;
  };
  integrity: { reachable: boolean; newHashDrift: number };
  /** PH-13 P13-LV: leaver escalations recorded as EO findings on this tick (present only when there were some). */
  leaver?: { newFindings: number };
  noticeIds: string[];
  reason?: string;
}

export interface CollectionNotice {
  schema: 'ces-eo/collection-notice@1';
  noticeId: string;
  tenantSlug: string;
  tenantId: string | null;
  at: string;
  kind: 'drift' | 'hash_drift' | 'leaver_unconfirmed';
  tickId: string;
  message: string;
  snapshotId?: string | null;
  previousSnapshotId?: string | null;
  drifted?: DriftedControl[];
  integrityFindingIds?: string[];
  /** PH-13 P13-LV: the EO leaver findings this notice reports, and the open POA&M items of their control. */
  leaverFindingIds?: string[];
  poamItems?: DriftedControl['poamItems'];
  action: string;
}

// ─── Dependencies ────────────────────────────────────────────────

export type EnsureSessionResult =
  | { ok: true; tenantId: string; reader: CollectorReader; identity: CollectorInfo; session: 'operator' | 'app_only' }
  | { ok: false; tenantId?: string; reason: string };

export interface AssessOutcome {
  ok: boolean;
  error?: string;
  /** The assess stream's `collect` event (the collectors it ran). */
  collect?: { collectors?: Array<{ planId: string; status: string; newItems: number; records: number; error?: string }> };
  poamId?: string | null;
}

export interface SchedulerDeps {
  storageRoot: string;
  /** Registered tenant slugs. */
  listTenants(): Promise<string[]>;
  ensureSession(slug: string): Promise<EnsureSessionResult>;
  runAssess(slug: string): Promise<AssessOutcome>;
  latestSnapshotId(tenantId: string): string | null;
  readDrift(snapshotId: string, tenantId: string): DriftRecord | null;
  loadPoamLedger(slug: string): PoamLedger | null;
  /** EC's open findings for the tenant; null when EC is unreachable. */
  readEcFindings(slug: string): Promise<EcFindingLike[] | null>;
  /** PH-13 P13-LV: AO's leaver escalations for the tenant (default: read ces.db adminops_leaver_escalations). */
  readLeaverEscalations?(slug: string): AoLeaverEscalationLike[];
  /** True while an operator assess / collect / connect is in flight (the tick is deferred). */
  isBusy?(): boolean;
  collectors?: readonly Collector[];
  dbPath?: string;
  now?(): number;
  logger?: Pick<Console, 'log' | 'warn'>;
}

/** A tenant step that has not settled by `ms` is abandoned (the scheduler moves on; the promise may still settle later). */
export const SESSION_TIMEOUT_MS = 5 * 60_000;
export const COLLECT_TIMEOUT_MS = 30 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms); t.unref?.(); });
  return Promise.race([p, timeout]).finally(() => { if (t) clearTimeout(t); });
}

// ─── Scheduler ───────────────────────────────────────────────────

export interface SchedulerStatus {
  enabled: boolean;
  options: SchedulerOptions;
  started: boolean;
  running: boolean;
  ticks: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  tenants: Record<string, { lastTickAt: string; lastMode: TickMode; lastAssessAt: string | null }>;
}

export class CollectionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickCount = 0;
  private lastTickAt: string | null = null;
  private nextTickAt: string | null = null;
  private readonly lastAssess = new Map<string, number>();
  private readonly perTenant = new Map<string, { lastTickAt: string; lastMode: TickMode }>();
  private readonly log: Pick<Console, 'log' | 'warn'>;

  constructor(readonly options: SchedulerOptions, private readonly deps: SchedulerDeps) {
    this.log = deps.logger ?? console;
  }

  private nowMs(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Arm the first tick; later ticks follow every `tickMs`. No-op when disabled or already started. */
  start(): void {
    if (!this.options.enabled || this.timer) return;
    this.log.log(`[CollectionScheduler] first tick in ${Math.round(this.options.firstTickMs / 1000)} s, then every ` +
      `${Math.round(this.options.tickMs / 60_000)} min; full assess every ${Math.round(this.options.assessIntervalMs / 3_600_000 * 100) / 100} h`);
    this.schedule(this.options.firstTickMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextTickAt = null;
  }

  private schedule(delayMs: number): void {
    this.nextTickAt = new Date(this.nowMs() + delayMs).toISOString();
    this.timer = setTimeout(() => {
      void this.tick().finally(() => { if (this.timer) this.schedule(this.options.tickMs); });
    }, delayMs);
    this.timer.unref?.();
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** One tick over every registered (allowlisted) tenant, sequentially. Returns the tick records. */
  async tick(): Promise<CollectionTick[]> {
    if (this.running) return [];
    this.running = true;
    try {
      let tenants = await this.deps.listTenants();
      if (this.options.tenantAllowlist) tenants = tenants.filter((t) => this.options.tenantAllowlist!.includes(t));
      const out: CollectionTick[] = [];
      for (const slug of [...new Set(tenants)].sort()) out.push(await this.tickTenantUnlocked(slug));
      this.tickCount++;
      this.lastTickAt = new Date(this.nowMs()).toISOString();
      return out;
    } catch (err) {
      this.log.warn(`[CollectionScheduler] tick failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    } finally {
      this.running = false;
    }
  }

  /** One tenant now (operator trigger). `assess` forces the full assess. Null when a tick is running. */
  async tickTenant(slug: string, opts: { assess?: boolean } = {}): Promise<CollectionTick | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.tickTenantUnlocked(slug, opts);
    } finally {
      this.running = false;
    }
  }

  private async tickTenantUnlocked(slug: string, opts: { assess?: boolean } = {}): Promise<CollectionTick> {
    const nowMs = this.nowMs();
    const at = new Date(nowMs).toISOString();
    const tick: CollectionTick = {
      schema: 'ces-eo/collection-tick@1',
      tickId: `ect-${at.replace(/[:.]/g, '')}-${crypto.randomUUID().slice(0, 8)}`,
      tenantSlug: slug, tenantId: null, at, mode: 'collect', session: 'none',
      collectors: [], notDue: [], integrity: { reachable: false, newHashDrift: 0 }, noticeIds: [],
    };
    try {
      if (this.deps.isBusy?.()) {
        tick.mode = 'deferred';
        tick.reason = 'an operator assess, collect or connect is in flight; this tenant waits for the next tick';
      } else {
        const sess = await withTimeout(this.deps.ensureSession(slug), SESSION_TIMEOUT_MS, 'session');
        if (!sess.ok) {
          tick.mode = 'not_connected';
          tick.tenantId = sess.tenantId ?? null;
          tick.reason = sess.reason;
        } else {
          tick.tenantId = sess.tenantId;
          tick.session = sess.session;
          await this.collectOrAssess(slug, sess, nowMs, tick, opts.assess === true);
        }
      }
      await this.integrity(slug, tick, at);
      this.leaverEscalations(slug, tick, at);
    } catch (err) {
      tick.mode = 'error';
      tick.reason = err instanceof Error ? err.message : String(err);
    }
    this.persist(SCHEDULER_COLLECTIONS.ticks, 'ticks', tick.tickId, tick);
    this.perTenant.set(slug, { lastTickAt: at, lastMode: tick.mode });
    this.log.log(`[CollectionScheduler] ${slug}: ${tick.mode}` +
      (tick.collectors.length ? `; ran ${tick.collectors.map((c) => `${c.planId} ${c.status} +${c.newItems}`).join(', ')}` : '') +
      (tick.notDue.length ? `; not due ${tick.notDue.map((c) => c.planId).join(',')}` : '') +
      (tick.assess ? `; snapshot ${tick.assess.snapshotId ?? 'none'}, drifted ${tick.assess.drift?.drifted.length ?? 0}` : '') +
      (tick.noticeIds.length ? `; notices ${tick.noticeIds.join(',')}` : '') +
      (tick.reason ? `; ${tick.reason}` : ''));
    return tick;
  }

  private assessDue(slug: string, nowMs: number): boolean {
    const last = this.lastAssess.get(slug);
    return last === undefined || nowMs - last >= this.options.assessIntervalMs - DUE_SLACK_MS;
  }

  private async collectOrAssess(
    slug: string,
    sess: Extract<EnsureSessionResult, { ok: true }>,
    nowMs: number,
    tick: CollectionTick,
    forceAssess: boolean,
  ): Promise<void> {
    const collectors = this.deps.collectors ?? REGISTERED_COLLECTORS;
    const store = EvidenceStore.forStorageRoot(this.deps.storageRoot, sess.tenantId);
    const split = dueCollectors(store, collectors, nowMs);

    if (forceAssess || this.assessDue(slug, nowMs)) {
      tick.mode = 'assess';
      const outcome = await this.deps.runAssess(slug);
      if (outcome.ok) this.lastAssess.set(slug, nowMs);
      const cadence = new Map(collectors.map((c) => [c.planId, c.cadenceMinutes]));
      tick.collectors = (outcome.collect?.collectors ?? []).map((c) => ({
        planId: c.planId, status: c.status, newItems: c.newItems, records: c.records,
        ...(cadence.has(c.planId) ? { cadenceMinutes: cadence.get(c.planId) } : {}),
        ...(c.error ? { error: c.error } : {}),
      }));
      const snapshotId = outcome.ok ? this.deps.latestSnapshotId(sess.tenantId) : null;
      const drift = snapshotId ? this.deps.readDrift(snapshotId, sess.tenantId) : null;
      const poam = outcome.ok ? this.deps.loadPoamLedger(slug) : null;
      const drifted = drift ? driftedControls(drift, poam) : [];
      tick.assess = {
        ok: outcome.ok,
        ...(outcome.error ? { error: outcome.error } : {}),
        snapshotId,
        drift: drift ? { previousSnapshotId: drift.previousSnapshotId, baseline: drift.baseline, summary: drift.summary, drifted } : null,
        poamId: poam?.poamId ?? outcome.poamId ?? null,
      };
      if (drifted.length && drift) {
        const notice: CollectionNotice = {
          schema: 'ces-eo/collection-notice@1',
          noticeId: `ecn-${crypto.randomUUID()}`,
          tenantSlug: slug, tenantId: sess.tenantId, at: tick.at, kind: 'drift', tickId: tick.tickId,
          message: `${drifted.length} control(s) drifted since snapshot ${drift.previousSnapshotId ?? '(none)'}: ` +
            drifted.map((d) => `${d.controlId} ${d.from} -> ${d.to}${d.poamItems.length ? ` (POA&M ${d.poamItems.length})` : ' (not on the POA&M)'}`).join('; '),
          snapshotId, previousSnapshotId: drift.previousSnapshotId, drifted, action: NO_AUTO_FIX,
        };
        this.notice(notice, tick);
      }
      return;
    }

    tick.mode = 'collect';
    tick.notDue = split.notDue;
    if (!split.due.length) return;
    const run = await withTimeout(runCollectors({
      storageRoot: this.deps.storageRoot, tenantId: sess.tenantId, tenantSlug: slug,
      reader: sess.reader, identity: sess.identity, collectors: split.due, nowMs,
    }), COLLECT_TIMEOUT_MS, 'collect');
    tick.collectors = run.results.map((r) => ({
      planId: r.planId, status: r.status, newItems: r.newItems, records: r.records.length,
      cadenceMinutes: split.due.find((c) => c.planId === r.planId)?.cadenceMinutes,
      ...(r.error ? { error: r.error } : {}),
    }));
    for (const e of run.errors) tick.collectors.push({ planId: e.sourceId, status: 'error', newItems: 0, records: 0, error: e.error });
  }

  private async integrity(slug: string, tick: CollectionTick, at: string): Promise<void> {
    const findings = await this.deps.readEcFindings(slug);
    tick.integrity.reachable = findings !== null;
    if (!findings) return;
    const fresh = recordHashDriftFindings(findings, { tenantSlug: slug, tenantId: tick.tenantId }, at, this.deps.dbPath);
    tick.integrity.newHashDrift = fresh.length;
    if (!fresh.length) return;
    for (const f of fresh) this.mirror(slug, 'integrity', f);
    this.notice({
      schema: 'ces-eo/collection-notice@1',
      noticeId: `ecn-${crypto.randomUUID()}`,
      tenantSlug: slug, tenantId: tick.tenantId, at, kind: 'hash_drift', tickId: tick.tickId,
      message: `${fresh.length} evidence file(s) changed after they were recorded (EC HASH_DRIFT): ${fresh.map((f) => f.detail).join('; ')}`,
      integrityFindingIds: fresh.map((f) => f.findingId),
      action: 'operator review: confirm whether each file was tampered with or legitimately replaced; EO repairs nothing',
    }, tick);
  }

  /** PH-13 P13-LV: AO leaver escalations -> EO leaver findings (once each) + one notice. Never fails the tick. */
  private leaverEscalations(slug: string, tick: CollectionTick, at: string): void {
    try {
      const rows = this.deps.readLeaverEscalations ? this.deps.readLeaverEscalations(slug) : readAoLeaverEscalations(slug, this.deps.dbPath);
      if (!rows.length) return;
      const fresh = recordLeaverFindings(rows, { tenantSlug: slug, tenantId: tick.tenantId }, at, this.deps.dbPath);
      if (!fresh.length) return;
      tick.leaver = { newFindings: fresh.length };
      for (const f of fresh) this.mirror(slug, 'leaver', f);
      const controls = new Set(fresh.map((f) => f.controlId));
      const poam = this.deps.loadPoamLedger(slug);
      const poamItems = (poam?.items ?? [])
        .filter((i) => controls.has(i.controlId) && i.status === 'open')
        .map((i) => ({ key: i.key, objectiveId: i.objectiveId, openedAt: i.openedAt, lastEvent: i.history.at(-1)?.event ?? null }));
      this.notice({
        schema: 'ces-eo/collection-notice@1',
        noticeId: `ecn-${crypto.randomUUID()}`,
        tenantSlug: slug, tenantId: tick.tenantId, at, kind: 'leaver_unconfirmed', tickId: tick.tickId,
        message: `${fresh.length} leaver(s) still hold access after a personnel action (AdminOps leaver flow): ` +
          fresh.map((f) => `${f.leaverUpn} ${f.objectiveId} ${f.code}`).join('; ') +
          (poamItems.length ? ` (POA&M ${poamItems.length} open item(s) for ${[...controls].join(', ')})` : ' (not on the POA&M: open an item for the control)'),
        leaverFindingIds: fresh.map((f) => f.findingId),
        poamItems,
        action: fresh[0].action,
      }, tick);
    } catch (err) {
      this.log.warn(`[CollectionScheduler] leaver escalations not read for ${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private notice(n: CollectionNotice, tick: CollectionTick): void {
    this.persist(SCHEDULER_COLLECTIONS.notices, 'notices', n.noticeId, n);
    tick.noticeIds.push(n.noticeId);
    this.log.warn(`[CollectionScheduler] NOTICE ${n.kind} ${n.tenantSlug}: ${n.message}. ${n.action}`);
  }

  private persist(collection: string, file: string, id: string, row: CollectionTick | CollectionNotice): void {
    getCesRepository(this.deps.dbPath).put(collection, {
      id, ces: { tenantSlug: row.tenantSlug, ...(row.tenantId ? { tenantId: row.tenantId } : {}) }, data: row,
    });
    this.mirror(row.tenantSlug, file, row);
  }

  private mirror(slug: string, file: string, row: unknown): void {
    try {
      const dir = scheduleDir(this.deps.storageRoot, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, `${file}.jsonl`), JSON.stringify(row) + '\n');
    } catch (err) {
      this.log.warn(`[CollectionScheduler] JSONL mirror not written: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  status(): SchedulerStatus {
    const tenants: SchedulerStatus['tenants'] = {};
    for (const [slug, t] of this.perTenant) {
      const a = this.lastAssess.get(slug);
      tenants[slug] = { ...t, lastAssessAt: a !== undefined ? new Date(a).toISOString() : null };
    }
    return {
      enabled: this.options.enabled, options: this.options, started: this.timer !== null, running: this.running,
      ticks: this.tickCount, lastTickAt: this.lastTickAt, nextTickAt: this.nextTickAt, tenants,
    };
  }

  ticksFor(slug: string): CollectionTick[] {
    return getCesRepository(this.deps.dbPath).list<CollectionTick>(SCHEDULER_COLLECTIONS.ticks, { tenantSlug: slug }).map((r) => r.data);
  }

  noticesFor(slug: string): CollectionNotice[] {
    return getCesRepository(this.deps.dbPath).list<CollectionNotice>(SCHEDULER_COLLECTIONS.notices, { tenantSlug: slug }).map((r) => r.data);
  }

  integrityFor(slug: string): EoIntegrityFinding[] {
    return listIntegrityFindings(slug, this.deps.dbPath);
  }

  /** PH-13 P13-LV: the tenant's EO leaver findings. */
  leaverFindingsFor(slug: string): EoLeaverFinding[] {
    return listLeaverFindings(slug, this.deps.dbPath);
  }
}

/** `<storageRoot>/collection-schedule/<slug>` (the slug is the validated tenant slug). */
export function scheduleDir(storageRoot: string, slug: string): string {
  return path.join(storageRoot, 'collection-schedule', slug.replace(/[^A-Za-z0-9._-]/g, '_'));
}

/** Regressed or declined controls of a drift record, each with its open POA&M ledger items. */
export function driftedControls(drift: DriftRecord, poam: PoamLedger | null): DriftedControl[] {
  const worse = (drift.controls ?? []).filter((c: ControlDrift) => c.change === 'regression' || c.change === 'decline');
  return worse.map((c) => ({
    controlId: c.controlId,
    change: c.change as 'regression' | 'decline',
    from: c.previous.status,
    to: c.current.status,
    poamItems: (poam?.items ?? [])
      .filter((i) => i.controlId === c.controlId && i.status === 'open')
      .map((i) => ({ key: i.key, objectiveId: i.objectiveId, openedAt: i.openedAt, lastEvent: i.history.at(-1)?.event ?? null })),
  }));
}

// ─── Loopback assess ─────────────────────────────────────────────

/**
 * Run EO's own `GET /api/assess?tenant=` over loopback and read the stream to its terminal event.
 * The full assessment path (snapshot, drift.json, POA&M reconcile) stays in one place, the router.
 */
export async function loopbackAssess(
  baseUrl: string,
  slug: string,
  opts: { token?: string; timeoutMs?: number } = {},
): Promise<AssessOutcome> {
  try {
    const res = await fetch(`${baseUrl}/api/assess?tenant=${encodeURIComponent(slug)}`, {
      headers: { [SCHEDULER_HEADER]: '1', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30 * 60_000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `assess HTTP ${res.status}: ${text.slice(0, 200)}` };
    const events = text.split('\n\n').filter((f) => f.startsWith('data: ')).flatMap((f) => {
      try { return [JSON.parse(f.slice(6)) as Record<string, unknown>]; } catch { return []; }
    });
    const err = events.find((e) => e.type === 'assess_error');
    const done = events.find((e) => e.type === 'assess_done');
    const collect = events.find((e) => e.type === 'collect') as AssessOutcome['collect'] | undefined;
    const poam = events.find((e) => e.type === 'poam_reconciled') as { poamId?: string } | undefined;
    if (err || !done) return { ok: false, error: String(err?.error ?? 'assess ended without assess_done'), ...(collect ? { collect } : {}) };
    return { ok: true, ...(collect ? { collect } : {}), poamId: poam?.poamId ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Routes ──────────────────────────────────────────────────────

/**
 * GET  /api/collect/schedule[?tenant=]   scheduler status (+ the tenant's tick records)
 * GET  /api/collect/notices?tenant=      drift and HASH_DRIFT notices
 * GET  /api/collect/integrity?tenant=    EO integrity findings (HASH_DRIFT from EC)
 * GET  /api/collect/leaver-findings?tenant=  EO leaver findings (PH-13: AO leaver-flow escalations)
 * POST /api/collect/tick?tenant=[&assess=1]  run one tick for the tenant now (409 while a tick runs)
 */
export function createCollectionScheduleRouter(deps: {
  scheduler: CollectionScheduler | null;
  /** True when the slug names a known tenant. */
  tenantExists(slug: string): boolean;
}): express.Router {
  const router = express.Router();
  const slugOf = (req: Request, res: Response): string | null => {
    const slug = typeof req.query.tenant === 'string' ? req.query.tenant.trim() : '';
    if (!slug) { res.status(400).json({ error: 'Missing tenant parameter' }); return null; }
    if (!/^[A-Za-z0-9._-]+$/.test(slug) || !deps.tenantExists(slug)) { res.status(404).json({ error: `Tenant not found: ${slug}` }); return null; }
    return slug;
  };
  const off = (res: Response): boolean => {
    if (deps.scheduler) return false;
    res.status(503).json({ error: 'collection scheduler is not configured (ENABLE_SCHEDULED_SIGNAL_CAPTURE)' });
    return true;
  };

  router.get('/api/collect/schedule', (req, res) => {
    if (off(res)) return;
    const status = deps.scheduler!.status();
    if (typeof req.query.tenant !== 'string') { res.json(status); return; }
    const slug = slugOf(req, res);
    if (!slug) return;
    res.json({ ...status, tenant: slug, ticks: deps.scheduler!.ticksFor(slug) });
  });
  router.get('/api/collect/notices', (req, res) => {
    if (off(res)) return;
    const slug = slugOf(req, res);
    if (slug) res.json(deps.scheduler!.noticesFor(slug));
  });
  router.get('/api/collect/integrity', (req, res) => {
    if (off(res)) return;
    const slug = slugOf(req, res);
    if (slug) res.json(deps.scheduler!.integrityFor(slug));
  });
  router.get('/api/collect/leaver-findings', (req, res) => {
    if (off(res)) return;
    const slug = slugOf(req, res);
    if (slug) res.json(deps.scheduler!.leaverFindingsFor(slug));
  });
  router.post('/api/collect/tick', async (req, res) => {
    if (off(res)) return;
    const slug = slugOf(req, res);
    if (!slug) return;
    const tick = await deps.scheduler!.tickTenant(slug, { assess: req.query.assess === '1' });
    if (!tick) { res.status(409).json({ error: 'a scheduler tick is running; try again' }); return; }
    res.json(tick);
  });
  return router;
}
