// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

export interface Contract {
  contract_id: string;
  contract_number: string;
  award_date: string;
  pop_start: string;
  pop_end: string;
  party_cage: string;
  party_uei: string;
  dfars_clauses: string[];
  cui_flowdown: boolean;
  status: 'pending' | 'active' | 'option_year' | 'expired' | 'closed';
  value_at_risk: number;
  prime_ref: string | null;
  sub_ref: string | null;
  engagement_ref: string;
}
