#!/usr/bin/env node
// CES handoff kit drift check.
//   node scripts/handoff/check.mjs [--kit <dir>] [--workspace <ces-mono root>] [--pkg <run package>]
//                                  [--tokens <file>] [--only a,b,...] [--json]
// Checks:
//   (a) manifest components vs the root package.json workspaces, the nested repos and package.json deps
//   (b) contract versions vs the version constants in code (contracts.yaml `source` lines)
//   (c) every CES_* name read in non-test code is in config.schema.yaml, and vice versa
//   (d) generated files (README.md, BUILD-ORDER.md, handoff.manifest.json, .env.example) are current
//   (e) every secret in config.schema.yaml is in secrets.inventory.yaml
//   (f) no secret value and no identity string anywhere in the kit
// Exit 0 = no failures (warnings allowed); 1 = drift or a missing input (e.g. "schema missing").
// Hits in (f) print file, line and pattern number only, never the matched text.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile, generate, FILES, DEFAULT_KIT } from './gen.mjs';
import { validateManifest, validateContracts, validateConfigSchema, validateInventory, UNVERSIONED, SHA } from './lib/validate.mjs';
import { REPO_INFO } from './lib/kitdata.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PKG = path.resolve(HERE, '..', '..');
// The run package sits at <root>/pkg/ces-muster-run and the workspace at <root>/ces.
export const DEFAULT_WORKSPACE = path.resolve(DEFAULT_PKG, '..', '..', 'ces');

