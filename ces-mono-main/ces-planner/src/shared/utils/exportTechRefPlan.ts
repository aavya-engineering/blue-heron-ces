// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// ---------------------------------------------------------------------------
// Tech Ref Implementation Guide — all 110 controls with MS implementation
// guidance, posture status, GCC High responsibilities, and evidence reqs.
// ---------------------------------------------------------------------------

import { esc, escWithLinks } from './exportPlan';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface TechRefPlanStrengthExample {
  strength: string;
  description: string;
}

interface TechRefPlanArchetype {
  archetype_id: string;
  name: string;
  description: string;
  strength: string;
  strength_examples: TechRefPlanStrengthExample[];
  acceptable_forms: string[];
  collection_notes: string;
  retention_notes: string;
}

interface TechRefPlanEvidence {
  assessor_methods: string[];
  archetypes: TechRefPlanArchetype[];
  anti_patterns: string[];
}

interface TechRefPlanParagraph {
  text: string;
  text_with_links: string;
  links: Array<{ text: string; url: string }>;
}

interface TechRefPlanServiceImpl {
  service_name: string;
  paragraphs: TechRefPlanParagraph[];
}

interface TechRefPlanControl {
  control_id: string;
  cmmc_level: number;
  practice: string;
  nist_mapping: string;
  status: 'MET' | 'PARTIAL' | 'NOT_MET' | 'UNKNOWN';
  assessment_objectives: Array<{ id: string; text: string }>;
  primary_services: string[];
  secondary_services: string[];
  implementation_by_service: TechRefPlanServiceImpl[];
  gcch_responsibilities: Array<{ text: string; text_with_links: string }>;
  evidence: TechRefPlanEvidence;
}

interface TechRefPlanFamily {
  abbreviation: string;
  name: string;
  controls: TechRefPlanControl[];
}

export interface TechRefPlanData {
  ces: {
    artifact: 'tech_ref_implementation_guide';
    version: string;
    generated_on: string;
  };
  target_level: string;
  posture_summary: { met: number; partial: number; not_met: number; unknown: number };
  control_families: TechRefPlanFamily[];
}

// ---------------------------------------------------------------------------
// compileTechRefPlan — merge tech ref, posture, and evidence into one object
// ---------------------------------------------------------------------------

