// Cost-gate check tests (COST-GATE-SPEC.md §6.3, renumbered V103-V108; LOG-GC-CG.md §7): node --test scripts/gap-cg.test.mjs
// The V103-V108 judges over synthetic plans, notices, registries, manifests and statuses; the real cost data, Muster's
// regenerated m365_azure manifest fixture and the W9-R3b statuses when the workspace has them; the verify.mjs wiring by
// text (LF, V101 / V102 reserved). Nothing in the workspace is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  judgeV103, judgeV104, judgeV105, judgeV106, judgeV107, judgeV108, canonicalJson, planEntryIds,
  COST_GATED_OFF, V103_GATED_ENTRY, V104_NOTICE_ITEMS, V106_FIREWALL_ENTRIES, V107_IM_EXPECTED, V108_ESCROW_FILE, V108_VAULT_FILE,
} from './verify-gap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(HERE, '..', '..', '..');
const CES = path.join(WS, 'ces');
const sha256Hex = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const readIf = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) : null);

// ---------- V103 ----------
const gatedKv = { entry_id: V103_GATED_ENTRY, control_ids: ['SC.L2-3.13.10'], state: 'off', reason: COST_GATED_OFF, cause: 'no_dp1', cost_key: 'azure.keyvault.standard_ops', price_date: '2026-10-31' };
const plan = (over = {}, subs = [{ id: 'SC.L2-3.13.10.key-escrow' }, { id: 'IR.L2-3.6.1.atp-enable' }]) => ({
  execution_graph: [{ id: 'task-1', action: { args: { _sub_commands: subs } } }],
  variables: { _cost_gate: { price_date: '2026-10-31', gated_off: [gatedKv], acked: [], ...over } },
});
const recurringIds = [V103_GATED_ENTRY, 'AZ-FW-001'];

test('V103 passes when the key vault is gated off, nothing is acked, no recurring entry runs and no DP-2 / AO enable', () => {
  const r = judgeV103({ plan: plan(), recurringIds, evidence: [{ file: 'x-dp1.json', dp: 1, outcome: 'refused' }], aoRows: [{ op: 'A-19', outcome: null }] });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /1 entr\(y\/ies\) gated off \(SC\.L2-3\.13\.10\.key-vault\), 0 acked, 0 recurring entries in the plan, 1 cost-gate record\(s\) this run \(DP-1 1, DP-2 accepted 0\), 1 E7A AO row/);
  assert.deepEqual(planEntryIds(plan()), ['task-1', 'SC.L2-3.13.10.key-escrow', 'IR.L2-3.6.1.atp-enable']);
});

test('V103 fails on each breach, and names a pre-cost-gate plan', () => {
  assert.match(judgeV103({ plan: null, recurringIds }).detail, /no out\/executable-plan\.json/);
  assert.match(judgeV103({ plan: { execution_graph: [], variables: {} }, recurringIds }).detail, /no variables\._cost_gate \(Stamper built before the cost gate/);
  assert.match(judgeV103({ plan: plan(), recurringIds: null }).detail, /no cost catalogue/);
  for (const [args, re] of [
    [{ plan: plan({ gated_off: [] }) }, /SC\.L2-3\.13\.10\.key-vault is not in _cost_gate\.gated_off/],
    [{ plan: plan({ gated_off: [{ ...gatedKv, reason: 'other' }] }) }, /gated off with reason other/],
    [{ plan: plan({ acked: [{ entry_id: 'AZ-FW-001' }] }) }, /acked recurring entries: AZ-FW-001/],
    [{ plan: plan({}, [{ id: V103_GATED_ENTRY }]) }, /recurring entries in the executable plan: SC\.L2-3\.13\.10\.key-vault/],
    [{ plan: plan(), evidence: [{ file: 'k-dp2.json', dp: 2, outcome: 'accepted' }] }, /accepted DP-2 record\(s\) in this run: k-dp2\.json/],
    [{ plan: plan(), aoRows: [{ op: 'F-12', outcome: 'enabled' }] }, /AO enabled a recurring op in E7A: F-12/],
  ]) {
    const r = judgeV103({ recurringIds, ...args });
    assert.equal(r.pass, false, JSON.stringify(args).slice(0, 80));
    assert.match(r.detail, re);
  }
});

// ---------- V104 ----------
const items = [{ item_id: 'AZ-LOG-001', kind: 'infra_resource', label: 'Workspace', cost_key: 'azure.loganalytics.ingest', estimate_month_low: 0, estimate_month_high: 27, basis: 'b', two_person: false, last_resort: false, standard_alternative: ['none: x'], why_in_plan: 'w' }];
const notice = (its = items) => ({ price_date: '2026-10-31', items: its, licence_dependencies: [], total_estimate_low: 0, total_estimate_high: 27, items_hash: sha256Hex(canonicalJson(its)), note: 'n' });
const rec = (n) => ({ schema: 'mx-e2e/plan-compile@1', http_status: 200, recurring_cost_notice: n });

test('V104 passes when the hash is canonical, the count fits the scenario and the compile body carries the same notice', () => {
  const n = notice();
  const r = judgeV104({ slug: 's1-mach', mp: { recurring_cost_notice: n }, record: rec(JSON.parse(JSON.stringify(n))), e3Mode: 'api', sha256Hex });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /1 item\(s\) \(want >= 1\).*items_hash ok; compile 200 body's notice equals the Mission Plan's; not yet checked: MX_SUMMARY/);
  // FIN-01 (d): S3 answers SIT-020 m365_azure, so it lists items like the others.
  const s3 = judgeV104({ slug: 's3-def', mp: { recurring_cost_notice: n }, record: rec(JSON.parse(JSON.stringify(n))), e3Mode: 'api', sha256Hex });
  assert.equal(s3.pass, true, s3.detail);
  assert.deepEqual(V104_NOTICE_ITEMS, { 's1-mach': 'some', 's2-eng': 'some', 'muster-partial': 'some', 's3-def': 'some' });
  assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
});

