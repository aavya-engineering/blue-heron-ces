// VER-4 (Blue Heron Defense, CES team; depth plan DEPTH-REPORT-AND-PLAN.md §5, FINISH-PLAN.md §3.5): the depth checks
// V91-V99. verify.mjs builds its context object (vctx) and calls runDepthChecks(vctx) once; the rows are appended to
// verify.json. Every judge is pure (inputs in, { pass, detail } out); the builders below read the files. A judge that
// throws yields a red row with the error, never a crash. All four scenarios gate.
//
// "Not landed": when the slice that produces a check's input has not shipped (DEPTH-3 credits[], DEPTH-6
// objective_coverage[], DEPTH-7 per-objective postchecks, DEPTH-8 per-objective verdicts, DEPTH-12 prediction), the
// row is red with a detail that starts "not landed: DEPTH-n (...)", and still reports whatever is measurable today.
//
// vctx fields used: out, pkg, slug, tenantPlanData, readJson, exists, summary, objectivesRef, exePlan, guiPlan,
// registries, im, report, ledger, scorecard, v72.
//
// Producer shapes this file assumes (the slices that land them must match, or this file changes with them):
//   executable plan (DEPTH-6, CONTRACT CHANGE in ces-shared): objective_coverage[] =
//     { objective_id, type: 'configure'|'document'|'manual'|'inherited'|'not_applicable'|'uncovered',
//       entry_ids?: string[], basis?: string, reason?: string }
//   task (DEPTH-3): credits[] = { objective_id, entry_id? } (cross-credit only; controls[] = the step's own controls)
//   plan postchecks (DEPTH-7): postchecks[] rows carry objective_id (and control_id); configure objectives carry
//     expected_value { path, op, value }
//   results manifest <tenantPlanData>/state/execution-results-<plan_id>.json (DEPTH-8): results[] =
//     { controlId, verdict, outcome, objectives?: [{ objective_id, verdict, postchecks?: [{ check_id, mode:
//       'state'|'presence'|'manual', expected_value?, observed_value?, read_entry_id?, read_control_id?,
//       evidence_control_ids?: string[] }] }] }
//   out/depth-prediction.json (DEPTH-12):
//     { schema: 'ces-depth/prediction@1', scenario: <slug>, slices: [<slice id>...],
//       predicted: { sprs: <int>, statuses: { <control id>: 'met'|'not_met'|'partial'|'not_assessed' } } }
//     statuses may list only the controls the slices move; unlisted controls are not compared.
import * as path from 'node:path';
import { primaryControl, UNCOVERED } from './depth-coverage.mjs';

export const COVERAGE_TYPES = ['configure', 'document', 'manual', 'inherited', 'not_applicable', 'uncovered'];
export const DEPTH_PREDICTION_SCHEMA = 'ces-depth/prediction@1';
export const PLATFORM_INHERITED_BANNED = ['RA.L2-3.11.1', 'RA.L2-3.11.2', 'RA.L2-3.11.3', 'CA.L2-3.12.2'];
const ENCLAVE_TIERS = { m365_only: ['none'], m365_sentinel: ['none', 'foundation', 'sentinel'], m365_azure: ['none', 'foundation', 'sentinel', 'full'] };
/** The three boilerplate postcheck rows per control the translator writes today (description prefixes). */
export const BOILERPLATE_RE = /^\[Postcheck\]\s+\S+:\s+(Examine documentation and configuration exports|Interview responsible personnel|Test control effectiveness)/;

