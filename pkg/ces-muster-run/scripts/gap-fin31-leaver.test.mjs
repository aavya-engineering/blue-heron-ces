// PH-13 P13-LV: verify-fin31-leaver.mjs, the judge of V131 (the AdminOps leaver flow), on hand-made records shaped like
// ces-tester's step EL output (out/leaver-flow.json) and AO's ces.db rows (ces-ao src/leaver/leaverStore.ts). No run needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeV131, outboxHash, V131_SCENARIOS } from './verify-fin31-leaver.mjs';

const steps = { E1: { started: '2026-11-01T10:00:00.000Z' }, E5: { ended: '2026-11-01T10:05:00.000Z' }, E6: { started: '2026-11-01T10:10:00.000Z' } };
const ADMIN = 'it-admin@s1-mach.simtenant.onmicrosoft.us';
const BHD = 'ces-notices@bhd.invalid';
const FLOW = 'lvf-1';
const msg = (kind, to, extra = {}) => {
  const base = { from: 'adminops-noreply@ces.invalid', to, subject: `s ${kind}`, body: kind === 'leaver_confirm_request' ? 'see http://127.0.0.1:5000/leaver/confirm/lvf-1?t=abc' : 'b', kind, source: { type: 'leaver_flow', id: FLOW } };
  return { id: `m-${kind}-${to.join()}`, tenant_slug: 's', flow_id: FLOW, audience: extra.audience ?? 'tenant_admins', ...base, transport: 'simulated', delivered: false, sha256: outboxHash(base), ...extra };
};
const flow = (o = {}) => ({
  flowId: FLOW, tenantSlug: o.slug ?? 's1-mach', status: 'done', recipients: [ADMIN], confirmedBy: ADMIN,
  leaver: { upn: 'merrin.hollinmere@s1-mach.simtenant.onmicrosoft.us', employeeLeaveDateTime: '2026-09-22T00:00:00.000Z' },
  source: { kind: 'graph_employeeLeaveDateTime', sourceUrls: ['https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-1.0'] }, ...o,
});
const a22 = (o = {}) => ({ metadata: { commandId: 'A-22', mode: 'live', dryRun: false, outcome: 'executed', verdict: 'SAT', requestorUPN: ADMIN, correlationId: `leaver-flow:${FLOW}`, postStateOutput: '{"accountEnabled":false,"groupMemberships":0}', ...o }, evidenceObjectives: ['PS.L2-3.9.2[b]'] });
const rec = (o = {}) => ({
  schema: 'ces-tester/leaver-flow@1', slug: 's1-mach', mode: 'confirm', started: '2026-11-01T10:06:00.000Z', ended: '2026-11-01T10:08:00.000Z',
  flow_id: FLOW, bhd_mailbox: BHD, settings: { notifyBhdOnDone: false }, scan: { enabledPastLeavers: 1 },
  confirm: { get_status: 200, post_status: 200, post_without_bearer: true, reuse_status: 409 }, ...o,
});
const rowsOf = (o = {}) => ({
  flows: [flow(o.flow)],
  outbox: o.outbox ?? [msg('leaver_confirm_request', [ADMIN]), msg('leaver_done', [ADMIN])],
  escalations: o.escalations ?? [], evidence: o.evidence ?? [a22()], eoFindings: o.eoFindings ?? [],
});

test('V131: not judged on muster-partial or under the mx harness; red without the record or ces.db', () => {
  assert.equal(judgeV131({ slug: 'muster-partial' }).pass, true);
  assert.equal(judgeV131({ slug: 's1-mach', harness: 'mx' }).pass, true);
  assert.match(judgeV131({ slug: 's1-mach' }).detail, /no out\/leaver-flow\.json/);
  assert.match(judgeV131({ slug: 's1-mach', rec: rec() }).detail, /ces\.db not readable/);
  assert.deepEqual(Object.keys(V131_SCENARIOS), ['s1-mach', 's2-eng', 's3-def']);
});

test('V131 S1: detect -> admin email -> confirm -> A-22 evidenced -> done notice, no BHD notice: green', () => {
  const r = judgeV131({ slug: 's1-mach', rec: rec(), steps, rows: rowsOf() });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /A-22 live SAT with PS\.L2-3\.9\.2\[b\]/);
  assert.match(r.detail, /no BHD notice/);
});

