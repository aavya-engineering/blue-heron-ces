// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useMemo } from 'react';
import { useBTCActivationPackage } from '@/shared/hooks/useDataLoader';
import type { ActivationRule } from '../types';

export function useActivationPackage() {
  const { data: raw, loading, error, fromCache } = useBTCActivationPackage();

  const result = useMemo(() => {
    if (!raw) return { rules: [], packageVersion: '1.0' };

    const rules: ActivationRule[] = ((raw.rules as Record<string, unknown>[]) || []).map(
      (r: Record<string, unknown>) => ({
        id: r.id as string,
        description: r.description as string,
        priority: r.priority as number,
        when: r.when as ActivationRule['when'],
        then: r.then as ActivationRule['then'],
      })
    );

    const packageVersion = raw.schema_version || '1.0';
    return { rules, packageVersion };
  }, [raw]);

  return { ...result, loading, error, fromCache };
}
