// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-11 / MG-18: the report renderer (headless renderReports) and the Plan
// tab downloads. Content parity with Planner per fixture is planParity's job
// (parityHarness: the report artifacts against reportGoldens); this file
// checks the headless entry point, the exclusions report's exact equality
// and that each report downloads from the Plan tab.
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, vi, beforeAll, afterEach } from 'vitest';
import { db } from '@/shared/db/schema';
import type { PlanCompileResult } from '../../planCompileService';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('../../__tests__/planTestSupport');
  const banks = loadBanks();
  return { loadCompilerBanks: async () => banks, _resetCompilerBanksCache: () => {} };
});
const downloads: Array<{ filename: string; content: string; mime: string }> = [];
vi.mock('../downloadText', () => ({
  downloadText: (filename: string, content: string, mime: string) => downloads.push({ filename, content, mime }),
}));

const { compilePlanForSession } = await import('../../planCompileService');
const { renderReports, REPORT_FILES } = await import('../planReports');
const { buildSessionQuestionSet } = await import('../sessionReports');
const { loadCustomer, reportBanks, diffArtifact, normalize } = await import('../../__tests__/parityHarness');
const { freezeEntropy } = await import('../../__tests__/fixtureInputs');

let compiled: PlanCompileResult;
let files: Record<string, string>;

beforeAll(async () => {
  const { musterSession } = loadCustomer('a');
  await db.engagements.put(musterSession.engagement);
  await db.assessed_parties.put(musterSession.party);
  await db.interview_sessions.put(musterSession.session);
  const entropy = freezeEntropy();
  try {
    compiled = await compilePlanForSession(musterSession.session.id);
    const banks = reportBanks();
    const qs = await buildSessionQuestionSet(musterSession.session.facts, musterSession.session.selected_stacks ?? [], banks.rrQuestionBank, banks);
    files = renderReports(compiled, banks, qs);
  } finally {
    entropy.restore();
  }
}, 120_000);

describe('MG-11 / MG-18: renderReports (headless)', () => {
  test('emits each report as JSON and in Planner download format', () => {
    expect(Object.keys(files).sort()).toEqual(Object.values(REPORT_FILES).sort());
    expect(files[REPORT_FILES.exclusionsText]).toContain('EXCLUSIONS REPORT');
    for (const f of [REPORT_FILES.traceabilityHtml, REPORT_FILES.controlAssessmentHtml, REPORT_FILES.techRefHtml]) {
      expect(files[f]).toMatch(/<html/i);
    }
    expect(JSON.parse(files[REPORT_FILES.traceabilityJson]).ces.artifact).toBe('traceability_report');
    expect(JSON.parse(files[REPORT_FILES.techRefJson]).ces.artifact).toBe('tech_ref_implementation_guide');
  });

  test('fixture (a): the exclusions report equals the Planner golden derived from its RR Question Set', () => {
    const { goldens } = loadCustomer('a');
    const muster = JSON.parse(files[REPORT_FILES.exclusionsJson]);
    expect(diffArtifact('exclusions-report', goldens['exclusions-report'], muster)).toEqual([]);
  });

  test('the tech-ref guide and control assessment read the one posture (MG-03)', () => {
    const rows = (compiled.posture as { ces: { requirement_results: Array<{ requirement_id: string; status: string }> } }).ces
      .requirement_results;
    const status = new Map(rows.map((r) => [r.requirement_id, r.status]));
    const guide = JSON.parse(files[REPORT_FILES.techRefJson]);
    for (const fam of guide.control_families) {
      for (const c of fam.controls) {
        expect(c.status).toBe((status.get(c.control_id) ?? 'unknown').toUpperCase());
      }
    }
    const ca = JSON.parse(files[REPORT_FILES.controlAssessmentJson]);
    for (const c of ca.controls) if (status.has(c.requirement_id)) expect(c.readiness_status).toBe(status.get(c.requirement_id));
    expect(normalize(ca.ces.artifact)).toBe('control_assessment_report');
  });
});