test('V131 S1: EL after E6 started, a bearer on the confirm, a reusable link, a missing A-22 row each go red', () => {
  assert.match(judgeV131({ slug: 's1-mach', rec: rec({ ended: '2026-11-01T10:11:00.000Z' }), steps, rows: rowsOf() }).detail, /after E6 started/);
  assert.match(judgeV131({ slug: 's1-mach', rec: rec({ confirm: { get_status: 200, post_status: 200, post_without_bearer: false, reuse_status: 409 } }), steps, rows: rowsOf() }).detail, /no AO bearer/);
  assert.match(judgeV131({ slug: 's1-mach', rec: rec({ confirm: { get_status: 200, post_status: 200, post_without_bearer: true, reuse_status: 200 } }), steps, rows: rowsOf() }).detail, /reused confirm link/);
  assert.match(judgeV131({ slug: 's1-mach', rec: rec(), steps, rows: rowsOf({ evidence: [] }) }).detail, /no live A-22 evidence row/);
  assert.match(judgeV131({ slug: 's1-mach', rec: rec(), steps, rows: rowsOf({ evidence: [a22({ requestorUPN: 'someone@else.example' })] }) }).detail, /not the confirming administrator/);
});

test('V131 identity: a recipient that is neither an administrator nor the BHD role mailbox goes red; BHD off means no BHD message', () => {
  const stranger = rowsOf({ outbox: [msg('leaver_confirm_request', [ADMIN]), msg('leaver_done', [ADMIN, 'random.person@example.com'])] });
  assert.match(judgeV131({ slug: 's1-mach', rec: rec(), steps, rows: stranger }).detail, /neither a tenant administrator/);
  const bhdOnS1 = rowsOf({ outbox: [msg('leaver_confirm_request', [ADMIN]), msg('leaver_done', [ADMIN]), msg('leaver_done_bhd', [BHD], { audience: 'bhd' })] });
  assert.match(judgeV131({ slug: 's1-mach', rec: rec(), steps, rows: bhdOnS1 }).detail, /BHD not opted in/);
  const tampered = rowsOf({ outbox: [{ ...msg('leaver_confirm_request', [ADMIN]), body: 'changed' }, msg('leaver_done', [ADMIN])] });
  assert.match(judgeV131({ slug: 's1-mach', rec: rec(), steps, rows: tampered }).detail, /sha256 does not match/);
});

test('V131 S2 (BHD opted in): exactly one deliverable BHD done notice to the configured role mailbox', () => {
  const s2 = { slug: 's2-eng' };
  const withBhd = rowsOf({ flow: s2, outbox: [msg('leaver_confirm_request', [ADMIN]), msg('leaver_done', [ADMIN]), msg('leaver_done_bhd', [BHD], { audience: 'bhd' })] });
  const r = judgeV131({ slug: 's2-eng', rec: rec({ slug: 's2-eng', settings: { notifyBhdOnDone: true } }), steps, rows: withBhd });
  assert.equal(r.pass, true, r.detail);
  assert.match(judgeV131({ slug: 's2-eng', rec: rec({ slug: 's2-eng', settings: { notifyBhdOnDone: true } }), steps, rows: rowsOf({ flow: s2 }) }).detail, /expected exactly one deliverable leaver_done_bhd/);
});