export function compileTechRefPlan(
  techRef: any,
  posture: any,
  evidenceMatrix: any,
  archetypeCatalog: any,
): TechRefPlanData {
  // Build posture lookup: requirement_id -> uppercase status
  const postureMap = new Map<string, 'MET' | 'PARTIAL' | 'NOT_MET' | 'UNKNOWN'>();
  const reqResults: any[] = posture?.ces?.requirement_results || [];
  for (const rr of reqResults) {
    if (rr.requirement_id) {
      const raw = (rr.status || 'unknown').toLowerCase();
      const mapped =
        raw === 'met'
          ? 'MET'
          : raw === 'partial'
            ? 'PARTIAL'
            : raw === 'not_met'
              ? 'NOT_MET'
              : 'UNKNOWN';
      postureMap.set(rr.requirement_id, mapped);
    }
  }

  // Build evidence matrix lookup: practice_id -> mapping entry
  const emxMap = new Map<string, any>();
  const emxMappings: any[] = evidenceMatrix?.ces?.mappings || [];
  for (const m of emxMappings) {
    if (m.practice_id) {
      emxMap.set(m.practice_id, m);
    }
  }

  // Build archetype lookup: archetype_id -> full archetype object
  const archetypeMap = new Map<string, any>();
  const archetypes: any[] = archetypeCatalog?.evidence_archetypes || [];
  for (const a of archetypes) {
    if (a.archetype_id) {
      archetypeMap.set(a.archetype_id, a);
    }
  }

  const summary = { met: 0, partial: 0, not_met: 0, unknown: 0 };

  const families: TechRefPlanFamily[] = [];

  for (const family of techRef?.control_families || []) {
    const controls: TechRefPlanControl[] = [];

    for (const ctrl of family.controls || []) {
      const controlId: string = ctrl.control_id || '';
      const status = postureMap.get(controlId) || 'UNKNOWN';

      // Tally posture
      if (status === 'MET') summary.met++;
      else if (status === 'PARTIAL') summary.partial++;
      else if (status === 'NOT_MET') summary.not_met++;
      else summary.unknown++;

      // Build NIST mapping string
      const nistMapping = [
        ctrl.nist_sp_800_171_ref ? `800-171: ${ctrl.nist_sp_800_171_ref}` : '',
        ctrl.nist_sp_800_53_mapping ? `800-53: ${ctrl.nist_sp_800_53_mapping}` : '',
      ]
        .filter(Boolean)
        .join(' | ');

      // GCC High responsibilities
      const gcchResps: Array<{ text: string; text_with_links: string }> = [];
      const custResp = ctrl.customer_responsibilities;
      if (custResp?.gcch) {
        for (const p of custResp.gcch) {
          gcchResps.push({
            text: p.text || '',
            text_with_links: p.text_with_links || p.text || '',
          });
        }
      }

      // Evidence from matrix
      const emxEntry = emxMap.get(controlId);
      const assessorMethods: string[] = emxEntry?.assessor_methods || [];
      const antiPatterns: string[] = emxEntry?.anti_patterns || [];
      const evidenceArchetypes: TechRefPlanArchetype[] = [];

      if (emxEntry?.evidence) {
        // Group evidence entries by archetype ID, collecting all strength tiers
        const byArchetype = new Map<string, any[]>();
        for (const ev of emxEntry.evidence) {
          const emxId = ev.emx_id;
          if (!emxId) continue;
          if (!byArchetype.has(emxId)) byArchetype.set(emxId, []);
          byArchetype.get(emxId)!.push(ev);
        }

        for (const [emxId, entries] of byArchetype) {
          const archetype = archetypeMap.get(emxId);
          const strengthExamples: TechRefPlanStrengthExample[] = entries.map((ev: any) => ({
            strength: ev.strength || 'adequate',
            description: ev.description || '',
          }));
          // Sort: strong → adequate → weak
          const strengthOrder: Record<string, number> = { strong: 0, adequate: 1, weak: 2 };
          strengthExamples.sort(
            (a, b) => (strengthOrder[a.strength] ?? 9) - (strengthOrder[b.strength] ?? 9),
          );

          evidenceArchetypes.push({
            archetype_id: emxId,
            name: archetype?.name || emxId,
            description: archetype?.description || entries[0]?.description || '',
            strength: entries[0]?.strength || 'adequate',
            strength_examples: strengthExamples,
            acceptable_forms: archetype?.acceptable_forms_examples || [],
            collection_notes: archetype?.collection_notes || '',
            retention_notes: archetype?.retention_notes_template || '',
          });
        }
      }

      controls.push({
        control_id: controlId,
        cmmc_level: ctrl.cmmc_level || 2,
        practice: ctrl.practice || '',
        nist_mapping: nistMapping,
        status,
        assessment_objectives: (ctrl.assessment_objectives || []).map((ao: any) => ({
          id: ao.id || '',
          text: ao.text || '',
        })),
        primary_services: ctrl.primary_services || [],
        secondary_services: ctrl.secondary_services || [],
        implementation_by_service: (ctrl.implementation_by_service || []).map((svc: any) => ({
          service_name: svc.service_name || '',
          paragraphs: (svc.paragraphs || []).map((p: any) => ({
            text: p.text || '',
            text_with_links: p.text_with_links || p.text || '',
            links: (p.links || []).map((l: any) => ({ text: l.text || '', url: l.url || '' })),
          })),
        })),
        gcch_responsibilities: gcchResps,
        evidence: {
          assessor_methods: assessorMethods,
          archetypes: evidenceArchetypes,
          anti_patterns: antiPatterns,
        },
      });
    }

    families.push({
      abbreviation: family.abbreviation || '',
      name: family.name || '',
      controls,
    });
  }

  // Determine target level from posture
  const targetLevel =
    posture?.ces?.control_status_summary?.level ||
    posture?.ces?.si_baseline_ref?.target_cmmc_level ||
    'L2';

  return {
    ces: {
      artifact: 'tech_ref_implementation_guide',
      version: '1.0.0',
      generated_on: new Date().toISOString(),
    },
    target_level: targetLevel,
    posture_summary: summary,
    control_families: families,
  };
}

