// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// P12-MU (V130): the E9M import / AI-gate probe (muster-e2e-run.ts runV130Imports, v130ImportsProblems).
// A fake http answers as muster-api does; nothing starts a server or the sim.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runV130Imports, v130ImportsProblems, V130_IMPORT_PROBE_SLUG, V130_KIT_RESULTS_FILE, type V130Http } from '../src/flow/muster-e2e-run.js';

function fixture(): { dir: string; disc: string; compileRecord: string; planDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v130-imports-'));
  const disc = path.join(dir, 'discovery-result.json');
  fs.writeFileSync(disc, JSON.stringify({ schema_version: 'readiness-result/1.1.0', manifest: {}, observations: [{ control_id: 'AC.L2-3.1.1' }, { control_id: 'IA.L2-3.5.3' }] }));
  const compileRecord = path.join(dir, 'plan-compile.json');
  fs.writeFileSync(compileRecord, JSON.stringify({ http_status: 200, files: [{ name: 'a' }, { name: 'b' }] }));
  const planDir = path.join(dir, 'plan');
  fs.mkdirSync(planDir);
  fs.writeFileSync(path.join(planDir, 'readiness-result-s1-mach.json'), '{}');
  return { dir, disc, compileRecord, planDir };
}

type Answer = (url: string, body: unknown) => V130Http;
const j = (status: number, json: unknown): V130Http => ({ status, json, text: JSON.stringify(json) });
/** muster-api with the AI gate closed (no key): compile refusals carry the runner's "Import failed" line. */
const degradedApi: Answer = (url, body) => {
  if (url.endsWith('/api/plan/compile')) {
    const d = JSON.parse((body as { discovery: string }).discovery) as Record<string, unknown>;
    const msg = d.schema_version ? 'Import failed: the payload does not validate against readiness-result/1.1.0: {"instancePath":"/observations"}' : 'Import failed: not a readiness-result payload (schema_version missing or not one of readiness-result/1.0.0, readiness-result/1.1.0).';
    return j(422, { error: 'plan compile failed', detail: `plan-from-discovery failed: Error: ${msg}\n    at parseReadinessResultFile (importReadinessResult.ts:52:11)` });
  }
  if (url.endsWith('/adaptive/next') || url.endsWith('/coach/chat')) return j(503, { degraded: true });
  if (url.endsWith('/retro-confidence')) return j(200, { results: [{ question_id: 'v130-probe-question', confidence: 'low', weight: 3 }] });
  return j(404, {});
};

async function probe(answer: Answer, f = fixture()) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const rec = await runV130Imports({
    api: 'http://api.invalid', token: 'not-a-token', slug: 's1-mach', disc: f.disc, compileRecord: f.compileRecord, planDir: f.planDir,
    http: async (method, url, body) => { calls.push({ method, url, body }); return answer(url, body); },
  });
  return { rec, calls };
}

describe('V130 import / AI-gate probe (P12-MU)', () => {
  it('records the E3 readiness import, two 422 refusals on the probe slug, and the AI gate off', async () => {
    const { rec, calls } = await probe(degradedApi);
    expect(rec.readiness_import).toMatchObject({ e3_http_status: 200, e3_files: 2, disc_schema_version: 'readiness-result/1.1.0', disc_observations: 2, plan_readiness_file: 'readiness-result-s1-mach.json' });
    expect(rec.readiness_import.disc_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.refusals.map((r) => [r.name, r.status, r.import_failed])).toEqual([['collector-kit results file', 422, true], ['schema-invalid readiness file', 422, true]]);
    const compiles = calls.filter((c) => c.url.endsWith('/api/plan/compile'));
    expect(compiles.every((c) => (c.body as { tenant_slug: string }).tenant_slug === V130_IMPORT_PROBE_SLUG)).toBe(true);
    expect(JSON.parse((compiles[0].body as { discovery: string }).discovery)).toEqual(V130_KIT_RESULTS_FILE);
    expect(rec.ai).toMatchObject({ gate: 'off', adaptive_status: 503, coach_status: 503, retro_status: 200, retro_all_low: true });
    expect(v130ImportsProblems(rec)).toEqual([]);
  });

  it('never calls retro-confidence when the AI gate is open (no model call), and reads the gate as on', async () => {
    const { rec, calls } = await probe((url, body) => (url.endsWith('/adaptive/next') || url.endsWith('/coach/chat') ? j(400, { error: {} }) : degradedApi(url, body)));
    expect(calls.some((c) => c.url.endsWith('/retro-confidence'))).toBe(false);
    expect(rec.ai.gate).toBe('on');
    expect(v130ImportsProblems(rec)).toEqual([]);
  });

  it('fails a compile route that ingests a collector-kit file, and an unclear AI gate', async () => {
    const { rec } = await probe((url, body) => {
      if (url.endsWith('/api/plan/compile') && !(JSON.parse((body as { discovery: string }).discovery) as Record<string, unknown>).schema_version) return j(200, { files: [] });
      if (url.endsWith('/coach/chat')) return j(500, {});
      return degradedApi(url, body);
    });
    const p = v130ImportsProblems(rec);
    expect(p.some((x) => /collector-kit results file: HTTP 200/.test(x))).toBe(true);
    expect(p.some((x) => /AI gate unclear/.test(x))).toBe(true);
  });

  it('fails without E3 evidence (no compile record, no discovery file) and without a block', async () => {
    const f = fixture();
    fs.rmSync(f.compileRecord);
    fs.rmSync(f.disc);
    const { rec } = await probe(degradedApi, f);
    const p = v130ImportsProblems(rec);
    expect(p.some((x) => /E3 compile HTTP null/.test(x))).toBe(true);
    expect(p.some((x) => /discovery file missing/.test(x))).toBe(true);
    expect(v130ImportsProblems(null)).toEqual(['no imports block']);
  });
});
