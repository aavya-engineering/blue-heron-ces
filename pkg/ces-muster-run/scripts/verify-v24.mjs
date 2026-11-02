#!/usr/bin/env node
// V24 (Blue Heron Defense, CES team): self-containment of a fresh root bootstrapped from the origin.
//   node scripts/verify-v24.mjs --root <fresh root> [--before <snapshot.json>] [--after <snapshot.json>]
// Sub-checks, each printed PASS/FAIL:
//   a1  no legacy, current-build or user-profile path in <root>\out\logs\**, <root>\out\bootstrap\*,
//       <root>\out\*.json (top level) or the text files under <root>\pl (ces.db* skipped); the
//       outside baselines (out\outside-*.json, out\snapshots) name the watched folders by design and are skipped;
//       out\verify.json check titles are ignored, its V10 detail and out\sim-env.json PATH hits are reported but do not fail
//   a2  the same over the tracked code/config files of the five clones under <root>\ces (git grep);
//       *.md, *.txt and docs/ folders are counted as informational only
//   b   git status --porcelain is empty in the five clones and in this package
//   c   the snapshot-outside before/after JSON (default <root>\out\snapshots\before.json, after.json)
//       show no change outside the root
// Exit 0 only when every sub-check passes.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!a.root) { console.error('usage: node scripts/verify-v24.mjs --root <fresh root>'); process.exit(2); }
const root = path.resolve(a.root);
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pins = JSON.parse(fs.readFileSync(path.join(pkg, 'pins.json'), 'utf8'));
const ces = path.join(root, 'ces');
const clones = pins.repos.map((r) => ({ repo: r.repo, dir: r.dir === '.' ? ces : path.join(ces, r.dir) }));

// Needles: each base path in backslash, forward-slash and JSON-escaped form; matched case-insensitively.
// Hits are reported by label only, so this script's own output never carries the paths it hunts.
const bases = { 'current-build': 'DevProjects\\ces\\', 'legacy-pipeline': 'C:\\CES_Pipeline', 'user-profile': os.homedir() };
const needles = [];
for (const [label, b] of Object.entries(bases)) {
  for (const v of new Set([b, b.replace(/\\/g, '/'), b.replace(/\\/g, '\\\\')])) needles.push({ label, text: v.toLowerCase() });
}

