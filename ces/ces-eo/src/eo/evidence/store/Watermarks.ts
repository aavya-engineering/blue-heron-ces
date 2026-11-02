// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.2: per-source resume watermarks (`watermarks.json`), forward only.
 * A watermark is the persisted time or id of the last item collected from a source. An update
 * that would move `lastEventTime` or `lastWindowEnd` backwards (or clear one that is set) is
 * refused with WatermarkRegressionError.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Watermark, WatermarkUpdate } from './types.js';

export const WATERMARKS_FILE = 'watermarks.json';
export const DEFAULT_OVERLAP_MINUTES = 15;

export class WatermarkRegressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatermarkRegressionError';
  }
}

function ms(t: string | null | undefined): number | null {
  if (t === null || t === undefined) return null;
  const v = Date.parse(t);
  if (!Number.isFinite(v)) throw new WatermarkRegressionError(`unparseable watermark time '${t}'`);
  return v;
}

export class Watermarks {
  private readonly file: string;

  constructor(tenantDir: string) {
    this.file = path.join(tenantDir, WATERMARKS_FILE);
  }

  all(): Record<string, Watermark> {
    if (!fs.existsSync(this.file)) return {};
    return JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Record<string, Watermark>;
  }

  get(sourceId: string): Watermark | undefined {
    return this.all()[sourceId];
  }

  /** Throws WatermarkRegressionError when `update` would move `sourceId`'s watermark backwards. */
  assertForward(sourceId: string, update: WatermarkUpdate): void {
    const cur = this.get(sourceId);
    if (!cur) {
      ms(update.lastEventTime);
      ms(update.lastWindowEnd);
      return;
    }
    for (const field of ['lastEventTime', 'lastWindowEnd'] as const) {
      if (!(field in update)) continue;
      const before = ms(cur[field]);
      const after = ms(update[field]);
      if (before !== null && after === null) {
        throw new WatermarkRegressionError(`${sourceId}.${field}: cannot clear a set watermark (${cur[field]})`);
      }
      if (before !== null && after !== null && after < before) {
        throw new WatermarkRegressionError(`${sourceId}.${field}: ${update[field]} is before ${cur[field]}`);
      }
    }
  }

  /** Apply a forward-only update for `sourceId`, recording the record that moved it. */
  advance(sourceId: string, update: WatermarkUpdate, recordId: string, nowIso: string = new Date().toISOString()): Watermark {
    this.assertForward(sourceId, update);
    const all = this.all();
    const cur = all[sourceId];
    const next: Watermark = {
      sourceId,
      lastEventTime: update.lastEventTime !== undefined ? update.lastEventTime : cur?.lastEventTime ?? null,
      lastId: update.lastId !== undefined ? update.lastId : cur?.lastId ?? null,
      lastWindowEnd: update.lastWindowEnd !== undefined ? update.lastWindowEnd : cur?.lastWindowEnd ?? null,
      overlapMinutes: update.overlapMinutes ?? cur?.overlapMinutes ?? DEFAULT_OVERLAP_MINUTES,
      seenIds: update.seenIds ?? cur?.seenIds ?? [],
      updatedAt: nowIso,
      recordId,
    };
    all[sourceId] = next;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, this.file);
    return next;
  }
}

/**
 * Items a read returned that are new since `wm`: an item older than the overlap span is already
 * collected; an item inside it is dropped when its id (event id, or the UAL's `Identity`) was seen.
 */
export function dedupeOverlap<T>(
  items: T[],
  wm: Pick<Watermark, 'lastEventTime' | 'overlapMinutes' | 'seenIds'> | undefined,
  idOf: (item: T) => string,
  timeOf: (item: T) => string,
): T[] {
  if (!wm || wm.lastEventTime === null) return [...items];
  const floor = Date.parse(wm.lastEventTime) - wm.overlapMinutes * 60_000;
  const seen = new Set(wm.seenIds);
  const out: T[] = [];
  const taken = new Set<string>();
  for (const it of items) {
    const t = Date.parse(timeOf(it));
    const id = idOf(it);
    if (Number.isFinite(t) && t < floor) continue;
    if (seen.has(id) || taken.has(id)) continue;
    taken.add(id);
    out.push(it);
  }
  return out;
}

/**
 * The watermark after a read: newest event time and its id, and the ids inside the new overlap
 * span. Pass every item the read returned (before de-duplication): a read starts at
 * `lastEventTime - overlap`, so the overlap span's ids are all among them. Never earlier than `prev`.
 */
export function nextWatermark<T>(
  items: T[],
  prev: Pick<Watermark, 'lastEventTime' | 'lastId' | 'overlapMinutes' | 'seenIds'> | undefined,
  idOf: (item: T) => string,
  timeOf: (item: T) => string,
  overlapMinutes: number = prev?.overlapMinutes ?? DEFAULT_OVERLAP_MINUTES,
): WatermarkUpdate {
  let lastEventTime = prev?.lastEventTime ?? null;
  let lastId = prev?.lastId ?? null;
  for (const it of items) {
    const t = timeOf(it);
    if (!Number.isFinite(Date.parse(t))) continue;
    if (lastEventTime === null || Date.parse(t) > Date.parse(lastEventTime)) {
      lastEventTime = t;
      lastId = idOf(it);
    }
  }
  if (lastEventTime === null) return { lastEventTime, lastId, overlapMinutes, seenIds: [] };
  const floor = Date.parse(lastEventTime) - overlapMinutes * 60_000;
  const seenIds = [...new Set(items.filter((it) => Date.parse(timeOf(it)) >= floor).map(idOf))];
  return { lastEventTime, lastId, overlapMinutes, seenIds };
}
