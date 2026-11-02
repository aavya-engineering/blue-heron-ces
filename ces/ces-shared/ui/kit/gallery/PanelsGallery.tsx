// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Gallery entries for the W8-KIT2 panels. Every name, path and id here is fictional (AR6).
import { useState } from 'react';
import {
  ConsoleView,
  ErrorLog,
  ExecutionResultsTable,
  MissingPrerequisites,
  ResourceLedger,
  TabNav,
  TerminalView,
  type ConsoleEntry,
  type ControlResult,
  type LedgerEntry,
  type PrereqModule,
  type PrereqStatus,
  type RunLogEntry,
  type TerminalBlock,
} from '../src';

export const GALLERY_LEDGER: readonly LedgerEntry[] = [
  { category: 'discovered', type: 'MgGroup', path: 'ridgeline-cui-users', step: 'AC.L2-3.1.1-T1', timestamp: '2026-10-29T14:02:11.000Z', cmdlet: "Get-MgGroup -Filter \"displayName eq 'ridgeline-cui-users'\"" },
  { category: 'discovered', type: 'Mailbox', path: 'records@ridgeline.example', step: 'AU.L2-3.3.1-T2', timestamp: '2026-10-29T14:03:40.000Z', cmdlet: "Get-Mailbox -Identity 'records@ridgeline.example'" },
  { category: 'created', type: 'MgGroup', path: 'ridgeline-admins-pim', step: 'AC.L2-3.1.5-T1', timestamp: '2026-10-29T14:05:02.000Z', cmdlet: "New-MgGroup -DisplayName 'ridgeline-admins-pim' -SecurityEnabled" },
  { category: 'created', type: 'vaults', path: 'kv-ridgeline-evidence', step: 'SC.L2-3.13.11-T1', timestamp: '2026-10-29T14:06:19.000Z', cmdlet: 'New-AzResource -ResourceType Microsoft.KeyVault/vaults -ResourceName kv-ridgeline-evidence' },
];

const CONTROL_RESULTS: readonly ControlResult[] = [
  { controlId: 'AC.L2-3.1.1', directive: 'set', verdict: 'SAT', outcome: 'success', evidencePath: 'C:\\evidence\\ridgeline\\AC.L2-3.1.1.json' },
  { controlId: 'AC.L2-3.1.5', directive: 'set', verdict: 'NOT_SAT', outcome: 'failed_remediation_available' },
  { controlId: 'AU.L2-3.3.1', directive: 'manual', verdict: 'PROVISIONAL', outcome: 'verification_pending' },
  { controlId: 'PE.L2-3.10.1', directive: 'document', verdict: 'N/A', outcome: 'inherited' },
];

const RUN_LOG: readonly RunLogEntry[] = [
  { status: 'pass', taskId: 'AC.L2-3.1.1-T1' },
  {
    status: 'fail',
    taskId: 'AC.L2-3.1.5-T1',
    subId: 'pim-role-assignment',
    controls: ['AC.L2-3.1.5', 'AC.L2-3.1.6'],
    outcome: 'failed_remediation_available',
    outcomeRationale: 'Role assignment absent after SET; eligible assignment required for the admin group.',
    streams: [
      { phase: 'get_command', command: 'Get-MgRoleManagementDirectoryRoleEligibilitySchedule', stdout: '[]' },
      { phase: 'set_command', command: "New-MgRoleManagementDirectoryRoleEligibilityScheduleRequest -PrincipalId 'grp-ridgeline-admins'", stderr: 'Forbidden: insufficient privileges (simulated)' },
      { phase: 'verification', stdout: '{"details":{"expected":1,"found":0}}' },
    ],
  },
];

const CONSOLE: readonly ConsoleEntry[] = [
  { time: '14:01:02', level: 'info', message: 'Connecting to Ridgeline Machining (simulated)...' },
  { time: '14:01:04', level: 'success', message: 'Microsoft Graph session active' },
  { time: '14:01:06', level: 'warn', message: 'Exchange Online module not installed' },
  { time: '14:01:07', level: 'error', message: 'Exchange Online session failed' },
  { time: '14:01:08', level: 'info', message: 'Checking prerequisites...' },
];

