// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import type { ControlAssessment, CmmcControl } from 'ces-shared/types/controls';
import type { SignalResult } from 'ces-shared/types/signal';
import { SIGNAL_REGISTRY, rowsOf } from './SignalRegistry.js';
import type { ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import { DirectiveNarrativeBuilder } from './DirectiveNarrativeBuilder.js';
import { loadNegationLexicon } from '../ssp/NarrativeNegationGuard.js';

/** W3.1: the evidence line when no Stamper evidence record or store record names the control. */
export const NO_STAMPER_EVIDENCE = 'No Stamper evidence record for this control in the current run';

let flagSignalCache: Map<string, Set<string>> | undefined;

/**
 * W5: template context key -> the signal ids whose transform can set it, found by running every
 * SIGNAL_REGISTRY transform on sample reads (a bare array, a Graph page and an object).
 */
export function flagSignals(): Map<string, Set<string>> {
  if (flagSignalCache) return flagSignalCache;
  const map = new Map<string, Set<string>>();
  const samples: unknown[] = [[{}], { value: [{}] }, { id: 'sample' }];
  for (const entry of SIGNAL_REGISTRY) {
    for (const rawData of samples) {
      let keys: string[] = [];
      try { keys = Object.keys(entry.transform({ signalId: entry.signalId, status: 'success', rawData } as SignalResult)); } catch { continue; }
      for (const k of keys) {
        if (!map.has(k)) map.set(k, new Set());
        map.get(k)!.add(entry.signalId);
      }
    }
  }
  flagSignalCache = map;
  return map;
}

/** W5: removes, in place, the `{{else}}` branch of each `{{#if <flag>}}` block (not an `{{else if}}` chain) and the body of each `{{#unless <flag>}}` block whose flag is unread. */
function dropUnreadInverses(node: unknown, unread: (flag: string) => boolean, dropped: string[]): void {
  const n = node as { type?: string; body?: unknown[]; path?: { original?: string }; params?: Array<{ type?: string; original?: string }>; program?: unknown; inverse?: { chained?: boolean } };
  if (!n || typeof n !== 'object') return;
  for (const child of n.body ?? []) dropUnreadInverses(child, unread, dropped);
  if (n.type !== 'BlockStatement') return;
  const helper = n.path?.original;
  const flag = (helper === 'if' || helper === 'unless') && n.params?.[0]?.type === 'PathExpression' ? n.params[0].original : undefined;
  if (flag && helper === 'if' && n.inverse && !n.inverse.chained && unread(flag)) {
    n.inverse = undefined;
    dropped.push(flag);
  }
  // `{{#unless <flag>}}…{{/unless}}` states an absence too: its body is dropped when the flag is unread.
  const program = n.program as { body?: unknown[] } | undefined;
  if (flag && helper === 'unless' && program?.body?.length && unread(flag)) {
    program.body = [];
    dropped.push(flag);
  }
  dropUnreadInverses(n.program, unread, dropped);
  dropUnreadInverses(n.inverse, unread, dropped);
}

function hitsLexicon(text: string): boolean {
  return loadNegationLexicon().some(p => new RegExp((/^[A-Za-z0-9]/.test(p) ? '(?<![A-Za-z0-9])' : '') + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text));
}

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../data/snippet-templates'
);

/**
 * Generates control implementation narratives using Handlebars templates.
 * Falls back to a simple text narrative if no template exists for the control.
 */
export class SnippetTemplateEngine {
  private readonly templateCache = new Map<string, HandlebarsTemplateDelegate>();
  private readonly templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir ?? TEMPLATES_DIR;
    if (!fs.existsSync(this.templatesDir)) throw new Error(`Templates directory not found: ${this.templatesDir}`);

