// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Loads Handlebars Markdown templates and renders them with the compiled policy context.
 */

import Handlebars from 'handlebars';
import yaml from 'js-yaml';
import type { PolicyTemplateContext } from './policyContextCompiler';

export interface TemplateRegistryEntry {
  template_id: string;
  title: string;
  filename: string;
  domain: string;
  nist_controls: string[];
  required_sources: string[];
}

interface TemplateRegistry {
  version: string;
  templates: TemplateRegistryEntry[];
}

export interface RenderedPolicyDocument {
  template_id: string;
  title: string;
  markdown: string;
  completeness: number;
  domain: string;
  nist_controls: string[];
}

// Register Handlebars helpers
Handlebars.registerHelper('upper', (str: unknown) =>
  typeof str === 'string' ? str.toUpperCase() : '',
);
Handlebars.registerHelper('lower', (str: unknown) =>
  typeof str === 'string' ? str.toLowerCase() : '',
);
Handlebars.registerHelper('join', (arr: unknown, sep: unknown) =>
  Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : '',
);
Handlebars.registerHelper('ifEquals', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this);
});
Handlebars.registerHelper('ifGt', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return Number(a) > Number(b) ? options.fn(this) : options.inverse(this);
});
Handlebars.registerHelper('or', (a: unknown, b: unknown) => a || b);
Handlebars.registerHelper('default', (val: unknown, fallback: unknown) =>
  val !== undefined && val !== null && val !== '' ? val : fallback,
);
Handlebars.registerHelper('year', () => new Date().getFullYear().toString());
Handlebars.registerHelper('today', () => new Date().toISOString().slice(0, 10));
Handlebars.registerHelper('contains', function (this: unknown, arr: unknown, value: unknown, options: Handlebars.HelperOptions) {
  return Array.isArray(arr) && arr.includes(value) ? options.fn(this) : options.inverse(this);
});

/** Loads the template registry YAML from the public directory */
async function loadRegistry(): Promise<TemplateRegistry> {
  const resp = await fetch('/templates/policies/registry.yaml');
  if (!resp.ok) throw new Error(`Failed to load policy template registry: ${resp.status}`);
  const text = await resp.text();
  return yaml.load(text) as TemplateRegistry;
}

/** Loads a single template Markdown file */
async function loadTemplate(filename: string): Promise<string> {
  const resp = await fetch(`/templates/policies/${filename}`);
  if (!resp.ok) throw new Error(`Failed to load policy template ${filename}: ${resp.status}`);
  return resp.text();
}

/** Estimate completeness by looking for unresolved placeholder patterns */
function estimateCompleteness(rendered: string): number {
  // Count {{unresolved}} and [TBD] / [PLACEHOLDER] markers
  const unresolvedBraces = (rendered.match(/\{\{[^}]+\}\}/g) || []).length;
  const tbdMarkers = (rendered.match(/\[TBD\]|\[PLACEHOLDER\]|\[TODO\]/gi) || []).length;
  const totalUnresolved = unresolvedBraces + tbdMarkers;

  // Rough heuristic: each unresolved token reduces completeness
  // A typical policy has ~20 template variables
  const estimatedTotal = 20;
  const resolvedEstimate = Math.max(0, estimatedTotal - totalUnresolved);
  return Math.min(100, Math.round((resolvedEstimate / estimatedTotal) * 100));
}

/** Render all policy documents from the registry */
export async function renderAllPolicies(
  ctx: PolicyTemplateContext,
): Promise<RenderedPolicyDocument[]> {
  const registry = await loadRegistry();
  const results: RenderedPolicyDocument[] = [];

  for (const entry of registry.templates) {
    try {
      const templateSource = await loadTemplate(entry.filename);
      const compiled = Handlebars.compile(templateSource, { noEscape: true });
      const rendered = compiled(ctx);
      const completeness = estimateCompleteness(rendered);

      results.push({
        template_id: entry.template_id,
        title: entry.title,
        markdown: rendered,
        completeness,
        domain: entry.domain,
        nist_controls: entry.nist_controls,
      });
    } catch (err) {
      console.warn(`Failed to render policy template ${entry.template_id}:`, err);
      results.push({
        template_id: entry.template_id,
        title: entry.title,
        markdown: `# ${entry.title}\n\n> **Error:** Failed to render this template. ${err instanceof Error ? err.message : String(err)}`,
        completeness: 0,
        domain: entry.domain,
        nist_controls: entry.nist_controls,
      });
    }
  }

  return results;
}

/** Render a single policy by template_id */
export async function renderSinglePolicy(
  templateId: string,
  ctx: PolicyTemplateContext,
): Promise<RenderedPolicyDocument> {
  const registry = await loadRegistry();
  const entry = registry.templates.find((t) => t.template_id === templateId);
  if (!entry) throw new Error(`Template not found: ${templateId}`);

  const templateSource = await loadTemplate(entry.filename);
  const compiled = Handlebars.compile(templateSource, { noEscape: true });
  const rendered = compiled(ctx);

  return {
    template_id: entry.template_id,
    title: entry.title,
    markdown: rendered,
    completeness: estimateCompleteness(rendered),
    domain: entry.domain,
    nist_controls: entry.nist_controls,
  };
}
