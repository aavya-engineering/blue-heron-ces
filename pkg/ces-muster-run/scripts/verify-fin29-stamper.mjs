// FIN-29 (Blue Heron Defense, CES team; finishing plan PH-2 harness): the Stamper checks V115 (E8G, GUI DP-1/DP-2),
// V116 (E8T, the CLI at a terminal), V117 (E0, clean-tenant initialization) and V126 (E8R, lifecycle commands),
// FINISH-PLAN.md §1.3. Called by verify-fin29.mjs (runFin29Checks) with its vctx. Each judge reads only the tester's
// record of its step (out/<file>, ces-tester src/flow/fin29-stamper.ts) and, for a skipped step, the skip reason in
// out/tester-run.json. A producer slice that has not landed reads "slice not landed: ..." (red); never a crash.
import * as path from 'node:path';

export const FILES = { e0: 'e0-clean-tenant.json', e8r: 'e8r-lifecycle.json', e8t: 'cli-terminal.json', e8g: 'stamper-gui-cost.json' };
export const SCHEMAS = { e0: 'ces-tester/e0-clean-tenant@1', e8r: 'ces-tester/e8r-lifecycle@1', e8t: 'ces-tester/e8t-cli-terminal@1', e8g: 'ces-tester/e8g-gui-cost@1' };
export const KEY_VAULT_ENTRY = 'SC.L2-3.13.10.key-vault';
export const E0_DP2_ACCEPT = 'baseline.LogAnalyticsWorkspace';
export const E0_DP2_REFUSE = 'baseline.StorageAccount';
/** The grants the founder HELD (A-1031-42): bootstrap and preflight must show them held, never grant them. */
export const HELD_GRANTS = ['Sites.FullControl.All', 'Teams Administrator'];
export const E8R_CALLS = ['validate', 'report', 'halted_execute', 'resume', 'report_resumed', 'rollback', 'tenants_list', 'tenants_validate'];

/** The tester-run.json row of a step (status, detail), or null. */
export function stepRow(testerRun, id) {
  return (testerRun?.steps ?? []).find((s) => s.id === id) ?? null;
}

/**
 * The common front of every judge: the record, or why there is none. A step skipped because this scenario does not
 * run it passes as "not run here"; any other skip or a missing record is red with the reason.
 */
export function frontOf({ record, stale, schema, row, harness, label }) {
  if (harness !== 'tester') return { done: { pass: true, detail: `not run here: ${label} is a tester step (mx-e2e.ps1 -Harness tester); this run used the mx harness` } };
  if (row?.status === 'skipped') {
    const why = String(row.detail ?? 'skipped');
    if (/^not this scenario/.test(why)) return { done: { pass: true, detail: `not run here: ${why}` } };
    return { done: { pass: false, detail: /slice not landed/.test(why) ? why : `${label} skipped: ${why}` } };
  }
  if (!record) return { done: { pass: false, detail: `no record (${label} did not run${row ? `: ${row.status} ${row.detail ?? ''}` : ''})` } };
  if (stale) return { done: { pass: false, detail: stale } };
  if (record.schema !== schema) return { done: { pass: false, detail: `schema ${record.schema}, want ${schema}` } };
  if (record.note) return { done: { pass: false, detail: record.note } };
  return { record };
}

const has = (rows, pred) => (rows ?? []).some(pred);
const ev = (rows, entry, dp, outcome) => has(rows, (r) => r.entry_id === entry && r.dp === dp && r.outcome === outcome);

