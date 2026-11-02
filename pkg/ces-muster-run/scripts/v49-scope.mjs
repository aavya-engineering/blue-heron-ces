#!/usr/bin/env node
// V49 scope (synthetic-customer W0): what the identity scan covers for one scenario, shared by verify.mjs (V49) and
// identity-scan.ps1 -Root/-Scenario.
//   node v49-scope.mjs --root <WS> --scenario <slug>      prints { roots, tokens, sources } as JSON
// Roots (each only when present):
//   bundle      the shared evidence bundle of the latest run (<WS>/out/runs/<run>/evidence/shared)
//   simulator   <WS>/ces/tenant-stacksim/scenarios/<slug>*.json (scenario + config); the materialised seed, including
//               the customer-history set's output (<WS>/ces/tenant-stacksim/.stacksim/tenants/<slug>/store.json)
//   customer    <package>/customers/<slug>/*.json (answers, org content, customer.json)
//   adminops    the AdminOps shared-database rows of the tenant (collections adminops_evidence, adminops_approvals in
//               <WS>/pl/ces.db, the CES_PIPELINE_ROOT database), opened read-only and written as text to
//               <WS>/out/v49/<slug>/adminops-rows.jsonl so the scanner can read them
//   eo-store    the EvidenceOps store of the tenant (<WS>/out/eo/evidence-store/<tenantId>/records.jsonl and payloads/)
// Tokens: every line of <WS>/nb-tools/scan-tokens.txt and the workstation user name (never the company name).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

/** True when the package carries a synthetic customer for this slug (customers/<slug>/customer.json). */
export function isSyntheticCustomer(slug, pkg = pkgRoot) {
  return fs.existsSync(path.join(pkg, 'customers', slug, 'customer.json'));
}

// The company name is NOT an identity token: Blue Heron Defense is the product's maker and may appear in generated
// output ("BHD assessment", generator names). The founder's identifiers (scan-tokens.txt) are the banned set.
export const V49_FIXED_TOKENS = [];

export function v49Tokens(root) {
  const tokens = [];
  const tokFile = path.join(root, 'nb-tools', 'scan-tokens.txt');
  if (fs.existsSync(tokFile)) tokens.push(...fs.readFileSync(tokFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  tokens.push(...V49_FIXED_TOKENS);
  const user = os.userInfo().username;
  if (user && user.length >= 3) tokens.push(`(?i)${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  return { tokens, tokenFile: fs.existsSync(tokFile) };
}

function adminOpsRows(root, slug) {
  const db = path.join(root, 'pl', 'ces.db');
  if (!fs.existsSync(db)) return { rows: null, note: 'no <WS>/pl/ces.db' };
  // node:sqlite is experimental in Node 22-24 and prints a warning on first use; it is silenced for this one load.
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  let DatabaseSync;
  try { ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite')); } finally { process.emitWarning = emit; }
  const d = new DatabaseSync(db, { readOnly: true });
  try {
    const rows = d.prepare("select collection, id, data from ces_records where collection in ('adminops_evidence', 'adminops_approvals') and tenant_slug = ? order by collection, id").all(slug);
    return { rows, note: `${rows.length} rows` };
  } finally { d.close(); }
}

export function v49Scope({ root, slug, pkg = pkgRoot }) {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(slug))) throw new Error(`v49-scope: "${slug}" is not a scenario slug`);
  const roots = [];
  const sources = {};
  const add = (kind, p) => { if (p && fs.existsSync(p)) { roots.push(p); (sources[kind] ??= []).push(p); } };
  const out = path.join(root, 'out');
  // bundle
  const latest = path.join(out, 'runs', 'latest.json');
  if (fs.existsSync(latest)) add('bundle', path.join(out, 'runs', readJson(latest).evidence, 'shared'));
  // simulator
  const sim = path.join(root, 'ces', 'tenant-stacksim');
  const scen = path.join(sim, 'scenarios');
  if (fs.existsSync(scen)) for (const f of fs.readdirSync(scen).filter((x) => x.startsWith(slug) && x.endsWith('.json')).sort()) add('simulator', path.join(scen, f));
  add('simulator', path.join(sim, '.stacksim', 'tenants', slug, 'store.json'));
  // customer: the data files only (answers, org content, customer.json). Source files (a generator script) carry the
  // repository's copyright header, which names the company by design, and are not customer data.
  const cust = path.join(pkg, 'customers', slug);
  if (fs.existsSync(cust)) for (const f of fs.readdirSync(cust).filter((x) => x.endsWith('.json')).sort()) add('customer', path.join(cust, f));
  // adminops (read-only; materialised as text inside <WS>/out)
  const ao = adminOpsRows(root, slug);
  sources.adminops_note = ao.note;
  if (ao.rows) {
    const f = path.join(out, 'v49', slug, 'adminops-rows.jsonl');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, ao.rows.map((r) => JSON.stringify({ collection: r.collection, id: r.id, data: r.data })).join('\n') + (ao.rows.length ? '\n' : ''));
    add('adminops', f);
  }
  // eo-store
  const storeRoot = path.join(out, 'eo', 'evidence-store');
  if (fs.existsSync(storeRoot)) {
    for (const d of fs.readdirSync(storeRoot).map((x) => path.join(storeRoot, x))) {
      const m = path.join(d, 'manifest.json');
      if (fs.existsSync(m) && readJson(m).tenantSlug === slug) { add('eo-store', path.join(d, 'records.jsonl')); add('eo-store', path.join(d, 'payloads')); }
    }
  }
  const { tokens, tokenFile } = v49Tokens(root);
  return { roots, tokens, tokenFile, sources };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const a = {};
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  if (!a.root || !a.scenario) { console.error('usage: node v49-scope.mjs --root <WS> --scenario <slug>'); process.exit(2); }
  process.stdout.write(JSON.stringify(v49Scope({ root: path.resolve(a.root), slug: a.scenario })));
}
