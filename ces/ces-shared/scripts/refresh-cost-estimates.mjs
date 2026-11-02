// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// CG-2 remainder (COST-GATE-SPEC.md §3.3; FIN-40): refresh src/data/cost-estimates.reference.json
// from the Azure Retail Prices API (https://prices.azure.com/api/retail/prices; public, no sign-in).
//
// Only fixed-rate meters are refreshed: an hourly meter (x 730 h) or a monthly one. Usage-based keys
// (ingestion, operations, storage capacity, licences) keep their inventory figures and are listed as
// "kept". A key whose meter is not found in the Gov region falls back to a commercial region and is
// flagged commercial_list = true. A meter that matches more than one price is never guessed: the key
// is kept and reported as ambiguous.
//
// Modes:
//   node scripts/refresh-cost-estimates.mjs            dry run: fetch and print the changes (default)
//   node scripts/refresh-cost-estimates.mjs --write    fetch and write the price file (new price_date)
//   node scripts/refresh-cost-estimates.mjs --check    no network: exit 1 if price_date is over 180 days old (V103)
//   --file <path>      another price file (default: src/data/cost-estimates.reference.json)
//   --offline <path>   read meter items from a JSON file ({ "<filter>": Items[] }) instead of the API
//
// A new price_date voids every earlier DP-1 (its ackHash covers the estimate and the price date), so
// operators must opt in again after a --write. Run --write only on purpose, never in a harness run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = 'https://prices.azure.com/api/retail/prices';
export const HOURS_PER_MONTH = 730;
export const MAX_AGE_DAYS = 180;
export const GOV_REGION = 'usgovvirginia';
export const COMMERCIAL_REGION = 'eastus';

/**
 * The fixed-rate meters, keyed by cost_key. `match` fields are compared case-insensitively against
 * the Retail Prices item; `meterName` may be a RegExp. Keys absent here are usage-based and kept.
 */
export const METERS = {
  'azure.firewall.premium': { serviceName: 'Azure Firewall', skuName: 'Premium', meterName: /deployment/i, unit: '1 Hour' },
  'azure.firewall.standard': { serviceName: 'Azure Firewall', skuName: 'Standard', meterName: /deployment/i, unit: '1 Hour' },
  'azure.firewall.basic': { serviceName: 'Azure Firewall', skuName: 'Basic', meterName: /deployment/i, unit: '1 Hour' },
  'azure.public_ip.standard': { serviceName: 'Virtual Network', productName: 'IP Addresses', skuName: 'Standard', meterName: /static public ip/i, unit: '1 Hour' },
  'azure.bastion.standard': { serviceName: 'Azure Bastion', skuName: 'Standard', meterName: /gateway/i, unit: '1 Hour' },
  'azure.private_endpoint': { serviceName: 'Virtual Network', productName: 'Virtual Network Private Link', meterName: /private endpoint$/i, unit: '1 Hour' },
  'azure.private_dns_zone': { serviceName: 'Azure DNS', meterName: /private zone/i, unit: '1/Month' },
};

/** The OData filter for one meter in one region (narrow on service and region; the rest is matched locally). */
export function filterFor(meter, region) {
  return `serviceName eq '${meter.serviceName}' and armRegionName eq '${region}' and priceType eq 'Consumption'`;
}

function eq(a, b) { return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase(); }

/** Items that match a meter: consumption, first tier, same unit, and every named field. */
export function matchItems(items, meter) {
  return items.filter(it =>
    (it.type ?? 'Consumption') === 'Consumption'
    && (it.tierMinimumUnits ?? 0) === 0
    && eq(it.unitOfMeasure, meter.unit)
    && eq(it.serviceName, meter.serviceName)
    && (meter.productName === undefined || eq(it.productName, meter.productName))
    && (meter.skuName === undefined || eq(it.skuName, meter.skuName))
    && (meter.meterName === undefined || (meter.meterName instanceof RegExp ? meter.meterName.test(it.meterName ?? '') : eq(it.meterName, meter.meterName))));
}

/** Monthly figure from a unit price: hourly x 730, monthly as is, rounded to cents. */
export function monthlyFrom(unitPrice, unit) {
  const m = eq(unit, '1 Hour') ? unitPrice * HOURS_PER_MONTH : unitPrice;
  return Math.round(m * 100) / 100;
}

/** One unique price, or a reason it cannot be used. */
export function pickPrice(items, meter) {
  const hits = matchItems(items, meter);
  const prices = [...new Set(hits.map(h => h.retailPrice))];
  if (prices.length === 0) return { ok: false, reason: 'no_match' };
  if (prices.length > 1) return { ok: false, reason: `ambiguous (${prices.length} prices)` };
  const h = hits[0];
  return { ok: true, unitPrice: prices[0], unit: h.unitOfMeasure, meterName: h.meterName, region: h.armRegionName };
}

/** Age of the price file in whole days at `now`. */
export function ageDays(estimates, now = new Date()) {
  return Math.floor((now.getTime() - Date.parse(`${estimates.price_date}T00:00:00Z`)) / 86_400_000);
}

/**
 * The refreshed price file. `lookups` maps cost_key -> { gov?: pick, commercial?: pick }.
 * Returns { next, changes[], kept[], problems[] }; `next` has the new price_date only when something
 * was refreshed or confirmed.
 */