const TERMINAL: readonly TerminalBlock[] = [
  { kind: 'separator', time: '14:05:10', id: 'pim-role-assignment', label: 'Assign eligible admin role' },
  { kind: 'action', index: 2, total: 4, subId: 'pim-role-assignment', label: 'Assign eligible admin role', engine: 'ms_graph' },
  { kind: 'line', phase: 'precheck', label: 'PRECHECK', command: 'Test-MgContext', stdout: 'ok' },
  { kind: 'line', phase: 'get', label: 'GET', command: 'Get-MgRoleManagementDirectoryRoleEligibilitySchedule', stdout: '' },
  { kind: 'line', phase: 'set', label: 'SET', command: 'New-MgRoleManagementDirectoryRoleEligibilityScheduleRequest', stdout: '{"error":{"code":"Forbidden","message":"insufficient privileges"}}', errors: ['Forbidden: insufficient privileges'] },
  { kind: 'line', phase: 'postset', label: 'VERIFY', stdout: '[]' },
  { kind: 'line', phase: 'verify', label: 'VERIFY', stdout: '{"expected":1,"found":0}', meta: 'exit 1 · 412 ms' },
  { kind: 'line', phase: 'evidence', label: 'EVIDENCE', stdout: 'captured' },
  { kind: 'line', phase: 'save', label: 'SAVE', stdout: 'C:\\evidence\\ridgeline\\AC.L2-3.1.5.json' },
  { kind: 'verdict', pass: false },
];

const CONSOLE_TABS = [
  { id: 'console', label: 'Console log', controls: 'galleryPanelsConsole' },
  { id: 'terminal', label: 'Terminal transcript', controls: 'galleryPanelsTerminal' },
] as const;

export function PanelsGallery() {
  const [tab, setTab] = useState<string>('console');
  const [exported, setExported] = useState('');
  const [modules, setModules] = useState<readonly PrereqModule[]>([
    { name: 'ExchangeOnlineManagement' },
    { name: 'MicrosoftTeams', status: 'failed' },
    { name: 'PnP.PowerShell', status: 'done' },
  ]);
  const [certStatus, setCertStatus] = useState<PrereqStatus>('missing');
  const setModule = (name: string, status: PrereqStatus) =>
    setModules((current) => current.map((m) => (m.name === name ? { ...m, status } : m)));

  return (
    <>
      <section className="gal-section" aria-labelledby="gal-ledger">
        <div className="ces-titleblock">
          <h2 id="gal-ledger" className="tb-title">Resource ledger</h2>
          <span className="tb-designator">ResourceLedger</span>
        </div>
        <ResourceLedger
          entries={GALLERY_LEDGER}
          formatTime={(ts) => ts.replace('T', ' ').replace('.000Z', ' UTC')}
          onExport={(format, rows) => setExported(`${format.toUpperCase()} export: ${rows.length} resources`)}
          onClose={() => setExported('Close requested')}
        />
        <p className="gal-note" aria-live="polite">
          {exported || 'Export buttons report here; the SPA downloads the file.'}
        </p>
      </section>

      <section className="gal-section" aria-labelledby="gal-results">
        <div className="ces-titleblock">
          <h2 id="gal-results" className="tb-title">Execution results</h2>
          <span className="tb-designator">ExecutionResultsTable</span>
        </div>
        <ExecutionResultsTable
          summary={{
            total: 42,
            pass: 35,
            accomplished: 2,
            fail: 3,
            skip: 2,
            reportJson: 'C:\\runs\\ridgeline\\execution-report.json',
            reportMd: 'C:\\runs\\ridgeline\\execution-report.md',
          }}
          controlResults={CONTROL_RESULTS}
          defaultExpanded
        />
      </section>

      <section className="gal-section" aria-labelledby="gal-errors">
        <div className="ces-titleblock">
          <h2 id="gal-errors" className="tb-title">Error log</h2>
          <span className="tb-designator">ErrorLog</span>
        </div>
        <ErrorLog entries={RUN_LOG} />
      </section>

      <section className="gal-section" aria-labelledby="gal-console">
        <div className="ces-titleblock">
          <h2 id="gal-console" className="tb-title">Console and terminal</h2>
          <span className="tb-designator">ConsoleView, TerminalView, MissingPrerequisites</span>
        </div>
        <div className="gal-console">
          <div className="gal-console-header">
            <TabNav tabs={CONSOLE_TABS} active={tab} onChange={setTab} label="Run output" idPrefix="galleryPanelsTab-" />
          </div>
          <ConsoleView
            id="galleryPanelsConsole"
            entries={CONSOLE}
            hidden={tab !== 'console'}
            labelledBy="galleryPanelsTab-console"
          >
            <MissingPrerequisites
              modules={modules}
              certificate={{ thumbprint: 'A1B2C3D4E5F60718', path: 'C:\\certs\\ridgeline-app.pfx', status: certStatus }}
              onInstall={(name) => setModule(name, 'done')}
              onInstallAll={(names) => names.forEach((name) => setModule(name, 'done'))}
              onImportCert={() => setCertStatus('done')}
            />
          </ConsoleView>
          <TerminalView
            id="galleryPanelsTerminal"
            blocks={TERMINAL}
            hidden={tab !== 'terminal'}
            labelledBy="galleryPanelsTab-terminal"
          />
        </div>
      </section>
    </>
  );
}
