// Gap closure VER-1 (Blue Heron Defense, CES team): judges for V74 (PowerShell breakout over every AO template and every
// command of the run's executable plan) and V75 (AO and EO ran with tokens), GAP-CLOSURE-PLAN.md §5. Pure: the guard
// (ces-shared dist/security/psGuard.js: renderPs, psContext, psDoubleQuotedSafe), the AO templates and the plan are passed in
// by verify.mjs. The literal check below is an independent quote-state lexer; it does not reuse the guard's lexer.

// ---------- V74 ----------
// Breakout payloads. Each holds at least one character the double-quoted blocklist refuses
// (` ; | & < > $ ( ) " smart double quotes, NUL, line breaks); judgeV74 checks that with the guard's psDoubleQuotedSafe.
export const BREAKOUT_PAYLOADS = [
  "'; Remove-Item C:\\ -Recurse -Force; '",
  "x'; calc; 'y",
  "a' | Out-File C:\\pwn.txt; '",
  "'); Start-Process calc; ('",
  '$(Start-Process calc)',
  '$(calc)',
  '${env:USERPROFILE}; whoami',
  '$env:TEMP',
  '`n Remove-Item x',
  '`$x',
  'a"b',
  '"; calc; "',
  '" + (calc) + "',
  'x|calc',
  'x & calc',
  'x && calc',
  'x || calc',
  'x > C:\\out.txt',
  'x < C:\\in.txt',
  'x; calc',
  '-Force; calc',
  '@(calc)',
  '@{a=1}; calc',
  '--% & calc',
  '{x}; calc',
  '${x}; calc',
  '#> calc; <#',
  '<# x #> ; calc',
  '\u2018; calc; \u2019',
  '\u2019) ; calc ; (\u2018',
  '\u201A; calc',
  '\u201B| calc',
  '\u201C; calc; \u201D',
  '\u201E$(calc)',
  "O'Brien; calc",
  "''; calc; ''",
  "a\r\nRemove-Item x",
  "a\nRemove-Item x",
  "x\n'@\ncalc\n@'",
  "x\r'@\rcalc",
  'x\u0000; calc',
  'x\u2028calc;',
  'x\u2029calc;',
  'x\u0085calc;',
  '$null = calc',
  '(calc)',
  'x`; calc',
  "'@; calc",
];

// Independent quote classes (PowerShell treats the smart quotes as quotes).
const SQ = new Set(["'", '\u2018', '\u2019', '\u201A', '\u201B']);
const DQ = new Set(['"', '\u201C', '\u201D', '\u201E']);
const LINE_BREAK = /[\u0000\r\n\u0085\u2028\u2029]/;

// The command strings of an executable plan, as Stamper executes them (the SEC-2 golden test's planCommands):
// task command, _get_command, _evidence_commands, powershell_commands; sub-command set, get, evidence, preview and
// exclusion checks. Comparison values (lookup.source, *.equals, any_of / by_effect values) are not PowerShell and are left out.
export function planCommands(plan) {
  const out = [];
  const add = (where, c) => { if (typeof c === 'string' && c) out.push({ where, template: c }); };
  for (const t of plan?.execution_graph ?? []) {
    const a = t.action ?? {};
    const g = a.args ?? {};
    add(`${t.id}:command`, a.command);
    add(`${t.id}:_get_command`, g._get_command);
    (g._evidence_commands ?? []).forEach((c, i) => add(`${t.id}:_evidence_commands[${i}]`, c));
    (g.powershell_commands ?? []).forEach((c, i) => add(`${t.id}:powershell_commands[${i}]`, c));
    for (const s of g._sub_commands ?? []) {
      add(`${s.id}:set_command`, s.set_command);
      add(`${s.id}:get_command`, s.get_command);
      (s.evidence_commands ?? []).forEach((c, i) => add(`${s.id}:evidence_commands[${i}]`, c));
      add(`${s.id}:preview_command`, s.destructive_guard?.preview_command);
      (s.destructive_guard?.exclusion_checks ?? []).forEach((c, i) => add(`${s.id}:exclusion_checks[${i}]`, c));
    }
  }
  return out;
}

// The AO command strings as AO executes them: RegistryBridge.translateAoCommandToCommandEntry over every registry command
// (set_command, get_command, evidence_commands).
export function aoTemplates(translate, registry) {
  const out = [];
  for (const cmd of registry ?? []) {
    const e = translate(cmd);
    if (typeof e.set_command === 'string' && e.set_command) out.push({ where: `AO ${cmd.id}:set_command`, template: e.set_command });
    if (typeof e.get_command === 'string' && e.get_command) out.push({ where: `AO ${cmd.id}:get_command`, template: e.get_command });
    (e.evidence_commands ?? []).forEach((c, i) => { if (typeof c === 'string' && c) out.push({ where: `AO ${cmd.id}:evidence_commands[${i}]`, template: c }); });
  }
  return out;
}

