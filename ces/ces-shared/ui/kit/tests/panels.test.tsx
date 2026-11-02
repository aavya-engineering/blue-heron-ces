// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-KIT2 panels: behaviour, legacy ids (AD-4), exports, axe per component. Fictional data only (AR6).
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import {
  buildLedgerExport,
  ConsoleView,
  DEFAULT_LEDGER_FILTER,
  ErrorLog,
  ExecutionResultsTable,
  filterLedger,
  ledgerSha256,
  ledgerToCsv,
  ledgerToJson,
  ledgerToMarkdown,
  MissingPrerequisites,
  ResourceLedger,
  TerminalView,
  type LedgerEntry,
  type RunLogEntry,
  type TerminalBlock,
} from '../src';
import * as panels from '../src/panels';
import { GALLERY_LEDGER, PanelsGallery } from '../gallery/PanelsGallery';

afterEach(cleanup);

async function seriousViolations(root: Element) {
  // jsdom cannot compute colour contrast; that rule is checked in the browser (SPA axe run).
  const result = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const LEDGER: readonly LedgerEntry[] = GALLERY_LEDGER;
const META = { planId: 'plan-ridgeline-0412', tenant: 'ridgeline', timestamp: '2026-10-29T15:00:00.000Z', operator: 'Avery Quill' };

describe('ledger data', () => {
  it('filters by category, type, step and AND-ed search terms', () => {
    expect(filterLedger(LEDGER, DEFAULT_LEDGER_FILTER)).toHaveLength(4);
    expect(filterLedger(LEDGER, { ...DEFAULT_LEDGER_FILTER, created: false })).toHaveLength(2);
    expect(filterLedger(LEDGER, { ...DEFAULT_LEDGER_FILTER, discovered: false, created: false })).toHaveLength(0);
    expect(filterLedger(LEDGER, { ...DEFAULT_LEDGER_FILTER, type: 'MgGroup' })).toHaveLength(2);
    expect(filterLedger(LEDGER, { ...DEFAULT_LEDGER_FILTER, step: 'AU.L2-3.3.1-T2' })).toHaveLength(1);
    expect(filterLedger(LEDGER, { ...DEFAULT_LEDGER_FILTER, search: '  MGGROUP  pim ' })).toHaveLength(1);
    expect(filterLedger(LEDGER, { ...DEFAULT_LEDGER_FILTER, search: 'mggroup nomatch' })).toHaveLength(0);
  });

  it('markdown export matches the legacy layout', () => {
    const md = ledgerToMarkdown(LEDGER, META).split('\n');
    expect(md.slice(0, 6)).toEqual([
      '# Resource Ledger',
      '**Plan ID:** plan-ridgeline-0412',
      '**Tenant:** ridgeline',
      '**Timestamp:** 2026-10-29T15:00:00.000Z',
      '**Operator:** Avery Quill',
      '',
    ]);
    expect(md).toContain('## Discovered Resources (2)');
    expect(md).toContain('## Created Resources (2)');
    expect(md).toContain('| Type | Path | Step | Cmdlet | Timestamp |');
    const vault = md.find((l) => l.startsWith('| vaults'));
    expect(vault).toBe(
      `| vaults | kv-ridgeline-evidence | SC.L2-3.13.11-T1 | ${LEDGER[3].cmdlet.substring(0, 50)} | 2026-10-29T14:06:19.000Z |`,
    );
  });

  it('csv export quotes fields and doubles inner quotes', () => {
    const csv = ledgerToCsv(LEDGER).split('\n');
    expect(csv[0]).toBe('Category,Type,Path,Step,Cmdlet,Timestamp');
    expect(csv[1]).toBe(
      'discovered,"MgGroup","ridgeline-cui-users","AC.L2-3.1.1-T1","Get-MgGroup -Filter ""displayName eq \'ridgeline-cui-users\'""",2026-10-29T14:02:11.000Z',
    );
    expect(csv).toHaveLength(5);
  });

  it('json export carries metadata, a SHA-256 of the entries, and the entries', async () => {
    const hash = await ledgerSha256(LEDGER);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const parsed = JSON.parse(ledgerToJson(LEDGER, META, hash));
    expect(parsed.executionMetadata).toEqual({ ...META, sha256Hash: hash });
    expect(parsed.resources).toEqual(LEDGER);
  });

  it('buildLedgerExport gives the legacy MIME types and filenames', async () => {
    expect(await buildLedgerExport('md', LEDGER, META)).toMatchObject({ mimeType: 'text/markdown', filename: 'resource-ledger-plan-ridgeline-0412.md' });
    expect(await buildLedgerExport('csv', LEDGER, META)).toMatchObject({ mimeType: 'text/csv', filename: 'resource-ledger-plan-ridgeline-0412.csv' });
    const json = await buildLedgerExport('json', LEDGER, META);
    expect(json).toMatchObject({ mimeType: 'application/json', filename: 'resource-ledger-plan-ridgeline-0412.json' });
    expect(JSON.parse(json.content).executionMetadata.sha256Hash).toBe(await ledgerSha256(LEDGER));
  });
});

describe('ResourceLedger', () => {
  it('renders legacy ids, groups and the count', () => {
    render(<ResourceLedger entries={LEDGER} onExport={() => {}} formatTime={(t) => t} />);
    for (const id of ['resourceLedgerPanel', 'filterDiscovered', 'filterCreated', 'filterType', 'filterStep', 'filterSearch', 'ledgerCount', 'ledgerBody']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(document.getElementById('ledgerCount')).toHaveTextContent('4 / 4 resources');
    expect(screen.getByText('Discovered Resources (2)')).toBeInTheDocument();
    expect(screen.getByText('Created Resources (2)')).toBeInTheDocument();
    expect(screen.getByText('Step: AC.L2-3.1.1-T1 | 2026-10-29T14:02:11.000Z')).toBeInTheDocument();
    const typeOptions = within(document.getElementById('filterType') as HTMLElement).getAllByRole('option').map((o) => o.textContent);
    expect(typeOptions).toEqual(['All Types', 'Mailbox', 'MgGroup', 'vaults']);
  });

  it('filters, updates the count, and exports the filtered rows', () => {
    const onExport = vi.fn();
    render(<ResourceLedger entries={LEDGER} onExport={onExport} />);
    fireEvent.click(document.getElementById('filterCreated') as HTMLElement);
    expect(document.getElementById('ledgerCount')).toHaveTextContent('2 / 4 resources');
    expect(screen.queryByText(/Created Resources/)).toBeNull();
    fireEvent.change(document.getElementById('filterSearch') as HTMLElement, { target: { value: 'mailbox' } });
    expect(document.getElementById('ledgerCount')).toHaveTextContent('1 / 4 resources');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(onExport).toHaveBeenCalledWith('csv', [LEDGER[1]]);
    fireEvent.change(document.getElementById('filterSearch') as HTMLElement, { target: { value: 'nothing-here' } });
    expect(screen.getByText('No resources match the current filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(onExport).toHaveBeenLastCalledWith('md', []);
  });

  it('caps rendering with the legacy warning, and offers close only with onClose', () => {
    const onClose = vi.fn();
    const many = Array.from({ length: 7 }, (_, i) => ({ ...LEDGER[0], path: `group-${i}` }));
    render(<ResourceLedger entries={many} onExport={() => {}} maxRendered={5} onClose={onClose} />);
    expect(screen.getByText('Showing 5 of 7 resources. Use filters to narrow results.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Close resource ledger' }));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    render(<ResourceLedger entries={LEDGER} onExport={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Close resource ledger' })).toBeNull();
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<ResourceLedger entries={LEDGER} onExport={() => {}} onClose={() => {}} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('ExecutionResultsTable', () => {
  const summary = { total: 10, pass: 6, accomplished: 1, fail: 2, skip: 1, reportJson: 'C:\\runs\\r.json', reportMd: 'C:\\runs\\r.md', dryRunLog: 'C:\\runs\\dry.log' };

  it('renders the summary and report links under the legacy ids the demo driver reads', () => {
    render(<ExecutionResultsTable summary={summary} />);
    expect(document.getElementById('results')).toHaveTextContent('Execution Results');
    const rows = screen.getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual(['MetricCount', 'Total Steps10', 'Pass (Stamper)6', 'Accomplished (Operator)1', 'Fail2', 'Skip1']);
    const links = document.querySelectorAll('#resultsContent .report-links a');
    expect(Array.from(links).map((a) => a.getAttribute('href'))).toEqual([
      'file://C:\\runs\\dry.log',
      'file://C:\\runs\\r.json',
      'file://C:\\runs\\r.md',
    ]);
    expect(document.getElementById('controlResultsSection')).toBeNull();
  });

  it('empty before a run; accomplished defaults to 0; custom hrefs', () => {
    const { rerender } = render(<ExecutionResultsTable />);
    expect(document.getElementById('resultsContent')).toBeEmptyDOMElement();
    rerender(<ExecutionResultsTable summary={{ total: 1, pass: 1, fail: 0, skip: 0, reportMd: 'r.md' }} reportHref={(p) => `/files/${p}`} />);
    expect(screen.getByRole('row', { name: /Accomplished/ })).toHaveTextContent('0');
    expect(screen.getByRole('link', { name: 'r.md' })).toHaveAttribute('href', '/files/r.md');
  });

  it('per-control table: collapsed by default, count, verdict tones, evidence file name', () => {
    render(
      <ExecutionResultsTable
        summary={summary}
        controlResults={[
          { controlId: 'AC.L2-3.1.1', directive: 'set', verdict: 'SAT', outcome: 'success', evidencePath: 'C:\\ev\\ridgeline\\ac-311.json' },
          { controlId: 'AC.L2-3.1.5', directive: 'set', verdict: 'NOT_SAT', outcome: 'failed_no_remediation' },
          { controlId: 'AU.L2-3.3.1', directive: 'manual', verdict: 'PROVISIONAL', outcome: 'verification_pending' },
          { controlId: 'PE.L2-3.10.1', directive: 'document', verdict: 'N/A', outcome: 'inherited' },
        ]}
      />,
    );
    const toggle = screen.getByRole('button', { name: /Control Execution Results/ });
    expect(document.getElementById('controlResultsCount')).toHaveTextContent('(4)');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('controlResultsBody')).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('controlResultsBody')).toBeVisible();
    expect(screen.getByText('SAT')).toHaveClass('ck-verdict-sat');
    expect(screen.getByText('NOT_SAT')).toHaveClass('ck-verdict-notsat');
    expect(screen.getByText('PROVISIONAL')).toHaveClass('ck-verdict-provisional');
    expect(screen.getByText('N/A')).toHaveClass('ck-verdict-na');
    expect(screen.getByText('ac-311.json')).toHaveAttribute('title', 'C:\\ev\\ridgeline\\ac-311.json');
    expect(screen.getAllByText('--')).toHaveLength(3);
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(
      <ExecutionResultsTable summary={summary} controlResults={[{ controlId: 'AC.L2-3.1.1', directive: 'set', verdict: 'SAT', outcome: 'success' }]} defaultExpanded />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('MissingPrerequisites', () => {
  const cert = { thumbprint: 'A1B2C3D4E5F60718', path: 'C:\\certs\\ridgeline-app.pfx' };

  it('renders the certificate row and module rows with legacy texts', () => {
    render(
      <MissingPrerequisites
        modules={[{ name: 'ExchangeOnlineManagement' }, { name: 'MicrosoftTeams', status: 'working' }, { name: 'PnP.PowerShell', status: 'done' }]}
        certificate={cert}
        onInstall={() => {}}
        onInstallAll={() => {}}
        onImportCert={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Missing Prerequisites' })).toBeInTheDocument();
    expect(screen.getByText('Certificate (A1B2C3D4...)')).toBeInTheDocument();
    expect(screen.getByText('not in store')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install ExchangeOnlineManagement' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Installing... MicrosoftTeams' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Installed PnP.PowerShell' })).toBeDisabled();
    expect(screen.getByText('installing...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install All Modules' })).toBeDisabled();
  });

  it('install, install all (pending names only), retry after failure', () => {
    const onInstall = vi.fn();
    const onInstallAll = vi.fn();
    render(
      <MissingPrerequisites
        modules={[{ name: 'ExchangeOnlineManagement' }, { name: 'MicrosoftTeams', status: 'failed' }, { name: 'PnP.PowerShell', status: 'done' }]}
        onInstall={onInstall}
        onInstallAll={onInstallAll}
        onImportCert={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Install ExchangeOnlineManagement' }));
    expect(onInstall).toHaveBeenCalledWith('ExchangeOnlineManagement');
    fireEvent.click(screen.getByRole('button', { name: 'Retry MicrosoftTeams' }));
    expect(onInstall).toHaveBeenLastCalledWith('MicrosoftTeams');
    fireEvent.click(screen.getByRole('button', { name: 'Install All Modules' }));
    expect(onInstallAll).toHaveBeenCalledWith(['ExchangeOnlineManagement', 'MicrosoftTeams']);
  });

  it('no Install All for a single module', () => {
    render(<MissingPrerequisites modules={[{ name: 'MicrosoftTeams' }]} onInstall={() => {}} onInstallAll={() => {}} onImportCert={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Install All Modules' })).toBeNull();
  });

  it('certificate import needs a password; Enter submits; busy states disable the row', () => {
    const onImportCert = vi.fn();
    const { rerender } = render(<MissingPrerequisites modules={[]} certificate={cert} onInstall={() => {}} onInstallAll={() => {}} onImportCert={onImportCert} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImportCert).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the PFX password to import');
    const pw = screen.getByLabelText('PFX password');
    fireEvent.change(pw, { target: { value: 'not-a-real-secret' } });
    fireEvent.keyDown(pw, { key: 'Enter' });
    expect(onImportCert).toHaveBeenCalledWith('C:\\certs\\ridgeline-app.pfx', 'not-a-real-secret');
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<MissingPrerequisites modules={[]} certificate={{ ...cert, status: 'working' }} onInstall={() => {}} onInstallAll={() => {}} onImportCert={onImportCert} />);
    expect(screen.getByRole('button', { name: 'Importing...' })).toBeDisabled();
    expect(screen.getByLabelText('PFX password')).toBeDisabled();
    rerender(<MissingPrerequisites modules={[]} certificate={{ ...cert, status: 'failed' }} onInstall={() => {}} onInstallAll={() => {}} onImportCert={onImportCert} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(
      <MissingPrerequisites modules={[{ name: 'ExchangeOnlineManagement' }, { name: 'MicrosoftTeams' }]} certificate={cert} onInstall={() => {}} onInstallAll={() => {}} onImportCert={() => {}} />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('ErrorLog', () => {
  const failed: RunLogEntry = {
    status: 'fail',
    taskId: 'AC.L2-3.1.5-T1',
    subId: 'pim-role-assignment',
    controls: ['AC.L2-3.1.5', 'AC.L2-3.1.6'],
    command: 'fallback-command',
    streams: [
      { phase: 'get_command', command: 'Get-Thing', stdout: 'get-out' },
      { phase: 'set_command', command: 'Set-Thing', stdout: 'set-out', stderr: 'denied' },
      { phase: 'post_set_get', stdout: 'post-out' },
      { phase: 'verification', stdout: '{"details":{"found":0}}' },
    ],
  };

  it('renders nothing when no entry failed', () => {
    const { container } = render(<ErrorLog entries={[{ status: 'pass', taskId: 't1' }]} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    expect(render(<ErrorLog entries={null} />).container).toBeEmptyDOMElement();
  });

  it('derives command, response, determination and verification as the legacy panel does', () => {
    render(<ErrorLog entries={[{ status: 'pass', taskId: 'ok' }, failed]} />);
    expect(document.getElementById('errorLogPanel')).toHaveTextContent('Error Log');
    expect(document.getElementById('errorLogContent')?.children).toHaveLength(1);
    expect(screen.getByText('AC.L2-3.1.5')).toBeInTheDocument();
    expect(screen.getByText('pim-role-assignment')).toBeInTheDocument();
    const values = Array.from(document.querySelectorAll('.ck-error-row-value')).map((v) => v.textContent);
    expect(values[0]).toBe('Set-Thing');
    expect(values[1]).toBe('get-out\n--- SET ---\nset-out\nSTDERR: denied\n--- POST-SET ---\npost-out');
    expect(values[2]).toBe('{"details":{"found":0}}');
    expect(screen.getByText('FAIL')).toHaveClass('ck-verdict-badge-fail');
    expect(document.querySelector('.ck-error-reason')?.textContent).toBe(JSON.stringify({ found: 0 }, null, 2));
  });

  it('uses the outcome label and rationale; falls back to the task id and entry command', () => {
    render(<ErrorLog entries={[{ status: 'fail', taskId: 'SC.L2-3.13.8-T1', command: 'Get-Only', outcome: 'failed_remediation_available', outcomeRationale: 'TLS 1.0 still enabled (simulated)' }]} />);
    expect(screen.getByText('NOT SAT (remediation available)')).toBeInTheDocument();
    expect(screen.getByText('TLS 1.0 still enabled (simulated)')).toBeInTheDocument();
    expect(screen.getByText('SC.L2-3.13.8-T1')).toBeInTheDocument();
    expect(screen.getByText('Get-Only')).toBeInTheDocument();
    expect(screen.queryByText('Tenant Response')).toBeNull();
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<ErrorLog entries={[failed]} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('ConsoleView', () => {
  const entries = [
    { time: '14:01:02', level: 'info' as const, message: 'Connecting...' },
    { time: '14:01:04', level: 'error' as const, message: 'Exchange Online session failed' },
    { time: '14:01:05', message: 'Checking prerequisites...' },
  ];

  it('keeps #taskList and the classes the demo driver counts', () => {
    render(<ConsoleView entries={entries} />);
    expect(document.querySelectorAll('#taskList .connection-log-row')).toHaveLength(3);
    expect(document.querySelectorAll('#taskList .connection-log-row .log-icon.error')).toHaveLength(1);
    expect(document.querySelectorAll('#taskList .log-icon.info')).toHaveLength(2);
    expect(screen.getByRole('log', { name: 'Console' })).toBeInTheDocument();
  });

  it('shows the spinner only on the last row ending in "..."', () => {
    const { rerender } = render(<ConsoleView entries={entries} />);
    expect(document.querySelectorAll('.ck-log-spinner')).toHaveLength(1);
    expect(document.querySelectorAll('.connection-log-row')[2].querySelector('.ck-log-spinner')).not.toBeNull();
    rerender(<ConsoleView entries={entries.slice(0, 2)} />);
    expect(document.querySelectorAll('.ck-log-spinner')).toHaveLength(0);
  });

  it('renders children inside the scroll region and acts as a tab panel when labelled', () => {
    render(
      <>
        <button id="tab-console" type="button" role="tab">Console</button>
        <ConsoleView entries={entries} labelledBy="tab-console">
          <p>child slot</p>
        </ConsoleView>
      </>,
    );
    expect(within(document.getElementById('taskList') as HTMLElement).getByText('child slot')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Console' })).toBeInTheDocument();
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<ConsoleView entries={entries} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('TerminalView', () => {
  const blocks: TerminalBlock[] = [
    { kind: 'separator', time: '14:05:10', id: 'pim-role-assignment', label: 'Assign role' },
    { kind: 'action', index: 2, total: 4, subId: 'pim-role-assignment', label: 'Assign role', engine: 'ms_graph' },
    { kind: 'line', phase: 'get', label: 'GET', command: 'Get-Thing', stdout: '   ' },
    { kind: 'line', phase: 'postset', command: 'Get-Thing', stdout: 'value', errors: ['Forbidden: denied'], meta: 'exit 1' },
    { kind: 'error', text: 'Task failed: denied' },
    { kind: 'verdict', pass: false },
  ];

  it('renders every block kind under #terminalList', () => {
    render(<TerminalView blocks={blocks} />);
    const list = document.getElementById('terminalList') as HTMLElement;
    expect(list.querySelector('.ck-term-separator')).toHaveTextContent('14:05:10pim-role-assignmentAssign role');
    expect(list.querySelector('.ck-term-action')).toHaveTextContent('Action 2/4pim-role-assignmentAssign rolems_graph');
    const lines = list.querySelectorAll('.ck-term-line');
    expect(lines[0].querySelector('.ck-term-phase')).toHaveTextContent('GET');
    expect(lines[0].querySelector('.ck-term-phase')).toHaveClass('ck-term-phase-get');
    expect(lines[0].querySelector('.ck-term-out')).toHaveTextContent('(empty)');
    expect(lines[1].querySelector('.ck-term-phase')).toHaveTextContent('POSTSET');
    expect(lines[1].querySelector('.ck-term-err')).toHaveTextContent('Forbidden: denied');
    expect(lines[1].querySelector('.ck-term-meta')).toHaveTextContent('exit 1');
    expect(list.querySelectorAll(':scope > .ck-term-err')).toHaveLength(1);
    expect(list.querySelector('.ck-term-verdict')).toHaveTextContent('\u25CF FAIL');
    expect(list.querySelector('.ck-term-verdict')).toHaveAttribute('data-verdict', 'fail');
  });

  it('hidden hides the region', () => {
    render(<TerminalView blocks={blocks} hidden />);
    expect(document.getElementById('terminalList')).not.toBeVisible();
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<TerminalView blocks={blocks} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('panels gallery and public API', () => {
  it('gallery panels work: export callback, prerequisite install, terminal tab', () => {
    render(<PanelsGallery />);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.getByText('JSON export: 4 resources')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install ExchangeOnlineManagement' }));
    expect(screen.getByRole('button', { name: 'Installed ExchangeOnlineManagement' })).toBeDisabled();
    expect(document.getElementById('galleryPanelsTerminal')).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal transcript' }));
    expect(document.getElementById('galleryPanelsTerminal')).toBeVisible();
    expect(document.getElementById('galleryPanelsConsole')).not.toBeVisible();
  });

  it('gallery panels have no serious or critical axe violations (both tabs)', async () => {
    const { container } = render(<PanelsGallery />);
    expect(await seriousViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal transcript' }));
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('panels/index.ts exports ResourceLedger (W8-KIT2 landed-when) and the rest', () => {
    expect(typeof panels.ResourceLedger).toBe('function');
    for (const name of ['ExecutionResultsTable', 'MissingPrerequisites', 'ErrorLog', 'ConsoleView', 'TerminalView', 'filterLedger', 'buildLedgerExport']) {
      expect(typeof (panels as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