const verdict = (problems, ok) => ({ pass: problems.length === 0, detail: problems.length ? problems.join('; ') : ok });
const ex = (xs, n = 5) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` (+${xs.length - n})` : ''}`;
const notLanded = (slice, what, measured) => ({ pass: false, detail: `not landed: ${slice} (${what})${measured ? `; measured today: ${measured}` : ''}` });

// ---------- shared plan helpers ----------
export const tasksOf = (plan) => (Array.isArray(plan?.execution_graph) ? plan.execution_graph : []);
export const subsOf = (task) => (Array.isArray(task?.action?.args?._sub_commands) ? task.action.args._sub_commands : []);
export const isWrite = (sub) => typeof sub?.set_command === 'string' && sub.set_command.trim() !== '';
export const registryById = (registries) => new Map((registries ?? []).map((e) => [e.entry_id, e]));
const isManualPseudo = (sub) => /^manual-/.test(String(sub?.id ?? '')) || sub?.engine === 'manual_gate';
export function objectiveIndex(objectivesRef) {
  const list = Array.isArray(objectivesRef?.objectives) ? objectivesRef.objectives : [];
  const byId = new Map(list.map((o) => [o.objectiveId, o]));
  const byControl = new Map();
  for (const o of list) (byControl.get(o.controlId) ?? byControl.set(o.controlId, []).get(o.controlId)).push(o);
  return { list, byId, byControl, controls: new Set(byControl.keys()) };
}
/** Comment ('# ...') or placeholder ('...', '<...>', 'TODO') command text. */
export function isCommentOrPlaceholder(cmd) {
  const t = String(cmd ?? '').trim();
  if (!t) return false;
  if (t.startsWith('#')) return true;
  if (/^['"]?\.\.\.['"]?$/.test(t) || /^<[^>]*>$/.test(t) || /^(TODO|TBD|placeholder)\b/i.test(t)) return true;
  return false;
}

// ---------- V91: objective coverage ----------
// In scope (choice): every objective of every practice in ces-shared's reference (all 110 practices, 320 objectives).
// The translator plans every practice in every scenario today (110 tasks), so "the practices the plan's tasks name"
// would be the same set; using the reference also catches a practice the plan dropped.
export function judgeV91({ plan, objectivesRef, registries, floor = null, mode = 'warn', floorSource = 'depth-coverage.json' }) {
  const idx = objectiveIndex(objectivesRef);
  if (!plan) return { pass: false, detail: 'no out/executable-plan.json' };
  if (!idx.list.length) return { pass: false, detail: 'no assessment-objectives reference' };
  if (!Array.isArray(plan.objective_coverage)) {
    return notLanded('DEPTH-6', 'the executable plan has no objective_coverage[]', `${idx.list.length} in-scope objectives, floor ${floor ?? 'unknown'} (${floorSource})`);
  }
  const reg = registryById(registries);
  const problems = [];
  const recs = new Map();
  const dup = [], unknown = [], badType = [], badConfigure = [], noBasis = [];
  for (const r of plan.objective_coverage) {
    const id = r?.objective_id;
    if (!idx.byId.has(id)) { unknown.push(String(id)); continue; }
    if (recs.has(id)) { dup.push(id); continue; }
    recs.set(id, r);
    if (!COVERAGE_TYPES.includes(r.type)) { badType.push(`${id}:${r.type}`); continue; }
    if (r.type === 'configure') {
      const ok = (r.entry_ids ?? []).some((e) => {
        const ent = reg.get(e);
        return ent && Array.isArray(ent.objective_ids) && ent.objective_ids.includes(id) && !ent.manual_only && typeof ent.set_command === 'string' && ent.set_command.trim() !== '';
      });
      if (!ok) badConfigure.push(id);
    }
    if ((r.type === 'inherited' || r.type === 'not_applicable') && !String(r.basis ?? '').trim()) noBasis.push(id);
  }
  const missing = idx.list.map((o) => o.objectiveId).filter((id) => !recs.has(id));
  const uncovered = [...recs.values()].filter((r) => r.type === 'uncovered').length + missing.length;
  if (dup.length) problems.push(`${dup.length} objective(s) with more than one record: ${ex(dup)}`);
  if (unknown.length) problems.push(`${unknown.length} record(s) for unknown objectives: ${ex(unknown)}`);
  if (badType.length) problems.push(`${badType.length} record(s) with no named type: ${ex(badType)}`);
  if (badConfigure.length) problems.push(`${badConfigure.length} configure record(s) without a configuring entry naming the objective: ${ex(badConfigure)}`);
  if (noBasis.length) problems.push(`${noBasis.length} inherited / not_applicable record(s) without a basis: ${ex(noBasis)}`);
  if (mode === 'fail') {
    if (uncovered > 0) problems.push(`fail mode: ${uncovered} uncovered objective(s) (${missing.length} without a record)`);
  } else if (floor === null || floor === undefined) problems.push('warn mode: no floor (out/depth-coverage.json has no row for this scenario)');
  else if (uncovered > floor) problems.push(`warn mode: ${uncovered} uncovered objective(s) > floor ${floor} (${floorSource})`);
  const counts = COVERAGE_TYPES.map((t) => `${t} ${[...recs.values()].filter((r) => r.type === t).length}`).join(', ');
  return verdict(problems, `${recs.size}/${idx.list.length} objectives with one record (${counts}); uncovered ${uncovered}${mode === 'fail' ? ' (fail mode)' : ` <= floor ${floor} (${floorSource}, warn mode)`}`);
}

// ---------- V92: no read-only "implement", no comment/placeholder commands, no report-only enforce credit ----------
export function judgeV92({ plan, objectivesRef }) {
  if (!plan) return { pass: false, detail: 'no out/executable-plan.json' };
  const idx = objectiveIndex(objectivesRef);
  const readOnly = [], comment = [], reportOnly = [];
  let implement = 0;
  for (const t of tasksOf(plan)) {
    const args = t.action?.args ?? {};
    const subs = subsOf(t);
    if (args._directive === 'implement') {
      implement++;
      if (!subs.some(isWrite)) readOnly.push(t.id);
    }
    if (isCommentOrPlaceholder(t.action?.command)) comment.push(`${t.id} (action.command)`);
    for (const s of subs) {
      if (isWrite(s) && isCommentOrPlaceholder(s.set_command)) comment.push(`${t.id}/${s.id}`);
      if (isWrite(s) && /enabledForReportingButNotEnforced/.test(s.set_command)) {
        const enforce = (t.controls ?? []).flatMap((c) => idx.byControl.get(c) ?? []).filter((o) => /\benforc/i.test(o.description ?? ''));
        const credited = Array.isArray(s.objective_ids) ? enforce.filter((o) => s.objective_ids.includes(o.objectiveId)) : enforce;
        if (credited.length) reportOnly.push(`${s.id} -> ${credited.map((o) => o.objectiveId).join('/')}`);
      }
    }
  }
  const problems = [];
  if (readOnly.length) problems.push(`${readOnly.length} implement-directive task(s) whose sub-commands are all reads: ${ex(readOnly)}`);
  if (comment.length) problems.push(`${comment.length} executed command(s) that are a comment or placeholder: ${ex(comment)}`);
  if (reportOnly.length) problems.push(`${reportOnly.length} report-only CA write(s) credited to an "enforce" objective: ${ex(reportOnly)}`);
  return verdict(problems, `${implement} implement-directive tasks, each with a configuring sub-command; no comment or placeholder command; no report-only policy credited to an enforce objective`);
}

// ---------- V93: credit by objective ----------
/** A task's step controls: the control its id / step title names (primaryControl), as depth-coverage.mjs reads it. */
export function stepControls(task) {
  const fromTitle = /\(([A-Z]{2}\.L[12]-\d+\.\d+\.\d+)\)\s*$/.exec(task?.action?.args?._step_title ?? '');
  const p = primaryControl(task ?? {});
  const ids = new Set([...(p ? [p] : []), ...(fromTitle ? [fromTitle[1]] : [])]);
  return [...ids];
}
export function judgeV93({ plan, objectivesRef, report = null }) {
  if (!plan) return { pass: false, detail: 'no out/executable-plan.json' };
  const idx = objectiveIndex(objectivesRef);
  const tasks = tasksOf(plan);
  const overTagged = [], badCredits = [];
  const runs = new Map();
  let withCredits = 0;
  for (const t of tasks) {
    const own = stepControls(t);
    const extra = (t.controls ?? []).filter((c) => !own.includes(c));
    if (own.length && extra.length) overTagged.push(`${t.id} (+${extra.join(',')})`);
    if (Array.isArray(t.credits)) {
      withCredits++;
      for (const c of t.credits) if (!c?.objective_id || !idx.byId.has(c.objective_id)) badCredits.push(`${t.id}:${c?.objective_id ?? '(none)'}`);
    }
    for (const s of subsOf(t)) if (!isManualPseudo(s)) runs.set(s.id, (runs.get(s.id) ?? 0) + 1);
  }
  for (const r of Array.isArray(report?.entry_runs) ? report.entry_runs : []) runs.set(`report:${r.entry_id}`, (runs.get(`report:${r.entry_id}`) ?? 0) + 1);
  const twice = [...runs.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
  const measured = `${overTagged.length} over-tagged task(s)${overTagged.length ? ` (${ex(overTagged, 3)})` : ''}; ${twice.length} registry entr(ies) planned more than once${twice.length ? ` (${ex(twice, 3)})` : ''}`;
  if (!tasks.some((t) => Array.isArray(t.credits))) return notLanded('DEPTH-3', 'no task carries credits[]', measured);
  const problems = [];
  if (overTagged.length) problems.push(`${overTagged.length} task(s) whose controls[] exceed the step's controls: ${ex(overTagged)}`);
  if (badCredits.length) problems.push(`${badCredits.length} credit(s) without an existing objective id: ${ex(badCredits)}`);
  if (twice.length) problems.push(`${twice.length} registry entr(ies) executed more than once in one run: ${ex(twice)}`);
  return verdict(problems, `${tasks.length} tasks, controls[] = step controls; ${withCredits} with credits[] (objective ids valid); no entry runs twice`);
}

