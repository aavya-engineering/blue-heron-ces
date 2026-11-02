import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { buildMonorepo, parseArgs, loadAllow, zipEntries, GITIGNORE } from '../build-monorepo.mjs';
import { pinManifestText, pinsFromSources } from '../pin-manifest.mjs';
import { DEFAULT_PKG } from '../check.mjs';

// Fixture git runs with no global or system config and a neutral identity, so nothing from this machine leaks in.
const NULL_CFG = path.join(os.tmpdir(), `bm-null-gitconfig-${process.pid}`);
fs.writeFileSync(NULL_CFG, '');
const ROOTS = [];
after(() => { for (const r of ROOTS) fs.rmSync(r, { recursive: true, force: true }); fs.rmSync(NULL_CFG, { force: true }); });
const GENV = {
  ...process.env, GIT_CONFIG_GLOBAL: NULL_CFG, GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture Bot', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture Bot', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: GENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function repo(dir, files, msg = 'init') {
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) git(dir, 'init', '-q', '-b', 'main');
  for (const [p, c] of Object.entries(files)) write(path.join(dir, p), c);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}
const MANIFEST = (c = 'HEAD-at-cut') => `schemaVersion: 1
release: { id: "fx", cut: "2026-11-01", status: draft }
components:
  - id: ces-shared
    repo: ces-mono
    path: ces-shared
    commit: "${c}"
    kind: library
  - id: ces-muster
    repo: ces-muster
    path: "."
    commit: "${c}"   # trailing comment stays
    kind: ui
`;

/** Root with ces (ces-mono) + four nested repos + pkg/ces-muster-run, all on branch main; plus a kit folder. */
function makeFx({ tester = {}, testerMsg } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-fx-'));
  ROOTS.push(root);
  const ces = path.join(root, 'ces');
  repo(ces, {
    '.gitignore': 'ces-muster/\nces-tester/\ntenant-stacksim/\nces-tenant/\n.env\n',
    'package.json': '{ "name": "ces-mono" }\n',
    'ces-shared/index.js': 'export const x = 1;\n',
  });
  write(path.join(ces, 'scratch-untracked.txt'), 'not tracked\n');
  write(path.join(ces, '.env'), 'IGNORED=1\n');
  repo(path.join(ces, 'ces-muster'), { 'README.md': '# muster\n' });
  repo(path.join(ces, 'ces-tester'), { 'src/a.ts': 'export {};\n', 'fixtures/out/x.txt': 'tracked under a folder named out\n', '.env.example': 'CES_X=\n', ...tester }, testerMsg);
  repo(path.join(ces, 'tenant-stacksim'), { 'src/sim.ts': 'export {};\n' });
  const t1 = repo(path.join(ces, 'ces-tenant'), { 'a.txt': 'one\n' });
  const t2 = repo(path.join(ces, 'ces-tenant'), { 'b.txt': 'two\n' }, 'second');
  repo(path.join(root, 'pkg', 'ces-muster-run'), { 'scripts/run.mjs': '// run\n', 'handoff/OLD.md': 'old kit\n' });
  const kit = path.join(root, 'kit');
  write(path.join(kit, 'README.md'), '# kit\n');
  write(path.join(kit, '.env.example'), 'CES_X=\n');
  write(path.join(kit, 'START-HERE.md'), '# Start here\n');
  write(path.join(kit, 'handoff.manifest.yaml'), MANIFEST());
  const tokens = path.join(root, 'tokens.txt');
  write(tokens, '# fixture banned names\n(?i)\\bzebulon\\b\n');
  const out = path.join(root, 'out-tree');
  return { root, ces, kit, tokens, out, t1, t2 };
}
const opts = (fx, extra = {}) => ({
  root: fx.root, kit: fx.kit, tokens: fx.tokens, out: fx.out, username: '', allow: path.join(fx.root, 'no-allow.json'),
  identityPs1: path.join(DEFAULT_PKG, 'scripts', 'identity-scan.ps1'), refs: { 'ces-mono': 'main', 'ces-muster': 'main', 'ces-tester': 'main', 'tenant-stacksim': 'main', 'ces-tenant': 'main', 'ces-muster-run': 'main' },
  ...extra,
});
const files = (dir) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(dir, p).split(path.sep).join('/')); } };
  walk(dir);
  return out.sort();
};

