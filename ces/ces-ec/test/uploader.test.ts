// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// NS-0: EC records WHO uploaded an item (uploadedBy) from a verified x-ces-principal token,
// never from the request body. No token => uploadedBy: null (uploader unknown).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signPrincipalToken } from 'ces-shared/http/principal';
import { EcEvidenceItemSchema } from 'ces-shared/types/evidence-collector';

import { getItemRecord, listItems } from '../src/store.js';
import { SECRET, auth, ingestBody, makeSandbox, registerTenant, startApp, type Running, type Sandbox } from './helpers.js';

const PRINCIPAL_SECRET = 'ec-uploader-principal-secret-0123456789';
const UPLOADER = 'uploader.one@sim-tenant.example.test';

let sb: Sandbox;
let ec: Running;

beforeEach(async () => {
  sb = makeSandbox();
  registerTenant(sb, 'ec-sim-a', 'sim');
  process.env.CES_EC_PRINCIPAL_SECRET = PRINCIPAL_SECRET;
  ec = await startApp({ resolveTenant: sb.resolver });
});

afterEach(async () => {
  await ec.close();
  delete process.env.CES_EC_PRINCIPAL_SECRET;
  delete process.env.CES_EC_PRINCIPAL_ISSUER;
  delete process.env.CES_EC_PRINCIPAL_AUDIENCE;
  sb.restore();
});

function token(over: Record<string, unknown> = {}, secret = PRINCIPAL_SECRET): string {
  return signPrincipalToken({ sub: 'uploader-sub-1', upn: UPLOADER, ...over } as never, { secret });
}

async function ingest(extraHeaders: Record<string, string> = {}, extraBody: Record<string, unknown> = {}) {
  return fetch(`${ec.base}/api/ingest`, {
    method: 'POST',
    headers: { ...auth(SECRET), ...extraHeaders },
    body: ingestBody('ec-sim-a', 'policy bytes', extraBody),
  });
}

describe('NS-0: uploadedBy on POST /api/ingest', () => {
  it('no principal header => uploadedBy null (uploader unknown), item still stored', async () => {
    const res = await ingest();
    expect(res.status).toBe(201);
    const item = EcEvidenceItemSchema.parse(await res.json());
    expect(item.uploadedBy).toBeNull();
    expect(item.submittedByRole).toBeTruthy();
    expect(EcEvidenceItemSchema.parse(getItemRecord('ec-sim-a', item.itemId)).uploadedBy).toBeNull();
  });

  it('a valid principal token => uploadedBy { subjectId, upn } persisted and listed', async () => {
    const res = await ingest({ 'x-ces-principal': token() });
    expect(res.status).toBe(201);
    const item = EcEvidenceItemSchema.parse(await res.json());
    expect(item.uploadedBy).toEqual({ subjectId: 'uploader-sub-1', upn: UPLOADER });
    expect(EcEvidenceItemSchema.parse(getItemRecord('ec-sim-a', item.itemId)).uploadedBy).toEqual(item.uploadedBy);
    expect(listItems('ec-sim-a')[0].uploadedBy).toEqual(item.uploadedBy);
  });

  it('accepts "Bearer <token>" in the principal header; oid wins over sub as subjectId', async () => {
    const res = await ingest({ 'x-ces-principal': `Bearer ${token({ oid: 'entra-oid-9' })}` });
    expect(res.status).toBe(201);
    expect((await res.json()).uploadedBy).toEqual({ subjectId: 'entra-oid-9', upn: UPLOADER });
  });

  it('a tampered token => 401 and nothing stored', async () => {
    const t = token();
    const [h, p, s] = t.split('.');
    const forged = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    forged.upn = 'someone.else@sim-tenant.example.test';
    const bad = `${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${s}`;
    const res = await ingest({ 'x-ces-principal': bad });
    expect(res.status).toBe(401);
    expect(listItems('ec-sim-a')).toHaveLength(0);
  });

  it('a token signed with another secret => 401', async () => {
    const res = await ingest({ 'x-ces-principal': token({}, 'some-other-secret-0123456789abcdef') });
    expect(res.status).toBe(401);
  });

  it('an expired token => 401', async () => {
    const t = signPrincipalToken({ sub: 'uploader-sub-1', upn: UPLOADER }, { secret: PRINCIPAL_SECRET, ttlSeconds: 60, now: () => Date.now() - 3600_000 });
    expect((await ingest({ 'x-ces-principal': t })).status).toBe(401);
  });

  it('a token supplied while CES_EC_PRINCIPAL_SECRET is unset => 401 (never downgraded to null)', async () => {
    delete process.env.CES_EC_PRINCIPAL_SECRET;
    const res = await ingest({ 'x-ces-principal': token() });
    expect(res.status).toBe(401);
    expect(listItems('ec-sim-a')).toHaveLength(0);
  });

  it('enforces CES_EC_PRINCIPAL_ISSUER / _AUDIENCE when set', async () => {
    process.env.CES_EC_PRINCIPAL_ISSUER = 'ces-uploader';
    process.env.CES_EC_PRINCIPAL_AUDIENCE = 'ces-ec';
    expect((await ingest({ 'x-ces-principal': token() })).status).toBe(401);
    expect((await ingest({ 'x-ces-principal': token({ iss: 'ces-uploader', aud: 'ces-ec' }) })).status).toBe(201);
  });

  it('a body uploadedBy is rejected (400): the uploader is never a body field', async () => {
    const res = await ingest({}, { uploadedBy: { subjectId: 'x', upn: 'forged@example.test' } });
    expect(res.status).toBe(400);
  });

  it('the service bearer is still required even with a valid principal token', async () => {
    const res = await fetch(`${ec.base}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ces-principal': token() },
      body: ingestBody('ec-sim-a', 'x'),
    });
    expect(res.status).toBe(401);
  });
});
