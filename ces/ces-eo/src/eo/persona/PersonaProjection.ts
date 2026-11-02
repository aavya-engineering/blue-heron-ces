// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PersonaProjection — the persona-facing view. Projects the unified DeterminationLedger down to
// what a single end-user persona is responsible for: their controls + current status + their open
// deficiencies + a prioritized action backlog. This is how "end-user personas get the best data /
// results" — each role sees only what's theirs, cert-blockers first, instead of an org-wide wall.
//
// Pure and additive: reads the ledger (which already unifies digital + suite + non-digital sources)
// and the shared persona→control map. No new status logic.

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Persona } from 'ces-shared/types/persona';
import type { DeterminationLedger, ControlRollup, Deficiency } from '../assessment/DeterminationLedger.js';

export interface PersonaControlStatus {
  controlId: string;
  status: ControlRollup['status'];
  weight: number;
  noPoam: boolean;
}

export interface PersonaActionItem {
  objectiveId: string;
  controlId: string;
  statement: string;
  weight: number;
  certificationBlocker: boolean;   // 5-point — must be MET at assessment, cannot POA&M
  source: string;                  // how it's evidenced (which source owns it)
  priority: number;                // 1 = highest (cert-blockers, then by weight)
  action: string;                  // human-readable next step
}

export interface PersonaProjection {
  persona: { id: string; title: string; description: string; cuiAccess: string };
  controls: PersonaControlStatus[];
  actions: PersonaActionItem[];
  summary: {
    controlsTotal: number;
    met: number;
    notMet: number;
    partial: number;
    notAssessed: number;
    openDeficiencies: number;
    certificationBlockers: number;
  };
}

export function loadPersonas(): Persona[] {
  const _require = createRequire(import.meta.url);
  const raw = JSON.parse(fs.readFileSync(_require.resolve('ces-shared/data/personas'), 'utf-8').replace(/^﻿/, ''));
  return raw.personas ?? [];
}

/** Project the ledger down to one persona's responsibilities + prioritized action backlog. */
export function projectPersona(persona: Persona, ledger: DeterminationLedger): PersonaProjection {
  const owned = new Set(persona.controls);
  const controls: PersonaControlStatus[] = ledger.controls
    .filter(c => owned.has(c.controlId))
    .map(c => ({ controlId: c.controlId, status: c.status, weight: c.weight, noPoam: c.noPoam }));

  const myDeficiencies: Deficiency[] = ledger.deficiencies.filter(d => owned.has(d.controlId));

  const actions: PersonaActionItem[] = myDeficiencies
    .map(d => ({
      objectiveId: d.objectiveId,
      controlId: d.controlId,
      statement: d.statement,
      weight: d.weight,
      certificationBlocker: d.noPoam,
      source: d.source,
      priority: 0,
      action: `${d.controlId} ${d.objectiveId}: ${d.status === 'not_assessed' ? 'evidence needed' : 'remediate'} — ${d.statement}`,
    }))
    // cert-blockers first, then by weight desc, then objective id for stability
    .sort((a, b) =>
      Number(b.certificationBlocker) - Number(a.certificationBlocker) ||
      b.weight - a.weight ||
      a.objectiveId.localeCompare(b.objectiveId, undefined, { numeric: true }))
    .map((a, i) => ({ ...a, priority: i + 1 }));

  const summary = {
    controlsTotal: controls.length,
    met: controls.filter(c => c.status === 'met').length,
    notMet: controls.filter(c => c.status === 'not_met').length,
    partial: controls.filter(c => c.status === 'partial').length,
    notAssessed: controls.filter(c => c.status === 'not_assessed').length,
    openDeficiencies: myDeficiencies.length,
    certificationBlockers: myDeficiencies.filter(d => d.noPoam).length,
  };

  return {
    persona: { id: persona.id, title: persona.title, description: persona.description, cuiAccess: persona.cuiAccess },
    controls, actions, summary,
  };
}

export function projectAllPersonas(personas: Persona[], ledger: DeterminationLedger): PersonaProjection[] {
  return personas.map(p => projectPersona(p, ledger));
}
