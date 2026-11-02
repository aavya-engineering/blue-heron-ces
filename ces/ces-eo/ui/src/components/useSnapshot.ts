// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The assessment snapshot the SSP and POA&M are generated from: the one this session's assess run
// produced (legacy lastSnapshotId), else the tenant's latest stored snapshot (GET /api/assessment).

import { useQuery } from '@tanstack/react-query';
import { eoApi } from '../api/eo';
import { useSession } from '../store/session';

export function useSnapshotId(tenant: string): { snapshotId: string | null; loading: boolean } {
  const last = useSession((s) => s.lastSnapshotId);
  const assessment = useQuery({ queryKey: ['assessment', tenant], queryFn: () => eoApi.assessment(tenant), retry: false, enabled: !last });
  return { snapshotId: last ?? assessment.data?.snapshotId ?? null, loading: !last && assessment.isLoading };
}
