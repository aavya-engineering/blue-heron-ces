#!/usr/bin/env node
// sim-pfx-sweep.mjs (Blue Heron Defense, CES team). FIN-29, secrets plan SP-11 "sim-PFX sweep": lists, and with --delete
// removes, the simulator's throwaway certificate files that earlier harness and test runs left behind (mixing point M10,
// docs/context/secrets/SECRETS-STORAGE.md). Simulator throwaways only:
//   - <...>/ao/sim/<slug>.pfx        (ces-tester ao-step.ts makeSimPfx, the E7A / E7C certificate)
//   - <...>/sim.pfx                  (the watched UI run's per-variant certificate)
//   - <...>/sim-cert.pfx             (ces-stamper's rollback test temp folders, w4-st3-rb-*)
// It refuses any root under the user's ~/.ces or ~/.stamper and under C:\certs, and never follows a link.
//   node sim-pfx-sweep.mjs [--root <dir> ...] [--delete]
// Default roots (SECRETS-PLAN.md SP-11): C:\ces-nb\tmp, C:\ces-nb\evidence, C:\ces-nb\ces\ces-tester\runs. Prints one line
// per file and a JSON summary (paths and sizes only; a file's bytes are never read). Exit 0.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ROOTS = ['C:\\ces-nb\\tmp', 'C:\\ces-nb\\evidence', 'C:\\ces-nb\\ces\\ces-tester\\runs'];

/** True for a simulator throwaway certificate path (by name and place, never by content). */
export function isSimThrowawayPfx(file) {
  const p = file.split(path.sep).join('/');
  const base = path.basename(p).toLowerCase();
  if (!base.endsWith('.pfx')) return false;
  if (base === 'sim.pfx' || base === 'sim-cert.pfx') return true;
  return /\/ao\/sim\/[^/]+\.pfx$/i.test(p);
}

/** Why a root must not be swept (null when it may). */
export function refusedRoot(root, home = os.homedir()) {
  const r = path.resolve(root).toLowerCase();
  const banned = [path.join(home, '.ces'), path.join(home, '.stamper'), 'C:\\certs'].map((b) => path.resolve(b).toLowerCase());
  for (const b of banned) if (r === b || r.startsWith(b + path.sep)) return `refused: ${root} is under ${b} (never swept)`;
  return null;
}

export function findSimPfx(roots) {
  const found = [];
  const walk = (d) => {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && isSimThrowawayPfx(p)) found.push(p);
    }
  };
  for (const r of roots) if (!refusedRoot(r) && fs.existsSync(r)) walk(r);
  return found.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const roots = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--root') roots.push(args[++i]);
  const del = args.includes('--delete');
  const use = roots.length ? roots : DEFAULT_ROOTS;
  const refused = use.map((r) => refusedRoot(r)).filter(Boolean);
  for (const r of refused) console.error(r);
  const files = findSimPfx(use);
  let removed = 0;
  for (const f of files) {
    const size = fs.statSync(f).size;
    if (del) { fs.rmSync(f, { force: true }); removed++; }
    console.log(`${del ? 'removed' : 'found  '} ${f} (${size} bytes)`);
  }
  console.log(JSON.stringify({ roots: use, refused, found: files.length, removed, mode: del ? 'delete' : 'list (pass --delete to remove)' }));
}
