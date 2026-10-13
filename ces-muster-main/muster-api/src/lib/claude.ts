// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// claude.ts — lazy singleton factory for the Anthropic client.
// If ANTHROPIC_API_KEY is absent the entire Claude surface degrades gracefully.

import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

/**
 * Returns a shared Anthropic client, or null when no API key is configured.
 * The client is constructed lazily on first call; the key is read once.
 */
export function getClaude(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/** True when ANTHROPIC_API_KEY is absent — routes should return 503 {degraded:true}. */
export function isDegraded(): boolean {
  return !process.env.ANTHROPIC_API_KEY;
}
