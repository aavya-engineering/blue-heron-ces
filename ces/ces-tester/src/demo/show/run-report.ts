// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — the `demo:show` run report.
 *
 * A schema'd JSON artifact per operator run, so deck content can be iterated on
 * evidence rather than on recollection: the same assess -> execute -> verify
 * loop CES sells, applied to the demo itself. `--check` never writes one — it is
 * an operator-run artifact.
 *
 * Three shapes here are deliberate and easy to get wrong:
 *
 * 1. **`auto` and `presenter` are toggleable mid-run**, so they are recorded as
 *    an initial value plus an event list, never as one boolean. A single
 *    "presenter: true" would be a lie about any run where the operator pressed
 *    `t`.
 * 2. **A slide can be VISITED more than once.** Back-arrow, jump, and re-entry
 *    all happen live, so dwell is a list of visits summed into `actualDwellMs`,
 *    not one start/end pair that the second visit silently overwrites.
 * 3. **Toggles are not transitions.** `ShowAction` has ten members;
 *    `toggle-presenter` and `toggle-auto` fire `onChange` **without** changing
 *    `state.index`, so treating every change as a slide move would invent
 *    transitions that never happened.
 *
 * The recorder is pure over injected timestamps — every test is arithmetic, and
 * nothing here reads a clock.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { DemoDeck, DemoSlide } from './deck-model.js';
import type { ShowAction } from './show-state.js';
import type { ShowRunOptions } from './show-run.js';

export const SHOW_REPORT_SCHEMA_VERSION = 1;

export type AdvanceKind = 'auto' | 'manual' | 'jump' | 'end';

export type ExitReason = 'key' | 'signal' | 'end-of-deck' | 'error';

export interface SlideVisit {
  readonly enteredAt: string;
  readonly leftAt: string | null;
  readonly dwellMs: number;
  readonly advance: AdvanceKind | null;
}

export interface SlideReport {
  readonly index: number;
  readonly slideNumber: number;
  readonly title: string;
  /** `null` when the sheet cell was blank — the run default filled it in. */
  readonly declaredDurationSec: number | null;
  readonly effectiveDurationSec: number;
  /** Summed across EVERY visit, not just the first. */
  readonly actualDwellMs: number;
  readonly visits: readonly SlideVisit[];
}

export interface OpReport {
  readonly index: number;
  readonly slideNumber: number;
  readonly opId: string;
  readonly mode: string;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly status: 'running' | 'done' | 'failed';
  readonly error: string | null;
  /** Paths relative to the tester root — a report is read on another machine. */
  readonly artifacts: readonly string[];
}

export interface ToggleEvent {
  readonly at: string;
  readonly what: 'auto' | 'presenter';
  readonly to: boolean;
}

export interface ShowReport {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly exitReason: ExitReason;
  readonly deck: {
    readonly path: string;
    readonly title: string;
    readonly slideCount: number;
    readonly rowCount: number;
    readonly warnings: readonly string[];
  };
  readonly run: {
    readonly defaultDwellSec: number;
    readonly slidesPort: number;
    readonly autoInitial: boolean;
    readonly presenterInitial: boolean;
    readonly toggles: readonly ToggleEvent[];
    readonly manualAdvances: number;
  };
  readonly slides: readonly SlideReport[];
  readonly ops: readonly OpReport[];
}

/**
 * How a slide was LEFT, from the action that moved the index. Only five of
 * `ShowAction`'s ten members move it; the other five (`toggle-presenter`,
 * `toggle-auto`, `exit`, `op`, `tick`-without-advance) are not transitions and
 * return undefined so the caller can tell "not a move" from "moved somehow".
 */
export function advanceKindFor(action: ShowAction): AdvanceKind | undefined {
  switch (action.type) {
    case 'tick':
      return 'auto';
    case 'next':
    case 'prev':
      return 'manual';
    case 'first':
    case 'last':
    case 'goto':
      return 'jump';
    default:
      return undefined;
  }
}

export interface ShowReportRecorder {
  slideEntered(index: number, atMs: number): void;
  slideLeft(index: number, atMs: number, advance: AdvanceKind): void;
  toggled(what: 'auto' | 'presenter', to: boolean, atMs: number): void;
  opStarted(index: number, slide: DemoSlide, atMs: number): void;
  opArtifact(index: number, absPath: string): void;
  opFinished(index: number, atMs: number, status: 'done' | 'failed', error?: string): void;
  finish(atMs: number, exitReason: ExitReason): ShowReport;
}

interface MutableVisit {
  enteredAtMs: number;
  leftAtMs: number | null;
  advance: AdvanceKind | null;
}

