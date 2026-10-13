// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { InventoryEngine } from './InventoryTypes.js';

/**
 * True when a command invokes the `az` CLI binary anywhere in its text (e.g.
 * `az rest --method ...`, `az keyvault key rotate ...`, `az monitor
 * diagnostic-settings list ...`) rather than only a PowerShell cmdlet. The
 * coverage harness only shadows PowerShell's PSModulePath, not the `az` CLI
 * binary's own auth/endpoint resolution, so any command containing an `az`
 * CLI invocation is excluded from execution (see CoverageRunner) to avoid
 * real network egress to a live ARM endpoint. Matches on a word-boundary
 * lowercase `az` followed by a lowercase subcommand token (PowerShell's own
 * `Az.*` module cmdlets are always capitalized, e.g. `Get-AzFirewall`, and
 * never appear as a bare lowercase `az <word>` token, so this does not
 * collide with real Az-cmdlet classification).
 */
export function isAzCli(commandText: string): boolean {
  if (!commandText) return false;
  return /\baz\s+[a-z][a-z-]*\b/.test(commandText);
}

/**
 * Classifies a verbatim PowerShell command (or endpoint description) into
 * one of the InventoryEngine buckets. `registryEngine` is the source
 * registry's own coarse engine tag (Stamper: 'mgraph'|'az'|'exchange'|'ipps'|
 * 'teams'|'manual_gate'; absent for AO), used only as a fallback when the
 * command text itself doesn't disambiguate.
 */
export function classifyCommandEngine(commandText: string, registryEngine?: string): InventoryEngine {
  if (!commandText || commandText.trim().length === 0) return 'other';
  if (isAzCli(commandText)) return 'other';
  if (/Invoke-MgGraphRequest/.test(commandText)) return 'invoke-mggraphrequest';
  if (/\b[A-Za-z]+-Mg[A-Z]/.test(commandText)) return 'graph-cmdlet';
  if (/\b[A-Za-z]+-Az[A-Z]/.test(commandText)) return 'az-cmdlet';
  if (/Connect-SPOService|Get-SPOSite|Get-SPOTenant|Set-SPOSite|Set-SPOTenant/.test(commandText)) return 'spo-cmdlet';
  if (
    /Connect-IPPSSession|Get-DlpCompliancePolicy|Get-RetentionCompliancePolicy|Get-ComplianceCase|Get-LabelPolicy|New-DlpCompliancePolicy|Get-Label\b/.test(
      commandText,
    )
  ) {
    return 'ipps-cmdlet';
  }
  if (
    /Connect-ExchangeOnline|Get-Mailbox|Get-TransportRule|Get-OrganizationConfig|Set-Mailbox|Get-AntiPhishPolicy|Get-HostedContentFilterPolicy|Get-MalwareFilterPolicy|Search-UnifiedAuditLog/.test(
      commandText,
    )
  ) {
    return 'exo-cmdlet';
  }
  // Fall back to the source registry's own coarse tag when the command text
  // itself doesn't disambiguate (e.g. a bare Where-Object/Select-Object
  // pipeline continuation with no leading cmdlet name recognized above).
  if (registryEngine === 'exchange') return 'exo-cmdlet';
  if (registryEngine === 'ipps') return 'ipps-cmdlet';
  if (registryEngine === 'az') return 'az-cmdlet';
  if (registryEngine === 'mgraph') return 'graph-cmdlet';
  return 'other';
}

/** Placeholder names whose real-world value is always numeric (PowerShell
 *  code that hands the substituted text to a typed .NET method - e.g.
 *  `(Get-Date).AddDays('{secretValidityDays}')` - fails to convert a
 *  "sim-<name>" string to System.Double). Detected by suffix, matching
 *  Stamper/AO's own naming convention for these placeholders. */
const NUMERIC_NAME_SUFFIX = /(Days|Count|Threshold|Priority|Retention|Size|Hours|Minutes|Duration)$/;

/** Placeholder names whose real-world value is base64-encoded file content
 *  (e.g. AC.L2-3.1.9.terms-of-use's `{touFileBase64}`, fed straight into
 *  `[System.Convert]::FromBase64String(...)`, which throws on a
 *  non-base64 "sim-<name>" string). */
const BASE64_NAME_PATTERN = /base ?64/i;

/**
 * Substitutes `{varName}` template placeholders (Stamper/AO convention) with
 * a plausible, TYPE-AWARE dummy value so the resulting text is syntactically
 * valid PowerShell for a dry, isolated coverage run - and so it does not
 * throw for the handful of placeholders a downstream .NET method actually
 * parses as a non-string type (numeric/base64), rather than merely absorbing
 * as opaque cmdlet-argument text. `overrides` (G-STACKSIM-2 iteration 3) lets
 * a specific coverage item supply a REAL, pre-seeded value for a named
 * placeholder (e.g. an existing CA policy's displayName) when generic
 * "sim-<name>"/typed-heuristic substitution would not let the command's own
 * get-then-match logic find anything - a legitimate per-item param-fill, not
 * a canned result (the sim still genuinely executes the substituted command
 * against the store). `${varName}` (dollar-brace - AO's F-11..F-14 firewall
 * templates, matching Stamper's PowerShellAdapter.interpolateVariables()
 * convention) is left untouched: it is already valid PowerShell "explicit
 * variable name" syntax and evaluates harmlessly to an empty/unset value
 * when not pre-substituted.
 */
export function substituteTemplateVars(
  commandText: string,
  overrides: Record<string, string> = {},
  /**
   * SIMFIX FIX-S2: tenant-object values keyed by NORMALIZED placeholder name
   * (lower-case, no underscores) - the value a real consumer would read from
   * the sim tenant object (resources/subscription). Consulted after the
   * per-item overrides and before the generic "sim-<name>" filler.
   */
  tenantDefaults: Record<string, string> = {},
): string {
  // SIMFIX FIX-S2: `${name}` (AO's F-11..F-14 firewall templates) is filled
  // the way AO's PowerShellAdapter fills it - when a value is known. Unknown
  // `${name}` stays a (harmlessly empty) PowerShell variable.
  const known = (name: string): string | undefined => {
    if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
    const norm = name.toLowerCase().replace(/_/g, '');
    return Object.prototype.hasOwnProperty.call(tenantDefaults, norm) ? tenantDefaults[norm] : undefined;
  };
  commandText = commandText.replace(/\$\{([A-Za-z][A-Za-z0-9]*)\}/g, (m, name: string) => known(name) ?? m);
  return commandText.replace(/(?<!\$)\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
    const norm = name.toLowerCase().replace(/_/g, '');
    if (Object.prototype.hasOwnProperty.call(tenantDefaults, norm)) return tenantDefaults[norm];
    if (BASE64_NAME_PATTERN.test(name)) return Buffer.from(`sim-${name}-content`, 'utf8').toString('base64');
    if (NUMERIC_NAME_SUFFIX.test(name)) return '30';
    return `sim-${name}`;
  });
}