test('V104 fails on a bad hash, a wrong count, a missing or different compile body; E3 not via the API is "not run"', () => {
  const n = notice();
  const mp = { recurring_cost_notice: n };
  for (const [args, re] of [
    [{ mp: null }, /no pushed Mission Plan/],
    [{ mp: {} }, /no recurring_cost_notice \(Muster built before CG-8\?\)/],
    [{ mp: { recurring_cost_notice: { ...n, items_hash: 'f'.repeat(64) } } }, /items_hash ffffffffffff\.\.\. is not the canonical SHA-256/],
    [{ slug: 's3-def', mp: { recurring_cost_notice: notice([]) }, record: rec(notice([])) }, /s3-def compiles m365_azure, so the notice must list at least 1 item/],
    [{ mp: { recurring_cost_notice: notice([]) }, record: rec(notice([])) }, /s1-mach compiles m365_azure, so the notice must list at least 1 item/],
    [{ record: null }, /compile body: no out\/plan-compile\.json/],
    [{ record: { schema: 'mx-e2e/plan-compile@1' } }, /records no recurring_cost_notice \(pkg plan-compile\.mjs before PKG-2\?\)/],
    [{ record: rec(null) }, /the 200 body carried no recurring_cost_notice \(muster-api built before CG-8\?\)/],
    [{ record: rec({ ...n, total_estimate_high: 99 }) }, /the 200 body's recurring_cost_notice differs/],
    [{ recordStale: 'stale artefact from an earlier run: plan-compile.json' }, /compile body: stale artefact/],
  ]) {
    const r = judgeV104({ slug: 's1-mach', mp, record: rec(n), e3Mode: 'api', sha256Hex, ...args });
    assert.equal(r.pass, false, JSON.stringify(args).slice(0, 80));
    assert.match(r.detail, re);
  }
  const script = judgeV104({ slug: 's1-mach', mp, record: null, e3Mode: 'script', sha256Hex });
  assert.equal(script.pass, true, script.detail);
  assert.match(script.detail, /compile body: not run \(E3 mode script, not api\)/);
});

// ---------- V105 ----------
const prices = { 'azure.firewall.premium': { label: 'FW' }, 'entra.id_governance': { label: 'Gov' } };
const entry = (id, cost_gate, extra = {}) => ({ entry_id: id, label: `L ${id}`, control_ids: ['SC.L1-3.13.1'], set_command: 'Get-Thing', ...(cost_gate ? { cost_gate } : {}), ...extra });
const regs = (entries) => [{ source: 'ces-stamper:infra-cmmc-l2-commands.registry.json', entries }];
const catOf = (registries) => ({ items: registries.flatMap((r) => r.entries.filter((e) => e.cost_gate).map((e) => ({ item_id: e.entry_id, kind: 'registry_entry', source: r.source, label: e.label, control_ids: e.control_ids, cost_gate: e.cost_gate }))) });
const good = [
  entry('AZ-NSG-006', { recurring: false, free_reason: 'no_meter' }),
  entry('AZ-FW-001', { recurring: true, cost_key: 'azure.firewall.premium', last_resort: true, standard_alternative: ['AZ-NSG-006'] }, { set_command: 'New-AzFirewall -Name x' }),
  entry('PS.L2-3.9.2.leaver-workflow', { recurring: false, free_reason: 'read_only', licence_dependency: { licence: 'Entra ID Governance', cost_key: 'entra.id_governance' } }),
];
const costly = (s) => (/New-AzFirewall/.test(s ?? '') ? ['New-AzFirewall'] : []);
const NOW = Date.parse('2026-11-01T00:00:00Z');

test('V105 passes on clean registries, a matching catalogue and a fresh price date', () => {
  const r = judgeV105({ registries: regs(good), catalogue: catOf(regs(good)), estimates: { price_date: '2026-10-31', prices }, costlyPatternsIn: costly, nowMs: NOW });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /CG-lint items 1-4 and 6 clean over 3 entries; 3 registry_entry catalogue rows match the registries \(1 recurring\); price_date 2026-10-31 \(1 days old, limit 180\)/);
});

