// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/** P1.7: the SSP validation report goes outside the clone when a pipeline root is set. */
import { describe, it, expect, afterAll } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SspQualityScorecard, resolveValidationReportDir, type ValidationReport } from '../../../src/eo/ssp/SspQualityScorecard';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-p17-'));
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('resolveValidationReportDir', () => {
  it('EO_VALIDATION_REPORT_DIR wins', () => {
    const dir = path.join(tmp, 'explicit');
    expect(resolveValidationReportDir({ EO_VALIDATION_REPORT_DIR: dir, CES_PIPELINE_ROOT: path.join(tmp, 'pl') })).toBe(path.resolve(dir));
  });

  it('defaults to <CES_PIPELINE_ROOT>/EvidenceOps/validation', () => {
    const root = path.join(tmp, 'pl');
    expect(resolveValidationReportDir({ CES_PIPELINE_ROOT: root })).toBe(path.join(path.resolve(root), 'EvidenceOps', 'validation'));
  });

  it('falls back to the historical <cwd>/output/validation', () => {
    expect(resolveValidationReportDir({})).toBe(path.join(process.cwd(), 'output', 'validation'));
  });
});

describe('saveValidationReport without a directory', () => {
  it('writes under the configured directory, not inside the clone', () => {
    const dir = path.join(tmp, 'reports');
    const prev = process.env.EO_VALIDATION_REPORT_DIR;
    process.env.EO_VALIDATION_REPORT_DIR = dir;
    try {
      const report = { sspSystemName: 'P17', metrics: [] } as unknown as ValidationReport;
      const file = new SspQualityScorecard().saveValidationReport(report);
      expect(path.dirname(file)).toBe(path.resolve(dir));
      expect(fs.existsSync(file)).toBe(true);
      expect(path.resolve(file).startsWith(path.resolve(process.cwd()))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.EO_VALIDATION_REPORT_DIR;
      else process.env.EO_VALIDATION_REPORT_DIR = prev;
    }
  });
});
