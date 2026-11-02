#!/usr/bin/env node
// SBOM (software bill of materials) per install root, CycloneDX JSON.
//   node scripts/handoff/sbom.mjs [--kit <dir>] [--workspace <ces-mono root>] [--dry-run]
// An install root is the folder that holds the package-lock.json a component installs from
// (the ces-mono root for every workspace package; each nested repo; ces-muster/muster-api).
// For each one it runs `npm sbom --sbom-format cyclonedx` there and writes <kit>/sbom/<root>.cdx.json.
// Needs installed node_modules (run after bootstrap). --dry-run prints the commands and runs nothing.
// Exit 0 = every SBOM written; 1 = a failure.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile, FILES, DEFAULT_KIT } from './gen.mjs';
import { validateManifest } from './lib/validate.mjs';
import { DEFAULT_WORKSPACE, DEFAULT_PKG, repoDir } from './check.mjs';

/** Unique install roots for the manifest's components: [{ name, dir }]. */
export function installRoots(manifest, ws, pkg = DEFAULT_PKG) {
  const roots = new Map();
  for (const c of manifest.components) {
    const rd = repoDir(ws, pkg, c.repo);
    if (!rd) continue;
    const top = path.resolve(rd);
    // ces-mono packages are npm workspaces: they install from the repo root lockfile, whatever
    // stray lockfiles sit in their folders.
    let d = c.repo === 'ces-mono' ? top : path.resolve(rd, c.path);
    while (!fs.existsSync(path.join(d, 'package-lock.json')) && d !== top) d = path.dirname(d);
    if (!fs.existsSync(path.join(d, 'package-lock.json'))) continue;
    const name = d === top ? c.repo : c.id;
    if (!roots.has(d)) roots.set(d, { name, dir: d });
  }
  return [...roots.values()];
}

function main(argv) {
  let kit = DEFAULT_KIT;
  let ws = DEFAULT_WORKSPACE;
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--kit') kit = path.resolve(argv[++i]);
    else if (argv[i] === '--workspace') ws = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run') dry = true;
    else { console.error(`sbom: unknown argument ${argv[i]}`); return 1; }
  }
  const m = readYamlFile(path.join(kit, FILES.manifest));
  if (m.missing || m.error) { console.error(`sbom: ${m.error ?? `${FILES.manifest} missing`}`); return 1; }
  const v = validateManifest(m.doc);
  if (v.errors.length) { console.error(`sbom: manifest invalid: ${v.errors.join('; ')}`); return 1; }
  const outDir = path.join(kit, 'sbom');
  const roots = installRoots(m.doc, ws);
  let failed = 0;
  if (!dry) fs.mkdirSync(outDir, { recursive: true });
  for (const r of roots) {
    const out = path.join(outDir, `${r.name}.cdx.json`);
    const shown = `(cd ${path.relative(ws, r.dir) || '.'}) npm sbom --sbom-format cyclonedx > sbom/${r.name}.cdx.json`;
    if (dry) { console.log(shown); continue; }
    const res = spawnSync('npm', ['sbom', '--sbom-format', 'cyclonedx'], { cwd: r.dir, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 256 * 1024 * 1024 });
    if (res.status !== 0) {
      failed++;
      console.error(`FAIL ${r.name}: npm sbom exit ${res.status}: ${(res.stderr ?? '').trim().split(/\r?\n/).slice(-3).join(' | ')}`);
      continue;
    }
    fs.writeFileSync(out, res.stdout);
    console.log(`wrote sbom/${r.name}.cdx.json`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
