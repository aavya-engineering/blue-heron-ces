// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Connection-profile shape and session-type vocabulary.
 *
 * M0 — interface definition only (design §5). Codifies the six-way
 * `SessionType` union already partially factored into
 * `ces-shared/src/session/constants.ts:1` and used throughout
 * `ces-stamper/src/core/SessionManager.ts`, plus a `ConnectionProfile`
 * interface newly modeling what `buildConnectCommand()` currently derives
 * ad hoc from `ClientConfig`/`TenantConfig` per call
 * (`ces-stamper/src/core/SessionManager.ts:392-432`).
 */

/**
 * Six PowerShell/Graph session types Stamper and ces-eo both connect.
 * Verbatim from `ces-shared/src/session/constants.ts:1`
 * (`export type SessionType = 'graph' | 'exchange' | 'purview' | 'azure' |
 * 'sharepoint' | 'teams'`) — already shared, re-declared here as the
 * package's own vocabulary per design §2.4 (the PowerShell session-factory
 * surface "mostly needs to absorb SessionManager's TS orchestration layer").
 */
export type SessionType = 'graph' | 'exchange' | 'purview' | 'azure' | 'sharepoint' | 'teams';

/**
 * Engine/CLI-alias to `SessionType` mapping. Verbatim from
 * `ces-shared/src/session/constants.ts:3-12` (`ENGINE_SESSION_MAP`) — maps
 * CLI/registry engine identifiers (`mgraph`, `powershell`, `exchange`, `ipps`,
 * `az`, `cli`, `spo`, `teams`) onto the six `SessionType` values. Re-declared
 * here as the type shape; the concrete constant map itself is not part of
 * M0's interface-only scope.
 */
export type EngineSessionMap = Record<string, SessionType>;

/**
 * Per-session-type endpoint/flag bundle actually hardcoded inside
 * `SessionManager.buildConnectCommand()`
 * (`ces-stamper/src/core/SessionManager.ts:392-432`, duplicated in
 * `ces-eo/src/eo/core/SessionManager.ts:330-364`). Design §2.2: "there is
 * nothing to extract for a sovereign endpoint table because none exists —
 * this must be newly designed... using the already-defined (but currently
 * unused) `TenantConfig.endpoints` shape as the starting schema." This
 * interface documents the CURRENT hardcoded GCC High/USGov literal values as
 * fields so the eventual sovereign-endpoint-table work has a named target;
 * it is NOT itself the sovereign endpoint table (that is out-of-scope new
 * design work per §2.2/§7, marked NEW-SCOPE below where applicable).
 */
export interface ConnectionProfile {
  /** Which of the six session types this profile connects. */
  sessionType: SessionType;

  /**
   * `-Environment` value for `Connect-MgGraph`. Hardcoded literal
   * `"USGov"` today (`SessionManager.ts:403`). No commercial/GCC
   * (non-High)/DoD branch exists anywhere in the researched code (design
   * §2.2) — a non-USGov value is NEW-SCOPE.
   */
  graphEnvironment?: string;

  /**
   * `-ExchangeEnvironmentName` value for `Connect-ExchangeOnline`. Hardcoded
   * literal `"O365USGovGCCHigh"` today (`SessionManager.ts:406`).
   */
  exchangeEnvironmentName?: string;

  /**
   * `-ConnectionUri` for `Connect-IPPSSession` (Purview). Hardcoded literal
   * `"https://ps.compliance.protection.office365.us/powershell-liveid/"`
   * today (`SessionManager.ts:409`).
   */
  complianceConnectionUri?: string;

  /**
   * `-AzureADAuthorizationEndpointUri` for `Connect-IPPSSession`. Hardcoded
   * literal `"https://login.microsoftonline.us/organizations"` today
   * (`SessionManager.ts:409`).
   */
  azureAdAuthorizationEndpointUri?: string;

  /**
   * `-Environment` value for `Connect-AzAccount`. Hardcoded literal
   * `"AzureUSGovernment"` today (`SessionManager.ts:414`).
   */
  azureEnvironment?: string;

  /**
   * `-Region` value for `Connect-SPOService`. Hardcoded literal `"ITAR"`
   * today (`SessionManager.ts:423`).
   */
  sharepointRegion?: string;

  /**
   * SPO admin URL template. Hardcoded literal
   * `` `https://${tenantName}-admin.us.sharepoint.us` `` today
   * (`SessionManager.ts:423`), where `tenantName` is derived by splitting
   * `targetTenantDomain` on `.` (`SessionManager.ts:399`).
   */
  sharepointAdminUrlTemplate?: string;

  /**
   * `-TeamsEnvironmentName` value for `Connect-MicrosoftTeams`. Hardcoded
   * literal `"TeamsGCCH"` today (`SessionManager.ts:427`).
   */
  teamsEnvironmentName?: string;
}

/**
 * PowerShell spawn argument vector actually used by
 * `SessionManager.spawnPersistentProcess()`
 * (`ces-stamper/src/core/SessionManager.ts:459-526`, args built at
 * lines 468-473). Correction preserved from design §7: neither Stamper's nor
 * ces-eo's spawn call passes `-Version 5.1` — verified by direct read.
 */
export interface PowerShellSpawnArgs {
  /** Always `'powershell.exe'` — named executable (Windows PowerShell, not `pwsh`), per `SessionManager.ts:468`. */
  executable: 'powershell.exe';

  /**
   * Fixed literal argv, verbatim from `SessionManager.ts:469-472`:
   * `['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SESSION_HOST_SCRIPT]`.
   * `SESSION_HOST_SCRIPT` resolves to `ces-shared/scripts/session-host.ps1`
   * (`SessionManager.ts:81`, shared by both Stamper and ces-eo per design §2.4).
   */
  args: readonly ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', string];
}
