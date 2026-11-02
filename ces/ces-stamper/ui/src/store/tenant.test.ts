// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAST_TENANT_KEY, connectionTitle, formatLogTime, tenantOptionLabel, useTenantStore } from './tenant';
import { useWorkflowStore } from './workflow';
import { useExecuteStore } from './execute';
import { useConsoleStore } from './console';
import { bootstrapConsole, changeTenant, onPopoutMessage, saveTenant } from '../screens/tenant/flow';
import { TENANTS, TENANT_CONFIG, consoleMessages, flush, installHarness, on, onStream, resetStores, statusBar } from '../screens/tenant/testUtils';
import type { Harness } from '../screens/tenant/testUtils';

let h: Harness;

beforeEach(() => resetStores());
afterEach(() => h?.restore());

const tenantRoutes = [
  on('GET', '/api/tenants', TENANTS),
  on('GET', '/api/tenants/ridgeline', { ok: true, config: TENANT_CONFIG }),
  on('GET', '/api/tenants/ridgeline/variables', { ok: true, variables: { tenantDomain: 'ridgeline.example' } }),
  on('GET', '/api/last-translate', { ok: false }),
  on('GET', '/api/assess-state', { ok: false }),
  on('GET', '/api/cmmc-controls', { controls: [] }),
];

describe('tenant helpers', () => {
  it('labels options and formats log time and the label title as legacy does', () => {
    expect(tenantOptionLabel(TENANTS[0]!)).toBe('-- No Tenant (Dev Mode) --');
    expect(tenantOptionLabel(TENANTS[1]!)).toBe('Ridgeline Machining (gcchigh)');
    expect(formatLogTime(new Date(2026, 9, 29, 7, 5, 9))).toBe('07:05:09');
    expect(connectionTitle('Connecting to ridgeline...', 'Checking prerequisites')).toBe('Connecting to ridgeline... — Checking prerequisites');
    expect(connectionTitle()).toBe('');
  });
});

describe('page load and tenant change (PC-02 request order)', () => {
  it('fires cmmc-controls, then tenants, then the dev tenant change (no requests for dev)', async () => {
    h = installHarness(tenantRoutes);
    await bootstrapConsole();
    await flush();
    expect(h.lines()).toEqual(['GET /api/cmmc-controls', 'GET /api/tenants']);
    const s = useTenantStore.getState();
    expect(s.slug).toBe('dev');
    expect(s.tenants).toHaveLength(3);
    const w = useWorkflowStore.getState();
    expect(w.tenant).toBe('dev');
    expect(w.steps.tenant).toBe('done');
    expect(w.steps.configure).toBe('done');
    expect(w.steps.evidence).toBe('ready');
    // The Execute card's target is the run log's dry-run flag (FG-4: dev means Dry Run).
    expect(useExecuteStore.getState().target).toBe('dryrun');
  });

  it('restores the stored tenant and loads paths, config, variables and cached state in order', async () => {
    window.localStorage.setItem(LAST_TENANT_KEY, 'ridgeline');
    h = installHarness(tenantRoutes);
    await bootstrapConsole();
    await flush();
    expect(h.lines()).toEqual([
      'GET /api/cmmc-controls',
      'GET /api/tenants',
      'GET /api/last-translate?tenant=ridgeline',
      'GET /api/tenants/ridgeline',
      'GET /api/tenants/ridgeline/variables',
      'GET /api/assess-state?tenant=ridgeline',
    ]);
    const s = useTenantStore.getState();
    expect(s.tenantConfig).toEqual(TENANT_CONFIG);
    expect(s.tenantVariables).toEqual({ tenantDomain: 'ridgeline.example' });
    expect(useWorkflowStore.getState().steps.configure).toBe('done');
    expect(window.localStorage.getItem(LAST_TENANT_KEY)).toBe('ridgeline');
  });

  it('runs once per page and falls back to dev for an unknown stored tenant', async () => {
    window.localStorage.setItem(LAST_TENANT_KEY, 'no-such-tenant');
    h = installHarness(tenantRoutes);
    await bootstrapConsole();
    await bootstrapConsole();
    await flush();
    expect(h.lines().filter((l) => l === 'GET /api/tenants')).toHaveLength(1);
    expect(useTenantStore.getState().slug).toBe('dev');
  });

  it('a pop-out "config-saved" message reloads the tenant config', async () => {
    h = installHarness(tenantRoutes);
    onPopoutMessage(new MessageEvent('message', { data: { type: 'config-saved', tenant: 'ridgeline' } }));
    onPopoutMessage(new MessageEvent('message', { data: { type: 'variables-saved' } }));
    await flush();
    expect(h.lines()).toEqual(['GET /api/tenants/ridgeline']);
    expect(useTenantStore.getState().tenantConfig).toEqual(TENANT_CONFIG);
  });

  it('shows the legacy status when the tenant list fails', async () => {
    h = installHarness([on('GET', '/api/tenants', { error: 'boom' }, 500)]);
    expect(await useTenantStore.getState().loadTenants()).toBe(false);
    expect(statusBar()?.message).toMatch(/^Failed to load tenants: /);
    expect(statusBar()?.type).toBe('error');
  });
});

