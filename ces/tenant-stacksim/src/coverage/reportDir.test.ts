// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.


import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveReportDir } from './reportDir.js';
import { runAoSemanticCommand, type AoSemanticReport } from './AoSemanticRunner.js';

describe('resolveReportDir', () => {
  const def = path.join(process.cwd(), 'coverage');
  it('defaults to the committed coverage dir', () => {
    expect(resolveReportDir({}, {}, def)).toEqual({ dir: path.resolve(def), redirected: false });
  });
  it('uses --out (absolute) over STACKSIM_REPORT_DIR', () => {
    const r = resolveReportDir({ out: 'rel-out' }, { STACKSIM_REPORT_DIR: 'env-out' }, def);
    expect(r).toEqual({ dir: path.resolve('rel-out'), redirected: true });
  });
  it('falls back to STACKSIM_REPORT_DIR', () => {
    expect(resolveReportDir({}, { STACKSIM_REPORT_DIR: 'env-out' }, def).dir).toBe(path.resolve('env-out'));
  });
  it('ignores a bare --out with no value', () => {
    expect(resolveReportDir({ out: true }, {}, def).redirected).toBe(false);
  });
});

describe('coverage-ao --out', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes the report under --out, prints it first, leaves the committed report untouched', async () => {
    const committed = path.join(process.cwd(), 'coverage', 'ao-semantic-report.json');
    const committedMd = path.join(process.cwd(), 'docs', 'coverage', 'AO-SEMANTIC-COVERAGE.md');
    const before = fs.readFileSync(committed, 'utf8');
    const beforeMd = fs.existsSync(committedMd) ? fs.readFileSync(committedMd, 'utf8') : null;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stacksim-reportdir-'));
    const fake: AoSemanticReport = {
      generatedAt: new Date().toISOString(),
      totals: { total: 1, pass: 1, honestOpen: 0, fail: 0 },
      results: [{ id: 'op-x', status: 'PASS', detail: 'ok' } as AoSemanticReport['results'][number]],
    };
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void lines.push(String(m)));
    try {
      await runAoSemanticCommand({ out }, { run: async () => fake });
      const reportPath = path.join(path.resolve(out), 'ao-semantic-report.json');
      expect(lines[0]).toBe(`report: ${reportPath}`);
      expect(JSON.parse(fs.readFileSync(reportPath, 'utf8'))).toEqual(fake);
      expect(fs.existsSync(path.join(out, 'AO-SEMANTIC-COVERAGE.md'))).toBe(true);
      expect(fs.readFileSync(committed, 'utf8')).toBe(before);
      expect(fs.existsSync(committedMd) ? fs.readFileSync(committedMd, 'utf8') : null).toBe(beforeMd);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
