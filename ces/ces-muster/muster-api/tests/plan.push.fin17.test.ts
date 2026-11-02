// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-17: Muster's own EO intake call is recorded (muster-eo-calls.jsonl) with EO's receipt id and
// whether each receipt hash equals the pushed file's SHA-256 (V114); the push carries the CG-8
// `COST_RECURRING:` line in its 201 warnings and in the write-once push record (V104). Never blocks.
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';
import { CesRepository, getCesDbPath } from 'ces-shared/persistence/node';
import { createPlanRouter, intakeReceiptCheck, musterCallLogPath, pushCostRecurringLine } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const baseMp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
const TOKEN = mintToken({ sub: 'fin17-operator', tenant_id: '00000000-0000-0000-0000-0000000000f7', party_id: null, role: 'bhd_operator' });

const NOTICE = {
  price_date: '2026-10-30',
  items: [
    { item_id: 'AZ-LAW-001', kind: 'registry_entry', label: 'Log Analytics workspace', cost_key: 'law', estimate_month_low: 2.3, estimate_month_high: 46, basis: 'per GB', two_person: false, last_resort: false, standard_alternative: [], why_in_plan: 'SIT-020 = m365_azure' },
    { item_id: 'IM-FW-001', kind: 'infra_resource', label: 'Defender for Servers P1', cost_key: 'mdc', estimate_month_low: 4.7, estimate_month_high: 82.75, basis: 'per server', two_person: false, last_resort: false, standard_alternative: [], why_in_plan: 'SIT-020 = m365_azure' },
  ],
  licence_dependencies: [],
  total_estimate_low: 7,
  total_estimate_high: 128.75,
  items_hash: 'b'.repeat(64),
  note: 'Muster lists these items; it does not turn them on.',
};
const mpWithNotice = { ...baseMp, recurring_cost_notice: NOTICE };

let server: http.Server;
let base: string;
let eo: http.Server;
let eoBase: string;
let tmpRoot: string;
let corruptHash = false;

const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-fin17-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/plan', createPlanRouter());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // A stand-in EO intake that hashes like ces-eo's intake-router: sha256(JSON.stringify(doc, null, 2)).
  const eoApp = express();
  eoApp.use(express.json({ limit: '5mb' }));
  eoApp.post('/api/intake/muster', (req, res) => {
    const b = req.body as Record<string, any>;
    const names = (b.file_names ?? {}) as Record<string, string>;
    const items = [
      { kind: 'mission_plan', doc: b.missionPlan },
      { kind: 'tenant_manifest', doc: b.tenantManifest },
    ].map(({ kind, doc }) => ({ kind, file_name: names[kind], sha256: sha(JSON.stringify(doc, null, 2)) }));
    if (corruptHash) items[0]!.sha256 = '0'.repeat(64);
    res.status(201).json({ schema: 'ces-eo/muster-intake-receipt@1', receipt_id: 'intake-fin17', items });
  });
  eo = eoApp.listen(0);
  eoBase = `http://127.0.0.1:${(eo.address() as { port: number }).port}`;
});

afterAll(() => {
  server?.close();
  eo?.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
  delete process.env.CES_EO_URL;
  delete process.env.CES_EO_AUTH_TOKEN;
});

beforeEach(() => {
  corruptHash = false;
  process.env.CES_EO_URL = eoBase;
  process.env.CES_EO_AUTH_TOKEN = 'eo-secret';
});