// Independent lexer over a rendered command: the content spans [start, end) of every single-quoted literal ('single') and
// single-quoted here-string ('here-single'), at any depth. Unterminated literals are not reported (they contain nothing).
export function singleLiteralSpans(s) {
  const spans = [];
  const n = s.length;
  const boundary = (i) => i === 0 || /[\s;|&(){}]/.test(s[i - 1]);
  function single(i) {
    let j = i + 1;
    while (j < n) {
      if (SQ.has(s[j])) {
        if (j + 1 < n && SQ.has(s[j + 1])) { j += 2; continue; }
        spans.push({ start: i + 1, end: j, kind: 'single' });
        return j + 1;
      }
      j++;
    }
    return n;
  }
  function hereString(i, cls, kind) {
    // @' or @" must be followed by optional blanks and a line break; the body ends at a line break + quote + @.
    let j = i + 2;
    while (j < n && (s[j] === ' ' || s[j] === '\t')) j++;
    if (s[j] === '\r' && s[j + 1] === '\n') j += 2; else if (s[j] === '\n' || s[j] === '\r') j += 1; else return -1;
    const start = j;
    for (let k = start; k < n; k++) {
      if ((s[k] === '\n' || s[k] === '\r') && cls.has(s[k + 1]) && s[k + 2] === '@') {
        const end = s[k] === '\n' && s[k - 1] === '\r' && k - 1 >= start ? k - 1 : k;
        if (kind) spans.push({ start, end, kind });
        return k + 3;
      }
    }
    return n;
  }
  function dbl(i) {
    let j = i + 1;
    while (j < n) {
      const c = s[j];
      if (c === '`') { j += 2; continue; }
      if (DQ.has(c)) {
        if (j + 1 < n && DQ.has(s[j + 1])) { j += 2; continue; }
        return j + 1;
      }
      if (c === '$' && s[j + 1] === '(') { j = code(j + 2, true); continue; }
      j++;
    }
    return n;
  }
  function code(i, sub) {
    let depth = 0;
    while (i < n) {
      const c = s[i];
      if (c === '@' && SQ.has(s[i + 1])) { const r = hereString(i, SQ, 'here-single'); if (r >= 0) { i = r; continue; } }
      if (c === '@' && DQ.has(s[i + 1])) { const r = hereString(i, DQ, null); if (r >= 0) { i = r; continue; } }
      if (SQ.has(c)) { i = single(i); continue; }
      if (DQ.has(c)) { i = dbl(i); continue; }
      if (c === '`') { i += 2; continue; }
      if (c === '$' && s[i + 1] === '{') { const k = s.indexOf('}', i + 2); i = k < 0 ? n : k + 1; continue; }
      if (c === '<' && s[i + 1] === '#') { const k = s.indexOf('#>', i + 2); i = k < 0 ? n : k + 2; continue; }
      if (c === '#' && boundary(i)) { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      if (sub && c === '(') depth++;
      if (sub && c === ')') { if (depth === 0) return i + 1; depth--; }
      i++;
    }
    return n;
  }
  code(0, false);
  return spans;
}

const guardCode = (e) => (e && typeof e.code === 'string' && e.code.startsWith('PS_GUARD_') ? e.code : null);

// V74 judge. sources: [{where, template}] (AO templates and plan commands); guard: {renderPs, psContext, psDoubleQuotedSafe};
// kinds: the bare-token kinds the adapter passes (Stamper PS_TOKEN_KINDS). For every placeholder name of every template and
// every payload, render with only that name set:
//  - every occurrence single-quoted: the render must equal the template with each occurrence replaced by its expected body
//    (quote class doubled; raw in a here-string) and each body must lie inside one single-quoted literal (independent lexer);
//    a guard rejection is safe (counted). A render that slips a payload past either test is a "pass" (a breakout).
//  - any occurrence double-quoted or bare: the render must throw a guard error; rendering without one is a "pass".
// Zero passes = PASS. Floors: payloads >= 40, each refused by the double-quoted guard; at least one placeholder rendered.
export function judgeV74({ aoSources = null, aoCommands = null, planSources = null, guard = null, kinds = {}, payloads = BREAKOUT_PAYLOADS, maxExamples = 5 }) {
  const problems = [];
  if (!guard?.renderPs || !guard?.psContext || !guard?.psDoubleQuotedSafe) return { pass: false, detail: 'guard not loaded (ces-shared dist/security/psGuard.js)' };
  if (!aoSources) problems.push('AO templates not loaded');
  if (!planSources) problems.push('executable plan not loaded (out/executable-plan.json)');
  if (payloads.length < 40) problems.push(`${payloads.length} payloads (want 40+)`);
  const unblocked = payloads.filter((p) => { try { guard.psDoubleQuotedSafe(p); return true; } catch { return false; } });
  if (unblocked.length) problems.push(`${unblocked.length} payloads hold no double-quoted-blocklist char: ${unblocked.map((p) => JSON.stringify(p)).join(', ')}`);
  const tally = { ao: { templates: 0, placeholders: 0 }, plan: { templates: 0, placeholders: 0 } };
  const c = { renders: 0, contained: 0, rejectedSingle: 0, rejectedOther: 0, passes: 0, errors: 0 };
  const passEx = [];
  const errEx = [];
  const seen = new Map();
  const judgeTemplate = (template) => {
    const r = { placeholders: 0, renders: 0, contained: 0, rejectedSingle: 0, rejectedOther: 0, passes: [], errors: [] };
    let phs;
    try { phs = guard.psContext(template); } catch (e) { r.errors.push(`psContext: ${e instanceof Error ? e.message : String(e)}`); return r; }
    const byName = new Map();
    for (const ph of phs) { if (!byName.has(ph.name)) byName.set(ph.name, []); byName.get(ph.name).push(ph); }
    r.placeholders = byName.size;
    for (const [name, occ] of byName) {
      const allSingle = occ.every((o) => o.context === 'single');
      for (const p of payloads) {
        r.renders++;
        let out;
        try {
          out = guard.renderPs(template, { [name]: p }, { kinds });
        } catch (e) {
          if (guardCode(e)) { if (allSingle) r.rejectedSingle++; else r.rejectedOther++; continue; }
          r.errors.push(`{${name}} ${JSON.stringify(p)}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        if (!allSingle) { r.passes.push(`{${name}} (${occ.map((o) => o.context).join('/')}) rendered ${JSON.stringify(p)} without a guard error`); continue; }
        // Expected render and body spans.
        let expected = '';
        let last = 0;
        const bodies = [];
        for (const o of occ) {
          const here = o.quote === 'here-single';
          const body = here ? p : [...p].map((ch) => (SQ.has(ch) ? ch + ch : ch)).join('');
          expected += template.slice(last, o.start);
          bodies.push({ start: expected.length, end: expected.length + body.length, here });
          expected += body;
          last = o.end;
        }
        expected += template.slice(last);
        if (out !== expected) { r.passes.push(`{${name}} ${JSON.stringify(p)}: render differs from the escaped literal`); continue; }
        if (LINE_BREAK.test(p)) { r.passes.push(`{${name}} ${JSON.stringify(p)}: a line break reached a single-quoted literal`); continue; }
        const spans = singleLiteralSpans(out);
        const bad = bodies.filter((b) => !spans.some((sp) => sp.start <= b.start && b.end <= sp.end && (sp.kind === 'here-single') === b.here));
        if (bad.length) { r.passes.push(`{${name}} ${JSON.stringify(p)}: ${bad.length} occurrence(s) not inside one single-quoted literal`); continue; }
        r.contained++;
      }
    }
    return r;
  };
  for (const [side, sources] of [['ao', aoSources], ['plan', planSources]]) {
    for (const { where, template } of sources ?? []) {
      tally[side].templates++;
      if (!seen.has(template)) seen.set(template, judgeTemplate(template));
      const r = seen.get(template);
      tally[side].placeholders += r.placeholders;
      c.renders += r.renders; c.contained += r.contained; c.rejectedSingle += r.rejectedSingle; c.rejectedOther += r.rejectedOther;
      c.passes += r.passes.length; c.errors += r.errors.length;
      for (const x of r.passes) if (passEx.length < maxExamples) passEx.push(`${where} ${x}`);
      for (const x of r.errors) if (errEx.length < maxExamples) errEx.push(`${where} ${x}`);
    }
  }
  if (c.passes) problems.push(`${c.passes} breakout(s), e.g. ${passEx.join('; ')}`);
  if (c.errors) problems.push(`${c.errors} non-guard error(s), e.g. ${errEx.join('; ')}`);
  if (c.renders === 0) problems.push('no placeholder rendered (vacuous)');
  const counts = `AO ${aoCommands ?? '?'} commands, ${tally.ao.templates} templates (${tally.ao.placeholders} placeholder names), plan ${tally.plan.templates} commands (${tally.plan.placeholders} placeholder names), ${seen.size} distinct; ${payloads.length} payloads; ${c.renders} renders: single-quoted ${c.contained} contained + ${c.rejectedSingle} rejected, double/bare ${c.rejectedOther} rejected, ${c.passes} passes`;
  return { pass: problems.length === 0, detail: problems.length ? `${problems.join('; ')} (${counts})` : counts };
}

// ---------- V75 ----------
// probe: out/auth-probe.json (mx-e2e/auth-probe@1, SEC-4); stale: verify.mjs staleOf(file) or null; steps: steps.json;
// e7a: out/adminops-e7a.json. Judged: AO had a token (/api/health auth ENFORCED; tokenless /api/commands 401, with the token
// 200), EO had a token (tokenless /api/ledger 401; /api/health with the token 200), E7A succeeded in this run with the
// tokens set (steps E7A rc 0, record ok and from this run, TESTER rc 0). Reported, not judged: bind, EO tokenless
// /api/health, steps AUTH rc.
export function judgeV75({ probe = null, probeFile = 'out/auth-probe.json', stale = null, steps = {}, e7a = null }) {
  if (!probe) return { pass: false, detail: `no ${probeFile} (the SEC-4 auth probe of mx-e2e.ps1 -Harness tester did not run or did not write it)` };
  if (stale) return { pass: false, detail: stale };
  const problems = [];
  const ms = (v) => { if (!v) return NaN; const m = /\/Date\((-?\d+)/.exec(String(v)); return m ? Number(m[1]) : Date.parse(String(v)); };
  if (probe.schema !== 'mx-e2e/auth-probe@1') problems.push(`schema ${probe.schema}`);
  if (probe.error) problems.push(`probe error: ${probe.error}`);
  if (steps?.E1?.started && !(ms(probe.taken) >= ms(steps.E1.started))) problems.push(`probe taken ${probe.taken} is before this run's E1 start ${steps.E1.started}`);
  const ao = probe.ao ?? {};
  const eo = probe.eo ?? {};
  if (ao.up !== true) problems.push('AO probe server did not come up');
  if (ao.health?.status !== 200) problems.push(`AO /api/health status ${ao.health?.status ?? 'none'} (want 200)`);
  if (ao.health?.body?.auth !== 'ENFORCED') problems.push(`AO /api/health auth ${JSON.stringify(ao.health?.body?.auth ?? null)} (want "ENFORCED")`);
  if (ao.api_no_token?.status !== 401) problems.push(`AO tokenless /api/commands status ${ao.api_no_token?.status ?? 'none'} (want 401)`);
  if (ao.api_with_token?.status !== 200) problems.push(`AO /api/commands with the token status ${ao.api_with_token?.status ?? 'none'} (want 200)`);
  if (eo.up !== true) problems.push('EO probe server did not come up');
  if (eo.api_no_token?.status !== 401) problems.push(`EO tokenless /api/ledger status ${eo.api_no_token?.status ?? 'none'} (want 401)`);
  if (eo.health?.status !== 200) problems.push(`EO /api/health with the token status ${eo.health?.status ?? 'none'} (want 200)`);
  if (!steps?.E7A) problems.push('no E7A row in steps.json');
  else if (steps.E7A.rc !== 0) problems.push(`E7A rc ${steps.E7A.rc}`);
  if (!e7a) problems.push('no out/adminops-e7a.json (E7A record)');
  else {
    if (e7a.ok !== true) problems.push('E7A record ok is not true');
    if (steps?.E7A && !(ms(e7a.started) >= ms(steps.E7A.started))) problems.push('the E7A record is not from this run (steps.json E7A)');
  }
  if (steps?.TESTER?.rc !== 0) problems.push(`TESTER rc ${steps?.TESTER?.rc ?? 'missing'} (the tokens were set around the tester run)`); problems.push(...v75StoreProblems(probe)); // FIN-42 clause (b), judged below the V-block (keeps the CRLF block in place)
  const reported = `bind ${JSON.stringify(ao.health?.body?.bind ?? null)} (reported, not judged); EO tokenless /api/health ${eo.health_no_token?.status ?? 'none'}; steps AUTH rc ${steps?.AUTH?.rc ?? 'none'}`;
  const ok = `AO: /api/health 200 auth ENFORCED, tokenless /api/commands 401, with token 200; EO: tokenless /api/ledger 401, /api/health with token 200; E7A rc 0 with ${e7a?.ops?.length ?? 0} ops, record ok; TESTER rc 0; (b) ${V75_STORE_OK}`;
  return { pass: problems.length === 0, detail: problems.length ? `${problems.join('; ')}; ${reported}` : `${ok}; ${reported}` };
}

// ---------- V86 (FLOW-6): RETIRED ----------
// Founder ruling 2026-10-30 (depth plan ROLE-1): Muster only collects data and writes the plan; it receives no execution
// results. V86 is never judged: it always reports V86_RETIRED and reads no evidence. The number is not reused. V100
// (below) checks the loop is gone.
export const V86_RETIRED = 'RETIRED (founder ruling 2026-10-30)';
export function judgeV86() {
  return { pass: true, retired: true, detail: V86_RETIRED };
}

// ---------- V100 (depth plan ROLE-1, harness scope) ----------
// Muster holds no execution results, as far as the harness can see. Evidence (all read by verify.mjs):
//   e6: out/steps.json E6 (muster_api_url = whether CES_MUSTER_API_URL was set for E6's stamper execute; both harnesses);
//   musterResultsPresent: out/muster-results.json exists (the retired FLOW-6 read-back; any copy fails, stale or not);
//   directiveStatusFiles: directive-status-*.json under pl/Stamper/plan-data/<slug>/state and out/st/state (muster-api's
//     retired status sidecar);
//   resultsManifest: the newest pl/Stamper/plan-data/<slug>/state/execution-results-*.json (not .delivery.json), the
//     manifest EO's StamperExecutionResultsLoader reads; it must still exist;
//   report: out/execution-report.json (resultsManifest.delivery: "delivered" fails; "skipped" or absent passes).
// Not checked here: that muster-api's /api/plan/results and /api/plan/status routes are gone (ROLE-3, ces-muster tests).
export const V100_ROUTES_NOTE = 'route absence (/api/plan/results, /api/plan/status): not checked here (ROLE-3)';
export function judgeV100({ e6 = null, musterResultsPresent = false, directiveStatusFiles = [], resultsManifest = null, report = null }) {
  const problems = [];
  if (!e6) problems.push('no steps.json E6 record');
  else if (!Object.prototype.hasOwnProperty.call(e6, 'muster_api_url')) problems.push('the E6 record has no muster_api_url (harness not updated, or ces-tester dist/ not rebuilt?)');
  else if (e6.muster_api_url !== false) problems.push(`E6 ran with CES_MUSTER_API_URL set (muster_api_url ${JSON.stringify(e6.muster_api_url)})`);
  if (musterResultsPresent) problems.push('out/muster-results.json exists (the retired FLOW-6 read-back)');
  if (directiveStatusFiles.length) problems.push(`${directiveStatusFiles.length} directive-status file(s): ${directiveStatusFiles.slice(0, 3).join(', ')}`);
  if (!resultsManifest) problems.push('no execution-results-*.json manifest in the tenant state folder (EO reads it)');
  const delivery = report?.resultsManifest?.delivery ?? null;
  if (delivery?.status === 'delivered') problems.push('execution-report.json resultsManifest.delivery is "delivered" (Stamper sent results to Muster)');
  const ok = `E6 ran without CES_MUSTER_API_URL; no out/muster-results.json; no directive-status file; results manifest ${resultsManifest} present; Stamper delivery ${delivery?.status ?? 'absent'}`;
  return { pass: problems.length === 0, detail: `${problems.length ? problems.join('; ') : ok}; ${V100_ROUTES_NOTE}` };
}

// ---------- V81 (NS-3 + NS-2) ----------
// Three clauses, one id. (1) stores: expected = build-customer-records.mjs eoRecordExpectations(loadEoRecordPosts(pkg,
// slug)) (null: the customer has no records); record = out/eo-records.json (ces-tester/eo-records@1, E7; the NS-3 posts run
// by default since founder decision D-7, CES_NS3_EO_RECORDS=0 turns them off); stale as V75. EO's personnel (by e-mail, end
// screening state, the offboarding overlay for a completed leaver), training completions and risk register hold every
// customer-file row. (2) interviews: interviews = out/eo-interviews.json (ces-tester/eo-interviews@1, E7, NS-4t): EO took
// the batch (201), built = V81_INTERVIEW_EXPECTED[slug] (LOG-GC-NS-4t.md), and GET /api/interviews listed >= built.
// (3) SSP citations: out/ssp.json's PS.* narratives cite EO's personnel store ("Personnel Screening Status: <cleared>/<active>
// cleared") and its AT.* narratives the training store ("Current status: <n>/<active> personnel compliant"), counts from
// the store read-back in the record (the SSP is generated from the same stores at E8). PKG-2 (NS-3b, D-2): when E8.5
// uploaded the organisation's screening records, EO's readiness from those records decides PS.L2-3.9.1 and the SSP cites
// it, so the PS line wanted is orgReadiness's ("<cleared>/<total> cleared, <unscreened> unscreened (from the organisation's
// screening records)", v81OrgReadiness over the uploaded record files); AT.L2-3.2.2 may instead say the training store does
// not decide it (a role-scoped course only). Reported, not judged: policies (none in the customer files), extra store rows,
// the compliant counts. Clauses 1 and 3 are not applicable without records; every clause is "not run" under -Harness mx
// (the posts are tester-only).
export const V81_DEFERRED = 'reported, not judged: policies (none in the customer files), extra store rows';
// FIN-26 (FD-9; PH-5, R-EO diff E): +1 on S1/S2 for the PI.PER.012 role-population record (LOG-FIN-26.md).
export const V81_INTERVIEW_EXPECTED = { 's1-mach': 143, 's2-eng': 144, 's3-def': 105, 'muster-partial': 0 };
function v81Stores({ slug, expected, record, recordFile, stale, harness }) {
  if (!expected) return { pass: true, detail: `stores: not applicable (customers/${slug} has no records catalog: no personnel, training or risk records)` };
  if (!record) {
    return harness === 'tester'
      ? { pass: false, detail: `stores: no ${recordFile}: the NS-3 posts did not run (on by default since D-7; CES_NS3_EO_RECORDS=0 set, or the ces-tester dist not rebuilt?)` }
      : { pass: true, detail: `stores: not run (-Harness ${harness}: NS-3 posts run under -Harness tester only)` };
  }
  if (stale) return { pass: false, detail: `stores: ${stale}` };
  const problems = [];
  if (record.schema !== 'ces-tester/eo-records@1') problems.push(`schema ${record.schema}`);
  if (record.tenant_slug !== slug) problems.push(`tenant ${record.tenant_slug} != ${slug}`);
  if ((record.errors ?? []).length) problems.push(`${record.errors.length} post error(s): ${record.errors.slice(0, 3).map((e) => `${e.what} HTTP ${e.status}`).join('; ')}`);
  const people = record.stores?.personnel ?? [];
  const byEmail = new Map();
  for (const p of people) { const k = String(p.email).toLowerCase(); byEmail.set(k, [...(byEmail.get(k) ?? []), p]); }
  const missing = []; const dup = []; const state = [];
  for (const e of expected.personnel) {
    const hits = byEmail.get(e.email.toLowerCase()) ?? [];
    if (!hits.length) { missing.push(e.email); continue; }
    if (hits.length > 1) dup.push(e.email);
    const p = hits[0];
    if (p.screeningState !== e.screeningState) state.push(`${e.email} ${p.screeningState} (want ${e.screeningState})`);
    if (e.overlay && !(p.artifactTypes ?? []).includes('offboarding-procedural-overlay')) state.push(`${e.email} has no offboarding overlay`);
  }
  if (missing.length) problems.push(`${missing.length} person(s) not in EO's personnel store: ${missing.slice(0, 3).join(', ')}`);
  if (dup.length) problems.push(`${dup.length} duplicated person(s): ${dup.slice(0, 3).join(', ')}`);
  if (state.length) problems.push(`${state.length} state mismatch(es): ${state.slice(0, 3).join('; ')}`);
  const tr = record.stores?.training ?? {};
  const trMissing = expected.training.filter((t) => !(tr[t.email] ?? []).some((c) => c.courseId === t.courseId && c.completedDate === t.completedDate));
  if (trMissing.length) problems.push(`${trMissing.length} training completion(s) missing: ${trMissing.slice(0, 3).map((t) => `${t.email} ${t.courseId}`).join('; ')}`);
  const risks = record.stores?.risks ?? [];
  const rkMissing = expected.risks.filter((k) => !risks.some((r) => r.sourceReference === k.sourceReference && r.threatEvent === k.threatEvent));
  if (rkMissing.length) problems.push(`${rkMissing.length} risk entries missing: ${rkMissing.map((k) => k.sourceReference).join(', ')}`);
  const extra = people.length - new Set(expected.personnel.map((e) => e.email.toLowerCase())).size;
  const reported = `policies ${record.policies?.posted ?? 0} posted (${record.policies?.note ?? 'no note'})${extra > 0 ? `; ${extra} store person(s) not in the customer files` : ''}`;
  const ok = `EO stores match the customer files: ${expected.personnel.length} personnel (states and offboarding overlays), ${expected.training.length} training completion(s), ${expected.risks.length} risk entries`;
  return { pass: problems.length === 0, detail: `stores: ${problems.length ? problems.join('; ') : ok}; ${reported}` };
}
function v81Interviews({ slug, interviews, interviewsFile, interviewsStale, harness }) {
  if (harness !== 'tester') return { pass: true, detail: `interviews: not run (-Harness ${harness}: the interview posts run under -Harness tester only)` };
  if (!interviews) return { pass: false, detail: `interviews: no ${interviewsFile} (E7 did not post the interview records, or it threw: see steps.json E7 eo_interviews)` };
  if (interviewsStale) return { pass: false, detail: `interviews: ${interviewsStale}` };
  const want = V81_INTERVIEW_EXPECTED[slug];
  const problems = [];
  if (interviews.schema !== 'ces-tester/eo-interviews@1') problems.push(`schema ${interviews.schema}`);
  if (interviews.tenant !== slug) problems.push(`tenant ${interviews.tenant} != ${slug}`);
  if (want !== undefined && interviews.built !== want) problems.push(`built ${interviews.built} interview record(s), want ${want}`);
  if (interviews.built > 0) {
    if (interviews.http_status !== 201) problems.push(`POST /api/interviews HTTP ${interviews.http_status ?? 'none'}`);
    if (typeof interviews.listed !== 'number') problems.push('GET /api/interviews gave no list');
    else if (interviews.listed < interviews.built) problems.push(`EO lists ${interviews.listed} < built ${interviews.built}`);
  }
  const ok = interviews.built > 0
    ? `${interviews.built} built (want ${want ?? 'not pinned'}), EO stored ${interviews.stored}, skipped ${interviews.skipped} (already held), lists ${interviews.listed}`
    : `none built (want ${want ?? 'not pinned'}): ${interviews.note ?? 'no note'}`;
  return { pass: problems.length === 0, detail: `interviews: ${problems.length ? problems.join('; ') : ok}` };
}
// The PS readiness EO takes from the organisation's uploaded personnel records (ces-eo personnel/OrganisationPersonnel.ts
// readinessFromOrganisationRecords, restated from the record rules, not imported): one person per owner_person_id, else
// person_id, at the latest screening row by date ('cleared' is cleared, anything else is not); a leaver (lifecycle event
// 'termination') whose every account-disable step is 'done' is offboarded and leaves the population. null without a
// screening row (EO then cites its own store, as before).
const V81_ACCOUNT_DISABLE_STEP = /account[^;]*\bdisabl|disabl\w*[^;]*\baccount/i;
export const V81_ORG_SOURCE = "(from the organisation's screening records)";
export const V81_AT_NOT_DECIDED = 'so the training store does not decide this control';
export const V81_AT_ROLE_SCOPED_CONTROLS = ['AT.L2-3.2.2'];
export function v81OrgReadiness({ screening = [], lifecycle = [] } = {}) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const personOf = (r) => str(r.owner_person_id) || str(r.person_id);
  if (!screening.length) return null;
  const leavers = new Map();
  for (const r of lifecycle) {
    if (str(r.event).toLowerCase() !== 'termination') continue;
    const id = personOf(r);
    if (id) leavers.set(id, [...(leavers.get(id) ?? []), r]);
  }
  const offboarded = new Set([...leavers].filter(([, rows]) => {
    const d = rows.filter((r) => V81_ACCOUNT_DISABLE_STEP.test(str(r.step)));
    return d.length > 0 && d.every((r) => str(r.status).toLowerCase() === 'done');
  }).map(([id]) => id));
  const latest = new Map();
  for (const r of screening) {
    const id = personOf(r);
    if (!id) continue;
    const p = latest.get(id);
    if (!p || str(r.date) >= str(p.date)) latest.set(id, r);
  }
  const active = [...latest].filter(([id]) => !offboarded.has(id));
  const cleared = active.filter(([, r]) => str(r.result).toLowerCase() === 'cleared').length;
  return { cleared, total: active.length, unscreened: active.length - cleared, offboarded: offboarded.size };
}
function v81Citations({ expected, record, ssp, harness, orgReadiness = null }) {
  if (!expected) return { pass: true, detail: 'SSP citations: not applicable (no records posted)' };
  if (harness !== 'tester') return { pass: true, detail: `SSP citations: not run (-Harness ${harness})` };
  if (!record) return { pass: true, detail: 'SSP citations: not judged (no current store record; the stores clause fails)' };
  if (!ssp) return { pass: false, detail: 'SSP citations: no out/ssp.json' };
  const active = (record.stores?.personnel ?? []).filter((p) => p.screeningState !== 'offboarded');
  const cleared = active.filter((p) => p.screeningState === 'cleared').length;
  const rows = (ssp.controlImplementations ?? []).filter((c) => /^(PS|AT)\./.test(c.control_id ?? ''));
  const ps = rows.filter((c) => c.control_id.startsWith('PS.'));
  const at = rows.filter((c) => c.control_id.startsWith('AT.'));
  const problems = [];
  if (!ps.length || !at.length) problems.push(`out/ssp.json has ${ps.length} PS and ${at.length} AT control(s)`);
  const psLine = orgReadiness
    ? `Personnel Screening Status: ${orgReadiness.cleared}/${orgReadiness.total} cleared, ${orgReadiness.unscreened} unscreened ${V81_ORG_SOURCE}`
    : `Personnel Screening Status: ${cleared}/${active.length} cleared`;
  const psFrom = orgReadiness ? 'the readiness from the uploaded organisation records' : 'the personnel store';
  const psBad = ps.filter((c) => !String(c.implementationNarrative ?? '').includes(psLine)).map((c) => c.control_id);
  if (psBad.length) problems.push(`${psBad.join(', ')} do(es) not cite ${psFrom} ("${psLine}")`);
  const atRe = new RegExp(`Current status: (\\d+)/${active.length} personnel compliant`);
  const compliant = [];
  const notDecided = [];
  const atBad = [];
  for (const c of at) {
    const n = String(c.implementationNarrative ?? '');
    // FD-9 (FIN-26; PH-5, R-EO diff F): a role-scoped control counts only its operator-defined population, not every active person.
    const m = n.match(V81_AT_ROLE_SCOPED_CONTROLS.includes(c.control_id) ? /Current status: (\d+)\/(\d+) personnel compliant/ : atRe);
    if (m) compliant.push(`${c.control_id} ${m[1]}/${m[2] ?? active.length}`);
    else if (V81_AT_ROLE_SCOPED_CONTROLS.includes(c.control_id) && n.includes(V81_AT_NOT_DECIDED)) notDecided.push(c.control_id);
    else atBad.push(c.control_id);
  }
  if (atBad.length) problems.push(`${atBad.join(', ')} do(es) not cite the training store ("Current status: <n>/${active.length} personnel compliant")`);
  const ok = `${ps.length} PS narrative(s) cite "${psLine}" (${psFrom}); AT compliant counts ${compliant.join(', ')}${notDecided.length ? `; ${notDecided.join(', ')} not decided by the training store (role-scoped course only, NS-3b)` : ''} (reported, not judged)`;
  return { pass: problems.length === 0, detail: `SSP citations: ${problems.length ? problems.join('; ') : ok}` };
}
export function judgeV81({ slug = '', expected = null, record = null, recordFile = 'out/eo-records.json', stale = null, harness = 'mx', interviews = null, interviewsFile = 'out/eo-interviews.json', interviewsStale = null, ssp = null, orgReadiness = null }) {
  const parts = [
    v81Stores({ slug, expected, record, recordFile, stale, harness }),
    v81Interviews({ slug, interviews, interviewsFile, interviewsStale, harness }),
    v81Citations({ expected, record: stale ? null : record, ssp, harness, orgReadiness }),
  ];
  return { pass: parts.every((p) => p.pass), detail: `${parts.map((p) => p.detail).join(' | ')}; ${V81_DEFERRED}` };
}

// ---------- V85 (FLOW-4) ----------
// Stamper evidence in EO's hash chain. records: EO's evidence-store records of source collect.stamperEvidence (collector
// C11, ces-eo src/eo/collect/StamperEvidenceCollector.ts), each { endpoint, status, payload }, in chain order; files: the
// evidence files EO assesses from on disk now (pl/Stamper/plan-data/<slug>/evidence/**.json with metadata.controlIds),
// each { relPath, sha256 } of the bytes; rows: the tenant's ces.db stamper_evidence_metadata rows { id, sha256_hash }
// (null when ces.db could not be read: rowsError says why); otherTenantRows: rows of other tenant ids (reported only).
// Judged: (a) every file is a C11 file record with the same sha256, and the last C11 index (the last assess pass) lists
// exactly the files on disk; (b) every index of the run names only ids that have a file record; (c) every row is a C11
// row record with the same hash; (d) per-control SSP statuses equal the baseline's status_by_control.
export const V85_SOURCE = 'collect.stamperEvidence';
export function judgeV85({ storePresent = false, records = null, files = null, rows = null, rowsError = null, otherTenantRows = 0, statusBy = null, baselineBy = null }) {
  if (!storePresent) return { pass: false, detail: 'no EO evidence store under out/eo/evidence-store (EO did not run)' };
  const c11 = records ?? [];
  if (!c11.length) return { pass: false, detail: `no ${V85_SOURCE} records in EO's evidence store (FLOW-4 collector C11 did not run: ces-eo not rebuilt?)` };
  const problems = [];
  const ok = c11.filter((r) => r.status === 'success' && r.payload);
  const fileShaById = new Map(ok.filter((r) => r.endpoint === 'stamper_evidence/file').map((r) => [r.payload.id, r.payload.fileSha256]));
  const chainedPairs = new Set(ok.filter((r) => r.endpoint === 'stamper_evidence/file').map((r) => `${r.payload.relPath}@${r.payload.fileSha256}`));
  const rowShaById = new Map(ok.filter((r) => r.endpoint === 'stamper_evidence/row').map((r) => [r.payload.rowId, r.payload.metaSha256]));
  const indexes = ok.filter((r) => r.endpoint === 'stamper_evidence/index').map((r) => r.payload);
  if (!indexes.length) problems.push('no C11 index record');
  const disk = files ?? [];
  const notChained = disk.filter((f) => !chainedPairs.has(`${f.relPath}@${f.sha256}`)).map((f) => f.relPath);
  if (notChained.length) problems.push(`${notChained.length} evidence file(s) not in the chain with the same sha256: ${notChained.slice(0, 5).join(', ')}`);
  const last = indexes.at(-1);
  if (last) {
    const want = new Set(disk.map((f) => `file:${f.relPath}@${f.sha256}`));
    const got = new Set(last.fileIds ?? []);
    const extra = [...got].filter((id) => !want.has(id));
    const absent = [...want].filter((id) => !got.has(id));
    if (extra.length || absent.length) problems.push(`last index differs from the files on disk: ${absent.length} absent, ${extra.length} extra (e.g. ${[...absent, ...extra].slice(0, 3).join(', ')})`);
  }
  const dangling = indexes.flatMap((ix) => (ix.fileIds ?? []).filter((id) => !fileShaById.has(id)));
  if (dangling.length) problems.push(`${dangling.length} indexed file id(s) without a file record: ${dangling.slice(0, 3).join(', ')}`);
  let rowNote;
  if (rows === null) rowNote = `ces.db rows not read (${rowsError ?? 'unknown'})`;
  else {
    const badRows = rows.filter((r) => rowShaById.get(r.id) !== r.sha256_hash).map((r) => r.id);
    if (badRows.length) problems.push(`${badRows.length} stamper_evidence_metadata row(s) not in the chain with the same hash: ${badRows.slice(0, 5).join(', ')}`);
    rowNote = `${rows.length} stamper_evidence_metadata row(s) in the chain with the same hash`;
  }
  if (otherTenantRows) rowNote += `; ${otherTenantRows} row(s) under other tenant ids (not judged)`;
  let statusNote;
  if (!baselineBy) statusNote = 'statuses not asserted: baseline has no status_by_control';
  else if (!statusBy) { problems.push('no per-control SSP status (out/ssp.json)'); statusNote = ''; }
  else {
    const moved = Object.keys({ ...baselineBy, ...statusBy }).filter((id) => baselineBy[id] !== statusBy[id]);
    if (moved.length) problems.push(`${moved.length} control status(es) moved from the baseline: ${moved.slice(0, 5).map((id) => `${id} ${baselineBy[id]}->${statusBy[id]}`).join(', ')}`);
    statusNote = `${Object.keys(statusBy).length} control statuses = baseline`;
  }
  const okDetail = `${disk.length} evidence file(s) on disk all in the chain with the same sha256; last index = disk; ${indexes.length} index(es), ${fileShaById.size} file record(s); ${rowNote}; ${statusNote}`;
  return { pass: problems.length === 0, detail: problems.length ? `${problems.join('; ')} (${rowNote})` : okDetail };
}

// ---------- V82 (FLOW-1) ----------
// Muster's write-once records in ces.db (muster-api: muster_plan_push per accepted push, muster_discovery per completed
// discovery run; ces-shared DEFAULT_WORM_COLLECTIONS). collectV82 reads them from a COPY of ces.db (plus its -wal/-shm)
// with ces-shared's built CesRepository and probes the copy: put over an existing id, update and delete must each be
// refused with CesWormError and leave the row as it was. The live ces.db is never opened.
export const V82_COLLECTIONS = { push: 'muster_plan_push', discovery: 'muster_discovery' };
export async function collectV82({ dbFile, slug, repoMod, tmpRoot }) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (!dbFile || !fs.existsSync(dbFile)) return { error: `no ${dbFile ?? 'ces.db'} (muster-api never wrote a WORM record)` };
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'v82-'));
  const copy = path.join(dir, 'ces.db');
  for (const sfx of ['', '-wal', '-shm']) if (fs.existsSync(dbFile + sfx)) fs.copyFileSync(dbFile + sfx, copy + sfx);
  const repo = new repoMod.CesRepository(copy);
  try {
    const scope = { tenantSlug: slug };
    const pushRows = repo.list(V82_COLLECTIONS.push, scope);
    const discoveryRows = repo.list(V82_COLLECTIONS.discovery, scope);
    const target = pushRows.at(-1) ? [V82_COLLECTIONS.push, pushRows.at(-1)] : discoveryRows.at(-1) ? [V82_COLLECTIONS.discovery, discoveryRows.at(-1)] : null;
    let probe = null;
    if (target) {
      const [coll, row] = target;
      const refused = (fn) => { try { fn(); return false; } catch (e) { return e?.name === 'CesWormError'; } };
      probe = {
        collection: coll, id: row.id,
        put: refused(() => repo.put(coll, { id: row.id, ces: scope, data: { tampered: 'V82 probe' } })),
        update: refused(() => repo.update(coll, row.id, scope, { tampered: 'V82 probe' })),
        delete: refused(() => repo.delete(coll, row.id, scope)),
      };
      probe.intact = JSON.stringify(repo.get(coll, row.id, scope)?.data ?? null) === JSON.stringify(row.data);
    }
    return { pushRows, discoveryRows, probe };
  } finally {
    repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// collected: collectV82's result; pushResponse: out/push-response.json ({ pushed: [...] }, E4); fileSha: name -> SHA-256
// of that file in Stamper's plans folder now (null when missing); discoverySha: SHA-256 of out/discovery-result.json (E2);
// runStartMs: this run's E1 start (NaN: not judged); e4Mode: steps.json E4.mode. Judged: one push row lists exactly the
// pushed files with hashes equal to the files, written at or after the run start; one discovery row of this run has the
// hash of discovery-result.json; the overwrite probe on the copy was refused three ways and the row stayed intact.
export function judgeV82({ slug = '', collected = null, pushResponse = null, fileSha = {}, discoverySha = null, runStartMs = NaN, e4Mode = null }) {
  if (!collected) return { pass: false, detail: 'V82 not collected' };
  if (collected.error) return { pass: false, detail: collected.error };
  const problems = [];
  const after = (at) => !Number.isFinite(runStartMs) || Date.parse(at) >= runStartMs;
  const pushed = Array.isArray(pushResponse?.pushed) ? pushResponse.pushed : null;
  let pushRow = null;
  if (!pushed) problems.push(`no out/push-response.json pushed list (E4 mode ${e4Mode ?? 'unknown'}; the direct-write fallback leaves no WORM row)`);
  else {
    pushRow = collected.pushRows.find((r) => JSON.stringify((r.data?.files ?? []).map((f) => f.name)) === JSON.stringify(pushed)) ?? null;
    if (!pushRow) problems.push(`no ${V82_COLLECTIONS.push} row for ${slug} lists this run's ${pushed.length} pushed file(s) (${collected.pushRows.length} row(s) for the tenant)`);
    else {
      if (!after(pushRow.data.at)) problems.push(`push row ${pushRow.id} written ${pushRow.data.at}, before this run's start`);
      const bad = pushRow.data.files.filter((f) => fileSha[f.name] !== f.sha256);
      if (bad.length) problems.push(`${bad.length} pushed file hash(es) differ from the WORM row: ${bad.slice(0, 3).map((f) => `${f.name} ${fileSha[f.name] ? 'changed' : 'missing'}`).join('; ')}`);
    }
  }
  const discRows = collected.discoveryRows.filter((r) => after(r.data?.at));
  const discRow = discoverySha ? discRows.find((r) => r.data?.result_sha256 === discoverySha) ?? null : null;
  if (!discoverySha) problems.push('no out/discovery-result.json (E2)');
  else if (!discRow) problems.push(`no ${V82_COLLECTIONS.discovery} row of this run has discovery-result.json's hash ${discoverySha.slice(0, 12)} (${discRows.length} row(s) of this run for ${slug})`);
  const p = collected.probe;
  if (!p) problems.push('no Muster WORM row to probe');
  else {
    const allowed = ['put', 'update', 'delete'].filter((k) => !p[k]);
    if (allowed.length) problems.push(`overwrite probe on the ces.db copy NOT refused for ${allowed.join(', ')} (${p.collection} ${p.id})`);
    if (!p.intact) problems.push(`probed row ${p.id} changed on the copy`);
  }
  const ok = `${V82_COLLECTIONS.push} ${pushRow?.id} holds ${pushRow?.data?.files?.length ?? 0} file hash(es) equal to the pushed files; ${V82_COLLECTIONS.discovery} ${discRow?.id} holds discovery-result.json's hash; overwrite probe on a copy of ces.db refused (put, update, delete; ${p?.collection})`;
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : ok };
}
// ---------- V90 (KB-2) ----------
// V90: the KB-1 assessor KBs (ces-shared dist/data assessor-approach and assessor-evidence-matrix) cover the 110
// practices and every one of the 320 NIST SP 800-171A objectives (dist/data assessment-objectives) resolves in both;
// the run's SSP carries an assessmentApproach (EO GC-KB-2) for every practice whose objectives match the reference.
// The index part ("a row per met control", PKG-3): with `index` (the EO package's evidence-index.json, null when absent) every met
// SSP control has at least one objectiveRows row; without `index` it is reported "not yet checked" (V90_DEFERRED).
export const V90_DEFERRED = 'index part (a row per met control): not yet checked (PKG-3)';
export function judgeV90({ approach = null, matrix = null, objectivesRef = null, ssp = null, index = undefined, maxExamples = 5 }) {
  if (!approach || !matrix || !objectivesRef) {
    const missing = [!approach && 'assessor-approach', !matrix && 'assessor-evidence-matrix', !objectivesRef && 'assessment-objectives'].filter(Boolean);
    return { pass: false, detail: `missing ces-shared dist data: ${missing.join(', ')}; ${V90_DEFERRED}` };
  }
  const problems = [];
  const ex = (xs) => `${xs.slice(0, maxExamples).join(', ')}${xs.length > maxExamples ? ` (+${xs.length - maxExamples})` : ''}`;
  const refByControl = new Map();
  for (const o of objectivesRef.objectives ?? []) refByControl.set(o.controlId, [...(refByControl.get(o.controlId) ?? []), o.objectiveId]);
  const refIds = new Set((objectivesRef.objectives ?? []).map((o) => o.objectiveId));
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  // Approach KB: 110 practices, each practice's objectives = the reference's.
  const practices = approach.practices ?? [];
  const pIds = practices.map((p) => p.id);
  if (new Set(pIds).size !== pIds.length) problems.push('assessor-approach has duplicate practice ids');
  const pMissing = [...refByControl.keys()].filter((id) => !pIds.includes(id));
  const pExtra = pIds.filter((id) => !refByControl.has(id));
  if (refByControl.size !== 110) problems.push(`reference has ${refByControl.size} practices (want 110)`);
  if (pMissing.length) problems.push(`assessor-approach lacks ${pMissing.length} practice(s): ${ex(pMissing)}`);
  if (pExtra.length) problems.push(`assessor-approach has ${pExtra.length} unknown practice(s): ${ex(pExtra)}`);
  const pObjBad = practices.filter((p) => refByControl.has(p.id) && !sameSet((p.objectives ?? []).map((o) => o.id), refByControl.get(p.id))).map((p) => p.id);
  if (pObjBad.length) problems.push(`assessor-approach objectives differ from the reference for ${ex(pObjBad)}`);
  const pEmpty = practices.filter((p) => !String(p.what_assessor_does ?? '').trim()).map((p) => p.id);
  if (pEmpty.length) problems.push(`assessor-approach has no approach text for ${ex(pEmpty)}`);
  // Evidence matrix: 320 objectives, all resolve, each with at least one evidence row; practices covered.
  const mObjs = matrix.objectives ?? [];
  const mIds = mObjs.map((o) => o.id);
  if (new Set(mIds).size !== mIds.length) problems.push('assessor-evidence-matrix has duplicate objective ids');
  const mUnresolved = mIds.filter((id) => !refIds.has(id));
  const mMissing = [...refIds].filter((id) => !mIds.includes(id));
  if (refIds.size !== 320) problems.push(`reference has ${refIds.size} objectives (want 320)`);
  if (mUnresolved.length) problems.push(`${mUnresolved.length} matrix objective(s) do not resolve: ${ex(mUnresolved)}`);
  if (mMissing.length) problems.push(`assessor-evidence-matrix lacks ${mMissing.length} objective(s): ${ex(mMissing)}`);
  const mNoRows = mObjs.filter((o) => !(o.evidence ?? []).length).map((o) => o.id);
  if (mNoRows.length) problems.push(`${mNoRows.length} matrix objective(s) have no evidence row: ${ex(mNoRows)}`);
  const mPractices = new Set(mObjs.map((o) => o.practice_id));
  const mPracticeMissing = [...refByControl.keys()].filter((id) => !mPractices.has(id));
  if (mPracticeMissing.length) problems.push(`assessor-evidence-matrix covers no objective of ${ex(mPracticeMissing)}`);
  // The run's SSP: an approach for every practice, objectives matching the reference.
  let sspPart;
  if (!ssp) { problems.push('no SSP JSON'); sspPart = 'no SSP'; }
  else {
    const cis = ssp.controlImplementations ?? [];
    const byId = new Map(cis.map((c) => [c.control_id, c]));
    const sMissing = [...refByControl.keys()].filter((id) => !byId.has(id));
    const sNoApproach = cis.filter((c) => !c.assessmentApproach).map((c) => c.control_id);
    const sBad = cis.filter((c) => c.assessmentApproach && refByControl.has(c.control_id)
      && !sameSet((c.assessmentApproach.objectives ?? []).map((o) => o.objectiveId), refByControl.get(c.control_id))).map((c) => c.control_id);
    const sNoMethods = cis.filter((c) => (c.assessmentApproach?.objectives ?? []).some((o) => !(o.methods ?? []).length || !(o.evidence ?? []).length)).map((c) => c.control_id);
    if (sMissing.length) problems.push(`SSP lacks ${sMissing.length} practice(s): ${ex(sMissing)}`);
    if (sNoApproach.length) problems.push(`${sNoApproach.length} SSP control(s) have no assessment approach: ${ex(sNoApproach)}`);
    if (sBad.length) problems.push(`SSP approach objectives differ from the reference for ${ex(sBad)}`);
    if (sNoMethods.length) problems.push(`SSP approach objectives without methods or evidence sources in ${ex(sNoMethods)}`);
    const held = cis.flatMap((c) => (c.assessmentApproach?.objectives ?? []).flatMap((o) => (o.evidence ?? []).map((e) => e.held)));
    const count = (s) => held.filter((h) => h === s).length;
    sspPart = `SSP: ${cis.length - sNoApproach.length}/${cis.length} controls carry an approach (evidence sources: ${count('held')} held, ${count('not_held')} not held, ${count('unknown')} not checked)`;
  }
  // PKG-3: the index has a row per met control.
  let indexPart = V90_DEFERRED;
  if (index === null) { problems.push('no evidence-index.json in the EO package'); indexPart = 'index: none'; }
  else if (index !== undefined) {
    const rowControls = new Set((index.objectiveRows ?? []).map((r) => r.controlId));
    const met = (ssp?.controlImplementations ?? []).filter((c) => c.status === 'met').map((c) => c.control_id);
    const noRow = met.filter((id) => !rowControls.has(id));
    if (!Array.isArray(index.objectiveRows)) problems.push('evidence-index.json has no objectiveRows (built before PKG-3)');
    else if (noRow.length) problems.push(`${noRow.length} met control(s) without an index row: ${ex(noRow)}`);
    indexPart = `index: ${met.length - noRow.length}/${met.length} met controls have a row (${(index.objectiveRows ?? []).length} objective rows)`;
  }
  const ok = `KBs: ${pIds.length} practices, ${mIds.length} objectives, all resolve against the 800-171A reference`;
  return { pass: problems.length === 0, detail: `${problems.length ? problems.join('; ') : ok}; ${sspPart}; ${indexPart}` };
}
// ---------- V83 (FLOW-2 / FLOW-2b) ----------
// V83: Stamper's WORM evidence rows (ces.db stamper_evidence_metadata, FLOW-2b row per written file: id
// `<plan>:<task>:<relative path>#<attempt>`, data.relative_path relative to plan-data/<slug>/, data.sha256_hash) against the
// evidence files under plan-data/<slug>/evidence and evidence-by-task. collectV83 reads the rows from a COPY of ces.db (plus
// -wal/-shm) and probes the copy with ces-shared's built CesRepository (default WORM list): put over an existing id, update and
// delete must each be refused with CesWormError and leave the row as it was. The live ces.db is never opened.
export const V83_COLLECTION = 'stamper_evidence_metadata';
export async function collectV83({ dbFile, planDataDir, repoMod, tmpRoot }) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (!dbFile || !fs.existsSync(dbFile)) return { error: `no ${dbFile ?? 'ces.db'} (Stamper never wrote a WORM record)` };
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'v83-'));
  const copy = path.join(dir, 'ces.db');
  for (const sfx of ['', '-wal', '-shm']) if (fs.existsSync(dbFile + sfx)) fs.copyFileSync(dbFile + sfx, copy + sfx);
  const norm = (p) => path.resolve(p).toLowerCase();
  const under = norm(planDataDir) + path.sep;
  const repo = new repoMod.CesRepository(copy);
  try {
    // listAll: the whole collection (rows carry Stamper's config tenant id, not EO's); kept: FLOW-2b file rows
    // (data.relative_path) whose file sits under plan-data/<slug>/.
    const all = repo.listAll(V83_COLLECTION);
    const rows = all.filter((r) => typeof r.data?.relative_path === 'string' && typeof r.data?.storage_location === 'string' && norm(r.data.storage_location).startsWith(under));
    let probe = null;
    {
      const row = rows.at(-1) ?? all.at(-1);
      if (row) {
        const scope = row.tenantId !== null && row.tenantId !== undefined ? { tenantId: row.tenantId } : { tenantSlug: '-' };
        const refused = (fn) => { try { fn(); return false; } catch (e) { return e?.name === 'CesWormError'; } };
        probe = {
          id: row.id,
          put: refused(() => repo.put(V83_COLLECTION, { id: row.id, ces: scope, data: { tampered: 'V83 probe' } })),
          update: refused(() => repo.update(V83_COLLECTION, row.id, scope, { tampered: 'V83 probe' })),
          delete: refused(() => repo.delete(V83_COLLECTION, row.id, scope)),
        };
        probe.intact = JSON.stringify(repo.findById(V83_COLLECTION, row.id)?.data ?? null) === JSON.stringify(row.data);
      }
    }
    return { rows, otherRows: all.length - rows.length, probe };
  } finally {
    repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// collected: collectV83's result; files: [{ relPath, sha256, mtimeMs }] for every file under plan-data/<slug>/evidence and
// evidence-by-task (relPath relative to plan-data/<slug>/, forward slashes); runStartMs: this run's E1 start (NaN: judge all).
// Judged: every file written in this run (mtime >= run start) has a row, and its LATEST row (highest collected_at, then
// attempt; older rows are history) carries the file's sha256; no latest row of this run names a file that is gone; no row was
// changed after it was written (created_at = updated_at); the overwrite probe on the copy was refused three ways, row intact.
export function judgeV83({ collected = null, files = null, runStartMs = NaN, maxExamples = 3 }) {
  if (!collected) return { pass: false, detail: 'V83 not collected' };
  if (collected.error) return { pass: false, detail: collected.error };
  if (!Array.isArray(files)) return { pass: false, detail: 'no Stamper plan-data folder for the scenario' };
  const problems = [];
  const ex = (xs) => `${xs.slice(0, maxExamples).join(', ')}${xs.length > maxExamples ? ` (+${xs.length - maxExamples})` : ''}`;
  const judged = Number.isFinite(runStartMs);
  const thisRun = (ms) => !judged || ms >= runStartMs;
  const latest = new Map();
  for (const r of collected.rows) {
    const cur = latest.get(r.data.relative_path);
    const k = (x) => [x.data.collected_at ?? '', Number(x.data.attempt ?? 0)];
    if (!cur) { latest.set(r.data.relative_path, r); continue; }
    const [a1, n1] = k(r), [a0, n0] = k(cur);
    if (a1 > a0 || (a1 === a0 && n1 > n0)) latest.set(r.data.relative_path, r);
  }
  const runFiles = files.filter((f) => thisRun(f.mtimeMs));
  const noRow = runFiles.filter((f) => !latest.has(f.relPath)).map((f) => f.relPath);
  const badHash = runFiles.filter((f) => latest.has(f.relPath) && latest.get(f.relPath).data.sha256_hash !== f.sha256).map((f) => f.relPath);
  const onDisk = new Set(files.map((f) => f.relPath));
  const gone = [...latest.values()].filter((r) => thisRun(Date.parse(r.createdAt)) && !onDisk.has(r.data.relative_path)).map((r) => r.id);
  const changed = collected.rows.filter((r) => r.createdAt !== r.updatedAt).map((r) => r.id);
  if (!runFiles.length) problems.push(`no evidence file written in this run (${files.length} older file(s))`);
  if (noRow.length) problems.push(`${noRow.length} of ${runFiles.length} evidence file(s) have no ${V83_COLLECTION} row: ${ex(noRow)}`);
  if (badHash.length) problems.push(`${badHash.length} file(s) differ from their latest row's sha256: ${ex(badHash)}`);
  if (gone.length) problems.push(`${gone.length} latest row(s) of this run name a file that is gone: ${ex(gone)}`);
  if (changed.length) problems.push(`${changed.length} row(s) changed after they were written (updated_at != created_at): ${ex(changed)}`);
  const p = collected.probe;
  if (!p) problems.push(`no ${V83_COLLECTION} row to probe`);
  else {
    const allowed = ['put', 'update', 'delete'].filter((k) => !p[k]);
    if (allowed.length) problems.push(`overwrite probe on the ces.db copy NOT refused for ${allowed.join(', ')} (${p.id}; ces-shared dist rebuilt with FLOW-2's WORM list?)`);
    if (!p.intact) problems.push(`probed row ${p.id} changed on the copy`);
  }
  const ok = `${runFiles.length} evidence file(s) of this run each match their latest ${V83_COLLECTION} row (${collected.rows.length} row(s) for the tenant, ${files.length - runFiles.length} older file(s) not judged, ${collected.otherRows} other row(s)); no row changed; overwrite probe on a copy of ces.db refused (put, update, delete)`;
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : ok };
}

// ---------- V80 (NS-1 / NS-1b) ----------
// V80: every control the run credited by document review (stored snapshot statusRationale starting "GD-b", the prefix
// ControlAssessor.decideByReviews writes; reviews are not AssessmentSources, LOG-GC-NS-1.md decision 2) has, for every
// NIST SP 800-171A objective of the control, a countable met review and no countable not_met review. Countable (GD-b,
// GAP-CLOSURE-PLAN.md §7) = the cited sha256 names an EC item of the control, every such item has a known uploader, the
// reviewer is none of them (UPN, case-insensitive), and the reviewer's tokenId is an approver-token mint for that UPN.
// Probe: every EC item of the run that no review cites leaves its controls uncredited by review, and a control not
// decided by a stack tier ("Tier n" / "Scored per objective") or, for a PS / AT control, by EO's personnel or training
// store (NS-3b, D-2: statusRationale starting "Store precedence (<personnel|training> store", ces-eo
// server/ledgerAssembly.ts STORE_RATIONALE_PREFIX) stays not_assessed. A store decision is a deciding source, never a
// review credit. The customer's designated probe (probeDecl = customers/<slug>/document-reviews.json probe: an upload no
// review cites, on a control no stack tier or store decides) must stay not_assessed, so the probe still shows that an
// unreviewed upload credits nothing by itself. Inputs from verify.mjs: the stored
// snapshot, the tenant's eo_document_reviews and eo_approver_token_mints rows (pl/ces.db), the run's EC items
// (pl/EvidenceCollector/storage/<slug>/items/*.json) and the objectives reference (ces-shared dist/data).
export const V80_NO_REVIEWS = 'no reviews recorded; no non-stack control credited by review';
export const V80_STORE_DECIDED = /^Store precedence \((personnel|training) store\b/;
export function judgeV80({ snapshot = null, reviews: reviewsAll = null, reviewsError = null, mints = [], ecItems = null, objectivesRef = null, otherTenantReviews = 0, probeDecl = null, maxExamples = 5 }) {
  if (!snapshot) return { pass: false, detail: 'no stored snapshot (out/eo-package/<latest>/assessments/latest-snapshot.json)' };
  if (reviewsAll === null) return { pass: false, detail: `document reviews not read (${reviewsError ?? 'unknown'})` };
  // FIN-12 (FD-8): only the live rows count (a row another row's `supersedes` names is history); the probe below still
  // treats an upload that any row ever cited as reviewed.
  const reviews = liveReviewRows(reviewsAll);
  const supersededCount = reviewsAll.length - reviews.length;
  if (!objectivesRef) return { pass: false, detail: 'missing ces-shared dist data: assessment-objectives' };
  if (ecItems === null) return { pass: false, detail: 'EC items not read (pl/EvidenceCollector/storage/<slug>/items)' };
  const ex = (xs) => `${xs.slice(0, maxExamples).join(', ')}${xs.length > maxExamples ? ` (+${xs.length - maxExamples})` : ''}`;
  const problems = [];
  const lc = (s) => String(s ?? '').trim().toLowerCase();
  const objectivesOf = new Map();
  for (const o of objectivesRef.objectives ?? []) objectivesOf.set(o.controlId, [...(objectivesOf.get(o.controlId) ?? []), o.objectiveId]);
  const controls = snapshot.controls ?? [];
  const byReview = (c) => /^GD-b/.test(c.statusRationale ?? '');
  const credited = controls.filter((c) => c.status === 'met' && byReview(c));
  const matchingItems = (r) => ecItems.filter((i) => (i.controlIds ?? []).includes(r.controlId) && lc(i.sha256) === lc(r.artifactHash));
  const whyNot = (r) => {
    if (!(objectivesOf.get(r.controlId) ?? []).includes(r.objectiveId)) return 'objective not of the control';
    if (r.verdict !== 'met' && r.verdict !== 'not_met') return `verdict ${r.verdict}`;
    if (!r.reviewer?.upn || !r.artifactHash) return 'no reviewer or hash';
    const m = matchingItems(r);
    if (!m.length) return 'hash names no EC item of the control';
    if (m.some((i) => !i.uploadedBy?.upn)) return 'uploader unknown';
    if (m.some((i) => lc(i.uploadedBy.upn) === lc(r.reviewer.upn))) return 'reviewer is the uploader';
    if (!mints.some((t) => t.mintId === r.reviewer.tokenId && lc(t.approver?.upn) === lc(r.reviewer.upn))) return 'reviewer token is no approver-token mint for that UPN';
    return null;
  };
  const countable = reviews.filter((r) => whyNot(r) === null);

  // Probe: EC items no review cites.
  const cited = new Set(reviewsAll.map((r) => `${r.controlId}@${lc(r.artifactHash)}`));
  const stackTier = (c) => /^(Tier \d|Scored per objective)/.test(c?.statusRationale ?? '');
  const storeDecided = (c) => /^(PS|AT)\./.test(c?.control_id ?? '') && V80_STORE_DECIDED.test(c?.statusRationale ?? '');
  const decider = (c) => (stackTier(c) ? /^Tier \d|^Scored per objective/.exec(c.statusRationale)[0] : storeDecided(c) ? `${V80_STORE_DECIDED.exec(c.statusRationale)[1]} store` : null);
  const probeCtl = [];
  for (const i of ecItems) for (const cid of i.controlIds ?? []) if (!cited.has(`${cid}@${lc(i.sha256)}`)) probeCtl.push(cid);
  const probeBad = [];
  for (const cid of [...new Set(probeCtl)]) {
    const c = controls.find((x) => x.control_id === cid);
    if (!c) { probeBad.push(`${cid} not in the snapshot`); continue; }
    if (byReview(c) && !reviews.some((r) => r.controlId === cid)) probeBad.push(`${cid} credited by review with no review`);
    else if (!stackTier(c) && !storeDecided(c) && !byReview(c) && c.status !== 'not_assessed') probeBad.push(`${cid} ${c.status} without a stack tier, store decision or review`);
  }
  if (!ecItems.length) problems.push('probe: the run has no EC item (E8.5 upload missing)');
  if (probeBad.length) problems.push(`probe: upload with no review not left uncredited: ${ex(probeBad)}`);
  // The designated probe: its upload is cited by no review and nothing else decides its control, so it must stay not_assessed.
  let witness = '';
  if (probeDecl?.control_id) {
    const pc = controls.find((x) => x.control_id === probeDecl.control_id);
    const want = probeDecl.expect ?? 'not_assessed';
    if (!probeCtl.includes(probeDecl.control_id)) problems.push(`probe: the designated probe ${probeDecl.control_id} has no unreviewed upload in the run (${probeDecl.artifact ?? 'artifact'} not uploaded, or reviewed)`);
    else if (!pc) problems.push(`probe: the designated probe ${probeDecl.control_id} is not in the snapshot`);
    else if (byReview(pc) || decider(pc) || pc.status !== want) problems.push(`probe: the designated probe ${probeDecl.control_id} is ${pc.status}${decider(pc) ? ` (${decider(pc)})` : byReview(pc) ? ' (by review)' : ''}, want ${want} with no deciding source`);
    else witness = `; designated probe ${probeDecl.control_id} ${pc.status} (an unreviewed upload credits nothing by itself)`;
  }
  const probeShown = [...new Set(probeCtl)].map((cid) => { const c = controls.find((x) => x.control_id === cid); return `${cid} ${c?.status ?? '?'}${decider(c) ? ` (${decider(c)})` : ''}`; });
  const probeNote = `probe: ${ecItems.length} EC item(s), ${probeShown.length} control(s) with an unreviewed upload, none credited by review${probeShown.length ? ` (${ex(probeShown)})` : ''}${witness}`;

  if (reviews.length === 0) {
    if (credited.length) problems.push(`no reviews recorded but ${credited.length} control(s) credited by review: ${ex(credited.map((c) => c.control_id))}`);
    return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${V80_NO_REVIEWS}; ${probeNote}` };
  }
  const bad = [];
  for (const c of credited) {
    const objs = objectivesOf.get(c.control_id) ?? [];
    if (!objs.length) { bad.push(`${c.control_id}: no reference objectives`); continue; }
    const mine = countable.filter((r) => r.controlId === c.control_id);
    const missing = objs.filter((o) => !mine.some((r) => r.objectiveId === o && r.verdict === 'met'));
    if (missing.length) bad.push(`${c.control_id}: no countable met review for ${missing.join(', ')}`);
    const neg = mine.filter((r) => r.verdict === 'not_met');
    if (neg.length) bad.push(`${c.control_id}: met despite countable not_met review(s) ${neg.map((r) => r.objectiveId).join(', ')}`);
  }
  if (bad.length) problems.push(`${bad.length} credited control(s) fail GD-b: ${ex(bad)}`);
  const uncountable = reviews.filter((r) => whyNot(r) !== null).map((r) => `${r.controlId} ${r.objectiveId}: ${whyNot(r)}`);
  const note = `${reviews.length} review(s)${supersededCount ? ` live (+${supersededCount} superseded, FD-8)` : ''} (${countable.length} countable${uncountable.length ? `; not counted: ${ex(uncountable)}` : ''})${otherTenantReviews ? `, ${otherTenantReviews} under other tenants (not judged)` : ''}; ${credited.length} control(s) credited by review, each with a countable met review per objective from a non-uploader approver-token holder`;
  return { pass: problems.length === 0, detail: problems.length ? `${problems.join('; ')} (${note})` : `${note}; ${probeNote}` };
}

// ---------- V88 (API-3a + FLOW-5) ----------
// (a) E3 compiled through muster-api: steps.E3.mode 'api' and out/plan-compile.json (plan-compile.mjs) HTTP 200, its
//     files = out/plan byte for byte. (b) That plan equals the retired runner's (out/plan-script, the same inputs, run
//     standalone at E3) minus run-variant values: timestamps (ISO and the -<ts> file suffix), UUIDs (the one-time secret
//     reference among them), SHA-256 hex (hashes over timestamped content), 13-digit epochs, generated ids
//     (<prefix>_<8>_<7> and 21-character nanoids) and plan-trace.json's initial_password_ref (by design: 'issued by
//     muster-api' vs 'generated'). JSON compares structurally (a value may differ only where both sides are run-variant),
//     DOCX by its document text, other text whole. (c) No harness-generated initialPassword: no E1-E4 log, steps.json or
//     tester-run.json names STAMPER_INITIAL_PASSWORD, E6-overrides.json lists none as harness_generated, and E6 did not
//     take it from the environment. (d) The pushed Tenant Manifest (provisioning_inputs.initial_password_ref) or, when one
//     is pushed, the Infrastructure Manifest (secret_references[]) holds the reference E3 got, form one_time_operator_held,
//     and neither carries a plain initialPassword. (e) Stamper's E6 log shows that reference resolved from muster-api.
export const V88_RECORD_SCHEMA = 'mx-e2e/plan-compile@1';
export const V88_TRACE_EXCLUDED = ['initial_password_ref'];
const V88_TS_H = /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g;
const V88_TS_I = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
const V88_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const V88_HEX64 = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/g;
const V88_EPOCH = /(?<![0-9])1\d{12}(?![0-9])/g;
const V88_GID = /_[a-z0-9]{8}_[a-z0-9]{7}(?![a-z0-9])/g;
const V88_NANOID = /^[A-Za-z0-9_-]{21}$/;

/** Run-variant tokens -> placeholders. `ids` are literal nanoid-like values seen on that side (replaced first). */
export function v88Normalize(s, ids = []) {
  let x = String(s);
  for (const id of ids) x = x.split(id).join('<id>');
  return x.replace(V88_TS_H, '<ts>').replace(V88_TS_I, '<ts>').replace(V88_UUID, '<uuid>').replace(V88_HEX64, '<sha256>')
    .replace(V88_EPOCH, '<epoch>').replace(V88_GID, '_<gid>');
}

/** Every 21-character nanoid-like string value (mixed case) in a JSON value; longest first. */
export function v88IdLiterals(values) {
  const found = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (V88_NANOID.test(v) && /[A-Z]/.test(v) && /[a-z]/.test(v)) found.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  values.forEach(walk);
  return [...found];
}

/** Structural JSON equality modulo run-variant values; returns the first differing path or null. */
export function v88JsonDiff(a, b, idsA = [], idsB = [], at = '$', skipKeys = []) {
  if (typeof a === 'string' && typeof b === 'string') return a === b || v88Normalize(a, idsA) === v88Normalize(b, idsB) ? null : at;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : at;
  if (Array.isArray(a) !== Array.isArray(b)) return at;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${at} (length ${a.length} vs ${b.length})`;
    for (let i = 0; i < a.length; i++) { const d = v88JsonDiff(a[i], b[i], idsA, idsB, `${at}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a).filter((k) => !skipKeys.includes(k)).sort();
  const kb = Object.keys(b).filter((k) => !skipKeys.includes(k)).sort();
  if (ka.join('\u0000') !== kb.join('\u0000')) return `${at} (keys differ: ${ka.filter((k) => !kb.includes(k)).concat(kb.filter((k) => !ka.includes(k))).slice(0, 5).join(', ')})`;
  for (const k of ka) { const d = v88JsonDiff(a[k], b[k], idsA, idsB, `${at}.${k}`); if (d) return d; }
  return null;
}

/**
 * Compare two plan folders' files. Each side: [{ name, kind: 'json'|'docx'|'text'|'binary', text }] (json: the text;
 * docx: its document text; binary: a sha256). Names compare after normalisation (the -<ts> suffix).
 */
export function v88ComparePlans(api, script, maxExamples = 5) {
  const parse = (f) => { try { return JSON.parse(f.text); } catch { return undefined; } };
  const idsOf = (side) => v88IdLiterals(side.filter((f) => f.kind === 'json').map(parse).filter((v) => v !== undefined))
    .sort((x, y) => y.length - x.length);
  const idsA = idsOf(api);
  const idsB = idsOf(script);
  const key = (f) => v88Normalize(f.name);
  const A = new Map(api.map((f) => [key(f), f]));
  const B = new Map(script.map((f) => [key(f), f]));
  const onlyApi = [...A.keys()].filter((k) => !B.has(k)).sort();
  const onlyScript = [...B.keys()].filter((k) => !A.has(k)).sort();
  const differing = [];
  let compared = 0;
  for (const [k, fa] of [...A.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const fb = B.get(k);
    if (!fb) continue;
    compared++;
    let where = null;
    if (fa.kind !== fb.kind) where = `kind ${fa.kind} vs ${fb.kind}`;
    else if (fa.kind === 'json') {
      const ja = parse(fa), jb = parse(fb);
      if (ja === undefined || jb === undefined) where = 'unparseable JSON';
      else where = v88JsonDiff(ja, jb, idsA, idsB, '$', fa.name.split('/').pop() === 'plan-trace.json' ? V88_TRACE_EXCLUDED : []);
    } else if (fa.kind === 'binary') where = fa.text === fb.text ? null : 'bytes differ';
    else if (v88Normalize(fa.text ?? '', idsA) !== v88Normalize(fb.text ?? '', idsB)) {
      const la = v88Normalize(fa.text ?? '', idsA).split('\n'), lb = v88Normalize(fb.text ?? '', idsB).split('\n');
      const i = la.findIndex((l, j) => l !== lb[j]);
      where = `line ${(i < 0 ? la.length : i) + 1}`;
    }
    if (where) differing.push({ name: k, where });
  }
  return { compared, onlyApi, onlyScript, differing, examples: differing.slice(0, maxExamples) };
}

const V88_REF = /^secretref:one-time:[0-9a-f-]{36}$/;
export function judgeV88({ steps = {}, record = null, recordStale = null, planFileSha = null, compare = null, twinRc = null, logs = {}, overridesLog = null, tm = null, im = null, plan = null, e6Out = null }) {
  const problems = [];
  const notes = [];
  // (a)
  if (steps.E3?.mode !== 'api') problems.push(`(a) E3 did not compile through muster-api (steps.E3.mode ${steps.E3?.mode ?? 'absent'})`);
  if (!record) problems.push('(a) no out/plan-compile.json (scripts/plan-compile.mjs record)');
  else if (recordStale) problems.push(`(a) ${recordStale}`);
  else {
    if (record.schema !== V88_RECORD_SCHEMA) problems.push(`(a) plan-compile.json schema ${record.schema ?? 'none'}`);
    if (record.http_status !== 200) problems.push(`(a) POST /api/plan/compile answered HTTP ${record.http_status ?? 'none'}${record.error ? `: ${String(record.error).slice(0, 160)}` : ''}`);
    const files = record.files ?? [];
    const bad = planFileSha ? files.filter((f) => planFileSha[f.name] !== f.sha256).map((f) => f.name) : [];
    const extra = planFileSha ? Object.keys(planFileSha).filter((n) => !files.some((f) => f.name === n)) : [];
    if (!files.length) problems.push('(a) the compile returned no files');
    if (bad.length) problems.push(`(a) ${bad.length} out/plan files differ from what the route returned (e.g. ${bad[0]})`);
    if (extra.length) problems.push(`(a) ${extra.length} out/plan files the route did not return (e.g. ${extra[0]})`);
  }
  // (b)
  if (!compare) problems.push(`(b) no out/plan-script (the retired runner's twin${twinRc !== null && twinRc !== undefined ? ` exited ${twinRc}` : ' did not run'})`);
  else {
    if (compare.onlyApi.length) problems.push(`(b) ${compare.onlyApi.length} files only from the route: ${compare.onlyApi.slice(0, 3).join(', ')}`);
    if (compare.onlyScript.length) problems.push(`(b) ${compare.onlyScript.length} files only from the script: ${compare.onlyScript.slice(0, 3).join(', ')}`);
    if (compare.differing.length) problems.push(`(b) ${compare.differing.length} of ${compare.compared} files differ beyond run-variant values: ${compare.examples.map((d) => `${d.name} at ${d.where}`).join('; ')}`);
  }
  // (c)
  const named = Object.entries(logs).filter(([, text]) => typeof text === 'string' && text.includes('STAMPER_INITIAL_PASSWORD')).map(([f]) => f);
  if (named.length) problems.push(`(c) a harness-generated initialPassword is named in ${named.join(', ')}`);
  if (!overridesLog) problems.push('(c) no logs/E6-overrides.json');
  else if ((overridesLog.harness_generated ?? []).includes('initialPassword')) problems.push('(c) E6-overrides.json still lists initialPassword as harness-generated');
  if (e6Out && /Secret input initialPassword: supplied from STAMPER_INITIAL_PASSWORD/.test(e6Out)) problems.push('(c) E6 took initialPassword from the harness environment');
  // (d)
  const ref = record?.initial_password_ref ?? null;
  if (!ref || !V88_REF.test(ref)) problems.push(`(d) the compile issued no initial-password reference (${ref ?? 'null'})`);
  const tmBody = tm?.tenant_manifest ?? tm ?? null;
  const tmRef = tmBody?.provisioning_inputs?.initial_password_ref ?? null;
  const imRefs = (im?.infrastructure?.secret_references ?? []).filter((r) => r?.variable === 'initialPassword');
  const carried = [tmRef, ...imRefs].filter(Boolean);
  if (!tm) problems.push('(d) no pushed Tenant Manifest');
  else if (!carried.length) problems.push('(d) neither the pushed TM (provisioning_inputs.initial_password_ref) nor the IM (secret_references) holds an initialPassword reference');
  else {
    const wrong = carried.filter((r) => typeof r !== 'object' || r.form !== 'one_time_operator_held' || r.ref !== ref);
    if (wrong.length) problems.push(`(d) the pushed reference is not E3's one-time reference (${wrong.map((r) => (typeof r === 'object' ? `${r.form}:${r.ref}` : typeof r)).join(', ')})`);
  }
  const literal = [];
  if (tmBody?.tenant_identity && 'initialPassword' in tmBody.tenant_identity) literal.push('TM tenant_identity.initialPassword');
  if (typeof tmRef === 'string') literal.push('TM provisioning_inputs.initial_password_ref (a string)');
  const imVal = im?.infrastructure?.stamper_variable_map?.initialPassword;
  if (imVal !== undefined && imVal !== '') literal.push('IM stamper_variable_map.initialPassword');
  if (literal.length) problems.push(`(d) a plain initialPassword in ${literal.join(', ')}`);
  const planRefs = (plan?.variables?._secret_references ?? []).filter((r) => r?.variable === 'initialPassword').map((r) => r.ref);
  if (plan && ref && !planRefs.includes(ref)) problems.push('(d) the executable plan does not carry E3\'s reference');
  // (e)
  if (!e6Out) problems.push('(e) no logs/E6-execute.out');
  else if (ref && !e6Out.includes(`Secret reference ${ref} for initialPassword: resolved from muster-api`)) {
    const line = e6Out.split(/\r?\n/).find((l) => l.startsWith('Secret reference '));
    problems.push(`(e) Stamper's E6 log does not show the reference resolved${line ? ` (has: ${line.slice(0, 160)})` : ''}`);
  }
  if (compare) notes.push(`${compare.compared} plan files equal the retired runner's minus run-variant values`);
  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `E3 compiled through POST /api/plan/compile (${record.files.length} files, out/plan = the response); ${notes.join('; ')}; no harness-generated initialPassword; the pushed ${tmRef ? 'TM' : 'IM'} holds reference ${ref.slice(0, 28)}…; Stamper's E6 log shows it resolved from muster-api`,
  };
}

/** Reads one plan folder for v88ComparePlans (docxText: scorecard.mjs's); null when the folder is absent. */
export async function v88ReadPlanDir(dir, docxText) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  if (!fs.existsSync(dir)) return null;
  const walk = (rel) => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(r) : e.isFile() ? [r] : [];
  });
  return walk('').map((name) => {
    const p = path.join(dir, name);
    const ext = path.extname(name).toLowerCase();
    if (ext === '.json') return { name, kind: 'json', text: fs.readFileSync(p, 'utf8') };
    if (ext === '.docx') return { name, kind: 'docx', text: docxText(p) ?? '' };
    if (['.md', '.txt', '.html', '.csv'].includes(ext)) return { name, kind: 'text', text: fs.readFileSync(p, 'utf8') };
    return { name, kind: 'binary', text: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') };
  });
}
// ---------- V79 (PKG-3) ----------
// V79: the EO assessor package (the newest zip as extracted under out/eo-package/<dir>/ at E8) is complete:
//  (a) policies/: the policy files equal the pushed policy-set manifest's documents in number. Since FLOW-3 (E7's EO
//      intake) an empty policy store (README.md only) fails under -Harness tester; under -Harness mx (no intake call in
//      mx-e2e.ps1) it stays the non-failing note "policies not yet delivered (FLOW-3)";
//  (b) personnel/ is present (records, training, screening, organisation records, or a README when the stores are empty);
//  (c) stamper-evidence/: exactly the files of EO's Stamper chain (the last C11 collect.stamperEvidence index in the
//      evidence store), same relative paths and the chained sha256;
//  (d) evidence-index.json (built by EO) has objectiveRows, and every file a row cites is in the package with that sha256;
//  (e) the integrity manifest lists every file under policies/, personnel/ (attachments aside), stamper-evidence/ and
//      evidence-index.json with the sha256 of its bytes.
export const V79_POLICIES_PENDING = 'policies not yet delivered (FLOW-3)';
export function judgeV79({ pkgName = null, files = null, integrity = null, index = null, pushedPolicyCount = null, chain = null, harness = 'tester', maxExamples = 5 }) {
  if (!pkgName || !files) return { pass: false, detail: 'no extracted EO package under out/eo-package (E8)' };
  const problems = [];
  const notes = [];
  const ex = (xs) => `${xs.slice(0, maxExamples).join(', ')}${xs.length > maxExamples ? ` (+${xs.length - maxExamples})` : ''}`;
  const names = Object.keys(files);
  const under = (dir) => names.filter((n) => n.startsWith(`${dir}/`));
  // (a)
  const policyFiles = under('policies').filter((n) => n !== 'policies/README.md');
  if (!under('policies').length) problems.push('(a) no policies/ folder');
  else if (!policyFiles.length && harness !== 'tester') notes.push(`(a) ${V79_POLICIES_PENDING}: EO's policy store is empty (policies/README.md); pushed policy envelopes ${pushedPolicyCount ?? 'unknown'} (-Harness ${harness}: no EO intake call)`);
  else if (!policyFiles.length) problems.push(`(a) EO's policy store is empty (policies/README.md only) but the pushed policy-set manifest lists ${pushedPolicyCount ?? 'unknown'}: the E7 intake (FLOW-3) did not deliver them`);
  else if (pushedPolicyCount === null) problems.push(`(a) ${policyFiles.length} policy file(s) but no pushed policy-set manifest to count against`);
  else if (policyFiles.length !== pushedPolicyCount) problems.push(`(a) policies/ holds ${policyFiles.length} policy file(s), the pushed policy-set manifest ${pushedPolicyCount}`);
  else notes.push(`(a) policies/ ${policyFiles.length} = pushed ${pushedPolicyCount}`);
  // (b)
  const personnel = under('personnel');
  if (!personnel.length) problems.push('(b) no personnel/ folder');
  else notes.push(`(b) personnel/ ${personnel.includes('personnel/README.md') ? 'README only (stores empty)' : `${personnel.length} file(s)`}`);
  // (c)
  const stamper = under('stamper-evidence').filter((n) => n !== 'stamper-evidence/chain.json' && n !== 'stamper-evidence/README.md');
  if (!under('stamper-evidence').length) problems.push('(c) no stamper-evidence/ folder');
  if (!chain) problems.push('(c) EO\'s Stamper chain unknown (no evidence store, or no C11 index record)');
  else {
    const want = new Map(chain.map((f) => [`stamper-evidence/${f.relPath}`, f.fileSha256]));
    const extra = stamper.filter((n) => !want.has(n));
    const absent = [...want.keys()].filter((n) => !(n in files));
    const badHash = [...want].filter(([n, s]) => n in files && files[n] !== s).map(([n]) => n);
    if (stamper.length !== want.size) problems.push(`(c) stamper-evidence/ holds ${stamper.length} file(s), EO's Stamper chain ${want.size}`);
    if (extra.length) problems.push(`(c) ${extra.length} stamper-evidence file(s) not in the chain: ${ex(extra)}`);
    if (absent.length) problems.push(`(c) ${absent.length} chained file(s) not in the zip: ${ex(absent)}`);
    if (badHash.length) problems.push(`(c) ${badHash.length} stamper-evidence file(s) differ from the chained sha256: ${ex(badHash)}`);
    if (!extra.length && !absent.length && !badHash.length) notes.push(`(c) stamper-evidence/ ${stamper.length} = EO's Stamper chain ${want.size}, hashes equal`);
  }
  // (d)
  if (!index) problems.push('(d) no evidence-index.json in the package');
  else if (!Array.isArray(index.objectiveRows)) problems.push('(d) evidence-index.json has no objectiveRows (built before GC-PKG-3)');
  else {
    const cites = index.objectiveRows.flatMap((r) => (r.files ?? []).map((f) => ({ row: r.objectiveId, ...f })));
    const unresolved = cites.filter((c) => !(c.file in files)).map((c) => `${c.row} -> ${c.file}`);
    const mismatched = cites.filter((c) => c.file in files && files[c.file] !== c.sha256).map((c) => `${c.row} -> ${c.file}`);
    if (!index.objectiveRows.length) problems.push('(d) evidence-index.json has no objective rows');
    if (unresolved.length) problems.push(`(d) ${unresolved.length} index citation(s) to files not in the zip: ${ex(unresolved)}`);
    if (mismatched.length) problems.push(`(d) ${mismatched.length} index citation(s) with a sha256 other than the file's: ${ex(mismatched)}`);
    notes.push(`(d) evidence-index.json: ${index.objectiveRows.length} objective rows, ${cites.length} citations of ${new Set(cites.map((c) => c.file)).size} files, all resolve${unresolved.length || mismatched.length ? ' (not all)' : ''}`);
  }
  // (e)
  if (!integrity) problems.push('(e) no integrity-manifest.json');
  else {
    const listed = new Map((integrity.files ?? []).map((f) => [f.file, f.sha256]));
    const covered = [...under('policies'), ...personnel.filter((n) => !n.startsWith('personnel/attachments/')), ...under('stamper-evidence'), ...(names.includes('evidence-index.json') ? ['evidence-index.json'] : [])];
    const unlisted = covered.filter((n) => !listed.has(n));
    const wrong = covered.filter((n) => listed.has(n) && listed.get(n) !== files[n]);
    if (unlisted.length) problems.push(`(e) ${unlisted.length} new file(s) not in the integrity manifest: ${ex(unlisted)}`);
    if (wrong.length) problems.push(`(e) ${wrong.length} integrity entr(ies) with a sha256 other than the file's: ${ex(wrong)}`);
    if (!unlisted.length && !wrong.length) notes.push(`(e) integrity manifest covers the ${covered.length} new file(s)`);
  }
  return { pass: problems.length === 0, detail: `${problems.length ? `${problems.join('; ')}; ` : ''}package ${pkgName}: ${notes.join('; ')}` };
}

// ---------- V84 (FLOW-3) ----------
// V84: Muster's push bundle reached EO's intake (POST /api/intake/muster) intact:
//  (a) out/eo-intake.json (ces-tester E7: EO starts at E7, after the E4 push, so the harness posts the pushed bundle) is
//      this run's, delivered (HTTP 201), and its receipt holds every pushed file (out/push-response.json `pushed`) under
//      its file name with sha256 = the plans-folder file's bytes; envelopes also with the file's hash_sha256 and artifact_id;
//  (b) the receipt's policies equal the pushed policy-set manifest's documents (names and sha256), and EO's policy store
//      count after the import equals the pushed count;
//  (c) the SSP's authorizationBoundary.cuiBoundarySource cites the pushed CUI Boundary envelope (artifact_id, hash_sha256)
//      from this intake, and the boundary description names that hash (not applicable when no boundary was pushed).
// planFiles: { <pushed name>: { sha256, hash_sha256?, artifact_id? } } read by verify.mjs from Stamper's plans folder;
// pushedPolicyDocs: the pushed manifest's documents, or null without one. Under -Harness mx (no intake call) a missing
// record is "not run" and passes.
// FIN-35 S-1 (GD-e): si_baseline, tcp and readiness_posture are no longer pushed files (EO's intake only), so a receipt part
// of one of those kinds is not "extra": it must carry the hash_sha256 and artifact_id of the MP's inputs.<kind>_ref instead
// (mpInputs: the pushed MP's inputs).
export const V84_EO_ONLY_KINDS = ['si_baseline', 'tcp', 'readiness_posture'];
export const V84_RECORD_SCHEMA = 'ces-tester/eo-intake@1';
export function judgeV84({ harness = 'tester', record = null, recordFile = 'out/eo-intake.json', stale = null, pushResponse = null, planFiles = {}, pushedPolicyDocs = null, ssp = null, mpInputs = null, maxExamples = 5 }) {
  if (!record) {
    return harness === 'tester'
      ? { pass: false, detail: `no ${recordFile} (E7's EO intake, FLOW-3)` }
      : { pass: true, detail: `not run (-Harness ${harness}: mx-e2e.ps1 makes no EO intake call; ${recordFile} is required under -Harness tester)` };
  }
  if (stale) return { pass: false, detail: stale };
  const ex = (xs) => `${xs.slice(0, maxExamples).join(', ')}${xs.length > maxExamples ? ` (+${xs.length - maxExamples})` : ''}`;
  const problems = [];
  const notes = [];
  if (record.schema !== V84_RECORD_SCHEMA) problems.push(`schema ${record.schema}`);
  if (record.status !== 'delivered' || record.http !== 201) problems.push(`intake ${record.status ?? 'unknown'} (HTTP ${record.http ?? 'none'})${record.error ? `: ${String(record.error).slice(0, 300)}` : ''}`);
  const receipt = record.receipt ?? {};
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  // (a)
  const pushed = pushResponse?.pushed ?? [];
  if (!pushed.length) problems.push('(a) no pushed files in out/push-response.json');
  const byName = new Map(items.filter((i) => i.file_name).map((i) => [i.file_name, i]));
  const absent = [];
  const badSha = [];
  const badEnv = [];
  for (const name of pushed) {
    const it = byName.get(name);
    const f = planFiles[name];
    if (!it) { absent.push(name); continue; }
    if (!f || it.sha256 !== f.sha256) badSha.push(name);
    if (f?.hash_sha256 !== undefined && (it.hash_sha256 !== f.hash_sha256 || it.artifact_id !== f.artifact_id)) badEnv.push(name);
  }
  const eoOnly = items.filter((i) => V84_EO_ONLY_KINDS.includes(i.kind) && !pushed.includes(i.file_name));
  const eoOnlyBad = eoOnly.filter((i) => { const ref = mpInputs?.[`${i.kind}_ref`]; return !ref?.hash_sha256 || i.hash_sha256 !== ref.hash_sha256 || i.artifact_id !== ref.artifact_id; }).map((i) => i.kind);
  if (eoOnlyBad.length) problems.push(`(a) EO-only receipt part(s) whose hash or id differ from the MP reference: ${ex(eoOnlyBad)}`);
  else if (eoOnly.length) notes.push(`(a) EO-only parts ${eoOnly.map((i) => i.kind).join(', ')} match the MP references (GD-e)`);
  const extra = items.filter((i) => !eoOnly.includes(i) && (!i.file_name || !pushed.includes(i.file_name))).map((i) => i.kind);
  if (absent.length) problems.push(`(a) ${absent.length} pushed file(s) not in the intake receipt: ${ex(absent)}`);
  if (badSha.length) problems.push(`(a) ${badSha.length} receipt hash(es) differ from the pushed file: ${ex(badSha)}`);
  if (badEnv.length) problems.push(`(a) ${badEnv.length} envelope hash_sha256 / artifact_id differ from the pushed envelope: ${ex(badEnv)}`);
  if (extra.length) problems.push(`(a) receipt parts with no pushed file: ${ex(extra)}`);
  if (pushed.length && !absent.length && !badSha.length && !badEnv.length && !extra.length) notes.push(`(a) receipt ${receipt.receipt_id}: ${pushed.length} pushed file(s), hashes equal`);
  // (b)
  const pol = receipt.policies ?? {};
  if (pushedPolicyDocs === null) notes.push('(b) no pushed policy-set manifest');
  else {
    const want = new Map(pushedPolicyDocs.map((d) => [d.name, d.sha256]));
    const docs = Array.isArray(pol.documents) ? pol.documents : [];
    const wrong = docs.filter((d) => want.get(d.name) !== d.sha256).map((d) => d.name);
    const missing = [...want.keys()].filter((n) => !docs.some((d) => d.name === n));
    if (missing.length) problems.push(`(b) ${missing.length} pushed policy document(s) not delivered: ${ex(missing)}`);
    if (wrong.length) problems.push(`(b) ${wrong.length} delivered policy document(s) not in the manifest or with another sha256: ${ex(wrong)}`);
    if (pol.store_count !== want.size) problems.push(`(b) EO's policy store holds ${pol.store_count ?? 'unknown'} polic(ies), the pushed policy-set manifest ${want.size}`);
    if (!missing.length && !wrong.length && pol.store_count === want.size) notes.push(`(b) policies ${docs.length} = pushed ${want.size}, store ${pol.store_count}`);
  }
  // (c)
  const cuiName = pushed.find((n) => n.startsWith('cui-boundary-'));
  if (!cuiName) notes.push('(c) no CUI Boundary pushed: not applicable');
  else {
    const want = planFiles[cuiName] ?? {};
    const b = ssp?.authorizationBoundary;
    const src = b?.cuiBoundarySource;
    if (!ssp) problems.push('(c) no SSP JSON');
    else if (!src) problems.push('(c) the SSP boundary section cites no CUI Boundary envelope (TM fallback used)');
    else {
      if (src.hash_sha256 !== want.hash_sha256 || src.artifact_id !== want.artifact_id) problems.push(`(c) the SSP cites ${src.artifact_id} ${String(src.hash_sha256).slice(0, 12)}, the pushed envelope is ${want.artifact_id} ${String(want.hash_sha256).slice(0, 12)}`);
      if (src.intake_receipt_id !== receipt.receipt_id) problems.push(`(c) the SSP cites intake ${src.intake_receipt_id}, this run's receipt is ${receipt.receipt_id}`);
      if (!String(b.description ?? '').includes(String(want.hash_sha256))) problems.push('(c) the boundary description does not name the envelope hash');
      if (!problems.some((p) => p.startsWith('(c)'))) notes.push(`(c) SSP boundary cites ${src.artifact_id} sha256 ${String(src.hash_sha256).slice(0, 12)}… from ${src.intake_receipt_id}`);
    }
  }
  return { pass: problems.length === 0, detail: `${problems.length ? `${problems.join('; ')}; ` : ''}${notes.join('; ')}` };
}

// ---------- V103-V108 (cost gate; COST-GATE-SPEC.md §6.3 V101-V106, renumbered V103-V108 by the batch C1 brief) ----------
// LOG-GC-CG.md §7 is the source of each clause. V101 / V102 are reserved for the secrets checks (SECRETS-PLAN.md: V101 =
// the run's secret scan, out/secret-scan.json, SP-11; V102 = every module answered /api/health over https with the
// run's per-VM certificate, SP-5); they are not authored yet. Every judge here is pure: verify.mjs reads the files.
// A missing artefact that only a pre-cost-gate build lacks says so ("built before the cost gate?"), so a stale build
// reads differently from a real failure.
export const COST_GATED_OFF = 'cost_gated_off';
export const V103_GATED_ENTRY = 'SC.L2-3.13.10.key-vault';
export const V106_FIREWALL_ENTRIES = ['AZ-FW-000', 'AZ-FW-001', 'AZ-FW-002', 'AZ-FW-004', 'AZ-NET-005'];
export const V106_FIREWALL_OP = 'F-12';
export const V108_EXCEPTION = 'SC.L2-3.13.10';
export const PRICE_MAX_AGE_DAYS = 180;
// Notice item counts per scenario. FIN-01 (d): all four compile m365_azure (>= 1 item). S3's interview answers SIT-020
// m365_azure (customers/s3-def/interview-answers.json) and its pushed SI Baseline carries infrastructure_model m365_azure,
// so LOG-GC-CG.md §5's "S3 compiles m365_only (0 items)" was the checker's error, not Muster's (W9-R4a S3: 12 items, an IM).
export const V104_NOTICE_ITEMS = { 's1-mach': 'some', 's2-eng': 'some', 'muster-partial': 'some', 's3-def': 'some' };
// Whether the scenario pushes an Infrastructure Manifest (m365_azure) at all.
export const V107_IM_EXPECTED = { 's1-mach': true, 's2-eng': true, 'muster-partial': true, 's3-def': true };

/** ces-shared canonicalJsonStringify: keys sorted recursively, compact (Muster's items_hash input). */
export function canonicalJson(value) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return JSON.stringify(canon(value));
}
/** Every sub-command id and task id of an executable plan. */
export function planEntryIds(plan) {
  const ids = [];
  for (const t of plan?.execution_graph ?? []) {
    if (t.id) ids.push(String(t.id));
    for (const s of t.action?.args?._sub_commands ?? []) if (s.id) ids.push(String(s.id));
  }
  return ids;
}

// V103 (spec V101): no recurring SET ran in a harness run. plan = out/executable-plan.json; recurringIds = the catalogue's
// recurring registry_entry ids (ces-shared cost-items.reference.json); evidence = this run's Stamper cost-gate records
// (<tenant>/cost-gate-evidence/*.json, each { file, dp, outcome }); aoRows = this run's E7A AO rows ({ op, outcome } with
// outcome = data.evidence.metadata.costGate.outcome, AO-private).
export function judgeV103({ plan = null, recurringIds = null, evidence = [], aoRows = [], maxExamples = 5 }) {
  if (!plan) return { pass: false, detail: 'no out/executable-plan.json' };
  if (!recurringIds) return { pass: false, detail: 'no cost catalogue (ces-shared src/data/cost-items.reference.json; built before the cost gate?)' };
  const cg = plan.variables?._cost_gate;
  if (!cg) return { pass: false, detail: 'the executable plan has no variables._cost_gate (Stamper built before the cost gate, LOG-GC-CG.md?)' };
  const ex = (xs) => `${xs.slice(0, maxExamples).join(', ')}${xs.length > maxExamples ? ` (+${xs.length - maxExamples})` : ''}`;
  const problems = [];
  const gated = cg.gated_off ?? [];
  const kv = gated.find((d) => d.entry_id === V103_GATED_ENTRY);
  if (!kv) problems.push(`${V103_GATED_ENTRY} is not in _cost_gate.gated_off`);
  else if (kv.reason !== COST_GATED_OFF) problems.push(`${V103_GATED_ENTRY} gated off with reason ${kv.reason ?? 'none'}, want ${COST_GATED_OFF}`);
  const notOff = gated.filter((d) => d.reason !== COST_GATED_OFF).map((d) => `${d.entry_id} (${d.reason ?? 'no reason'})`);
  if (notOff.length) problems.push(`gated_off rows without reason ${COST_GATED_OFF}: ${ex(notOff)}`);
  const acked = (cg.acked ?? []).map((d) => d.entry_id);
  if (acked.length) problems.push(`the harness gives no DP-1, yet the plan holds acked recurring entries: ${ex(acked)}`);
  const rec = new Set(recurringIds);
  const ran = [...new Set(planEntryIds(plan).filter((id) => rec.has(id)))];
  if (ran.length) problems.push(`recurring entries in the executable plan: ${ex(ran)}`);
  const dp2 = evidence.filter((e) => Number(e.dp) === 2 && e.outcome === 'accepted').map((e) => e.file);
  if (dp2.length) problems.push(`accepted DP-2 record(s) in this run: ${ex(dp2)}`);
  const enabled = aoRows.filter((r) => r.outcome === 'enabled').map((r) => r.op);
  if (enabled.length) problems.push(`AO enabled a recurring op in E7A: ${ex(enabled)}`);
  const dp1 = evidence.filter((e) => Number(e.dp) === 1).length;
  const ok = `no recurring SET ran: ${gated.length} entr(y/ies) gated off (${ex(gated.map((d) => d.entry_id))}), 0 acked, 0 recurring entries in the plan, ${evidence.length} cost-gate record(s) this run (DP-1 ${dp1}, DP-2 accepted 0), ${aoRows.length} E7A AO row(s) with no recurring op enabled; price date ${cg.price_date ?? '?'}`;
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : ok };
}

// V104 (spec V102): the Muster notice is present and consistent. mp = the pushed Mission Plan (Stamper plans/); record =
// out/plan-compile.json (E3, pkg plan-compile.mjs keeps the 200 body's recurring_cost_notice since PKG-2); e3Mode = steps E3
// mode; sha256Hex = (text) => hex. The MX_SUMMARY and push-line clauses wait for LOG-GC-CG.md open item 8 (reported).
export const V104_DEFERRED = 'not yet checked: MX_SUMMARY recurring_items and the push COST_RECURRING line (LOG-GC-CG.md §6 item 8)';
export function judgeV104({ slug = '', mp = null, record = null, recordStale = null, e3Mode = null, sha256Hex = null }) {
  if (!mp) return { pass: false, detail: `no pushed Mission Plan; ${V104_DEFERRED}` };
  const n = mp.recurring_cost_notice;
  if (!n) return { pass: false, detail: `the Mission Plan has no recurring_cost_notice (Muster built before CG-8?); ${V104_DEFERRED}` };
  if (typeof sha256Hex !== 'function') return { pass: false, detail: 'no hash function' };
  const problems = [];
  const items = Array.isArray(n.items) ? n.items : null;
  if (!items) problems.push('recurring_cost_notice.items is not an array');
  const want = sha256Hex(canonicalJson(items ?? []));
  if (n.items_hash !== want) problems.push(`items_hash ${String(n.items_hash).slice(0, 12)}... is not the canonical SHA-256 of items (${want.slice(0, 12)}...)`);
  const pin = V104_NOTICE_ITEMS[slug];
  const count = items?.length ?? 0;
  if (pin === 0 && count !== 0) problems.push(`${slug} compiles m365_only, so the notice must list 0 items; it lists ${count}`);
  if (pin === 'some' && count < 1) problems.push(`${slug} compiles m365_azure, so the notice must list at least 1 item; it lists 0`);
  let body;
  if (e3Mode !== 'api') body = `compile body: not run (E3 mode ${e3Mode ?? 'unknown'}, not api)`;
  else if (recordStale) problems.push(`compile body: ${recordStale}`);
  else if (!record) problems.push('compile body: no out/plan-compile.json');
  else if (!Object.prototype.hasOwnProperty.call(record, 'recurring_cost_notice')) problems.push('compile body: out/plan-compile.json records no recurring_cost_notice (pkg plan-compile.mjs before PKG-2?)');
  else if (record.recurring_cost_notice === null) problems.push('compile body: the 200 body carried no recurring_cost_notice (muster-api built before CG-8?)');
  else if (canonicalJson(record.recurring_cost_notice) !== canonicalJson(n)) problems.push('compile body: the 200 body\'s recurring_cost_notice differs from the Mission Plan\'s');
  else body = 'compile 200 body\'s notice equals the Mission Plan\'s';
  const ok = `Mission Plan notice: ${count} item(s) (${pin === undefined ? 'count not pinned' : pin === 0 ? 'want 0' : 'want >= 1'}), about $${n.total_estimate_low ?? '?'}-$${n.total_estimate_high ?? '?'} a month (price date ${n.price_date ?? '?'}), ${(n.licence_dependencies ?? []).length} licence dependenc(y/ies), items_hash ok; ${body}`;
  return { pass: problems.length === 0, detail: `${problems.length ? problems.join('; ') : ok}; ${V104_DEFERRED}` };
}

// V105 (spec V103): the cost data is sound. registries = [{ source: 'ces-stamper:<file>', entries }] (the raw Stamper
// registries, src/registry); catalogue = cost-items.reference.json; estimates = cost-estimates.reference.json;
// costlyPatternsIn = the built Stamper CostGate.js export (null when not built); nowMs = the run's clock. The CG-lint items
// restated here: (1) a SET matching a costly pattern carries cost_gate; (2) free needs a free_reason from the closed list;
// (3) recurring needs a cost_key in the price file and a standard_alternative of existing ids or "none: <reason>";
// (4) last_resort names an existing alternative; licence cost_keys exist; (6) no catalogue drift for registry_entry rows.
// The Jest suite itself (ces-stamper tests/registry/CostGateLint.test.ts) is reported, not judged here.
export const V105_FREE_REASONS = ['no_meter', 'free_source', 'in_licence', 'cost_reducing', 'read_only'];
export function judgeV105({ registries = null, catalogue = null, estimates = null, costlyPatternsIn = null, nowMs = Date.now(), maxExamples = 5 }) {
  if (!registries) return { pass: false, detail: 'Stamper registries not read' };
  if (!catalogue) return { pass: false, detail: 'no cost catalogue (ces-shared src/data/cost-items.reference.json; built before the cost gate?)' };
  if (!estimates) return { pass: false, detail: 'no price file (ces-shared src/data/cost-estimates.reference.json; built before the cost gate?)' };
  const ex = (xs) => `${xs.slice(0, maxExamples).join('; ')}${xs.length > maxExamples ? ` (+${xs.length - maxExamples})` : ''}`;
  const problems = [];
  const prices = estimates.prices ?? {};
  const all = registries.flatMap((r) => r.entries ?? []);
  const ids = new Set(all.map((e) => e.entry_id));
  const lint = [];
  for (const e of all) {
    const g = e.cost_gate;
    if (typeof costlyPatternsIn === 'function') {
      const costly = costlyPatternsIn(e.set_command);
      if (costly.length && !g) lint.push(`${e.entry_id}: SET matches ${costly.join(', ')} but has no cost_gate`);
    }
    if (!g) continue;
    if (!g.recurring) {
      if (!V105_FREE_REASONS.includes(g.free_reason)) lint.push(`${e.entry_id}: free without a free_reason from the closed list`);
    } else {
      if (!g.cost_key || !prices[g.cost_key]) lint.push(`${e.entry_id}: recurring with cost_key ${g.cost_key ?? 'none'} not in the price file`);
      if (!(g.standard_alternative ?? []).length) lint.push(`${e.entry_id}: recurring without a standard_alternative`);
      for (const alt of g.standard_alternative ?? []) if (!String(alt).startsWith('none: ') && !ids.has(alt)) lint.push(`${e.entry_id}: standard_alternative ${alt} is not a registry entry`);
    }
    if (g.last_resort && !(g.standard_alternative ?? []).some((a) => !String(a).startsWith('none') && ids.has(a))) lint.push(`${e.entry_id}: last_resort without an existing standard alternative`);
    if (g.licence_dependency && !prices[g.licence_dependency.cost_key]) lint.push(`${e.entry_id}: licence cost_key ${g.licence_dependency.cost_key} not in the price file`);
  }
  if (typeof costlyPatternsIn !== 'function') problems.push('CG-lint item 1 not judged: the costly-cmdlet list (ces-stamper dist/core/CostGate.js) is not built');
  if (lint.length) problems.push(`${lint.length} CG-lint problem(s): ${ex(lint)}`);
  // (6) drift: the rows the generator (ces-stamper CostGate.buildStamperCostItems) builds from the registries.
  const want = new Map();
  for (const r of registries) for (const e of r.entries ?? []) if (e.cost_gate) want.set(e.entry_id, { item_id: e.entry_id, kind: 'registry_entry', source: r.source, label: e.label, control_ids: [...(e.control_ids ?? [])], ...(e.retired ? { retired: true } : {}), cost_gate: e.cost_gate });
  const have = new Map((catalogue.items ?? []).filter((i) => i.kind === 'registry_entry').map((i) => [i.item_id, i]));
  const drift = [];
  for (const [id, w] of want) { const h = have.get(id); if (!h) drift.push(`${id} missing from the catalogue`); else if (canonicalJson(h) !== canonicalJson(w)) drift.push(`${id} differs from its registry entry`); }
  for (const id of have.keys()) if (!want.has(id)) drift.push(`${id} in the catalogue but no registry entry has a cost_gate for it`);
  if (drift.length) problems.push(`catalogue drift (${drift.length}): ${ex(drift)}`);
  const pd = Date.parse(`${estimates.price_date}T00:00:00Z`);
  const age = Number.isFinite(pd) ? Math.floor((nowMs - pd) / 86400000) : NaN;
  if (!Number.isFinite(age)) problems.push(`price_date ${estimates.price_date ?? 'none'} is not a date`);
  else if (age > PRICE_MAX_AGE_DAYS) problems.push(`price_date ${estimates.price_date} is ${age} days old (limit ${PRICE_MAX_AGE_DAYS})`);
  const recurring = [...want.values()].filter((w) => w.cost_gate.recurring).length;
  const aoRows = (catalogue.items ?? []).filter((i) => i.kind === 'ao_op').length;
  const ok = `CG-lint items 1-4 and 6 clean over ${all.length} entries; ${want.size} registry_entry catalogue rows match the registries (${recurring} recurring); price_date ${estimates.price_date} (${age} days old, limit ${PRICE_MAX_AGE_DAYS}); ${aoRows} ao_op row(s) reported, not judged; the CG-lint Jest suite is reported by the unit gate, not judged here`;
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : ok };
}

