// FIN-29 (Blue Heron Defense, CES team; finishing plan PH-2 harness): the AO checks V77 (E7S, the AdminOps sweep; gap
// plan AO-4a, GAP-CLOSURE-PLAN.md §5) and V127 (E9A, AO's other surfaces; FINISH-PLAN.md §1.3). Called by the hub
// (verify-fin29.mjs runFin29Checks) with its vctx. Pure judges (judgeV77, judgeV127) plus the reader (fin29AoChecks).
import * as path from 'node:path';

export const AO_SWEEP_SCHEMA = 'ces-tester/ao-sweep@1';
export const AO_SURFACES_SCHEMA = 'ces-tester/ao-surfaces@1';
// V77's apply floor: the number of AO commands E7S must apply on S1. It only rises (AO-4a): it starts at 0 because no
// sweep has run on S1 yet; after round R-F2 the orchestrator raises it to the observed count; AO-4b takes it to 96.
// The judge uses max(this, the record's own apply_floor), so lowering the scenario file cannot lower the bar.
export const V77_APPLY_FLOOR = 0;
export const V77_SCENARIOS = ['s1-mach'];
export const MCP_TOOLS_WANTED = ['ao_list_commands', 'ao_get_command', 'ao_execute', 'ao_approvals', 'ao_approve'];

const ms = (v) => Date.parse(String(v ?? ''));
const modeOfRow = (row) => {
  const m = row?.evidence?.metadata?.twoPersonApproval?.mode ?? row?.metadata?.twoPersonApproval?.mode;
  return m === 'on' || m === 'off' ? m : null;
};