test('V105 fails on each CG-lint item, on drift, on an old price date, and when the costly list is not built', () => {
  const run = (entries, over = {}) => judgeV105({ registries: regs(entries), catalogue: catOf(regs(entries)), estimates: { price_date: '2026-10-31', prices }, costlyPatternsIn: costly, nowMs: NOW, ...over });
  for (const [entries, re] of [
    [[...good, entry('AZ-FW-002', null, { set_command: 'New-AzFirewall -Name y' })], /AZ-FW-002: SET matches New-AzFirewall but has no cost_gate/],
    [[...good, entry('X-1', { recurring: false, free_reason: 'per_call_only' })], /X-1: free without a free_reason from the closed list/],
    [[...good, entry('X-2', { recurring: true, cost_key: 'nope', standard_alternative: ['AZ-NSG-006'] })], /X-2: recurring with cost_key nope not in the price file/],
    [[...good, entry('X-3', { recurring: true, cost_key: 'azure.firewall.premium' })], /X-3: recurring without a standard_alternative/],
    [[...good, entry('X-4', { recurring: true, cost_key: 'azure.firewall.premium', standard_alternative: ['AZ-GONE'] })], /X-4: standard_alternative AZ-GONE is not a registry entry/],
    [[...good, entry('X-5', { recurring: true, cost_key: 'azure.firewall.premium', last_resort: true, standard_alternative: ['none: nothing else'] })], /X-5: last_resort without an existing standard alternative/],
    [[...good, entry('X-6', { recurring: false, free_reason: 'read_only', licence_dependency: { licence: 'L', cost_key: 'no.key' } })], /X-6: licence cost_key no\.key not in the price file/],
  ]) {
    const r = run(entries);
    assert.equal(r.pass, false, String(re));
    assert.match(r.detail, re);
  }
  const drift = judgeV105({ registries: regs(good), catalogue: { items: [...catOf(regs(good)).items.slice(1), { item_id: 'GHOST', kind: 'registry_entry', cost_gate: {} }] }, estimates: { price_date: '2026-10-31', prices }, costlyPatternsIn: costly, nowMs: NOW });
  assert.equal(drift.pass, false);
  assert.match(drift.detail, /catalogue drift \(2\): AZ-NSG-006 missing from the catalogue; GHOST in the catalogue but no registry entry has a cost_gate for it/);
  const changed = catOf(regs(good));
  changed.items[0].cost_gate = { recurring: false, free_reason: 'free_source' };
  assert.match(run(good, { catalogue: changed }).detail, /AZ-NSG-006 differs from its registry entry/);
  assert.match(run(good, { estimates: { price_date: '2026-04-01', prices } }).detail, /price_date 2026-04-01 is 214 days old \(limit 180\)/);
  const unbuilt = run(good, { costlyPatternsIn: null });
  assert.equal(unbuilt.pass, false);
  assert.match(unbuilt.detail, /CG-lint item 1 not judged: the costly-cmdlet list \(ces-stamper dist\/core\/CostGate\.js\) is not built/);
  assert.match(judgeV105({ registries: regs(good), catalogue: null, estimates: {} }).detail, /no cost catalogue/);
});