// ---------- V117 (E0) ----------
export function judgeV117(input) {
  const f = frontOf({ ...input, schema: SCHEMAS.e0, label: 'E0' });
  if (f.done) return f.done;
  const r = f.record;
  const p = [];
  const b = r.bootstrap;
  if (!b) return { pass: false, detail: 'no bootstrap result in the E0 record' };
  if (b.rc !== 0) p.push(`bootstrap rc ${b.rc}`);
  if (!b.record_file) p.push(`bootstrap wrote no tenant record${b.writer_error ? ` (${b.writer_error})` : ''}`);
  if (b.simulator === false) p.push('bootstrap did not run in simulator mode');
  if (b.cert_source !== 'store') p.push(`cert_source ${b.cert_source} (want store)`);
  if (b.cert_non_exportable !== true) p.push(`certificate key ${b.cert_non_exportable === false ? 'EXPORTABLE' : 'export policy not read'}`);
  if (b.cert_removed !== true) p.push('the bootstrap certificate was not removed from Cert:\\CurrentUser\\My after E0');
  const perm = b.permissions ?? {};
  if (!(Number(perm.granted ?? 0) + Number(perm.skipped ?? 0) > 0)) p.push('no grant recorded');
  if (Number(perm.failed ?? 0) > 0) p.push(`${perm.failed} grant(s) failed`);
  const heldBoot = [...(perm.held ?? []), ...(b.held_lines ?? [])].join(' ');
  if (!/Sites\.FullControl\.All/.test(heldBoot)) p.push('bootstrap did not show Sites.FullControl.All held');
  if (b.break_glass?.verified !== true) p.push(`break-glass VERIFY: ${b.break_glass?.detail ?? 'not run'}`);
  const licence = (b.licence_lines ?? []).length > 0 || b.licence_record != null;
  if (!licence) p.push('slice not landed: no licence check in the bootstrap output (audit steps 1 and 18, FIN-21)');
  const pf = r.preflight;
  if (!pf) p.push('preflight did not run');
  else {
    if (!pf.stopped) p.push(`preflight did not reach preflight_done${pf.errors?.length ? ` (${pf.errors[0]})` : ''}`);
    const sh = pf.summary_held;
    const summaryItems = Array.isArray(sh?.items) ? sh.items.map((x) => (typeof x === 'string' ? x : x?.name ?? '')) : [];
    const held = [...(pf.held ?? []), ...summaryItems].join(' ');
    for (const h of HELD_GRANTS) if (!held.includes(h)) p.push(`preflight did not report ${h} held`);
    const bgSummary = pf.summary_break_glass;
    if (bgSummary && bgSummary.verified !== true) p.push(`preflight break-glass: ${bgSummary.status ?? '?'} ${bgSummary.detail ?? ''}`.trim());
    if (!bgSummary && !has(pf.checks, (c) => /break.?glass/i.test(String(c.name ?? '')))) p.push('preflight reported no break-glass check');
  }
  const b1 = r.baseline_pass1;
  if (!b1) p.push('baseline pass 1 did not run');
  else {
    if (!b1.stopped) p.push('baseline pass 1 did not complete');
    if (!b1.injected) p.push('the simulator fault was not injected');
    const failedOwn = (b1.errors ?? []).filter((e) => !/^dependency /.test(String(e.error ?? '')) && !/cost_gated_off/.test(String(e.error ?? '')));
    const skippedDep = (b1.errors ?? []).filter((e) => /^dependency .* failed$/.test(String(e.error ?? '')));
    if (!failedOwn.length) p.push('the injected failure was not reported as a failure (baseline_error)');
    if (!skippedDep.length) p.push('no dependent of the failed resource was skipped');
    if (!(Number(b1.complete?.failed ?? 0) >= 1)) p.push(`baseline_complete failed=${b1.complete?.failed ?? '?'} (want >= 1)`);
    if (!(Number(b1.complete?.cost_gated_off ?? 0) > 0)) p.push(`cost_gated_off=${b1.complete?.cost_gated_off ?? '?'} without DP-1 (want > 0)`);
    if (has(b1.cost_gate, (c) => c.allowed === true)) p.push('a recurring item was allowed without DP-1');
    if (!has(b1.cost_evidence, (e) => /^baseline\./.test(String(e.entry_id ?? '')) && e.dp === 2 && e.outcome === 'refused')) p.push('no refused dp:2 baseline.* record without DP-1');
  }
  const b2 = r.baseline_pass2;
  if (!b2) p.push('baseline pass 2 (DP-1/DP-2) did not run');
  else {
    for (const id of [E0_DP2_ACCEPT, E0_DP2_REFUSE]) if (b2.dp1?.[id] !== 200) p.push(`DP-1 ${id} HTTP ${b2.dp1?.[id] ?? 'none'}`);
    if (!ev(b2.cost_evidence, E0_DP2_ACCEPT, 2, 'accepted')) p.push(`no accepted dp:2 record for ${E0_DP2_ACCEPT}`);
    if (!ev(b2.cost_evidence, E0_DP2_REFUSE, 2, 'refused')) p.push(`no refused dp:2 record for ${E0_DP2_REFUSE} (wrong text)`);
    if (!(b2.complete?.recurring_enabled ?? []).includes(E0_DP2_ACCEPT)) p.push(`recurring_enabled lacks ${E0_DP2_ACCEPT}`);
  }
  if (p.length) return { pass: false, detail: p.join('; ') };
  return { pass: true, detail: `bootstrap: record ${b.record_kind} with a non-exportable store key (removed after E0), ${perm.granted} granted, held ${HELD_GRANTS.join(' + ')}, break-glass verified, licence check ran; preflight: held reported, break-glass checked; baseline: injected failure reported (${b1.complete.failed} failed, dependents skipped), ${b1.complete.cost_gated_off} recurring refused without DP-1; DP-1 + typed DP-2 accepted ${E0_DP2_ACCEPT}, wrong DP-2 refused ${E0_DP2_REFUSE}` };
}