// ---------------------------------------------------------------------------
// formatTechRefPlanAsHTML — standalone HTML document
// ---------------------------------------------------------------------------

export function formatTechRefPlanAsHTML(plan: TechRefPlanData): string {
  const ces = plan.ces;
  const ps = plan.posture_summary;
  const totalControls = ps.met + ps.partial + ps.not_met + ps.unknown;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Microsoft Tech Ref Implementation Guide</title>
<style>
${renderStyles()}
</style>
</head>
<body>
<div class="container">
${renderHeader(ces, plan.target_level, ps, totalControls)}
${renderTOC(plan.control_families)}
${plan.control_families.map((f) => renderFamily(f)).join('\n')}
${renderFooter()}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function renderStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px; line-height: 1.6; color: #1f2937; background: #f9fafb;
}
.container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
h1 { font-size: 24px; margin: 0 0 4px; color: #111827; }
h2 { font-size: 18px; margin: 32px 0 16px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
h3 { font-size: 15px; margin: 24px 0 12px; color: #374151; }
.subtitle { font-size: 14px; color: #6b7280; margin: 0 0 24px; }
.section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; }
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.stat-card { padding: 16px; border-radius: 8px; text-align: center; }
.stat-card .stat-value { font-size: 28px; font-weight: 700; }
.stat-card .stat-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
.stat-met { background: #d1fae5; color: #065f46; }
.stat-partial { background: #fef3c7; color: #92400e; }
.stat-not-met { background: #fee2e2; color: #991b1b; }
.stat-unknown { background: #f3f4f6; color: #6b7280; }
.toc-nav { columns: 2; gap: 24px; list-style: none; padding: 0; margin: 0; }
.toc-nav li { break-inside: avoid; margin-bottom: 6px; font-size: 13px; }
.toc-nav a { color: #2563eb; text-decoration: none; }
.toc-nav a:hover { text-decoration: underline; }
.toc-nav .toc-count { color: #9ca3af; font-size: 12px; }
.domain-header { background: #1f2937; color: #fff; padding: 12px 20px; border-radius: 8px 8px 0 0; margin-top: 24px; display: flex; justify-content: space-between; align-items: baseline; }
.domain-header .domain-title { font-weight: 700; font-size: 15px; }
.domain-header .domain-stats { font-size: 12px; opacity: 0.8; }
.control-card { border: 1px solid #e5e7eb; border-left: 4px solid #9ca3af; border-radius: 0 8px 8px 0; padding: 16px 20px; margin-bottom: 8px; background: #fff; }
.control-card:last-child { margin-bottom: 0; }
.control-header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.control-id { font-weight: 700; color: #111827; font-size: 14px; }
.status-badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
.status-met { background: #d1fae5; color: #065f46; }
.status-partial { background: #fef3c7; color: #92400e; }
.status-not-met { background: #fee2e2; color: #991b1b; }
.status-unknown { background: #f3f4f6; color: #6b7280; }
.level-badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: #dbeafe; color: #1e40af; }
.blockquote { border-left: 3px solid #d1d5db; padding: 8px 16px; margin: 12px 0; background: #f9fafb; font-size: 13px; color: #4b5563; border-radius: 0 4px 4px 0; }
.nist-mapping { font-size: 12px; color: #6b7280; margin: 4px 0 12px; }
.objectives-list { margin: 0; padding-left: 20px; font-size: 13px; color: #4b5563; }
.objectives-list li { margin-bottom: 4px; }
.services-row { font-size: 13px; color: #374151; margin: 8px 0; }
.services-row strong { color: #111827; }
.service-impl { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; }
.service-name { font-weight: 600; color: #1e40af; font-size: 13px; margin-bottom: 6px; }
.service-paragraph { font-size: 13px; color: #4b5563; margin-bottom: 6px; }
a.doc-link { color: #2563eb; text-decoration: underline; text-decoration-color: #93c5fd; text-underline-offset: 2px; }
a.doc-link:hover { color: #1d4ed8; text-decoration-color: #2563eb; }
.gcch-callout { background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 0 6px 6px 0; padding: 12px 16px; margin: 12px 0; font-size: 13px; color: #78350f; }
.gcch-callout .callout-title { font-weight: 700; color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.gcch-callout ul { margin: 4px 0 0; padding-left: 18px; }
.gcch-callout li { margin-bottom: 3px; }
.evidence-section { margin-top: 12px; }
.evidence-section h4 { font-size: 13px; font-weight: 600; color: #374151; margin: 8px 0 4px; }
.assessor-methods { font-size: 12px; color: #6b7280; margin: 4px 0; }
.archetype-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; margin-bottom: 6px; }
.archetype-name { font-weight: 600; font-size: 13px; color: #111827; }
.archetype-desc { font-size: 12px; color: #4b5563; margin-top: 2px; }
.archetype-forms { font-size: 12px; color: #6b7280; margin-top: 4px; }
.archetype-notes { font-size: 12px; color: #6b7280; margin-top: 4px; font-style: italic; }
.strength-examples { margin-top: 6px; font-size: 12px; }
.strength-row { display: flex; align-items: baseline; gap: 8px; margin-top: 4px; }
.strength-badge { display: inline-block; min-width: 64px; padding: 1px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-align: center; }
.strength-strong { background: #d1fae5; color: #065f46; }
.strength-adequate { background: #fef3c7; color: #92400e; }
.strength-weak { background: #fee2e2; color: #991b1b; }
.anti-patterns { margin-top: 8px; padding: 8px 14px; background: #fef2f2; border-left: 3px solid #ef4444; border-radius: 0 6px 6px 0; font-size: 12px; color: #991b1b; }
.anti-patterns strong { font-weight: 700; }
.anti-patterns ul { margin: 4px 0 0; padding-left: 18px; }
.anti-patterns li { margin-bottom: 2px; }
.footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; }

@media print {
  body { background: #fff; font-size: 10pt; }
  .container { max-width: 100%; padding: 0; }
  .section { border: 1px solid #ccc; box-shadow: none; break-inside: avoid; }
  .domain-header { break-after: avoid; }
  .control-card { break-inside: avoid; }
  .gcch-callout { break-inside: avoid; }
  h2 { break-after: avoid; }
}
`;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderHeader(
  ces: TechRefPlanData['ces'],
  targetLevel: string,
  ps: TechRefPlanData['posture_summary'],
  totalControls: number,
): string {
  const genDate = ces.generated_on
    ? new Date(ces.generated_on).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'N/A';

  return `
<h1>Microsoft Tech Ref Implementation Guide</h1>
<p class="subtitle">Generated ${esc(genDate)} &middot; CMMC ${esc(targetLevel)} &middot; ${totalControls} controls</p>
<div class="section">
  <div class="stats-row">
    <div class="stat-card stat-met"><div class="stat-value">${ps.met}</div><div class="stat-label">Met</div></div>
    <div class="stat-card stat-partial"><div class="stat-value">${ps.partial}</div><div class="stat-label">Partial</div></div>
    <div class="stat-card stat-not-met"><div class="stat-value">${ps.not_met}</div><div class="stat-label">Not Met</div></div>
    <div class="stat-card stat-unknown"><div class="stat-value">${ps.unknown}</div><div class="stat-label">Unknown</div></div>
  </div>
  <div style="text-align:center; font-size:12px; color:#6b7280;">Total controls: ${totalControls}</div>
</div>`;
}

function renderTOC(families: TechRefPlanFamily[]): string {
  const items = families
    .map((f) => {
      const anchor = `family-${esc(f.abbreviation)}`;
      return `<li><a href="#${anchor}">${esc(f.abbreviation)} &mdash; ${esc(f.name)}</a> <span class="toc-count">(${f.controls.length})</span></li>`;
    })
    .join('\n    ');

  return `
<h2>Control Families</h2>
<div class="section">
  <ul class="toc-nav">
    ${items}
  </ul>
</div>`;
}

function renderFamily(family: TechRefPlanFamily): string {
  // Count statuses within family
  let met = 0,
    partial = 0,
    notMet = 0;
  for (const c of family.controls) {
    if (c.status === 'MET') met++;
    else if (c.status === 'PARTIAL') partial++;
    else if (c.status === 'NOT_MET') notMet++;
  }
  const statsText = `${family.controls.length} controls | ${met} met, ${partial} partial, ${notMet} not met`;

  const controlsHTML = family.controls.map((c) => renderControl(c)).join('\n');

  return `
<div id="family-${esc(family.abbreviation)}">
  <div class="domain-header">
    <span class="domain-title">${esc(family.abbreviation)} &mdash; ${esc(family.name)}</span>
    <span class="domain-stats">${esc(statsText)}</span>
  </div>
  ${controlsHTML}
</div>`;
}

const STRENGTH_CLASS: Record<string, string> = {
  strong: 'strength-strong',
  adequate: 'strength-adequate',
  weak: 'strength-weak',
};

const STATUS_BORDER: Record<string, string> = {
  MET: '#059669',
  PARTIAL: '#d97706',
  NOT_MET: '#dc2626',
  UNKNOWN: '#9ca3af',
};

const STATUS_CLASS: Record<string, string> = {
  MET: 'status-met',
  PARTIAL: 'status-partial',
  NOT_MET: 'status-not-met',
  UNKNOWN: 'status-unknown',
};

const STATUS_LABEL: Record<string, string> = {
  MET: 'Met',
  PARTIAL: 'Partial',
  NOT_MET: 'Not Met',
  UNKNOWN: 'Unknown',
};

function renderControl(ctrl: TechRefPlanControl): string {
  const parts: string[] = [];

  const borderColor = STATUS_BORDER[ctrl.status] || '#9ca3af';
  const badgeClass = STATUS_CLASS[ctrl.status] || 'status-unknown';
  const statusLabel = STATUS_LABEL[ctrl.status] || 'Unknown';

  parts.push(
    `<div class="control-card" style="border-left-color: ${borderColor};">`,
  );

  // Header: control ID + status badge + level badge
  parts.push(`<div class="control-header">`);
  parts.push(`<span class="control-id">${esc(ctrl.control_id)}</span>`);
  parts.push(`<span class="status-badge ${badgeClass}">${statusLabel}</span>`);
  parts.push(`<span class="level-badge">L${ctrl.cmmc_level}</span>`);
  parts.push(`</div>`);

  // Practice text
  if (ctrl.practice) {
    parts.push(`<div class="blockquote">${esc(ctrl.practice)}</div>`);
  }

  // NIST mapping
  if (ctrl.nist_mapping) {
    parts.push(`<div class="nist-mapping">${esc(ctrl.nist_mapping)}</div>`);
  }

  // Assessment Objectives
  if (ctrl.assessment_objectives.length > 0) {
    parts.push(`<h4 style="font-size:13px; font-weight:600; color:#374151; margin:8px 0 4px;">Assessment Objectives</h4>`);
    parts.push(`<ol class="objectives-list">`);
    for (const ao of ctrl.assessment_objectives) {
      parts.push(`<li><strong>${esc(ao.id)}.</strong> ${esc(ao.text)}</li>`);
    }
    parts.push(`</ol>`);
  }

  // Services
  if (ctrl.primary_services.length > 0 || ctrl.secondary_services.length > 0) {
    parts.push(`<div class="services-row">`);
    if (ctrl.primary_services.length > 0) {
      parts.push(`<strong>Primary:</strong> ${esc(ctrl.primary_services.join(', '))}`);
    }
    if (ctrl.secondary_services.length > 0) {
      parts.push(
        `${ctrl.primary_services.length > 0 ? ' &nbsp;|&nbsp; ' : ''}<strong>Secondary:</strong> ${esc(ctrl.secondary_services.join(', '))}`,
      );
    }
    parts.push(`</div>`);
  }

  // Implementation Guidance by Service
  if (ctrl.implementation_by_service.length > 0) {
    parts.push(`<h4 style="font-size:13px; font-weight:600; color:#374151; margin:12px 0 6px;">Implementation Guidance</h4>`);
    for (const svc of ctrl.implementation_by_service) {
      parts.push(`<div class="service-impl">`);
      parts.push(`<div class="service-name">${esc(svc.service_name)}</div>`);
      for (const p of svc.paragraphs) {
        // Use text_with_links for clickable doc links
        const content = p.text_with_links || p.text;
        parts.push(`<div class="service-paragraph">${escWithLinks(content)}</div>`);
      }
      parts.push(`</div>`);
    }
  }

  // GCC High Customer Responsibilities
  if (ctrl.gcch_responsibilities.length > 0) {
    parts.push(`<div class="gcch-callout">`);
    parts.push(`<div class="callout-title">GCC High Customer Responsibilities</div>`);
    parts.push(`<ul>`);
    for (const r of ctrl.gcch_responsibilities) {
      const content = r.text_with_links || r.text;
      parts.push(`<li>${escWithLinks(content)}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  // Evidence Requirements
  const ev = ctrl.evidence;
  if (ev.assessor_methods.length > 0 || ev.archetypes.length > 0) {
    parts.push(`<div class="evidence-section">`);
    parts.push(`<h4>Evidence Requirements</h4>`);

    if (ev.assessor_methods.length > 0) {
      parts.push(
        `<div class="assessor-methods"><strong>Assessor methods:</strong> ${esc(ev.assessor_methods.join(', '))}</div>`,
      );
    }

    for (const arch of ev.archetypes) {
      parts.push(`<div class="archetype-card">`);
      parts.push(`<div class="archetype-name">${esc(arch.name)}</div>`);
      if (arch.description) {
        parts.push(`<div class="archetype-desc">${esc(arch.description)}</div>`);
      }
      if (arch.strength_examples.length > 0) {
        parts.push(`<div class="strength-examples">`);
        parts.push(`<strong>Evidence quality tiers:</strong>`);
        for (const ex of arch.strength_examples) {
          const cls = STRENGTH_CLASS[ex.strength] || 'strength-adequate';
          const label = ex.strength.charAt(0).toUpperCase() + ex.strength.slice(1);
          parts.push(
            `<div class="strength-row"><span class="strength-badge ${cls}">${esc(label)}</span> <span>${esc(ex.description)}</span></div>`,
          );
        }
        parts.push(`</div>`);
      }
      if (arch.acceptable_forms.length > 0) {
        parts.push(
          `<div class="archetype-forms"><strong>Acceptable forms:</strong> ${esc(arch.acceptable_forms.join('; '))}</div>`,
        );
      }
      if (arch.collection_notes) {
        parts.push(
          `<div class="archetype-notes"><strong>Collection:</strong> ${esc(arch.collection_notes)}</div>`,
        );
      }
      parts.push(`</div>`);
    }

    if (ev.anti_patterns.length > 0) {
      parts.push(`<div class="anti-patterns">`);
      parts.push(`<strong>Anti-patterns to avoid:</strong>`);
      parts.push(`<ul>`);
      for (const ap of ev.anti_patterns) {
        parts.push(`<li>${esc(ap)}</li>`);
      }
      parts.push(`</ul></div>`);
    }

    parts.push(`</div>`);
  }

  parts.push(`</div>`);
  return parts.join('\n');
}

function renderFooter(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `
<div class="footer">
  <p>Generated by CES Mission Planning Tool on ${esc(date)}</p>
  <p>Microsoft Tech Ref Implementation Guide &mdash; All CMMC L2 Controls</p>
</div>`;
}
