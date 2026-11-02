// Gap closure PKG-2 tests (GAP-CLOSURE-PLAN.md §4 G-PKG row PKG-2; V12 and V30 tightened): node --test scripts/gap-pkg.test.mjs
// verify.mjs runs its checks on import, so the pure judges are loaded from its source: the block between the
// "GC-PKG-2 judges (begin)" and "(end)" markers. EO's SspGenerator.ts source is read (read only) to prove both sides
// use the same claim patterns and placeholder names. Fixtures are synthetic (fictional names). Nothing is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(HERE, '..', '..', '..');
const VERIFY = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
const SSP_GEN = path.join(WS, 'ces', 'ces-eo', 'src', 'eo', 'ssp', 'SspGenerator.ts');

const BEGIN = '// ---------- GC-PKG-2 judges (begin)';
const END = '// ---------- GC-PKG-2 judges (end) ----------';
const block = VERIFY.slice(VERIFY.indexOf(BEGIN), VERIFY.indexOf(END));
const judges = await import(`data:text/javascript,${encodeURIComponent(`${block}\nexport { judgeSystemName, nonMetClaimHits, pkg2IsPlaceholderName, PKG2_CLAIM_PATTERNS, PKG2_PLACEHOLDER_NAMES };`)}`);
const { judgeSystemName, nonMetClaimHits, pkg2IsPlaceholderName, PKG2_CLAIM_PATTERNS, PKG2_PLACEHOLDER_NAMES } = judges;

const MARK = 'SIMULATED CUSTOMER (FICTIONAL): ';
const ORG = 'Brackenmoor Tooling LLC (FICTIONAL)';
const ID_REAL = { display_name: ORG, primary_domain: 'bm-tool.simtenant.example.test' };
const ID_SIM = { display_name: 'Sim Tenant', primary_domain: 'mp-tenant.simtenant.example.test' };

test('verify.mjs carries the judge block once, wires it into V12 and V30, and stays LF', () => {
  assert.ok(VERIFY.indexOf(BEGIN) > 0 && VERIFY.indexOf(END) > VERIFY.indexOf(BEGIN), 'judge block markers');
  assert.equal(VERIFY.split(BEGIN).length, 2, 'one judge block');
  const v12 = VERIFY.slice(VERIFY.indexOf("check('V12'"), VERIFY.indexOf("check('V12'") + 2500);
  assert.match(v12, /problems\.push\(\.\.\.judgeSystemName\(ssp\.systemName, inner\.tenant_identity\)\)/);
  const v30 = VERIFY.slice(VERIFY.indexOf("check('V30'"), VERIFY.indexOf("check('V31'") > 0 ? VERIFY.indexOf("check('V31'") : undefined);
  assert.match(v30, /nonMetClaimHits\(ssp\.controlImplementations\)/);
  assert.equal(VERIFY.includes('\r'), false, 'verify.mjs stays LF');
});

test('V12 name: a real TM display name passes, with or without the V58 simulation marker', () => {
  assert.deepEqual(judgeSystemName(ORG, ID_REAL), []);
  assert.deepEqual(judgeSystemName(`${MARK}${ORG}`, ID_REAL), []);
});

test('V12 name: the S1 doubling ("marker: X - X") fails as doubled', () => {
  const p = judgeSystemName(`${MARK}${ORG} - ${ORG}`, ID_REAL);
  assert.equal(p.length, 1, p.join('; '));
  assert.match(p[0], /systemName is doubled/);
  assert.match(judgeSystemName(`${ORG} - ${ORG}`, ID_REAL)[0], /doubled/);
});

test('V12 name: "Sim Tenant", "Tenant", empty and whitespace fail as placeholders', () => {
  for (const n of ['Sim Tenant', 'sim  tenant', 'Tenant', 'TEST TENANT', '', '   ', undefined, `${MARK}Sim Tenant`]) {
    const p = judgeSystemName(n, ID_SIM);
    assert.ok(p.some((x) => /empty or a placeholder/.test(x)), `${JSON.stringify(n)}: ${p.join('; ')}`);
  }
});

test('V12 name: with a placeholder TM display name the primary domain is the expected name', () => {
  assert.deepEqual(judgeSystemName(ID_SIM.primary_domain, ID_SIM), []);
  assert.match(judgeSystemName('Something Else Inc', ID_SIM)[0], /is not the TM tenant identity "mp-tenant\.simtenant\.example\.test"/);
  assert.match(judgeSystemName('x.example.test', { display_name: 'Sim Tenant' })[0], /neither a real display_name nor a primary_domain/);
});

test('V12 name: a name that is not the TM identity fails; a doubled TM display name expects it once', () => {
  assert.match(judgeSystemName('Other Works LLC (FICTIONAL)', ID_REAL)[0], /is not the TM tenant identity/);
  assert.deepEqual(judgeSystemName(ORG, { display_name: `${ORG} - ${ORG}` }), []);
});

const ctl = (control_id, status, implementationNarrative) => ({ control_id, status, implementationNarrative });

test('V30 non-met: the run-observed TM assertion on a not-assessed control is a claim', () => {
  const hits = nonMetClaimHits([ctl('PE.L1-3.10.1', 'not_assessed', 'Required state (Tenant Manifest): Physical Access Limitation (PE.L1-3.10.1) — implemented and continuously verified.\n\nProcedure (Mission Plan step).')]);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /^PE\.L1-3\.10\.1 \(not_assessed\) "— implemented and continuously verified\."$/);
});

test('V30 non-met: "is implemented" and "continuously verified" on not_met controls are claims, one hit per control', () => {
  const hits = nonMetClaimHits([
    ctl('AC.L1-3.1.1', 'not_met', 'MFA is implemented for all users.'),
    ctl('AU.L2-3.3.1', 'not_met', 'Logs are continuously verified and is fully implemented.'),
  ]);
  assert.deepEqual(hits.map((h) => h.split(' ')[0]), ['AC.L1-3.1.1', 'AU.L2-3.3.1']);
});

test('V30 non-met: negated statements, EO\'s restated text and met controls are not claims', () => {
  const hits = nonMetClaimHits([
    ctl('A', 'not_met', 'MFA is not implemented.'),
    ctl('B', 'not_met', 'MFA has not been implemented.'),
    ctl('C', 'not_assessed', 'MFA is not yet implemented. Never implemented.'),
    ctl('D', 'not_assessed', 'Required state (Tenant Manifest): Visitor Escort (PE.L1-3.10.3) — required; not yet shown to be in place.'),
    ctl('E', 'met', 'Conditional Access is implemented and continuously verified.'),
    ctl('F', 'not_met', undefined),
  ]);
  assert.deepEqual(hits, []);
});

test('V12 / V30 judges mirror EO\'s SspGenerator: same claim patterns, same placeholder names', { skip: fs.existsSync(SSP_GEN) ? false : `absent: ${SSP_GEN}` }, () => {
  const src = fs.readFileSync(SSP_GEN, 'utf8');
  const pats = src.slice(src.indexOf('export const IMPLEMENTATION_CLAIM_PATTERNS'), src.indexOf('];', src.indexOf('export const IMPLEMENTATION_CLAIM_PATTERNS')));
  const eoSources = [...pats.matchAll(/^\s*\/(.+)\/gi,\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(eoSources, PKG2_CLAIM_PATTERNS.map((re) => re.source));
  const names = /const PLACEHOLDER_SYSTEM_NAMES = new Set\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(names, 'EO placeholder set');
  assert.deepEqual(names[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')), [...PKG2_PLACEHOLDER_NAMES]);
  assert.equal(pkg2IsPlaceholderName('Sim Tenant'), true);
});