// ---------- V126 (E8R) ----------
export function judgeV126(input) {
  const f = frontOf({ ...input, schema: SCHEMAS.e8r, label: 'E8R' });
  if (f.done) return f.done;
  const r = f.record;
  const p = [];
  const call = (n) => (r.calls ?? []).find((c) => c.call === n);
  for (const n of E8R_CALLS) {
    const c = call(n);
    if (!c) p.push(`${n}: not run`);
    else if (!c.ok) p.push(`${n}: ${c.detail}`);
  }
  const rs = call('resume');
  if (rs?.ok && !rs.recurring_cost_line) p.push('resume report has no recurring_cost.line (FIN-15)');
  const rb = call('rollback');
  if (rb?.ok && !/loopback|127\.0\.0\.1|localhost|stacksim/i.test(String(rb.target ?? ''))) p.push(`rollback target "${rb.target}" is not the loopback simulator`);
  if (p.length) return { pass: false, detail: p.join('; ') };
  return { pass: true, detail: `validate (${call('validate').total_tasks} tasks), report, a halted run (${call('halted_execute').report_status}) resumed from ${rs.prior_status} (${rs.done_before} done before; "${rs.recurring_cost_line}"), report of the resumed run, rollback (${rb.detail}), tenants list and validate; private pipeline root ${r.private_pipeline_root}` };
}

// ---------- V116 (E8T) ----------
export function judgeV116(input) {
  const f = frontOf({ ...input, schema: SCHEMAS.e8t, label: 'E8T' });
  if (f.done) return f.done;
  const r = f.record;
  const p = [];
  if (!r.dp1 || !has(r.dp1.answers, (a) => a.rule === 'dp1-typed')) p.push('DP-1 was not typed at the terminal (cost-ack)');
  if (!ev(r.cost_evidence, KEY_VAULT_ENTRY, 1, 'accepted')) p.push(`no accepted dp:1 record for ${KEY_VAULT_ENTRY}`);
  if (!(r.translate?.acked ?? []).includes(KEY_VAULT_ENTRY)) p.push(`translate after DP-1 did not keep ${KEY_VAULT_ENTRY} (acked ${JSON.stringify(r.translate?.acked ?? [])})`);
  const g = r.gates;
  const a = r.pass_a;
  if (!g || !a) p.push('pass A (gates) did not run');
  else {
    if (a.timed_out) p.push('pass A stalled at the terminal (no prompt matched; see the transcript)');
    const dec = (id) => (a.answers ?? []).find((x) => x.rule === 'gate-decision' && x.task_id === id)?.answer;
    if (dec(g.approve) !== 'yes') p.push(`gate ${g.approve} was not approved at the terminal`);
    if (dec(g.reject) !== 'no') p.push(`gate ${g.reject} was not rejected at the terminal`);
    const v = a.verdicts;
    if (!v) p.push('pass A wrote no execution-results manifest');
    else {
      if (v[g.reject_control] === 'sat') p.push(`the rejected gate's control ${g.reject_control} is sat`);
      if (v[g.reject_control] !== 'not_sat') p.push(`the rejected gate's control ${g.reject_control} is ${v[g.reject_control] ?? 'absent'} (want not_sat)`);
      if (v[g.approve_control] === 'not_sat') p.push(`the rejection spread to the approved gate's control ${g.approve_control} (D-5)`);
    }
    if (!has(a.answers, (x) => x.rule === 'dp2-typed')) p.push(`no DP-2 prompt in pass A (did ${KEY_VAULT_ENTRY}'s SET run? the vault may take the exists path)`);
  }
  if (!r.pass_b) p.push('pass B (DP-2 typed as shown) did not run');
  else if (!has(r.pass_b.answers, (x) => x.rule === 'dp2-typed')) p.push('no DP-2 prompt in pass B');
  if (!ev(r.cost_evidence, KEY_VAULT_ENTRY, 2, 'refused')) p.push(`no refused dp:2 record for ${KEY_VAULT_ENTRY} (the wrong text)`);
  if (!ev(r.cost_evidence, KEY_VAULT_ENTRY, 2, 'accepted')) p.push(`no accepted dp:2 record for ${KEY_VAULT_ENTRY}`);
  if (p.length) return { pass: false, detail: p.join('; ') };
  const v = a.verdicts;
  return { pass: true, detail: `at a pseudo-terminal: DP-1 typed; gate ${g.approve} approved (${g.approve_control} ${v[g.approve_control] ?? '-'}), gate ${g.reject} rejected (${g.reject_control} not_sat, narrowed: D-5); DP-2 typed wrong (refused) and as shown (accepted) for ${KEY_VAULT_ENTRY}` };
}

