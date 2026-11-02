// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 3: Adapter Router
// FIN-22 (finishing plan PH-2; closes SM, the live session mismatch of
// docs/context/functional-audit/AUDIT-ADMINOPS.md finding 1): the PowerShell
// session(s) an op needs are read from the cmdlet families its own templates use,
// not guessed from its domain letter or overview keywords.

import type { AoCommand } from '../types/AoCommand.js';
import { getCommandTemplates } from '../registry/TemplateRegistry.js';

/**
 * The six persistent session types ces-tenant can open (one `Connect-*` each;
 * `ces-shared/src/session/constants.ts` SessionType). Kept local so this module has no
 * runtime dependency on ces-shared's dist; the V118 lint test pins it equal to
 * ces-shared's ENGINE_SESSION_MAP.
 */
export type AoSession = 'graph' | 'exchange' | 'purview' | 'azure' | 'sharepoint' | 'teams';

/** The engine name that opens each session (inverse of ENGINE_SESSION_MAP's primary names). */
export const ENGINE_FOR_SESSION: Record<AoSession, string> = {
  graph: 'mgraph',
  exchange: 'exchange',
  purview: 'ipps',
  azure: 'az',
  sharepoint: 'spo',
  teams: 'teams',
};

/** What a cmdlet needs to run. */
export type CmdletClass =
  /** Served by any one of `sessions` (first = the one to open when none is connected). */
  | { kind: 'session'; sessions: AoSession[] }
  /** PowerShell / .NET built-in: runs in every session. */
  | { kind: 'local' }
  /** A module no CES session connects (e.g. PnP.PowerShell). */
  | { kind: 'unconnectable'; why: string }
  /** Not in the family table: the V118 lint refuses it until it is classified. */
  | { kind: 'unknown' };

const VERBS = [
  'Add', 'Approve', 'Assert', 'Backup', 'Block', 'Checkpoint', 'Clear', 'Close', 'Compare', 'Complete', 'Compress',
  'Confirm', 'Connect', 'Convert', 'ConvertFrom', 'ConvertTo', 'Copy', 'Debug', 'Deny', 'Deploy', 'Disable', 'Disconnect',
  'Dismount', 'Edit', 'Enable', 'Enter', 'Exit', 'Expand', 'Export', 'Find', 'ForEach', 'Format', 'Get', 'Grant', 'Group',
  'Hide', 'Import', 'Initialize', 'Install', 'Invoke', 'Join', 'Limit', 'Lock', 'Measure', 'Merge', 'Mount', 'Move', 'New',
  'Open', 'Optimize', 'Out', 'Pop', 'Protect', 'Publish', 'Push', 'Read', 'Receive', 'Redo', 'Register', 'Remove', 'Rename',
  'Repair', 'Request', 'Reset', 'Resize', 'Resolve', 'Restart', 'Restore', 'Resume', 'Revoke', 'Save', 'Search', 'Select',
  'Send', 'Set', 'Show', 'Skip', 'Sort', 'Split', 'Start', 'Step', 'Stop', 'Submit', 'Suspend', 'Switch', 'Sync', 'Tee',
  'Test', 'Trace', 'Unblock', 'Undo', 'Uninstall', 'Unlock', 'Unprotect', 'Unpublish', 'Unregister', 'Update', 'Use',
  'Wait', 'Watch', 'Where', 'Write',
];
// Longest verbs first so ConvertTo- wins over Convert-. Not preceded by a word char, `$`, `.`
// or `-` (a parameter or property), and the noun must end the token.
const CMDLET_RE = new RegExp(
  `(?<![\\w$.-])(${[...VERBS].sort((a, b) => b.length - a.length).join('|')})-([A-Za-z][A-Za-z0-9]*)(?![\\w-])`,
  'g',
);

