// W8-PKG tests (PLAN.md W8 §7 V72: translateForTenant cli / gui projections, and the cli projection vs E6's executable plan):
//   node --test scripts/w8-pkg.test.mjs
// Self-contained: every fixture is a synthetic projection (fictional names); the only package file read is verify.mjs's source
// (read only). Nothing in the workspace is written and Stamper is not imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV72, firstProjectionDiff } from './verify-w4.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLUG = 's1-mach';

// A projectExecutablePlan()-shaped fixture (Stamper src\translators\translateForTenant.ts).
const sub = (id, extra = {}) => ({ id, set_command: `Set-Thing -Name ${id}`, get_command: `Get-Thing -Name ${id}`, evidence_commands: [`Get-Thing -Name ${id} | ConvertTo-Json`], org_values: null, lookup: null, verification: { expect: 'present' }, ...extra });
const task = (id, controls, subs, extra = {}) => ({ id, engine: 'powershell', directive: 'implement', controls, sub_commands: subs, ...extra });
const projection = () => ({
  tasks: [
    task('AC.L1-3.1.1', ['AC.L1-3.1.1'], [sub('AC.L1-3.1.1.ca-mfa-compliant-device', { lookup: { predicate: 'ca-mfa-compliant-device' } })]),
    task('IA.L2-3.5.3', ['IA.L2-3.5.3'], [sub('IA.L2-3.5.3.mfa-registration', { org_values: { tier: 'all' } })]),
    task('PS.L2-3.9.2', ['PS.L2-3.9.2'], [sub('PS.L2-3.9.2.leaver-workflow')]),
  ],
  variables: { primaryDomain: 'fabrikam-sim.example', tenantName: 'fabrikam-sim', _infra_manifest_source: 'C:\\ws\\plans\\infrastructure-manifest-s1-mach-T1.json' },
});
const ok = () => ({ slug: SLUG, cli: projection(), gui: projection(), e6: projection(), tenant: SLUG });

test('V72: equal cli, gui and E6 projections pass; the detail counts tasks and variables and names the tenant record', () => {
  const r = judgeV72(ok());
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /\(a\) cli = gui projection \(3 tasks, 3 variables\)/);
  assert.match(r.detail, /tenant record s1-mach loaded/);
  const noTenant = judgeV72({ ...ok(), tenant: null });
  assert.equal(noTenant.pass, true, noTenant.detail);
  assert.match(noTenant.detail, /absent at verify time/);
});

test('V72 (a): a gui task difference fails and names the first differing task and field', () => {
  const i = ok();
  i.gui.tasks[1].sub_commands[0].org_values = { tier: 'none' };
  i.gui.tasks[2].controls = ['PS.L2-3.9.1'];
  const r = judgeV72(i);
  assert.equal(r.pass, false);
  assert.match(r.detail, /\(a\) cli projection != gui projection: first difference task 1 IA\.L2-3\.5\.3, field sub_commands/);
  assert.doesNotMatch(r.detail, /\(b\)/);
});

test('V72 (a): a gui variables difference fails and names the key; (b) ignores the same difference', () => {
  const i = ok();
  i.gui.variables._infra_manifest_source = 'C:\\ws\\plans\\infra-manifest-s1-mach-T1.json';
  i.e6.variables = { primaryDomain: 'overridden.example', initialPassword: '<sim-only>' };
  const r = judgeV72(i);
  assert.equal(r.pass, false);
  assert.match(r.detail, /^\(a\) .* first difference variables\._infra_manifest_source$/);
});

test('V72 (b): E6 variables are excluded; an E6 task difference fails and names the task', () => {
  const i = ok();
  i.e6.variables = { primaryDomain: 'overridden.example', _translated_at: 'ignored' };
  assert.equal(judgeV72(i).pass, true, judgeV72(i).detail);
  i.e6.tasks[0].engine = 'graph';
  const r = judgeV72(i);
  assert.equal(r.pass, false);
  assert.match(r.detail, /\(b\) cli projection != E6 out\/executable-plan\.json projection \(variables excluded\): first difference task 0 AC\.L1-3\.1\.1, field engine/);
});

test('V72 (b): a missing or extra E6 task fails with the task counts; a reordered task names both ids', () => {
  const i = ok();
  i.e6.tasks.pop();
  assert.match(judgeV72(i).detail, /task count 3 != 2 \(first unmatched: task 2 PS\.L2-3\.9\.2\)/);
  const j = ok();
  j.e6.tasks.reverse();
  assert.match(judgeV72(j).detail, /task 0 AC\.L1-3\.1\.1 vs PS\.L2-3\.9\.2, field id/);
});

test('V72: key order inside a projection is not a difference', () => {
  const i = ok();
  i.e6.tasks[1].sub_commands[0] = Object.fromEntries(Object.entries(i.e6.tasks[1].sub_commands[0]).reverse());
  i.gui.variables = Object.fromEntries(Object.entries(i.gui.variables).reverse());
  assert.equal(judgeV72(i).pass, true, judgeV72(i).detail);
  assert.equal(firstProjectionDiff(projection(), projection()), null);
});

test('V72: not S1 passes "not checked"; a translate error, no projection or no E6 plan fails', () => {
  for (const slug of ['s2-eng', 's3-def', 'muster-partial']) {
    const r = judgeV72({ slug });
    assert.equal(r.pass, true);
    assert.equal(r.detail, `not S1 (${slug}): not checked`);
  }
  assert.deepEqual(judgeV72({ slug: SLUG, error: 'no pushed MP / TM' }), { pass: false, detail: 'in-process translate failed: no pushed MP / TM' });
  assert.equal(judgeV72({ slug: SLUG }).detail, 'no in-process projection');
  assert.equal(judgeV72({ ...ok(), e6: null }).detail, 'no out/executable-plan.json (E6)');
});

test('verify.mjs V72 block: built Stamper dist, both modes in process, IM unset in cli mode, judge wired', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  const block = src.slice(src.indexOf('// ---------- W8: V72'), src.indexOf("check('V72'") + 400);
  assert.ok(block.includes("check('V72'"), 'no V72 check');
  assert.match(block, /'ces-stamper', 'dist', 'translators', 'translateForTenant\.js'/);
  assert.match(block, /project\('cli', \{\}\)/);
  assert.match(block, /project\('gui', pIM \? \{ infraManifestPath: pIM \} : \{\}\)/);
  assert.match(block, /stx\.projectExecutablePlan\(exePlan\)/);
  assert.match(block, /w4mod\.judgeV72\(/);
  assert.doesNotMatch(block, /spawn|fetch\(|startStamperServer/);
});
