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
//
// FIN-17 (OQ-1, interim until SP-9 / FIN-44): AI paths are off for live tenants in V1 (founder
// ruling). The AI routes (coach chat, adaptive interview, retro confidence) carry no tenant in
// their call to this module, so the gate is process-wide and fails closed: the client is handed
// out only when this muster-api is declared sim-only (MUSTER_AI_SIM_ONLY=1) AND has no live
// tenant access configured (MUSTER_LIVE_CLIENT_ID unset, the device-code consent client that
// live discovery and harvest need). Otherwise every AI route answers as degraded (503
// {degraded:true}), exactly as with no key. SP-9 replaces this with the per-tenant AI key gate.

import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

/** The operator's declaration that this muster-api serves simulated tenants only. */
export const AI_SIM_ONLY_ENV = 'MUSTER_AI_SIM_ONLY';
/** Set when live tenant access is configured (liveAccess.ts); its presence refuses AI. */
export const LIVE_CLIENT_ENV = 'MUSTER_LIVE_CLIENT_ID';

export type AiGateReason = 'no_key' | 'not_declared_sim_only' | 'live_access_configured';

/** Whether the AI paths may run in this process, and why not. */
export function aiGate(env: NodeJS.ProcessEnv = process.env): { allowed: true } | { allowed: false; reason: AiGateReason } {
  if (!env.ANTHROPIC_API_KEY) return { allowed: false, reason: 'no_key' };
  if (env[LIVE_CLIENT_ENV]?.trim()) return { allowed: false, reason: 'live_access_configured' };
  if (env[AI_SIM_ONLY_ENV] !== '1') return { allowed: false, reason: 'not_declared_sim_only' };
  return { allowed: true };
}

/**
 * Returns a shared Anthropic client, or null when no API key is configured or the
 * live-tenant AI gate refuses (FIN-17). The client is constructed lazily on first call.
 */
export function getClaude(): Anthropic | null {
  if (!aiGate().allowed) return null;
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/** True when the AI paths must not run (no key, or the live-tenant gate) — routes return 503 {degraded:true}. */
export function isDegraded(): boolean {
  return !aiGate().allowed;
}