const LOCAL = new Set([
  'Select-Object', 'Where-Object', 'ForEach-Object', 'Sort-Object', 'Group-Object', 'Measure-Object', 'Compare-Object',
  'New-Object', 'Tee-Object', 'Get-Date', 'New-TimeSpan', 'New-Guid', 'Get-Random', 'Start-Sleep', 'Out-Null', 'Out-String',
  'Out-File', 'Write-Output', 'Write-Host', 'Write-Warning', 'Write-Error', 'Write-Verbose', 'Write-Information',
  'ConvertTo-Json', 'ConvertFrom-Json', 'ConvertTo-Csv', 'ConvertFrom-Csv', 'ConvertTo-SecureString',
  'ConvertFrom-SecureString', 'Import-Csv', 'Export-Csv', 'Add-Type', 'Add-Member', 'Get-Member', 'Format-List',
  'Format-Table', 'Test-Path', 'Join-Path', 'Split-Path', 'Resolve-Path', 'Get-Content', 'Set-Content', 'Add-Content',
  'Get-ChildItem', 'Get-Item', 'New-Item', 'Remove-Item', 'Copy-Item', 'Move-Item', 'Get-ItemProperty', 'Set-ItemProperty',
  'Get-Variable', 'Set-Variable', 'New-Variable', 'Remove-Variable', 'Clear-Variable', 'Get-Command', 'Get-Module', 'Import-Module', 'Get-FileHash', 'Select-String',
  'Invoke-RestMethod', 'Invoke-WebRequest', 'Get-MpPreference', 'Get-MpComputerStatus', 'Get-Service', 'Get-Process',
  'Get-CimInstance', 'Get-BitLockerVolume', 'Get-LocalUser', 'Get-Location', 'Set-Location',
]);

// Security & Compliance PowerShell (Connect-IPPSSession) nouns.
const PURVIEW_NOUN = /^(Label|LabelPolicy|AutoSensitivityLabel(Policy|Rule)|Dlp\w*|RetentionCompliance(Policy|Rule)|HoldCompliance(Policy|Rule)|CaseHold(Policy|Rule)|ComplianceCase\w*|ComplianceSearch\w*|ComplianceTag\w*|ComplianceSecurityFilter|ComplianceRetentionEvent\w*|ProtectionAlert|UnifiedAuditLogRetentionPolicy|InsiderRisk\w*|InformationBarrier\w*|SupervisoryReview\w*|IPPSSession|RecordLabel|FilePlanProperty\w*)$/;
// Exchange Online PowerShell (Connect-ExchangeOnline) nouns. Search-UnifiedAuditLog is EXO-only.
const EXCHANGE_NOUN = /^(Mailbox\w*|CASMailbox\w*|EXO\w*|UnifiedAuditLog|TransportRule\w*|TransportConfig|DkimSigningConfig|HostedContentFilter\w*|HostedOutboundSpamFilter\w*|HostedConnectionFilter\w*|MalwareFilter\w*|AntiPhish\w*|SafeLinks\w*|SafeAttachment\w*|AtpPolicyForO365|OrganizationConfig|OrganizationCustomization|OMEConfiguration|IRMConfiguration|MobileDevice\w*|DistributionGroup\w*|UnifiedGroup\w*|MessageTrace\w*|Recipient\w*|InboundConnector|OutboundConnector|AcceptedDomain|RemoteDomain|AuthenticationPolicy|ExternalInOutlook|Quarantine\w*|ManagementRole\w*|ReportSubmission(Policy|Rule)|ExchangeOnline)$/;
// Available in both EXO and Security & Compliance PowerShell.
const EXO_OR_IPPS_NOUN = /^(AdminAuditLogConfig|ConnectionInformation|RoleGroup\w*)$/;
const TEAMS_NOUN = /^(Cs[A-Z]\w*|Team|TeamUser|TeamChannel\w*|TeamsApp\w*|MicrosoftTeams)$/;

/** Pseudo-cmdlet name `cmdletsIn` reports for an Azure CLI (`az ...`) invocation. */
export const AZ_CLI = 'az-cli';

/** Classify one `Verb-Noun` cmdlet name (or AZ_CLI). */
export function classifyCmdlet(cmdlet: string): CmdletClass {
  if (cmdlet === AZ_CLI) {
    return { kind: 'unconnectable', why: 'Azure CLI (az): Connect-AzAccount signs in Az PowerShell, not the az CLI; no CES session runs az login' };
  }
  if (LOCAL.has(cmdlet)) return { kind: 'local' };
  const noun = cmdlet.slice(cmdlet.indexOf('-') + 1);
  if (/^Mg[A-Z]/.test(noun)) return { kind: 'session', sessions: ['graph'] };
  if (/^Az[A-Z]/.test(noun)) return { kind: 'session', sessions: ['azure'] };
  if (/^SPO[A-Z]/.test(noun)) return { kind: 'session', sessions: ['sharepoint'] };
  if (/^PnP[A-Z]/.test(noun)) {
    return { kind: 'unconnectable', why: 'PnP.PowerShell: no CES session connects PnP (ces-tenant opens Connect-SPOService only)' };
  }
  if (TEAMS_NOUN.test(noun)) return { kind: 'session', sessions: ['teams'] };
  if (EXO_OR_IPPS_NOUN.test(noun)) return { kind: 'session', sessions: ['exchange', 'purview'] };
  if (PURVIEW_NOUN.test(noun)) return { kind: 'session', sessions: ['purview'] };
  if (EXCHANGE_NOUN.test(noun)) return { kind: 'session', sessions: ['exchange'] };
  return { kind: 'unknown' };
}