// V106 (spec V104): the firewall is a last resort. plan = out/executable-plan.json; aoRegistry = ces-ao's
// ao-commands.registry.json (read now); e7a = out/adminops-e7a.json (null under mx). F-12 must stay Tier 3, recurring and
// last_resort with a standard alternative; under the founder ruling (no two-person authorization for now) a Tier 3 op runs
// on one operator's DP-1 + DP-2, so the "Tier 3 approval" clause is the registry tier only.
export function judgeV106({ plan = null, aoRegistry = null, e7a = null }) {
  if (!plan) return { pass: false, detail: 'no out/executable-plan.json' };
  if (!aoRegistry) return { pass: false, detail: 'ces-ao registry not read' };
  const problems = [];
  const fw = [...new Set(planEntryIds(plan).filter((id) => V106_FIREWALL_ENTRIES.includes(id)))];
  if (fw.length) problems.push(`firewall entries in the executable plan: ${fw.join(', ')}`);
  const f12 = (Array.isArray(aoRegistry) ? aoRegistry : aoRegistry.commands ?? []).find((c) => c.id === V106_FIREWALL_OP);
  if (!f12) problems.push(`${V106_FIREWALL_OP} not in the AO registry`);
  else {
    const g = f12.cost_gate ?? {};
    if (!/^Tier 3$/.test(String(f12.sodTier ?? ''))) problems.push(`${V106_FIREWALL_OP} sodTier ${f12.sodTier ?? 'none'}, want Tier 3`);
    if (!g.recurring || !g.last_resort) problems.push(`${V106_FIREWALL_OP} cost_gate is not recurring + last_resort (AO built before CG-5?)`);
    if (!(g.standard_alternative ?? []).length) problems.push(`${V106_FIREWALL_OP} names no standard alternative`);
  }
  const ran = (e7a?.ops ?? []).filter((o) => o.op === V106_FIREWALL_OP);
  if (ran.length) problems.push(`E7A ran ${V106_FIREWALL_OP}`);
  const ok = `no firewall entry (${V106_FIREWALL_ENTRIES.join(', ')}) in the executable plan; ${V106_FIREWALL_OP} is Tier 3, recurring and last_resort (alternatives ${(f12?.cost_gate?.standard_alternative ?? []).join(', ')}); ${e7a ? `E7A ran no ${V106_FIREWALL_OP}` : 'no E7A record (-Harness mx)'}`;
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : ok };
}

