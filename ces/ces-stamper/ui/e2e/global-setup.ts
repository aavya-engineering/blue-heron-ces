// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Global setup (W8-PIS): the webServer command has already wiped and seeded the run-scoped
// roots (parity-state.ts) and started the server on them. This checks that the server on the
// port is that server: its tenant list must be exactly dev plus the seeded fictional record.
// A server reading the founder's registry (~/.ces/tenants) lists other tenants and fails here,
// before any test runs.

import { SEED_TENANT_SLUG } from './parity-state';

export const PARITY_ORIGIN = 'http://localhost:5102';

export default async function globalSetup(): Promise<void> {
  const res = await fetch(`${PARITY_ORIGIN}/api/tenants`, { signal: AbortSignal.timeout(10_000) });
  const slugs = ((await res.json()) as Array<{ slug: string }>).map((t) => t.slug).sort();
  const expected = ['dev', SEED_TENANT_SLUG].sort();
  if (JSON.stringify(slugs) !== JSON.stringify(expected)) {
    throw new Error(
      `parity server is not on the run-scoped roots: /api/tenants lists ${JSON.stringify(slugs)}, expected ${JSON.stringify(expected)}`,
    );
  }
}