    // Register formatting helpers
    Handlebars.registerHelper('formatRetention', (days: number) => `${days} days`);
    Handlebars.registerHelper('formatDate', (iso: string) => {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    });
    Handlebars.registerHelper('policyLink', (title: string, policyPath: string) => `[${title}](${policyPath})`);
  }

  renderControlNarrative(
    controlId: string,
    assessment: ControlAssessment,
    signals: SignalResult[],
    variables?: Record<string, string>,
    registryNotes?: string[],
    infraResources?: Array<{ resourceType: string; name: string; properties: Record<string, unknown> }>,
    evidenceArtifacts?: Array<{ path: string; source: string }>,
    /** W3.1: the control's evidence line drawn from its `evidenceDetails` (absent: none recorded). */
    evidenceLine?: string,
  ): string {
    const template = this.loadTemplate(controlId);
    if (!template) {
      return this.fallbackNarrative(controlId, assessment, evidenceLine, signals);
    }

    const context = this.buildContext(controlId, assessment, signals, variables, registryNotes, infraResources, evidenceArtifacts, evidenceLine);
    if (assessment.status === 'met') {
      // W5 (SC-1 row 1): a met control's narrative never asserts the absence of a mechanism whose read
      // is not attached to this control. The `{{else}}` branch of an `{{#if <flag>}}` block whose flag only
      // a signal not read here can set is dropped; a read that ran and came back empty keeps its branch.
      const read = new Set(signals.filter(s => s.status === 'success' && s.rawData).map(s => s.signalId));
      const variant = this.loadMetTemplate(controlId, flag => {
        const from = flagSignals().get(flag);
        return from !== undefined && ![...from].some(id => read.has(id));
      });
      if (variant) return variant(context);
    }
    return template(context);
  }

  /** W5: the control's template with the `{{else}}` branches of unread-signal flags removed (cached per flag set). */
  private loadMetTemplate(controlId: string, unread: (flag: string) => boolean): HandlebarsTemplateDelegate | null {
    const templatePath = path.join(this.templatesDir, `${controlId}.hbs`);
    if (!fs.existsSync(templatePath)) return null;
    const ast = Handlebars.parse(fs.readFileSync(templatePath, 'utf-8'));
    const dropped: string[] = [];
    dropUnreadInverses(ast, unread, dropped);
    if (dropped.length === 0) return null;
    const key = `${controlId}|met|${[...new Set(dropped)].sort().join(',')}`;
    if (!this.templateCache.has(key)) this.templateCache.set(key, Handlebars.compile(ast));
    return this.templateCache.get(key)!;
  }

  private loadTemplate(controlId: string): HandlebarsTemplateDelegate | null {
    if (this.templateCache.has(controlId)) {
      return this.templateCache.get(controlId)!;
    }

    const templatePath = path.join(this.templatesDir, `${controlId}.hbs`);
    if (!fs.existsSync(templatePath)) {
      return null;
    }

    const source = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(source);
    this.templateCache.set(controlId, compiled);
    return compiled;
  }

  private buildContext(
    controlId: string,
    assessment: ControlAssessment,
    signals: SignalResult[],
    variables?: Record<string, string>,
    registryNotes?: string[],
    infraResources?: Array<{ resourceType: string; name: string; properties: Record<string, unknown> }>,
    evidenceArtifacts?: Array<{ path: string; source: string }>,
    evidenceLine?: string,
  ): Record<string, unknown> {
    const context: Record<string, unknown> = {
      controlId,
      status: assessment.status,
      // PH-5 (V111, FIN-11): templates state their mechanism as fact only on a met control; otherwise as the requirement.
      statusMet: assessment.status === 'met',
      evidenceArtifactUrl: assessment.evidenceArtifactIds[0] ?? evidenceLine ?? NO_STAMPER_EVIDENCE,
    };

    // Build signal-specific context via SignalRegistry
    for (const signal of signals) {
      if (signal.status !== 'success' || !signal.rawData) continue;

      const entry = SIGNAL_REGISTRY.find(e => e.signalId === signal.signalId);
      if (entry) {
        Object.assign(context, entry.transform(signal));
      }
    }

    // Merge ODP variables for template access (e.g., {{tenantName}}, {{primaryDomain}})
    // Wrap in variables object for template access as {{variables.key}}
    if (variables) {
      context.variables = variables;
      Object.assign(context, variables);
    }

    // Merge registry notes as implementationGuidance for template access
    if (registryNotes && registryNotes.length > 0) {
      context.implementationGuidance = registryNotes.join('\n\n');
    }

    // Add infrastructure resources for template iteration
    if (infraResources && infraResources.length > 0) {
      context.infraResources = infraResources;
    }

    // Add formatted evidence artifacts with human-readable labels
    if (evidenceArtifacts && evidenceArtifacts.length > 0) {
      context.evidenceArtifacts = evidenceArtifacts.map(e => ({
        label: this.formatEvidenceLabel(e.path, e.source),
        path: e.path,
        source: e.source,
      }));
    }

    return context;
  }

  private fallbackNarrative(controlId: string, assessment: ControlAssessment, evidenceLine?: string, signals: SignalResult[] = []): string {
    const evidence = `**Evidence:** ${assessment.evidenceArtifactIds.join(', ') || evidenceLine || NO_STAMPER_EVIDENCE}`;
    const body = assessment.implementation_narrative ?? 'Implementation details not available.';
    // W5 (SC-1 row 1): a met control whose evaluator text negates the mechanism (the evaluator gave no
    // verdict; another tier decided met) states the deciding basis and the reads instead of that text.
    if (assessment.status === 'met' && hitsLexicon(body)) {
      const rationale = (assessment as ControlAssessment & { statusRationale?: string }).statusRationale;
      const parts = [`## Control ${controlId}`, `**Implementation Status:** met`];
      if (rationale && !hitsLexicon(rationale)) parts.push(`Determination basis: ${rationale.replace(/[.\s]+$/, '')}.`);
      const reads = signals.filter(s => s.status === 'success' && s.rawData).map(s => {
        const n = rowsOf(s.rawData).length;
        return `${s.signalId} returned ${n > 0 ? `${n} object${n === 1 ? '' : 's'}` : 'an object'}${s.endpoint ? ` (${s.endpoint})` : ''}`;
      });
      if (reads.length > 0) parts.push(`Live reads for this control: ${reads.join('; ')}.`);
      parts.push('The live-read evaluator for this control gave no verdict on this run (not assessed); the met status rests on the determination basis above.');
      parts.push(evidence);
      return parts.join('\n\n');
    }
    return `## Control ${controlId}\n\n**Implementation Status:** ${assessment.status}\n\n${body}\n\n${evidence}`;
  }

  /**
   * Attempt to render a directive-specific narrative. Returns the narrative string
   * if the directive has a special template (document-absence, document-prohibition,
   * manual+platform_inherited), or null to fall through to existing template logic.
   */
  renderDirectiveNarrative(
    control: CmmcControl,
    directiveMetadata: ExtendedDirectiveMetadata
  ): string | null {
    switch (directiveMetadata.directive) {
      case 'document-absence':
        return DirectiveNarrativeBuilder.buildDocumentAbsenceNarrative(control, directiveMetadata);
      case 'document-prohibition':
        return DirectiveNarrativeBuilder.buildDocumentProhibitionNarrative(control, directiveMetadata);
      case 'manual':
        if (directiveMetadata.platform_inherited) {
          return DirectiveNarrativeBuilder.buildPlatformInheritedNarrative(control, directiveMetadata);
        }
        // Fall through to existing manual template
        return null;
      case 'implement':
      case 'validate':
      case 'skip':
        // Fall through to existing templates
        return null;
      default:
        return null;
    }
  }

  private formatEvidenceLabel(evidencePath: string, source: string): string {
    if (source === 'missionPlan') {
      return `Mission Plan artifact: ${evidencePath.split('/').pop() ?? evidencePath}`;
    } else if (source === 'infraManifest') {
      const parts = evidencePath.replace('infra://', '').split('/');
      return `${parts[0]} "${parts[1]}" - ${parts[2]}`;
    }
    return evidencePath;
  }
}