// ---------- V115 (E8G) ----------
export function judgeV115(input) {
  const f = frontOf({ ...input, schema: SCHEMAS.e8g, label: 'E8G' });
  if (f.done) return f.done;
  const r = f.record;
  const p = [];
  const it = r.items?.item;
  if (!it) p.push(`GET /api/cost-gate/items did not list ${KEY_VAULT_ENTRY} (HTTP ${r.items?.status ?? 'none'})`);
  else {
    if (it.acked !== false) p.push(`${KEY_VAULT_ENTRY} listed already ticked`);
    if (it.estimate == null && it.estimate_month_high == null) p.push('the listed item shows no price');
  }
  const t0 = r.translate_without_dp1;
  if (!t0 || !t0.gated_off.includes(KEY_VAULT_ENTRY) || t0.acked.includes(KEY_VAULT_ENTRY)) p.push(`translate without DP-1 did not drop ${KEY_VAULT_ENTRY} (HTTP ${t0?.status ?? 'none'})`);
  if (r.dp1?.status !== 200 || r.dp1?.ok !== true) p.push(`DP-1 POST /api/cost-gate/ack HTTP ${r.dp1?.status ?? 'none'}`);
  const t1 = r.translate_with_dp1;
  if (!t1 || !t1.acked.includes(KEY_VAULT_ENTRY)) p.push(`translate after DP-1 did not keep ${KEY_VAULT_ENTRY}`);
  const run = r.run;
  if (!run) p.push('the Incremental run did not start');
  else {
    if (!run.pending_seen?.length) p.push(`no DP-2 dialog (GET /api/cost-gate/pending) during the run (did the vault's SET run?)${run.error ? `; ${run.error}` : ''}`);
    else if (!run.pending_seen[0].expected) p.push('the pending DP-2 showed no text to type');
    if (run.answer && (run.answer.status !== 200 || run.answer.outcome !== 'accepted')) p.push(`DP-2 answer HTTP ${run.answer.status}, outcome ${run.answer.outcome}`);
  }
  if (!ev(r.cost_evidence, KEY_VAULT_ENTRY, 1, 'accepted')) p.push(`no accepted dp:1 record for ${KEY_VAULT_ENTRY}`);
  if (!ev(r.cost_evidence, KEY_VAULT_ENTRY, 2, 'accepted')) p.push(`no accepted dp:2 record for ${KEY_VAULT_ENTRY}`);
  if (p.length) return { pass: false, detail: p.join('; ') };
  return { pass: true, detail: `GUI routes: ${KEY_VAULT_ENTRY} listed unticked at ${it.estimate ?? '?'} a month; dropped by translate without DP-1; DP-1 given; kept after; the Incremental run's DP-2 dialog showed "${run.pending_seen[0].expected}" and the typed answer was accepted; dp:1 and dp:2 recorded (simulated tenant, FD-1)` };
}

export async function fin29StamperChecks(vctx) {
  const read = (name) => {
    const f = path.join(vctx.out, name);
    return { record: vctx.exists(f) ? vctx.readJson(f) : null, stale: vctx.staleOf(f) };
  };
  const trFile = path.join(vctx.out, 'tester-run.json');
  const testerRun = vctx.exists(trFile) ? vctx.readJson(trFile) : null;
  const base = (id, name) => ({ ...read(name), row: stepRow(testerRun, id), harness: vctx.harness });
  return [
    { id: 'V115', title: 'Stamper GUI cost gate: the opt-in list shows the recurring item unticked with its price; without DP-1 it is dropped; with DP-1 and the typed DP-2 in the dialog it runs; both confirmations evidenced (simulated tenant)', ...judgeV115(base('E8G', FILES.e8g)) },
    { id: 'V116', title: 'Stamper CLI at a terminal (pseudo-terminal): one manual gate approved, one rejected (narrowed to its own control, D-5), one DP-2 typed correctly and one refused', ...judgeV116(base('E8T', FILES.e8t)) },
    { id: 'V117', title: 'Step E0 on a clean simulated tenant: bootstrap writes the record with a non-exportable key and the grants (held ones held); preflight reports the held items and break-glass; baseline reports an injected failure and refuses recurring items without DP-1/DP-2; licence check runs', ...judgeV117(base('E0', FILES.e0)) },
    { id: 'V126', title: 'Stamper validate, report, resume (on a halted run), rollback and tenants list/validate run in step E8R with the expected outputs', ...judgeV126(base('E8R', FILES.e8r)) },
  ];
}