// ---------- V94: one postcheck per objective ----------
export function judgeV94({ plan, objectivesRef, coverage = null }) {
  if (!plan) return { pass: false, detail: 'no out/executable-plan.json' };
  const idx = objectiveIndex(objectivesRef);
  const pcs = Array.isArray(plan.postchecks) ? plan.postchecks : [];
  const boiler = pcs.filter((p) => BOILERPLATE_RE.test(String(p.description ?? '')));
  const outside = [...new Set(pcs.map((p) => p.control_id).filter((c) => c && !idx.controls.has(c)))];
  const keyed = pcs.filter((p) => p.objective_id !== undefined);
  const measured = `${pcs.length} postchecks, ${boiler.length} boilerplate, ${outside.length} control id(s) outside the 110${outside.length ? ` (${ex(outside, 3)})` : ''}`;
  if (!keyed.length) return notLanded('DEPTH-7', 'no postcheck carries objective_id', measured);
  const problems = [];
  const per = new Map();
  const unknown = [];
  for (const p of keyed) {
    if (!idx.byId.has(p.objective_id)) { unknown.push(String(p.objective_id)); continue; }
    per.set(p.objective_id, [...(per.get(p.objective_id) ?? []), p]);
  }
  const missing = idx.list.map((o) => o.objectiveId).filter((id) => !per.has(id));
  const many = [...per.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k} x${v.length}`);
  const configure = new Set((coverage ?? plan.objective_coverage ?? []).filter((r) => r?.type === 'configure').map((r) => r.objective_id));
  const noExpected = [...configure].filter((id) => !(per.get(id) ?? []).some((p) => p.expected_value && p.expected_value.path && p.expected_value.op));
  if (unknown.length) problems.push(`${unknown.length} postcheck(s) keyed to an unknown objective: ${ex(unknown)}`);
  if (missing.length) problems.push(`${missing.length} in-scope objective(s) with no postcheck: ${ex(missing)}`);
  if (many.length) problems.push(`${many.length} objective(s) with more than one postcheck: ${ex(many)}`);
  if (boiler.length) problems.push(`${boiler.length} boilerplate postcheck row(s)`);
  if (outside.length) problems.push(`control id(s) outside the 110 practices: ${ex(outside)}`);
  if (noExpected.length) problems.push(`${noExpected.length} configure objective(s) whose postcheck has no expected_value: ${ex(noExpected)}`);
  if (!configure.size) problems.push('no configure objectives known (objective_coverage[] absent: DEPTH-6), expected_value clause not judged');
  return verdict(problems, `${per.size} objectives, one postcheck each; no boilerplate; every configure objective (${configure.size}) has expected_value`);
}

// ---------- V95: Azure entries reach the plan ----------
export function judgeV95({ plan, im = null, registries, v72 = null }) {
  if (!plan) return { pass: false, detail: 'no out/executable-plan.json' };
  const model = im?.infrastructure_model ?? plan?.variables?.infrastructure_model ?? plan?.infrastructure_model ?? null;
  if (!model || !ENCLAVE_TIERS[model]) return { pass: false, detail: `no infrastructure_model (IM ${im ? 'present' : 'absent'}; got ${model ?? 'none'})` };
  const reg = registryById(registries);
  const az = [...new Set(tasksOf(plan).flatMap(subsOf).map((s) => s.id).filter((id) => /^AZ-/.test(String(id))))];
  const allowed = new Set(ENCLAVE_TIERS[model]);
  const notAllowed = az.filter((id) => !allowed.has(reg.get(id)?.azure_tier ?? 'none'));
  const problems = [];
  if (model === 'm365_only' && az.length) problems.push(`m365_only plan holds ${az.length} AZ-* entr(ies): ${ex(az)}`);
  if (model !== 'm365_only' && !az.length) problems.push(`${model}: the plan holds no AZ-* entry (the merged registry is not loaded: DEPTH-2)`);
  if (notAllowed.length) problems.push(`${notAllowed.length} AZ-* entr(ies) outside the ${model} enclave filter: ${ex(notAllowed)}`);
  if (v72?.cli && v72?.gui && JSON.stringify(v72.cli) !== JSON.stringify(v72.gui)) problems.push('CLI and GUI plan projections differ (V72)');
  return verdict(problems, `${model}: ${az.length} AZ-* entr(ies), all inside the enclave filter${v72?.cli && v72?.gui ? '; CLI = GUI' : '; CLI/GUI projections not compared (none given)'}`);
}

// ---------- V96: manual paths keep actions, no free SAT ----------
export function judgeV96({ plan, registries, report = null, results = null }) {
  if (!plan) return { pass: false, detail: 'no out/executable-plan.json' };
  const reg = registryById(registries);
  const problems = [];
  // Manual-directive tasks: the registry entries for the task's control that are not manual-only must be planned.
  const lost = [];
  let manualTasks = 0;
  for (const t of tasksOf(plan)) {
    if (t.action?.args?._directive !== 'manual') continue;
    manualTasks++;
    const c = primaryControl(t);
    const planned = new Set(subsOf(t).map((s) => s.id));
    const want = (registries ?? []).filter((e) => (e.control_ids ?? [])[0] === c && !e.manual_only && !/^AZ-/.test(e.entry_id)).map((e) => e.entry_id);
    const gone = want.filter((id) => !planned.has(id));
    if (gone.length) lost.push(`${c} (${gone.length}: ${ex(gone, 2)})`);
  }
  if (lost.length) problems.push(`${lost.length} manual-directive task(s) dropped their non-manual-only entries: ${ex(lost)}`);
  // No manual-only entry yields SAT.
  const sat = [];
  for (const r of Array.isArray(results?.results) ? results.results : []) {
    for (const o of Array.isArray(r.entries) ? r.entries : []) {
      if (reg.get(o.entry_id)?.manual_only && /^(sat|pass)$/i.test(String(o.verdict ?? o.outcome ?? ''))) sat.push(o.entry_id);
    }
    if (r.directive === 'manual' && /^sat$/i.test(String(r.verdict ?? ''))) sat.push(`${r.controlId} (manual directive)`);
  }
  if (sat.length) problems.push(`${sat.length} manual-only path(s) yield SAT: ${ex(sat)}`);
  // No platform_inherited on RA / CA.
  const text = JSON.stringify(plan) + JSON.stringify(results ?? {}) + JSON.stringify(report ?? {});
  const inh = PLATFORM_INHERITED_BANNED.filter((c) => new RegExp(`${c.replace(/[.[\]-]/g, (m) => `\\${m}`)}[^{}]{0,400}platform_inherited|platform_inherited[^{}]{0,400}${c.replace(/[.[\]-]/g, (m) => `\\${m}`)}`).test(text));
  if (inh.length) problems.push(`platform_inherited claimed on ${inh.join(', ')}`);
  return verdict(problems, `${manualTasks} manual-directive task(s) keep their non-manual-only entries; no manual-only SAT; no platform_inherited on RA/CA${results ? '' : ' (no results manifest: SAT clause not judged)'}`);
}

// ---------- V97: per-objective postchecks evaluated ----------
export function judgeV97({ results = null, plan = null }) {
  if (!results) return { pass: false, detail: 'no Stamper results manifest (state/execution-results-<plan_id>.json)' };
  const rows = Array.isArray(results.results) ? results.results : [];
  if (!rows.some((r) => Array.isArray(r.objectives))) return notLanded('DEPTH-8', 'the results manifest has no per-objective verdicts', `${rows.length} control verdicts`);
  const problems = [];
  const noVerdict = [], unevaluated = [], wrongScope = [], presenceLeak = [];
  let objectives = 0, stateChecks = 0;
  for (const r of rows) {
    for (const o of r.objectives ?? []) {
      objectives++;
      if (!o.verdict) noVerdict.push(o.objective_id);
      for (const p of o.postchecks ?? []) {
        if (p.expected_value) {
          stateChecks++;
          if (p.observed_value === undefined) unevaluated.push(`${o.objective_id}:${p.check_id}`);
          if (p.read_control_id && p.read_control_id !== r.controlId) wrongScope.push(`${o.objective_id}:${p.check_id}`);
        }
        if (p.mode === 'presence' && Array.isArray(p.evidence_control_ids) && p.evidence_control_ids.some((c) => c !== r.controlId)) presenceLeak.push(`${o.objective_id}:${p.check_id}`);
      }
    }
  }
  if (plan?.plan_id && results.executablePlanId && results.executablePlanId !== plan.plan_id) problems.push(`manifest is for ${results.executablePlanId}, the plan is ${plan.plan_id}`);
  if (noVerdict.length) problems.push(`${noVerdict.length} objective(s) without a verdict: ${ex(noVerdict)}`);
  if (unevaluated.length) problems.push(`${unevaluated.length} expected-value postcheck(s) with no observed value: ${ex(unevaluated)}`);
  if (wrongScope.length) problems.push(`${wrongScope.length} expected-value postcheck(s) read another control's state: ${ex(wrongScope)}`);
  if (presenceLeak.length) problems.push(`${presenceLeak.length} presence check(s) using other controls' evidence: ${ex(presenceLeak)}`);
  return verdict(problems, `${objectives} objective verdicts; ${stateChecks} expected-value postchecks evaluated against this control's read, observed values recorded`);
}

