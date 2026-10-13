// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

/**
 * Declares every real PowerShell module name the sim must shadow at M2
 * (Core Design (d)), each module's exact ModuleVersion pin if any, and
 * whether the module carries the resolver-backed wrapper functions
 * (Connect-MgGraph, Invoke-MgGraphRequest, and all generated Get-Mg*
 * wrappers) or is an empty pass-through manifest.
 *
 * Module names and the one version pin (Microsoft.Graph.Authentication ->
 * 2.35.1) are transcribed verbatim from PLAN.md's Context Summary quotes of
 * SessionManager.ts:49-61 (the GRAPH_MODULE_IMPORTS block). Az.*,
 * ExchangeOnlineManagement, and Microsoft.Online.SharePoint.PowerShell are
 * M3 File Inventory rows, not declared here.
 */

export interface ModuleManifestEntry {
  /** Real module folder/manifest name PowerShell resolves by. */
  name: string;
  /** Exact ModuleVersion the real import pins, if any (SessionManager.ts:49). */
  moduleVersion?: string;
  /** Fixed GUID for a well-formed .psd1 (arbitrary but stable across regeneration). */
  guid: string;
  description: string;
  /**
   * True only for Microsoft.Graph.Authentication: it is guaranteed to load
   * first per SessionManager.ts's import order and PowerShell function
   * export is global regardless of which module technically defines a
   * function name, so all generated wrapper functions live there
   * (Core Design (d), File Inventory note on Microsoft.Graph.Authentication).
   */
  carriesResolvers: boolean;
  /**
   * True only for Az.Accounts (M3): mirrors carriesResolvers but for the
   * Az.* surface - carries Connect-AzAccount/Set-AzContext no-ops and all
   * generated Get-Az* wrapper functions. Az.Accounts loads first per
   * TenantProbe.psm1's Invoke-EutArm (Import-Module Az.Accounts precedes
   * any Get-Az* call).
   */
  carriesAzResolvers?: boolean;
  /**
   * True only for ExchangeOnlineManagement (M3): carries
   * Connect-ExchangeOnline/Connect-IPPSSession no-ops - both of
   * TenantProbe.psm1's Invoke-EutExo/Invoke-EutIpps choke points import
   * this same real module name before calling one of these two cmdlets.
   */
  isExchangeOnlineManagement?: boolean;
  /**
   * True only for MicrosoftTeams (2026-07-10, Stamper --stacksim session
   * coverage): carries the Connect-MicrosoftTeams no-op SessionManager's
   * 'teams' session type auto-loads. The Cs* cmdlets themselves live in the
   * ExchangeOnlineManagement fake (exoResolvers) and resolve via PowerShell
   * function auto-loading regardless of which module defines them.
   */
  isMicrosoftTeams?: boolean;
  /**
   * True only for Microsoft.Online.SharePoint.PowerShell (backlog-S4):
   * carries the Connect-SPOService no-op. Stamper's sharepoint connect now
   * passes -CertificateThumbprint (owner-approved one-line change,
   * SessionManager.ts) instead of fetching a real cert object inline, so
   * the fake binds the thumbprint string like every other connect fake —
   * no certificate store involvement. SPO data cmdlets (Get-SPOTenant &c)
   * live in the ExchangeOnlineManagement fake and auto-load.
   */
  isSharePoint?: boolean;
  /**
   * SIMFIX FIX-S2 (founder decision OD-5, 2026-09-26): a minimal
   * PnP.PowerShell shim - Connect-PnPOnline (no-op) and Get-PnPListItem,
   * backed by the sim's seeded SharePoint lists (AO G-06).
   */
  isPnP?: boolean;
}

/**
 * The 12 Graph submodules referenced by SessionManager.ts:50-61, in the
 * exact order quoted in PLAN.md's Context Summary: Identity.Governance,
 * Users, Identity.DirectoryManagement, Groups, Identity.ConditionalAccess,
 * DeviceManagement, Identity.SignIns, Identity.Authentication, Reports,
 * Domains, Applications, DirectoryObjects.
 */
