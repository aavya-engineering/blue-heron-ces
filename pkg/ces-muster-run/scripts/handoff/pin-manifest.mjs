#!/usr/bin/env node
// Pin the kit manifest's component commits to the commits the monorepo is built from.
//
//   node scripts/handoff/pin-manifest.mjs [--manifest <file>] [--root <dir>] [--ref <repo>=<ref>]... [--repo <repo>=<path>]...
//                                         [--sources <SOURCES.json>] [--status pinned|draft] [--check]
//
// For every component in handoff.manifest.yaml, the `commit:` line is set to the commit of its `repo` (ces-mono,
// ces-muster, ces-tester, tenant-stacksim, ces-tenant, ces-muster-run). The commits come from --sources (a SOURCES.json
// that build-monorepo.mjs wrote) or are resolved the same way build-monorepo.mjs resolves them (--root, --ref, --repo;
// defaults: bhd/nb for ces-mono and its nested repos, v2 for the package). Only the `commit:` lines and, with --status,
// the release status change; comments and layout stay. Run gen.mjs afterwards so handoff.manifest.json and the generated
// pages follow, then check.mjs.
// --check: change nothing; exit 1 if the manifest is not already pinned to those commits.
// Exit 0 = pinned (or already pinned); 1 = --check found drift, or an error; 2 = usage error.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_KIT } from './gen.mjs';
import { resolveRepos, REPOS, SHA40, UsageError } from './build-monorepo.mjs';

/** Rewrite the manifest text. pins: { repoId: sha }. Returns { text, changed: [{ id, repo, from, to }], unknown: [ids] }. */
export function pinManifestText(text, pins, { status } = {}) {
  const lines = text.split(/\r?\n/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const changed = [];
  const unknown = [];
  let id = null;
  let repo = null;
  let commitLine = -1;
  let inComponents = false;
  const flush = () => {
    if (id === null) return;
    if (commitLine < 0 || !repo) { unknown.push(id); return; }
    if (!pins[repo]) { unknown.push(id); return; }
    const m = /^(\s*commit:\s*)(.*?)(\s*(?:#.*)?)$/.exec(lines[commitLine]);
    const from = m[2].replace(/^["']|["']$/g, '');
    if (from !== pins[repo]) {
      lines[commitLine] = `${m[1]}"${pins[repo]}"${m[3]}`;
      changed.push({ id, repo, from, to: pins[repo] });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^components:\s*$/.test(l)) { inComponents = true; continue; }
    if (inComponents && /^\S/.test(l) && !/^#/.test(l)) { flush(); id = null; inComponents = false; }
    if (!inComponents) {
      if (status) {
        const r = /^(release:\s*\{.*\bstatus:\s*)(draft|pinned)(.*)$/.exec(l);
        if (r && r[2] !== status) { lines[i] = `${r[1]}${status}${r[3]}`; changed.push({ id: 'release', repo: null, from: r[2], to: status }); }
      }
      continue;
    }
    const idm = /^\s*-\s+id:\s*["']?([A-Za-z0-9._-]+)/.exec(l);
    if (idm) { flush(); id = idm[1]; repo = null; commitLine = -1; continue; }
    const rm = /^\s+repo:\s*["']?([A-Za-z0-9._-]+)/.exec(l);
    if (rm && id) { repo = rm[1]; continue; }
    if (/^\s+commit:/.test(l) && id) commitLine = i;
  }
  if (inComponents) flush();
  return { text: lines.join(eol), changed, unknown };
}

export function pinsFromSources(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pins = {};
  for (const r of doc.repos ?? []) if (SHA40.test(r.commit ?? '')) pins[r.repo] = r.commit;
  return pins;
}

function parseArgs(argv) {
  const o = { repoPaths: {}, refs: {}, manifest: path.join(DEFAULT_KIT, 'handoff.manifest.yaml') };
  const need = (i) => { if (i >= argv.length) throw new UsageError(`${argv[i - 1]} needs a value`); return argv[i]; };
  const kv = (a, v, into) => {
    const m = /^([a-z0-9-]+)=(.+)$/.exec(v);
    if (!m || !REPOS.some((r) => r.id === m[1])) throw new UsageError(`${a} expects <repo>=<value>`);
    into[m[1]] = m[2];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') o.manifest = path.resolve(need(++i));
    else if (a === '--root') o.root = path.resolve(need(++i));
    else if (a === '--ref') kv(a, need(++i), o.refs);
    else if (a === '--repo') kv(a, need(++i), o.repoPaths);
    else if (a === '--sources') o.sources = path.resolve(need(++i));
    else if (a === '--status') { o.status = need(++i); if (!['pinned', 'draft'].includes(o.status)) throw new UsageError('--status is pinned or draft'); }
    else if (a === '--check') o.check = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new UsageError(`unknown argument ${a}`);
  }
  return o;
}

function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) {
    if (e instanceof UsageError) { console.error(`pin-manifest: ${e.message}`); return 2; }
    throw e;
  }
  if (o.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); return 0; }
  try {
    const pins = o.sources ? pinsFromSources(o.sources) : Object.fromEntries(resolveRepos(o, {}).map((r) => [r.id, r.commit]));
    const text = fs.readFileSync(o.manifest, 'utf8');
    const res = pinManifestText(text, pins, { status: o.status });
    for (const c of res.changed) console.log(`  ${c.id}${c.repo ? ` (${c.repo})` : ''}: ${c.from} -> ${c.to}`);
    for (const u of res.unknown) console.log(`  WARN ${u}: no commit line or no pin for its repo`);
    if (o.check) {
      console.log(res.changed.length ? `pin-manifest --check: ${res.changed.length} entries not pinned` : 'pin-manifest --check: pinned');
      return res.changed.length ? 1 : 0;
    }
    if (res.changed.length) fs.writeFileSync(o.manifest, res.text);
    console.log(`pin-manifest: ${res.changed.length} lines changed; now run node scripts/handoff/gen.mjs, then check.mjs`);
    return 0;
  } catch (e) {
    console.error(`pin-manifest: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
