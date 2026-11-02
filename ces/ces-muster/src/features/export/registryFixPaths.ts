// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// registryFixPaths.ts — G-MUSTER-READINESS-1 M2: the registry fix-path join for
// derived.gaps[] ("the registry set_command IS the fix path").
//
// DERIVED DATA, consumed-not-forked (same discipline as the archetype fixtures):
// generated 2026-07-12 from ces-stamper/src/registry/cmmc-l2-commands.registry.json
// (version 1.0.0, generated_on 2026-03-01) by mapping every entry with a non-empty
// set_command onto each of its control_ids. Stamper owns the registry; regenerate
// this extract when the registry version bumps (the version constant below is
// exported into the payload provenance block so staleness is visible downstream).
// W5c3 (2026-10-28): refreshed for the entries added since without a version bump
// (IA.L2-3.5.10.block-legacy-auth on 3.5.10 and AC.L2-3.1.12; the CUI label
// entries on AC.L2-3.1.3). registryFixPaths.drift.test.ts compares this extract
// with the registry whenever the sibling ces-stamper checkout is present.
// W5c4 (2026-10-28): an entry with `verify_only: true` and no set_command also
// counts (it runs and asserts the state another entry in the plan creates):
// RA.L2-3.11.3.vuln-remediation verifies the update ring MA.L2-3.7.1.update-ring
// creates. The extract rows are unchanged; the drift test now includes them.
// W5c5 (2026-10-28): regenerated from the registry (153 entries, still 1.0.0 /
// 2026-03-01, read 17:46 while Stamper was still editing): SC.L2-3.13.10.key-vault
// (now a set-command entry); CM.L2-3.4.1.compliance-policy-windows on its eight controls
// (AC.L2-3.1.10, CM.L2-3.4.1, CM.L2-3.4.2, IA.L2-3.5.7, IA.L2-3.5.8,
// SC.L2-3.13.16, SI.L1-3.14.1, SI.L1-3.14.2); MP.L2-3.8.9.dlp-rule
// on AC.L1-3.1.22; SC.L1-3.13.5 dropped (the host firewall no longer lists it,
// ST-C3 attribution trim).
// W5c6 (2026-10-28): rechecked against the registry after LOG-W5c5-stamper.md: no row
// change (SC.L2-3.13.10.key-vault was already in). The extract is the TENANT registry only
// (tenant: paths); the infrastructure registry's attribution trims (AZ-*) do not reach it,
// which the drift test pins.
// W5c7 (2026-10-28): regenerated (156 entries): AC.L1-3.1.1.ca-mfa-compliant-device on
// AC.L1-3.1.1, and AU.L2-3.3.7.time-sync on AU.L2-3.3.7 (its first configuring path).
// PH-13 (2026-11-01, LOG-PH13-UNIT.md): regenerated from the PH-12 merged registry (183
// entries, still 1.0.0 / 2026-03-01): 83 controls (was 64), 19 new and 19 changed (DEPTH-10 configuring
// entries and cross-family tags, e.g. AC.L2-3.1.8 smart lockout, SI.L2-3.14.6/7, MP.L2-3.8.5/7/8).
// The SPA stays zero-network: this is a static constant, never a fetch.

export const REGISTRY_VERSIONS: Record<string, string> = {
  "cmmc-l2-commands": "1.0.0/2026-03-01",
};