export function applyRefresh(estimates, lookups, today) {
  const next = JSON.parse(JSON.stringify(estimates));
  const changes = [], kept = [], problems = [];
  let confirmed = 0;
  for (const [key, entry] of Object.entries(estimates.prices)) {
    if (!METERS[key]) { kept.push({ key, reason: 'usage-based or licence: inventory figure kept' }); continue; }
    const l = lookups[key] ?? {};
    const pick = l.gov?.ok ? { ...l.gov, commercial: false } : l.commercial?.ok ? { ...l.commercial, commercial: true } : null;
    if (!pick) {
      problems.push({ key, reason: `gov ${l.gov?.reason ?? 'not looked up'}; commercial ${l.commercial?.reason ?? 'not looked up'}` });
      continue;
    }
    const month = monthlyFrom(pick.unitPrice, pick.unit);
    confirmed++;
    const was = { low: entry.estimate_month_low, high: entry.estimate_month_high, commercial_list: entry.commercial_list };
    const target = next.prices[key];
    target.estimate_month_low = month;
    target.estimate_month_high = month;
    target.commercial_list = pick.commercial;
    target.basis = `$${pick.unitPrice}/${eq(pick.unit, '1 Hour') ? 'h x 730' : 'month'} (${pick.meterName}, ${pick.region}${pick.commercial ? ', commercial list' : ''})${entry.basis.includes('extra') ? '; usage extra' : ''}`;
    if (was.low !== month || was.high !== month || was.commercial_list !== pick.commercial) {
      changes.push({ key, from: `${was.low}-${was.high}`, to: `${month}`, commercial_list: pick.commercial });
    }
  }
  if (confirmed > 0) next.price_date = today;
  return { next, changes, kept, problems };
}

/** The price file's own layout: top-level keys one per line, one line per price. */
export function formatEstimates(est) {
  const inline = (o) => '{ ' + Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ') + ' }';
  const lines = Object.entries(est).map(([k, v]) => {
    if (k !== 'prices') return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
    const rows = Object.entries(v).map(([pk, pv]) => `    ${JSON.stringify(pk)}: ${inline(pv)}`);
    return '  "prices": {\n' + rows.join(',\n') + '\n  }';
  });
  return '{\n' + lines.join(',\n') + '\n}\n';
}

/** Fetch every page of one filter. `fetchImpl` is injectable for tests. */
export async function fetchItems(filter, fetchImpl = globalThis.fetch) {
  const items = [];
  let url = `${API}?currencyCode='USD'&$filter=${encodeURIComponent(filter)}`;
  for (let page = 0; url && page < 50; page++) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Retail Prices API ${res.status} for ${filter}`);
    const body = await res.json();
    items.push(...(body.Items ?? []));
    url = body.NextPageLink ?? null;
  }
  return items;
}

/** Look up every refreshable key in the Gov region, falling back to the commercial region. */
export async function lookupAll(getItems) {
  const cache = new Map();
  const items = async (meter, region) => {
    const f = filterFor(meter, region);
    if (!cache.has(f)) cache.set(f, await getItems(f));
    return cache.get(f);
  };
  const out = {};
  for (const [key, meter] of Object.entries(METERS)) {
    const gov = pickPrice(await items(meter, GOV_REGION), meter);
    out[key] = gov.ok ? { gov } : { gov, commercial: pickPrice(await items(meter, COMMERCIAL_REGION), meter) };
  }
  return out;
}

function parseArgs(argv) {
  const a = { mode: 'dry-run', file: null, offline: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') a.mode = 'write';
    else if (argv[i] === '--check') a.mode = 'check';
    else if (argv[i] === '--file') a.file = argv[++i];
    else if (argv[i] === '--offline') a.offline = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return a;
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(args.file ?? path.join(here, '..', 'src', 'data', 'cost-estimates.reference.json'));
  const estimates = JSON.parse(fs.readFileSync(file, 'utf8'));
  const age = ageDays(estimates);
  if (args.mode === 'check') {
    const ok = age <= MAX_AGE_DAYS;
    log(`${path.basename(file)}: price_date ${estimates.price_date}, ${age} days old (limit ${MAX_AGE_DAYS}): ${ok ? 'OK' : 'STALE'}`);
    return ok ? 0 : 1;
  }
  let getItems;
  if (args.offline) {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(args.offline), 'utf8'));
    getItems = async (f) => fixture[f] ?? [];
  } else {
    getItems = (f) => fetchItems(f);
  }
  const today = new Date().toISOString().slice(0, 10);
  const { next, changes, kept, problems } = applyRefresh(estimates, await lookupAll(getItems), today);
  for (const c of changes) log(`CHANGE ${c.key}: $${c.from} -> $${c.to} a month${c.commercial_list ? ' (commercial list)' : ''}`);
  for (const p of problems) log(`KEPT ${p.key}: ${p.reason}`);
  log(`${changes.length} changed, ${problems.length} not found, ${kept.length} usage-based kept; price_date ${estimates.price_date} -> ${next.price_date}`);
  if (args.mode === 'write') {
    fs.writeFileSync(file, formatEstimates(next));
    log(`wrote ${file}. Every earlier DP-1 is now void (new price_date); operators must opt in again.`);
  } else {
    log('dry run: nothing written (use --write)');
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, err => { console.error(err.message); process.exitCode = 2; });
}
