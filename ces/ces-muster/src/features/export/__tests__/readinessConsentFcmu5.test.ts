// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU-5 (founder decisions 2026-09-28, round 4): the readiness record's
// consent carries the fifth live area (teams) and the reader-role proof
// (reader_roles, and subscription_id for azure). Additive within 1.1.0 — the
// real schema and the real importer accept them; unknown fields stay refused.
import { describe, test, expect } from 'vitest';
import Ajv from 'ajv';
import schema from '../../../../public/schemas/readiness-result.schema.json';
import { parseReadinessResultFile, consentsFromPayload } from '@/features/discovery/importReadinessResult';
import { READINESS_RESULT_CANNED } from '@/__fixtures__/readinessResults';
import type { ReadinessConsent, ReadinessResult } from '@/shared/types/readinessResult';

const BASE: ReadinessConsent = {
  consented_by: 'admin@customer.example',
  consented_at: '2026-09-28T10:00:00.000Z',
  scopes: ['openid', 'profile', 'https://graph.microsoft.us/Policy.Read.All'],
  tenant_id: '11111111-2222-3333-4444-555555555555',
  auth_tier: 'device-code',
  client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  area: 'graph',
};
const TEAMS: ReadinessConsent = {
  ...BASE,
  scopes: ['openid', 'profile', '48ac35b8-9aa8-4d74-927d-1f4a14a0b239/user_impersonation'],
  area: 'teams',
  reader_roles: ['Global Reader'],
};
const AZURE: ReadinessConsent = {
  ...BASE,
  scopes: ['openid', 'profile', 'https://management.usgovcloudapi.net/user_impersonation'],
  area: 'azure',
  reader_roles: ['Global Reader', 'Azure Reader (subscription)'],
  subscription_id: '99999999-8888-7777-6666-555555555555',
};

function payload(consents: ReadinessConsent[]): ReadinessResult {
  return {
    ...READINESS_RESULT_CANNED,
    schema_version: 'readiness-result/1.1.0',
    manifest: {
      ...READINESS_RESULT_CANNED.manifest,
      auth_tier: 'device-code',
      tenant: { slug: 'customer-live', kind: 'live' },
      consent: BASE,
      consents,
    },
  };
}

const validate = new Ajv({ strict: true }).compile(schema);

describe('FC-MU-5 — teams area and reader-role proof in the readiness record', () => {
  test('the schema accepts a teams consent and the reader-role fields', () => {
    const ok = validate(payload([BASE, TEAMS, AZURE]));
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });

  test('the importer keeps them (consentsFromPayload returns each once)', () => {
    const p = parseReadinessResultFile(JSON.stringify(payload([BASE, TEAMS, AZURE])));
    expect(consentsFromPayload(p)).toEqual([BASE, TEAMS, AZURE]);
  });

  test('an unknown area or an unknown consent field is still refused', () => {
    expect(validate(payload([{ ...TEAMS, area: 'sharepoint' as ReadinessConsent['area'] }]))).toBe(false);
    expect(validate(payload([{ ...AZURE, role_guess: 'x' } as ReadinessConsent]))).toBe(false);
  });
});
