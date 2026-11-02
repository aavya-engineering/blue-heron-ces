// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-31: EoServer's wiring, checked on the source (starting the full server would run the
 * PowerShell pre-flight checks): the kit UI router is mounted before express.static, and the
 * approver-token and uploader-token issuers share ONE passkey service (sessions live in memory).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, '../../../src/eo/server/EoServer.ts'), 'utf-8');

describe('FIN-31: EoServer mounts', () => {
  it('mounts the UI router before the static middleware', () => {
    const ui = src.indexOf('app.use(createEoUiRouter(publicDir));');
    const stat = src.indexOf('app.use(express.static(publicDir));');
    expect(ui).toBeGreaterThan(0);
    expect(stat).toBeGreaterThan(ui);
  });

  it('passes one passkey service to both issuers, and mounts the review queue', () => {
    expect(src).toMatch(/const operatorPasskeys = new PasskeyOperatorService\(\);/);
    expect(src).toContain('createApproverTokenRouter({ stamperRoot, passkeys: operatorPasskeys })');
    expect(src).toContain('createUploaderTokenRouter({ stamperRoot, passkeys: operatorPasskeys })');
    expect(src).toContain('createReviewQueueRouter({ stamperRoot, ecUrl: config.ecUrl, secret: config.evidenceOpsSecret })');
  });

  it('keeps the file\'s UTF-8 BOM and LF line endings', () => {
    const raw = fs.readFileSync(path.join(__dirname, '../../../src/eo/server/EoServer.ts'));
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(raw.includes(0x0d)).toBe(false);
  });
});
