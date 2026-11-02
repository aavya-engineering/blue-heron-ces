// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W5 cycle 3, EO rules part 2, item 2: the policy vs tenant rows on a real generated SSP
 * (run 43's inputs) and in its DOCX posture block. No control status, SPRS or POA&M figure moves.
 */
import { describe, test, expect } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import { SspGenerator } from '../../src/eo/ssp/SspGenerator.js';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter.js';
import { applyPolicyReconciliation, type TenantRead } from '../../src/eo/ssp/PolicyReconciliation.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const FX = path.resolve(__dirname, '../fixtures/w5-run43');

async function docxBody(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  return (await zip.file('word/document.xml')!.async('string')).split('</w:p>')
    .map(p => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('')).join('\n');
}

const TS = '2026-10-28T19:27:49.179Z';
const read = (sourceId: string, payload: unknown, query: string): TenantRead => ({ sourceId, recordId: `rec-${sourceId}`, query, collectedAt: TS, payloadSha256: 'b'.repeat(64), payload });
/** S1's simulator tenant values (fictional): smart lockout 5 / 300 s, passwords never expire. */
const READS = new Map<string, TenantRead>([
  ['directorySettings', read('directorySettings', { value: [{ id: 's-1', displayName: 'Password Rule Settings', values: [{ name: 'LockoutThreshold', value: '5' }, { name: 'LockoutDurationInSeconds', value: '300' }] }] }, 'GET /v1.0/groupSettings')],
  ['domains', read('domains', { value: [{ id: 's1-mach.simtenant.onmicrosoft.us', passwordValidityPeriodInDays: 2147483647 }] }, 'GET /v1.0/domains')],
]);
const ODPS = { account_lockout_threshold: 3, account_lockout_duration_minutes: 15, max_password_age_days: 60 };

describe('W5 cycle 3 item 2: policy vs tenant rows on a generated SSP', () => {
  test('rows on the SSP and in the DOCX posture block; statuses and SPRS unchanged', async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(FX, 'snapshot-run43.json'), 'utf-8')) as { tenantId: string; generatedAt: string; signals: Record<string, unknown>; controls: Array<Record<string, unknown> & { signalKeys: string[] }> };
    const snapshot = { tenantId: fx.tenantId, generatedAt: fx.generatedAt, controls: fx.controls.map(({ signalKeys, ...c }) => ({ ...c, signals: signalKeys.map(k => fx.signals[k]) })) } as unknown as AssessmentSnapshot;
    const ssp: any = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: snapshot, variables: {} });
    const statuses = JSON.stringify(ssp.controlImplementations.map((c: any) => [c.control_id, c.status]));
    const posture = JSON.stringify(ssp.postureReconciliation.rows);

    applyPolicyReconciliation(ssp, ODPS, READS);

    expect(JSON.stringify(ssp.controlImplementations.map((c: any) => [c.control_id, c.status]))).toBe(statuses);
    expect(JSON.stringify(ssp.postureReconciliation.rows)).toBe(posture);
    expect(ssp.policyReconciliation.map((r: any) => [r.controlId, r.odpId, r.tenantValue])).toEqual([
      ['AC.L2-3.1.8', 'PI.ODP.001', '5 failed attempts'],
      ['AC.L2-3.1.8', 'PI.ODP.002', '300 seconds (5 minutes)'],
      ['IA.L2-3.5.7', 'PI.ODP.006', 'passwords never expire'],
    ]);
    for (const r of ssp.policyReconciliation) {
      expect(Object.keys(r).sort()).toEqual(['controlId', 'odpId', 'odpKey', 'policyValue', 'readReference', 'sourceRows', 'statement', 'tenantValue']);
      expect(r.statement).not.toMatch(/SPRS|projected/i); // V36: no score wording in the new text
    }

    const docx = await docxBody(await new SspDocxExporter().export(ssp));
    expect(docx).toContain('Policy reconciliation (policy vs tenant): 3 organisation-defined parameter value(s) differ between the policy and the tenant.');
    expect(docx).toContain('AC.L2-3.1.8 PI.ODP.001: Policy states at most 3 failed attempts (account_lockout_threshold); tenant configured 5 failed attempts;');
    for (const cell of ['Policy states', 'Tenant configured', 'PI.ODP.006 (max_password_age_days)', 'passwords never expire', 'directorySettings store record rec-directorySettings (GET /v1.0/groupSettings;']) {
      expect(docx).toContain(cell);
    }
  });
});
