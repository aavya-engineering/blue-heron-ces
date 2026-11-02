// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// V118 (FINISH-PLAN.md §1.3; slice FIN-22): the session-family lint. Every command's cmdlet
// families must be connected by the session(s) it runs in. It closes SM (the live session
// mismatch, AUDIT-ADMINOPS.md finding 1) in code; live confirmation stays in PH-L.
//
//  - AO (ces-ao, this package): every cmdlet in the 97 templates is classified; the sessions
//    RegistryBridge declares serve every family; the engine is the primary session's engine.
//  - The Stamper adapter as it is today (read only): which AO commands its regex-chosen
//    Connect-* lines leave unserved. AO runs the adapter's single-command path, which spawns one
//    PowerShell per command and connects by regex (buildGCCHighConnection), not by `engine`.
//    Pinned as a ratchet (may only shrink) until the adapter reads `_sessions` (LOG-FIN-22.md).
//  - Stamper's two registries (read only): Stamper runs each sub-command in ONE persistent
//    session, ENGINE_SESSION_MAP[engine] ?? 'graph'. Entries whose cmdlets that session does not
//    serve are pinned as a ratchet; the registry owner fixes them (FIN-40, then DEPTH-2).
//
// Set V118_PRINT=1 to print the tables.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENGINE_SESSION_MAP } from 'ces-shared/session';
import { PowerShellAdapter } from 'ces-stamper/adapters/powershell';
import {
  classifyCmdlet,
  cmdletsIn,
  ENGINE_FOR_SESSION,
  requiredSessionsForScript,
  unservedCmdlets,
  type AoSession,
} from '../src/execution/AdapterRouter.js';
import { translateAoCommandToCommandEntry } from '../src/registry/RegistryBridge.js';
import { getCommandTemplates } from '../src/registry/TemplateRegistry.js';
import { executeGetThenSet } from '../src/execution/GetThenSetExecutor.js';
import type { AoCommand } from '../src/types/AoCommand.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(path.resolve(__dirname, '../src/registry/ao-commands.registry.json'), 'utf-8'),
) as AoCommand[];
const STAMPER_REGISTRIES = ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'].map((f) => ({
  file: f,
  entries: (JSON.parse(readFileSync(path.resolve(__dirname, '../../ces-stamper/src/registry', f), 'utf-8')) as {
    entries: Array<Record<string, any>>;
  }).entries,
}));
const PRINT = process.env.V118_PRINT === '1';

/** Ops that use a module no CES session connects. Each needs a re-template (open item in LOG-FIN-22.md). */
const KNOWN_UNCONNECTABLE: Record<string, string> = {
  'G-06': 'Get-PnPListItem (PnP.PowerShell; no CES session connects PnP)',
  'C-03': 'az keyvault key show/rotate (Azure CLI; Connect-AzAccount does not sign in az)',
  'C-05': 'az keyvault certificate list (Azure CLI)',
  'F-06': 'az network nsg list (Azure CLI)',
  'E-01': 'az monitor log-analytics workspace update (Azure CLI, set)',
  'E-03': 'az monitor diagnostic-settings list (Azure CLI)',
  'F-08': 'az resource update (Azure CLI, set)',
  'H-07': 'az backup job list (Azure CLI)',
};

/**
 * Ratchet: AO commands whose cmdlets the Stamper adapter's regex-chosen Connect-* lines do not
 * serve TODAY ("<op>.<field>: <cmdlets>"). This is the live SM list. It may only shrink: it
 * empties once the adapter connects the declared `_sessions` (diff in LOG-FIN-22.md §3).
 */
// FIN-22 merged: the adapter connects every declared `_sessions`, so no gap remains (was 29 at R-F1).
const ADAPTER_TODAY_GAPS = new Set<string>([]);

/** Ratchet: Stamper entries whose engine's one session does not serve all their cmdlets. Read only here. */
const STAMPER_KNOWN = new Set<string>([
  // manual_gate -> no session -> 'graph' fallback; Get-Label needs the IPPS (Purview) session.
  'MP.L2-3.8.7.removable-id',
  // engine az -> the Az PowerShell session; these call the Azure CLI (`az ...`), which no CES session signs in.
  'AU.L2-3.3.3.sentinel-connector',
  'SC.L2-3.13.2.advisor',
  'SI.L2-3.14.7.threat-intel',
  'AZ-SEN-001',
  'AZ-DIAG-007',
  'AZ-DIAG-008',
  'AZ-SEN-009',
]);

const FIELDS = ['get_command', 'set_command'] as const;

