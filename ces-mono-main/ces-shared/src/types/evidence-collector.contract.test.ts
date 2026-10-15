// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// M1 (evidence-collector PLAN.md): contract tests for EC's ces-shared schemas.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EcHealthSchema,
  EcRunSchema,
  EcFindingSchema,
  EcEvidenceItemSchema,
  EcLedgerEntrySchema,
  EC_CONTRACT_VERSION,
  SUPPORTED_EC_CONTRACT_VERSIONS,
  type EcHealth,
  type EcRun,
  type EcFinding,
  type EcEvidenceItem,
  type EcLedgerEntry,
} from './evidence-collector.contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '__fixtures__');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8'));

function makeHealth(overrides: Partial<EcHealth> = {}): EcHealth {
  return { ...load('ec-health.json'), ...overrides };
}

function makeRun(overrides: Partial<EcRun> = {}): EcRun {
  return { ...load('ec-run.json'), ...overrides };
}

function makeFinding(overrides: Partial<EcFinding> = {}): EcFinding {
  return { ...load('ec-finding.json'), ...overrides };
}

function makeItem(overrides: Partial<EcEvidenceItem> = {}): EcEvidenceItem {
  return { ...load('ec-evidence-item.json'), ...overrides };
}

function makeLedgerEntry(overrides: Partial<EcLedgerEntry> = {}): EcLedgerEntry {
  return { ...load('ec-ledger-entry.json'), ...overrides };
}

describe('EC contract version', () => {
  it('is 1.0.0 and the only supported version at M1', () => {
    expect(EC_CONTRACT_VERSION).toBe('1.0.0');
    expect([...SUPPORTED_EC_CONTRACT_VERSIONS]).toEqual(['1.0.0']);
  });
});