// Scan scope matches K2's method (LOG-K2.md "Method") so check (c) and config.schema.yaml agree.
const CODE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.ps1', '.psm1', '.sh', '.py']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'tests', 'test', '__tests__', 'e2e', 'fixtures', 'spec', '.worktrees', 'playwright-report', 'test-results', '.vite', '.next', 'runs', 'build', 'out', 'vendor']);
const TEST_FILE = /\.(test|spec)\.[^.]+$|\.d\.ts$/;
// A CES_* name counts as read when it is accessed on an env object (process.env.X, env['X'],
// secretEnv()['X'], ...), written as a whole quoted string ('X', "X", `X`) or read with $env:X.
// `delete env.X` only removes X from a child environment, so it is not a read.
export const ENV_READ_RE = /(?<!delete\s+[A-Za-z_.]*)(?:process\.env|\b[A-Za-z_]*[eE]nv(?:\(\))?)(?:\??\.|\[\s*['"`])(CES_[A-Z0-9_]+)|['"`](CES_[A-Z0-9_]+)['"`]|\$\{?env:(CES_[A-Z0-9_]+)/g;

// CES_* strings in code that are labels, not settings (LOG-K2.md "Left out of the schema").
// Check (c) ignores exactly these names; add one here only with the reason.
export const NOT_SETTINGS = new Map([
  ['CES_PRODUCED', 'control-disposition label in tenant-tests/run.ps1'],
  ['CES_READINESS_POSTURE', 'artifact type name in Muster and EO'],
  ['CES_RR_QUESTION_SET', 'artifact type name in Muster and EO'],
  ['CES_MUSTER_API_URL', 'ces-tester only deletes it from Stamper\'s child environment and asserts it is gone; nothing reads it (results flow retired)'],
]);

const result = (id, title) => ({ id, title, status: 'pass', fails: [], warns: [], notes: [] });
const fail = (r, m) => { r.fails.push(m); r.status = 'fail'; };
const warn = (r, m) => { r.warns.push(m); if (r.status === 'pass') r.status = 'warn'; };
const rel = (base, p) => path.relative(base, p).split(path.sep).join('/');

function loadInputs(kit) {
  const out = {};
  const m = readYamlFile(path.join(kit, FILES.manifest));
  out.manifestErr = m.missing ? `${FILES.manifest} missing` : m.error;
  if (!out.manifestErr) {
    const v = validateManifest(m.doc);
    if (v.errors.length) out.manifestErr = `${FILES.manifest} invalid: ${v.errors.join('; ')}`;
    else out.manifest = m.doc;
  }
  const ids = out.manifest ? new Set(out.manifest.components.map((c) => c.id)) : null;
  const k = readYamlFile(path.join(kit, FILES.contracts));
  out.contractsErr = k.missing ? `${FILES.contracts} missing` : k.error;
  if (!out.contractsErr) {
    const v = validateContracts(k.doc, ids);
    if (v.errors.length) out.contractsErr = `${FILES.contracts} invalid: ${v.errors.join('; ')}`;
    else out.contracts = k.doc;
  }
  const s = readYamlFile(path.join(kit, FILES.schema));
  out.schemaMissing = !!s.missing;
  out.schemaErr = s.missing ? 'schema missing' : s.error;
  if (!out.schemaErr) {
    const v = validateConfigSchema(s.doc, ids);
    out.schemaWarnings = v.warnings;
    if (v.errors.length) out.schemaErr = `${FILES.schema} invalid: ${v.errors.join('; ')}`;
    else out.schema = s.doc;
  }
  const inv = readYamlFile(path.join(kit, FILES.inventory));
  out.inventoryErr = inv.missing ? 'inventory missing' : inv.error;
  if (!out.inventoryErr) {
    const v = validateInventory(inv.doc, ids);
    out.inventoryWarnings = v.warnings;
    if (v.errors.length) out.inventoryErr = `${FILES.inventory} invalid: ${v.errors.join('; ')}`;
    else out.inventory = inv.doc;
  }
  return out;
}

export function repoDir(ws, pkg, repo) {
  const info = REPO_INFO[repo];
  if (!info) return null;
  return info.dir === null ? pkg : path.join(ws, info.dir);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function gitHead(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * Contractor monorepo (H1, 2026-11-01): the module repos are plain folders in one git repo, so `git rev-parse` in a
 * nested folder returns the monorepo commit. build-monorepo.mjs records each folder's source commit in
 * <root>/SOURCES.json ({ repos: [{ repo, commit, path }] }); when that file sits next to the workspace, check (a)
 * compares the manifest commits with it instead of git. Returns a Map repo id -> commit, or null when absent.
 */
export function readSources(ws) {
  const doc = readJson(path.resolve(ws, '..', 'SOURCES.json'));
  if (!doc || !Array.isArray(doc.repos)) return null;
  const m = new Map();
  for (const e of doc.repos) if (e && typeof e.repo === 'string' && typeof e.commit === 'string') m.set(e.repo, e.commit);
  return m;
}

/** A HEAD reader for check (a): SOURCES.json when present (monorepo), else git in the repo folder. */
export function headReader(ws, pkg) {
  const sources = readSources(ws);
  if (!sources) return { source: 'git', read: gitHead };
  const byDir = new Map(Object.keys(REPO_INFO).map((id) => [path.resolve(repoDir(ws, pkg, id) ?? ''), id]));
  return { source: 'SOURCES.json', read: (dir) => sources.get(byDir.get(path.resolve(dir))) ?? null };
}

function expandWorkspaces(ws, patterns) {
  const out = [];
  for (const p of patterns ?? []) {
    const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
    if (norm.endsWith('/*')) {
      const base = norm.slice(0, -2);
      const dir = path.join(ws, base);
      if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'package.json'))) out.push(`${base}/${e.name}`);
    } else out.push(norm);
  }
  return out;
}

// ---- (a) ----
export function checkComponents({ ws, pkg, manifest, git = gitHead }) {
  const r = result('a', 'components vs workspaces, nested repos and package deps');
  const rootPkg = readJson(path.join(ws, 'package.json'));
  if (!rootPkg) { fail(r, `workspace root package.json not found in ${ws}`); return r; }
  const comps = manifest.components;
  const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/\/+$/, '') || '.';
  for (const w of expandWorkspaces(ws, rootPkg.workspaces)) {
    if (!comps.some((c) => c.repo === 'ces-mono' && norm(c.path) === norm(w))) fail(r, `workspace "${w}" has no manifest component (repo ces-mono, path ${w})`);
  }
  const nested = fs.readdirSync(ws, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(ws, e.name, '.git')));
  for (const e of nested) {
    const repo = Object.keys(REPO_INFO).find((k) => REPO_INFO[k].dir === e.name);
    if (!repo) { fail(r, `nested repo folder "${e.name}" is not a known repo id`); continue; }
    if (!comps.some((c) => c.repo === repo)) fail(r, `nested repo "${repo}" (${e.name}/) has no manifest component`);
  }
  const nameToId = new Map();
  const pkgs = new Map();
  for (const c of comps) {
    const rd = repoDir(ws, pkg, c.repo);
    if (!rd || !fs.existsSync(rd)) { fail(r, `${c.id}: repo folder for "${c.repo}" not found`); continue; }
    const pj = readJson(path.join(rd, c.path, 'package.json'));
    if (!pj) { fail(r, `${c.id}: no package.json at ${rel(ws, path.join(rd, c.path))}`); continue; }
    pkgs.set(c.id, pj);
    if (pj.name) nameToId.set(pj.name, c.id);
    const wm = /(?:^|\s)-w\s+(\S+)/.exec(c.build);
    if (wm && wm[1] !== pj.name) fail(r, `${c.id}: build uses -w ${wm[1]} but package.json name is "${pj.name}"`);
    if (c.repo !== 'ces-mono' && c.cwd) {
      const cwdAbs = path.join(ws, c.cwd);
      if (path.resolve(cwdAbs) !== path.resolve(rd, c.path)) warn(r, `${c.id}: cwd ${c.cwd} is not the component folder`);
    }
    if (c.commit !== 'HEAD-at-cut') {
      const head = git(rd);
      if (!head) warn(r, `${c.id}: could not read the HEAD of ${c.repo}`);
      else if (head !== c.commit) {
        const msg = `${c.id}: manifest commit ${c.commit.slice(0, 12)} but ${c.repo} HEAD is ${head.slice(0, 12)}`;
        if (manifest.release.status === 'pinned') fail(r, msg);
        else warn(r, `${msg} (draft release: warning only)`);
      }
    } else if (manifest.release.status === 'pinned') fail(r, `${c.id}: a pinned release needs a commit sha, not HEAD-at-cut`);
    if (c.commit !== 'HEAD-at-cut' && !SHA.test(c.commit)) fail(r, `${c.id}: commit is not a sha`);
  }
  for (const c of comps) {
    const pj = pkgs.get(c.id);
    if (!pj) continue;
    const declared = new Set(c.deps ?? []);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const n of Object.keys(pj[field] ?? {})) {
        const id = nameToId.get(n);
        if (id && id !== c.id && !declared.has(id)) fail(r, `${c.id}: package.json ${field} names ${n} (component ${id}) but manifest deps do not`);
      }
    }
  }
  r.notes.push(`${comps.length} components, ${nested.length} nested repos`);
  return r;
}

// ---- (b) ----
export function versionOnLine(line, version) {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![0-9A-Za-z.])${esc}(?![0-9.])`).test(line);
}

export function checkContracts({ ws, contracts }) {
  const r = result('b', 'contract versions vs code');
  for (const k of contracts.contracts) {
    const [file, lineStr] = [k.source.slice(0, k.source.lastIndexOf(':')), k.source.slice(k.source.lastIndexOf(':') + 1)];
    const abs = path.join(ws, file);
    if (!fs.existsSync(abs)) { fail(r, `${k.id}: source file ${file} not found`); continue; }
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    const n = Number(lineStr);
    if (!(n >= 1 && n <= lines.length)) { fail(r, `${k.id}: ${k.source} is past the end of the file`); continue; }
    if (k.version === UNVERSIONED) { r.notes.push(`${k.id}: unversioned (source line present, not compared)`); continue; }
    if (versionOnLine(lines[n - 1], k.version)) continue;
    const at = lines.findIndex((l) => versionOnLine(l, k.version));
    if (at >= 0) fail(r, `${k.id}: version ${k.version} is no longer on line ${n}; found on line ${at + 1} (update source)`);
    else fail(r, `${k.id}: version ${k.version} not found in ${file}; line ${n} now reads: ${lines[n - 1].trim().slice(0, 120)}`);
  }
  return r;
}

// ---- (c) ----
function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(p);
    } else if (e.isFile() && CODE_EXT.has(path.extname(e.name).toLowerCase()) && !TEST_FILE.test(e.name)) yield p;
  }
}

