// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useLiveQuery } from 'dexie-react-hooks';
import { dbHelpers } from '@/shared/db/schema';
import { persistCustomer } from '@/shared/services/artifactPersistence';
import type { Customer, CustomerFormData } from '../types';

export function useCustomers() {
  const customers = useLiveQuery(() => dbHelpers.getCustomers());

  return {
    customers: customers || [],
    loading: customers === undefined,
  };
}

export function useCustomer(id: number | null) {
  const customer = useLiveQuery(
    async () => {
      if (!id) return null;
      return dbHelpers.getCustomerById(id);
    },
    [id]
  );

  return {
    customer: customer || null,
    loading: customer === undefined && id !== null,
  };
}

export function useCreateCustomer() {
  const createCustomer = async (data: CustomerFormData): Promise<number> => {
    const now = new Date().toISOString();
    const customer: Omit<Customer, 'id'> = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    const id = await dbHelpers.createCustomer(customer);
    
    // Persist to local disk
    await persistCustomer({ ...customer, id }, id, `customer-${id}`);
    
    return id;
  };

  return { createCustomer };
}
