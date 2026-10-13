// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { db } from '@/shared/db/schema';
import { nanoid } from '@/shared/utils/nanoid';
import type { Engagement, EngagementKind } from '@/shared/types/engagement';

/**
 * Create a new engagement record. Each call creates a fresh record with a new ID.
 * engagement_kind is set at creation time and is immutable thereafter.
 */
export async function createEngagement(kind: EngagementKind): Promise<Engagement> {
  const engagement: Engagement = {
    id: nanoid(),
    engagement_kind: kind,
    created_at: new Date().toISOString(),
  };
  await db.engagements.add(engagement);
  return engagement;
}

/**
 * Mutation of engagement_kind is FORBIDDEN after creation.
 * This function always throws — it exists to make the immutability contract
 * explicit and testable at the type/service boundary.
 */
export function updateEngagementKind(_id: string, _kind: EngagementKind): never {
  throw new Error('engagement_kind is immutable after creation');
}