/** Map CES_* name -> first "file:line" where code reads it. roots: directories to walk. */
export function scanEnvReads(roots, base) {
  const found = new Map();
  const seen = new Set();
  for (const root of roots) {
    for (const f of walk(root)) {
      const key = path.resolve(f).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let text;
      try {
        if (fs.statSync(f).size > 4 * 1024 * 1024) continue;
        text = fs.readFileSync(f, 'utf8');
      } catch { continue; }
      if (!text.includes('CES_')) continue;
      const lines = text.split(/\r?\n/);
      lines.forEach((l, i) => {
        if (!l.includes('CES_')) return;
        for (const m of l.matchAll(ENV_READ_RE)) {
          const name = m[1] ?? m[2] ?? m[3];
          if (!NOT_SETTINGS.has(name) && !found.has(name)) found.set(name,`${rel(base, f)}:${i + 1}`);
        }
      });
    }
  }
  return found;
}

export function checkSettings({ ws, schema, schemaErr }) {
  const r = result('c', 'CES_* names in code vs config.schema.yaml');
  if (!schema) { fail(r, schemaErr ?? 'schema missing'); return r; }
  const found = scanEnvReads([ws], ws);
  const inSchema = new Map(schema.settings.map((s) => [s.name, s]));
  for (const [name, at] of [...found].sort()) if (!inSchema.has(name)) fail(r, `${name} is read in code (${at}) but not in ${FILES.schema}`);
  for (const s of schema.settings) {
    if (!s.name.startsWith('CES_')) continue;
    if (!found.has(s.name)) fail(r, `${s.name} is in ${FILES.schema} but no non-test code reads it`);
  }
  for (const s of schema.settings) {
    const i = s.source.lastIndexOf(':');
    const file = i > 0 ? s.source.slice(0, i) : s.source;
    const n = Number(s.source.slice(i + 1));
    const abs = path.join(ws, file);
    if (!fs.existsSync(abs)) { warn(r, `${s.name}: source ${s.source} not found`); continue; }
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    if (!(n >= 1 && n <= lines.length)) warn(r, `${s.name}: source line ${s.source} is past the end of the file`);
    // +/-3 lines, as K2 cites them; a read through a name constant (env[X_ENV]) may not show the name at all.
    else if (!lines.slice(Math.max(0, n - 4), n + 3).some((l) => l.includes(s.name))) warn(r, `${s.name}: no mention within 3 lines of ${s.source} (read through a name constant, or the line moved)`);
  }
  r.notes.push(`${found.size} CES_* names read in code; ${schema.settings.length} settings in the schema`);
  return r;
}

