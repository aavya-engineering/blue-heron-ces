// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export const COMPLIANCE_THRESHOLDS = {
  DEVICE_COMPLIANCE_MINIMUM: 95,        // AC.L2-3.1.20, CM.L2-3.4.1
  ENCRYPTION_MINIMUM: 95,                // SC.L2-3.13.16
  MFA_COVERAGE_MINIMUM: 100,             // IA.L2-3.5.3 (all privileged users)
  AUDIT_RETENTION_DAYS_MINIMUM: 365,    // AU.L2-3.3.1 (CMMC requirement)
  DLP_POLICY_MINIMUM_RULES: 1,          // SC.L2-3.13.8
  VULNERABILITY_REMEDIATION_DAYS: 30,   // SI.L2-3.14.1
};

export const PHISHING_RESISTANT_METHODS = [
  'fido2',
  'certificate',
  'windowsHelloForBusiness',
];

export const CUI_AUDIT_EVENT_TYPES = [
  'SharePointFileOperation',
  'ExchangeItem',
  'AzureActiveDirectoryAccountLogon',
  'AzureActiveDirectoryStsLogon',
  'OneDriveFileOperation',
  'ComplianceDLPSharePoint',
  'ComplianceDLPExchange',
];
