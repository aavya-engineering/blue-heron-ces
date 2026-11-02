// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Catalog types — the unified vocabulary for runnables, runs, and relations.
 *
 * Every kind of thing ces-tester can launch is a Runnable with a stable id
 * `<kind>:<name>`. A Run is one launch of one Runnable in one mode.
 */

/** The four kinds of runnable. */
export type RunnableKind = 'scenario' | 'deck' | 'act' | 'pipeline';

/** How a runnable is launched. */
export type RunMode = 'test' | 'demo';

/** Per-runnable, per-mode: the exact argv to launch it. */
export interface ModeSpec {
  readonly mode: RunMode;
  /** The full argv after `node bin/ces-tester.mjs`. */
  readonly argv: readonly string[];
  /** Human-readable label for the mode, e.g. "headless check" or "presented". */
  readonly label: string;
}

/** One catalog entry — derived from code/files, enriched by meta overlay. */
export interface Runnable {
  readonly id: string;
  readonly kind: RunnableKind;
  /** Short display name. */
  readonly name: string;
  /** What it does, in plain words. From meta overlay or derived fallback. */
  readonly summary: string;
  /** Source path relative to project root, if file-backed. */
  readonly sourcePath?: string;
  /** Which modes it supports, with the exact argv for each. */
  readonly modes: readonly ModeSpec[];
  /** CES tools involved (from deck `tools` chips or act ports). */
  readonly modules: readonly string[];
  /** Tags from meta overlay. */
  readonly tags: readonly string[];
  /** Audience: internal or customer. */
  readonly audience: 'internal' | 'customer';
  /** True if retired via meta overlay. */
  readonly retired: boolean;
  /** Free-text notes from meta overlay. */
  readonly notes: string;
  /** Relation: act ids this runnable uses (deck→acts). */
  readonly usesActs: readonly string[];
  /** Relation: deck ids this runnable appears in (act→decks). */
  readonly presentedInDecks: readonly string[];
  /** Relation: test files for this runnable. */
  readonly testFiles: readonly string[];
}

/** The meta overlay shape — one entry per runnable id. */
export interface MetaEntry {
  title?: string;
  summary?: string;
  tags?: string[];
  audience?: 'internal' | 'customer';
  retired?: boolean;
  notes?: string;
}

export type MetaOverlay = Record<string, MetaEntry>;

/** Run index record — one line in runs/index.jsonl. */
export interface RunRecord {
  runId: string;
  runnableId: string;
  mode: RunMode;
  argv: string[];
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  status: 'running' | 'pass' | 'fail' | 'aborted' | 'unknown';
  outputDir?: string;
  logPath?: string;
  launchedBy: 'center' | 'cli';
  pid?: number;
}

/** Audit log entry for CC-5 mutations. */
export interface AuditEntry {
  action: string;
  id: string;
  time: string;
  result: string;
  detail?: string;
}
