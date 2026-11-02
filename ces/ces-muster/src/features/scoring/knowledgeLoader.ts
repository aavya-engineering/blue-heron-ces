// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Knowledge loader — fetches and parses the two YAML files (and, MG-07, the tech-ref index) the deriveActionStatuses
// cascade consumes from public/knowledge/ (local static assets, never an API origin).
// Module-level cache ensures files are only fetched once per session.
import { load } from 'js-yaml';
import type { ImplementationPatterns, VendorPlaybook } from '@/features/plan/engine/shared/types/domain';
import { buildTechRefIndex, type TechRefIndex } from '@/features/plan/engine/shared/services/techRefIndex';

export interface KnowledgeBundle {
  patterns: ImplementationPatterns;
  playbook: VendorPlaybook;
  /**
   * MG-07: the GCC High / G5 tech-reference index Planner's bulk cascade uses
   * for its license gate and CSP-managed practices (the same static asset
   * Planner reads). Absent when the asset is unavailable: the cascade then
   * falls back to its built-in E5 service list, as Planner does without it.
   */
  techRef?: TechRefIndex;
}

let cache: KnowledgeBundle | null = null;

/**
 * Load and parse the implementation patterns + M365 vendor playbook.
 * Uses browser fetch against Vite's static-asset server (/knowledge/*).
 * Safe to call repeatedly — results are module-level cached.
 */
export async function loadKnowledge(): Promise<KnowledgeBundle> {
  if (cache) return cache;

  const [patternsText, playbookText] = await Promise.all([
    fetch('/knowledge/domain Implementation Patterns.yaml').then((r) => r.text()),
    fetch('/knowledge/vendor playbook Microsoft 365.yaml').then((r) => r.text()),
  ]);

  const patterns = load(patternsText) as ImplementationPatterns;
  const playbook = load(playbookText) as VendorPlaybook;
  const techRef = await loadTechRefIndex();

  cache = { patterns, playbook, ...(techRef ? { techRef } : {}) };
  return cache;
}

async function loadTechRefIndex(): Promise<TechRefIndex | undefined> {
  try {
    const r = await fetch('/knowledge/gcc-high-g5-cmmc-2-tech-ref-structured.json');
    if (!r || !r.ok) return undefined;
    return buildTechRefIndex(JSON.parse(await r.text()));
  } catch {
    return undefined;
  }
}

/** Bust the cache — test utility only. */
export function _resetKnowledgeCache(): void {
  cache = null;
}
