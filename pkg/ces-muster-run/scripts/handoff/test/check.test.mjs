import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generate } from '../gen.mjs';
import { runChecks, toJsRegex, loadIdentityPatterns, versionOnLine } from '../check.mjs';
import { makeFixture, gitStub, write, SCHEMA, SHA_A } from './fixture.mjs';

function writeGenerated(kit) {
  const { outputs, errors } = generate(kit);
  assert.deepEqual(errors, []);
  for (const [n, c] of Object.entries(outputs)) fs.writeFileSync(path.join(kit, n), c);
}
const run = (fx, extra = {}) => runChecks({ kit: fx.kit, workspace: fx.ws, pkg: fx.pkg, tokens: null, username: '', git: gitStub, ...extra });
const byId = (res, id) => res.results.find((r) => r.id === id);

test('a clean fixture passes every check', () => {
  const fx = makeFixture();
  writeGenerated(fx.kit);
  const res = run(fx);
  for (const r of res.results) assert.equal(r.status, 'pass', `${r.id}: ${[...r.fails, ...r.warns].join('; ')}`);
  assert.equal(res.ok, true);
});

test('schema missing: (c), (d) and (e) report "schema missing" and nothing crashes', () => {
  const fx = makeFixture({ schema: false });
  writeGenerated(fx.kit);
  const res = run(fx);
  assert.equal(res.ok, false);
  for (const id of ['c', 'd', 'e']) assert.ok(byId(res, id).fails.some((m) => m.includes('schema missing')), id);
  assert.equal(byId(res, 'a').status, 'pass');
  assert.equal(byId(res, 'f').status, 'pass');
});

test('(a) a workspace with no component, a missing package dep and a pinned commit mismatch fail', () => {
  const fx = makeFixture();
  writeGenerated(fx.kit);
  const pj = JSON.parse(fs.readFileSync(path.join(fx.ws, 'package.json'), 'utf8'));
  pj.workspaces.push('ces-new');
  fs.writeFileSync(path.join(fx.ws, 'package.json'), JSON.stringify(pj));
  write(path.join(fx.ws, 'ces-shared', 'package.json'), JSON.stringify({ name: 'ces-shared', dependencies: { 'ces-eo': '*' } }));
  const res = run(fx, { only: ['a'] });
  const a = byId(res, 'a');
  assert.ok(a.fails.some((m) => m.includes('workspace "ces-new"')));
  assert.ok(a.fails.some((m) => m.includes('ces-shared: package.json dependencies names ces-eo')));
  const head = run(fx, { only: ['a'], git: () => 'c'.repeat(40) });
  assert.ok(byId(head, 'a').warns.some((m) => m.includes('draft release: warning only')));
});

test('(a) a nested repo without a component fails', () => {
  const fx = makeFixture();
  write(path.join(fx.ws, 'ces-tester', '.git'), 'gitdir: x\n');
  const a = byId(run(fx, { only: ['a'] }), 'a');
  assert.ok(a.fails.some((m) => m.includes('nested repo "ces-tester"')));
});

test('(b) a changed or moved version constant fails', () => {
  const fx = makeFixture();
  write(path.join(fx.ws, 'ces-shared', 'src', 'plan.ts'), "// db\nexport const PLAN_VERSION = '1.1.0';\n");
  assert.ok(byId(run(fx, { only: ['b'] }), 'b').fails.some((m) => m.includes('version 1.0.0 not found')));
  write(path.join(fx.ws, 'ces-shared', 'src', 'plan.ts'), "// db\n// moved\nexport const PLAN_VERSION = '1.0.0';\n");
  assert.ok(byId(run(fx, { only: ['b'] }), 'b').fails.some((m) => m.includes('found on line 3')));
});

test('version matching is bounded', () => {
  assert.ok(versionOnLine("export const V = '1.0.0';", '1.0.0'));
  assert.ok(!versionOnLine("export const V = '11.0.0';", '1.0.0'));
  assert.ok(!versionOnLine("export const V = '1.0.01';", '1.0.0'));
  assert.ok(versionOnLine("const S = 'x/thing@1' as const;", '1'));
});

test('(c) code-only and schema-only CES_* names fail; tests, labels and deletes are ignored', () => {
  const fx = makeFixture();
  write(path.join(fx.ws, 'ces-eo', 'src', 'extra.ps1'), '$x = $env:CES_NEW_THING\n');
  const schema = SCHEMA + `  - name: CES_DROPPED
    component: [ces-eo]
    required: false
    default: null
    allowed: "x"
    secret: false
    owner: operator
    scope: all
    description: "Nobody reads this."
    source: "ces-eo/src/index.ts:1"
`;
  fs.writeFileSync(path.join(fx.kit, 'config.schema.yaml'), schema);
  const c = byId(run(fx, { only: ['c'] }), 'c');
  assert.ok(c.fails.some((m) => m.startsWith('CES_NEW_THING is read in code')));
  assert.ok(c.fails.some((m) => m.startsWith('CES_DROPPED is in config.schema.yaml')));
  assert.ok(!c.fails.some((m) => /CES_TEST_ONLY|CES_PRODUCED|CES_GONE/.test(m)));
});

test('(d) a hand-edited generated file fails', () => {
  const fx = makeFixture();
  writeGenerated(fx.kit);
  fs.appendFileSync(path.join(fx.kit, 'BUILD-ORDER.md'), '\nhand edit\n');
  assert.ok(byId(run(fx, { only: ['d'] }), 'd').fails.some((m) => m.includes('BUILD-ORDER.md is out of date')));
});