describe('connection gate and connect stream', () => {
  beforeEach(async () => {
    h = installHarness(tenantRoutes);
    await changeTenant('ridgeline');
    h.calls.length = 0;
  });

  it('Allow opens /api/connect and a clean done connects the tenant', () => {
    useTenantStore.getState().toggleGate(true);
    const stream = h.streams[0]!;
    expect(stream.url).toBe('/api/connect?tenant=ridgeline');
    expect(useTenantStore.getState().connection).toBe('connecting');
    stream.emit({ type: 'connection_log', phase: 'config_loaded', tenant: 'ridgeline', message: 'Config loaded' });
    stream.emit({ type: 'prereq_check', module: 'Microsoft.Graph', version: '2.1.0', installed: true });
    stream.emit({ type: 'connection_log', phase: 'connected_graph', message: 'Graph connected' });
    stream.emit({ type: 'connection_log', phase: 'done', tenant: 'ridgeline' });
    const s = useTenantStore.getState();
    expect(s.connection).toBe('connected');
    expect(useExecuteStore.getState().connected).toBe(true);
    expect(consoleMessages()).toEqual([
      'Config loaded',
      'Microsoft.Graph v2.1.0 — installed',
      'Graph connected',
      'Tenant connection complete — all sessions active',
    ]);
    expect(statusBar()).toEqual({ message: 'Connected to tenant', type: 'success' });
    expect(stream.closed).toBe(true);
    expect(useWorkflowStore.getState().steps.tenant).toBe('done');
    expect(useWorkflowStore.getState().steps.configure).toBe('done');
  });

  it('an error row makes done a partial connection', () => {
    useTenantStore.getState().toggleGate(true);
    const stream = h.streams[0]!;
    stream.emit({ type: 'connection_log', phase: 'error_exchange', message: 'Exchange failed' });
    stream.emit({ type: 'connection_log', phase: 'done', tenant: 'ridgeline' });
    const s = useTenantStore.getState();
    expect(s.connection).toBe('error');
    expect(s.connectionTitle).toBe('ridgeline — partial connection — Some sessions failed');
    expect(statusBar()?.message).toBe('Connection check complete — some sessions failed');
    expect(useExecuteStore.getState().connected).toBe(false);
  });

  it('Disallow closes the stream and disconnects; dev never connects', async () => {
    useTenantStore.getState().toggleGate(true);
    useTenantStore.getState().toggleGate(false);
    expect(h.streams[0]!.closed).toBe(true);
    expect(useTenantStore.getState().connection).toBe('disconnected');
    await changeTenant('dev');
    useTenantStore.getState().toggleGate(true);
    expect(h.streams).toHaveLength(1);
  });

  it('a stream error shows the legacy error state', () => {
    useTenantStore.getState().toggleGate(true);
    h.streams[0]!.fail();
    expect(useTenantStore.getState().connection).toBe('error');
    expect(statusBar()?.message).toBe('Connection stream error.');
  });
});