// record: out/ao-sweep.json; stale: staleOf(file); steps: steps.json; registryIds: AO registry ids (ces-ao src/registry);
// rowOf(id) -> the ces.db adminops_evidence row (parsed data, with tenantId) or null; dbReadable: whether ces.db opened.
export function judgeV77({ slug, record = null, stale = null, steps = {}, registryIds = null, rowOf = () => null, dbReadable = false, floor = V77_APPLY_FLOOR }) {
  if (!V77_SCENARIOS.includes(slug)) return { pass: true, detail: `not run here: the AO sweep (E7S) runs on ${V77_SCENARIOS.join(', ')} only` };
  if (!record) return { pass: false, detail: 'no out/ao-sweep.json (step E7S did not run or did not write it)' };
  if (stale) return { pass: false, detail: stale };
  const problems = [];
  if (record.schema !== AO_SWEEP_SCHEMA) problems.push(`schema ${record.schema}`);
  if (steps?.E1?.started && !(ms(record.started) >= ms(steps.E1.started))) problems.push(`sweep started ${record.started}, before this run's E1 start`);
  // E7S runs after the last assessment (E7B, E8F): an earlier start would let an assessment read its writes.
  for (const s of ['E7B', 'E8F']) if (steps?.[s]?.ended && ms(record.started) < ms(steps[s].ended)) problems.push(`sweep started before ${s} ended (an assessment could read its writes)`);
  const ops = Array.isArray(record.ops) ? record.ops : [];
  const ids = new Set(ops.map((o) => o.op));
  if (registryIds) {
    const missing = registryIds.filter((id) => !ids.has(id));
    if (missing.length) problems.push(`${missing.length} registry command(s) not in the sweep: ${missing.slice(0, 8).join(', ')}`);
    if (registryIds.length !== (record.expected_commands ?? registryIds.length)) problems.push(`registry has ${registryIds.length} commands, the sweep expects ${record.expected_commands}`);
  } else problems.push('AO registry not readable (ces-ao src/registry/ao-commands.registry.json)');
  // PH-5 (R-F2 V77 red): an op with no target on this tenant is "not applicable", recorded by E7S only when its
  // discovery read proved the input absent ("no simulator object: ..."); without that proof it is red, and its calls
  // (none are made) never hide a binding error.
  const na = ops.filter((o) => o.not_applicable);
  const naUnproved = na.filter((o) => !/discovery: \S+: no simulator object: /.test(String(o.not_applicable)) || (o.calls ?? []).length);
  if (naUnproved.length) problems.push(`${naUnproved.length} not-applicable op(s) without the discovery's absence proof: ${naUnproved.slice(0, 6).map((o) => `${o.op} (${String(o.not_applicable).slice(0, 120)})`).join('; ')}`);
  const notRun = ops.filter((o) => o.not_run && !o.not_applicable);
  if (notRun.length) problems.push(`${notRun.length} not run: ${notRun.slice(0, 6).map((o) => `${o.op} (${o.not_run})`).join('; ')}`);
  const dryBad = ops.filter((o) => !o.not_run && !o.not_applicable && !o.dry_run_ok);
  if (dryBad.length) problems.push(`${dryBad.length} dry run(s) not ok: ${dryBad.slice(0, 6).map((o) => `${o.op}: ${String(o.detail ?? '').slice(0, 120)}`).join('; ')}`);
  const calls = ops.flatMap((o) => (o.calls ?? []).map((c) => ({ op: o.op, tier: o.tier, ...c })));
  const binding = calls.filter((c) => c.error_class === 'binding');
  const guard = calls.filter((c) => c.error_class === 'guard');
  if (binding.length) problems.push(`binding error(s): ${binding.slice(0, 5).map((c) => `${c.op} ${c.call}: ${String(c.error ?? '').slice(0, 140)}`).join('; ')}`);
  if (guard.length) problems.push(`guard error(s): ${guard.slice(0, 5).map((c) => `${c.op} ${c.call}: ${String(c.error ?? '').slice(0, 140)}`).join('; ')}`);
  const applied = ops.filter((o) => o.applied).length;
  const bar = Math.max(Number(floor) || 0, Number(record.apply_floor) || 0);
  if (applied < bar) problems.push(`applied ${applied} < floor ${bar}`);
  // PH-12 P12-AO (R-F9 S1: A-01 and F-08 applied 404 behind "87 applied (floor 0)"): an op whose dry run passed and
  // whose apply was neither kept dry (recurring cost or scenario) nor applied is a failed apply, named here.
  const applyFailed = ops.filter((o) => !o.not_run && !o.not_applicable && o.dry_run_ok && !o.applied && !o.apply_skipped);
  if (applyFailed.length) problems.push(`${applyFailed.length} apply(ies) failed: ${applyFailed.slice(0, 6).map((o) => `${o.op}: ${String(o.detail ?? '').replace(/\s+/g, ' ').slice(0, 120)}`).join('; ')}`);
  // Every call that persisted a row: the row is in ces.db, on the run's tenant, with the call's outcome mode.
  if (dbReadable) {
    const lost = calls.filter((c) => c.evidence_row_id && !rowOf(c.evidence_row_id));
    if (lost.length) problems.push(`${lost.length} evidence row(s) not in ces.db adminops_evidence (e.g. ${lost[0].op} ${lost[0].call} ${lost[0].evidence_row_id})`);
    const otherTenant = calls.filter((c) => c.evidence_row_id && rowOf(c.evidence_row_id) && record.tenant_id && rowOf(c.evidence_row_id).tenantId !== record.tenant_id);
    if (otherTenant.length) problems.push(`${otherTenant.length} row(s) not on ${record.tenant_id}`);
  } else if (calls.some((c) => c.evidence_row_id)) problems.push('ces.db not readable: the sweep rows cannot be checked');
  // Tier 3: with two-person ON the executed row names an approver other than the requestor; with it OFF the rows say off.
  const t3 = ops.filter((o) => o.tier === 'T3');
  if (record.two_person_approval === 'on') {
    for (const o of t3.filter((x) => x.applied)) {
      const apply = (o.calls ?? []).find((c) => c.call === 'apply');
      const row = apply?.evidence_row_id && dbReadable ? rowOf(apply.evidence_row_id) : null;
      const m = row?.metadata ?? {};
      if (!(o.calls ?? []).some((c) => c.call === 'approve' && c.ok)) problems.push(`${o.op}: Tier 3 applied with two-person ON but no approval`);
      else if (dbReadable && (!m.approverUPN || m.approverUPN === m.requestorUPN)) problems.push(`${o.op}: executed row approver ${m.approverUPN ? 'equals the requestor' : 'missing'}`);
    }
  } else {
    const noMode = t3.flatMap((o) => (o.calls ?? []).filter((c) => c.evidence_row_id && c.two_person_mode !== 'off').map((c) => `${o.op} ${c.call}`));
    if (noMode.length) problems.push(`Tier 3 row(s) do not record two-person mode off: ${noMode.slice(0, 5).join(', ')}`);
  }
  const t = record.totals ?? {};
  const line = `${ops.length} command(s): ${t.dry_run_ok ?? ops.filter((o) => o.dry_run_ok).length} dry-run ok, ${applied} applied (floor ${bar}), ${t.apply_skipped ?? 0} kept dry (recurring cost or scenario), ${applyFailed.length} apply failed, two-person ${record.two_person_approval}; ${na.length} not applicable (resource absent${na.length ? `: ${na.map((o) => o.op).join(', ')}` : ''}); ${binding.length} binding / ${guard.length} guard errors`;
  if (problems.length) return { pass: false, detail: `${problems.slice(0, 8).join('; ')} [${line}]` };
  return { pass: true, detail: `${line}; every row in ces.db on ${record.tenant_id}` };
}