// V107 (spec V105): Muster's defaults are off. im = the pushed Infrastructure Manifest of this run (null when none);
// imStale = staleOf(it). An m365_azure manifest has every Defender plan Free, a Standard vault, RSA keys, Log Analytics
// retention_days 90, no AzureFirewallSubnet, no private_endpoint and no private_dns_zone. The unanswered-SIT-020 clause is
// Muster's unit test (CG-lint item 7), reported, not judged.
export function judgeV107({ slug = '', im = null, imStale = null }) {
  const want = V107_IM_EXPECTED[slug];
  const unitNote = 'unanswered SIT-020 -> m365_only: Muster unit test (CG-lint item 7), reported, not judged';
  if (imStale) return { pass: false, detail: `${imStale}; ${unitNote}` };
  if (!im) return want === true ? { pass: false, detail: `${slug} compiles m365_azure but this run pushed no Infrastructure Manifest; ${unitNote}` } : { pass: true, detail: `no Infrastructure Manifest pushed (m365_only plan)${want === undefined ? '; IM expectation not pinned for this scenario' : ''}; ${unitNote}` };
  if (want === false) return { pass: false, detail: `${slug} compiles m365_only but this run pushed an Infrastructure Manifest; ${unitNote}` };
  const inf = im.infrastructure ?? im.artifact?.infrastructure ?? null;
  if (!inf) return { pass: false, detail: `the Infrastructure Manifest has no infrastructure section; ${unitNote}` };
  const res = Object.entries(inf).filter(([k, v]) => k !== 'provenance' && Array.isArray(v)).flatMap(([, v]) => v).filter((r) => r && typeof r === 'object' && r.resource_type);
  const of = (t) => res.filter((r) => r.resource_type === t);
  const problems = [];
  const paid = of('defender_for_cloud').flatMap((r) => (r.properties?.plans ?? []).filter((p) => p.tier !== 'Free').map((p) => `${p.name} ${p.tier}`));
  if (paid.length) problems.push(`Defender plans not Free: ${paid.join(', ')}`);
  const vaults = of('key_vault').filter((r) => r.properties?.sku !== 'Standard').map((r) => `${r.name} ${r.properties?.sku}`);
  if (vaults.length) problems.push(`vault not Standard: ${vaults.join(', ')}`);
  const keys = of('key_vault_key').filter((r) => r.properties?.key_type !== 'RSA').map((r) => `${r.name} ${r.properties?.key_type}`);
  if (keys.length) problems.push(`key not RSA (software): ${keys.join(', ')}`);
  const law = of('log_analytics_workspace');
  const lawBad = law.filter((r) => r.properties?.retention_days !== 90).map((r) => `${r.name} ${r.properties?.retention_days}`);
  if (lawBad.length) problems.push(`Log Analytics retention not 90 days: ${lawBad.join(', ')}`);
  if (of('subnet').some((r) => r.name === 'AzureFirewallSubnet')) problems.push('AzureFirewallSubnet present');
  if (of('private_endpoint').length) problems.push(`${of('private_endpoint').length} private_endpoint(s)`);
  if (of('private_dns_zone').length) problems.push(`${of('private_dns_zone').length} private_dns_zone(s)`);
  const ok = `m365_azure manifest defaults off: ${of('defender_for_cloud').flatMap((r) => r.properties?.plans ?? []).length} Defender plan(s) Free, ${of('key_vault').length} Standard vault(s), ${of('key_vault_key').length} RSA key(s), ${law.length} workspace(s) at 90 days, no AzureFirewallSubnet, private endpoint or private DNS zone`;
  return { pass: problems.length === 0, detail: `${problems.length ? problems.join('; ') : ok}; ${unitNote}` };
}

