// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { ObjectStore } from '../store/ObjectStore.js';
import type { Ledger } from '../ledger/Ledger.js';
import type { FaultInjector } from './FaultInjector.js';
import type { LedgerEntry } from '../ledger/LedgerTypes.js';

/**
 * Read-only inspector (2026-07-11): the sim's one visual surface.
 * Observability only — it renders what the store/ledger/fault table already
 * are; it can mutate nothing (the scenario mechanism stays the sole source
 * of tenant truth). Served by QueryServer at GET / (data at
 * GET /_inspector/data), fully self-contained: no external assets, no
 * frameworks, Windows-native font stacks.
 */

export interface InspectorTenantInfo {
  slug: string;
  stance: string;
  tenantRoot: string;
  startedAt: string;
}

export interface InspectorDeps {
  store?: ObjectStore;
  ledger?: Ledger;
  faultInjector?: FaultInjector;
  tenantInfo?: InspectorTenantInfo;
}

const LEDGER_TAIL = 40;

export async function buildInspectorData(deps: InspectorDeps): Promise<unknown> {
  const counts = deps.store ? await deps.store.collectionCounts() : {};
  const collections = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const totalObjects = collections.reduce((sum, c) => sum + c.count, 0);

  const entries: LedgerEntry[] = deps.ledger ? await deps.ledger.query({}) : [];
  const ledgerCounts = { create: 0, mutate: 0, 'read-serve': 0 } as Record<string, number>;
  for (const e of entries) ledgerCounts[e.type] = (ledgerCounts[e.type] ?? 0) + 1;
  const tail = entries.slice(-LEDGER_TAIL).map((e) => ({
    ts: e.ts,
    type: e.type,
    objectType: e.objectType,
    objectId: e.objectId,
    actor: e.actor,
    source: e.source,
  }));

  return {
    tenant: deps.tenantInfo ?? null,
    totalObjects,
    collections,
    ledger: { total: entries.length, counts: ledgerCounts, tail },
    faults: deps.faultInjector?.getRules() ?? [],
    generatedAt: new Date().toISOString(),
  };
}

