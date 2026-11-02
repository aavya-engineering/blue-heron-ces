// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EVC.5: optional catalog ids (form_id, emx_ids) on POST /api/ingest, validated against
// the released evidence catalog (DEC-2). Real HTTP on 127.0.0.1:0, sandboxed roots.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EcEvidenceItemSchema } from 'ces-shared/types/evidence-collector';

import { catalogCandidates, loadCatalog } from '../src/evidenceCatalog.js';
import { getItemRecord } from '../src/store.js';
import { SECRET, auth, ecTenantDir, ingestBody, makeSandbox, registerTenant, startApp, type Running, type Sandbox } from './helpers.js';

let sb: Sandbox;
let ec: Running;

beforeEach(async () => {
  sb = makeSandbox();
  registerTenant(sb, 'ec-sim-a', 'sim');
  ec = await startApp({ resolveTenant: sb.resolver });
});

afterEach(async () => {
  await ec.close();
  sb.restore();
  vi.restoreAllMocks();
});

async function ingest(extra: Record<string, unknown>) {
  return fetch(`${ec.base}/api/ingest`, {
    method: 'POST',
    headers: auth(SECRET),
    body: ingestBody('ec-sim-a', 'policy bytes', { controlIds: ['AC.L2-3.1.1'], ...extra }),
  });
}

function storedMeta(itemId: string): Record<string, unknown> {
  return getItemRecord('ec-sim-a', itemId) as Record<string, unknown>;
}

describe('catalog path resolution', () => {
  it('uses CES_EVIDENCE_CATALOG_PATH alone when set', () => {
    expect(catalogCandidates({ CES_EVIDENCE_CATALOG_PATH: 'x/cat.json', CES_PIPELINE_ROOT: 'p' })).toEqual([path.resolve('x/cat.json')]);
  });

  it('tries <CES_PIPELINE_ROOT>/evidence-catalog first, then the ces-muster sibling', () => {
    const c = catalogCandidates({ CES_PIPELINE_ROOT: 'p' });
    expect(c[0]).toBe(path.join('p', 'evidence-catalog', 'evidence-catalog-release-0.json'));
    expect(c[1].replace(/\\/g, '/')).toMatch(/ces-muster\/src\/features\/plan\/engine\/data\/evidence-catalog\/evidence-catalog-release-0\.json$/);
  });

  it('loads release 0 from the sibling default (14 definitions)', () => {
    const load = loadCatalog({ CES_PIPELINE_ROOT: sb.pipelineRoot });
    expect(load.status).toBe('loaded');
    if (load.status === 'loaded') expect(load.definitionIds.size).toBe(14);
  });

  it('prefers a catalog under CES_PIPELINE_ROOT when present', () => {
    const sibling = catalogCandidates({})[0];
    const dir = path.join(sb.pipelineRoot, 'evidence-catalog');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(sibling, path.join(dir, 'evidence-catalog-release-0.json'));
    const load = loadCatalog({ CES_PIPELINE_ROOT: sb.pipelineRoot });
    expect(load.status === 'loaded' && load.path).toBe(path.join(dir, 'evidence-catalog-release-0.json'));
  });
});

describe('POST /api/ingest with catalog ids', () => {
  it('accepts valid form_id and emx_ids and stores them on the item', async () => {
    const res = await ingest({ form_id: 'account_management_procedure', emx_ids: ['EMX-IAM-004'] });
    expect(res.status).toBe(201);
    const item = EcEvidenceItemSchema.parse(await res.json());
    expect(item).toMatchObject({ form_id: 'account_management_procedure', emx_ids: ['EMX-IAM-004'], form_id_matched_by: 'form_id', catalog: 'validated' });
    expect(storedMeta(item.itemId)).toMatchObject({ form_id: 'account_management_procedure', emx_ids: ['EMX-IAM-004'], catalog: 'validated' });
    const listed = await (await fetch(`${ec.base}/api/items?tenant=ec-sim-a`, { headers: auth(SECRET) })).json();
    expect(listed[0]).toMatchObject({ itemId: item.itemId, form_id: 'account_management_procedure' });
  });

  it('accepts a definition_id as form_id and records which matched', async () => {
    const res = await ingest({ form_id: 'AC.L2-3.1.1#E02' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ form_id: 'AC.L2-3.1.1#E02', form_id_matched_by: 'definition_id', catalog: 'validated' });
  });

  it('rejects an unknown form_id with a 400 naming the id', async () => {
    const res = await ingest({ form_id: 'no_such_form' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'invalid_request', field: 'form_id', id: 'no_such_form' });
    expect(body.detail).toContain('no_such_form');
    expect(fs.existsSync(path.join(ecTenantDir(sb, 'ec-sim-a'), 'items'))).toBe(false);
  });

  it('rejects an unknown emx_id with a 400 naming the id', async () => {
    const res = await ingest({ form_id: 'access_control_policy', emx_ids: ['EMX-IAM-004', 'EMX-ZZZ-999'] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'invalid_request', field: 'emx_ids', id: 'EMX-ZZZ-999' });
    expect(body.detail).toContain('EMX-ZZZ-999');
  });

  it('absent fields: item carries none of the catalog keys (unchanged behaviour)', async () => {
    const res = await ingest({});
    expect(res.status).toBe(201);
    const item = await res.json();
    for (const k of ['form_id', 'emx_ids', 'form_id_matched_by', 'catalog']) {
      expect(k in item).toBe(false);
      expect(k in storedMeta(item.itemId)).toBe(false);
    }
  });

  it('catalog unavailable: stores the ids unvalidated with catalog "unavailable" and logs it', async () => {
    process.env.CES_EVIDENCE_CATALOG_PATH = path.join(sb.dir, 'missing', 'catalog.json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await ingest({ form_id: 'anything_goes', emx_ids: ['EMX-ZZZ-999'] });
    expect(res.status).toBe(201);
    const item = EcEvidenceItemSchema.parse(await res.json());
    expect(item).toMatchObject({ form_id: 'anything_goes', emx_ids: ['EMX-ZZZ-999'], catalog: 'unavailable' });
    expect(item.form_id_matched_by).toBeUndefined();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('evidence catalog unavailable'))).toBe(true);
  });
});