export const GRAPH_SUBMODULE_NAMES = [
  'Microsoft.Graph.Identity.Governance',
  'Microsoft.Graph.Users',
  'Microsoft.Graph.Identity.DirectoryManagement',
  'Microsoft.Graph.Groups',
  'Microsoft.Graph.Identity.ConditionalAccess',
  'Microsoft.Graph.DeviceManagement',
  'Microsoft.Graph.Identity.SignIns',
  'Microsoft.Graph.Identity.Authentication',
  'Microsoft.Graph.Reports',
  'Microsoft.Graph.Domains',
  'Microsoft.Graph.Applications',
  'Microsoft.Graph.DirectoryObjects',
] as const;

function submoduleGuid(index: number): string {
  return `5c37b8b7-9e5b-4f8a-8c1f-${String(index).padStart(12, '0')}`;
}

export const MODULE_MANIFEST: ModuleManifestEntry[] = [
  {
    name: 'Microsoft.Graph.Authentication',
    moduleVersion: '2.35.1',
    guid: submoduleGuid(1),
    description:
      'Fake Microsoft.Graph.Authentication module (tenant-stacksim, generated) - carries Connect-MgGraph, Invoke-MgGraphRequest, and all generated Get-Mg* wrappers.',
    carriesResolvers: true,
  },
  ...GRAPH_SUBMODULE_NAMES.map((name, i) => ({
    name,
    guid: submoduleGuid(i + 2),
    description: `Fake ${name} module (tenant-stacksim, generated) - empty pass-through; satisfies its -ErrorAction SilentlyContinue import without falling through to a real install.`,
    carriesResolvers: false,
  })),
  // M3 (TenantProbe-compatible backend, PLAN.md Milestone Ladder row M3):
  // Az.Accounts/ExchangeOnlineManagement gain the no-op connect cmdlets
  // TenantProbe.psm1's Invoke-EutArm/Invoke-EutExo/Invoke-EutIpps choke
  // points import before use; Az.Monitor/Az.Storage/
  // Microsoft.Online.SharePoint.PowerShell are empty pass-throughs for
  // SessionManager.ts's SESSION_MODULE_MAP azure/sharepoint imports. None
  // of the quotes in PLAN.md's Context Summary pin a version for these.
  {
    name: 'Az.Accounts',
    guid: submoduleGuid(14),
    description:
      'Fake Az.Accounts module (tenant-stacksim, generated) - carries Connect-AzAccount, Set-AzContext no-ops and all generated Get-Az* wrappers.',
    carriesResolvers: false,
    carriesAzResolvers: true,
  },
  {
    name: 'Az.Monitor',
    guid: submoduleGuid(15),
    description:
      'Fake Az.Monitor module (tenant-stacksim, generated) - empty pass-through; satisfies its -ErrorAction SilentlyContinue import without falling through to a real install.',
    carriesResolvers: false,
  },
  {
    name: 'Az.Storage',
    guid: submoduleGuid(16),
    description:
      'Fake Az.Storage module (tenant-stacksim, generated) - empty pass-through; satisfies its -ErrorAction SilentlyContinue import without falling through to a real install.',
    carriesResolvers: false,
  },
  {
    name: 'ExchangeOnlineManagement',
    guid: submoduleGuid(17),
    description:
      'Fake ExchangeOnlineManagement module (tenant-stacksim, generated) - carries Connect-ExchangeOnline, Connect-IPPSSession no-ops (TenantProbe.psm1 Invoke-EutExo/Invoke-EutIpps choke points).',
    carriesResolvers: false,
    isExchangeOnlineManagement: true,
  },
  {
    name: 'Microsoft.Online.SharePoint.PowerShell',
    guid: submoduleGuid(18),
    description:
      'Fake Microsoft.Online.SharePoint.PowerShell module (tenant-stacksim, generated) - carries the Connect-SPOService no-op (backlog-S4); SPO data cmdlets live in the ExchangeOnlineManagement fake.',
    carriesResolvers: false,
    isSharePoint: true,
  },
  {
    name: 'PnP.PowerShell',
    guid: submoduleGuid(20),
    description:
      'Fake PnP.PowerShell module (tenant-stacksim, generated) - Connect-PnPOnline no-op and Get-PnPListItem backed by the sim store (founder decision OD-5).',
    carriesResolvers: false,
    isPnP: true,
  },
  {
    name: 'MicrosoftTeams',
    guid: submoduleGuid(19),
    description:
      'Fake MicrosoftTeams module (tenant-stacksim, generated) - carries the Connect-MicrosoftTeams no-op so SessionManager teams sessions connect under --stacksim.',
    carriesResolvers: false,
    isMicrosoftTeams: true,
  },
];
