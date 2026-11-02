// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Generates the FedRAMP Inherited Controls section (Section 2.4) for the SSP.
 *
 * Two paths:
 * - `generateInheritanceSection` (directive-driven, unchanged): filters inherit-fedramp controls,
 *   validates metadata consistency, generates parent narrative + per-control entries.
 * - `buildInheritanceTable` (W3.4): builds the complete 110-row inheritance table from the CRM that
 *   `SharedResponsibilityMatrixGenerator.generateCrmTable` produced, printing each row's authored
 *   Microsoft / customer text with the source cited in a footnote column, plus the note on where the
 *   data disagrees with Muster's fedramp-inheritance-table.yaml. It does not depend on the
 *   inherit-fedramp directive, so section 2.4 renders on every run.
 */

import type { ControlImplementation } from 'ces-shared/types/ssp';
import type { ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import type { DirectiveControlImplementation } from '../../shared/types/ssp.types.js';
import { DirectiveNarrativeBuilder } from '../generation/DirectiveNarrativeBuilder.js';
import { NarrativeLanguageGuard } from './NarrativeLanguageGuard.js';
import type { SharedResponsibilityMatrix, ControlResponsibility, ConditionStatus } from './SharedResponsibilityMatrixGenerator.js';

export interface InheritanceSection {
  parentNarrative: string;
  controlEntries: ControlImplementation[];
}

export interface InheritanceTableRow {
  controlId: string;
  nistRef: string;
  requirement: string;
  responsibility: 'Inherited' | 'Shared' | 'Customer';
  microsoftResponsibility: string;
  customerResponsibility: string;
  /** Microsoft's own published coverage value for GCC High (Placemat), verbatim. */
  placematCoverage: string;
  /** 'Microsoft Product Placemat (GCC High Responsibility)' or 'BHD assessment'. */
  basis: string;
  /** Footnote marker(s), e.g. "[1]" or "[1][2]"; resolved in `footnotes`. */
  footnote: string;
  conditionStatus: ConditionStatus;
  conditionText?: string;
  note?: string;
}

export interface InheritanceTable {
  title: string;
  intro: string;
  rows: InheritanceTableRow[];
  /** Footnote marker -> "Name - URL". */
  footnotes: Array<{ marker: string; text: string }>;
  excludedIds: Array<{ id: string; reason: string }>;
  musterNote: string[];
  factsNote: string;
  counts: { inherited: number; shared: number; customer: number; pending: number };
}

const BASIS_PLACEMAT = 'Microsoft Product Placemat (GCC High Responsibility)';
const BASIS_BHD = 'BHD assessment';

export class FedRampInheritanceGenerator {

  generateInheritanceSection(
    controls: DirectiveControlImplementation[],
    metadata: Map<string, ExtendedDirectiveMetadata>
  ): InheritanceSection | null {
    // 1. Filter controls where directive === 'inherit-fedramp'
    const inheritControls = controls.filter(c => c.directive === 'inherit-fedramp');
    if (inheritControls.length === 0) return null;

    // 2. Extract common fields from first metadata
    const firstMeta = metadata.get(inheritControls[0].control_id);
    if (!firstMeta) return null;

    // 3. Validate all inherit-fedramp controls share same fedramp_package_id
    const packageId = firstMeta.fedramp_package_id;
    for (const ctrl of inheritControls) {
      const ctrlMeta = metadata.get(ctrl.control_id);
      if (ctrlMeta && ctrlMeta.fedramp_package_id !== packageId) {
        console.warn(
          `[FedRampInheritanceGenerator] Multiple FedRAMP packages detected: ` +
          `${packageId} vs ${ctrlMeta.fedramp_package_id}. Using first package.`
        );
        break;
      }
    }

    // 4. Build CmmcControl-shaped objects for the narrative builder
    const cmmcControls = inheritControls.map(c => ({
      control_id: c.control_id,
      nist_ref: c.nist_ref,
      family: c.family,
      practice: c.practice,
      weight: c.weight,
    }));

    // 5. Generate parent section narrative
    let parentNarrative = DirectiveNarrativeBuilder.buildInheritFedRampNarrative(
      cmmcControls[0] as any,
      firstMeta,
      true,
      cmmcControls as any[]
    );

    // 6. Validate date fabrication
    const allowedDates = [new Date().toISOString().split('T')[0]];
    const dateCheck = NarrativeLanguageGuard.validateNoFabricatedDates(parentNarrative, allowedDates);
    if (!dateCheck.valid) {
      console.warn(`[FedRampInheritanceGenerator] Fabricated dates detected: ${dateCheck.violations.join(', ')}. Replacing with "see compliance repository".`);
      for (const date of dateCheck.violations) {
        parentNarrative = parentNarrative.replace(new RegExp(date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'see compliance repository');
      }
    }

    // 7. Validate generic CRM language
    const crmCheck = NarrativeLanguageGuard.validateNoGenericCrm(parentNarrative);
    if (!crmCheck.valid) {
      console.warn(`[FedRampInheritanceGenerator] Generic CRM language detected: ${crmCheck.violations.join(', ')}. Consider refining narrative.`);
    }

    // 8. Build control entries from existing control implementations
    const controlEntries: ControlImplementation[] = inheritControls.map(c => ({
      control_id: c.control_id,
      nist_ref: c.nist_ref,
      family: c.family,
      practice: c.practice,
      status: c.status,
      classification: c.classification,
      weight: c.weight,
      implementationNarrative: c.implementationNarrative,
      technologyUsed: c.technologyUsed,
      responsibleRole: c.responsibleRole,
      evidenceReferences: c.evidenceReferences,
      relatedPolicies: c.relatedPolicies,
      odpValues: c.odpValues,
      assessmentObjectives: c.assessmentObjectives,
    }));

    return {
      parentNarrative,
      controlEntries,
    };
  }

  /**
   * W3.4: build the complete section 2.4 inheritance table from a CRM whose `controlDetails`
   * carry the data-file rows (every control, including customer-only ones).
   *
   * Orchestrator hook (SspGenerator, one line after `extractSharedResponsibilityMatrix`):
   *   `(ssp as any).inheritanceTable = FedRampInheritanceGenerator.buildInheritanceTable(sharedResponsibilityMatrix);`
   * and `extractSharedResponsibilityMatrix` passes the facts as the fourth argument of `generateCrmTable`:
   *   `SharedResponsibilityMatrixGenerator.extractFacts(_manifests?.missionPlan as Record<string, unknown>)`.
   */
  static buildInheritanceTable(crm: SharedResponsibilityMatrix | undefined | null): InheritanceTable | null {
    if (!crm || !crm.controlDetails || crm.controlDetails.length === 0) return null;

    // Footnotes: [1] = the Placemat (basis for every row); [2] = BHD assessment; [3..] = other named sources.
    const sources = crm.sources ?? [];
    const footnotes: Array<{ marker: string; text: string }> = [];
    const markerOf = new Map<string, string>();
    const placemat = sources.find(s => s.key === 'placemat');
    if (placemat) {
      markerOf.set('placemat', '[1]');
      footnotes.push({ marker: '[1]', text: `${placemat.name} - ${placemat.url}` });
    } else {
      markerOf.set('placemat', '[1]');
      footnotes.push({ marker: '[1]', text: 'Microsoft Product Placemat for CMMC 2.0 (GCC High Responsibility column)' });
    }
    markerOf.set('bhd', '[2]');
    footnotes.push({ marker: '[2]', text: 'BHD assessment: the row\'s responsibility is derived from the control text and the documented service capabilities where it departs from the Placemat value; the Placemat value is printed beside it.' });
    let next = 3;
    for (const s of sources) {
      if (s.key === 'placemat') continue;
      const marker = `[${next++}]`;
      markerOf.set(s.key, marker);
      footnotes.push({ marker, text: `${s.name} - ${s.url}` });
    }

    const rows: InheritanceTableRow[] = [];
    const counts = { inherited: 0, shared: 0, customer: 0, pending: 0 };
    for (const d of crm.controlDetails) {
      const basis = d.basis ?? (d.requirement ? BASIS_PLACEMAT : BASIS_BHD);
      const markers = [markerOf.get('placemat')!];
      if (basis === BASIS_BHD) markers.push(markerOf.get('bhd')!);
      const conditionStatus: ConditionStatus = d.conditionStatus ?? 'none';
      const row: InheritanceTableRow = {
        controlId: d.controlId,
        nistRef: d.nistRef ?? d.controlId.replace(/^.*-/, ''),
        requirement: d.requirement ?? '',
        responsibility: d.responsibility,
        microsoftResponsibility: d.microsoftResponsibility ?? '',
        customerResponsibility: d.customerResponsibility ?? (d.responsibility === 'Customer' ? d.rationale : ''),
        placematCoverage: d.placematCoverage ?? 'not in data file',
        basis,
        footnote: markers.join(''),
        conditionStatus,
        conditionText: FedRampInheritanceGenerator.conditionText(d),
        note: d.note,
      };
      rows.push(row);
      if (d.responsibility === 'Inherited') counts.inherited++;
      else if (d.responsibility === 'Shared') counts.shared++;
      else counts.customer++;
      if (conditionStatus === 'pending') counts.pending++;
    }

    const facts = crm.facts;
    const fmt = (v: number | null | undefined) => (v === undefined || v === null ? 'not recorded' : String(v));
    const factsNote = `Conditional rows (PE.L1-3.10.1/3/4/5, PE.L2-3.10.2 on physical_facility_count; MA.L2-3.7.1/2/3/6 on customer_equipment_count) are inherited only when the count is 0. ` +
      `SI baseline facts used: physical_facility_count = ${fmt(facts?.physicalFacilityCount)}, customer_equipment_count = ${fmt(facts?.customerEquipmentCount)}` +
      (counts.pending > 0 ? `; ${counts.pending} row(s) read "pending facts" and are counted as Shared until the counts are recorded.` : '.');

    const intro = `Responsibility for each of the ${rows.length} CMMC Level 2 practices for a Microsoft 365 GCC High and Azure Government tenant. ` +
      `"Microsoft coverage" is Microsoft's published value for GCC High ${markerOf.get('placemat')}; "Responsibility" is the value this SSP uses ` +
      `(Inherited ${counts.inherited}, Shared ${counts.shared}, Customer ${counts.customer}). Where the two differ the basis column reads "${BASIS_BHD}" ${markerOf.get('bhd')} and the note gives the reason.`;

    return {
      title: '2.4 FedRAMP Inherited Controls',
      intro,
      rows,
      footnotes,
      excludedIds: crm.excludedIds ?? [],
      musterNote: crm.musterTableNotes ?? [],
      factsNote,
      counts,
    };
  }

  private static conditionText(d: ControlResponsibility): string | undefined {
    const conds = d.conditions ?? [];
    if (conds.length === 0) return undefined;
    const names = conds.map(c => c.replace(/_zero$/, ' = 0')).join(', ');
    switch (d.conditionStatus) {
      case 'met': return `Condition met (${names}).`;
      case 'not_met': return `Condition not met (${names}); the organization's own facility/equipment keeps this Shared.`;
      case 'pending': return `Pending facts (${names}): count not recorded in the SI baseline.`;
      default: return undefined;
    }
  }

  /** Markdown rendering of the table (used by the JSON/markdown SSP outputs and tests). */
  static renderInheritanceTableMarkdown(table: InheritanceTable): string {
    const esc = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const lines: string[] = [];
    lines.push(`## ${table.title}`, '', table.intro, '');
    lines.push('| Control | Requirement | Responsibility | Microsoft | Customer | Microsoft coverage (Placemat) | Basis | Source |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const r of table.rows) {
      const extra = [r.conditionText, r.note].filter(Boolean).join(' ');
      lines.push(`| ${r.controlId} | ${esc(r.requirement)} | ${r.responsibility}${r.conditionStatus === 'pending' ? ' (pending facts)' : ''} | ${esc(r.microsoftResponsibility)} | ${esc(r.customerResponsibility)}${extra ? ' ' + esc(extra) : ''} | ${esc(r.placematCoverage)} | ${esc(r.basis)} | ${r.footnote} |`);
    }
    lines.push('', table.factsNote, '');
    if (table.excludedIds.length > 0) {
      lines.push('**Excluded ids** (present in earlier data, not NIST SP 800-171 Rev 2 requirements):');
      for (const e of table.excludedIds) lines.push(`- ${e.id}: ${e.reason}`);
      lines.push('');
    }
    if (table.musterNote.length > 0) {
      lines.push('**Note on the Muster inheritance table** (`fedramp-inheritance-table.yaml`):');
      for (const n of table.musterNote) lines.push(`- ${n}`);
      lines.push('');
    }
    lines.push('**Sources**');
    for (const f of table.footnotes) lines.push(`- ${f.marker} ${f.text}`);
    return lines.join('\n');
  }
}
