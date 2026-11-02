#!/usr/bin/env node
// Re-baseline one scenario from the run currently in <WS>/out and archive it as a proof run.
// Orchestrator tooling (W7, 2026-10-29). Gated by the predicted-vs-observed rule: run it only after the
// phase log records why every red is explained (honest re-baseline), never to make a red run green.
//
//   node scripts/rebaseline.mjs --ws C:/ces-nb --scenario s1-mach --label nb-run65b-s1-w7r1 [--dry]
//
// Copies: out/summary.json + out/verify.json -> expected-outputs/<slug>/; the newest out/runs/<id>/evidence/raw/manifest.json
// -> hashes.json; out/runs/<id>/evidence/shared/ -> bundle/ (replaced); and the proof-run set (GAPS-<slug>.{json,md},
// poam.json, scorecard-<slug>.json, ssp.json, summary.json, verify.json) -> proof-runs/<label>/ with a README stub the
// orchestrator completes. muster-partial keeps its files at the expected-outputs root.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : [])).filter((x) => x.length));
const ws = path.resolve(String(args.ws ?? 'C:/ces-nb'));
const slug = String(args.scenario ?? '');
const label = String(args.label ?? '');
const dry = args.dry === true;
if (!slug || !label) { console.error('usage: --ws <WS> --scenario <slug> --label <proof-run name> [--dry]'); process.exit(2); }

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ws, 'out');
const dest = slug === 'muster-partial' ? path.join(pkg, 'expected-outputs') : path.join(pkg, 'expected-outputs', slug);
const runs = fs.readdirSync(path.join(out, 'runs')).filter((d) => d.startsWith('run-')).sort();
const runId = runs[runs.length - 1];
if (!runId) { console.error('no out/runs/<id>'); process.exit(1); }
const raw = path.join(out, 'runs', runId, 'evidence', 'raw');
const shared = path.join(out, 'runs', runId, 'evidence', 'shared');
const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
if (summary.scenario && summary.scenario !== slug) { console.error(`out/summary.json is for ${summary.scenario}, not ${slug}`); process.exit(1); }
const verify = JSON.parse(fs.readFileSync(path.join(out, 'verify.json'), 'utf8'));
const checks = verify.checks ?? verify.results ?? [];
const failed = checks.filter((c) => c.pass === false || c.status === 'FAIL').map((c) => c.id);
console.log(`${dry ? '[dry] ' : ''}re-baseline ${slug} from ${runId}: ${checks.length} checks, failed: ${failed.length ? failed.join(', ') : 'none'}`);

const copies = [
  [path.join(out, 'summary.json'), path.join(dest, 'summary.json')],
  [path.join(out, 'verify.json'), path.join(dest, 'verify.json')],
  [path.join(raw, 'manifest.json'), path.join(dest, 'hashes.json')],
];
const proof = path.join(dest, 'proof-runs', label);
for (const f of [`GAPS-${slug}.json`, `GAPS-${slug}.md`, 'poam.json', `scorecard-${slug}.json`, 'ssp.json', 'summary.json', 'verify.json']) {
  if (fs.existsSync(path.join(out, f))) copies.push([path.join(out, f), path.join(proof, f)]);
  else console.log(`  (no out/${f}; skipped)`);
}
for (const [from, to] of copies) {
  console.log(`  ${path.relative(ws, from)} -> ${path.relative(pkg, to)}`);
  if (!dry) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
}
console.log(`  ${path.relative(ws, shared)}/ -> ${path.relative(pkg, path.join(dest, 'bundle'))}/ (replaced)`);
if (!dry) {
  fs.rmSync(path.join(dest, 'bundle'), { recursive: true, force: true });
  fs.cpSync(shared, path.join(dest, 'bundle'), { recursive: true });
  const readme = path.join(proof, 'README.md');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, `# ${label} (${new Date().toISOString().slice(0, 10)}): ${slug}\n\nRe-baselined from ${runId}. Verify: ${checks.length - failed.length}/${checks.length}${failed.length ? ` (explained reds: ${failed.join(', ')})` : ''}. Fill in the counts and the reason from the phase log.\n`);
}
console.log(dry ? 'dry run: nothing written' : 'done');