test('V131 S3 (unconfirmed): reminder and escalation, no AO write; the EO finding is required once EO ticked', () => {
  const s3flow = { slug: 's3-def', status: 'awaiting_confirmation', confirmedBy: undefined, remindedAt: 't1', escalatedAt: 't2' };
  const esc = [{ escalationId: 'lve-1', flowId: FLOW, reason: 'unconfirmed_in_window', objectiveId: 'PS.L2-3.9.2[b]' }];
  const out = [msg('leaver_confirm_request', [ADMIN]), msg('leaver_reminder', [ADMIN]), msg('leaver_escalation', [ADMIN])];
  const base = { slug: 's3-def', mode: 'unconfirmed', confirm: undefined };
  const ok = judgeV131({ slug: 's3-def', rec: rec(base), steps, rows: rowsOf({ flow: s3flow, outbox: out, escalations: esc, evidence: [] }) });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /EO finding not checked/);
  const eoTicked = rec({ ...base, eo_tick: { status: 200 } });
  assert.match(judgeV131({ slug: 's3-def', rec: eoTicked, steps, rows: rowsOf({ flow: s3flow, outbox: out, escalations: esc, evidence: [] }) }).detail, /recorded no eo_leaver_findings/);
  const withFinding = judgeV131({ slug: 's3-def', rec: eoTicked, steps, rows: rowsOf({ flow: s3flow, outbox: out, escalations: esc, evidence: [], eoFindings: [{ findingId: 'eolf-lve-1', aoEscalationId: 'lve-1', code: 'LEAVER_UNCONFIRMED' }] }) });
  assert.equal(withFinding.pass, true, withFinding.detail);
  assert.match(judgeV131({ slug: 's3-def', rec: rec(base), steps, rows: rowsOf({ flow: s3flow, outbox: out, escalations: esc }) }).detail, /acted without a confirm/);
  assert.match(judgeV131({ slug: 's3-def', rec: rec(base), steps, rows: rowsOf({ flow: s3flow, outbox: out, escalations: [], evidence: [] }) }).detail, /no unconfirmed_in_window escalation/);
});

// ---------- FIX-EL (R-F11): step EL in V7 (sim writes) and V45 (AO rows) ----------
import { elLeaverOf, isElLeaverWrite, elAoRows, c10HoldsOnlyElRows } from './verify-fin31-leaver.mjs';
import * as fsEl from 'node:fs';
import * as pathEl from 'node:path';
import { fileURLToPath as toPathEl } from 'node:url';

const elSteps = { ...steps, EL: { started: '2026-11-01T10:05:30.000Z', ended: '2026-11-01T10:09:00.000Z' } };
const elRec = (o = {}) => rec({ flow_after: { status: 200, flow: flow({ leaver: { upn: 'merrin.hollinmere@s1-mach.simtenant.onmicrosoft.us', userId: 'user-7' } }) }, ...o });
const w = (o) => ({ ts: '2026-11-01T10:07:00.000Z', type: 'mutate', actor: 'ao', sessionType: 'graph', ...o });

test('FIX-EL V7: only a confirm-mode EL record of this run opens the EL window, for the leaver it names', () => {
  const l = elLeaverOf(elRec(), elSteps);
  assert.deepEqual(l, { userId: 'user-7', flowId: FLOW, window: elSteps.EL });
  assert.equal(elLeaverOf(elRec({ mode: 'unconfirmed' }), elSteps), null, 'S3: nobody confirmed, no EL write is allowed');
  assert.equal(elLeaverOf(elRec(), steps), null, 'no EL step this run');
  assert.equal(elLeaverOf(elRec({ started: '2026-10-31T10:00:00.000Z' }), elSteps), null, 'an earlier run\'s record');
  assert.equal(elLeaverOf(elRec({ schema: 'other@1' }), elSteps), null);
  assert.equal(elLeaverOf(rec({ flow_after: { status: 200, flow: flow() } }), elSteps), null, 'no leaver userId on the flow');
  assert.equal(elLeaverOf(null, elSteps), null);
});

