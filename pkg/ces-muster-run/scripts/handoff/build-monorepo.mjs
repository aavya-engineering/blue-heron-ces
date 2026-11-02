#!/usr/bin/env node
// Build the CES contractor monorepo (one folder, one commit) from the per-module repos.
//
//   node scripts/handoff/build-monorepo.mjs --out <dir> [--dry-run | --no-commit]
//        [--root <dir>]                  where the live repos sit (default C:/ces-nb: ces\, ces\<nested>\, pkg\ces-muster-run\)
//        [--repo <id>=<path>]...         override one repo's folder
//        [--ref <id>=<ref or sha>]...    override one repo's ref (defaults: bhd/nb for ces-mono and its nested repos, v2 for the package)
//        [--refs-from-manifest]          take each repo's ref from the kit manifest's pinned `commit:` values
//        [--kit <dir>]                   the kit folder copied to handoff/ (default: the handoff\ folder next to this script)
//        [--start-here <file>]           page placed at the root (default: <kit>\START-HERE.md)
//        [--tokens <file>]               identity token list (default: nb-tools\scan-tokens.txt found above --root)
//        [--tokens-extra <file>]...      more identity tokens (one .NET-style regex per line)
//        [--allow <file>]                allow-list for secret and hygiene hits (default: monorepo-allow.json next to this script)
//        [--exclude <file>]              tracked paths to leave out, each with a reason (JSON; recorded in SOURCES.json)
//        [--author "Name <email>"]       commit author and committer (else GIT_AUTHOR_* / GIT_COMMITTER_* from the environment)
//        [--report <file>]               write the full JSON report (must be outside --out)
//        [--json]                        print the report as JSON instead of text
//
// Layout written under --out (see docs: AGENT-BRIEF-HANDOFF2.md "Monorepo layout"):
//   START-HERE.md, handoff\ (the kit), ces\ (ces-mono) with ces\ces-muster\, ces\ces-tester\, ces\tenant-stacksim\,
//   ces\ces-tenant\ (nested repos as plain folders), pkg\ces-muster-run\ (without handoff\), SOURCES.json, .gitignore.
//
// Only tracked files go in: each repo is exported with `git archive` at its resolved commit, so nothing untracked or
// ignored can leak. Then two scans run over every file and every path:
//   identity scan - the banned list: the token list (nb-tools/scan-tokens.txt), the workstation user name and any
//                   --tokens-extra; case rules come from each pattern. Identity hits can never be allow-listed.
//   hygiene scan  - the identity-scan.ps1 patterns (local profile and temp paths, the scratch-folder keyword, the company mailbox
//                   domain, patch headers). A hygiene hit may be allow-listed with a reason.
//   secret scan   - check.mjs SECRET_PATTERNS plus a client_secret literal, and files named *.pfx, *.p12, *.key, *.pem
//                   or under tenants/live/. A secret hit may be allow-listed with a reason (monorepo-allow.json).
// Any hit that is not allow-listed fails the build with file:line and the rule; the matched text is never printed.
// Without --dry-run or --no-commit the folder becomes a git repository with ONE commit. Pushing is not done here.
//
// Modes: --dry-run resolves refs and prints the plan, writing nothing. --no-commit builds and scans but runs no git init.
// Exit 0 = built (or planned) and clean; 1 = a scan hit, a pin mismatch in commit mode, or any build error; 2 = usage error.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile, DEFAULT_KIT } from './gen.mjs';
import { loadIdentityPatterns, toJsRegex, loadTokens, findTokenFile, SECRET_PATTERNS, DEFAULT_PKG } from './check.mjs';
import { REPO_INFO } from './lib/kitdata.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = 'C:/ces-nb';
export const DEFAULT_ALLOW = path.join(HERE, 'monorepo-allow.json');
export const SHA40 = /^[0-9a-f]{40}$/;

/** The repos that make up the monorepo: id, folder under --root, default ref, and destination in the output. */
export const REPOS = [
  { id: 'ces-mono', dir: 'ces', ref: 'bhd/nb', dest: 'ces' },
  { id: 'ces-muster', dir: 'ces/ces-muster', ref: 'bhd/nb', dest: 'ces/ces-muster' },
  { id: 'ces-tester', dir: 'ces/ces-tester', ref: 'bhd/nb', dest: 'ces/ces-tester' },
  { id: 'tenant-stacksim', dir: 'ces/tenant-stacksim', ref: 'bhd/nb', dest: 'ces/tenant-stacksim' },
  { id: 'ces-tenant', dir: 'ces/ces-tenant', ref: 'bhd/nb', dest: 'ces/ces-tenant' },
  // The kit lives at the monorepo root, so the package's own handoff/ is left out.
  { id: 'ces-muster-run', dir: 'pkg/ces-muster-run', ref: 'v2', dest: 'pkg/ces-muster-run', exclude: ['handoff/'] },
];