// record: out/ao-surfaces.json; registryCount: the AO registry length; rowOf / dbReadable as V77.
export function judgeV127({ record = null, stale = null, steps = {}, registryCount = null, rowOf = () => null, dbReadable = false }) {
  if (!record) return { pass: false, detail: 'no out/ao-surfaces.json (step E9A did not run or did not write it)' };
  if (stale) return { pass: false, detail: stale };
  const problems = [];
  if (record.schema !== AO_SURFACES_SCHEMA) problems.push(`schema ${record.schema}`);
  if (steps?.E1?.started && !(ms(record.taken) >= ms(steps.E1.started))) problems.push('record taken before this run\'s E1 start');
  const want = registryCount ?? record.registry_commands;
  // MCP (stdio).
  const m = record.mcp ?? {};
  if (!m.ran) problems.push(`MCP server did not run${m.error ? `: ${m.error}` : ''}`);
  else {
    const missing = MCP_TOOLS_WANTED.filter((n) => !(m.tools ?? []).includes(n));
    if (missing.length) problems.push(`MCP tools/list lacks ${missing.join(', ')}`);
    if (m.list_count !== want) problems.push(`MCP ao_list_commands returned ${m.list_count} (want ${want})`);
    if (!m.get_command_id || m.get_command_id !== record.ops?.read) problems.push(`MCP ao_get_command returned ${m.get_command_id}`);
    const d = m.dry_run ?? {};
    if (d.mode !== 'DRY_RUN' || d.success !== true || d.outcome !== 'dry_run') problems.push(`MCP ao_execute dry run: mode ${d.mode}, success ${d.success}, outcome ${d.outcome}${d.error ? ` (${String(d.error).slice(0, 120)})` : ''}`);
    if (dbReadable && d.evidence_row_id && !rowOf(d.evidence_row_id)) problems.push(`MCP dry-run row ${d.evidence_row_id} not in ces.db`);
    if (!d.evidence_row_id) problems.push('MCP dry run persisted no evidence row');
    const b = m.apply_blocked ?? {};
    if (b.mode !== 'DRY_RUN' || !b.live_apply_blocked) problems.push(`MCP dryRun:false without AO_MCP_ALLOW_APPLY was not held to a dry run (mode ${b.mode}, blocked ${b.live_apply_blocked})`);
  }
  // CLI.
  const c = record.cli;
  if (!c) problems.push('no CLI record');
  else {
    if (c.list.rc !== 0 || c.list.count !== want) problems.push(`CLI list rc ${c.list.rc}, ${c.list.count} command(s) (want ${want})`);
    if (c.show.rc !== 0 || !c.show.id || c.show.id !== record.ops?.read) problems.push(`CLI show rc ${c.show.rc}, id ${c.show.id}`);
    if (c.approvals.rc !== 0) problems.push(`CLI approvals rc ${c.approvals.rc}: ${c.approvals.line}`);
  }
  // Rails: each refused, each evidenced (a ces.db row), each with the two-person mode the run used.
  const rails = Array.isArray(record.rails) ? record.rails : [];
  const wantRail = { sim_only: (r) => r.outcome === 'denied_sim_only' && r.success === false, cmmc_scope: (r) => r.outcome === 'denied_cmmc' && r.success === false, web_apply_guard: (r) => r.http === 428 };
  const noMode = [];
  for (const [name, ok] of Object.entries(wantRail)) {
    const r = rails.find((x) => x.rail === name);
    if (!r) { problems.push(`${name}: not probed`); continue; }
    if (!ok(r)) { problems.push(`${name} on ${r.tenant} (${r.op}): not refused as wanted (outcome ${r.outcome ?? '-'}, http ${r.http ?? '-'}${r.note ? `, ${r.note}` : ''}${r.error ? `, ${String(r.error).slice(0, 120)}` : ''})`); continue; }
    if (!r.evidence_row_id || r.evidence_persisted === false) { problems.push(`${name}: refusal not evidenced (no persisted row)`); continue; }
    const row = dbReadable ? rowOf(r.evidence_row_id) : null;
    if (dbReadable && !row) { problems.push(`${name}: row ${r.evidence_row_id} not in ces.db`); continue; }
    const mode = r.two_person_mode ?? modeOfRow(row);
    if (mode === null) noMode.push(name);
    else if (mode !== record.two_person_approval) problems.push(`${name}: row records two-person ${mode}, the run used ${record.two_person_approval}`);
  }
  if (noMode.length) problems.push(`refusal row(s) carry no two-person mode: ${noMode.join(', ')} (ces-ao writes evidence.metadata.twoPersonApproval only on the 428 and rejection rows today; the sim-only and CMMC denials in CommandExecutor.ts need it too)`);
  if (!dbReadable) problems.push('ces.db not readable: refusal rows cannot be checked');
  if (problems.length) return { pass: false, detail: problems.slice(0, 10).join('; ') };
  return { pass: true, detail: `MCP: ${m.tools.length} tools, ${m.list_count} commands, ${record.ops.read} dry run evidenced, dryRun:false held to a dry run; CLI list ${c.list.count} / show ${c.show.id} / approvals rc 0; refused and evidenced (two-person ${record.two_person_approval}): sim-only rail on ${rails.find((r) => r.rail === 'sim_only').tenant}, CMMC scope gate on ${rails.find((r) => r.rail === 'cmmc_scope').tenant}, web apply guard 428${record.mcp.strict_cmmc_in_schema ? '; MCP ao_execute takes strictCmmc' : ''}` };
}