test('V105 over the workspace cost data (when present): the catalogue has no drift and the price date is fresh', { skip: !fs.existsSync(path.join(CES, 'ces-shared', 'src', 'data', 'cost-items.reference.json')) }, () => {
  const regDir = path.join(CES, 'ces-stamper', 'src', 'registry');
  const registries = ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'].map((f) => ({ source: `ces-stamper:${f}`, entries: readIf(path.join(regDir, f)).entries }));
  const r = judgeV105({
    registries, catalogue: readIf(path.join(CES, 'ces-shared', 'src', 'data', 'cost-items.reference.json')),
    estimates: readIf(path.join(CES, 'ces-shared', 'src', 'data', 'cost-estimates.reference.json')), costlyPatternsIn: () => [], nowMs: Date.parse('2026-11-01T00:00:00Z'),
  });
  assert.equal(r.pass, true, r.detail);
});

// ---------- V106 ----------
const f12 = { id: 'F-12', sodTier: 'Tier 3', cost_gate: { recurring: true, last_resort: true, standard_alternative: ['AZ-NSG-006'] } };

test('V106 passes with no firewall entry, F-12 Tier 3 last resort, and no F-12 at E7A; fails on each breach', () => {
  const ok = judgeV106({ plan: plan(), aoRegistry: [f12], e7a: { ops: [{ op: 'A-19' }] } });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /F-12 is Tier 3, recurring and last_resort \(alternatives AZ-NSG-006\); E7A ran no F-12/);
  assert.match(judgeV106({ plan: plan(), aoRegistry: [f12], e7a: null }).detail, /no E7A record \(-Harness mx\)/);
  assert.deepEqual(V106_FIREWALL_ENTRIES, ['AZ-FW-000', 'AZ-FW-001', 'AZ-FW-002', 'AZ-FW-004', 'AZ-NET-005']);
  for (const [args, re] of [
    [{ plan: plan({}, [{ id: 'AZ-NET-005' }]) }, /firewall entries in the executable plan: AZ-NET-005/],
    [{ aoRegistry: [{ ...f12, sodTier: 'Tier 2' }] }, /F-12 sodTier Tier 2, want Tier 3/],
    [{ aoRegistry: [{ ...f12, cost_gate: {} }] }, /not recurring \+ last_resort \(AO built before CG-5\?\)/],
    [{ aoRegistry: [] }, /F-12 not in the AO registry/],
    [{ e7a: { ops: [{ op: 'F-12' }] } }, /E7A ran F-12/],
  ]) {
    const r = judgeV106({ plan: plan(), aoRegistry: [f12], e7a: { ops: [] }, ...args });
    assert.equal(r.pass, false, String(re));
    assert.match(r.detail, re);
  }
});

test('V106 over the workspace AO registry (when present): F-12 is Tier 3, recurring and last resort', { skip: !fs.existsSync(path.join(CES, 'ces-ao', 'src', 'registry', 'ao-commands.registry.json')) }, () => {
  const r = judgeV106({ plan: plan(), aoRegistry: readIf(path.join(CES, 'ces-ao', 'src', 'registry', 'ao-commands.registry.json')), e7a: { ops: [] } });
  assert.equal(r.pass, true, r.detail);
});

// ---------- V107 ----------
const im = (over = {}) => ({ infrastructure: {
  logging: [{ resource_type: 'log_analytics_workspace', name: 'law', properties: { retention_days: 90 } }],
  security: [{ resource_type: 'defender_for_cloud', name: 'd', properties: { plans: [{ name: 'VirtualMachines', tier: 'Free' }] } }],
  storage: [{ resource_type: 'key_vault', name: 'kv', properties: { sku: 'Standard' } }, { resource_type: 'key_vault_key', name: 'k', properties: { key_type: 'RSA' } }],
  network: [{ resource_type: 'subnet', name: 'snet-pe' }, { resource_type: 'service_endpoint_policy', name: 'sep' }],
  provenance: [{ field: 'x' }],
  ...over,
} });