export const GITIGNORE = `# CES contractor monorepo. It is cloned to C:\\ces-nb, so the runtime folders (out, pl = the harness
# pipeline root, tenants, evidence, runlogs) sit at the root and are anchored there; deeper folders with those names stay tracked.
node_modules/
dist/
/out/
/pl/
/tenants/
/evidence/
/runlogs/
.env
.env.*
!.env.example
*.pfx
*.key
`;

// client_secret with a non-empty string literal value (not a variable, placeholder or template).
const CLIENT_SECRET_RE = /client_secret["']?\s*[:=]\s*["'](?![$<{%])[^"'\s]{8,}["']/gi;
export const SECRET_RULES = [...SECRET_PATTERNS.map(([n, re]) => [n, re]), ['client_secret literal', CLIENT_SECRET_RE]];
export const SECRET_FILE_RULES = [
  ['key or certificate file', /\.(?:pfx|p12|key|pem)$/i],
  ['live tenant registry path', /(?:^|\/)tenants\/live\//i],
];
// Zip-based files are opened and every text entry is scanned; other archives are listed for review.
const ZIP_EXT = new Set(['.zip', '.docx', '.xlsx', '.pptx', '.docm', '.xlsm']);
const ARCHIVE_EXT = new Set(['.7z', '.gz', '.tgz', '.tar', '.rar']);

/** Minimal zip reader (no dependencies): yields { name, data } for each stored or deflated entry. Throws on a bad file. */
export function* zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) yield { name, data: raw };
    else if (method === 8) yield { name, data: zlib.inflateRawSync(raw) };
    else yield { name, data: null, method };
  }
}
// Domains that are fine in fixtures; any other e-mail address is listed for review (not a failure).
const SAFE_MAIL = /(?:^|\.)(?:example(?:-[a-z]+)?\.[a-z]+|contoso\.(?:com|us)|fabrikam\.com|onmicrosoft\.(?:us|com)|test|invalid|localhost|local|sim|example|noreply\.github\.com|anthropic\.com)$|^[a-z0-9]\.[a-z]+$/i;
const MAIL_RE = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g;

const posix = (p) => p.split(path.sep).join('/');