// V108 (spec V106): the gate is score-neutral. statusBy / baselineBy = per-control SSP status of this run / the baseline
// (summary.json status_by_control); weightOf(id) = the SPRS weight (ces-shared sprs-weights.json). SPRS = 110 minus the
// weights of every control not met. Every status equals the baseline except SC.L2-3.13.10 (LOG-GC-CG.md §1.2): equal =
// Branch B (a stacksim BitLocker-escrow resolver), met -> not_met = Branch A (no resolver; -weight, 1). evFiles = this
// run's Stamper evidence file names (lower case): sc.l2-3.13.10.key-escrow.json present, sc.l2-3.13.10.key-vault.json absent.
// FIN-01 (b): storeDecided = the controls EO's personnel or training records store decided in this run (stored snapshot
// statusRationale matching V80_STORE_DECIDED, NS-3b). Their moves are the store's, not the cost gate's: they are listed,
// not counted as moves, and the SPRS the gate must reproduce is the baseline's with those controls at their current status.
export const V108_ESCROW_FILE = 'sc.l2-3.13.10.key-escrow.json';
export const V108_VAULT_FILE = 'sc.l2-3.13.10.key-vault.json';
export function judgeV108({ statusBy = null, baselineBy = null, baselineName = 'the baseline', weightOf = null, evFiles = null, storeDecided = null, maxExamples = 8 }) {
  if (!statusBy) return { pass: false, detail: 'no out/ssp.json statuses' };
  if (!baselineBy) return { pass: false, detail: `${baselineName} has no status_by_control` };
  if (typeof weightOf !== 'function') return { pass: false, detail: 'no SPRS weights (ces-shared dist/data/sprs-weights.json)' };
  const sprs = (by) => 110 - Object.entries(by).filter(([, s]) => s !== 'met').reduce((t, [id]) => t + (Number(weightOf(id)) || 0), 0);
  const problems = [];
  const store = new Set(storeDecided ?? []);
  const changed = Object.keys({ ...baselineBy, ...statusBy }).filter((id) => id !== V108_EXCEPTION && statusBy[id] !== baselineBy[id]);
  const storeMoved = changed.filter((id) => store.has(id));
  const moved = changed.filter((id) => !store.has(id));
  if (moved.length) problems.push(`${moved.length} control(s) moved from ${baselineName} (not the cost gate's exception): ${moved.slice(0, maxExamples).map((id) => `${id} ${baselineBy[id] ?? 'absent'} -> ${statusBy[id] ?? 'absent'}`).join(', ')}${moved.length > maxExamples ? ` (+${moved.length - maxExamples})` : ''}`);
  const was = baselineBy[V108_EXCEPTION];
  const now = statusBy[V108_EXCEPTION];
  let branch;
  if (now === was) branch = `Branch B: ${V108_EXCEPTION} ${now} as in ${baselineName}`;
  else if (was === 'met' && now === 'not_met') branch = `Branch A: ${V108_EXCEPTION} met -> not_met (no BitLocker-escrow resolver in stacksim; -${weightOf(V108_EXCEPTION)})`;
  else problems.push(`${V108_EXCEPTION} ${was ?? 'absent'} -> ${now ?? 'absent'} is neither Branch A (met -> not_met) nor Branch B (unchanged)`);
  const sNow = sprs(statusBy);
  const sWas = sprs(baselineBy);
  const storeBase = { ...baselineBy, ...Object.fromEntries(storeMoved.map((id) => [id, statusBy[id]])) };
  const want = sprs(storeBase) - (now === was ? 0 : Number(weightOf(V108_EXCEPTION)) || 0);
  const storeNote = storeMoved.length ? `; ${storeMoved.length} store-decided move(s) excluded (NS-3b): ${storeMoved.map((id) => `${id} ${baselineBy[id] ?? 'absent'} -> ${statusBy[id] ?? 'absent'}`).join(', ')}; SPRS the gate must reproduce ${want}` : '';
  if (!moved.length && branch && sNow !== want) problems.push(`SPRS ${sNow}, want ${want}`);
  if (!evFiles) problems.push('Stamper evidence of this run not read');
  else {
    if (!evFiles.includes(V108_ESCROW_FILE)) problems.push(`no ${V108_ESCROW_FILE} in this run's Stamper evidence (Stamper built before the Key Vault drop?)`);
    if (evFiles.includes(V108_VAULT_FILE)) problems.push(`${V108_VAULT_FILE} written in this run (the vault step ran)`);
  }
  const ok = `every other status equals ${baselineName}; ${branch}; SPRS ${sNow} (${baselineName} ${sWas})${storeNote}; ${V108_ESCROW_FILE} written, no ${V108_VAULT_FILE}`;
  return { pass: problems.length === 0, detail: problems.length ? `${problems.join('; ')} (SPRS ${sNow}, ${baselineName} ${sWas})${storeNote}` : ok };
}