describe('V58: a simulated customer marks every report file; a real one is unchanged', () => {
  const SIM = { simulated: true as const, legalName: 'Testfield Widgets LLC (FICTIONAL)', disclaimer: 'Invented <for> the simulator & tests.' };
  const MARK = 'SIMULATED CUSTOMER (FICTIONAL): Testfield Widgets LLC (FICTIONAL)';

  test('all 8 files carry the marker: JSON a leading simulation object, HTML a paragraph after <body>, text the first line', async () => {
    const banks = reportBanks();
    const { musterSession } = loadCustomer('a');
    const qs = await buildSessionQuestionSet(musterSession.session.facts, musterSession.session.selected_stacks ?? [], banks.rrQuestionBank, banks);
    const entropy = freezeEntropy();
    let sim: Record<string, string>;
    try {
      sim = renderReports(compiled, banks, qs, SIM);
    } finally {
      entropy.restore();
    }
    expect(Object.keys(sim).sort()).toEqual(Object.keys(files).sort());
    for (const [name, content] of Object.entries(sim)) {
      expect(content.includes(MARK), name).toBe(true);
      expect(files[name].includes('SIMULATED CUSTOMER'), name).toBe(false);
      if (name.endsWith('.json')) {
        const o = JSON.parse(content);
        expect(Object.keys(o)[0], name).toBe('simulation');
        expect(o.simulation, name).toEqual({ simulated: true, fictional: true, legalName: SIM.legalName, marker: MARK, disclaimer: SIM.disclaimer });
        const { simulation: _s, ...rest } = o;
        expect(rest, name).toEqual(JSON.parse(files[name]));
      } else if (name.endsWith('.html')) {
        expect(content, name).toMatch(/<body[^>]*>\n<p class="simulated-customer"><strong>SIMULATED CUSTOMER \(FICTIONAL\): Testfield Widgets LLC \(FICTIONAL\)<\/strong> Invented &lt;for&gt; the simulator &amp; tests\.<\/p>/);
        expect(content.replace(/\n<p class="simulated-customer">.*?<\/p>/, ''), name).toBe(files[name]);
      } else {
        expect(content, name).toBe(`${MARK}\n${SIM.disclaimer}\n\n${files[name]}`);
      }
    }
  });
});

// ── Plan tab downloads ─────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('MG-11 / MG-18: each report downloads from the Plan tab', () => {
  test('exclusions (.txt), traceability, control assessment and tech-ref guide (.html)', async () => {
    const { default: PlanTab } = await import('../../PlanTab');
    const sessionId = loadCustomer('a').musterSession.session.id;
    // The SPA's static /knowledge assets (the RR Question Bank), served from public/.
    vi.stubGlobal('fetch', async (url: string) => {
      const file = path.resolve(process.cwd(), 'public', decodeURI(String(url)).replace(/^\//, ''));
      const text = fs.readFileSync(file, 'utf8');
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
    act(() => root.render(<PlanTab completedSessionId={sessionId} />));
    await act(async () => q('plan-generate-btn')!.click());
    for (let i = 0; i < 60 && !q('plan-reports'); i++) await flush();
    expect(q('plan-reports')).not.toBeNull();
    downloads.length = 0;
    for (const id of ['exclusions-report', 'traceability-report', 'control-assessment-report', 'tech-ref-guide']) {
      await act(async () => q(`plan-download-${id}`)!.click());
      for (let i = 0; i < 60 && downloads.length === 0; i++) await flush();
      expect(q('plan-report-error')).toBeNull();
      const d = downloads.pop();
      expect(d, id).toBeDefined();
      expect(d!.content.length).toBeGreaterThan(100);
      expect(d!.filename).toMatch(new RegExp(`^${id === 'tech-ref-guide' ? 'tech-ref-implementation-guide' : id}-simtenant-a-.*\\.(txt|html)$`));
      expect(d!.mime).toMatch(id === 'exclusions-report' ? /^text\/plain/ : /^text\/html/);
    }
    // W8-FMT: the Mission Plan and Tenant Manifest HTML views (Planner's formatters).
    for (const [id, label, prefix] of [
      ['mission-plan-html', 'Mission Plan (HTML view)', 'manual-mission-plan'],
      ['tenant-manifest-html', 'Tenant Manifest (HTML view)', 'tenant-manifest'],
    ] as const) {
      expect(q(`plan-report-${id}`)!.textContent).toContain(label);
      await act(async () => q(`plan-download-${id}`)!.click());
      for (let i = 0; i < 60 && downloads.length === 0; i++) await flush();
      expect(q('plan-report-error')).toBeNull();
      const d = downloads.pop();
      expect(d, id).toBeDefined();
      expect(d!.content).toMatch(/^<!DOCTYPE html>/);
      expect(d!.filename).toMatch(new RegExp(`^${prefix}-simtenant-a-.*\\.html$`));
      expect(d!.mime).toBe('text/html;charset=utf-8');
    }
  }, 180_000);
});
