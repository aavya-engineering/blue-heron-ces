// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30 test fixtures (tests only): a small registry in the /api/commands shape, and a fake AO
// server behind the setFetcher seam that records every call. UPNs are neutral placeholders.

import { setFetcher } from '../api';
import type { AoCommand, Fetcher } from '../api';

export const A02: AoCommand = {
  id: 'A-02',
  title: 'Disable Account',
  domain: 'A',
  domainName: 'Identity & Access Management',
  sodTier: 'Tier 2',
  overview: 'Blocks sign-in for a departing user.',
  cmmcPractices: ['AC.L1-3.1.1', 'PS.L2-3.9.2'],
  evidence_objectives: ['AC.L1-3.1.1[a]', 'PS.L2-3.9.2[b]'],
  parameters: [
    { name: 'targetUPN', label: 'Target UPN', type: 'text', required: true, placeholder: 'user@example.test' },
    { name: 'tenantDomain', label: 'Tenant domain', type: 'readonly', source: 'tenant.domain', required: true },
    { name: 'reason', label: 'Reason', type: 'select', required: false, options: [{ value: 'leaver', label: 'Leaver' }, { value: 'risk', label: 'Risk' }] },
  ],
};

export const B09: AoCommand = {
  id: 'B-09',
  title: 'Grant Privileged Role',
  domain: 'B',
  domainName: 'Privileged Access',
  sodTier: 'Tier 3',
  overview: 'Grants a privileged directory role.',
  cmmcPractices: ['AC.L2-3.1.5'],
  evidence_objectives: ['AC.L2-3.1.5[a]'],
  parameters: [],
};

export const F12: AoCommand = {
  id: 'F-12',
  title: 'Allocate Azure Firewall',
  domain: 'F',
  domainName: 'Network',
  sodTier: 'Tier 3',
  overview: 'Allocates the Azure Firewall.',
  cmmcPractices: ['SC.L1-3.13.1'],
  evidence_objectives: ['SC.L1-3.13.1[a]'],
  parameters: [],
  cost_gate: { recurring: true, cost_key: 'azure.firewall.premium', last_resort: true, standard_alternative: ['AZ-NSG-006', 'AZ-SEP-001'] },
};

export const COMMANDS = [A02, B09, F12];

export function commandsReply(cmds: AoCommand[] = COMMANDS) {
  const m = new Map<string, AoCommand[]>();
  for (const c of cmds) m.set(c.domain, [...(m.get(c.domain) ?? []), c]);
  return { domains: [...m.entries()].map(([id, commands]) => ({ id, name: commands[0].domainName, commands })) };
}

export interface Call {
  method: string;
  url: string;
  body: any;
  headers: Record<string, string>;
}

export interface FakeServer {
  calls: Call[];
  pending: unknown[];
  /** Reply for POST /api/execute/:id; default: a dry run / executed success row. */
  execute: (id: string, body: any) => { status: number; body: object };
  decision: { status: number; body: object };
  restore: () => void;
  executeCalls: () => Call[];
}

export function okExecute(id: string, body: any) {
  return {
    status: 200,
    body: {
      success: true,
      result: { success: true, stdout: `${id} ok` },
      evidence: {
        outcome: body.dryRun ? 'dry_run' : 'automated_success',
        complianceVerdict: body.dryRun ? 'NOT_APPLICABLE' : 'SAT',
        // Like the real executor: ordinary rows carry no twoPersonApproval record (only 428 and rejection rows do).
        metadata: { dryRun: !!body.dryRun, mode: body.dryRun ? 'dry_run' : 'live' },
      },
      evidencePath: `adminops_evidence/${id}:x`,
      correlationId: body.correlationId,
      evidencePersisted: true,
    },
  };
}

export function installFakeServer(): FakeServer {
  const fake: FakeServer = {
    calls: [],
    pending: [],
    execute: okExecute,
    decision: { status: 200, body: { success: true, evidencePersisted: true } },
    restore: () => {},
    executeCalls: () => fake.calls.filter((c) => c.url.startsWith('/api/execute/')),
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetcher: Fetcher = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    fake.calls.push({ method, url, body, headers: (init?.headers as Record<string, string>) ?? {} });
    if (url === '/api/tenants') return json(200, { tenants: [{ slug: 'sim-s1', kind: 'sim' }, { slug: 'contoso', kind: 'live' }], liveAllowed: false, stacksimModeActive: true });
    if (url === '/api/commands') return json(200, commandsReply());
    if (url.startsWith('/api/tenant/bindings')) return json(200, { bindings: { tenantDomain: 'sim-s1.example.test' } });
    if (url.startsWith('/api/approvals/') && method === 'POST') return json(fake.decision.status, fake.decision.body);
    if (url.startsWith('/api/approvals')) return json(200, { success: true, approvals: fake.pending });
    if (url.startsWith('/api/execute/')) {
      const id = decodeURIComponent(url.slice('/api/execute/'.length));
      const r = fake.execute(id, body);
      return json(r.status, r.body);
    }
    return json(404, {});
  };
  const previous = setFetcher(fetcher);
  fake.restore = () => setFetcher(previous);
  return fake;
}
