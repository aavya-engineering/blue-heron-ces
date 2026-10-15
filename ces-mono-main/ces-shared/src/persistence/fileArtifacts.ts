// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G2 — the single sanctioned file-artifact I/O interface. NODE-ONLY.
//
// Part of the unified persistence model (ADR-002). Domain STATE that is consumed downstream is
// tied to the tuple-keyed set via CesRepository. Everything else that must exist as a file because
// the FILE is the external contract — generated deliverables/reports, logs, sentinels, and
// inter-subsystem handoff artifacts — is written ONLY through this interface, so no caller writes
// raw JSON to disk directly (DONE-WHEN #1).

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Write a JSON artifact to an absolute path (creates parent dirs). The one place JSON hits disk. */
export function writeJsonArtifact(
  absPath: string,
  data: unknown,
  opts: { pretty?: boolean; trailingNewline?: boolean } = {},
): void {
  const { pretty = true, trailingNewline = false } = opts;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  fs.writeFileSync(absPath, trailingNewline ? json + '\n' : json, 'utf-8');
}

/** Append one JSON line to a .jsonl artifact (creates parent dirs). */
export function appendJsonlArtifact(absPath: string, entry: unknown): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.appendFileSync(absPath, JSON.stringify(entry) + '\n', 'utf-8');
}

/** Write a text/markdown/other artifact to an absolute path (creates parent dirs). */
export function writeTextArtifact(absPath: string, text: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf-8');
}

/** Append text (e.g. a diagnostic log line) to an artifact (creates parent dirs). */
export function appendTextArtifact(absPath: string, text: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.appendFileSync(absPath, text, 'utf-8');
}

/** Read + parse a JSON artifact, or null if it does not exist. */
export function readJsonArtifact<T = unknown>(absPath: string): T | null {
  if (!fs.existsSync(absPath)) return null;
  return JSON.parse(fs.readFileSync(absPath, 'utf-8')) as T;
}