describe('missing prerequisites (PC-03)', () => {
  it('shows the panel, installs a module, imports the certificate, then reconnects', async () => {
    h = installHarness([
      ...tenantRoutes,
      onStream('POST', '/api/prereqs/import-cert', [
        { type: 'install_progress', message: 'Importing PFX' },
        { type: 'install_done', success: true },
      ]),
    ]);
    await changeTenant('ridgeline');
    useTenantStore.getState().toggleGate(true);
    h.streams[0]!.emit({
      type: 'prereq_blocked',
      message: 'Missing prerequisites: ExchangeOnlineManagement',
      missing: ['ExchangeOnlineManagement'],
      cert_missing: true,
      cert_path: 'C:\\certs\\ridgeline.pfx',
      thumbprint: 'ABCDEF0123456789',
    });
    let s = useTenantStore.getState();
    expect(s.connection).toBe('error');
    expect(s.connectionTitle).toBe('Missing prerequisites — Install required prerequisites');
    expect(s.prereq?.modules).toEqual([{ name: 'ExchangeOnlineManagement', status: 'missing' }]);
    expect(s.prereq?.certificate).toEqual({ thumbprint: 'ABCDEF0123456789', path: 'C:\\certs\\ridgeline.pfx', status: 'missing' });
    expect(h.streams[0]!.closed).toBe(true);

    const install = s.installModule('ExchangeOnlineManagement');
    const installStream = h.streams[1]!;
    expect(installStream.url).toBe('/api/prereqs/install?module=ExchangeOnlineManagement');
    expect(useTenantStore.getState().prereq?.modules[0]!.status).toBe('working');
    installStream.emit({ type: 'install_progress', message: 'Installing module' });
    installStream.emit({ type: 'install_done', success: true });
    expect(await install).toBe(true);
    s = useTenantStore.getState();
    expect(s.prereq?.modules[0]!.status).toBe('done');
    expect(h.streams).toHaveLength(2);

    await s.importCert('C:\\certs\\ridgeline.pfx', 'fictional-pass');
    // The typed client posts both keys and reads the event-stream reply (no store-level fetch).
    expect(h.calls.filter((c) => c.url === '/api/prereqs/import-cert')).toEqual([
      { method: 'POST', url: '/api/prereqs/import-cert', body: { certPath: 'C:\\certs\\ridgeline.pfx', password: 'fictional-pass' } },
    ]);
    s = useTenantStore.getState();
    expect(s.prereq).toBeNull();
    expect(h.streams[2]!.url).toBe('/api/connect?tenant=ridgeline');
    expect(consoleMessages()).toEqual([]);
  });

  it('a failed install offers retry and logs the failure', async () => {
    h = installHarness(tenantRoutes);
    await changeTenant('ridgeline');
    useTenantStore.getState().toggleGate(true);
    h.streams[0]!.emit({ type: 'prereq_blocked', message: 'Missing modules', missing: ['MicrosoftTeams', 'PnP.PowerShell'] });
    const done = useTenantStore.getState().installModule('MicrosoftTeams');
    h.streams[1]!.emit({ type: 'install_done', success: false });
    expect(await done).toBe(false);
    expect(useTenantStore.getState().prereq?.modules[0]!.status).toBe('failed');
    expect(consoleMessages().at(-1)).toBe('MicrosoftTeams installation failed');
  });
});