export async function fin29AoChecks(vctx) {
  const regFile = path.join(vctx.ces, 'ces-ao', 'src', 'registry', 'ao-commands.registry.json');
  const reg = vctx.exists(regFile) ? vctx.readJson(regFile) : null;
  const db = typeof vctx.db === 'function' ? vctx.db() : null;
  const rowOf = (id) => {
    try {
      const r = db?.prepare("SELECT tenant_id, data FROM ces_records WHERE collection = 'adminops_evidence' AND id = ?").get(id);
      return r ? { tenantId: r.tenant_id, ...JSON.parse(r.data) } : null;
    } catch { return null; }
  };
  const sweepFile = path.join(vctx.out, 'ao-sweep.json');
  const surfFile = path.join(vctx.out, 'ao-surfaces.json');
  const rows = [];
  const safe = (id, title, fn) => { try { rows.push({ id, title, ...fn() }); } catch (e) { rows.push({ id, title, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` }); } };
  safe('V77', 'AO sweep (E7S, S1): every AO command dry-run with no guard or binding error, applies at or above the floor, Tier 3 by the two-person mode, every row in ces.db', () => judgeV77({
    slug: vctx.slug, record: vctx.exists(sweepFile) ? vctx.readJson(sweepFile) : null, stale: vctx.staleOf(sweepFile), steps: vctx.steps ?? {},
    registryIds: Array.isArray(reg) ? reg.map((c) => c.id) : null, rowOf, dbReadable: !!db,
  }));
  safe('V127', 'AO surfaces (E9A): MCP stdio lists commands and runs a dry run; CLI list, show, approvals; the sim-only rail, the CMMC scope gate and the web apply guard (428) refuse, each evidenced with the two-person mode', () => judgeV127({
    record: vctx.exists(surfFile) ? vctx.readJson(surfFile) : null, stale: vctx.staleOf(surfFile), steps: vctx.steps ?? {},
    registryCount: Array.isArray(reg) ? reg.length : null, rowOf, dbReadable: !!db,
  }));
  return rows;
}