test('(d) CRLF line endings are not drift', () => {
  const fx = makeFixture();
  writeGenerated(fx.kit);
  const f = path.join(fx.kit, 'README.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(byId(run(fx, { only: ['d'] }), 'd').status, 'pass');
});

test('(e) a schema secret missing from the inventory fails; inventory missing fails', () => {
  const fx = makeFixture({ inventory: 'schemaVersion: 1\nsecrets: []\n' });
  assert.ok(byId(run(fx, { only: ['e'] }), 'e').fails.some((m) => m.includes('CES_EO_AUTH_TOKEN is secret')));
  const fx2 = makeFixture({ inventory: false });
  assert.ok(byId(run(fx2, { only: ['e'] }), 'e').fails.some((m) => m.includes('inventory missing')));
});

test('(f) identity strings, banned tokens and secret values in the kit fail without echoing them', () => {
  const fx = makeFixture();
  writeGenerated(fx.kit);
  write(path.join(fx.kit, 'RUNBOOK.md'), 'logs are in C:\\Users\\someone\\x\nmail ops@example-corp.test\n');
  write(path.join(fx.kit, 'notes.md'), 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmNkZWYifQ.c2lnbmF0dXJl\n');
  write(path.join(fx.kit, '.env.example'), fs.readFileSync(path.join(fx.kit, '.env.example'), 'utf8').replace('CES_EO_AUTH_TOKEN=', 'CES_EO_AUTH_TOKEN=abc'));
  const tokens = path.join(fx.root, 'tokens.txt');
  write(tokens, '# names\n(?i)jane\\s+roe\n');
  write(path.join(fx.kit, 'ACCEPTANCE.md'), 'signed: Jane Roe\n');
  const f = byId(run(fx, { only: ['f'], tokens }), 'f');
  const all = f.fails.join('\n');
  assert.match(all, /RUNBOOK\.md:1 identity pattern 1/);
  assert.match(all, /RUNBOOK\.md:2 identity pattern 2/);
  assert.match(all, /notes\.md:1 looks like a secret value \(JWT\)/);
  assert.match(all, /\.env\.example:\d+ secret CES_EO_AUTH_TOKEN has a value/);
  assert.match(all, /ACCEPTANCE\.md:1 banned token 1/);
  assert.doesNotMatch(all, /someone|example-corp|Jane|eyJ/);
});

test('(f) the username token is case-insensitive', () => {
  const fx = makeFixture();
  writeGenerated(fx.kit);
  write(path.join(fx.kit, 'x.md'), 'owner: SOMEUSER\n');
  const f = byId(run(fx, { only: ['f'], username: 'someuser' }), 'f');
  assert.ok(f.fails.some((m) => m.includes('x.md:1 banned token')));
});

test('identity patterns load from identity-scan.ps1 and convert .NET inline flags', () => {
  const fx = makeFixture();
  const pats = loadIdentityPatterns(path.join(fx.pkg, 'scripts', 'identity-scan.ps1'));
  assert.equal(pats.length, 3);
  const re = toJsRegex(pats[0]);
  assert.ok(re.flags.includes('i'));
  assert.ok(re.test('c:\\users\\x'));
  assert.ok(toJsRegex('(?m)^Author: ').flags.includes('m'));
});

test('the identity pattern block of the real identity-scan.ps1 loads', () => {
  const real = path.resolve(import.meta.dirname, '..', '..', 'identity-scan.ps1');
  if (!fs.existsSync(real)) return;
  const pats = loadIdentityPatterns(real);
  assert.ok(pats.length >= 5);
  for (const p of pats) toJsRegex(p);
});

void SHA_A;

// H1 (2026-11-01): contractor monorepo. No git per module folder; check (a) reads <root>/SOURCES.json instead.
test('monorepo: check (a) compares commits with SOURCES.json; a pinned mismatch fails', async () => {
  const { headReader, readSources } = await import('../check.mjs');
  const { SHA_B: B } = await import('./fixture.mjs');
  const fx = makeFixture({ manifest: (await import('./fixture.mjs')).MANIFEST.replace('status: draft', 'status: pinned') });
  writeGenerated(fx.kit);
  assert.equal(readSources(fx.ws), null);
  assert.equal(headReader(fx.ws, fx.pkg).source, 'git');
  const sources = { schemaVersion: 1, repos: [{ repo: 'ces-mono', commit: SHA_A, path: 'ces/' }, { repo: 'ces-tenant', commit: B, path: 'ces/ces-tenant/' }] };
  write(path.join(fx.root, 'SOURCES.json'), JSON.stringify(sources));
  const h = headReader(fx.ws, fx.pkg);
  assert.equal(h.source, 'SOURCES.json');
  assert.equal(h.read(path.join(fx.ws, 'ces-tenant')), B);
  assert.equal(h.read(fx.ws), SHA_A);
  let res = runChecks({ kit: fx.kit, workspace: fx.ws, pkg: fx.pkg, tokens: null, username: '', only: ['a'] });
  assert.equal(byId(res, 'a').status, 'pass', byId(res, 'a').fails.join('; '));
  assert.ok(byId(res, 'a').notes.some((n) => n.includes('SOURCES.json')));
  sources.repos[1].commit = SHA_A;
  write(path.join(fx.root, 'SOURCES.json'), JSON.stringify(sources));
  res = runChecks({ kit: fx.kit, workspace: fx.ws, pkg: fx.pkg, tokens: null, username: '', only: ['a'] });
  assert.ok(byId(res, 'a').fails.some((m) => m.includes('ces-tenant: manifest commit')));
});