const push = (slug: string, missionPlan: unknown) => fetch(`${base}/api/plan/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ tenant_slug: slug, missionPlan, tenantManifest: tm }),
});

const lines = (slug: string) =>
  fs.readFileSync(musterCallLogPath(slug), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l) as Record<string, any>);

function pushRecordOf(slug: string): Record<string, any> {
  const repo = new CesRepository(getCesDbPath());
  try {
    const rows = repo.list<Record<string, any>>('muster_plan_push', { tenantSlug: slug }) as unknown as Array<{ id: string; data: Record<string, any> }>;
    const row = rows.find((r) => r.id.startsWith(`${slug}:`));
    if (!row) throw new Error(`no push record for ${slug}`);
    return row.data;
  } finally {
    repo.close();
  }
}

describe('FIN-17: Muster records its own EO intake call (V114)', () => {
  test('delivered: one eo_intake line; every pushed MP/TM hash equals the receipt; the 201 body carries the check', async () => {
    const res = await push('fin17-ok', baseMp);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { pushed: string[]; eo_intake: { status: string }; eo_intake_check: Record<string, any> };
    expect(body.eo_intake.status).toBe('delivered');
    expect(body.eo_intake_check).toEqual({ receipt_id: 'intake-fin17', matched: body.pushed.slice(0, 2), mismatched: [], missing: [] });
    const recs = lines('fin17-ok');
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ event: 'eo_intake', tenant_slug: 'fin17-ok', status: 'delivered', http: 201, mission_plan: body.pushed[0] });
    expect(recs[0]!.check).toEqual(body.eo_intake_check);
    // The recorded pushed hashes are the plans-folder bytes.
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'fin17-ok', 'plans');
    for (const f of recs[0]!.pushed as Array<{ name: string; sha256: string }>) {
      expect(f.sha256).toBe(sha(fs.readFileSync(path.join(plansDir, f.name), 'utf8')));
    }
  });

  test('a receipt hash that differs is reported as mismatched (and the push still succeeds)', async () => {
    corruptHash = true;
    const res = await push('fin17-bad', baseMp);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { pushed: string[]; eo_intake_check: Record<string, any> };
    expect(body.eo_intake_check.mismatched).toEqual([body.pushed[0]]);
    expect(lines('fin17-bad')[0]!.check.mismatched).toEqual([body.pushed[0]]);
  });

  test('not configured / unreachable: recorded with its status, no check', async () => {
    delete process.env.CES_EO_URL;
    expect((await push('fin17-off', baseMp)).status).toBe(201);
    expect(lines('fin17-off')[0]).toMatchObject({ event: 'eo_intake', status: 'not_configured', http: null, check: null });
    process.env.CES_EO_URL = 'http://127.0.0.1:1';
    expect((await push('fin17-down', baseMp)).status).toBe(201);
    const down = lines('fin17-down')[0]!;
    expect(down.status).toBe('failed');
    expect(typeof down.error).toBe('string');
  });

  test('intakeReceiptCheck: only a delivered outcome is checked; unnamed files are missing', () => {
    expect(intakeReceiptCheck({ status: 'not_configured' }, [{ name: 'a', sha256: 'x' }])).toBeNull();
    expect(intakeReceiptCheck({ status: 'delivered', http: 201, receipt: { receipt_id: 'r', items: [{ file_name: 'a', sha256: 'x' }] } }, [
      { name: 'a', sha256: 'x' },
      { name: 'b', sha256: 'y' },
    ])).toEqual({ receipt_id: 'r', matched: ['a'], mismatched: [], missing: ['b'] });
  });
});

describe('FIN-17 / CG-8: the push COST_RECURRING line (V104)', () => {
  test('a plan with recurring items: the line is in the 201 warnings and in the write-once push record', async () => {
    const res = await push('fin17-cost', mpWithNotice);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { warnings: string[] };
    const line = 'COST_RECURRING: 2 items, ~$7-$128.75/month';
    expect(body.warnings).toContain(line);
    expect(pushRecordOf('fin17-cost').warnings).toContain(line);
  });

  test('no notice, 0 items, or a malformed notice: no line, and the push is never blocked', async () => {
    const res = await push('fin17-nocost', baseMp);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { warnings: string[] }).warnings.some((w) => w.startsWith('COST_RECURRING:'))).toBe(false);
    expect(pushCostRecurringLine({ recurring_cost_notice: { ...NOTICE, items: [] } })).toBeNull();
    expect(pushCostRecurringLine({ recurring_cost_notice: { items: 'nope' } })).toBeNull();
    expect(pushCostRecurringLine(null)).toBeNull();
  });

  test('the line text equals the SPA noticeSummary format (one figure when low equals high)', () => {
    expect(pushCostRecurringLine({ recurring_cost_notice: { ...NOTICE, items: [NOTICE.items[0]], total_estimate_low: 4.56, total_estimate_high: 4.56 } }))
      .toBe('COST_RECURRING: 1 items, ~$4.56/month');
  });
});
