// Gap closure NS-3 (V81): src/flow/eo-records.ts, against a fake EO (in memory, the routes eo-records.ts calls); temp files only.
// ROLE-1 (founder ruling 2026-10-30): the FLOW-6 read-back (src/flow/muster-results.ts, V86) is retired; its tests went with it.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { postEoRecords, type EoCall, type EoRecordPosts, EO_RECORDS_SCHEMA } from '../src/flow/eo-records.js';

const STEPS = ['disable-entra-account', 'revoke-active-sessions', 'unassign-licenses'];

/** In-memory EO: personnel, screening PUT, training, risk register, offboarding wizard. */
function fakeEo(opts: { failRisk?: string } = {}) {
  const people: Array<Record<string, any>> = [];
  const training = new Map<string, Array<{ courseId: string; completedDate: string }>>();
  const risks: Array<Record<string, any>> = [];
  const runs = new Map<string, { currentStepIndex: number; steps: Array<{ id: string; completed: boolean }> }>();
  const calls: string[] = [];
  let n = 0;
  const call: EoCall = async (method, p, body: any) => {
    calls.push(`${method} ${p}`);
    expect(p).toContain('tenant=sx');
    const u = p.split('?')[0];
    const id = u.split('/')[3];
    const person = people.find((x) => x.id === id);
    if (method === 'GET' && u === '/api/personnel') return { status: 200, json: people };
    if (method === 'POST' && u === '/api/personnel') {
      const rec = { id: `id-${++n}`, ...body, screeningState: 'unscreened', evidenceArtifacts: [] };
      people.push(rec);
      return { status: 201, json: rec };
    }
    if (method === 'PUT' && /^\/api\/personnel\/[^/]+$/.test(u)) { Object.assign(person!, body); return { status: 200, json: person }; }
    if (method === 'POST' && u.endsWith('/training/complete')) {
      const list = (training.get(id) ?? []).filter((c) => c.courseId !== body.courseId);
      list.push(body);
      training.set(id, list);
      return { status: 200, json: { completions: list } };
    }
    if (method === 'GET' && u.endsWith('/training')) return { status: 200, json: { state: { completions: training.get(id) ?? [] } } };
    if (method === 'GET' && u === '/api/risk-assessment/register') return { status: 200, json: { entries: risks } };
    if (method === 'POST' && u === '/api/risk-assessment/register/entries') {
      if (body.sourceReference === opts.failRisk) return { status: 500, json: { error: 'boom' } };
      const e = { id: `r-${++n}`, ...body };
      risks.push(e);
      return { status: 201, json: e };
    }
    if (u.endsWith('/offboarding') && method === 'GET') return runs.has(id) ? { status: 200, json: runs.get(id) } : { status: 404, json: { error: 'No active offboarding run' } };
    if (u.endsWith('/offboarding') && method === 'POST') {
      const run = { currentStepIndex: 0, steps: STEPS.map((s) => ({ id: s, completed: false })) };
      runs.set(id, run);
      person!.screeningState = 'offboarding-in-progress';
      return { status: 201, json: run };
    }
    if (u.includes('/offboarding/step/') && method === 'PUT') {
      const run = runs.get(id)!;
      expect(body.attestor).toBeTruthy();
      expect(u.endsWith(`/step/${run.steps[run.currentStepIndex].id}`)).toBe(true);
      run.steps[run.currentStepIndex].completed = true;
      run.currentStepIndex++;
      return { status: 200, json: run };
    }
    if (u.endsWith('/offboarding/complete') && method === 'POST') {
      if (!runs.get(id)!.steps.every((s) => s.completed)) return { status: 400, json: { error: 'Not all steps are completed' } };
      runs.delete(id);
      person!.screeningState = 'offboarded';
      person!.offboardedDate = '2026-10-30T00:00:00.000Z';
      person!.evidenceArtifacts.push({ type: 'offboarding-procedural-overlay' });
      return { status: 200, json: {} };
    }
    return { status: 404, json: { error: `no route ${method} ${u}` } };
  };
  return { call, people, risks, calls };
}