/** requirement/control id -> registry entry ids whose set_command remediates it. */
export const REGISTRY_FIX_PATHS: Record<string, string[]> = {
  "AC.L1-3.1.1": ["tenant:AC.L1-3.1.1.ca-mfa-compliant-device", "tenant:AC.L1-3.1.2.default-user-permissions", "tenant:AC.L2-3.1.1.group-create", "tenant:AC.L2-3.1.1.member-add"],
  "AC.L1-3.1.2": ["tenant:AC.L1-3.1.2.default-user-permissions"],
  "AC.L1-3.1.20": ["tenant:AC.L2-3.1.20.guest-restrict", "tenant:AC.L2-3.1.20.spo-sharing"],
  "AC.L1-3.1.22": ["tenant:MP.L2-3.8.9.dlp-policy", "tenant:MP.L2-3.8.9.dlp-rule"],
  "AC.L2-3.1.10": ["tenant:AC.L2-3.1.10.screen-lock", "tenant:CM.L2-3.4.1.compliance-policy-windows"],
  "AC.L2-3.1.11": ["tenant:AC.L2-3.1.11.session-timeout", "tenant:SC.L2-3.13.9.idle-session-timeout"],
  "AC.L2-3.1.12": ["tenant:AC.L2-3.1.12.named-location", "tenant:AC.L2-3.1.12.session-monitor", "tenant:IA.L2-3.5.10.block-legacy-auth"],
  "AC.L2-3.1.13": ["tenant:SC.L2-3.13.8.tls-enforce"],
  "AC.L2-3.1.14": ["tenant:AC.L2-3.1.14.block-untrusted"],
  "AC.L2-3.1.15": ["tenant:AC.L2-3.1.15.admin-mfa"],
  "AC.L2-3.1.16": ["tenant:AC.L2-3.1.16.wifi-profile"],
  "AC.L2-3.1.17": ["tenant:AC.L2-3.1.16.wifi-profile"],
  "AC.L2-3.1.18": ["tenant:AC.L2-3.1.18.ios-compliance", "tenant:AC.L2-3.1.18.mobile-ca", "tenant:AC.L2-3.1.19.android-compliance"],
  "AC.L2-3.1.19": ["tenant:AC.L2-3.1.18.ios-compliance", "tenant:AC.L2-3.1.19.android-compliance", "tenant:AC.L2-3.1.19.ios-mam"],
  "AC.L2-3.1.2": ["tenant:AC.L2-3.1.2.role-assign"],
  "AC.L2-3.1.21": ["tenant:AC.L2-3.1.21.block-storage"],
  "AC.L2-3.1.3": ["tenant:MP.L2-3.8.1.cui-label", "tenant:MP.L2-3.8.1.label-policy"],
  "AC.L2-3.1.4": ["tenant:AC.L2-3.1.4.pim-approval"],
  "AC.L2-3.1.5": ["tenant:AC.L2-3.1.5.pim-eligible"],
  "AC.L2-3.1.6": ["tenant:AC.L2-3.1.6.admin-account"],
  "AC.L2-3.1.7": ["tenant:AC.L2-3.1.5.pim-eligible"],
  "AC.L2-3.1.8": ["tenant:AC.L2-3.1.8.password-rule-settings", "tenant:AC.L2-3.1.8.smart-lockout"],
  "AC.L2-3.1.9": ["tenant:AC.L2-3.1.9.terms-of-use"],
  "AU.L2-3.3.1": ["tenant:AU.L2-3.3.1.audit-enable", "tenant:AU.L2-3.3.1.audit-retention", "tenant:AU.L2-3.3.1.org-customization"],
  "AU.L2-3.3.2": ["tenant:AU.L2-3.3.2.mailbox-audit-default"],
  "AU.L2-3.3.3": ["tenant:AU.L2-3.3.3.sentinel-connector"],
  "AU.L2-3.3.4": ["tenant:AU.L2-3.3.4.audit-config-alert"],
  "AU.L2-3.3.6": ["tenant:AU.L2-3.3.6.audit-reduction"],
  "AU.L2-3.3.7": ["tenant:AU.L2-3.3.7.time-sync"],
  "AU.L2-3.3.8": ["tenant:AU.L2-3.3.8.compliance-admin-pim-expiry"],
  "AU.L2-3.3.9": ["tenant:AU.L2-3.3.8.compliance-admin-pim-expiry"],
  "CM.L2-3.4.1": ["tenant:CM.L2-3.4.1.compliance-policy-windows", "tenant:CM.L2-3.4.1.device-cleanup", "tenant:CM.L2-3.4.1.security-baseline", "tenant:SI.L1-3.14.1.mde-onboarding"],
  "CM.L2-3.4.2": ["tenant:CM.L2-3.4.1.compliance-policy-windows", "tenant:CM.L2-3.4.2.asr-rules"],
  "CM.L2-3.4.3": ["tenant:AU.L2-3.3.1.audit-enable"],
  "CM.L2-3.4.6": ["tenant:CM.L2-3.4.6.least-functionality"],
  "CM.L2-3.4.7": ["tenant:CM.L2-3.4.7.firewall-ports", "tenant:CM.L2-3.4.7.legacy-protocols", "tenant:CM.L2-3.4.7.nonessential-functions", "tenant:CM.L2-3.4.7.nonessential-services", "tenant:CM.L2-3.4.7.wdac"],
  "CM.L2-3.4.8": ["tenant:CM.L2-3.4.8.app-control"],
  "CM.L2-3.4.9": ["tenant:CM.L2-3.4.9.install-control", "tenant:SI.L1-3.14.1.mde-onboarding"],
  "IA.L1-3.5.1": ["tenant:IA.L1-3.5.1.app-consent-restrict", "tenant:IA.L1-3.5.1.ca-compliant-device"],
  "IA.L1-3.5.2": ["tenant:IA.L1-3.5.1.ca-compliant-device", "tenant:IA.L2-3.5.3.ca-mfa-all-users"],
  "IA.L2-3.5.10": ["tenant:IA.L2-3.5.10.block-legacy-auth", "tenant:IA.L2-3.5.10.cert-auth", "tenant:IA.L2-3.5.10.credential-guard"],
  "IA.L2-3.5.3": ["tenant:IA.L2-3.5.3.ca-mfa-all-users", "tenant:IA.L2-3.5.3.fido2-enable", "tenant:IA.L2-3.5.3.mfa-authenticator", "tenant:IA.L2-3.5.3.whfb-tenant"],
  "IA.L2-3.5.4": ["tenant:IA.L2-3.5.10.cert-auth", "tenant:IA.L2-3.5.4.auth-strength"],
  "IA.L2-3.5.5": ["tenant:IA.L2-3.5.5.disable-inactive"],
  "IA.L2-3.5.6": ["tenant:IA.L2-3.5.5.disable-inactive"],
  "IA.L2-3.5.7": ["tenant:CM.L2-3.4.1.compliance-policy-windows", "tenant:IA.L2-3.5.7.password-protection"],
  "IA.L2-3.5.8": ["tenant:CM.L2-3.4.1.compliance-policy-windows"],
  "IA.L2-3.5.9": ["tenant:IA.L2-3.5.9.tap-config"],
  "IR.L2-3.6.1": ["tenant:IR.L2-3.6.1.atp-enable", "tenant:IR.L2-3.6.1.malware-filter", "tenant:IR.L2-3.6.1.user-reporting", "tenant:SI.L1-3.14.1.mde-onboarding", "tenant:SI.L2-3.14.7.user-risk-policy"],
  "MA.L2-3.7.1": ["tenant:MA.L2-3.7.1.update-ring"],
  "MA.L2-3.7.2": ["tenant:MA.L2-3.7.1.update-ring"],
  "MA.L2-3.7.5": ["tenant:MA.L2-3.7.5.remote-mfa", "tenant:MA.L2-3.7.5.session-terminate"],
  "MP.L2-3.8.1": ["tenant:MP.L2-3.8.1.cui-label", "tenant:MP.L2-3.8.1.label-policy"],
  "MP.L2-3.8.2": ["tenant:MP.L2-3.8.1.cui-label"],
  "MP.L2-3.8.4": ["tenant:MP.L2-3.8.1.cui-label"],
  "MP.L2-3.8.5": ["tenant:AC.L2-3.1.21.block-storage"],
  "MP.L2-3.8.6": ["tenant:MP.L2-3.8.6.bitlocker"],
  "MP.L2-3.8.7": ["tenant:AC.L2-3.1.21.block-storage"],
  "MP.L2-3.8.8": ["tenant:AC.L2-3.1.21.block-storage"],
  "MP.L2-3.8.9": ["tenant:MP.L2-3.8.9.dlp-policy", "tenant:MP.L2-3.8.9.dlp-rule"],
  "PS.L2-3.9.2": ["tenant:PS.L2-3.9.2.access-review", "tenant:PS.L2-3.9.2.leaver-access-terminated", "tenant:PS.L2-3.9.2.leaver-workflow"],
  "RA.L2-3.11.2": ["tenant:SI.L1-3.14.1.mde-onboarding"],
  "RA.L2-3.11.3": ["tenant:RA.L2-3.11.3.vuln-remediation", "tenant:SI.L1-3.14.1.mde-onboarding"],
  "SC.L1-3.13.1": ["tenant:SC.L1-3.13.1.endpoint-firewall", "tenant:SC.L1-3.13.1.network-protection"],
  "SC.L2-3.13.10": ["tenant:SC.L2-3.13.10.key-vault"],
  "SC.L2-3.13.11": ["tenant:SC.L2-3.13.11.fips-mode"],
  "SC.L2-3.13.12": ["tenant:SC.L2-3.13.12.camera-block"],
  "SC.L2-3.13.13": ["tenant:SC.L2-3.13.13.safe-attach", "tenant:SC.L2-3.13.13.safe-attach-rule"],
  "SC.L2-3.13.14": ["tenant:SC.L2-3.13.14.teams-external"],
  "SC.L2-3.13.15": ["tenant:SC.L2-3.13.15.anti-phish", "tenant:SC.L2-3.13.15.anti-phish-rule", "tenant:SC.L2-3.13.15.anti-spam", "tenant:SC.L2-3.13.15.anti-spam-rule", "tenant:SC.L2-3.13.15.dkim", "tenant:SC.L2-3.13.15.outbound-spam", "tenant:SC.L2-3.13.15.outbound-spam-rule"],
  "SC.L2-3.13.16": ["tenant:CM.L2-3.4.1.compliance-policy-windows"],
  "SC.L2-3.13.3": ["tenant:AC.L2-3.1.5.pim-eligible"],
  "SC.L2-3.13.4": ["tenant:SC.L2-3.13.4.pagefile-clear"],
  "SC.L2-3.13.6": ["tenant:SC.L1-3.13.1.endpoint-firewall"],
  "SC.L2-3.13.7": ["tenant:AC.L2-3.1.14.block-untrusted"],
  "SC.L2-3.13.8": ["tenant:SC.L2-3.13.8.tls-enforce"],
  "SC.L2-3.13.9": ["tenant:AC.L2-3.1.10.screen-lock", "tenant:SC.L2-3.13.9.idle-session-timeout"],
  "SI.L1-3.14.1": ["tenant:CM.L2-3.4.1.compliance-policy-windows", "tenant:SI.L1-3.14.1.mde-onboarding"],
  "SI.L1-3.14.2": ["tenant:CM.L2-3.4.1.compliance-policy-windows", "tenant:SI.L2-3.14.2.anti-malware", "tenant:SI.L2-3.14.2.malware-rule"],
  "SI.L1-3.14.4": ["tenant:SI.L1-3.14.5.scan-schedule-evidence"],
  "SI.L1-3.14.5": ["tenant:SI.L1-3.14.5.scan-schedule-evidence"],
  "SI.L2-3.14.3": ["tenant:SI.L2-3.14.3.safe-links", "tenant:SI.L2-3.14.3.safe-links-rule"],
  "SI.L2-3.14.6": ["tenant:SC.L2-3.13.15.outbound-spam", "tenant:SI.L1-3.14.1.mde-onboarding", "tenant:SI.L2-3.14.3.safe-links", "tenant:SI.L2-3.14.3.safe-links-rule", "tenant:SI.L2-3.14.6.defender-traffic-monitoring"],
  "SI.L2-3.14.7": ["tenant:SI.L2-3.14.7.signin-risk-policy", "tenant:SI.L2-3.14.7.user-risk-policy"],
};
