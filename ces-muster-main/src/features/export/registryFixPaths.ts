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
// The SPA stays zero-network: this is a static constant, never a fetch.

export const REGISTRY_VERSIONS: Record<string, string> = {
  "cmmc-l2-commands": "1.0.0/2026-03-01",
};

/** requirement/control id -> registry entry ids whose set_command remediates it. */
export const REGISTRY_FIX_PATHS: Record<string, string[]> = {
  "AC.L1-3.1.1": ["tenant:AC.L2-3.1.1.group-create", "tenant:AC.L2-3.1.1.member-add"],
  "AC.L1-3.1.20": ["tenant:AC.L2-3.1.20.guest-restrict", "tenant:AC.L2-3.1.20.spo-sharing"],
  "AC.L2-3.1.10": ["tenant:AC.L2-3.1.10.screen-lock"],
  "AC.L2-3.1.11": ["tenant:AC.L2-3.1.11.session-timeout"],
  "AC.L2-3.1.12": ["tenant:AC.L2-3.1.12.named-location"],
  "AC.L2-3.1.13": ["tenant:SC.L2-3.13.8.tls-enforce"],
  "AC.L2-3.1.14": ["tenant:AC.L2-3.1.14.block-untrusted"],
  "AC.L2-3.1.15": ["tenant:AC.L2-3.1.15.admin-mfa"],
  "AC.L2-3.1.16": ["tenant:AC.L2-3.1.16.wifi-profile"],
  "AC.L2-3.1.18": ["tenant:AC.L2-3.1.18.mobile-ca"],
  "AC.L2-3.1.19": ["tenant:AC.L2-3.1.19.ios-mam"],
  "AC.L2-3.1.2": ["tenant:AC.L2-3.1.2.role-assign"],
  "AC.L2-3.1.21": ["tenant:AC.L2-3.1.21.block-storage"],
  "AC.L2-3.1.4": ["tenant:AC.L2-3.1.4.pim-approval"],
  "AC.L2-3.1.5": ["tenant:AC.L2-3.1.5.pim-eligible"],
  "AC.L2-3.1.6": ["tenant:AC.L2-3.1.6.admin-account"],
  "AC.L2-3.1.7": ["tenant:AC.L2-3.1.5.pim-eligible"],
  "AC.L2-3.1.9": ["tenant:AC.L2-3.1.9.terms-of-use"],
  "AU.L2-3.3.1": ["tenant:AU.L2-3.3.1.audit-enable", "tenant:AU.L2-3.3.1.audit-retention", "tenant:AU.L2-3.3.1.org-customization"],
  "AU.L2-3.3.3": ["tenant:AU.L2-3.3.3.sentinel-connector"],
  "AU.L2-3.3.6": ["tenant:AU.L2-3.3.6.audit-reduction"],
  "CM.L2-3.4.1": ["tenant:CM.L2-3.4.1.security-baseline"],
  "CM.L2-3.4.2": ["tenant:CM.L2-3.4.2.asr-rules"],
  "CM.L2-3.4.6": ["tenant:CM.L2-3.4.6.least-functionality"],
  "CM.L2-3.4.7": ["tenant:CM.L2-3.4.7.wdac"],
  "CM.L2-3.4.9": ["tenant:CM.L2-3.4.9.install-control"],
  "IA.L2-3.5.10": ["tenant:IA.L2-3.5.10.cert-auth"],
  "IA.L2-3.5.3": ["tenant:IA.L2-3.5.3.fido2-enable", "tenant:IA.L2-3.5.3.mfa-authenticator"],
  "IA.L2-3.5.4": ["tenant:IA.L2-3.5.4.auth-strength"],
  "IA.L2-3.5.5": ["tenant:IA.L2-3.5.5.disable-inactive"],
  "IA.L2-3.5.6": ["tenant:IA.L2-3.5.5.disable-inactive"],
  "IA.L2-3.5.9": ["tenant:IA.L2-3.5.9.tap-config"],
  "IR.L2-3.6.1": ["tenant:IR.L2-3.6.1.atp-enable", "tenant:IR.L2-3.6.1.malware-filter"],
  "MA.L2-3.7.1": ["tenant:MA.L2-3.7.1.update-ring"],
  "MA.L2-3.7.2": ["tenant:MA.L2-3.7.1.update-ring"],
  "MA.L2-3.7.5": ["tenant:MA.L2-3.7.5.remote-mfa"],
  "MP.L2-3.8.1": ["tenant:MP.L2-3.8.1.cui-label", "tenant:MP.L2-3.8.1.label-policy"],
  "MP.L2-3.8.2": ["tenant:MP.L2-3.8.1.cui-label"],
  "MP.L2-3.8.4": ["tenant:MP.L2-3.8.1.cui-label"],
  "MP.L2-3.8.6": ["tenant:MP.L2-3.8.6.bitlocker"],
  "MP.L2-3.8.9": ["tenant:MP.L2-3.8.9.dlp-policy", "tenant:MP.L2-3.8.9.dlp-rule"],
  "RA.L2-3.11.3": ["tenant:RA.L2-3.11.3.vuln-remediation"],
  "SC.L1-3.13.1": ["tenant:SC.L1-3.13.1.endpoint-firewall"],
  "SC.L1-3.13.5": ["tenant:SC.L1-3.13.1.endpoint-firewall"],
  "SC.L2-3.13.12": ["tenant:SC.L2-3.13.12.camera-block"],
  "SC.L2-3.13.13": ["tenant:SC.L2-3.13.13.safe-attach", "tenant:SC.L2-3.13.13.safe-attach-rule"],
  "SC.L2-3.13.14": ["tenant:SC.L2-3.13.14.teams-external"],
  "SC.L2-3.13.15": ["tenant:SC.L2-3.13.15.anti-phish", "tenant:SC.L2-3.13.15.anti-phish-rule", "tenant:SC.L2-3.13.15.anti-spam", "tenant:SC.L2-3.13.15.anti-spam-rule", "tenant:SC.L2-3.13.15.dkim", "tenant:SC.L2-3.13.15.outbound-spam", "tenant:SC.L2-3.13.15.outbound-spam-rule"],
  "SC.L2-3.13.3": ["tenant:AC.L2-3.1.5.pim-eligible"],
  "SC.L2-3.13.6": ["tenant:SC.L1-3.13.1.endpoint-firewall"],
  "SC.L2-3.13.7": ["tenant:AC.L2-3.1.14.block-untrusted"],
  "SC.L2-3.13.8": ["tenant:SC.L2-3.13.8.tls-enforce"],
  "SC.L2-3.13.9": ["tenant:AC.L2-3.1.10.screen-lock"],
  "SI.L1-3.14.2": ["tenant:SI.L2-3.14.2.anti-malware", "tenant:SI.L2-3.14.2.malware-rule"],
  "SI.L1-3.14.5": ["tenant:SI.L1-3.14.5.scan-schedule-evidence"],
  "SI.L2-3.14.3": ["tenant:SI.L2-3.14.3.safe-links", "tenant:SI.L2-3.14.3.safe-links-rule"],
};
