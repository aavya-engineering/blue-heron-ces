// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * InProcessTenantStatus -- ratified amendment (founder, 2026-07-10), G-TENANT-1
 * addendum item 2: the library-mode status/activity read surface. Own-process
 * view, append-only ledger, per tenant x engine service x module dimensions.
 */

import { describe, expect, it } from 'vitest';

import { InProcessTenantStatus } from '../impl/status.js';
import type { SessionState } from '../session-surface.js';
import type { TenantStatusSurface, TenantActivityRecorder } from '../status-surface.js';

const STAMPER = { module: 'ces-stamper', purpose: 'translate run' };
const TESTER = { module: 'ces-tester', purpose: 'scenario orchestration' };

describe('InProcessTenantStatus -- append-only activity ledger', () => {
  it('records entries oldest-first with a stamped timestamp and the caller identity', async () => {
    const status = new InProcessTenantStatus();
    status.recordActivity({ consumer: STAMPER, operation: 'execute', tenantSlug: 'acme', sessionType: 'graph', outcome: 'ok' });
    status.recordActivity({ consumer: TESTER, operation: 'getSimLaunchEnv', tenantSlug: 'sim1', outcome: 'ok' });

    const entries = await status.getActivity();
    expect(entries).toHaveLength(2);
    expect(entries[0].consumer).toEqual(STAMPER);
    expect(entries[0].operation).toBe('execute');
    expect(entries[0].sessionType).toBe('graph');
    expect(entries[0].at).toBeInstanceOf(Date);
    expect(entries[1].consumer).toEqual(TESTER);
    expect(entries[1].at.getTime()).toBeGreaterThanOrEqual(entries[0].at.getTime());
  });

  it('is append-only: reads are snapshots, and mutating them does not touch the ledger', async () => {
    const status = new InProcessTenantStatus();
    status.recordActivity({ consumer: STAMPER, operation: 'execute', tenantSlug: 'acme', sessionType: 'graph', outcome: 'ok' });

    const first = await status.getActivity();
    first.pop(); // drop from the returned array
    (await status.getActivity())[0].consumer = null; // mutate a returned entry
    ((await status.getActivity())[0].consumer as { module: string }).module = 'tampered'; // mutate nested identity

    const after = await status.getActivity();
    expect(after).toHaveLength(1);
    expect(after[0].consumer).toEqual(STAMPER);
  });

  it('exposes no update/delete/clear surface (the only mutation is recordActivity)', () => {
    const status = new InProcessTenantStatus();
    const mutators = Object.getOwnPropertyNames(Object.getPrototypeOf(status)).filter((name) =>
      /^(delete|remove|clear|reset|update|set)/i.test(name),
    );
    expect(mutators).toEqual([]);
  });

  it('filters by module, sessionType, and tenantSlug (consumer: null never matches a module filter)', async () => {
    const status = new InProcessTenantStatus();
    status.recordActivity({ consumer: STAMPER, operation: 'execute', tenantSlug: 'acme', sessionType: 'graph', outcome: 'ok' });
    status.recordActivity({ consumer: STAMPER, operation: 'execute', tenantSlug: 'acme', sessionType: 'exchange', outcome: 'error' });
    status.recordActivity({ consumer: TESTER, operation: 'getSimLaunchEnv', tenantSlug: 'sim1', outcome: 'ok' });
    status.recordActivity({ consumer: null, operation: 'resolveTenantKeys', tenantSlug: 'acme', outcome: 'ok' });

    expect(await status.getActivity({ module: 'ces-stamper' })).toHaveLength(2);
    expect(await status.getActivity({ module: 'ces-tester' })).toHaveLength(1);
    expect(await status.getActivity({ module: 'nobody' })).toHaveLength(0);
    expect(await status.getActivity({ sessionType: 'exchange' })).toHaveLength(1);
    expect(await status.getActivity({ tenantSlug: 'acme' })).toHaveLength(3);
    expect(await status.getActivity({ tenantSlug: 'acme', module: 'ces-stamper', sessionType: 'graph' })).toHaveLength(1);
  });
});

describe('InProcessTenantStatus -- own-process connection status view', () => {
  const disconnected = (type: SessionState['type']): SessionState => ({
    type,
    connected: false,
    connectedAt: null,
    lastUsedAt: null,
    tokenExpiresAt: null,
  });

  it('reports per tenant x engine service session states from attached sources, with lastActivityAt from the ledger', async () => {
    const status = new InProcessTenantStatus();
    const states: SessionState[] = [
      { type: 'graph', connected: true, connectedAt: new Date(), lastUsedAt: new Date(), tokenExpiresAt: new Date() },
      disconnected('exchange'),
    ];
    status.attachSessionSource({ getAllSessionStates: () => states }, { tenantSlug: 'acme', kind: 'live' });

    const before = await status.getConnectionStatus();
    expect(before).toHaveLength(1);
    expect(before[0].tenantSlug).toBe('acme');
    expect(before[0].kind).toBe('live');
    expect(before[0].sessions.map((s) => s.type)).toEqual(['graph', 'exchange']);
    expect(before[0].sessions[0].connected).toBe(true);
    expect(before[0].lastActivityAt).toBeNull();

    status.recordActivity({ consumer: STAMPER, operation: 'execute', tenantSlug: 'acme', sessionType: 'graph', outcome: 'ok' });
    const after = await status.getConnectionStatus();
    expect(after[0].lastActivityAt).toBeInstanceOf(Date);
  });

  it('status rows include activity-only tenants (e.g. token requests with no session factory attached)', async () => {
    const status = new InProcessTenantStatus();
    status.recordActivity({ consumer: TESTER, operation: 'resolveTenantKeys', tenantSlug: 'sim1', outcome: 'ok' });

    const rows = await status.getConnectionStatus();
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantSlug).toBe('sim1');
    expect(rows[0].sessions).toEqual([]);
    expect(rows[0].lastActivityAt).toBeInstanceOf(Date);
  });

  it('status snapshots are copies -- mutating a returned session state does not affect the source', async () => {
    const status = new InProcessTenantStatus();
    const state = disconnected('graph');
    status.attachSessionSource({ getAllSessionStates: () => [state] }, { tenantSlug: 'acme', kind: 'live' });

    const rows = await status.getConnectionStatus();
    rows[0].sessions[0].connected = true;
    expect(state.connected).toBe(false);
  });

  it('implements both halves of the amended surface (TenantStatusSurface + TenantActivityRecorder)', () => {
    const status = new InProcessTenantStatus();
    const read: TenantStatusSurface = status;
    const write: TenantActivityRecorder = status;
    expect(typeof read.getConnectionStatus).toBe('function');
    expect(typeof read.getActivity).toBe('function');
    expect(typeof write.recordActivity).toBe('function');
  });
});