/** The page shell. All data arrives via /_inspector/data polling (2.5s). */
export const INSPECTOR_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>stacksim inspector</title>
<style>
  :root {
    --ink: #10151d; --panel: #171e28; --line: #2a3442;
    --text: #d7dee8; --muted: #7d8a99; --banner: #d9a23c;
    --create: #5fd4c4; --mutate: #e0b458; --read: #8f9fe8; --fault: #e07a6a;
    --mono: "Cascadia Code", Consolas, "Courier New", monospace;
    --sans: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--ink); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.45; }
  a { color: var(--read); }
  .banner {
    background: var(--banner); color: #1a1408; font-family: var(--mono); font-size: 11px;
    letter-spacing: .18em; text-transform: uppercase; text-align: center; padding: 3px 8px;
  }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 20px; padding: 18px 24px 10px; }
  header h1 { font-family: var(--mono); font-size: 18px; font-weight: 600; letter-spacing: .02em; }
  .stance {
    font-family: var(--mono); font-size: 12px; color: var(--banner);
    border: 1px solid var(--banner); padding: 1px 8px; border-radius: 2px; letter-spacing: .08em;
  }
  .meta { color: var(--muted); font-family: var(--mono); font-size: 12px; }
  .rec { margin-left: auto; font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .rec .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--create); margin-right: 6px; animation: pulse 2.5s ease-in-out infinite; }
  .rec.stale .dot { background: var(--fault); animation: none; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
  @media (prefers-reduced-motion: reduce) { .rec .dot { animation: none } }

  /* Signature: the ledger tape — one tick per recent event, newest at the right. */
  .tape-wrap { padding: 6px 24px 2px; }
  .tape { display: flex; align-items: flex-end; gap: 2px; height: 34px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  .tape .tick { width: 6px; border-radius: 1px; min-height: 8px; }
  .tick.create { background: var(--create); height: 26px; }
  .tick.mutate { background: var(--mutate); height: 18px; }
  .tick.read-serve { background: var(--read); height: 10px; }
  .tape-legend { display: flex; gap: 18px; padding: 6px 0 0; font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .key { display: inline-block; width: 8px; height: 8px; border-radius: 1px; margin-right: 5px; }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; padding: 14px 24px; }
  .stat { background: var(--panel); border: 1px solid var(--line); border-radius: 2px; padding: 10px 14px; }
  .stat b { display: block; font-family: var(--mono); font-size: 26px; font-weight: 600; }
  .stat span { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
  .stat.create b { color: var(--create) } .stat.mutate b { color: var(--mutate) } .stat.read b { color: var(--read) }

  main { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(380px, 2fr); gap: 12px; padding: 0 24px 20px; }
  @media (max-width: 860px) { main { grid-template-columns: 1fr } }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 2px; padding: 12px 14px; }
  section h2 { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 12px; }
  th { text-align: left; color: var(--muted); font-weight: 400; padding: 2px 8px 6px 0; border-bottom: 1px solid var(--line); }
  td { padding: 3px 8px 3px 0; border-bottom: 1px solid color-mix(in srgb, var(--line) 45%, transparent); vertical-align: top; }
  .bar { height: 6px; background: var(--read); opacity: .55; border-radius: 1px; }
  .type { font-weight: 600; }
  .type.create { color: var(--create) } .type.mutate { color: var(--mutate) } .type.read-serve { color: var(--read) }
  .muted { color: var(--muted) }
  .faults .rule { font-family: var(--mono); font-size: 12px; padding: 4px 0; border-bottom: 1px solid color-mix(in srgb, var(--line) 45%, transparent); }
  .faults .kind { color: var(--fault); font-weight: 600; }
  .empty { color: var(--muted); font-size: 12px; }
  .empty code { font-family: var(--mono); color: var(--text); }
  footer { padding: 4px 24px 22px; color: var(--muted); font-family: var(--mono); font-size: 11px; }
</style>
</head>
<body>
<div class="banner">simulated tenant &middot; tenant-stacksim &middot; not a real cloud &middot; nothing here is production data</div>
<header>
  <h1>stacksim inspector</h1>
  <span class="stance" id="stance">&hellip;</span>
  <span class="meta" id="meta"></span>
  <span class="rec" id="rec"><span class="dot"></span><span id="recText">recording</span></span>
</header>
<div class="tape-wrap">
  <div class="tape" id="tape" aria-label="recent ledger events, newest right"></div>
  <div class="tape-legend">
    <span><span class="key" style="background:var(--create)"></span>create</span>
    <span><span class="key" style="background:var(--mutate)"></span>mutate</span>
    <span><span class="key" style="background:var(--read)"></span>read-serve</span>
    <span style="margin-left:auto" id="tapeNote"></span>
  </div>
</div>
<div class="stats">
  <div class="stat"><b id="sObjects">&ndash;</b><span>objects held</span></div>
  <div class="stat create"><b id="sCreate">&ndash;</b><span>creates</span></div>
  <div class="stat mutate"><b id="sMutate">&ndash;</b><span>mutations</span></div>
  <div class="stat read"><b id="sRead">&ndash;</b><span>reads served</span></div>
</div>
<main>
  <section>
    <h2>Collections</h2>
    <table><thead><tr><th>collection</th><th style="width:40px">count</th><th style="width:34%"></th></tr></thead>
    <tbody id="collections"></tbody></table>
  </section>
  <div style="display:flex; flex-direction:column; gap:12px">
    <section>
      <h2>Ledger tail</h2>
      <table><thead><tr><th>time</th><th>type</th><th>object</th><th>actor</th><th>source</th></tr></thead>
      <tbody id="ledger"></tbody></table>
    </section>
    <section class="faults">
      <h2>Fault rules armed</h2>
      <div id="faults"></div>
    </section>
  </div>
</main>
<footer id="footer"></footer>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let failures = 0;
async function refresh() {
  try {
    const res = await fetch('/_inspector/data');
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    failures = 0;
    $('rec').classList.remove('stale'); $('recText').textContent = 'recording';
    if (d.tenant) {
      $('stance').textContent = d.tenant.stance;
      const up = Math.max(0, (Date.now() - Date.parse(d.tenant.startedAt)) / 1000 | 0);
      $('meta').textContent = d.tenant.slug + ' \\u00b7 up ' + (up >= 90 ? Math.round(up/60) + 'm' : up + 's');
      $('footer').textContent = 'graph ' + location.origin + '/v1.0 \\u00b7 resolve POST /resolve \\u00b7 faults POST /_faults \\u00b7 tenant root ' + d.tenant.tenantRoot;
    }
    $('sObjects').textContent = d.totalObjects;
    $('sCreate').textContent = d.ledger.counts['create'] || 0;
    $('sMutate').textContent = d.ledger.counts['mutate'] || 0;
    $('sRead').textContent = d.ledger.counts['read-serve'] || 0;
    $('tape').innerHTML = d.ledger.tail.map((e) => '<div class="tick ' + esc(e.type) + '" title="' + esc(e.type + ' ' + e.objectType + '/' + e.objectId) + '"></div>').join('');
    $('tapeNote').textContent = d.ledger.total + ' events total, last ' + d.ledger.tail.length + ' shown';
    const maxCount = Math.max(1, ...d.collections.map((c) => c.count));
    $('collections').innerHTML = d.collections.map((c) =>
      '<tr><td>' + esc(c.name) + '</td><td>' + c.count + '</td><td><div class="bar" style="width:' + (100 * c.count / maxCount) + '%"></div></td></tr>').join('')
      || '<tr><td colspan="3" class="empty">nothing seeded yet</td></tr>';
    $('ledger').innerHTML = d.ledger.tail.slice().reverse().map((e) =>
      '<tr><td class="muted">' + esc((e.ts || '').slice(11, 19)) + '</td><td class="type ' + esc(e.type) + '">' + esc(e.type) + '</td><td>' + esc(e.objectType) + '<span class="muted">/' + esc(e.objectId) + '</span></td><td>' + esc(e.actor) + '</td><td class="muted">' + esc(e.source) + '</td></tr>').join('')
      || '<tr><td colspan="5" class="empty">no ledger events yet \\u2014 run a command against the sim</td></tr>';
    $('faults').innerHTML = d.faults.length
      ? d.faults.map((f) => '<div class="rule"><span class="kind">' + esc(f.kind) + '</span> \\u00b7 ' + esc(f.target) + ' <span class="muted">\\u00d7 ' + esc(f.times ?? 1) + '</span></div>').join('')
      : '<div class="empty">none armed \\u2014 arm one with <code>POST /_faults</code></div>';
  } catch {
    if (++failures >= 2) { $('rec').classList.add('stale'); $('recText').textContent = 'server unreachable'; }
  }
}
refresh();
setInterval(refresh, 2500);
</script>
</body>
</html>
`;
