// @vitest-environment jsdom
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU-3 step 3 (founder decision 2026-09-28 #12): the readiness record is
// version 1.1.0. The importer accepts 1.0.0 AND 1.1.0 (nothing else); the
// exporter writes 1.1.0; and a live run's consent survives import → interview
// → export (before this step the SPA dropped manifest.consent on re-export).
// Driven through production code: the real parser, the real
// BoundaryConfirmPanel staging, the real AssessmentPage over Dexie
// (fake-indexeddb) and the real exporter.
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import AssessmentPage from '@/features/assessment/AssessmentPage';
import BoundaryConfirmPanel from '@/features/discovery/BoundaryConfirmPanel';
import {
  parseReadinessResultFile,
  looksLikeReadinessResult,
  discoveryResultsFromPayload,
  factsFromPayload,
  consentsFromPayload,
} from '@/features/discovery/importReadinessResult';
import { executeReadinessExport } from '../readinessResultService';
import { READINESS_RESULT_CANNED } from '@/__fixtures__/readinessResults';
import { db } from '@/shared/db/schema';
import type { ReadinessConsent, ReadinessResult } from '@/shared/types/readinessResult';

const GRAPH_CONSENT: ReadinessConsent = {
  consented_by: 'admin@customer.example',
  consented_at: '2026-09-28T10:00:00.000Z',
  scopes: ['openid', 'profile', 'https://graph.microsoft.us/Policy.Read.All'],
  tenant_id: '11111111-2222-3333-4444-555555555555',
  auth_tier: 'device-code',
  client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  area: 'graph',
};
const EXO_CONSENT: ReadinessConsent = {
  ...GRAPH_CONSENT,
  consented_at: '2026-09-28T10:05:00.000Z',
  scopes: ['openid', 'profile', 'https://outlook.office365.us/Exchange.Manage'],
  area: 'exchange',
};

function livePayload(): ReadinessResult {
  return {
    ...READINESS_RESULT_CANNED,
    schema_version: 'readiness-result/1.1.0',
    manifest: {
      ...READINESS_RESULT_CANNED.manifest,
      auth_tier: 'device-code',
      tenant: { slug: 'customer-live', kind: 'live' },
      consent: GRAPH_CONSENT,
      consents: [GRAPH_CONSENT, EXO_CONSENT],
    },
  };
}

describe('FC-MU-3 step 3 — importer accepts 1.0.0 and 1.1.0 only', () => {
  test('1.0.0 (every existing fixture) still imports', () => {
    const p = parseReadinessResultFile(JSON.stringify(READINESS_RESULT_CANNED));
    expect(p.schema_version).toBe('readiness-result/1.0.0');
  });

  test('1.1.0 with consent + consents imports; consentsFromPayload returns each once', () => {
    const p = parseReadinessResultFile(JSON.stringify(livePayload()));
    expect(p.schema_version).toBe('readiness-result/1.1.0');
    expect(consentsFromPayload(p)).toEqual([GRAPH_CONSENT, EXO_CONSENT]);
  });

  test('any other version is refused', () => {
    const bad = { ...livePayload(), schema_version: 'readiness-result/1.2.0' };
    expect(looksLikeReadinessResult(bad)).toBe(false);
    expect(() => parseReadinessResultFile(JSON.stringify(bad))).toThrow(/not a readiness-result/);
  });
});

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  localStorage.clear();
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

async function tick(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}

function setInputValue(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('FC-MU-3 step 3 — export writes 1.1.0 and keeps the consent', () => {
  test('import (live 1.1.0) → confirm → interview → export: consent and consents survive', async () => {
    const payload = parseReadinessResultFile(JSON.stringify(livePayload()));

    // The discovery confirm step stages what the import produced.
    await act(async () => {
      root.render(
        <BoundaryConfirmPanel
          results={discoveryResultsFromPayload(payload)}
          payloadFacts={factsFromPayload(payload)}
          payloadConsents={consentsFromPayload(payload)}
          onContinue={() => {}}
        />
      );
    });
    await act(async () => (container.querySelector('[data-testid="boundary-continue-btn"]') as HTMLButtonElement).click());

    // The interview mounts, consumes the staged handoff, begins.
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<AssessmentPage onEngagementReady={() => {}} onComplete={() => {}} />);
    });
    await tick();
    await act(async () => {
      setInputValue(container.querySelector('input[placeholder="Acme Defense LLC"]') as HTMLInputElement, 'Live Import Co');
      setInputValue(container.querySelector('[data-testid="rm-operator-name"]') as HTMLInputElement, 'Test Operator');
      (container.querySelector('input[name="on_prem_ot"][value="no"]') as HTMLInputElement).click();
    });
    await act(async () => (container.querySelector('[data-testid="begin-interview"]') as HTMLButtonElement).click());
    await tick(20);

    const sessions = await db.interview_sessions.toArray();
    expect(sessions).toHaveLength(1);
    const out = await executeReadinessExport(sessions[0].id);
    expect(out.schema_version).toBe('readiness-result/1.1.0');
    expect(out.manifest.consent).toEqual(GRAPH_CONSENT);
    expect(out.manifest.consents).toEqual([GRAPH_CONSENT, EXO_CONSENT]);
    // A consented import marks the session live / device-code (operator may still edit).
    expect(out.manifest.tenant.kind).toBe('live');
    expect(out.manifest.auth_tier).toBe('device-code');
    // The export re-imports (round trip on the same schema).
    expect(consentsFromPayload(parseReadinessResultFile(JSON.stringify(out)))).toEqual([GRAPH_CONSENT, EXO_CONSENT]);
    // The handoff is consumed once.
    expect(localStorage.getItem('muster-discovery-consents')).toBeNull();
  });

  test('a sim session (no consent) exports 1.1.0 with no consent fields', async () => {
    await act(async () => {
      root.render(<AssessmentPage onEngagementReady={() => {}} onComplete={() => {}} />);
    });
    await tick();
    await act(async () => {
      setInputValue(container.querySelector('input[placeholder="Acme Defense LLC"]') as HTMLInputElement, 'Sim Co');
      setInputValue(container.querySelector('[data-testid="rm-operator-name"]') as HTMLInputElement, 'Test Operator');
      (container.querySelector('input[name="on_prem_ot"][value="no"]') as HTMLInputElement).click();
    });
    await act(async () => (container.querySelector('[data-testid="begin-interview"]') as HTMLButtonElement).click());
    await tick(20);
    const out = await executeReadinessExport((await db.interview_sessions.toArray())[0].id);
    expect(out.schema_version).toBe('readiness-result/1.1.0');
    expect(out.manifest.consent).toBeUndefined();
    expect(out.manifest.consents).toBeUndefined();
  });
});
