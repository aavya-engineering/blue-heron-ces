// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

export interface Customer {
  id?: number;
  name: string;
  email?: string;
  phone?: string;
  targetLevel?: 'L1' | 'L2' | 'L3';
  createdAt: string;
  updatedAt: string;
}

export interface CustomerFormData {
  name: string;
  email?: string;
  phone?: string;
  targetLevel?: 'L1' | 'L2' | 'L3';
}