const posts: EoRecordPosts = {
  schema: 'ces-eo-record-posts/1',
  slug: 'sx',
  personnel: [
    { person_id: 'p1', body: { displayName: 'Ann One', email: 'ann@sx.example', role: 'Engineer' }, screening: { screeningState: 'cleared', lastScreenedDate: '2025-01-02' } },
    { person_id: 'p2', body: { displayName: 'Bob Two', email: 'bob@sx.example', role: 'Machinist' }, screening: { screeningState: 'cleared', lastScreenedDate: '2025-01-03' } },
    { person_id: 'p3', body: { displayName: 'Cy Three', email: 'cy@sx.example', role: 'Contractor' }, screening: { screeningState: 'cleared', lastScreenedDate: '2025-01-04' } },
  ],
  training: [{ person_id: 'p1', email: 'ann@sx.example', file: 'training-awareness.json', body: { courseId: 'SX Awareness', completedDate: '2026-07-01' } }],
  risks: [
    { risk_id: 'R-01', body: { sourceReference: 'R-01', threatEvent: 'credential phishing' } },
    { risk_id: 'R-02', body: { sourceReference: 'R-02', threatEvent: 'delayed account disablement' } },
  ],
  offboarding: [
    { person_id: 'p2', email: 'bob@sx.example', complete: true, attestor: 'Sys Admin', notes: 'checklist' },
    { person_id: 'p3', email: 'cy@sx.example', complete: false, attestor: 'Sys Admin', notes: 'checklist' },
  ],
  policies: [],
  policy_note: 'not posted: no policy documents',
  unresolved: [],
};

describe('NS-3 postEoRecords (V81)', () => {
  it('posts personnel, screening, training, risks and offboarding, then reads the stores back', async () => {
    const eo = fakeEo();
    const r = await postEoRecords(eo.call, 'sx', posts, () => 'T');
    expect(r.schema).toBe(EO_RECORDS_SCHEMA);
    expect(r.errors).toEqual([]);
    expect(r.posted).toMatchObject({ personnel_created: 3, screening_updated: 3, training_posted: 1, risks_created: 2, offboarding_started: 2, offboarding_steps: STEPS.length, offboarding_completed: 1 });
    expect(r.stores.personnel.map((p) => [p.email, p.screeningState])).toEqual([['ann@sx.example', 'cleared'], ['bob@sx.example', 'offboarded'], ['cy@sx.example', 'offboarding-in-progress']]);
    expect(r.stores.personnel[1].artifactTypes).toEqual(['offboarding-procedural-overlay']);
    expect(r.stores.training).toEqual({ 'ann@sx.example': [{ courseId: 'SX Awareness', completedDate: '2026-07-01' }] });
    expect(r.stores.risks.map((k) => k.sourceReference)).toEqual(['R-01', 'R-02']);
    expect(r.policies).toEqual({ posted: 0, note: 'not posted: no policy documents' });
  });

  it('is idempotent over a store that already holds the records (a rerun over the shared ces.db)', async () => {
    const eo = fakeEo();
    await postEoRecords(eo.call, 'sx', posts);
    const again = await postEoRecords(eo.call, 'sx', posts);
    expect(again.errors).toEqual([]);
    expect(again.posted).toMatchObject({ personnel_created: 0, personnel_existing: 3, screening_updated: 0, risks_created: 0, risks_existing: 2, offboarding_started: 0, offboarding_existing: 2 });
    expect(eo.people).toHaveLength(3);
    expect(eo.risks).toHaveLength(2);
  });

  it('records an HTTP error and carries on', async () => {
    const eo = fakeEo({ failRisk: 'R-02' });
    const r = await postEoRecords(eo.call, 'sx', posts);
    expect(r.errors).toEqual([{ what: 'POST risk R-02', status: 500, body: { error: 'boom' } }]);
    expect(r.posted.risks_created).toBe(1);
    expect(r.posted.offboarding_completed).toBe(1);
  });
});

describe('ROLE-1: E6 feeds Muster no results (V100; V86 retired)', () => {
  it('runs stamper execute without CES_MUSTER_API_URL / TOKEN, records muster_api_url, keeps no owner record and reads nothing back', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    const e6 = src.slice(src.indexOf("id: 'E6',"), src.indexOf("id: 'E6X',"));
    expect(e6).toContain('delete execEnv.CES_MUSTER_API_URL;');
    expect(e6).toContain('delete execEnv.CES_MUSTER_API_TOKEN;');
    expect(e6).toContain('env: execEnv,');
    expect(e6).toContain('muster_api_url: musterApiUrl');
    expect(e6).not.toMatch(/CES_MUSTER_API_URL: API_URL|muster_results|muster-owner|MUSTER_OWNER_FILE|readMusterResults/);
    expect(src).not.toContain('./muster-results.js');
    expect(fs.existsSync(path.join(__dirname, '..', 'src', 'flow', 'muster-results.ts'))).toBe(false);
  });
});