test('FIX-EL V7: A-22\'s writes on the leaver (user, group membership, MFA methods) inside EL are allowed; anything else stays outside', () => {
  const l = elLeaverOf(elRec(), elSteps);
  for (const e of [
    w({ objectType: 'users', objectId: 'user-7', source: 'Update-MgUser' }),
    w({ objectType: 'users', objectId: 'user-7', source: 'Revoke-MgUserSignInSession' }),
    w({ objectType: 'users', objectId: 'user-7', source: 'Set-MgUserLicense' }),
    w({ objectType: 'groupMember', objectId: 'group-3|user-7', source: 'Remove-MgGroupMemberByRef' }),
    w({ objectType: 'authMethods', objectId: 'm-1', source: 'Invoke-MgGraphRequest DELETE /v1.0/users/user-7/authentication/softwareOathMethods/m-1' }),
  ]) assert.equal(isElLeaverWrite(e, l), true, JSON.stringify(e));
  for (const e of [
    w({ objectType: 'users', objectId: 'user-1', source: 'Update-MgUser' }),
    w({ objectType: 'users', objectId: 'user-70', source: 'Update-MgUser' }),
    w({ objectType: 'groupMember', objectId: 'group-3|user-1', source: 'Remove-MgGroupMemberByRef' }),
    w({ objectType: 'authMethods', objectId: 'm-2', source: 'Invoke-MgGraphRequest DELETE /v1.0/users/user-1/authentication/phoneMethods/m-2' }),
    w({ objectType: 'caPolicies', objectId: 'user-7', source: 'Update-MgIdentityConditionalAccessPolicy' }),
    w({ objectType: 'users', objectId: 'user-7', ts: '2026-11-01T10:09:00.001Z' }),
    w({ objectType: 'users', objectId: 'user-7', ts: '2026-11-01T10:05:29.999Z' }),
  ]) assert.equal(isElLeaverWrite(e, l), false, JSON.stringify(e));
  assert.equal(isElLeaverWrite(w({ objectType: 'users', objectId: 'user-7' }), null), false, 'no leaver: nothing allowed');
});

test('FIX-EL V45: EL\'s rows are counted on their own (correlation, tenant, EL window); a C10 record of EL rows only is not E7A\'s', () => {
  const l = elLeaverOf(elRec(), elSteps);
  const row = (id, m = {}) => ({ id, tenantId: 'sim-tenant-s1-mach', metadata: { commandId: 'A-22', mode: 'live', dryRun: false, tenantId: 'sim-tenant-s1-mach', correlationId: `leaver-flow:${FLOW}`, timestamp: '2026-11-01T10:08:00.000Z', ...m } });
  const r = elAoRows(l, [
    row('A-22:a'),
    row('A-22:b', { mode: 'dry_run', dryRun: true }),
    row('A-22:c', { tenantId: 'sim-tenant-s2-eng' }),
    row('A-22:d', { correlationId: 'leaver-flow:lvf-2' }),
    row('A-22:e', { timestamp: '2026-11-01T10:20:00.000Z' }),
  ], 'sim-tenant-s1-mach');
  assert.deepEqual(r.rows.map((x) => x.id), ['A-22:a', 'A-22:b']);
  assert.deepEqual(r.live.map((x) => x.id), ['A-22:a']);
  assert.equal(elAoRows(null, [row('A-22:a')], 'sim-tenant-s1-mach').rows.length, 0, 'no confirm-mode EL: no row is EL\'s');
  assert.equal(c10HoldsOnlyElRows([{ rowId: 'A-22:a' }], r.ids), true);
  assert.equal(c10HoldsOnlyElRows({ rowId: 'A-22:a' }, r.ids), true);
  assert.equal(c10HoldsOnlyElRows([{ rowId: 'A-22:a' }, { rowId: 'A-02:x' }], r.ids), false, 'an E7A row collected in E7 stays red');
  assert.equal(c10HoldsOnlyElRows([], r.ids), false);
  assert.equal(c10HoldsOnlyElRows([{ rowId: 'A-22:a' }], new Set()), false);
});

test('FIX-EL: verify.mjs wires the EL helpers into V7 and V45 (LF kept)', () => {
  const v = fsEl.readFileSync(pathEl.join(pathEl.dirname(toPathEl(import.meta.url)), 'verify.mjs'), 'utf8');
  assert.equal(v.includes('\r'), false);
  assert.match(v, /import \{ elLeaverOf, isElLeaverWrite, elAoRows, c10HoldsOnlyElRows \} from '\.\/verify-fin31-leaver\.mjs';/);
  assert.match(v, /\|\| isElLeaverWrite\(e, leaver\);/);
  assert.match(v, /aoWindowProblems\(e7aCalls\.length \+ el\.rows\.length, applies \+ el\.live\.length, el\.ids\)/);
  assert.match(v, /!c10HoldsOnlyElRows\(payloadOf\(r\), elIds\)/);
});
