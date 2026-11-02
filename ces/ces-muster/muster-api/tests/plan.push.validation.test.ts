// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-15 (D10): POST /api/plan/push runs the cross-artifact gate. A misaligned
// MP/TM is refused with a named error; an override with a reason succeeds,
// flags the pushed plan and leaves an audit record (user, time, reason,
// overridden errors). The router is invoked in-process (no listening socket).
/* eslint-disable @typescript-eslint/no-explicit-any -- in-process req/res doubles */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createPlanRouter } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';
import { runPushGate, operatorValueBlocking } from '../src/services/planPushAudit.js';
import { checkOperatorValues } from '@/features/plan/planValidation';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));

const TOKEN = mintToken({
  sub: 'test-operator',
  tenant_id: '00000000-0000-0000-0000-000000000015',
  party_id: null,
  role: 'bhd_operator',
});

/** The fixture TM without AC.L2-3.1.1's evidence monitor, though the MP expects artifacts for it (validator check 3). */
function misalignedTm() {
  const copy = JSON.parse(JSON.stringify(tm));
  copy.tenant_manifest.evidence_monitors = copy.tenant_manifest.evidence_monitors.filter(
    (m: { control_ids: string[] }) => !m.control_ids.includes('AC.L2-3.1.1'),
  );
  return copy;
}

let tmpRoot: string;
const router = createPlanRouter();

async function push(body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req: any = {
      method: 'POST',
      url: '/push',
      originalUrl: '/api/plan/push',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body,
      get(name: string) {
        return this.headers[name.toLowerCase()];
      },
    };
    let status = 200;
    const res: any = {
      status(code: number) {
        status = code;
        return res;
      },
      json(payload: unknown) {
        resolve({ status, body: payload });
        return res;
      },
      setHeader() {},
    };
    router(req, res, (err?: unknown) => (err ? reject(err) : reject(new Error('route not matched'))));
  });
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-gate-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
});

afterAll(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
});

const stateFile = (slug: string) => path.join(tmpRoot, 'Stamper', 'plan-data', slug, 'state', 'plan-push-audit.jsonl');
const plansDir = (slug: string) => path.join(tmpRoot, 'Stamper', 'plan-data', slug, 'plans');

