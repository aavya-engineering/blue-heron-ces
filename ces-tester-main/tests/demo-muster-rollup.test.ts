// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-6 — `muster-rollup` (D.17), the prime's subcontractor RAG board.
 *
 * ces-tester has no Ajv (Playwright is the only dep; the SPA's own Ajv validates
 * at import time), so these hand-assert the two things a browser test could not
 * cheaply pin: (1) every SAMPLE StatusPayload matches the fields and enums the
 * ces-muster `status-payload.schema.json` requires — a drifted sample would be
 * silently dropped by the real board — and (2) the driver walks the rollup in the
 * one order the SPA allows (declare the prime engagement, begin it, THEN the
 * rollup nav appears). The honesty guard — every party name labeled `(sample)` —
 * is asserted here so it cannot be quietly removed.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SAMPLE_FLEET,
  fleetSummary,
  ragOf,
  readoutHtml,
  writeSampleFleet,
  type StatusPayload,
} from '../src/demo/show/ops/muster-rollup-op.js';
import { driveMusterRollup, MUSTER_SELECTORS } from '../src/demo/muster-ui-driver.js';
import { FakeUiPage } from './helpers/fake-ui-page.js';

const CONFIDENCE = new Set(['high', 'medium', 'low', 'unknown']);
const ON_PREM = new Set(['yes', 'no', 'unsure']);
const SEGMENTS = new Set(['setup', 'interview', 'verification', 'review']);

/** The required-field / enum check the SPA's Ajv does for real at import time. */
function assertSchemaShape(p: StatusPayload, label: string): void {
  expect(p.schema_version, label).toBe('1.0.0');
  expect(['prime_and_subs', 'individual_contractor'], label).toContain(p.engagement_kind);
  expect(typeof p.party.name, label).toBe('string');
  expect(p.party.name.length, label).toBeGreaterThan(0);
  expect(ON_PREM.has(p.on_prem_ot), label).toBe(true);
  expect(Array.isArray(p.interview_facts), label).toBe(true);
  for (const f of p.interview_facts) {
    for (const key of ['question_id', 'question_text', 'answer', 'provenance', 'recorded_at'] as const) {
      expect(typeof f[key], `${label}.${key}`).toBe('string');
      expect(f[key].length, `${label}.${key}`).toBeGreaterThan(0);
    }
    expect(CONFIDENCE.has(f.confidence), `${label}.confidence`).toBe(true);
  }
  const ps = p.posture_summary;
  expect(typeof ps.conservative_score, label).toBe('number');
  expect(ps.conservative_score, label).toBeGreaterThanOrEqual(0);
  expect(ps.conservative_score, label).toBeLessThanOrEqual(100);
  const css = ps.control_status_summary;
  expect(typeof css.level, label).toBe('string');
  for (const key of ['met', 'partial', 'not_met', 'unknown'] as const) {
    expect(typeof css[key], `${label}.${key}`).toBe('number');
    expect(css[key], `${label}.${key}`).toBeGreaterThanOrEqual(0);
  }
  expect(p.timing_segments.length, label).toBeGreaterThan(0);
  for (const s of p.timing_segments) {
    expect(SEGMENTS.has(s.segment), `${label}.segment`).toBe(true);
    expect(typeof s.started_at, `${label}.started_at`).toBe('string');
  }
}

describe('the sample fleet is schema-shaped and honestly labeled', () => {
  it('has five subs, each matching the StatusPayload required fields and enums (MR1)', () => {
    expect(SAMPLE_FLEET).toHaveLength(5);
    SAMPLE_FLEET.forEach((p) => assertSchemaShape(p, p.party.name));
  });

  it('labels every party name `(sample)` so the board never reads as live results (MR2)', () => {
    for (const p of SAMPLE_FLEET) expect(p.party.name).toContain('(sample)');
  });

  it('carries no extra keys the strict schema would reject', () => {
    const allowedTop = ['schema_version', 'engagement_kind', 'party', 'on_prem_ot', 'interview_facts', 'posture_summary', 'timing_segments'];
    for (const p of SAMPLE_FLEET) {
      expect(Object.keys(p).sort()).toEqual([...allowedTop].sort());
      expect(Object.keys(p.party).every((k) => ['name', 'uei', 'cage'].includes(k))).toBe(true);
      expect(Object.keys(p.posture_summary).sort()).toEqual(['conservative_score', 'control_status_summary'].sort());
    }
  });
});