// ---------- V98: registry hygiene and simulator answers ----------
/** Unbalanced single or double quotes outside the other quote kind (PowerShell doubling '' allowed). */
export function quotingProblem(cmd) {
  const t = String(cmd ?? '');
  if (!t.trim()) return null;
  let inS = false, inD = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '`' && inD) { i++; continue; }
    if (ch === "'" && !inD) { if (inS && t[i + 1] === "'") { i++; continue; } inS = !inS; }
    else if (ch === '"' && !inS) inD = !inD;
  }
  return inS ? 'unbalanced single quote' : inD ? 'unbalanced double quote' : null;
}
export const UNANSWERED_LEDGER_TYPES = ['unresolved', 'unanswered', 'miss', 'no-resolver'];
export function judgeV98({ plan, registries, objectivesRef, ledger = null, simulatorUnanswered = [] }) {
  if (!plan) return { pass: false, detail: 'no out/executable-plan.json' };
  const idx = objectiveIndex(objectivesRef);
  const reg = registryById(registries);
  const planned = [...new Set(tasksOf(plan).flatMap(subsOf).filter((s) => !isManualPseudo(s)).map((s) => s.id))];
  const notInReg = [], noObj = [], badObj = [], noSource = [], quoting = [];
  for (const id of planned) {
    const e = reg.get(id);
    if (!e) { notInReg.push(id); continue; }
    const ids = Array.isArray(e.objective_ids) ? e.objective_ids : null;
    if (!ids || !ids.length) noObj.push(id);
    else for (const o of ids) { const ref = idx.byId.get(o); if (!ref || !(e.control_ids ?? []).includes(ref.controlId)) badObj.push(`${id}:${o}`); }
    if (!String(e.source ?? '').trim()) noSource.push(id);
    for (const k of ['set_command', 'get_command']) { const q = quotingProblem(e[k]); if (q) quoting.push(`${id}.${k} (${q})`); }
  }
  const unansweredRows = (ledger ?? []).filter((r) => UNANSWERED_LEDGER_TYPES.includes(String(r?.type ?? '')) || r?.unresolved === true);
  const simMiss = (simulatorUnanswered ?? []).map((u) => (typeof u === 'string' ? u : u?.entry_id)).filter((id) => planned.includes(id));
  const problems = [];
  if (notInReg.length) problems.push(`${notInReg.length} planned entr(ies) not in either registry: ${ex(notInReg)}`);
  if (noObj.length) problems.push(`${noObj.length} planned entr(ies) without objective_ids: ${ex(noObj)}`);
  if (badObj.length) problems.push(`${badObj.length} objective id(s) that do not resolve to the entry's controls: ${ex(badObj)}`);
  if (noSource.length) problems.push(`${noSource.length} planned entr(ies) without a source: ${ex(noSource)}`);
  if (quoting.length) problems.push(`${quoting.length} quoting lint finding(s): ${ex(quoting)}`);
  if (unansweredRows.length) problems.push(`${unansweredRows.length} simulator ledger row(s) marked unanswered`);
  if (simMiss.length) problems.push(`${simMiss.length} planned entr(ies) the simulator cannot answer (depth-coverage.json): ${ex(simMiss)}`);
  return verdict(problems, `${planned.length} planned entries: objective ids resolve, sources present, quoting clean; the simulator answered every command${ledger ? '' : ' (no ledger: ledger clause not judged)'}`);
}

