// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Shared personnel queries (FIN-31b moved usePersonnel here so the Personnel and Training screens
// can use each other's panels without a circular import).

import { useQuery } from '@tanstack/react-query';
import { eoApi } from '../api/eo';

export function usePersonnel(tenant: string) {
  return useQuery({ queryKey: ['personnel', tenant], queryFn: () => eoApi.personnel(tenant), retry: false });
}

export function usePersonnelConfig(tenant: string) {
  return useQuery({ queryKey: ['personnel-config', tenant], queryFn: () => eoApi.personnelConfig(tenant), retry: false });
}

export function useTrainingCatalog(tenant: string) {
  return useQuery({ queryKey: ['training-catalog', tenant], queryFn: () => eoApi.trainingCatalog(tenant), retry: false });
}