test('V107 passes on a defaults-off m365_azure manifest, S3 included (FIN-01 d); fails on each paid default', () => {
  const ok = judgeV107({ slug: 's1-mach', im: im() });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /1 Defender plan\(s\) Free, 1 Standard vault\(s\), 1 RSA key\(s\), 1 workspace\(s\) at 90 days/);
  assert.equal(judgeV107({ slug: 's3-def', im: im() }).pass, true);
  assert.deepEqual(V107_IM_EXPECTED, { 's1-mach': true, 's2-eng': true, 'muster-partial': true, 's3-def': true });
  for (const [args, re] of [
    [{ im: null }, /s1-mach compiles m365_azure but this run pushed no Infrastructure Manifest/],
    [{ slug: 's3-def', im: null }, /s3-def compiles m365_azure but this run pushed no Infrastructure Manifest/],
    [{ im: im({ security: [{ resource_type: 'defender_for_cloud', name: 'd', properties: { plans: [{ name: 'VirtualMachines', tier: 'Standard' }] } }] }) }, /Defender plans not Free: VirtualMachines Standard/],
    [{ im: im({ storage: [{ resource_type: 'key_vault', name: 'kv', properties: { sku: 'Premium' } }, { resource_type: 'key_vault_key', name: 'k', properties: { key_type: 'RSA-HSM' } }] }) }, /vault not Standard: kv Premium; key not RSA \(software\): k RSA-HSM/],
    [{ im: im({ logging: [{ resource_type: 'log_analytics_workspace', name: 'law', properties: { retention_days: 365 } }] }) }, /Log Analytics retention not 90 days: law 365/],
    [{ im: im({ network: [{ resource_type: 'subnet', name: 'AzureFirewallSubnet' }, { resource_type: 'private_endpoint', name: 'pe' }, { resource_type: 'private_dns_zone', name: 'z' }] }) }, /AzureFirewallSubnet present; 1 private_endpoint\(s\); 1 private_dns_zone\(s\)/],
  ]) {
    const r = judgeV107({ slug: 's1-mach', im: im(), ...args });
    assert.equal(r.pass, false, String(re));
    assert.match(r.detail, re);
  }
});

test('V107 over Muster\'s regenerated m365_azure manifest fixture (when present): the defaults are off', { skip: !fs.existsSync(path.join(CES, 'ces-muster', 'src', 'features', 'plan', '__fixtures__', 'infrastructure-manifest.json')) }, () => {
  const r = judgeV107({ slug: 's1-mach', im: readIf(path.join(CES, 'ces-muster', 'src', 'features', 'plan', '__fixtures__', 'infrastructure-manifest.json')) });
  assert.equal(r.pass, true, r.detail);
});

// ---------- V108 ----------
const W = { 'SC.L2-3.13.10': 1, 'PS.L2-3.9.2': 5, 'AC.L1-3.1.1': 5 };
const weightOf = (id) => W[id] ?? 0;
const baseBy = { 'SC.L2-3.13.10': 'met', 'PS.L2-3.9.2': 'met', 'AC.L1-3.1.1': 'not_met' };
const ev = [V108_ESCROW_FILE, 'ia.l2-3.5.3.mfa.json'];

test('V108 passes on Branch B (unchanged) and Branch A (SC.L2-3.13.10 met -> not_met, SPRS -1)', () => {
  const b = judgeV108({ statusBy: { ...baseBy }, baselineBy: baseBy, baselineName: 'gc-w9r3b', weightOf, evFiles: ev });
  assert.equal(b.pass, true, b.detail);
  assert.match(b.detail, /Branch B: SC\.L2-3\.13\.10 met as in gc-w9r3b; SPRS 105 \(gc-w9r3b 105\)/);
  const a = judgeV108({ statusBy: { ...baseBy, 'SC.L2-3.13.10': 'not_met' }, baselineBy: baseBy, baselineName: 'gc-w9r3b', weightOf, evFiles: ev });
  assert.equal(a.pass, true, a.detail);
  assert.match(a.detail, /Branch A: SC\.L2-3\.13\.10 met -> not_met .*-1\); SPRS 104 \(gc-w9r3b 105\)/);
});

