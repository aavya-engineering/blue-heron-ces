// apply-overrides.mjs (Blue Heron Defense, CES team). Plan item P1.5, interim for FX-11.
//   node apply-overrides.mjs --plan <executable-plan.json> --overrides <sim-overrides.json> --out <log.json>
// Merges SIM-ONLY operator values into the translated plan's `variables`, only where a key is missing,
// empty, or still an unresolved `{name}` token. Rewrites the plan in place (JSON, 2-space indent) and
// writes a log listing the keys applied and the keys the plan already had. Exit 0 on success.
import fs from 'node:fs';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
if (!a.plan || !a.overrides) { console.error('usage: --plan <file> --overrides <file> [--out <log>]'); process.exit(2); }

const plan = JSON.parse(fs.readFileSync(a.plan, 'utf8'));
const ov = JSON.parse(fs.readFileSync(a.overrides, 'utf8'));
if (ov._scope !== 'simulator only; never load against a live tenant') { console.error('refusing: overrides file is not marked simulator-only'); process.exit(3); }
plan.variables ??= {};
const token = /^\{[A-Za-z][A-Za-z0-9_]*\}$/;
const applied = [], kept = [];
for (const [k, v] of Object.entries(ov.variables ?? {})) {
  const cur = plan.variables[k];
  if (cur === undefined || cur === null || cur === '' || (typeof cur === 'string' && token.test(cur))) { plan.variables[k] = v; applied.push(k); }
  else kept.push(k);
}
fs.writeFileSync(a.plan, JSON.stringify(plan, null, 2) + '\n');
const log = { source: 'sim-overrides.json (SIM-ONLY)', applied, kept_plan_values: kept };
if (a.out) fs.writeFileSync(a.out, JSON.stringify(log, null, 2) + '\n');
console.log(`sim-only overrides applied: ${applied.length} (${applied.join(', ')}); plan already had: ${kept.length}`);