// ---- (d) ----
const normText = (s) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');
export function checkGenerated({ kit, schemaMissing }) {
  const r = result('d', 'generated files are current');
  const { outputs, errors } = generate(kit);
  if (errors.length) { for (const e of errors) fail(r, `cannot regenerate: ${e}`); return r; }
  for (const [name, want] of Object.entries(outputs)) {
    const file = path.join(kit, name);
    if (!fs.existsSync(file)) { fail(r, `${name} missing (run gen.mjs)`); continue; }
    if (normText(fs.readFileSync(file, 'utf8')) !== normText(want)) fail(r, `${name} is out of date (run gen.mjs)`);
  }
  if (schemaMissing) {
    fail(r, `schema missing: ${FILES.envExample} cannot be generated`);
    if (fs.existsSync(path.join(kit, FILES.envExample))) warn(r, `${FILES.envExample} exists but ${FILES.schema} does not`);
  }
  return r;
}

// ---- (e) ----
export function checkSecrets({ schema, schemaErr, inventory, inventoryErr }) {
  const r = result('e', 'schema secrets are in the inventory');
  if (!schema) fail(r, schemaErr ?? 'schema missing');
  if (!inventory) fail(r, inventoryErr ?? 'inventory missing');
  if (!schema || !inventory) return r;
  const inv = new Set(inventory.secrets.map((s) => s.name));
  const secrets = schema.settings.filter((s) => s.secret === true);
  for (const s of secrets) if (!inv.has(s.name)) fail(r, `${s.name} is secret in ${FILES.schema} but not in ${FILES.inventory}`);
  const names = new Set(schema.settings.map((s) => s.name));
  const extra = inventory.secrets.filter((s) => !names.has(s.name)).map((s) => s.name);
  if (extra.length) r.notes.push(`${extra.length} inventory entries are not settings (certificates, files or tokens with no env name): ${extra.join(', ')}`);
  r.notes.push(`${secrets.length} secret settings, ${inventory.secrets.length} inventory entries`);
  return r;
}