// ---------- FIN-01 (FINISH-PLAN.md §3.1): V36 projection sentences, V109 ----------
// V36 (c): the DOCX sentences that carry the POA&M projection next to SPRS / a score. A sentence counts when it names SPRS
// or a score as a word (a Microsoft "Secure Score" / secureScores read is not one) and carries the projection as a number
// that is not a deduction ("110 - 42", W9-R3), not hyphenated ("90-day") and not a count ("returned 90 objects",
// "90 dated score(s)"), the W9-R4a S2 false positives. Returns { sentences, labelled, unlabelled } (labelled = says "project").
export const V36_NOT_A_SCORE = /^\s*(?:-|(?:dated\s+)?(?:objects?|records?|items?|days?|score\(s\)|scores\b|recommendations?|users?|accounts?|policies|policy|minutes?|hours?|percent\b|%))/i;
export function projectionSentences(text, projection) {
  const num = new RegExp(`(?<![\\d.-])(?<!-\\s)${String(projection).replace('-', '\\-')}(?![\\d.])`, 'g');
  const namesScore = (x) => /\bSPRS\b|\bscores?\b/i.test(x.replace(/\bsecure\s*scores?\w*/gi, ' '));
  const carries = (x) => [...x.matchAll(num)].some((m) => !V36_NOT_A_SCORE.test(x.slice(m.index + m[0].length)));
  const sentences = String(text ?? '').split(/(?<=[.!?])\s+|\n/).filter((x) => namesScore(x) && carries(x));
  const unlabelled = sentences.filter((x) => !/project/i.test(x));
  return { sentences, labelled: sentences.length - unlabelled.length, unlabelled };
}