describe('ragOf and fleetSummary', () => {
  it('applies the board thresholds (>=70 green, >=40 amber, else red)', () => {
    expect(ragOf(70)).toBe('green');
    expect(ragOf(69)).toBe('amber');
    expect(ragOf(40)).toBe('amber');
    expect(ragOf(39)).toBe('red');
  });

  it('computes the spread the board renders — 2 green / 2 amber / 1 red, 2 on-prem (MR2)', () => {
    const s = fleetSummary();
    expect(s.total).toBe(5);
    expect({ green: s.green, amber: s.amber, red: s.red }).toEqual({ green: 2, amber: 2, red: 1 });
    expect(s.onPrem).toBe(2);
  });
});

describe('writeSampleFleet', () => {
  it('writes one parseable JSON file per sub, in order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollup-'));
    try {
      const paths = writeSampleFleet(dir);
      expect(paths).toHaveLength(SAMPLE_FLEET.length);
      paths.forEach((p, i) => {
        expect(fs.existsSync(p)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as StatusPayload;
        expect(parsed.party.name).toBe(SAMPLE_FLEET[i].party.name);
        assertSchemaShape(parsed, p);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readoutHtml (the degraded card)', () => {
  it('names the fleet as sample and never claims a live surface', () => {
    const html = readoutHtml();
    expect(html.toLowerCase()).toContain('sample');
    expect(html).toContain('not evaluated in this run');
    for (const p of SAMPLE_FLEET) expect(html).toContain(p.party.name);
    // RAG labels present.
    expect(html).toContain('GREEN');
    expect(html).toContain('RED');
  });
});

describe('driveMusterRollup walks the rollup in the SPA-required order (MR3)', () => {
  function rollupPage(rows: number, formErrors: string[] = []): FakeUiPage {
    const page = new FakeUiPage({
      counts: { [MUSTER_SELECTORS.rollupRow]: rows },
      lists: {
        [MUSTER_SELECTORS.rollupBadge]: ['GREEN', 'GREEN', 'AMBER', 'AMBER', 'RED'],
        [MUSTER_SELECTORS.rollupFormError]: formErrors,
      },
    });
    return page;
  }

  it('declares the prime engagement and begins it BEFORE the rollup nav, then imports one file per sub', async () => {
    const page = rollupPage(5);
    const paths = ['a.json', 'b.json', 'c.json', 'd.json', 'e.json'];
    const result = await driveMusterRollup(page, paths);

    expect(result.rowCount).toBe(5);
    expect(result.formErrors).toEqual([]);
    expect(result.badges).toHaveLength(5);

    // The ordering the SPA forces: kind → begin → rollup nav → roster → imports.
    const kind = page.indexOf(`check ${MUSTER_SELECTORS.rollupEngagementKind}`);
    const begin = page.indexOf(`click ${MUSTER_SELECTORS.beginInterview}`);
    const nav = page.indexOf(`click ${MUSTER_SELECTORS.rollupNav}`);
    const roster = page.indexOf(`wait ${MUSTER_SELECTORS.rosterSection}`);
    const firstImport = page.indexOf('setInputFiles');
    expect(kind).toBeGreaterThanOrEqual(0);
    expect(kind).toBeLessThan(begin);
    expect(begin).toBeLessThan(nav);
    expect(nav).toBeLessThan(roster);
    expect(roster).toBeLessThan(firstImport);

    // Exactly one import per sub.
    const imports = page.actions.filter((a) => a.startsWith('setInputFiles'));
    expect(imports).toHaveLength(paths.length);
  });

  it('returns a schema form-error verbatim so the caller can fail the beat', async () => {
    const page = rollupPage(4, ['bad.json: schema validation failed — must have required property']);
    const result = await driveMusterRollup(page, ['a.json', 'b.json', 'c.json', 'd.json']);
    expect(result.formErrors).toHaveLength(1);
    expect(result.formErrors[0]).toContain('schema validation failed');
  });
});
