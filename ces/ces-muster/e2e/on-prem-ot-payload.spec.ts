// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EU-7: on-prem/OT surfaces in exported StatusPayload
// Assertion: After a profile with on_prem_ot='yes', intercept StatusPayload download,
// parse JSON, assert payload.on_prem_ot === 'yes'
import { test, expect } from '@playwright/test';
import { fillProfileAndBegin, answerAllAndFinish } from './helpers';

test('EU-7: on_prem_ot=yes surfaces in exported StatusPayload JSON', async ({ page }) => {
  await page.goto('/');

  await fillProfileAndBegin(page, {
    kind: 'individual_contractor',
    name: 'OT Corp',
    onPremOt: 'yes',
  });
  await answerAllAndFinish(page, 'yes');

  // Intercept the StatusPayload download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export StatusPayload/ }).click(),
  ]);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const jsonText = Buffer.concat(chunks).toString('utf-8');
  const payload = JSON.parse(jsonText);

  expect(payload.on_prem_ot).toBe('yes');
});
