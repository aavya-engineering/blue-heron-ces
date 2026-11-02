// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-40: the price-refresh script, with no network. The real price file is only read, never written.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  METERS, GOV_REGION, COMMERCIAL_REGION, filterFor, matchItems, monthlyFrom, pickPrice, ageDays,
  applyRefresh, fetchItems, lookupAll, formatEstimates, main,
} from './refresh-cost-estimates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRICE_FILE = path.join(here, '..', 'src', 'data', 'cost-estimates.reference.json');
const real = JSON.parse(fs.readFileSync(PRICE_FILE, 'utf8'));

const item = (o) => ({ type: 'Consumption', tierMinimumUnits: 0, armRegionName: GOV_REGION, ...o });
const fwPremium = item({ serviceName: 'Azure Firewall', skuName: 'Premium', meterName: 'Premium Deployment', unitOfMeasure: '1 Hour', retailPrice: 2.2 });
const pip = item({ serviceName: 'Virtual Network', productName: 'IP Addresses', skuName: 'Standard', meterName: 'Standard IPv4 Static Public IP', unitOfMeasure: '1 Hour', retailPrice: 0.00625 });

describe('refresh-cost-estimates: pure parts', () => {
  it('every refreshable key is a key of the real price file', () => {
    for (const key of Object.keys(METERS)) expect({ key, inFile: key in real.prices }).toEqual({ key, inFile: true });
  });

  it('round-trips the real price file byte for byte (layout kept)', () => {
    expect(formatEstimates(real)).toBe(fs.readFileSync(PRICE_FILE, 'utf8'));
  });

  it('matches consumption, first-tier items on every named field only', () => {
    const m = METERS['azure.firewall.premium'];
    const items = [fwPremium, { ...fwPremium, type: 'Reservation' }, { ...fwPremium, tierMinimumUnits: 10 }, { ...fwPremium, skuName: 'Standard' }, { ...fwPremium, unitOfMeasure: '1 GB' }];
    expect(matchItems(items, m)).toEqual([fwPremium]);
  });

  it('turns hourly prices into 730 h a month and keeps monthly prices', () => {
    expect(monthlyFrom(0.00625, '1 Hour')).toBe(4.56);
    expect(monthlyFrom(0.5, '1/Month')).toBe(0.5);
  });

  it('never guesses between two prices', () => {
    const m = METERS['azure.firewall.premium'];
    expect(pickPrice([fwPremium, { ...fwPremium, retailPrice: 3 }], m)).toEqual({ ok: false, reason: 'ambiguous (2 prices)' });
    expect(pickPrice([], m)).toEqual({ ok: false, reason: 'no_match' });
  });

  it('refreshes fixed meters, flags commercial fallbacks, keeps usage-based keys, and dates the file', () => {
    const lookups = {
      'azure.firewall.premium': { gov: pickPrice([fwPremium], METERS['azure.firewall.premium']) },
      'azure.public_ip.standard': { gov: { ok: false, reason: 'no_match' }, commercial: { ...pickPrice([pip], METERS['azure.public_ip.standard']), region: COMMERCIAL_REGION } },
    };
    const { next, changes, kept, problems } = applyRefresh(real, lookups, '2027-01-15');
    expect(next.price_date).toBe('2027-01-15');
    expect(next.prices['azure.firewall.premium']).toMatchObject({ estimate_month_low: 1606, estimate_month_high: 1606, commercial_list: false });
    expect(next.prices['azure.public_ip.standard']).toMatchObject({ estimate_month_low: 4.56, commercial_list: true });
    expect(next.prices['azure.public_ip.standard'].basis).toContain('commercial list');
    expect(changes.map(c => c.key)).toEqual(['azure.firewall.premium', 'azure.public_ip.standard']);
    expect(kept.map(k => k.key)).toContain('azure.log_analytics.workspace');
    expect(problems.map(p => p.key)).toEqual(expect.arrayContaining(['azure.firewall.standard', 'azure.bastion.standard']));
    expect(next.prices['azure.firewall.standard']).toEqual(real.prices['azure.firewall.standard']);
    expect(real.price_date).not.toBe('2027-01-15'); // input untouched
  });

  it('does not move price_date when nothing could be confirmed', () => {
    expect(applyRefresh(real, {}, '2027-01-15').next.price_date).toBe(real.price_date);
  });

  it('the --check rule is 180 days (V103)', () => {
    expect(ageDays({ price_date: '2026-01-01' }, new Date('2026-06-30T12:00:00Z'))).toBe(180);
    expect(ageDays({ price_date: '2026-01-01' }, new Date('2026-07-01T12:00:00Z'))).toBe(181);
  });
});

describe('refresh-cost-estimates: fetch and modes (mocked, no network)', () => {
  it('follows NextPageLink and sends the OData filter', async () => {
    const urls = [];
    const pages = [{ Items: [fwPremium], NextPageLink: 'https://next/2' }, { Items: [pip], NextPageLink: null }];
    const fake = async (url) => { urls.push(url); return { ok: true, json: async () => pages[urls.length - 1] }; };
    const items = await fetchItems(filterFor(METERS['azure.firewall.premium'], GOV_REGION), fake);
    expect(items).toEqual([fwPremium, pip]);
    expect(urls[0]).toContain(encodeURIComponent("serviceName eq 'Azure Firewall' and armRegionName eq 'usgovvirginia'"));
    expect(urls[1]).toBe('https://next/2');
  });

  it('falls back to the commercial region only when the Gov region has no match', async () => {
    const seen = [];
    const out = await lookupAll(async (f) => { seen.push(f); return f.includes(GOV_REGION) ? [fwPremium] : [{ ...pip, armRegionName: COMMERCIAL_REGION }]; });
    expect(out['azure.firewall.premium'].gov.ok).toBe(true);
    expect(out['azure.firewall.premium'].commercial).toBeUndefined();
    expect(out['azure.public_ip.standard'].commercial.ok).toBe(true);
    expect(seen.some(f => f.includes(COMMERCIAL_REGION))).toBe(true);
  });

  it('dry run writes nothing; --write writes a copy; --check fails a stale file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin40-'));
    const file = path.join(dir, 'prices.json');
    fs.writeFileSync(file, fs.readFileSync(PRICE_FILE, 'utf8'));
    const fixture = path.join(dir, 'items.json');
    fs.writeFileSync(fixture, JSON.stringify({ [filterFor(METERS['azure.firewall.premium'], GOV_REGION)]: [fwPremium] }));
    const logs = [];
    const before = fs.readFileSync(file, 'utf8');
    expect(await main(['--file', file, '--offline', fixture], (l) => logs.push(l))).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(logs.join('\n')).toContain('dry run');
    expect(await main(['--file', file, '--offline', fixture, '--write'], (l) => logs.push(l))).toBe(0);
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(written.prices['azure.firewall.premium'].estimate_month_low).toBe(1606);
    expect(formatEstimates(written)).toBe(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, formatEstimates({ ...written, price_date: '2020-01-01' }));
    expect(await main(['--file', file, '--check'], () => {})).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