// ---- (f) ----
/** Read the identity regexes from identity-scan.ps1 (the `$patterns = @( ... ) + $Extra` block). */
export function loadIdentityPatterns(ps1) {
  const text = fs.readFileSync(ps1, 'utf8');
  const m = /\$patterns\s*=\s*@\(([\s\S]*?)\)\s*\+\s*\$Extra/.exec(text);
  if (!m) throw new Error('no $patterns block in identity-scan.ps1');
  const pats = [];
  for (const line of m[1].split(/\r?\n/)) {
    const q = /^\s*'((?:[^']|'')*)'/.exec(line);
    if (q) pats.push(q[1].replace(/''/g, "'"));
  }
  if (!pats.length) throw new Error('identity-scan.ps1 $patterns block is empty');
  return pats;
}

/** .NET-style pattern with leading inline flags, e.g. "(?i)abc" -> RegExp(/abc/gi). */
export function toJsRegex(p) {
  let flags = 'g';
  let src = p;
  const m = /^\(\?([imsx]+)\)/.exec(src);
  if (m) {
    src = src.slice(m[0].length);
    for (const f of m[1]) if ('ims'.includes(f) && !flags.includes(f)) flags += f;
  }
  return new RegExp(src, flags);
}

export const SECRET_PATTERNS = [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['Entra client secret', /\b[A-Za-z0-9_.-]{3}\dQ~[A-Za-z0-9_.~-]{31,34}/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['storage key or SAS', /(?:AccountKey=[A-Za-z0-9+/=]{20,}|[?&]sig=[A-Za-z0-9%+/=]{20,})/g],
  ['PFX/certificate blob', /\bMII[A-Za-z0-9+/]{60,}/g],
];

function* walkAll(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') yield* walkAll(p); } else if (e.isFile()) yield p;
  }
}

