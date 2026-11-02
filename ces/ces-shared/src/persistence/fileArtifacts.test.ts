// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G2 — file-artifact interface tests.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeJsonArtifact, appendJsonlArtifact, writeTextArtifact, readJsonArtifact } from './fileArtifacts.js';

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-fa-')); });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('file-artifact interface', () => {
  it('writes + reads JSON, creating parent dirs', () => {
    const p = path.join(dir, 'nested', 'a.json');
    writeJsonArtifact(p, { x: 1 });
    expect(readJsonArtifact<{ x: number }>(p)).toEqual({ x: 1 });
  });

  it('honors trailingNewline and pretty=false', () => {
    const p = path.join(dir, 'b.json');
    writeJsonArtifact(p, { y: 2 }, { pretty: false, trailingNewline: true });
    expect(fs.readFileSync(p, 'utf-8')).toBe('{"y":2}\n');
  });

  it('appends JSONL lines', () => {
    const p = path.join(dir, 'log.jsonl');
    appendJsonlArtifact(p, { a: 1 });
    appendJsonlArtifact(p, { a: 2 });
    expect(fs.readFileSync(p, 'utf-8')).toBe('{"a":1}\n{"a":2}\n');
  });

  it('writes text artifacts', () => {
    const p = path.join(dir, 'r.md');
    writeTextArtifact(p, '# report');
    expect(fs.readFileSync(p, 'utf-8')).toBe('# report');
  });

  it('readJsonArtifact returns null for a missing file', () => {
    expect(readJsonArtifact(path.join(dir, 'nope.json'))).toBeNull();
  });
});
