// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export interface PolicyDocument {
  template_id: string;
  title: string;
  markdown: string;
  completeness: number;
  domain: string;
  nist_controls: string[];
  /** Unique document identifier (e.g., "ORG-AC-001") */
  documentId?: string;
  /** ISO 8601 date of policy approval */
  approvalDate?: string;
  /** Name of approving authority (AO, ISSO, etc.) */
  approverName?: string;
  /** Revision version (e.g., "1.2") */
  version?: string;
  /** Human-readable summary of covered controls */
  nistControlSummary?: string;
}