function aoFields(): Array<{ id: string; field: string; text: string }> {
  const out: Array<{ id: string; field: string; text: string }> = [];
  for (const c of REGISTRY) {
    const t = getCommandTemplates(c.id);
    if (!t) continue;
    for (const f of FIELDS) if (t[f]) out.push({ id: c.id, field: f, text: t[f] });
  }
  return out;
}

/** Sessions the Stamper adapter's single-command path connects for this command, as built today. */
function adapterConnects(adapter: any, command: string, declared: AoSession[]): AoSession[] {
  const task = { id: 't', action: { command, engine: 'x', args: { _sessions: declared } } };
  if (!adapter.requiresM365Connection(task)) return [];
  const text: string = adapter.buildGCCHighConnection(command, declared);
  const out: AoSession[] = [];
  const add = (re: RegExp, s: AoSession) => { if (re.test(text) && !out.includes(s)) out.push(s); };
  add(/Connect-MgGraph/, 'graph');
  add(/Connect-ExchangeOnline/, 'exchange');
  add(/Connect-IPPSSession/, 'purview');
  add(/Connect-AzAccount/, 'azure');
  add(/Connect-SPOService/, 'sharepoint');
  add(/Connect-MicrosoftTeams/, 'teams');
  return out;
}

describe('V118: session-family lint', () => {
  it('the local session table matches ces-shared ENGINE_SESSION_MAP', () => {
    for (const [session, engine] of Object.entries(ENGINE_FOR_SESSION)) {
      expect(ENGINE_SESSION_MAP[engine], engine).toBe(session);
    }
  });

  it('the classifier reads cmdlets, not prose in literals, parameters or properties', () => {
    expect(cmdletsIn("Write-Output 'Get-then-set Allow-VNet-In'; $x.Get-Foo; Get-MgUser -Remove-Me | Select-Object Id")).toEqual([
      'Write-Output', 'Get-MgUser', 'Select-Object',
    ]);
    expect(classifyCmdlet('Search-UnifiedAuditLog')).toEqual({ kind: 'session', sessions: ['exchange'] });
    expect(classifyCmdlet('Get-DlpCompliancePolicy')).toEqual({ kind: 'session', sessions: ['purview'] });
    expect(classifyCmdlet('Get-AdminAuditLogConfig')).toEqual({ kind: 'session', sessions: ['exchange', 'purview'] });
    expect(classifyCmdlet('Invoke-AzRestMethod')).toEqual({ kind: 'session', sessions: ['azure'] });
    expect(classifyCmdlet('Get-CsTeamsMeetingPolicy')).toEqual({ kind: 'session', sessions: ['teams'] });
    expect(classifyCmdlet('Set-ReportSubmissionPolicy')).toEqual({ kind: 'session', sessions: ['exchange'] });
    expect(classifyCmdlet('Get-PnPListItem').kind).toBe('unconnectable');
    expect(classifyCmdlet('Get-Frobnicator').kind).toBe('unknown');
    expect(cmdletsIn("$v='{x}'; az keyvault key show --vault-name $v")).toEqual(['az-cli']);
    expect(cmdletsIn("Write-Output 'run az keyvault'; $az = 1")).toEqual(['Write-Output']);
    expect(classifyCmdlet('az-cli').kind).toBe('unconnectable');
    expect(requiredSessionsForScript('Update-MgUser -UserId x; Set-Mailbox -Identity x')).toEqual(['graph', 'exchange']);
    expect(requiredSessionsForScript('Get-AdminAuditLogConfig; Get-Label')).toEqual(['purview']);
    expect(requiredSessionsForScript('Select-Object')).toEqual([]);
  });

  it('AO: every cmdlet in every template is classified (no unknown family)', () => {
    const unknown: string[] = [];
    for (const f of aoFields()) {
      for (const c of cmdletsIn(f.text)) if (classifyCmdlet(c).kind === 'unknown') unknown.push(`${f.id}.${f.field}: ${c}`);
    }
    expect(unknown).toEqual([]);
  });

  it('AO: the declared sessions serve every family; only the pinned ops use an unconnectable module', () => {
    const bad: string[] = [];
    const unconnectable = new Set<string>();
    const table: string[] = [];
    for (const c of REGISTRY) {
      const entry = translateAoCommandToCommandEntry(c);
      table.push(`${c.id}\t${c.sodTier}\t${entry.engine}\t${entry.sessions.join('+') || '(local only)'}`);
      for (const f of FIELDS) {
        for (const u of unservedCmdlets(entry[f] || '', entry.sessions)) {
          if (u.cls.kind === 'unconnectable') unconnectable.add(c.id);
          else bad.push(`${c.id}.${f}: ${u.cmdlet} (${u.cls.kind})`);
        }
      }
      if (entry.sessions.length > 0) expect(entry.engine, c.id).toBe(ENGINE_FOR_SESSION[entry.sessions[0]]);
      expect(entry.engine, c.id).not.toBe('manual_gate');
    }
    if (PRINT) console.log(`V118 AO sessions (id, tier, engine, sessions):\n${table.join('\n')}`);
    expect(bad).toEqual([]);
    expect([...unconnectable].sort()).toEqual(Object.keys(KNOWN_UNCONNECTABLE).sort());
  });

  it('AO: the executor\'s get-then-set tasks declare the sessions of the command they carry', async () => {
    const tasks: any[] = [];
    const adapter = { execute: async (task: any) => { tasks.push(task); return { success: true, stdout: '<<AO-STATE-BEGIN>>{}<<AO-STATE-END>>', exit_code: 0 }; } };
    const a02 = translateAoCommandToCommandEntry(REGISTRY.find((c) => c.id === 'A-02')!);
    await executeGetThenSet(adapter as any, a02, { upn: 'u@x.onmicrosoft.us' }, false);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    const setTask = tasks.find((t) => /Set-Mailbox/.test(t.action.command));
    expect(setTask.action.args._sessions).toEqual(['graph', 'exchange']);
    const getTask = tasks.find((t) => !/Set-Mailbox/.test(t.action.command));
    expect(getTask.action.args._sessions).toEqual(['graph']);
  });

  it('the Stamper adapter today: AO commands left unserved by its regex Connect-* lines (ratchet, may only shrink)', () => {
    const adapter: any = new PowerShellAdapter({
      tenantId: '00000000-0000-0000-0000-000000000000', appId: 'v118-app', certThumbprint: 'V118', domain: 'v118.onmicrosoft.us',
      subscriptionId: '', gccHighEndpoints: true, dryRun: false,
    } as any);
    const gaps: string[] = [];
    for (const f of aoFields()) {
      const declared = requiredSessionsForScript(f.text);
      const connected = adapterConnects(adapter, f.text, declared);
      const missing = unservedCmdlets(f.text, connected).filter((u) => u.cls.kind === 'session').map((u) => u.cmdlet);
      if (missing.length) gaps.push(`${f.id}.${f.field}: ${missing.join(',')}`);
    }
    if (PRINT) console.log(`V118 adapter-today gaps (${gaps.length}):\n${gaps.join('\n')}`);
    const fresh = gaps.filter((g) => !ADAPTER_TODAY_GAPS.has(g));
    expect(fresh).toEqual([]);
    const healed = [...ADAPTER_TODAY_GAPS].filter((g) => !gaps.includes(g));
    expect(healed, 'healed gaps: remove them from ADAPTER_TODAY_GAPS').toEqual([]);
  });

  it('Stamper registries (read only): entries whose engine session does not serve their cmdlets (ratchet)', () => {
    const findings: string[] = [];
    let judged = 0;
    for (const reg of STAMPER_REGISTRIES) {
      for (const e of reg.entries) {
        if (e.retired) continue;
        judged++;
        const session = (ENGINE_SESSION_MAP as Record<string, string>)[e.engine] ?? 'graph';
        const texts: string[] = [e.set_command, e.get_command, ...(Array.isArray(e.evidence_commands) ? e.evidence_commands : [])];
        if (e.lookup && typeof e.lookup.source === 'string') texts.push(e.lookup.source);
        const miss = new Set<string>();
        for (const t of texts) {
          if (typeof t !== 'string' || !t) continue;
          for (const u of unservedCmdlets(t, [session])) miss.add(`${u.cmdlet}${u.cls.kind === 'session' ? '' : `(${u.cls.kind})`}`);
        }
        if (miss.size) findings.push(`${e.entry_id} [${e.engine}->${session}]: ${[...miss].join(',')}`);
      }
    }
    if (PRINT) console.log(`V118 Stamper findings (${findings.length} of ${judged}):\n${findings.join('\n')}`);
    expect(judged).toBeGreaterThan(200);
    const ids = findings.map((f) => f.slice(0, f.indexOf(' [')));
    const fresh = findings.filter((f, i) => !STAMPER_KNOWN.has(ids[i]));
    expect(fresh).toEqual([]);
    const healed = [...STAMPER_KNOWN].filter((id) => !ids.includes(id));
    expect(healed, 'healed entries: remove them from STAMPER_KNOWN').toEqual([]);
  });
});