describe('EcHealthSchema', () => {
  it('accepts the fixture', () => {
    expect(EcHealthSchema.safeParse(load('ec-health.json')).success).toBe(true);
  });

  it('accepts mode live and status degraded', () => {
    expect(EcHealthSchema.safeParse(makeHealth({ mode: 'live', status: 'degraded' })).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(EcHealthSchema.safeParse(makeHealth({ status: 'unknown' as any })).success).toBe(false);
  });

  it('rejects an unknown mode', () => {
    expect(EcHealthSchema.safeParse(makeHealth({ mode: 'prod' as any })).success).toBe(false);
  });

  it('rejects a missing startedAt', () => {
    const { startedAt, ...row } = makeHealth();
    expect(EcHealthSchema.safeParse(row).success).toBe(false);
  });
});

describe('EcRunSchema', () => {
  it('accepts the fixture', () => {
    expect(EcRunSchema.safeParse(load('ec-run.json')).success).toBe(true);
  });

  it('accepts runType ingest and status empty/failed', () => {
    expect(EcRunSchema.safeParse(makeRun({ runType: 'ingest', status: 'empty' })).success).toBe(true);
    expect(EcRunSchema.safeParse(makeRun({ status: 'failed' })).success).toBe(true);
  });

  it('rejects a bad runType', () => {
    expect(EcRunSchema.safeParse(makeRun({ runType: 'sync' as any })).success).toBe(false);
  });

  it('rejects a bad status', () => {
    expect(EcRunSchema.safeParse(makeRun({ status: 'partial' as any })).success).toBe(false);
  });

  it('rejects negative artifactsWritten', () => {
    expect(EcRunSchema.safeParse(makeRun({ artifactsWritten: -1 })).success).toBe(false);
  });

  it('accepts artifactsWritten of 0 (an empty run)', () => {
    expect(EcRunSchema.safeParse(makeRun({ artifactsWritten: 0, status: 'empty' })).success).toBe(true);
  });
});

describe('EcFindingSchema', () => {
  it('accepts the fixture', () => {
    expect(EcFindingSchema.safeParse(load('ec-finding.json')).success).toBe(true);
  });

  it('accepts all severities and statuses', () => {
    for (const severity of ['critical', 'high', 'low'] as const) {
      expect(EcFindingSchema.safeParse(makeFinding({ severity })).success, severity).toBe(true);
    }
    for (const status of ['open', 'resolved'] as const) {
      expect(EcFindingSchema.safeParse(makeFinding({ status })).success, status).toBe(true);
    }
  });

  it('rejects a bad severity', () => {
    expect(EcFindingSchema.safeParse(makeFinding({ severity: 'medium' as any })).success).toBe(false);
  });

  it('rejects a missing tenantSlug', () => {
    const { tenantSlug, ...row } = makeFinding();
    expect(EcFindingSchema.safeParse(row).success).toBe(false);
  });
});

describe('EcEvidenceItemSchema', () => {
  it('accepts the fixture', () => {
    const result = EcEvidenceItemSchema.safeParse(load('ec-evidence-item.json'));
    expect(result.success).toBe(true);
  });

  it('accepts source attestation and mode live', () => {
    expect(EcEvidenceItemSchema.safeParse(makeItem({ source: 'attestation', mode: 'live' })).success).toBe(true);
  });

  // ─── PLAN.md M1 required rejection cases ──────────────────────

  it('rejects missing controlIds', () => {
    const { controlIds, ...row } = makeItem();
    expect(EcEvidenceItemSchema.safeParse(row).success).toBe(false);
  });

  it('rejects an empty controlIds array', () => {
    expect(EcEvidenceItemSchema.safeParse(makeItem({ controlIds: [] })).success).toBe(false);
  });

  it('rejects a bad mode', () => {
    expect(EcEvidenceItemSchema.safeParse(makeItem({ mode: 'prod' as any })).success).toBe(false);
  });

  it('rejects a row carrying a verdict key (schema has none; unknown keys are rejected)', () => {
    const row: any = { ...makeItem(), verdict: 'SAT' };
    const result = EcEvidenceItemSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects a row carrying a dryRun key', () => {
    const row: any = { ...makeItem(), dryRun: false };
    expect(EcEvidenceItemSchema.safeParse(row).success).toBe(false);
  });

  it('rejects any other unknown key (.strict())', () => {
    const row: any = { ...makeItem(), unexpectedField: 'nope' };
    expect(EcEvidenceItemSchema.safeParse(row).success).toBe(false);
  });

  it('rejects an unsupported contractVersion', () => {
    expect(EcEvidenceItemSchema.safeParse(makeItem({ contractVersion: '2.0.0' as any })).success).toBe(false);
  });

  it('the parsed type has no verdict or dryRun field even when TS is bypassed', () => {
    const parsed = EcEvidenceItemSchema.parse(load('ec-evidence-item.json'));
    expect((parsed as any).verdict).toBeUndefined();
    expect((parsed as any).dryRun).toBeUndefined();
  });
});

describe('EcLedgerEntrySchema', () => {
  it('accepts the fixture', () => {
    expect(EcLedgerEntrySchema.safeParse(load('ec-ledger-entry.json')).success).toBe(true);
  });

  it('accepts origin ec', () => {
    expect(EcLedgerEntrySchema.safeParse(makeLedgerEntry({ origin: 'ec' })).success).toBe(true);
  });

  it('rejects a bad origin', () => {
    expect(EcLedgerEntrySchema.safeParse(makeLedgerEntry({ origin: 'ao' as any })).success).toBe(false);
  });

  it('rejects a missing path', () => {
    const { path: _p, ...row } = makeLedgerEntry();
    expect(EcLedgerEntrySchema.safeParse(row).success).toBe(false);
  });

  it('index results are ledger-only: EcLedgerEntry has no controlIds/verdict field to double-count Stamper evidence', () => {
    const parsed = EcLedgerEntrySchema.parse(load('ec-ledger-entry.json'));
    expect((parsed as any).controlIds).toBeUndefined();
    expect((parsed as any).verdict).toBeUndefined();
  });
});