// ---------- V99: predicted = observed, or awaiting founder acceptance ----------
export function judgeV99({ prediction = null, observed = null, scoringSlices = [], slug = null }) {
  if (!prediction) {
    if (!scoringSlices.length) return { pass: true, detail: 'no scoring slice declared for this round (CES_ROUND_SCORING_SLICES unset); no prediction needed', awaiting: false };
    return { pass: false, detail: `not landed: DEPTH-12 prediction missing (out/depth-prediction.json) for scoring slice(s) ${scoringSlices.join(', ')}; awaiting founder acceptance, do not re-baseline`, awaiting: true };
  }
  const problems = [];
  if (prediction.schema !== DEPTH_PREDICTION_SCHEMA) problems.push(`prediction schema ${prediction.schema} (want ${DEPTH_PREDICTION_SCHEMA})`);
  if (slug && prediction.scenario !== slug) problems.push(`prediction is for ${prediction.scenario}, not ${slug}`);
  const missingSlices = scoringSlices.filter((s) => !(prediction.slices ?? []).includes(s));
  if (missingSlices.length) problems.push(`prediction does not cover declared slice(s) ${missingSlices.join(', ')}`);
  if (!observed) problems.push('no observed SPRS / statuses (out/summary or scorecard)');
  else {
    const p = prediction.predicted ?? {};
    if (p.sprs !== undefined && p.sprs !== observed.sprs) problems.push(`SPRS predicted ${p.sprs}, observed ${observed.sprs ?? 'none'}`);
    const diffs = Object.entries(p.statuses ?? {}).filter(([c, s]) => (observed.statuses ?? {})[c] !== s).map(([c, s]) => `${c} ${s} != ${(observed.statuses ?? {})[c] ?? 'none'}`);
    if (diffs.length) problems.push(`${diffs.length} status(es) differ: ${ex(diffs)}`);
  }
  if (problems.length) return { pass: false, detail: `${problems.join('; ')}; awaiting founder acceptance, do not re-baseline`, awaiting: true };
  return { pass: true, detail: `predicted = observed for ${(prediction.slices ?? []).join(', ') || 'no slices'}: SPRS ${observed.sprs}, ${Object.keys(prediction.predicted?.statuses ?? {}).length} status(es)`, awaiting: false };
}
/** True when a V99 row forbids replacing the baseline (rebaseline.mjs and the orchestrator read this). */
export function v99BlocksRebaseline(row) {
  return !row || row.pass !== true || row.awaiting === true;
}