const results = [];
function report(id, title, pass, detail) {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} V24.${id} ${title}${detail ? `: ${detail}` : ''}`);
}

function walk(dir, filter, acc = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, acc);
    else if (e.isFile() && filter(p, e.name)) acc.push(p);
  }
  return acc;
}
const labelsIn = (text) => {
  const t = text.toLowerCase();
  return [...new Set(needles.filter((n) => t.includes(n.text)).map((n) => n.label))];
};
// Per-file carve-outs for a1 (PLAN V24: "no such path in logs or configs"):
//   out\verify.json  the check titles are fixed names, not run output; they are blanked before the scan,
//                    and V10's detail (the outside-write guard listing its watched folders) is reported, not failed
//   out\sim-env.json the saved PATH is the launching environment by design; its hits are reported, not failed
const expected = [];
function hitsIn(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8192).includes(0)) return [];   // binary
  let text = buf.toString('utf8');
  const rel = path.relative(root, file).toLowerCase();
  if (rel === path.join('out', 'verify.json') || rel === path.join('out', 'sim-env.json')) {
    try {
      const j = JSON.parse(text.replace(/^﻿/, ''));
      if (rel.endsWith('verify.json')) {
        for (const c of Array.isArray(j.checks) ? j.checks : []) {
          if (!c || typeof c !== 'object') continue;
          if (typeof c.title === 'string') c.title = '';
          // V10 is the outside-write guard: its detail names the watched folders by design (as out\outside-*.json do)
          if (c.id === 'V10' && typeof c.detail === 'string') {
            const h = labelsIn(c.detail);
            if (h.length) expected.push(`${path.relative(root, file)} V10 detail [${h.join(', ')}]`);
            c.detail = '';
          }
        }
      } else {
        for (const k of Object.keys(j)) {
          if (k.toLowerCase() !== 'path' || typeof j[k] !== 'string') continue;
          const h = labelsIn(j[k]);
          if (h.length) expected.push(`${path.relative(root, file)} ${k} [${h.join(', ')}]`);
          delete j[k];
        }
      }
      text = JSON.stringify(j);
    } catch { /* unparsable: scan the raw text */ }
  }
  return labelsIn(text);
}

// a1: runtime surfaces under the root
const out = path.join(root, 'out');
const surfaces = {
  'out/logs': walk(path.join(out, 'logs'), () => true),
  'out/bootstrap': walk(path.join(out, 'bootstrap'), () => true),
  'out/*.json': (() => { try { return fs.readdirSync(out, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.json') && !/^outside-/i.test(e.name)).map((e) => path.join(out, e.name)); } catch { return []; } })(),
  'pl': walk(path.join(root, 'pl'), (_p, n) => !/^ces\.db/i.test(n)),
};
{
  const bad = [];
  let scanned = 0;
  for (const [label, files] of Object.entries(surfaces)) {
    for (const f of files) { scanned++; const h = hitsIn(f); if (h.length) bad.push(`${path.relative(root, f)} [${h.join(', ')}]`); }
    if (!files.length) console.log(`     note: ${label} has no files`);
  }
  if (expected.length) console.log(`     note (expected, not failed): ${expected.join('; ')}`);
  report('a1', 'runtime logs/configs free of outside paths', bad.length === 0, `${scanned} files scanned${bad.length ? `, ${bad.length} with hits: ${bad.slice(0, 20).join('; ')}${bad.length > 20 ? ' ...' : ''}` : ''}`);
}

// a2: tracked code and config files of the five clones. Docs (*.md, *.txt, anything under a
// docs/ folder) are reported as informational and do not fail the check.
{
  const bad = [];
  const docs = [];
  const isDoc = (f) => /\.(md|txt)$/i.test(f) || /(^|\/)docs\//i.test(f);
  for (const c of clones) {
    const args = ['-C', c.dir, 'grep', '-I', '-l', '-i', '-F'];
    for (const n of needles) args.push('-e', n.text);
    const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status === 1) continue;                         // no match
    if (r.status !== 0) { bad.push(`${c.repo}: git grep failed (${(r.stderr || '').trim()})`); continue; }
    const files = r.stdout.split(/\r?\n/).filter(Boolean);
    const code = files.filter((f) => !isDoc(f));
    const doc = files.length - code.length;
    if (doc) docs.push(`${c.repo} ${doc}`);
    if (code.length) bad.push(`${c.repo}: ${code.length} (${code.slice(0, 5).join(', ')}${code.length > 5 ? ', ...' : ''})`);
  }
  if (docs.length) console.log(`     note (informational): doc files with hits: ${docs.join(', ')}`);
  report('a2', 'clone tracked code/config files free of outside paths', bad.length === 0, bad.join('; '));
}

// b: clean working trees
{
  const bad = [];
  for (const c of [...clones, { repo: 'ces-muster-run (package)', dir: pkg }]) {
    const r = spawnSync('git', ['-C', c.dir, 'status', '--porcelain'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) { bad.push(`${c.repo}: git status failed`); continue; }
    const lines = r.stdout.split(/\r?\n/).filter(Boolean);
    if (lines.length) bad.push(`${c.repo}: ${lines.length} (${lines.slice(0, 5).join(', ')}${lines.length > 5 ? ', ...' : ''})`);
  }
  report('b', 'git status --porcelain empty in the five clones and the package', bad.length === 0, bad.join('; '));
}

// c: snapshot-outside before/after (same comparison as snapshot-outside.ps1 -CompareTo)
{
  const snapDir = path.join(out, 'snapshots');
  const readSnap = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  const beforeP = path.resolve(a.before ?? path.join(snapDir, 'before.json'));
  const afterP = path.resolve(a.after ?? path.join(snapDir, 'after.json'));
  let pass = false, detail;
  try {
    const prev = readSnap(beforeP), cur = readSnap(afterP);
    const changed = [];
    for (const [k, b] of Object.entries(cur.folders ?? {})) {
      const p = prev.folders?.[k];
      if (!p) { changed.push(`${k} (new)`); continue; }
      if (p.count !== b.count) changed.push(`${k} count ${p.count} -> ${b.count}`);
      if ('max_mtime' in p && p.max_mtime !== b.max_mtime) changed.push(`${k} mtime changed`);
      if ('names' in p && (p.names ?? []).join(',') !== (b.names ?? []).join(',')) changed.push(`${k} names changed`);
    }
    for (const [k, b] of Object.entries(cur.repos ?? {})) {
      const p = prev.repos?.[k];
      if (!p) { changed.push('a current-build repo (new)'); continue; }
      if (p.head !== b.head) changed.push(`repo HEAD ${p.head} -> ${b.head}`);
      if (p.status_sha !== b.status_sha) changed.push(`repo git status changed (${p.status_lines} -> ${b.status_lines} lines)`);
    }
    pass = changed.length === 0;
    detail = `${path.basename(beforeP)} vs ${path.basename(afterP)}${changed.length ? `: ${changed.join('; ')}` : ''}`;
  } catch (e) {
    detail = `cannot read snapshots (${e instanceof Error ? e.message : String(e)})`;
  }
  report('c', 'snapshot-outside unchanged', pass, detail);
}

const ok = results.every(Boolean);
console.log(`V24: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