test('no-commit build: layout, provenance, only tracked files, kit at the root, no git repo', () => {
  const fx = makeFx();
  const rep = buildMonorepo(opts(fx, { mode: 'no-commit' }));
  assert.equal(rep.ok, true, rep.errors.join('; '));
  assert.deepEqual(files(fx.out), [
    '.gitignore', 'SOURCES.json', 'START-HERE.md',
    'ces/.gitignore', 'ces/ces-muster/README.md', 'ces/ces-shared/index.js', 'ces/ces-tenant/a.txt', 'ces/ces-tenant/b.txt',
    'ces/ces-tester/.env.example', 'ces/ces-tester/fixtures/out/x.txt', 'ces/ces-tester/src/a.ts', 'ces/package.json',
    'ces/tenant-stacksim/src/sim.ts', 'handoff/.env.example', 'handoff/README.md', 'handoff/handoff.manifest.yaml', 'pkg/ces-muster-run/scripts/run.mjs',
  ].sort());
  assert.equal(fs.existsSync(path.join(fx.out, '.git')), false);
  assert.equal(fs.readFileSync(path.join(fx.out, '.gitignore'), 'utf8'), GITIGNORE);
  assert.ok(GITIGNORE.split('\n').includes('/pl/'), 'PL-125 / CR-21: the harness pipeline root <Root>/pl is ignored');
  const src = JSON.parse(fs.readFileSync(path.join(fx.out, 'SOURCES.json'), 'utf8'));
  assert.equal(src.repos.length, 6);
  assert.equal(src.repos.find((r) => r.repo === 'ces-tenant').commit, fx.t2);
  assert.deepEqual(src.repos.find((r) => r.repo === 'ces-muster-run').excluded, ['handoff/']);
  assert.ok(src.kit.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  // No local path of the build host anywhere in the provenance file.
  assert.ok(!JSON.stringify(src).includes(os.tmpdir().split(path.sep).join('/')) && !JSON.stringify(src).includes(fx.root.replace(/\\/g, '\\\\')));
  assert.equal(rep.hits.length, 0);
  assert.ok(rep.warnings.some((w) => w.includes('manifest pins for ces-mono')), 'unpinned manifest is a warning in no-commit mode');
});

test('dry-run writes nothing', () => {
  const fx = makeFx();
  const rep = buildMonorepo(opts(fx, { mode: 'dry-run' }));
  assert.equal(rep.ok, true, rep.errors.join('; '));
  assert.equal(fs.existsSync(fx.out), false);
  assert.equal(rep.plannedFiles, 11);
});

test('commit mode: pinned manifest, one commit with the given author, nothing lost to .gitignore', () => {
  const fx = makeFx();
  // Pin the fixture manifest from a no-commit build's SOURCES.json, as the skill does.
  const pre = buildMonorepo(opts(fx, { mode: 'no-commit', out: path.join(fx.root, 'pre') }));
  assert.equal(pre.ok, true, pre.errors.join('; '));
  const mf = path.join(fx.kit, 'handoff.manifest.yaml');
  const pinned = pinManifestText(fs.readFileSync(mf, 'utf8'), pinsFromSources(path.join(fx.root, 'pre', 'SOURCES.json')), { status: 'pinned' });
  assert.equal(pinned.changed.length, 3);
  assert.match(pinned.text, /commit: "[0-9a-f]{40}"   # trailing comment stays/);
  fs.writeFileSync(mf, pinned.text);
  const rep = buildMonorepo(opts(fx, { mode: 'commit', author: 'CES Release <release@example.invalid>' }));
  assert.equal(rep.ok, true, rep.errors.join('; '));
  assert.equal(git(fx.out, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(fx.out, 'log', '-1', '--format=%an <%ae>|%cn <%ce>'), 'CES Release <release@example.invalid>|CES Release <release@example.invalid>');
  const tracked = git(fx.out, 'ls-files').split('\n');
  assert.equal(tracked.length, files(fx.out).length);
  assert.ok(tracked.includes('ces/ces-tester/fixtures/out/x.txt'));
  assert.ok(tracked.includes('handoff/.env.example'));
});

test('commit mode refuses without an explicit identity and with an unpinned manifest', () => {
  const fx = makeFx();
  const saved = {};
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL']) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    const rep = buildMonorepo(opts(fx, { mode: 'commit' }));
    assert.equal(rep.ok, false);
    assert.ok(rep.errors.some((e) => e.includes('no commit identity')));
    assert.ok(rep.errors.some((e) => e.includes('manifest pins for ces-mono')));
    assert.equal(fs.existsSync(fx.out), false);
  } finally { for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v; }
});

test('identity hit fails with file:line and can never be allow-listed', () => {
  const fx = makeFx({ tester: { 'docs/notes.md': 'line one\nwritten by Zebulon\n' } });
  const rep = buildMonorepo(opts(fx, { mode: 'no-commit' }));
  assert.equal(rep.ok, false);
  const h = rep.hits.find((x) => x.kind === 'identity');
  assert.equal(`${h.file}:${h.line}`, 'ces/ces-tester/docs/notes.md:2');
  assert.ok(!JSON.stringify(rep).includes('Zebulon'), 'the matched text is never echoed');
  const allow = path.join(fx.root, 'allow.json');
  write(allow, JSON.stringify({ allow: [{ path: 'ces/ces-tester/docs/notes.md', rule: 'token 1', reason: 'trying to allow a banned name' }] }));
  assert.ok(loadAllow(allow).errors[0].includes('identity hits can never be allow-listed'));
});

test('secret hits fail; an allow-list entry with a reason clears one; key files fail by name', () => {
  const pem = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
  const fx = makeFx({ tester: { 'tests/fx/key.txt': `${pem}\nAAAA\n`, 'certs/dev.pfx': 'x' } });
  const rep = buildMonorepo(opts(fx, { mode: 'no-commit' }));
  assert.equal(rep.ok, false);
  assert.ok(rep.hits.some((h) => h.file === 'ces/ces-tester/tests/fx/key.txt' && h.line === 1 && h.rule === 'private key block'));
  assert.ok(rep.hits.some((h) => h.file === 'ces/ces-tester/certs/dev.pfx' && h.rule === 'key or certificate file'));
  const allow = path.join(fx.root, 'allow.json');
  write(allow, JSON.stringify({ allow: [
    { path: 'ces/ces-tester/tests/**', rule: 'private key block', reason: 'made-up key header in a parser test fixture' },
    { path: 'ces/ces-tester/certs/*.pfx', rule: 'key or certificate file', reason: 'one-byte placeholder, not a certificate' },
  ] }));
  const rep2 = buildMonorepo(opts(fx, { mode: 'no-commit', out: path.join(fx.root, 'out2'), allow }));
  assert.equal(rep2.ok, true, rep2.errors.join('; '));
  assert.equal(rep2.hits.filter((h) => h.allowed).length, 2);
});

test('--ref pins an older commit; --exclude leaves a tracked path out with its reason', () => {
  const fx = makeFx();
  const ex = path.join(fx.root, 'exclude.json');
  write(ex, JSON.stringify({ exclude: [{ path: 'ces/ces-tester/fixtures/**', reason: 'old run captures, not needed' }] }));
  const o = opts(fx, { mode: 'no-commit', exclude: ex });
  o.refs['ces-tenant'] = fx.t1;
  const rep = buildMonorepo(o);
  assert.equal(rep.ok, true, rep.errors.join('; '));
  assert.ok(fs.existsSync(path.join(fx.out, 'ces/ces-tenant/a.txt')));
  assert.equal(fs.existsSync(path.join(fx.out, 'ces/ces-tenant/b.txt')), false);
  assert.equal(fs.existsSync(path.join(fx.out, 'ces/ces-tester/fixtures/out/x.txt')), false);
  const src = JSON.parse(fs.readFileSync(path.join(fx.out, 'SOURCES.json'), 'utf8'));
  assert.deepEqual(src.repos.find((r) => r.repo === 'ces-tester').leftOut, ['ces/ces-tester/fixtures/out/x.txt']);
  assert.equal(src.leftOutRules[0].files, 1);
});

/** Tiny zip writer for the test (deflated entries). */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = zlib.deflateRawSync(Buffer.from(text));
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(text.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(text.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, data); central.push(ch, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(entries).length, 8); e.writeUInt16LE(Object.keys(entries).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

test('Office files are opened: a name split across XML runs is still found', () => {
  const docx = makeZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:p><w:r><w:t>Zeb</w:t></w:r><w:r><w:t>ulon</w:t></w:r></w:p>' });
  assert.deepEqual([...zipEntries(docx)].map((e) => e.name), ['[Content_Types].xml', 'word/document.xml']);
  const fx = makeFx({ tester: { 'demos/deck.docx': docx } });
  const rep = buildMonorepo(opts(fx, { mode: 'no-commit' }));
  assert.equal(rep.ok, false);
  assert.ok(rep.hits.some((h) => h.file === 'ces/ces-tester/demos/deck.docx!word/document.xml' && h.kind === 'identity' && h.rule.endsWith('(text runs)')));
});

test('parseArgs: modes, repo=value options and usage errors', () => {
  const o = parseArgs(['--out', 'x', '--no-commit', '--ref', 'ces-mono=abc', '--repo', 'ces-tenant=y']);
  assert.equal(o.mode, 'no-commit');
  assert.equal(o.refs['ces-mono'], 'abc');
  assert.equal(parseArgs(['--out', 'x', '--dry-run', '--no-commit']).mode, 'dry-run');
  assert.throws(() => parseArgs(['--ref', 'nope=1', '--out', 'x']), /expects <repo>=<value>/);
  assert.throws(() => parseArgs([]), /--out <dir> is required/);
});

test('pinManifestText: lists components whose repo has no pin and keeps CRLF', () => {
  const text = MANIFEST().replace(/\n/g, '\r\n');
  const r = pinManifestText(text, { 'ces-mono': 'c'.repeat(40) });
  assert.deepEqual(r.changed.map((c) => c.id), ['ces-shared']);
  assert.deepEqual(r.unknown, ['ces-muster']);
  assert.ok(r.text.includes(`commit: "${'c'.repeat(40)}"\r\n`));
});