// ---------- input builders ----------
export function depthFloor(vctx) {
  const ratchetFile = path.join(vctx.pkg, 'depth-floor.json');
  const covFile = path.join(vctx.pkg, 'out', 'depth-coverage.json');
  const cov = vctx.exists(covFile) ? vctx.readJson(covFile) : null;
  const row = (cov?.scenarios ?? []).find((s) => s.label === vctx.slug);
  let floor = row?.uncovered_floor ?? null;
  let source = row ? 'out/depth-coverage.json' : 'none';
  const ratchet = vctx.exists(ratchetFile) ? vctx.readJson(ratchetFile)?.[vctx.slug] : undefined;
  if (typeof ratchet === 'number' && (floor === null || ratchet < floor)) { floor = ratchet; source = 'depth-floor.json'; }
  return { floor, source, simulatorUnanswered: cov?.simulator_unanswered ?? [] };
}
export function resultsManifest(vctx, plan) {
  const reportPath = vctx.report?.resultsManifest?.path;
  const candidates = [
    ...(plan?.plan_id && vctx.tenantPlanData ? [path.join(vctx.tenantPlanData, 'state', `execution-results-${plan.plan_id}.json`)] : []),
    ...(reportPath ? [reportPath] : []),
  ];
  for (const f of candidates) if (vctx.exists(f)) { try { return vctx.readJson(f); } catch { /* next */ } }
  return null;
}
export function observedScores(vctx) {
  const s = vctx.summary ?? null;
  if (!s) return null;
  return { sprs: s.eo_assess?.sprs_score ?? s.sprs ?? null, statuses: s.status_by_control ?? {} };
}

