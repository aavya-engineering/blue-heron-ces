// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GC-KB-2b: the SSP DOCX renders each control's "Assessment approach" block (one line per 800-171A objective, the
 * `text` the SSP JSON carries) inside the control's section, and the V31 parse (text split at the control headings)
 * still finds every heading with no "Not Applicable" / "N/A" in any not-assessed block or in the approach lines.
 */
import { describe, test, expect, jest, beforeAll, afterAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import { StamperEvidenceLoader } from '../../src/eo/evidence/StamperEvidenceLoader.js';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter.js';
import type { ApproachedControl } from '../../src/eo/ssp/SspGenerator.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const FIXTURES = path.resolve(__dirname, '../fixtures/ssp-uplift');
const SLUG = 'muster-partial';
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8')) as T;

// Same text extraction and heading split as verify.mjs V31.
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const docxTextOf = (xml: string) => decodeXml(xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => `${m.replace(/<[^>]+>/g, '')}\n`).replace(/<[^>]+>/g, ''));
const HEADING = /^([A-Z]{2}\.L[123]-\d+\.\d+\.\d+) — \d+\.\d+\.\d+$/;

describe('GC-KB-2b SSP DOCX renders the assessment approach block', () => {
  const prevRoot = process.env.CES_PIPELINE_ROOT;
  let tmp: string;
  let ssp: any;
  let controls: ApproachedControl[];
  let blocks: Map<string, string>;

  const buildBlocks = async (plan: any) => {
    const buf = await new SspDocxExporter().export(plan);
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
    const lines = docxTextOf(xml).split('\n');
    const starts = new Map<string, number>();
    lines.forEach((l, i) => { const m = l.trim().match(HEADING); if (m && !starts.has(m[1])) starts.set(m[1], i); });
    const order = [...starts.entries()].sort((x, y) => x[1] - y[1]);
    const out = new Map<string, string>();
    order.forEach(([id, at], k) => out.set(id, lines.slice(at, k + 1 < order.length ? order[k + 1][1] : lines.length).join('\n')));
    return out;
  };

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb2b-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    const evidenceDir = path.join(tmp, 'Stamper', 'plan-data', SLUG, 'evidence');
    for (const r of readJson<Array<{ path: string; record: unknown }>>('stamper-evidence-run23.json')) {
      const file = path.join(evidenceDir, ...r.path.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(r.record));
    }
    const stamperEvidence = new StamperEvidenceLoader(SLUG).loadEvidenceForTenant();
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
      assessment: readJson<AssessmentSnapshot>('snapshot-run23.json'),
      ledger: readJson<DeterminationLedger>('ledger-run23.json'),
      variables: {},
      tenantSlug: SLUG,
      stamperEvidence,
    });
    controls = ssp.controlImplementations;
    blocks = await buildBlocks(ssp);
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  test('every control heading is still found and its block lists one approach line per objective', () => {
    expect(controls).toHaveLength(110);
    expect(blocks.size).toBe(110);
    for (const c of controls) {
      const b = blocks.get(c.control_id)!;
      expect({ id: c.control_id, has: b.includes('Assessment approach:') }).toEqual({ id: c.control_id, has: true });
      for (const o of c.assessmentApproach!.objectives) expect({ id: o.objectiveId, has: b.includes(o.text) }).toEqual({ id: o.objectiveId, has: true });
    }
  });

  test('approach lines never say Not Applicable / N/A (V31)', () => {
    for (const c of controls) for (const o of c.assessmentApproach!.objectives) expect(o.text).not.toMatch(/Not Applicable|\bN\/A\b/);
  });

  test('a not-assessed control block stays clean under the V31 parse with the approach rendered', async () => {
    const plan = JSON.parse(JSON.stringify(ssp));
    const target = plan.controlImplementations.find((c: any) => c.status === 'not_assessed') ?? plan.controlImplementations[0];
    target.status = 'not_assessed';
    const b = (await buildBlocks(plan)).get(target.control_id)!;
    expect(b).toContain('Assessment approach:');
    expect(b).not.toMatch(/Not Applicable|\bN\/A\b/);
  });

  test('a control without an approach renders no approach label', async () => {
    const plan = JSON.parse(JSON.stringify(ssp));
    delete plan.controlImplementations[0].assessmentApproach;
    const b = (await buildBlocks(plan)).get(plan.controlImplementations[0].control_id)!;
    expect(b).not.toContain('Assessment approach:');
  });
});
