// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 Slice 3.0 — the ces-muster connect driver against a fake `UiPage`.
 *
 * The ordering rule under test: the connect beat navigates ONCE, fills the
 * manifest, and STOPS — Begin Interview is reachable but left UNCLICKED (the
 * judge reads that DOM). And the honesty rule: the driver never touches the
 * SPA's own fixture button (`discovery-run-btn`).
 */

import { describe, it, expect } from 'vitest';
import { FakeUiPage } from './helpers/fake-ui-page.js';
import {
  driveMusterConnect,
  readMusterManifest,
  MUSTER_SELECTORS,
  type MusterConnectParams,
} from '../src/demo/muster-ui-driver.js';

const PARAMS: MusterConnectParams = {
  mode: 'independent',
  authTier: 'cert-app-only',
  slug: 'demo-dib-small',
  tenantKind: 'sim',
  operatorName: 'Demo Operator',
  operatorRole: 'assessor',
};

function connectPage(): FakeUiPage {
  return new FakeUiPage({
    visible: new Set([MUSTER_SELECTORS.manifestCapture, MUSTER_SELECTORS.beginInterview]),
  });
}

describe('driveMusterConnect', () => {
  it('navigates once, fills every manifest field, and never clicks Begin Interview', async () => {
    const page = connectPage();
    await driveMusterConnect(page, 'http://127.0.0.1:4173', PARAMS);

    // Exactly one navigation, and it is first.
    expect(page.actions.filter((a) => a.startsWith('goto '))).toEqual(['goto http://127.0.0.1:4173']);

    // The selects and inputs the manifest needs.
    expect(page.actions).toContain(`select ${MUSTER_SELECTORS.rmMode}=independent`);
    expect(page.actions).toContain(`select ${MUSTER_SELECTORS.rmAuthTier}=cert-app-only`);
    expect(page.actions).toContain(`fill ${MUSTER_SELECTORS.rmTenantSlug}=demo-dib-small`);
    expect(page.actions).toContain(`select ${MUSTER_SELECTORS.rmTenantKind}=sim`);
    expect(page.actions).toContain(`fill ${MUSTER_SELECTORS.rmOperatorName}=Demo Operator`);
    expect(page.actions).toContain(`fill ${MUSTER_SELECTORS.rmOperatorRole}=assessor`);

    // Begin Interview is waited for (reachable) but NEVER clicked.
    expect(page.actions).toContain(`wait ${MUSTER_SELECTORS.beginInterview}`);
    expect(page.actions.some((a) => a === `click ${MUSTER_SELECTORS.beginInterview}`)).toBe(false);

    // The honesty guard: the fixture button is never touched.
    expect(page.actions.some((a) => a.includes('discovery-run-btn'))).toBe(false);
  });

  it('reads the manifest back for the judge', async () => {
    const page = connectPage();
    await driveMusterConnect(page, 'http://127.0.0.1:4173', PARAMS);
    const m = await readMusterManifest(page);
    expect(m).toMatchObject({
      mode: 'independent',
      authTier: 'cert-app-only',
      slug: 'demo-dib-small',
      operatorName: 'Demo Operator',
      operatorRole: 'assessor',
      beginInterviewReachable: true,
      profileVisible: true,
    });
  });

  it('surfaces a loud selector-drift failure rather than a silent one', async () => {
    const page = new FakeUiPage({ missing: new Set([MUSTER_SELECTORS.manifestCapture]) });
    await expect(driveMusterConnect(page, 'http://127.0.0.1:4173', PARAMS)).rejects.toThrow(
      /never appeared/,
    );
  });
});