describe('preflight and add tenant', () => {
  it('preflight streams, logs the legacy rows and saves the run log', async () => {
    h = installHarness([...tenantRoutes, on('POST', '/api/save-run-log', { ok: true, path: 'C:\\runs\\run-log.json' })]);
    await changeTenant('ridgeline');
    useTenantStore.getState().preflight();
    expect(useTenantStore.getState().preflightRunning).toBe(true);
    const s = h.streams[0]!;
    expect(s.url).toBe('/api/preflight?tenant=ridgeline');
    s.emit({ type: 'preflight_check', phase: 'graph_permission', name: 'Policy.Read.All', status: 'granted' });
    s.emit({ type: 'preflight_summary', graphPermissions: { alreadyGranted: 1, newlyGranted: 0, failed: 0, total: 1 }, directoryRoles: { alreadyAssigned: 0, newlyAssigned: 0, failed: 1, total: 1 } });
    s.emit({ type: 'preflight_done' });
    await flush();
    const st = useTenantStore.getState();
    expect(st.preflightRunning).toBe(false);
    expect(consoleMessages()).toEqual([
      '✓ [Perm] Policy.Read.All — granted',
      '--- Preflight Summary ---',
      'Graph Permissions: 1 existing, 0 granted, 0 failed (of 1)',
      'Directory Roles: 0 existing, 0 assigned, 1 failed (of 1)',
      'Preflight complete.',
      'Run log saved: C:\\runs\\run-log.json',
    ]);
    const save = h.calls.find((c) => c.url === '/api/save-run-log')!;
    const log = (save.body as { log: Record<string, unknown> }).log;
    expect(Object.keys(save.body as object)).toEqual(['log']);
    expect(log['mode']).toBe('preflight');
    expect(log['tenant']).toBe('ridgeline');
    expect((log['consoleLog'] as unknown[]).length).toBe(3);
    expect(st.toast?.title).toBe('Preflight Complete');
    // One run log and one Save Log message for every card (W8-SPAW).
    expect(useConsoleStore.getState().saveMessage).toEqual({ text: 'Saved: C:\\runs\\run-log.json', tone: 'ok' });
  });

  it('preflight needs a tenant', () => {
    h = installHarness(tenantRoutes);
    useTenantStore.getState().preflight();
    expect(statusBar()?.message).toBe('Select a tenant before running preflight.');
    expect(h.streams).toHaveLength(0);
  });

  it('save tenant validates, posts { json }, reloads the list and selects the new tenant', async () => {
    h = installHarness([
      ...tenantRoutes,
      on('POST', '/api/tenants', { ok: true, slug: 'larkspur', client_name: 'Larkspur Avionics' }),
      on('GET', '/api/tenants/larkspur', { ok: true, config: {} }),
    ]);
    useTenantStore.getState().setTenantJson('not json');
    await saveTenant();
    expect(statusBar()?.message).toMatch(/^Invalid JSON: /);
    const json = JSON.stringify({ client: { slug: 'larkspur', name: 'Larkspur Avionics' } });
    useTenantStore.getState().openAddTenant();
    useTenantStore.getState().setTenantJson(json);
    await saveTenant();
    expect(h.calls[0]).toEqual({ method: 'POST', url: '/api/tenants', body: { json } });
    expect(h.lines()[1]).toBe('GET /api/tenants');
    const s = useTenantStore.getState();
    expect(s.slug).toBe('larkspur');
    expect(s.addTenantOpen).toBe(false);
    expect(consoleMessages()).toEqual(['Adding new tenant config...', 'Tenant saved: Larkspur Avionics (larkspur)']);
    expect(h.lines()).toContain('GET /api/tenants/larkspur');
  });

  it('save tenant shows the server error', async () => {
    h = installHarness([on('POST', '/api/tenants', { ok: false, error: 'client.slug is required' }, 400)]);
    useTenantStore.getState().setTenantJson('{}');
    await saveTenant();
    expect(statusBar()?.message).toBe('Save failed: client.slug is required');
  });
});