export const DEPTH_CHECKS = [
  ['V91', 'Objective coverage: every in-scope objective has exactly one coverage record of a named type; configure names a configuring entry with that objective id; inherited / not_applicable carry a basis; uncovered <= the DEPTH-0 floor (warn) or zero (fail mode)'],
  ['V92', 'No implement-directive task whose sub-commands are all reads; no executed comment or placeholder; no report-only policy credited to an enforce objective'],
  ['V93', 'Credit by objective: task controls[] = its step’s controls; cross-credit only in credits[] with objective ids; no registry entry executes twice in one run'],
  ['V94', 'One postcheck per in-scope objective with an existing objective id; no boilerplate rows; no control outside the 110; every configure objective’s postcheck has expected_value'],
  ['V95', 'Azure entries: not m365_only => the plan holds the AZ-* entries the enclave filter allows; m365_only => none; CLI plan = GUI plan (V72)'],
  ['V96', 'Manual-directive tasks keep their non-manual-only entries; no manual-only entry yields SAT; no platform_inherited on RA/CA'],
  ['V97', 'Each expected-value postcheck was evaluated against this run’s read for its control, observed value recorded; presence checks use only that control’s evidence; a verdict per objective'],
  ['V98', 'Every planned entry has resolving objective_ids and a source; the quoting lint passes; the simulator answered every command'],
  ['V99', 'Each scoring slice’s predicted statuses and SPRS equal the observed ones, or the run is marked awaiting founder acceptance and the baseline is not replaced'],
];