/**
 * The cmdlet names a PowerShell text invokes, in order of first use. Quoted strings
 * are blanked first, so prose inside a literal ('Allow-VNet-In', "Get-then-set") is
 * never read as a command.
 */
export function cmdletsIn(script: string): string[] {
  const code = script
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"`]|`.|"")*"/g, '""');
  const out: string[] = [];
  if (/(?<![\w$.-])az\s+[a-z]/.test(code)) out.push(AZ_CLI);
  for (const m of code.matchAll(CMDLET_RE)) {
    const name = `${m[1]}-${m[2]}`;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** One cmdlet the connected sessions do not serve. */
export interface UnservedCmdlet {
  cmdlet: string;
  cls: CmdletClass;
}

/**
 * The sessions a PowerShell text needs, smallest set: single-session cmdlets first,
 * then a multi-session cmdlet (EXO or IPPS) only if none of its sessions is in yet.
 * Element 0 is the primary session: the session of the first cloud cmdlet used.
 */
export function requiredSessionsForScript(script: string): AoSession[] {
  const classes = cmdletsIn(script).map(classifyCmdlet);
  const out: AoSession[] = [];
  for (const c of classes) {
    if (c.kind === 'session' && c.sessions.length === 1 && !out.includes(c.sessions[0])) out.push(c.sessions[0]);
  }
  for (const c of classes) {
    if (c.kind === 'session' && c.sessions.length > 1 && !c.sessions.some((s) => out.includes(s))) out.push(c.sessions[0]);
  }
  const first = classes.find((c): c is { kind: 'session'; sessions: AoSession[] } => c.kind === 'session');
  if (!first) return out;
  const primary = first.sessions.find((s) => out.includes(s))!;
  return [primary, ...out.filter((s) => s !== primary)];
}

/** The cmdlets of `script` that the `connected` sessions do not serve (unknown and unconnectable included). */
export function unservedCmdlets(script: string, connected: readonly string[]): UnservedCmdlet[] {
  const out: UnservedCmdlet[] = [];
  for (const cmdlet of cmdletsIn(script)) {
    const cls = classifyCmdlet(cmdlet);
    if (cls.kind === 'local') continue;
    if (cls.kind === 'session' && cls.sessions.some((s) => connected.includes(s))) continue;
    out.push({ cmdlet, cls });
  }
  return out;
}

/** The union of sessions an op's get and set templates need; the get template's sessions first. */
export function requiredSessions(aoCommand: Pick<AoCommand, 'id'>): AoSession[] {
  const t = getCommandTemplates(aoCommand.id);
  if (!t) return [];
  const out: AoSession[] = [];
  for (const s of [...requiredSessionsForScript(t.get_command || ''), ...requiredSessionsForScript(t.set_command || '')]) {
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Determine the execution engine for an AO command: the engine of its primary
 * session (the session of the first cloud cmdlet its templates use). The full set
 * is `requiredSessions()`; RegistryBridge carries it on the entry as `sessions`.
 *
 * FIN-22: the old keyword overrides (overview mentions Exchange / DLP / Teams ...)
 * and the Tier 3 -> `manual_gate` override are gone. `manual_gate` maps to no
 * session, so every Tier 3 op fell back to Graph (AUDIT-ADMINOPS finding 1).
 * Tier 3 gating is SodGate's job (requiresManualGate), never the engine's.
 * A command with no template (test-only ids) keeps its domain default.
 */
export function determineEngine(aoCommand: AoCommand): string {
  const sessions = requiredSessions(aoCommand);
  if (sessions.length > 0) return ENGINE_FOR_SESSION[sessions[0]];
  const domainEngineMap: Record<string, string> = {
    A: 'mgraph', B: 'mgraph', C: 'az', D: 'spo', E: 'az', F: 'mgraph', G: 'mgraph', H: 'mgraph',
  };
  return domainEngineMap[aoCommand.domain] || 'mgraph';
}