test('V108 fails on any other moved status (NS-3b\'s PS row named), an odd SC.L2-3.13.10 move, and the evidence clauses', () => {
  const moved = judgeV108({ statusBy: { ...baseBy, 'PS.L2-3.9.2': 'not_met' }, baselineBy: baseBy, baselineName: 'gc-w9r3b', weightOf, evFiles: ev });
  assert.equal(moved.pass, false);
  assert.match(moved.detail, /1 control\(s\) moved from gc-w9r3b \(not the cost gate's exception\): PS\.L2-3\.9\.2 met -> not_met \(SPRS 100, gc-w9r3b 105\)/);
  assert.match(judgeV108({ statusBy: { ...baseBy, 'SC.L2-3.13.10': 'not_assessed' }, baselineBy: baseBy, weightOf, evFiles: ev }).detail, /neither Branch A/);
  assert.match(judgeV108({ statusBy: baseBy, baselineBy: baseBy, weightOf, evFiles: ['x.json'] }).detail, /no sc\.l2-3\.13\.10\.key-escrow\.json in this run's Stamper evidence/);
  assert.match(judgeV108({ statusBy: baseBy, baselineBy: baseBy, weightOf, evFiles: [...ev, V108_VAULT_FILE] }).detail, /sc\.l2-3\.13\.10\.key-vault\.json written in this run \(the vault step ran\)/);
  assert.match(judgeV108({ statusBy: baseBy, baselineBy: baseBy, weightOf, evFiles: null }).detail, /Stamper evidence of this run not read/);
  assert.match(judgeV108({ statusBy: null, baselineBy: baseBy, weightOf }).detail, /no out\/ssp\.json statuses/);
  assert.match(judgeV108({ statusBy: baseBy, baselineBy: baseBy, weightOf: null }).detail, /no SPRS weights/);
});

test('V108 over the W9-R3b statuses (when present): SPRS recomputes to 82 / 87 / 30 / 48 and each run equals itself', { skip: !fs.existsSync(path.join(CES, 'ces-shared', 'dist', 'data', 'sprs-weights.json')) }, () => {
  const w = new Map(readIf(path.join(CES, 'ces-shared', 'dist', 'data', 'sprs-weights.json')).controls.map((c) => [c.control_id, Number(c.weight)]));
  for (const [slug, want] of [['s1-mach', 82], ['s2-eng', 87], ['s3-def', 30], ['muster-partial', 48]]) {
    const s = readIf(path.join(WS, 'evidence', `gc-w9r3b-${slug}`, 'summary.json'));
    if (!s) continue;
    const r = judgeV108({ statusBy: s.status_by_control, baselineBy: s.status_by_control, baselineName: 'gc-w9r3b', weightOf: (id) => w.get(id) ?? 0, evFiles: [V108_ESCROW_FILE] });
    assert.equal(r.pass, true, r.detail);
    assert.match(r.detail, new RegExp(`SPRS ${want} \\(gc-w9r3b ${want}\\)`), slug);
  }
});

// ---------- verify.mjs wiring ----------
test('verify.mjs wires V103-V108 once each, after V78 and before the result; V101 / V102 are reserved, not checked (LF only)', () => {
  const v = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  for (const id of ['V103', 'V104', 'V105', 'V106', 'V107', 'V108']) {
    assert.equal((v.match(new RegExp(`check\\('${id}'`, 'g')) ?? []).length, 1, id);
    assert.ok(v.indexOf("check('V78'") < v.indexOf(`check('${id}'`) && v.indexOf(`check('${id}'`) < v.indexOf('const result = {'), id);
  }
  for (const id of ['V101', 'V102']) assert.equal((v.match(new RegExp(`check\\('${id}'`, 'g')) ?? []).length, 0, id);
  assert.match(v, /V101 = out\/secret-scan\.json/);
  assert.match(v, /gapmod\.judgeV103\(\{ plan: exePlan, recurringIds, evidence: costEvidence, aoRows: aoCostRows \}\)/);
  assert.match(v, /gapmod\.judgeV107\(\{ slug, im: exists\(pIM\) && !staleOf\(pIM\) \? readJson\(pIM\) : null \}\)/);
  assert.equal((v.match(/\r/g) ?? []).length, 0);
  const pc = fs.readFileSync(path.join(HERE, 'plan-compile.mjs'), 'utf8');
  assert.match(pc, /rec\.recurring_cost_notice = j\.recurring_cost_notice \?\? null;/);
});