/** All nine rows; a judge that throws becomes a red row with its error. Never throws. */
export async function runDepthChecks(vctx, env = process.env) {
  const plan = vctx?.exePlan ?? null;
  const judges = {
    V91: () => { const f = depthFloor(vctx); return judgeV91({ plan, objectivesRef: vctx.objectivesRef, registries: vctx.registries, floor: f.floor, floorSource: f.source, mode: env.CES_V91_MODE === 'fail' ? 'fail' : 'warn' }); },
    V92: () => judgeV92({ plan, objectivesRef: vctx.objectivesRef }),
    V93: () => judgeV93({ plan, objectivesRef: vctx.objectivesRef, report: vctx.report }),
    V94: () => judgeV94({ plan, objectivesRef: vctx.objectivesRef }),
    V95: () => judgeV95({ plan, im: vctx.im, registries: vctx.registries, v72: vctx.v72 }),
    V96: () => judgeV96({ plan, registries: vctx.registries, report: vctx.report, results: resultsManifest(vctx, plan) }),
    V97: () => judgeV97({ results: resultsManifest(vctx, plan), plan }),
    V98: () => judgeV98({ plan, registries: vctx.registries, objectivesRef: vctx.objectivesRef, ledger: vctx.ledger, simulatorUnanswered: depthFloor(vctx).simulatorUnanswered }),
    V99: () => {
      const f = path.join(vctx.out, 'depth-prediction.json');
      const slices = String(env.CES_ROUND_SCORING_SLICES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return judgeV99({ prediction: vctx.exists(f) ? vctx.readJson(f) : null, observed: observedScores(vctx), scoringSlices: slices, slug: vctx.slug });
    },
  };
  const rows = [];
  for (const [id, title] of DEPTH_CHECKS) {
    try {
      rows.push({ id, title, ...judges[id]() });
    } catch (e) {
      rows.push({ id, title, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return rows;
}

export { UNCOVERED };