export function findTokenFile(ws) {
  let d = path.resolve(ws);
  for (let i = 0; i < 4; i++) {
    const f = path.join(d, 'nb-tools', 'scan-tokens.txt');
    if (fs.existsSync(f)) return f;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

export function loadTokens(file, { username = os.userInfo().username } = {}) {
  const pats = [];
  if (file && fs.existsSync(file)) {
    for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = l.trim();
      if (t && !t.startsWith('#')) pats.push(t);
    }
  }
  if (username && username.length >= 3) pats.push(`(?i)${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  return pats;
}

export function checkKitScan({ kit, pkg, tokensFile, schema, inventory, username }) {
  const r = result('f', 'no secret value or identity string in the kit');
  const ps1 = path.join(pkg, 'scripts', 'identity-scan.ps1');
  let identity;
  try {
    identity = loadIdentityPatterns(ps1).map(toJsRegex);
  } catch (e) {
    fail(r, `identity patterns unavailable (${rel(pkg, ps1)}): ${e.message}`);
    return r;
  }
  let tokens = [];
  try {
    tokens = loadTokens(tokensFile, username === undefined ? {} : { username }).map(toJsRegex);
  } catch (e) {
    fail(r, `token list unreadable: ${e.message}`);
  }
  const secretNames = new Set([
    ...(schema?.settings ?? []).filter((s) => s.secret === true).map((s) => s.name),
    ...(inventory?.secrets ?? []).map((s) => s.name),
  ]);
  let files = 0;
  for (const f of walkAll(kit)) {
    files++;
    const label = rel(kit, f);
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const lineOf = (idx) => text.slice(0, idx).split('\n').length;
    identity.forEach((re, i) => {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) fail(r, `${label}:${lineOf(m.index)} identity pattern ${i + 1}`);
    });
    tokens.forEach((re, i) => {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) fail(r, `${label}:${lineOf(m.index)} banned token ${i + 1}`);
    });
    for (const [what, re] of SECRET_PATTERNS) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) fail(r, `${label}:${lineOf(m.index)} looks like a secret value (${what})`);
    }
    if (path.basename(f).startsWith('.env')) {
      text.split(/\r?\n/).forEach((l, i) => {
        const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(l);
        if (m && secretNames.has(m[1]) && m[2].trim() !== '') fail(r, `${label}:${i + 1} secret ${m[1]} has a value`);
      });
    }
  }
  r.notes.push(`${files} files scanned; ${identity.length} identity patterns, ${tokens.length} banned tokens, ${SECRET_PATTERNS.length} secret patterns`);
  return r;
}

// ---- runner ----
export function runChecks(opts) {
  const kit = opts.kit ?? DEFAULT_KIT;
  const ws = opts.workspace ?? DEFAULT_WORKSPACE;
  const pkg = opts.pkg ?? DEFAULT_PKG;
  const only = opts.only ? new Set(opts.only) : null;
  const tokensFile = opts.tokens === undefined ? findTokenFile(ws) : opts.tokens;
  const inp = loadInputs(kit);
  const out = [];
  const want = (id) => !only || only.has(id);
  const needManifest = (id, title, fn) => {
    if (!want(id)) return;
    if (!inp.manifest) { const r = result(id, title); fail(r, inp.manifestErr); out.push(r); return; }
    out.push(fn());
  };
  needManifest('a', 'components vs workspaces, nested repos and package deps', () => {
    const heads = opts.git ? { source: 'option', read: opts.git } : headReader(ws, pkg);
    const r = checkComponents({ ws, pkg, manifest: inp.manifest, git: heads.read });
    if (heads.source === 'SOURCES.json') r.notes.push('commits compared with SOURCES.json (contractor monorepo)');
    return r;
  });
  if (want('b')) {
    if (!inp.contracts) { const r = result('b', 'contract versions vs code'); fail(r, inp.contractsErr); out.push(r); } else out.push(checkContracts({ ws, contracts: inp.contracts }));
  }
  if (want('c')) {
    const r = checkSettings({ ws, schema: inp.schema, schemaErr: inp.schemaErr });
    for (const w of inp.schemaWarnings ?? []) warn(r, `${FILES.schema}: ${w}`);
    out.push(r);
  }
  if (want('d')) out.push(checkGenerated({ kit, schemaMissing: inp.schemaMissing }));
  if (want('e')) {
    const r = checkSecrets(inp);
    for (const w of inp.inventoryWarnings ?? []) warn(r, `${FILES.inventory}: ${w}`);
    out.push(r);
  }
  if (want('f')) out.push(checkKitScan({ kit, pkg, tokensFile, schema: inp.schema, inventory: inp.inventory, username: opts.username }));
  return { results: out, ok: out.every((r) => r.status !== 'fail'), tokenFile: tokensFile ? 'present' : 'absent' };
}

function main(argv) {
  const opts = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kit') opts.kit = path.resolve(argv[++i]);
    else if (a === '--workspace') opts.workspace = path.resolve(argv[++i]);
    else if (a === '--pkg') opts.pkg = path.resolve(argv[++i]);
    else if (a === '--tokens') opts.tokens = path.resolve(argv[++i]);
    else if (a === '--only') opts.only = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--json') json = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node check.mjs [--kit <dir>] [--workspace <dir>] [--pkg <dir>] [--tokens <file>] [--only a,b,c,d,e,f] [--json]');
      return 0;
    } else { console.error(`check: unknown argument ${a}`); return 1; }
  }
  const { results, ok, tokenFile } = runChecks(opts);
  if (json) console.log(JSON.stringify({ ok, tokenFile, results }, null, 2));
  else {
    for (const r of results) {
      console.log(`${r.status.toUpperCase().padEnd(4)} (${r.id}) ${r.title}`);
      for (const m of r.fails) console.log(`  FAIL ${m}`);
      for (const m of r.warns) console.log(`  warn ${m}`);
      for (const m of r.notes) console.log(`  note ${m}`);
    }
    console.log(`token file: ${tokenFile}`);
    console.log(ok ? 'check: no drift' : 'check: DRIFT (exit 1)');
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
