// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { nanoid } from '@/shared/utils/nanoid';
import type { Sub } from '@/shared/types/engagement';

/**
 * Parse a CSV roster file into Sub records.
 * Expected CSV format (with header row):
 *   name,uei,cage
 *
 * Returns Sub[] with generated IDs, linked to the given engagementId.
 */
export function parseRosterCsv(csvText: string, engagementId: string): Sub[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 1) return [];

  // Detect header row and skip it if present
  const first = lines[0].toLowerCase();
  const startIdx = first.startsWith('name') ? 1 : 0;

  const subs: Sub[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const name = parts[0]?.trim() ?? '';
    const uei = parts[1]?.trim() ?? '';
    const cage = parts[2]?.trim() ?? '';

    if (!name) continue;

    subs.push({
      id: nanoid(),
      engagement_id: engagementId,
      name,
      ...(uei ? { uei } : {}),
      ...(cage ? { cage } : {}),
    });
  }

  return subs;
}