// V109 (e): the unit gate is fresh. gateMs = out/unit-gate.json's write time (the file carries no timestamp); repos =
// [{ repo, commitMs }], the newest commit of each workspace repo (git log -1 %ct; commitMs null = not read, which fails:
// freshness cannot be shown). V11, V21 and V22 read the gate and fail with V109's detail when it is stale.
export function judgeV109({ gateMs = null, repos = null }) {
  if (!Number.isFinite(gateMs)) return { pass: false, detail: 'no out/unit-gate.json (run scripts/run-tests.ps1 before the round)' };
  if (!Array.isArray(repos) || !repos.length) return { pass: false, detail: 'no workspace repo found' };
  const iso = (ms) => new Date(ms).toISOString();
  const unread = repos.filter((r) => !Number.isFinite(r.commitMs)).map((r) => r.repo);
  const newer = repos.filter((r) => Number.isFinite(r.commitMs) && r.commitMs > gateMs);
  const problems = [];
  if (newer.length) problems.push(`out/unit-gate.json (${iso(gateMs)}) is older than the newest commit in ${newer.map((r) => `${r.repo} (${iso(r.commitMs)})`).join(', ')}: re-run scripts/run-tests.ps1`);
  if (unread.length) problems.push(`newest commit not read in ${unread.join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `out/unit-gate.json (${iso(gateMs)}) is newer than the newest commit in all ${repos.length} repos (${repos.map((r) => r.repo).join(', ')})` };
}

// ---------- FIN-19 (finishing plan PH-1 harness; FINISH-PLAN.md §1.3 V110-V114, §3.2 row FIN-19) ----------
// Each judge fails soft: a missing record is a failed check that names the file and the step, never a throw.

/** The 28 non-stack controls (functional-audit AUDIT-NONSTACK.md §1, "Result: 28 controls with 73 objectives"). */
export const FIN19_NON_STACK = Object.freeze([
  'AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3', 'AU.L2-3.3.8', 'AU.L2-3.3.9', 'IR.L2-3.6.2', 'IR.L2-3.6.3',
  'MA.L2-3.7.1', 'MA.L2-3.7.2', 'MA.L2-3.7.3', 'MA.L2-3.7.6', 'MP.L1-3.8.3', 'MP.L2-3.8.4', 'MP.L2-3.8.9',
  'PE.L1-3.10.1', 'PE.L2-3.10.2', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5', 'PE.L2-3.10.6',
  'PS.L2-3.9.1', 'PS.L2-3.9.2', 'RA.L2-3.11.1', 'CA.L2-3.12.1', 'CA.L2-3.12.2', 'CA.L2-3.12.3', 'CA.L2-3.12.4', 'CM.L2-3.4.4',
]);
const fin19ex = (xs, n = 5) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` (+${xs.length - n})` : ''}`;
const fin19lc = (s) => String(s ?? '').trim().toLowerCase();
const fin19ctl = (objectiveId) => String(objectiveId ?? '').split('[')[0];
const SEP = '; ';
const finish = (problems, notes, okText) => ({
  pass: problems.length === 0,
  detail: problems.length ? `${problems.join(SEP)}${notes.length ? ` (${notes.join(SEP)})` : ''}` : (okText ?? notes.join(SEP)),
});

/**
 * FIN-12 (FD-8): the live review rows. A row whose reviewId another row's `supersedes` names is history and never
 * counts (EO's review-router liveReviews: a row naming itself is ignored). Rows from before FIN-12 have no
 * `supersedes` and stay live until a later review of the same objective supersedes them.
 */
export function liveReviewRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const superseded = new Set();
  for (const r of list) for (const id of Array.isArray(r?.supersedes) ? r.supersedes : []) if (id !== r?.reviewId) superseded.add(id);
  return list.filter((r) => !superseded.has(r?.reviewId));
}

// ---------- V76 (AO-1 / FIN-14) ----------
// V76: every AO evidence row names at least one existing objective id of its command's controls. (a) The AO registry:
// every command's evidence_objectives exist in the 800-171A reference and belong to its cmmcPractices. (b) This run's
// E7A rows (ces.db adminops_evidence, data.evidenceObjectives): each names >= 1 such objective. (c) EO's assessor package
// (FIN-14): each adminops/*.json row file carries evidenceObjectives, each valid for its controlIds.
export function judgeV76({ aoRegistry = null, objectivesRef = null, e7aRows = [], pkgRows = null, maxExamples = 5 }) {
  if (!objectivesRef) return { pass: false, detail: 'missing ces-shared dist data: assessment-objectives' };
  if (!Array.isArray(aoRegistry)) return { pass: false, detail: 'no ces-ao registry (src/registry/ao-commands.registry.json)' };
  const known = new Set((objectivesRef.objectives ?? []).map((o) => o.objectiveId));
  const cmd = new Map(aoRegistry.map((c) => [c.id, c]));
  const problems = [];
  const badReg = [];
  // A command with no evidence_objectives yet (the 12 MM re-aims, FIN-14b in PH-2 after FD-3) is reported, not judged.
  const unmapped = [];
  for (const c of aoRegistry) {
    const objs = c.evidence_objectives ?? [];
    const practices = new Set(c.cmmcPractices ?? []);
    if (!objs.length) unmapped.push(c.id);
    for (const o of objs) {
      if (!known.has(o)) badReg.push(`${c.id}: ${o} unknown`);
      else if (!practices.has(fin19ctl(o))) badReg.push(`${c.id}: ${o} not of ${[...practices].join('/') || 'its practices'}`);
    }
  }
  if (badReg.length) problems.push(`(a) ${badReg.length} registry objective problem(s): ${fin19ex(badReg, maxExamples)}`);
  const badRows = [];
  const skippedRows = [];
  for (const { op, rowId, row } of e7aRows) {
    if (!row) { badRows.push(`${op} ${rowId}: row not in ces.db`); continue; }
    if (unmapped.includes(op)) { skippedRows.push(op); continue; }
    const objs = row.evidenceObjectives ?? [];
    const practices = new Set(cmd.get(op)?.cmmcPractices ?? row.metadata?.controlIds ?? []);
    const good = objs.filter((o) => known.has(o) && practices.has(fin19ctl(o)));
    if (!good.length) badRows.push(`${op} ${rowId}: ${objs.length ? `no valid objective of ${[...practices].join('/')} in ${objs.join(', ')}` : 'no evidenceObjectives'}`);
  }
  if (badRows.length) problems.push(`(b) ${badRows.length} of ${e7aRows.length} E7A row(s): ${fin19ex(badRows, maxExamples)}`);
  let pkgNote;
  if (pkgRows === null) { pkgNote = '(c) no EO package (out/eo-package/<latest>/)'; if (e7aRows.length) problems.push(pkgNote); }
  else if (!pkgRows.length) { pkgNote = '(c) the package has no adminops/ rows'; if (e7aRows.length) problems.push(`${pkgNote} although E7A wrote ${e7aRows.length} row(s)`); }
  else {
    const badPkg = pkgRows.filter((r) => !unmapped.includes(r.commandId ?? String(r.file).replace(/^adminops\//, '').split('-').slice(0, 2).join('-'))).filter((r) => {
      const objs = r.evidenceObjectives ?? [];
      const ctl = new Set(r.controlIds ?? []);
      return !objs.length || objs.some((o) => !known.has(o) || (ctl.size && !ctl.has(fin19ctl(o))));
    }).map((r) => `${r.file}${(r.evidenceObjectives ?? []).length ? '' : ' (no evidenceObjectives: FIN-14)'}`);
    if (badPkg.length) problems.push(`(c) ${badPkg.length} of ${pkgRows.length} package adminops row(s): ${fin19ex(badPkg, maxExamples)}`);
    pkgNote = `(c) ${pkgRows.length} package adminops row(s) carry valid evidenceObjectives`;
  }
  const unmappedNote = unmapped.length ? `; not judged: ${unmapped.length} command(s) with no evidence_objectives yet (MM re-aims, FIN-14b): ${fin19ex(unmapped, maxExamples)}${skippedRows.length ? ` (${skippedRows.length} E7A row(s) of them)` : ''}` : '';
  const ok = `(a) ${aoRegistry.length - unmapped.length} mapped registry command(s), objectives valid; (b) ${e7aRows.length - skippedRows.length} E7A row(s) each name a valid objective${e7aRows.length ? '' : ' (no E7A ops in this scenario)'}; ${pkgNote}${unmappedNote}`;
  return finish(problems, unmappedNote ? [unmappedNote.slice(2)] : [], ok);
}

// ---------- V78 (PKG-1): the snapshotId, age and DOCX clauses ----------
// cover: out/eo-package/<latest>/cover-sheet.json; ssp / poam: out/ssp.json, out/poam.json (E8); e7bId: steps.E7B
// .assessment_id; pkgFiles: the package's relative file names; maxAgeHours: EO_PACKAGE_MAX_AGE_HOURS (default 24).
export function judgeV78Clauses({ cover = null, ssp = null, poam = null, e7bId = null, pkgFiles = null, maxAgeHours = 24 }) {
  if (!cover) return { pass: false, detail: 'no out/eo-package/<latest>/cover-sheet.json (E8 package)' };
  const problems = [];
  const ids = { cover: cover.snapshotId, ssp: ssp?.snapshotId, poam: poam?.snapshotId, E7B: e7bId };
  const distinct = [...new Set(Object.values(ids).map((v) => v ?? 'none'))];
  if (distinct.length !== 1 || distinct[0] === 'none') problems.push(`snapshotId differs: ${Object.entries(ids).map(([k, v]) => `${k} ${v ?? 'none'}`).join(', ')}`);
  const built = Date.parse(cover.generatedAt ?? '');
  const limit = Number.isFinite(Number(maxAgeHours)) && Number(maxAgeHours) > 0 ? Number(maxAgeHours) : 24;
  for (const [k, d] of [['SSP', ssp], ['POA&M', poam]]) {
    const at = Date.parse(d?.generatedAt ?? '');
    if (!Number.isFinite(at)) problems.push(`the ${k} has no generatedAt`);
    else if (Number.isFinite(built) && built - at > limit * 3600000) problems.push(`the ${k} (${d.generatedAt}) is older than ${limit} h at build (${cover.generatedAt})`);
  }
  if (!Number.isFinite(built)) problems.push('the cover sheet has no generatedAt');
  const files = new Set(pkgFiles ?? []);
  const absent = ['ssp/system-security-plan.docx', 'poam/plan-of-action.docx'].filter((f) => !files.has(f));
  if (absent.length) problems.push(`DOCX missing from the package: ${absent.join(', ')}`);
  if (cover.allowPartial === true || (cover.partialFailures ?? []).length) problems.push(`the package is partial (${(cover.partialFailures ?? []).join(SEP) || 'allowPartial'})`);
  return finish(problems, [], `cover, SSP, POA&M and E7B share snapshot ${cover.snapshotId}; SSP and POA&M within ${limit} h of the build; both DOCX present; not partial`);
}

// ---------- V85 (FLOW-4): the tenant-id clause ----------
// FLOW-4 open item 2: Stamper writes its stamper_evidence_metadata rows under its config TENANT_ID and C11 reads them
// under EO's tenant id; rows under another id are invisible to EO. Red when none of the rows is under EO's id while
// rows exist under others (FIN-14 aligns the ids).
export function judgeV85Tenant({ rows = null, otherTenantRows = 0 }) {
  if (rows === null) return { pass: true, detail: 'tenant-id clause: ces.db rows not read (reported by the main clause)' };
  if (rows.length === 0 && otherTenantRows > 0) return { pass: false, detail: `tenant-id clause: 0 stamper_evidence_metadata row(s) under EO's tenant id, ${otherTenantRows} under other ids (Stamper's TENANT_ID differs from EO's: FIN-14)` };
  return { pass: true, detail: `tenant-id clause: ${rows.length} row(s) under EO's tenant id${otherTenantRows ? `, ${otherTenantRows} under other ids` : ''}` };
}
// PH-11 (LOG-PH11-EO.md §6): EO's C11 chains only the newest Stamper run's rows; earlier rounds' rows (ces.db is
// long-lived and WORM) are history, so only rows written since this run's E1 are judged. all = ces_records rows
// {id, tenant_id, data, created_at}; sinceMs = this run's E1 start (NaN or absent: 0, every row judged).
export function v85RowsOfRun(all, tenantId, sinceMs) {
  const since = Number.isFinite(sinceMs) ? sinceMs : 0;
  const mine = all.filter((r) => r.tenant_id === tenantId);
  const rows = mine.filter((r) => Date.parse(r.created_at) >= since).map((r) => ({ id: r.id, sha256_hash: JSON.parse(r.data)?.sha256_hash ?? null }));
  return { rows, otherTenantRows: all.length - mine.length, earlierRoundRows: mine.length - rows.length };
}

// ---------- V87 (API-2): `eo package build` = the API build ----------
// record: out/eo-package-cli.json (E8); compare: v88ComparePlans(API package tree, CLI package tree), both the inner
// evidence-package-<date>/ folder (run-variant values: packageId, timestamps, hashes over them).
export function judgeV87({ record = null, recordStale = null, compare = null, apiFiles = 0, cliFiles = 0 }) {
  if (!record) return { pass: false, detail: 'no out/eo-package-cli.json (E8 did not run `eo package build`, or the API build failed first)' };
  if (recordStale) return { pass: false, detail: recordStale };
  if (record.rc !== 0) return { pass: false, detail: `\`eo package build\` exited ${record.rc}: ${String(record.error ?? '').slice(0, 300)}` };
  if (!record.expanded) return { pass: false, detail: 'the CLI zip was not expanded (out/eo-package-cli/)' };
  if (!compare) return { pass: false, detail: 'the API or the CLI package tree is missing' };
  const problems = [];
  if (compare.onlyApi.length) problems.push(`${compare.onlyApi.length} file(s) only in the API package: ${fin19ex(compare.onlyApi, 3)}`);
  if (compare.onlyScript.length) problems.push(`${compare.onlyScript.length} file(s) only in the CLI package: ${fin19ex(compare.onlyScript, 3)}`);
  if (compare.differing.length) problems.push(`${compare.differing.length} of ${compare.compared} file(s) differ beyond run-variant values: ${compare.examples.map((d) => `${d.name} at ${d.where}`).join(SEP)}`);
  return finish(problems, [], `\`eo package build\` = API build: ${compare.compared} file(s) equal minus run-variant values (API ${apiFiles}, CLI ${cliFiles})`);
}

// ---------- V110 (FIN-10, FD-2): a gate approval never credits a non-stack control ----------
// (a) The twin's stored snapshot: no non-stack control is met by a gate record (Tier 3 / Tier 4 import, or a rationale
// naming the manual gate) instead of a GD-b review, the records stores or a stack read. (b) The EU run (S1's watched
// Stamper run approves every pending gate): each out/ui/<variant>/eo-eu-probe.json, EO's assess over that variant's own
// pipeline root (no reviews, no stores). Every non-stack control with an approved gate record must not be met there.
// FIN-29 (R-F1 S1 red): the clause flagged every Tier 3 / Tier 4 decider, but a Tier 3 "state-verified execution verdict"
// on a Stamper SET entry (MA.L2-3.7.1/3.7.2 "Deploy Windows Update for Business Ring via Intune", MP.L2-3.8.4/3.8.9) or a
// Tier 4 evidence-only SAT (CA.L2-3.12.1-3, Compliance Manager / renderable POA&M) is a stack proxy (NS-audit F-8, F-4),
// not a gate approval. Only the DECIDER (the rationale's "decides ...: <type>/<result>: <detail>") is judged, and only a
// manual-gate record there (Stamper GateEvidence: "[manual-gate] <task>", "Manual gate approved by an operator ...") counts.
export const V110_GATE_DECIDED = /decides[^:]*:\s*[a-z_]+\/[a-z_]+:\s*(?:\[manual-gate\]|manual[ _-]?(?:gate|task)\b)|gate record|Manual gate approved/i;
export function judgeV110({ snapshot = null, euExpected = false, euProbes = [], nonStack = FIN19_NON_STACK, maxExamples = 5 }) {
  const ns = new Set(nonStack);
  const problems = [];
  const notes = [];
  const credit = (c) => /^GD-b/.test(c?.statusRationale ?? '') || V80_STORE_DECIDED.test(c?.statusRationale ?? '');
  if (!snapshot) problems.push('(a) no stored snapshot (out/eo-package/<latest>/assessments/latest-snapshot.json)');
  else {
    const bad = (snapshot.controls ?? []).filter((c) => ns.has(c.control_id) && c.status === 'met' && !credit(c) && V110_GATE_DECIDED.test(c.statusRationale ?? ''))
      .map((c) => `${c.control_id} (${String(c.statusRationale).slice(0, 60)})`);
    if (bad.length) problems.push(`(a) ${bad.length} non-stack control(s) met by a gate record: ${fin19ex(bad, maxExamples)}`);
    else notes.push('(a) twin: no non-stack control met by a gate record');
  }
  if (!euExpected) notes.push('(b) no watched Stamper UI run for this scenario (scenarios/ui): not applicable');
  else if (!euProbes.length) problems.push('(b) no out/ui/<variant>/eo-eu-probe.json (EU did not run, or CES_EU_EO_PROBE=0)');
  else {
    for (const p of euProbes) {
      const v = p.variant ?? '?';
      if (p.note && !(p.controls ?? []).length) { problems.push(`(b) ${v}: ${p.note}`); continue; }
      if (p.assess_rc !== 0) { problems.push(`(b) ${v}: EO assess over the EU root rc ${p.assess_rc ?? 'none'}${p.note ? ` (${p.note})` : ''}`); continue; }
      const approved = p.approved_non_stack ?? [];
      if (!approved.length) { problems.push(`(b) ${v}: the EU run approved no gate on a non-stack control (${(p.gates ?? []).length} gate record(s)): the probe proves nothing`); continue; }
      const byId = new Map((p.controls ?? []).map((c) => [c.control_id, c]));
      const credited = approved.filter((id) => byId.get(id)?.status === 'met' && !credit(byId.get(id))).map((id) => `${id} (${String(byId.get(id)?.statusRationale ?? '').slice(0, 60)})`);
      const missing = approved.filter((id) => !byId.has(id));
      const pending = approved.filter((id) => (byId.get(id)?.sources ?? []).some((s) => s.result === 'pending_review'));
      if (credited.length) problems.push(`(b) ${v}: ${credited.length} of ${approved.length} gate-approved non-stack control(s) credited by the gate: ${fin19ex(credited, maxExamples)}`);
      if (missing.length) problems.push(`(b) ${v}: ${missing.length} gate-approved control(s) not in EO's assessment: ${fin19ex(missing, maxExamples)}`);
      if (!credited.length && !missing.length) notes.push(`(b) ${v}: ${approved.length} gate-approved non-stack control(s), none credited (${pending.length} carry a pending_review source)`);
    }
  }
  return finish(problems, notes);
}

// ---------- V111 (FIN-11): SSP truthfulness ----------
// (a) no not_met / not_assessed control's own narrative (before the quoted policy extract) makes an affirmative claim;
// (b) PS.L2-3.9.2's narrative opens on terminations and transfers; (c) no approach row is "unknown" ("not checked") where
// its source exists this run (tenant_signal always; interview when EO holds interview records; adminops when E7A ran);
// (d) a control whose finding cites EC uploads (sha256) has at least one ec_upload approach row held; (e) "Non-Technology
// Stack" appears in the DOCX only on the 28 non-stack controls.
export const V111_AFFIRMATIVE = [
  /implemented and continuously verified/i,
  /\bthe organi[sz]ation (ensures|enforces|maintains|implements|employs|limits|controls|protects|monitors|provides|conducts|restricts|has (implemented|established|deployed))\b/i,
  /\b(is|are) (fully |properly )?(implemented|enforced|in place)\b/i,
];
const V111_NEGATED = /\b(not|no|never|without|yet to|pending|absent|until|unless)\b/i;
const V111_OWN_TEXT_END = /Policy-based implementation:|\[Extracted from|\*\*Policy and plan reference/;
export function v111OwnNarrative(text) {
  const t = String(text ?? '');
  const m = V111_OWN_TEXT_END.exec(t);
  return m ? t.slice(0, m.index) : t;
}
export function v111AffirmativeSentences(text) {
  return v111OwnNarrative(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s && !V111_NEGATED.test(s) && V111_AFFIRMATIVE.some((re) => re.test(s)));
}
export function judgeV111({ ssp = null, docxText = null, interviewsHeld = false, adminOpsRan = false, nonStack = FIN19_NON_STACK, maxExamples = 5 }) {
  if (!ssp) return { pass: false, detail: 'no out/ssp.json (E8)' };
  const ns = new Set(nonStack);
  const ci = ssp.controlImplementations ?? [];
  const problems = [];
  const claims = ci.filter((c) => c.status === 'not_met' || c.status === 'not_assessed').flatMap((c) => v111AffirmativeSentences(c.implementationNarrative).map((s) => `${c.control_id} ${c.status}: "${s.slice(0, 70)}"`));
  if (claims.length) problems.push(`(a) ${claims.length} affirmative sentence(s) on not_met / not_assessed controls: ${fin19ex(claims, maxExamples)}`);
  const ps = ci.find((c) => c.control_id === 'PS.L2-3.9.2');
  const psFirst = String(ps?.implementationNarrative ?? '').split(/\n\s*\n/)[0];
  if (!ps) problems.push('(b) no PS.L2-3.9.2 in the SSP');
  else if (!/terminat|transfer/i.test(psFirst) || /personnel security criteria/i.test(psFirst)) problems.push(`(b) PS.L2-3.9.2's narrative is not about terminations and transfers: "${psFirst.slice(0, 90)}"`);
  const sourceExists = (src) => src === 'tenant_signal' || (src === 'interview' && interviewsHeld) || (src === 'adminops' && adminOpsRan);
  const unknown = [];
  const ecMismatch = [];
  for (const c of ci) {
    const rows = (c.assessmentApproach?.objectives ?? []).flatMap((o) => (o.evidence ?? []).map((e) => ({ o: o.objectiveId, ...e })));
    for (const r of rows) if (r.held === 'unknown' && sourceExists(r.cesSource)) unknown.push(`${r.o} ${r.cesSource}`);
    const cited = new Set(String(c.assessmentFinding ?? '').match(/sha256 [0-9a-f]{12}/g) ?? []);
    const ecRows = rows.filter((r) => r.cesSource === 'ec_upload');
    if (cited.size && ecRows.length && !ecRows.some((r) => r.held === 'held')) ecMismatch.push(`${c.control_id} (finding cites ${cited.size} upload(s), approach holds none)`);
  }
  if (unknown.length) problems.push(`(c) ${unknown.length} approach row(s) "not checked" although the source exists: ${fin19ex(unknown, maxExamples)}`);
  if (ecMismatch.length) problems.push(`(d) ${ecMismatch.length} control(s) whose approach contradicts the finding on EC uploads: ${fin19ex(ecMismatch, maxExamples)}`);
  if (docxText === null) problems.push('(e) no SSP DOCX text (out/ssp.docx)');
  else {
    const ids = [...docxText.matchAll(/\b[A-Z]{2}\.L[12]-3\.\d{1,2}\.\d{1,2}\b/g)];
    const wrong = new Set();
    for (const m of docxText.matchAll(/Non-Technology Stack/g)) {
      const before = ids.filter((x) => x.index < m.index).pop();
      if (before && !ns.has(before[0])) wrong.add(before[0]);
    }
    if (wrong.size) problems.push(`(e) "Non-Technology Stack" on ${wrong.size} control(s) outside the non-stack set: ${fin19ex([...wrong], maxExamples)}`);
  }
  return finish(problems, [], `(a)-(e) hold over ${ci.length} control(s): no affirmative claim on a not_met / not_assessed control; PS.L2-3.9.2 on terminations and transfers; held resolved; EC counts agree; "Non-Technology Stack" only on the non-stack set`);
}

// ---------- V112 (FIN-12): EO's upload route, `eo review`, supersede ----------
// upload: out/ec-upload-eo-route.json (E8.5b); ecItems: the tenant's EC items (V80's read); cli: out/eo-review-cli.json
// (E8.6b); reviewsAll: every eo_document_reviews row of the slug (history); uploaderUpn: the review plan's uploader.
export function judgeV112({ upload = null, uploadStale = null, ecItems = null, cli = null, cliStale = null, reviewsAll = null, uploaderUpn = null, hasReviewer = false, wantFormId = null }) {
  const problems = [];
  const notes = [];
  if (!upload) return { pass: false, detail: 'no out/ec-upload-eo-route.json (E8.5b did not run)' };
  if (uploadStale) return { pass: false, detail: uploadStale };
  if (upload.http_status !== 201) problems.push(`(a) EO's upload route answered HTTP ${upload.http_status ?? 'none'}${upload.note ? ` (${upload.note})` : ''}`);
  else if (!ecItems) problems.push('(a) EC items not read');
  else {
    const item = ecItems.find((i) => fin19lc(i.sha256) === fin19lc(upload.sha256) && (i.controlIds ?? []).includes(upload.control_ids?.[0]));
    if (!item) problems.push(`(a) no EC item with the upload's sha256 ${String(upload.sha256).slice(0, 12)} on ${upload.control_ids?.[0]}`);
    else {
      const by = item.uploadedBy?.upn ?? (typeof item.uploadedBy === 'string' ? item.uploadedBy : null);
      const before = problems.length;
      if (!by) problems.push("(a) the EC item records no uploader (EO's route dropped the principal: NS-audit F-2)");
      else if (uploaderUpn && fin19lc(by) !== fin19lc(uploaderUpn)) problems.push(`(a) the EC item's uploader is ${by}, the plan's uploader ${uploaderUpn}`);
      const fid = item.form_id ?? item.catalog?.form_id ?? null;
      if (wantFormId && fid !== wantFormId) problems.push(`(a) the EC item's form_id is ${fid ?? 'none'}, sent ${wantFormId}`);
      if (problems.length === before) notes.push(`(a) EO route upload stored as ${item.itemId ?? item.id}, uploader ${by}${fid ? `, form_id ${fid}` : ''}`);
    }
  }
  if (!hasReviewer) {
    notes.push('(b)-(d) the review plan has no reviewer: not applicable');
    return finish(problems, notes);
  }
  if (!cli) problems.push('(b) no out/eo-review-cli.json (E8.6b did not run)');
  else if (cliStale) problems.push(`(b) ${cliStale}`);
  else {
    const [r1, r2] = cli.calls ?? [];
    if (!r1 || !r2 || r1.rc !== 0 || r2.rc !== 0 || !r1.review_id || !r2.review_id) {
      problems.push(`(b) \`eo review\` x2: ${(cli.calls ?? []).map((c) => `rc ${c.rc}${c.error ? ` ${String(c.error).slice(0, 120)}` : ''}`).join(SEP) || cli.note || 'no call'}`);
    } else {
      const before = problems.length;
      if (!(r2.supersedes ?? []).includes(r1.review_id)) problems.push(`(c) the second review ${r2.review_id} does not supersede the first ${r1.review_id} (supersedes ${JSON.stringify(r2.supersedes ?? [])})`);
      const liveForObj = (cli.list?.live ?? []).filter((x) => x.objective_id === cli.objective_id).map((x) => x.review_id);
      if (liveForObj.length !== 1 || liveForObj[0] !== r2.review_id) problems.push(`(c) \`eo review list\` live rows for ${cli.objective_id}: ${JSON.stringify(liveForObj)}, want [${r2.review_id}]`);
      const hist = (cli.list?.history ?? []).find((x) => x.review_id === r1.review_id);
      if (!hist || hist.superseded_by !== r2.review_id) problems.push(`(c) history does not mark ${r1.review_id} superseded by ${r2.review_id}`);
      if (reviewsAll) {
        const live = liveReviewRows(reviewsAll).filter((r) => r.objectiveId === cli.objective_id).map((r) => r.reviewId);
        if (live.length !== 1 || live[0] !== r2.review_id) problems.push(`(d) ces.db live rows for ${cli.objective_id}: ${JSON.stringify(live)}, want only the superseding ${r2.review_id}`);
        const row2 = reviewsAll.find((r) => r.reviewId === r2.review_id);
        if (row2 && uploaderUpn && fin19lc(row2.reviewer?.upn) === fin19lc(uploaderUpn)) problems.push('(d) the superseding review is by the uploader (GD-b)');
      }
      if (problems.length === before) notes.push(`(b)-(d) \`eo review\` ${r1.review_id} then ${r2.review_id} on ${cli.objective_id}: the second supersedes the first and is the only live row`);
    }
  }
  return finish(problems, notes);
}

// ---------- V113 (FIN-13 + FD-1): an AO recurring-cost op traversed on the sim ----------
// record: out/adminops-cost.json (E7C); probeOp: the scenario's COST_PROBES op (ces-tester fin19-steps.ts; null = none);
// rowOf(id): the ces.db adminops_evidence row (V103's aoRow). Every call is evidenced (a row per call).
export function judgeV113({ probeOp = null, record = null, recordStale = null, rowOf = () => null }) {
  if (!probeOp) return { pass: true, detail: 'not run here: the cost traversal runs on S1 only (ces-tester fin19-steps.ts COST_PROBES)' };
  if (!record) return { pass: false, detail: `no out/adminops-cost.json (E7C did not run ${probeOp})` };
  if (recordStale) return { pass: false, detail: recordStale };
  const by = (k) => (record.calls ?? []).find((c) => c.call === k);
  const problems = [];
  const d = by('dry_run');
  if (!d) problems.push(`no dry run${record.note ? ` (${record.note})` : ''}`);
  else if (d.monthly_usd === null || !d.ack_hash) problems.push(`the dry run showed no price (cost gate ${d.cost_outcome ?? 'absent'}${d.cost_reason ? `: ${String(d.cost_reason).slice(0, 160)}` : ''})`);
  const want = [
    ['apply_no_dp1', (c) => c.success === false && /dp1_missing/.test(c.cost_reason ?? ''), 'refused dp1_missing'],
    ['apply_wrong_dp2', (c) => c.success === false && /dp2_mismatch/.test(c.cost_reason ?? ''), 'refused dp2_mismatch'],
    ['apply_dp1_dp2', (c) => c.success === true && c.cost_outcome === 'enabled', 'ran, cost gate enabled'],
  ];
  if (d && d.monthly_usd !== null) {
    for (const [k, ok, what] of want) {
      const c = by(k);
      if (!c) problems.push(`${k}: not run`);
      else if (!ok(c)) problems.push(`${k}: want ${what}, got success ${c.success}, cost ${c.cost_outcome ?? '-'}${c.cost_reason ? ` (${String(c.cost_reason).slice(0, 140)})` : ''}`);
    }
  }
  const unevidenced = (record.calls ?? []).filter((c) => !c.evidence_row_id || !rowOf(c.evidence_row_id)).map((c) => c.call);
  if (unevidenced.length) problems.push(`no adminops_evidence row for: ${unevidenced.join(', ')}`);
  const okCall = by('apply_dp1_dp2');
  const okRow = okCall?.evidence_row_id ? rowOf(okCall.evidence_row_id) : null;
  const cg = okRow?.evidence?.metadata?.costGate;
  if (okRow && !(cg?.dp1 && cg?.dp2)) problems.push("the enabled run's evidence row carries no DP-1 / DP-2 record");
  if (problems.length) return { pass: false, detail: `${probeOp}: ${problems.join(SEP)}` };
  return { pass: true, detail: `${probeOp} on ${record.tenant_slug}: price $${d.monthly_usd} a month (price date ${d.price_date}) shown in the dry run; refused without DP-1 and on a wrong DP-2; ran with DP-1 + DP-2; all ${(record.calls ?? []).length} calls evidenced` };
}

// ---------- V114 (FIN-17): Muster's own calls, `mu plan compile`, push-gate and slug probes ----------
// pushResponse: out/push-response.json (eo_intake = muster-api's own EO intake call, EO up since E3); planFiles: pushed
// name -> { sha256 } (as V84); compileRecord: out/plan-compile.json (eo_interviews); mu: out/plan-compile-mu.json;
// compare: v88ComparePlans(out/plan, out/plan-mu); probes: out/muster-probes.json.
export function judgeV114({ pushResponse = null, planFiles = {}, compileRecord = null, answersPresent = false, mu = null, compare = null, probes = null }) {
  const problems = [];
  const notes = [];
  const eo = pushResponse?.eo_intake;
  if (!pushResponse) problems.push('(a) no out/push-response.json');
  else if (eo?.status !== 'delivered' || eo?.http !== 201) problems.push(`(a) muster-api's EO intake call: ${eo?.status ?? 'no eo_intake'}${eo?.http ? ` HTTP ${eo.http}` : ''}${eo?.error ? ` (${String(eo.error).slice(0, 160)})` : ''}`);
  else {
    const items = eo.receipt?.items ?? [];
    const mpName = (pushResponse.pushed ?? []).find((n) => n.startsWith('manual-mission-plan-'));
    const mpItem = items.find((i) => i.kind === 'mission_plan');
    const bad = items.filter((i) => i.file_name && planFiles[i.file_name] && planFiles[i.file_name].sha256 !== i.sha256).map((i) => i.file_name);
    if (!mpItem || !mpName || !planFiles[mpName] || mpItem.sha256 !== planFiles[mpName].sha256) problems.push(`(a) EO's receipt hash for the Mission Plan (${String(mpItem?.sha256 ?? 'none').slice(0, 12)}) is not the pushed file's (${String(planFiles[mpName]?.sha256 ?? 'none').slice(0, 12)})`);
    else if (bad.length) problems.push(`(a) ${bad.length} receipt hash(es) differ from the pushed files: ${fin19ex(bad, 3)}`);
    else notes.push(`(a) EO intake 201 from muster-api, receipt ${eo.receipt?.receipt_id}: ${items.length} part(s), hashes = pushed files`);
    // FIN-17: muster-api's own comparison of the receipt with what it pushed (push 201 eo_intake_check).
    const chk = pushResponse.eo_intake_check;
    if (chk && ((chk.mismatched ?? []).length || (chk.missing ?? []).length)) problems.push(`(a) muster-api's eo_intake_check: ${(chk.mismatched ?? []).length} mismatched, ${(chk.missing ?? []).length} missing (${fin19ex([...(chk.mismatched ?? []), ...(chk.missing ?? [])], 3)})`);
  }
  const iv = compileRecord?.eo_interviews;
  if (!compileRecord) problems.push('(b) no out/plan-compile.json');
  else if (!answersPresent) notes.push(`(b) no interview answers: interview send ${iv?.status ?? 'not reported'}`);
  else if (iv?.status !== 'delivered') problems.push(`(b) the compile's interview-record send: ${iv?.status ?? 'not reported in the compile body (FIN-17)'}${iv?.error ? ` (${String(iv.error).slice(0, 120)})` : ''}`);
  else notes.push(`(b) interview records delivered (${iv.records ?? '?'}; EO stored ${iv.stored ?? '?'}, skipped ${iv.skipped ?? '?'})`);
  if (!mu) problems.push('(c) no out/plan-compile-mu.json (E3 did not run `mu plan compile`)');
  else if (mu.rc !== 0) problems.push(`(c) \`mu plan compile\` exited ${mu.rc ?? 'none'}${mu.error ? `: ${String(mu.error).slice(0, 160)}` : ''}`);
  else if (!compare) problems.push('(c) out/plan or out/plan-mu missing');
  else if (compare.onlyApi.length || compare.onlyScript.length || compare.differing.length) problems.push(`(c) \`mu plan compile\` differs from the API compile: ${compare.onlyApi.length} only API, ${compare.onlyScript.length} only mu, ${compare.differing.length} differing${compare.examples.length ? ` (${compare.examples.map((x) => `${x.name} at ${x.where}`).join(SEP)})` : ''}`);
  else notes.push(`(c) \`mu plan compile\` = API compile (${compare.compared} file(s), from ${mu.source})`);
  if (!probes) problems.push('(d)(e) no out/muster-probes.json (E4 probes)');
  else {
    if (probes.cross_file?.status !== 409) problems.push(`(d) the cross-file push without an override got HTTP ${probes.cross_file?.status ?? 'none'}${probes.cross_file?.note ? ` (${probes.cross_file.note})` : ''}, want 409`);
    else notes.push(`(d) cross-file push 409${probes.cross_file.code ? ` ${probes.cross_file.code}` : ''}`);
    if (probes.other_tenant?.status !== 404) problems.push(`(e) a second tenant's push to the claimed slug got HTTP ${probes.other_tenant?.status ?? 'none'}${probes.other_tenant?.note ? ` (${probes.other_tenant.note})` : ''}, want 404`);
    else notes.push('(e) second tenant 404 on the claimed slug');
  }
  return finish(problems, notes);
}

// ---------- V88 (f) (SECRETS-PLAN.md §6; FIN-17 SP-7): the initial-password reference's read budget ----------
// calls: the lines of <pl>/Stamper/plan-data/<slug>/state/muster-eo-calls.jsonl (muster-api's own call record; E6 wipes
// state/, so only the E6 and E8F reads remain); ref: out/plan-compile.json initial_password_ref; e8fRan: E8F ran (not
// skipped); probeStatus: forced.json secret_probe_status (one more read after E8F). Want: one secret_read per Stamper
// execute (E6, and E8F when it ran), reads numbered 1..n with max_reads 2, no value on any line, and the probe 404.
export function judgeV88F({ calls = null, ref = null, e8fRan = false, probeStatus = null }) {
  if (!ref) return { pass: false, detail: '(f) no initial-password reference in out/plan-compile.json' };
  if (calls === null) return { pass: false, detail: '(f) no muster-eo-calls.jsonl under pl/Stamper/plan-data/<slug>/state (muster-api before FIN-17?)' };
  const problems = [];
  const reads = calls.filter((c) => c?.event === 'secret_read' && c.ref === ref);
  const want = e8fRan ? 2 : 1;
  if (reads.length !== want) problems.push(`${reads.length} secret_read line(s) for ${ref}, want ${want} (E6${e8fRan ? ', E8F' : ''})`);
  const nums = reads.map((r) => r.read);
  if (nums.some((n, i) => n !== i + 1)) problems.push(`read counters ${JSON.stringify(nums)}, want 1..${reads.length}`);
  if (reads.some((r) => r.max_reads !== 2)) problems.push(`max_reads ${[...new Set(reads.map((r) => r.max_reads))].join('/')}, want 2 (plan-compile.mjs compileBody)`);
  if (calls.some((c) => c && Object.prototype.hasOwnProperty.call(c, 'value'))) problems.push('a call record line carries a value');
  if (e8fRan && probeStatus !== 404) problems.push(`the probe read after E8F got HTTP ${probeStatus ?? 'none'}, want 404 (budget spent)`);
  return finish(problems, [], `(f) ${reads.length} secret_read line(s) (E6${e8fRan ? ', E8F' : ''}) with max_reads 2${e8fRan ? '; the probe read after E8F got 404' : '; no E8F: no probe'}`);
}

// ---------- V104 (CG-8 / FIN-17): the MX_SUMMARY and push COST_RECURRING clauses ----------
// mp: the pushed Mission Plan (its recurring_cost_notice items); record: out/plan-compile.json (summary,
// cost_notice_lines); pushResponse: out/push-response.json (warnings).
export function judgeV104Lines({ mp = null, record = null, pushResponse = null }) {
  const n = Array.isArray(mp?.recurring_cost_notice?.items) ? mp.recurring_cost_notice.items.length : null;
  if (n === null) return { pass: false, detail: 'MX_SUMMARY / COST_RECURRING: no notice items to compare' };
  const problems = [];
  const m = /\brecurring_items=(\d+)\b/.exec(String(record?.summary ?? ''));
  if (!m) problems.push(`the compile summary carries no recurring_items (${String(record?.summary ?? 'no summary').slice(0, 80)})`);
  else if (Number(m[1]) !== n) problems.push(`MX_SUMMARY recurring_items=${m[1]}, the notice lists ${n}`);
  if (Array.isArray(record?.cost_notice_lines) && record.cost_notice_lines.length !== n) problems.push(`${record.cost_notice_lines.length} cost_notice_lines, the notice lists ${n}`);
  const line = (pushResponse?.warnings ?? []).find((w) => /^COST_RECURRING: /.test(String(w)));
  const pm = /^COST_RECURRING: (\d+) items/.exec(String(line ?? ''));
  if (!pm) problems.push('the push 201 warnings carry no COST_RECURRING line');
  else if (Number(pm[1]) !== n) problems.push(`push COST_RECURRING says ${pm[1]} items, the notice lists ${n}`);
  return finish(problems, [], `MX_SUMMARY recurring_items=${n} and the push "${line}" agree with the notice`);
}

// ---------- V75 clause (b) (FIN-42 / SP-4, SECRETS-PLAN.md section 5) ----------
// probe.ao_store (mx-e2e.ps1 Invoke-AuthProbeStore): AO started once from a DPAPI module-secret store under out/fin42,
// with no CES_AO_AUTH_TOKEN in its environment. Judged: the store was written, the env held no AO token, AO came up,
// /api/health 200 with auth "ENFORCED", a tokenless /api/commands 401, and the store was deleted afterwards. Kept
// here (not inside judgeV75) so the CRLF block that follows judgeV75 keeps its line numbers.
export const V75_STORE_OK = 'AO from the DPAPI module-secret store (no env token): /api/health auth ENFORCED, tokenless /api/commands 401, store removed';
export function v75StoreProblems(probe) {
  const st = probe?.ao_store;
  if (!st) return ['(b) no ao_store in the probe (the FIN-42 module-secret-store probe of mx-e2e.ps1 did not run)'];
  const p = [];
  if (st.error) p.push(`(b) store probe error: ${st.error}`);
  if (st.generated !== true) p.push('(b) the module-secret store was not written');
  if (st.env_token !== false) p.push('(b) CES_AO_AUTH_TOKEN was still in the environment when AO started from the store');
  if (st.up !== true) p.push('(b) AO did not come up from the store');
  if (st.health?.status !== 200) p.push(`(b) AO /api/health status ${st.health?.status ?? 'none'} (want 200)`);
  if (st.health?.body?.auth !== 'ENFORCED') p.push(`(b) AO /api/health auth ${JSON.stringify(st.health?.body?.auth ?? null)} (want "ENFORCED")`);
  if (st.api_no_token?.status !== 401) p.push(`(b) AO tokenless /api/commands status ${st.api_no_token?.status ?? 'none'} (want 401)`);
  if (st.store_removed !== true) p.push('(b) the store under out/fin42 was not removed');
  return p;
}

// ---------- PH-5 (R-F2 V117 red): the freshness reference for out/ artefacts ----------
// E0 (tester harness, clean-tenant init) runs just before E1 and writes e0-clean-tenant.json 1-3 ms before the E1 stamp,
// so the reference is this run's first step start: E0's when it ran, else E1's (the mx harness has no E0). Returns
// { ms, step, started } or { ms: NaN } when neither stamp is present (mtimes are then not judged). A file older than
// that stamp is still an earlier run's.
export function stepStartMs(v) {
  if (!v) return NaN;
  const m = /\/Date\((-?\d+)/.exec(String(v)); if (m) return Number(m[1]);
  const t = String(v); return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
}
export function runWindowStart(steps) {
  for (const step of ['E0', 'E1']) {
    const started = steps?.[step]?.started;
    const ms = stepStartMs(started);
    if (Number.isFinite(ms)) return { ms, step, started: String(started) };
  }
  return { ms: NaN, step: null, started: null };
}

// ---------- V6 (PH-9 P9-PK) ----------
// Since DEPTH-3 (ces-stamper src/translators/objectiveCredit.ts, CREDIT_BY_OBJECTIVE) a directive whose registry entries
// already run in another task is folded: no task of its own, its objectives sit in the host task's credits[]. So the MP's
// directive count no longer equals the task count. V6 accounts for every directive instead: its control is planned (in a
// task's controls[] or named by the task id) or folded (an objective of it in some task's credits[]). A directive that is
// neither was dropped, and V6 is red. The report must cover the whole plan (summary.total_tasks = execution_graph length).
const V6_TASK_CONTROL_RE = /^(?:step_task_|manual-|prohibition-|renderable-|absence-)([A-Z]{2}\.L[12]-\d+\.\d+\.\d+)(?:_|$)/;
export function judgeV6Accounting({ directives = [], plan = null, report = null }) {
  const tasks = Array.isArray(plan?.execution_graph) ? plan.execution_graph : null;
  if (!tasks) return { pass: false, detail: 'no executable plan (out/executable-plan.json) to account the directives against' };
  const planned = new Set();
  const credited = new Set();
  for (const t of tasks) {
    for (const c of t.controls ?? []) planned.add(c);
    const m = V6_TASK_CONTROL_RE.exec(String(t.id ?? ''));
    if (m) planned.add(m[1]);
    for (const cr of t.credits ?? []) credited.add(String(cr.objective_id ?? '').replace(/\[[^\]]*\]$/, ''));
  }
  const total = report?.summary?.total_tasks;
  const problems = [];
  if (total !== tasks.length) problems.push(`report has ${total} tasks, executable plan has ${tasks.length}`);
  const folded = [];
  const dropped = [];
  for (const d of directives) {
    const c = d.control_id;
    if (planned.has(c)) continue;
    if (credited.has(c)) folded.push(c);
    else dropped.push(c);
  }
  if (dropped.length) problems.push(`${dropped.length} directive(s) with no task and no objective credit (dropped): ${dropped.join(', ')}`);
  const head = `${tasks.length} tasks for ${directives.length} directives; ${folded.length} folded by objective credit${folded.length ? `: ${folded.join(', ')}` : ''}`;
  return { pass: problems.length === 0, detail: problems.length ? `${problems.join('; ')} (${head})` : head };
}