describe('MG-15: push gate', () => {
  test('the committed fixture MP/TM pass the gate (no blocking errors, no warnings)', () => {
    expect(runPushGate(mp, tm)).toEqual({ blocking: [], warnings: [] });
  });

  test('MG-09 x D10: a failed BTC gate marker in the TM warns; any other uncovered normative control still blocks', () => {
    const withMarker = JSON.parse(JSON.stringify(tm));
    withMarker.tenant_manifest.normative_controls = [
      ...(withMarker.tenant_manifest.normative_controls ?? []),
      { control_id: 'btc_gate_identity verification', description: 'BTC gate failed' },
    ];
    const gate = runPushGate(mp, withMarker);
    expect(gate.blocking).toEqual([]);
    expect(gate.warnings).toEqual([
      'Tenant manifest normative control "btc_gate_identity verification" not present in manual plan control coverage',
    ]);
    withMarker.tenant_manifest.normative_controls.push({ control_id: 'ZZ.L2-9.9.9', description: 'not in the plan' });
    expect(runPushGate(mp, withMarker).blocking).toEqual([
      'MP_TM_CONTROL_MISMATCH: Tenant manifest normative control "ZZ.L2-9.9.9" not present in manual plan control coverage',
    ]);
  });

  test('W6 run 56: a BTC risk normative control (BTC_RISK_*) warns like the gate marker; the push is not refused', () => {
    const withRisk = JSON.parse(JSON.stringify(tm));
    withRisk.tenant_manifest.normative_controls = [
      ...(withRisk.tenant_manifest.normative_controls ?? []),
      { control_id: 'BTC_RISK_BTC-RULE-BYOD-DIRECT_byod_direct_access_high_boundary_risk', description: 'BTC risk' },
    ];
    const gate = runPushGate(mp, withRisk);
    expect(gate.blocking).toEqual([]);
    expect(gate.warnings).toEqual([
      'Tenant manifest normative control "BTC_RISK_BTC-RULE-BYOD-DIRECT_byod_direct_access_high_boundary_risk" not present in manual plan control coverage',
    ]);
  });

  test('an aligned push succeeds without an override and writes no audit record', async () => {
    const r = await push({ tenant_slug: 'gate-aligned', missionPlan: mp, tenantManifest: tm });
    expect(r.status).toBe(201);
    expect(r.body.override).toBe(false);
    expect(fs.existsSync(stateFile('gate-aligned'))).toBe(false);
  });

  test('a misaligned MP/TM push is refused with a named error and nothing is written', async () => {
    const r = await push({ tenant_slug: 'gate-misaligned', missionPlan: mp, tenantManifest: misalignedTm() });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PLAN_VALIDATION_BLOCKED');
    expect(r.body.errors).toEqual([
      'MP_TM_CONTROL_MISMATCH: Control "AC.L2-3.1.1" has expected artifacts but no evidence monitor in tenant manifest',
    ]);
    expect(r.body.error).toContain('MP_TM_CONTROL_MISMATCH');
    expect(fs.existsSync(plansDir('gate-misaligned'))).toBe(false);
  });

  test('a structurally broken TM is refused with STRUCTURE', async () => {
    const r = await push({
      tenant_slug: 'gate-structure',
      missionPlan: mp,
      tenantManifest: { ...tm, tenant_manifest: undefined },
    });
    // The contract check runs first and also rejects it; either way the push is refused.
    expect([400, 409]).toContain(r.status);
  });

  test('an override with a blank reason is still refused', async () => {
    const r = await push({
      tenant_slug: 'gate-blank',
      missionPlan: mp,
      tenantManifest: misalignedTm(),
      validationOverride: { reason: '   ' },
    });
    expect(r.status).toBe(409);
    expect(fs.existsSync(stateFile('gate-blank'))).toBe(false);
  });

  test('an override with a reason succeeds, flags the pushed plan and leaves an audit record', async () => {
    const reason = 'Accepted: AC.L2-3.1.1 evidence is collected manually this cycle';
    const r = await push({
      tenant_slug: 'gate-override',
      missionPlan: mp,
      tenantManifest: misalignedTm(),
      validationOverride: { reason },
    });
    expect(r.status).toBe(201);
    expect(r.body.override).toBe(true);

    const written = JSON.parse(fs.readFileSync(path.join(plansDir('gate-override'), r.body.pushed[0]), 'utf8'));
    expect(written.validation_override).toMatchObject({
      overridden: true,
      reason,
      by: 'test-operator',
      overridden_errors: [expect.stringMatching(/^MP_TM_CONTROL_MISMATCH: /)],
    });

    const lines = fs.readFileSync(stateFile('gate-override'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec).toMatchObject({
      event: 'plan_push_validation_override',
      user: { sub: 'test-operator', tenant_id: '00000000-0000-0000-0000-000000000015', role: 'bhd_operator' },
      tenant_slug: 'gate-override',
      reason,
      overridden_errors: written.validation_override.overridden_errors,
      pushed: r.body.pushed,
    });
    expect(Number.isNaN(Date.parse(rec.at))).toBe(false);
    expect(rec.at).toBe(written.validation_override.at);
  });
});

/** The fixture TM carrying FX-11 operator values: operatorUPN discovered, two placeholders defaulted, one unresolved. */
function tmWithOperatorValues(simOnly: boolean) {
  const copy = JSON.parse(JSON.stringify(tm));
  copy.tenant_manifest.tenant_identity = {
    ...(copy.tenant_manifest.tenant_identity ?? {}),
    operatorUPN: 'operator@fixture.example',
    wifiSsid: 'MUSTER-DEFAULT-SSID',
    securityEmail: 'unset-security-email@example.invalid',
    operator_value_provenance: {
      sim_only: simOnly,
      values: {
        operatorUPN: 'discovered',
        breakGlassUserId: 'defaulted',
        wifiSsid: 'defaulted',
        securityEmail: 'defaulted',
      },
    },
  };
  return copy;
}

describe('FX-11 / MG-15: defaulted operator values', () => {
  test('a push whose operator values are defaulted is refused by name unless the plan is sim-only', async () => {
    const r = await push({ tenant_slug: 'gate-operator', missionPlan: mp, tenantManifest: tmWithOperatorValues(false) });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PLAN_VALIDATION_BLOCKED');
    expect(r.body.errors).toEqual([
      'OPERATOR_VALUE_DEFAULTED: breakGlassUserId: unresolved (not discovered or answered)',
      'OPERATOR_VALUE_DEFAULTED: wifiSsid: placeholder MUSTER-DEFAULT-SSID (not discovered or answered)',
      'OPERATOR_VALUE_DEFAULTED: securityEmail: placeholder unset-security-email@example.invalid (not discovered or answered)',
    ]);
    expect(fs.existsSync(plansDir('gate-operator'))).toBe(false);

    const sim = await push({ tenant_slug: 'gate-operator-sim', missionPlan: mp, tenantManifest: tmWithOperatorValues(true) });
    expect(sim.status).toBe(201);
    expect(sim.body.override).toBe(false);
  });

  test('muster-api and the SPA apply the same operator-value rule', () => {
    for (const simOnly of [false, true]) {
      const t = tmWithOperatorValues(simOnly);
      const spa = checkOperatorValues(t);
      expect(operatorValueBlocking(t)).toEqual(spa.blocking);
      expect(spa.simOnly).toBe(simOnly);
      expect(spa.defaulted).toHaveLength(3);
    }
    expect(operatorValueBlocking(tm)).toEqual([]);
    expect(checkOperatorValues(tm)).toEqual({ simOnly: false, defaulted: [], blocking: [] });
  });
});
