// Gap closure FLOW-3 (V84): src/flow/eo-intake.ts. The intake body is built from a pushed plans folder and E3's
// policy texts; postEoIntake records EO's receipt (or the refusal) in out/eo-intake.json. Temp files and a fake fetch.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildEoIntakeBody, postEoIntake, EO_INTAKE_SCHEMA } from '../src/flow/eo-intake.js';
import { perRunArtefacts } from '../src/flow/muster-e2e-run.js';

function plansFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-intake-'));
  const plans = path.join(root, 'plans');
  const policies = path.join(root, 'policies');
  fs.mkdirSync(plans);
  fs.mkdirSync(policies);
  const ts = '2026-10-30T12-00-00-000Z';
  const w = (name: string, v: unknown) => fs.writeFileSync(path.join(plans, name), JSON.stringify(v, null, 2));
  w(`manual-mission-plan-sx-${ts}.json`, { plan: 1 });
  w(`tenant-manifest-sx-${ts}.json`, { tm: 1 });
  w(`cui-boundary-sx-${ts}.json`, { artifact_id: 'cui-1' });
  w(`policy-set-manifest-sx-${ts}.json`, { artifact: { documents: [{ name: 'policies/access-control-policy.md', sha256: 'x' }, { name: 'policies/poam.md', sha256: 'y' }] } });
  fs.writeFileSync(path.join(policies, 'access-control-policy.md'), '# Access Control Policy\r\n');
  fs.writeFileSync(path.join(policies, 'access-control-policy.docx'), 'not sent');
  return { root, plans, policies, ts };
}

describe('FLOW-3 EO intake (harness E7)', () => {
  it('builds the bundle from the pushed files, names each part, and adds the manifest-listed policy texts', () => {
    const f = plansFixture();
    const built = buildEoIntakeBody(f.plans, 'sx', f.policies);
    expect(built.body.tenant_slug).toBe('sx');
    expect(built.body.missionPlan).toEqual({ plan: 1 });
    expect(built.body.cui_boundary).toEqual({ artifact_id: 'cui-1' });
    expect(built.body.file_names).toEqual({
      mission_plan: `manual-mission-plan-sx-${f.ts}.json`,
      tenant_manifest: `tenant-manifest-sx-${f.ts}.json`,
      policy_set_manifest: `policy-set-manifest-sx-${f.ts}.json`,
      cui_boundary: `cui-boundary-sx-${f.ts}.json`,
    });
    expect(built.body.policies).toEqual([{ name: 'policies/access-control-policy.md', markdown: '# Access Control Policy\r\n' }]);
    expect(built.policies).toBe(1);
    expect(built.missing).toEqual(['policies/poam.md']);
    fs.rmSync(f.root, { recursive: true, force: true });
  });

  it('FIN-35 S-1 (GD-e): takes the three EO-only envelopes from out/plan when the plans folder no longer holds them', () => {
    const f = plansFixture();
    const planDir = path.join(f.root, 'plan');
    fs.mkdirSync(planDir);
    const hts = '2026-10-30T11-00-00-000Z';
    fs.writeFileSync(path.join(planDir, `si-baseline-sx-${hts}.json`), JSON.stringify({ artifact_id: 'si-1' }));
    fs.writeFileSync(path.join(planDir, `readiness-posture-sx-${hts}.json`), JSON.stringify({ artifact_id: 'rp-1' }));
    // A Stamper-stored kind in out/plan is never taken from there (the plans folder is the pushed source).
    fs.writeFileSync(path.join(planDir, `policy-inputs-profile-sx-${hts}.json`), JSON.stringify({ artifact_id: 'pp-headless' }));
    const built = buildEoIntakeBody(f.plans, 'sx', f.policies, planDir);
    expect(built.body.si_baseline).toEqual({ artifact_id: 'si-1' });
    expect(built.body.readiness_posture).toEqual({ artifact_id: 'rp-1' });
    expect(built.body.tcp).toBeUndefined();
    expect(built.body.policy_inputs_profile).toBeUndefined();
    expect((built.body.file_names as Record<string, string>).si_baseline).toBe(`si-baseline-sx-${hts}.json`);
    expect((built.body.file_names as Record<string, string>).readiness_posture).toBe(`readiness-posture-sx-${hts}.json`);
    // Without planDir the body is as before (no EO-only parts).
    expect(buildEoIntakeBody(f.plans, 'sx', f.policies).body.si_baseline).toBeUndefined();
    fs.rmSync(f.root, { recursive: true, force: true });
  });

  it('records a delivered receipt and a refusal; never throws', async () => {
    const f = plansFixture();
    const out = path.join(f.root, 'eo-intake.json');
    const seen: Array<{ url: string; auth: string | undefined; body: Record<string, unknown> }> = [];
    const ok = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ receipt_id: 'intake-1', items: [] }), { status: 201 });
    }) as unknown as typeof fetch;
    const r = await postEoIntake('http://eo', { Authorization: 'Bearer t' }, buildEoIntakeBody(f.plans, 'sx', f.policies), out, ok);
    expect(r.status).toBe('delivered');
    expect(seen[0]!.url).toBe('http://eo/api/intake/muster');
    expect(seen[0]!.auth).toBe('Bearer t');
    const rec = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(rec).toMatchObject({ schema: EO_INTAKE_SCHEMA, status: 'delivered', http: 201, receipt: { receipt_id: 'intake-1' } });
    expect(rec.sent.parts).toEqual(['missionPlan', 'tenantManifest', 'policy_set_manifest', 'cui_boundary']);

    const refused = (async () => new Response(JSON.stringify({ error: 'Intake bundle violation', details: ['x'] }), { status: 400 })) as unknown as typeof fetch;
    const r2 = await postEoIntake('http://eo', {}, buildEoIntakeBody(f.plans, 'sx', f.policies), out, refused);
    expect(r2).toMatchObject({ status: 'failed', http: 400 });
    expect(r2.error).toContain('Intake bundle violation');
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await postEoIntake('http://eo', {}, buildEoIntakeBody(f.plans, 'sx', f.policies), out, down)).toMatchObject({ status: 'failed', http: null, error: 'ECONNREFUSED' });
    fs.rmSync(f.root, { recursive: true, force: true });
  });

  it('out/eo-intake.json is a per-run artefact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-intake-clean-'));
    fs.writeFileSync(path.join(root, 'eo-intake.json'), '{}');
    expect(perRunArtefacts(root, path.join(root, 'pl'), 'sx')).toContain(path.join(root, 'eo-intake.json'));
    fs.rmSync(root, { recursive: true, force: true });
  });
});