// ---------- git ----------
export function runGit(args, { cwd, env, input } = {}) {
  const r = spawnSync('git', args, { cwd, env: env ?? process.env, input, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
function gitOk(repo, args) {
  const r = runGit(['-C', repo, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} in ${repo} failed: ${r.err.split('\n')[0]}`);
  return r.out;
}

function tarBin() {
  // Windows ships bsdtar in System32; it accepts drive-letter paths. Elsewhere use tar from PATH.
  const sys = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return process.platform === 'win32' && fs.existsSync(sys) ? sys : 'tar';
}

// ---------- args ----------
export function parseArgs(argv) {
  const o = { repoPaths: {}, refs: {}, tokensExtra: [], mode: 'commit' };
  const need = (i) => { if (i >= argv.length) throw new UsageError(`${argv[i - 1]} needs a value`); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const kv = (v, into) => {
      const m = /^([a-z0-9-]+)=(.+)$/.exec(v);
      if (!m || !REPOS.some((r) => r.id === m[1])) throw new UsageError(`${a} expects <repo>=<value> with repo one of ${REPOS.map((r) => r.id).join(', ')}`);
      into[m[1]] = m[2];
    };
    if (a === '--out') o.out = path.resolve(need(++i));
    else if (a === '--root') o.root = path.resolve(need(++i));
    else if (a === '--repo') kv(need(++i), o.repoPaths);
    else if (a === '--ref') kv(need(++i), o.refs);
    else if (a === '--refs-from-manifest') o.refsFromManifest = true;
    else if (a === '--kit') o.kit = path.resolve(need(++i));
    else if (a === '--start-here') o.startHere = path.resolve(need(++i));
    else if (a === '--tokens') o.tokens = path.resolve(need(++i));
    else if (a === '--tokens-extra') o.tokensExtra.push(path.resolve(need(++i)));
    else if (a === '--allow') o.allow = path.resolve(need(++i));
    else if (a === '--exclude') o.exclude = path.resolve(need(++i));
    else if (a === '--author') o.author = need(++i);
    else if (a === '--report') o.report = path.resolve(need(++i));
    else if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.mode = 'dry-run';
    else if (a === '--no-commit') o.mode = o.mode === 'dry-run' ? 'dry-run' : 'no-commit';
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new UsageError(`unknown argument ${a}`);
  }
  if (!o.help && !o.out) throw new UsageError('--out <dir> is required');
  return o;
}
export class UsageError extends Error {}

export function parseAuthor(s) {
  const m = /^\s*([^<>]+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(s ?? '');
  return m ? { name: m[1], email: m[2] } : null;
}

// ---------- allow-list ----------
export const HYGIENE_RULE = /^identity-scan\.ps1 pattern \d+(?: \((?:in path|text runs)\))?$/;
function globRe(p) {
  const esc = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`, 'i');
}
/** Load the allow-list. Secret rules and hygiene rules (identity-scan.ps1 pattern N) may be allowed; never identity. */
export function loadAllow(file) {
  if (!file || !fs.existsSync(file)) return { entries: [], errors: [] };
  const errors = [];
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { entries: [], errors: [`allow-list unreadable: ${e.message}`] }; }
  const secretNames = new Set([...SECRET_RULES, ...SECRET_FILE_RULES].map(([n]) => n));
  const entries = [];
  (doc.allow ?? []).forEach((e, i) => {
    if (!e || typeof e.path !== 'string' || typeof e.rule !== 'string' || typeof e.reason !== 'string' || e.reason.trim().length < 10) {
      errors.push(`allow[${i}]: needs path, rule and a reason of 10+ characters`);
    } else if (!secretNames.has(e.rule) && !HYGIENE_RULE.test(e.rule)) {
      errors.push(`allow[${i}]: rule "${e.rule}" is not a secret or hygiene rule; identity hits can never be allow-listed`);
    } else entries.push({ ...e, re: globRe(e.path) });
  });
  return { entries, errors };
}

/** Load the exclude list: { exclude: [ { path: <glob from the monorepo root>, reason } ] }. A missing file = none. */
export function loadExclude(file) {
  if (!file) return { entries: [], errors: [] };
  if (!fs.existsSync(file)) return { entries: [], errors: ['--exclude file not found'] };
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { entries: [], errors: [`exclude list unreadable: ${e.message}`] }; }
  const entries = [];
  const errors = [];
  (doc.exclude ?? []).forEach((e, i) => {
    if (!e || typeof e.path !== 'string' || typeof e.reason !== 'string' || e.reason.trim().length < 10) errors.push(`exclude[${i}]: needs path and a reason of 10+ characters`);
    else entries.push({ path: e.path, reason: e.reason, re: globRe(e.path) });
  });
  return { entries, errors };
}

// ---------- scans ----------
export function loadIdentityRules({ identityPs1, tokens, tokensExtra = [], username }) {
  const rules = [];
  const errors = [];
  try {
    loadIdentityPatterns(identityPs1).forEach((p, i) => rules.push([`identity-scan.ps1 pattern ${i + 1}`, toJsRegex(p), 'hygiene']));
  } catch (e) { errors.push(`identity patterns unavailable: ${e.message}`); }
  if (!tokens || !fs.existsSync(tokens)) errors.push('identity token list not found (nb-tools/scan-tokens.txt); pass --tokens <file>');
  else loadTokens(tokens, { username: '' }).forEach((p, i) => rules.push([`token ${i + 1}`, toJsRegex(p), 'identity']));
  for (const f of tokensExtra) {
    if (!fs.existsSync(f)) { errors.push(`--tokens-extra file missing: ${path.basename(f)}`); continue; }
    loadTokens(f, { username: '' }).forEach((p, i) => rules.push([`extra token ${path.basename(f)}#${i + 1}`, toJsRegex(p), 'identity']));
  }
  const u = username === undefined ? os.userInfo().username : username;
  if (u && u.length >= 3) rules.push(['workstation user name', toJsRegex(`(?i)${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'identity']);
  return { rules, errors };
}

function* walk(dir, base = dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!(dir === base && (e.name === '.git' || e.name === '.build'))) yield* walk(p, base); } else if (e.isFile()) yield p;
  }
}

function lineFinder(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (idx) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
}

/**
 * Scan every file under `tree`. Returns { hits, review, inventory }. Hits: { file, line, kind, rule, allowed, reason }.
 * The matched text is never kept.
 */
export function scanTree(tree, { identityRules, allow = [] }) {
  const hits = [];
  const review = [];
  const mail = {};
  const inv = { files: 0, bytes: 0, textFiles: 0, binaryFiles: 0, largest: [], byFolder: {}, binaryByExt: {}, archives: [] };
  const add = (h) => {
    if (h.kind !== 'identity') {
      const a = allow.find((e) => e.rule === h.rule && e.re.test(h.file));
      if (a) { h.allowed = true; h.reason = a.reason; a.used = true; }
    }
    hits.push(h);
  };
  for (const f of walk(tree)) {
    const rel = posix(path.relative(tree, f));
    const buf = fs.readFileSync(f);
    inv.files++;
    inv.bytes += buf.length;
    const seg = rel.split('/');
    const folder = seg.length > 2 ? seg.slice(0, seg[0] === 'ces' && seg.length > 3 && REPOS.some((r) => r.dest === `ces/${seg[1]}`) ? 3 : 2).join('/') : seg.length === 2 ? seg[0] : '(root)';
    const fb = (inv.byFolder[folder] ??= { files: 0, bytes: 0 });
    fb.files++; fb.bytes += buf.length;
    inv.largest.push([buf.length, rel]);
    const ext = path.extname(rel).toLowerCase();
    if (ARCHIVE_EXT.has(ext)) inv.archives.push(rel);
    // Paths: identity tokens in names, key files, live tenant folders.
    for (const [rule, re, kind] of identityRules) { re.lastIndex = 0; if (re.test(rel)) add({ file: rel, line: 0, kind, rule: `${rule} (in path)` }); }
    for (const [rule, re] of SECRET_FILE_RULES) { re.lastIndex = 0; if (re.test(rel)) add({ file: rel, line: 0, kind: 'secret', rule }); }
    if (ZIP_EXT.has(ext)) {
      inv.zipFiles = (inv.zipFiles ?? 0) + 1;
      try {
        for (const e of zipEntries(buf)) {
          const label = `${rel}!${e.name}`;
          if (!e.data) { inv.archives.push(`${label} (method ${e.method})`); continue; }
          if (e.data.subarray(0, 8192).includes(0)) continue;
          scanText(label, e.data.toString('utf8'), /\.(?:xml|rels)$/i.test(e.name));
          inv.zipEntriesScanned = (inv.zipEntriesScanned ?? 0) + 1;
        }
      } catch (err) { inv.archives.push(`${rel} (unreadable zip: ${err.message})`); }
    }
    const binary = buf.subarray(0, 8192).includes(0);
    if (binary) { inv.binaryFiles++; inv.binaryByExt[ext || '(none)'] = (inv.binaryByExt[ext || '(none)'] ?? 0) + 1; continue; }
    inv.textFiles++;
    scanText(rel, buf.toString('utf8'), false);
  }
  function scanText(rel, text, xml) {
    let lineOf;
    const ln = (i) => (lineOf ??= lineFinder(text))(i);
    // Office XML splits words across runs; also scan the text with the tags removed (reported as line 0).
    const flat = xml ? text.replace(/<[^>]+>/g, '') : null;
    for (const [rule, re, kind] of identityRules) {
      re.lastIndex = 0;
      let hit = false;
      for (const m of text.matchAll(re)) { hit = true; add({ file: rel, line: ln(m.index), kind, rule }); }
      if (flat && !hit) { re.lastIndex = 0; if (re.test(flat)) add({ file: rel, line: 0, kind, rule: `${rule} (text runs)` }); }
    }
    for (const [rule, re] of SECRET_RULES) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) add({ file: rel, line: ln(m.index), kind: 'secret', rule });
    }
    MAIL_RE.lastIndex = 0;
    for (const m of text.matchAll(MAIL_RE)) {
      const d = m[1].toLowerCase();
      if (SAFE_MAIL.test(d) || /\.(?:png|jpe?g|svg|gif|js|ts|css|json|md)$/.test(d)) continue;
      const e = (mail[d] ??= { count: 0, files: new Set(), first: `${rel}:${ln(m.index)}` });
      e.count++; e.files.add(rel);
    }
  }
  inv.largest = inv.largest.sort((a, b) => b[0] - a[0]).slice(0, 20).map(([bytes, file]) => ({ file, bytes }));
  for (const [d, e] of Object.entries(mail).sort((a, b) => b[1].count - a[1].count)) review.push({ file: e.first, line: 0, what: `e-mail domain ${d}: ${e.count} addresses in ${e.files.size} files (real-looking data?)` });
  for (const a of inv.archives) review.push({ file: a, line: 0, what: 'archive or Office file: contents not scanned' });
  return { hits, review, inventory: inv };
}

// ---------- build ----------
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function emptyOrMissing(dir) { return !fs.existsSync(dir) || fs.readdirSync(dir).length === 0; }
function countFiles(dir, skipRel = []) {
  let n = 0;
  for (const f of walk(dir)) { const r = posix(path.relative(dir, f)); if (!skipRel.some((s) => r === s || r.startsWith(`${s}/`))) n++; }
  return n;
}

/** Resolve each repo's folder, ref and commit. Throws on an unknown ref. */
export function resolveRepos(o, manifestPins, excludeRules = []) {
  const root = o.root ?? DEFAULT_ROOT;
  return REPOS.map((r) => {
    const dir = o.repoPaths[r.id] ? path.resolve(o.repoPaths[r.id]) : path.resolve(root, r.dir);
    if (!fs.existsSync(dir)) throw new Error(`${r.id}: repo folder not found (${r.dir})`);
    const ref = o.refs[r.id] ?? (o.refsFromManifest ? manifestPins[r.id] : undefined) ?? r.ref;
    if (o.refsFromManifest && !o.refs[r.id] && !manifestPins[r.id]) throw new Error(`${r.id}: --refs-from-manifest but the manifest pins no single commit for it`);
    const commit = gitOk(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    const top = gitOk(dir, ['rev-parse', '--show-toplevel']);
    if (path.resolve(top).toLowerCase() !== dir.toLowerCase()) throw new Error(`${r.id}: folder is not a repository root`);
    const date = gitOk(dir, ['log', '-1', '--format=%cI', commit]);
    const subject = gitOk(dir, ['log', '-1', '--format=%s', commit]);
    const all = gitOk(dir, ['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean);
    const exclude = r.exclude ?? [];
    const inTree = all.filter((p) => !exclude.some((e) => p.startsWith(e)));
    const leftOut = [];
    const kept = inTree.filter((p) => {
      const rule = excludeRules.find((e) => e.re.test(`${r.dest}/${p}`));
      if (rule) { rule.used = (rule.used ?? 0) + 1; leftOut.push(p); }
      return !rule;
    });
    return { ...r, path: dir, refGiven: ref, commit, commitDate: date, subject, trackedFiles: all.length, files: kept.length, excludedFiles: all.length - inTree.length, leftOut };
  });
}

/** Per repo id, the single commit the kit manifest pins (null when components disagree or say HEAD-at-cut). */
export function manifestPins(manifestFile) {
  const out = {};
  const raw = {};
  const y = readYamlFile(manifestFile);
  if (!y.doc) return { pins: out, raw, error: y.missing ? 'manifest missing' : y.error };
  for (const c of y.doc.components ?? []) (raw[c.repo] ??= new Set()).add(String(c.commit));
  for (const [repo, set] of Object.entries(raw)) if (set.size === 1 && SHA40.test([...set][0])) out[repo] = [...set][0];
  return { pins: out, raw: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, [...v]])) };
}

function archiveInto(repo, outRoot, buildDir) {
  const dest = path.join(outRoot, repo.dest);
  if (!emptyOrMissing(dest)) throw new Error(`${repo.id}: destination ${repo.dest}/ already has files (a parent repo tracks files there)`);
  fs.mkdirSync(dest, { recursive: true });
  const tar = path.join(buildDir, `${repo.id}.tar`);
  const a = runGit(['-C', repo.path, 'archive', '--format=tar', '-o', tar, repo.commit]);
  if (a.code !== 0) throw new Error(`${repo.id}: git archive failed: ${a.err.split('\n')[0]}`);
  const x = spawnSync(tarBin(), ['-xf', tar, '-C', dest], { encoding: 'utf8', windowsHide: true });
  if (x.error || x.status !== 0) throw new Error(`${repo.id}: tar extract failed: ${(x.error?.message ?? x.stderr ?? '').split('\n')[0]}`);
  fs.rmSync(tar, { force: true });
  for (const e of repo.exclude ?? []) fs.rmSync(path.join(dest, e), { recursive: true, force: true });
  for (const p of repo.leftOut ?? []) fs.rmSync(path.join(dest, p), { force: true });
}

function copyKit(kit, outRoot, startHereName) {
  const files = [];
  const dest = path.join(outRoot, 'handoff');
  for (const f of walk(kit)) {
    const rel = posix(path.relative(kit, f));
    if (rel.split('/').some((s) => s === 'node_modules' || s === '.git')) continue;
    if (rel === startHereName) continue;
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f, to);
    files.push({ path: `handoff/${rel}`, sha256: sha256(f) });
  }
  return files;
}

function kitProvenance(kit) {
  const r = runGit(['-C', kit, 'rev-parse', 'HEAD']);
  if (r.code !== 0) return { baseCommit: null, workingTree: true, dirty: null };
  const s = runGit(['-C', kit, '--no-optional-locks', 'status', '--porcelain', '--', '.']);
  return { baseCommit: r.out, workingTree: true, dirty: s.code === 0 ? s.out.length > 0 : null };
}

/**
 * Build (or plan) the monorepo. Returns a report object; `ok` is false on any failure.
 * opts: parsed args plus test hooks { identityPs1, username, now }.
 */
export function buildMonorepo(opts) {
  const o = { repoPaths: {}, refs: {}, tokensExtra: [], mode: 'commit', ...opts };
  const report = { tool: 'build-monorepo.mjs', mode: o.mode, ok: false, errors: [], warnings: [], repos: [], hits: [], review: [], inventory: null };
  const fail = (m) => report.errors.push(m);
  const kit = o.kit ?? DEFAULT_KIT;
  const startHere = o.startHere ?? path.join(kit, 'START-HERE.md');
  const out = o.out;
  try {
    if (!out) throw new UsageError('--out <dir> is required');
    if (o.report && (path.resolve(o.report) + path.sep).toLowerCase().startsWith((path.resolve(out) + path.sep).toLowerCase())) throw new UsageError('--report must be outside --out');
    if (!fs.existsSync(kit)) throw new Error('kit folder not found');
    const mf = manifestPins(path.join(kit, 'handoff.manifest.yaml'));
    if (mf.error) report.warnings.push(`kit manifest: ${mf.error}`);
    const ex = loadExclude(o.exclude);
    ex.errors.forEach(fail);
    report.repos = resolveRepos(o, mf.pins, ex.entries);
    for (const e of ex.entries) if (!e.used) report.warnings.push(`exclude entry matched nothing: ${e.path}`);
    if (!fs.existsSync(startHere)) (o.mode === 'commit' ? fail : (m) => report.warnings.push(m))('START-HERE.md not found (H1 drafts it at <kit>/START-HERE.md); pass --start-here');
    // Manifest pins vs what is being built.
    for (const r of report.repos) {
      const pinned = mf.raw?.[r.id];
      if (!pinned) continue;
      const bad = pinned.filter((c) => c !== r.commit);
      if (bad.length) {
        const msg = `manifest pins for ${r.id} (${pinned.map((c) => (SHA40.test(c) ? c.slice(0, 10) : c)).join(', ')}) differ from the commit being built (${r.commit.slice(0, 10)}); run pin-manifest.mjs, then gen.mjs`;
        (o.mode === 'commit' ? fail : (m) => report.warnings.push(m))(msg);
      }
    }
    let author = null;
    if (o.mode === 'commit') {
      author = o.author ? parseAuthor(o.author) : null;
      if (o.author && !author) fail('--author must look like "Name <email>"');
      const env = process.env;
      if (!author && !(env.GIT_AUTHOR_NAME && env.GIT_AUTHOR_EMAIL)) fail('no commit identity: pass --author "Name <email>" or set GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL (the global git config is never used)');
    }
    const plan = report.repos.reduce((n, r) => n + r.files, 0);
    report.plannedFiles = plan;
    if (o.mode === 'dry-run' || report.errors.length) { report.ok = report.errors.length === 0; return report; }

    if (!emptyOrMissing(out)) throw new Error('--out folder exists and is not empty');
    fs.mkdirSync(out, { recursive: true });
    const buildDir = path.join(out, '.build');
    fs.mkdirSync(buildDir, { recursive: true });
    try {
      for (const r of report.repos) archiveInto(r, out, buildDir);
    } finally { fs.rmSync(buildDir, { recursive: true, force: true }); }
    // Per-repo file counts must match the tracked files (nested destinations are counted on their own).
    for (const r of report.repos) {
      const nested = report.repos.filter((x) => x !== r && x.dest.startsWith(`${r.dest}/`)).map((x) => x.dest.slice(r.dest.length + 1));
      const n = countFiles(path.join(out, r.dest), nested);
      r.extractedFiles = n;
      if (n !== r.files) fail(`${r.id}: extracted ${n} files but the commit tracks ${r.files} (export-ignore or a path problem)`);
    }
    const kitFiles = copyKit(kit, out, path.relative(kit, startHere) === 'START-HERE.md' ? 'START-HERE.md' : null);
    if (fs.existsSync(startHere)) fs.copyFileSync(startHere, path.join(out, 'START-HERE.md'));
    fs.writeFileSync(path.join(out, '.gitignore'), GITIGNORE);
    const sources = {
      schemaVersion: 1,
      built: (o.now ?? new Date()).toISOString(),
      tool: 'pkg/ces-muster-run/scripts/handoff/build-monorepo.mjs',
      note: 'Provenance of every folder: which repository, ref and commit it was exported from (git archive, tracked files only).',
      repos: report.repos.map((r) => ({
        repo: r.id, github: REPO_INFO[r.id]?.github ?? null, ref: r.refGiven, commit: r.commit, commitDate: r.commitDate,
        subject: r.subject, path: `${r.dest}/`, files: r.files, excluded: r.exclude ?? [],
        leftOut: r.leftOut.map((p) => `${r.dest}/${p}`),
      })),
      leftOutRules: ex.entries.map((e) => ({ path: e.path, reason: e.reason, files: e.used ?? 0 })),
      kit: { path: 'handoff/', from: 'ces-muster-run handoff/ (working tree)', ...kitProvenance(kit), files: kitFiles },
      startHere: fs.existsSync(startHere) ? { path: 'START-HERE.md', sha256: sha256(startHere) } : null,
    };
    fs.writeFileSync(path.join(out, 'SOURCES.json'), JSON.stringify(sources, null, 2) + '\n');
    const expected = plan + kitFiles.length + (fs.existsSync(startHere) ? 1 : 0) + 2;
    const actual = countFiles(out);
    report.files = actual;
    if (actual !== expected) fail(`tree has ${actual} files, expected ${expected}`);

    // Scans.
    const tokens = o.tokens ?? findTokenFile(o.root ?? DEFAULT_ROOT) ?? findTokenFile(path.join(o.root ?? DEFAULT_ROOT, 'ces'));
    const id = loadIdentityRules({ identityPs1: o.identityPs1 ?? path.join(DEFAULT_PKG, 'scripts', 'identity-scan.ps1'), tokens, tokensExtra: o.tokensExtra, username: o.username });
    id.errors.forEach(fail);
    const al = loadAllow(o.allow ?? DEFAULT_ALLOW);
    al.errors.forEach(fail);
    const scan = scanTree(out, { identityRules: id.rules, allow: al.entries });
    report.identityRules = id.rules.length;
    report.hits = scan.hits;
    report.review = scan.review;
    report.inventory = scan.inventory;
    for (const e of al.entries) if (!e.used) report.warnings.push(`allow-list entry not used: ${e.path} / ${e.rule}`);
    const open = scan.hits.filter((h) => !h.allowed);
    if (open.length) fail(`${open.length} scan hits (identity ${open.filter((h) => h.kind === 'identity').length}, hygiene ${open.filter((h) => h.kind === 'hygiene').length}, secret ${open.filter((h) => h.kind === 'secret').length})`);

    if (o.mode === 'commit' && !report.errors.length) report.commit = commitTree(out, author);
  } catch (e) {
    if (e instanceof UsageError) report.usage = e.message;
    fail(e.message);
  }
  report.ok = report.errors.length === 0;
  return report;
}

function commitTree(out, author) {
  const env = { ...process.env };
  if (author) {
    env.GIT_AUTHOR_NAME = author.name; env.GIT_AUTHOR_EMAIL = author.email;
    env.GIT_COMMITTER_NAME = author.name; env.GIT_COMMITTER_EMAIL = author.email;
  } else {
    env.GIT_COMMITTER_NAME ??= env.GIT_AUTHOR_NAME; env.GIT_COMMITTER_EMAIL ??= env.GIT_AUTHOR_EMAIL;
  }
  const g = (args) => {
    const r = runGit(['-c', 'user.useConfigOnly=true', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], { cwd: out, env });
    if (r.code !== 0) throw new Error(`git ${args[0]} failed in the output folder: ${r.err.split('\n')[0]}`);
    return r.out;
  };
  g(['init', '-q', '-b', 'main']);
  // Every file in the tree came from a tracked file or the build itself, so add them all, even those a
  // .gitignore (the root one or a repo's own) would match; the ignore rules guard future work only.
  const ignored = g(['status', '--porcelain', '--ignored', '--untracked-files=all']).split('\n').filter((l) => l.startsWith('!! ')).map((l) => l.slice(3));
  g(['add', '-A', '-f', '.']);
  const listed = g(['ls-files', '-z']).split('\0').filter(Boolean).length;
  const onDisk = countFiles(out);
  if (listed !== onDisk) throw new Error(`git index holds ${listed} files but the tree has ${onDisk}`);
  g(['commit', '-q', '-m', 'CES contractor monorepo\n\nOne commit built by build-monorepo.mjs from the module repositories; SOURCES.json records each folder\'s repository, ref and commit.']);
  return { sha: g(['rev-parse', 'HEAD']), files: listed, ignoredButTracked: ignored };
}

// ---------- output ----------
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
export function formatReport(rep) {
  const L = [];
  L.push(`build-monorepo: ${rep.mode} ${rep.ok ? 'OK' : 'FAILED'}`);
  for (const r of rep.repos) L.push(`  ${r.id.padEnd(16)} ${r.refGiven.padEnd(12)} ${r.commit.slice(0, 12)}  ${String(r.files).padStart(5)} files -> ${r.dest}/${r.excludedFiles ? ` (left out ${r.excludedFiles} under ${r.exclude.join(', ')})` : ''}${r.leftOut?.length ? ` (${r.leftOut.length} left out by --exclude)` : ''}`);
  if (rep.inventory) {
    const v = rep.inventory;
    L.push(`  tree: ${v.files} files, ${mb(v.bytes)} (${v.textFiles} text, ${v.binaryFiles} binary); ${rep.identityRules} identity rules`);
    L.push('  largest files:');
    for (const x of v.largest.slice(0, 10)) L.push(`    ${mb(x.bytes).padStart(9)}  ${x.file}`);
    L.push('  by folder:');
    for (const [k, x] of Object.entries(v.byFolder).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 15)) L.push(`    ${mb(x.bytes).padStart(9)} ${String(x.files).padStart(5)}  ${k}`);
    L.push(`  binary by extension: ${Object.entries(v.binaryByExt).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ${n}`).join(', ') || 'none'}`);
  }
  const open = rep.hits.filter((h) => !h.allowed);
  if (rep.hits.length) {
    L.push(`  scan hits: ${open.length} open, ${rep.hits.length - open.length} allow-listed`);
    const byRule = {};
    for (const h of open) byRule[`${h.kind}: ${h.rule}`] = (byRule[`${h.kind}: ${h.rule}`] ?? 0) + 1;
    for (const [k, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) L.push(`    ${String(n).padStart(5)}  ${k}`);
    const byFile = new Map();
    for (const h of open) {
      const k = `${h.file}  ${h.kind}: ${h.rule}`;
      if (!byFile.has(k)) byFile.set(k, []);
      byFile.get(k).push(h.line);
    }
    let shown = 0;
    for (const [k, lines] of byFile) {
      if (shown++ >= 150) { L.push(`    ... ${byFile.size - 150} more file/rule groups (see --report)`); break; }
      const [file, rest] = k.split('  ');
      L.push(`    ${file}:${lines.slice(0, 8).join(',')}${lines.length > 8 ? `,... (${lines.length})` : ''}  ${rest}`);
    }
  } else if (rep.inventory) L.push('  scan hits: none');
  if (rep.review?.length) {
    L.push(`  for review (not failures): ${rep.review.length}`);
    for (const r of rep.review.slice(0, 40)) L.push(`    ${r.file}:${r.line}  ${r.what}`);
  }
  for (const w of rep.warnings) L.push(`  WARN ${w}`);
  for (const e of rep.errors) L.push(`  FAIL ${e}`);
  if (rep.commit) L.push(`  committed ${rep.commit.sha} (${rep.commit.files} files); push only after the BHD owner's OK`);
  return L.join('\n');
}

function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) {
    if (e instanceof UsageError) { console.error(`build-monorepo: ${e.message} (try --help)`); return 2; }
    throw e;
  }
  if (o.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 18).map((l) => l.slice(3)).join('\n')); return 0; }
  const rep = buildMonorepo(o);
  if (o.report) { fs.mkdirSync(path.dirname(o.report), { recursive: true }); fs.writeFileSync(o.report, JSON.stringify(rep, null, 2)); }
  console.log(o.json ? JSON.stringify(rep, null, 2) : formatReport(rep));
  if (rep.usage) return 2;
  return rep.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