interface MutableOp {
  readonly index: number;
  readonly slideNumber: number;
  readonly opId: string;
  readonly mode: string;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly startedAtMs: number;
  endedAtMs: number | null;
  status: 'running' | 'done' | 'failed';
  error: string | null;
  readonly artifacts: string[];
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function createShowReport(
  deck: DemoDeck,
  options: ShowRunOptions,
  startedAtMs: number,
  runId: string,
): ShowReportRecorder {
  const visits = new Map<number, MutableVisit[]>();
  const ops: MutableOp[] = [];
  const toggles: ToggleEvent[] = [];
  let manualAdvances = 0;

  const visitsFor = (index: number): MutableVisit[] => {
    const list = visits.get(index) ?? [];
    if (!visits.has(index)) visits.set(index, list);
    return list;
  };

  /** Newest op record for a slide index — a re-entered slide never re-runs. */
  const opAt = (index: number): MutableOp | undefined =>
    [...ops].reverse().find((o) => o.index === index);

  return {
    slideEntered(index, atMs) {
      visitsFor(index).push({ enteredAtMs: atMs, leftAtMs: null, advance: null });
    },

    slideLeft(index, atMs, advance) {
      const open = visitsFor(index).at(-1);
      // A close with no matching open is a bug upstream, not something to
      // paper over with an invented zero-length visit.
      if (!open || open.leftAtMs !== null) return;
      open.leftAtMs = atMs;
      open.advance = advance;
      if (advance === 'manual') manualAdvances += 1;
    },

    toggled(what, to, atMs) {
      toggles.push({ at: iso(atMs), what, to });
    },

    opStarted(index, slide, atMs) {
      ops.push({
        index,
        slideNumber: slide.slideNumber,
        opId: slide.op.opId ?? '(none)',
        mode: slide.op.mode,
        // The op's declared parameters, exactly as the loader resolved them
        // (defaults filled in) — so a report explains WHY an op behaved as it
        // did, not just that it ran.
        params: slide.op.params ?? {},
        startedAtMs: atMs,
        endedAtMs: null,
        status: 'running',
        error: null,
        artifacts: [],
      });
    },

    opArtifact(index, absPath) {
      const op = opAt(index);
      if (!op) return;
      const rel = path.relative(options.testerRoot, absPath);
      const recorded = rel === '' || rel.startsWith('..') ? absPath : rel.split(path.sep).join('/');
      if (!op.artifacts.includes(recorded)) op.artifacts.push(recorded);
    },

    opFinished(index, atMs, status, error) {
      const op = opAt(index);
      if (!op || op.endedAtMs !== null) return;
      op.endedAtMs = atMs;
      op.status = status;
      op.error = error ?? null;
    },

    finish(atMs, exitReason) {
      // Close whatever the operator was looking at when the run ended.
      for (const list of visits.values()) {
        const open = list.at(-1);
        if (open && open.leftAtMs === null) {
          open.leftAtMs = atMs;
          open.advance = 'end';
        }
      }

      const slides: SlideReport[] = deck.slides.map((slide, index) => {
        const list = visits.get(index) ?? [];
        return {
          index,
          slideNumber: slide.slideNumber,
          title: slide.rows.find((r) => r.feature)?.feature ?? `Slide ${slide.slideNumber}`,
          declaredDurationSec: slide.op.durationSec ?? null,
          effectiveDurationSec: slide.op.durationSec ?? options.defaultDwellSec,
          actualDwellMs: list.reduce((n, v) => n + Math.max(0, (v.leftAtMs ?? v.enteredAtMs) - v.enteredAtMs), 0),
          visits: list.map((v) => ({
            enteredAt: iso(v.enteredAtMs),
            leftAt: v.leftAtMs === null ? null : iso(v.leftAtMs),
            dwellMs: Math.max(0, (v.leftAtMs ?? v.enteredAtMs) - v.enteredAtMs),
            advance: v.advance,
          })),
        };
      });

      return {
        schemaVersion: SHOW_REPORT_SCHEMA_VERSION,
        runId,
        startedAt: iso(startedAtMs),
        endedAt: iso(atMs),
        exitReason,
        deck: {
          path: deck.sourcePath,
          title: deck.title,
          slideCount: deck.slides.length,
          rowCount: deck.slides.reduce((n, s) => n + s.rows.length, 0),
          warnings: deck.warnings,
        },
        run: {
          defaultDwellSec: options.defaultDwellSec,
          slidesPort: options.slidesPort,
          autoInitial: options.auto,
          presenterInitial: options.presenter,
          toggles,
          manualAdvances,
        },
        slides,
        ops: ops.map((o) => ({
          index: o.index,
          slideNumber: o.slideNumber,
          opId: o.opId,
          mode: o.mode,
          params: o.params,
          startedAt: iso(o.startedAtMs),
          endedAt: o.endedAtMs === null ? null : iso(o.endedAtMs),
          durationMs: o.endedAtMs === null ? null : o.endedAtMs - o.startedAtMs,
          status: o.status,
          error: o.error,
          artifacts: o.artifacts,
        })),
      };
    },
  };
}

/**
 * Write the report. Creates its directory: a staged-only deck never arms, so
 * `runs/show/<runId>/` may not exist — and a plain-narration run must not crash
 * in teardown because nothing happened to create a folder.
 */
export async function writeShowReport(report: ShowReport, absPath: string): Promise<void> {
  await fsp.mkdir(path.dirname(absPath), { recursive: true });
  await fsp.writeFile(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
