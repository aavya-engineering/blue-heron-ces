// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Registry entry form rules, ported from ces-stamper/public/registry-editor.html
// (renderRegistryForm and collectRegistryFormData).

export type RegistryType = 'm365' | 'infra';

export interface RegistryEntry {
  entry_id: string;
  control_ids?: string[];
  label?: string;
  engine?: string;
  get_command?: string;
  set_command?: string;
  idempotency?: string;
  variables_required?: string[];
  variables_runtime?: string[];
  captures?: unknown;
  layer_hint?: number;
  sequence_hint?: number;
  manual_only?: boolean;
  on_failure?: string;
  evidence_commands?: string[];
  verification?: unknown;
  notes?: string;
  [key: string]: unknown;
}

export const REGISTRY_ENGINES = ['mgraph', 'exchange', 'ipps', 'az', 'spo', 'teams', 'cli'] as const;
export const REGISTRY_IDEMPOTENCY = ['get-then-set', 'unsafe_requires_gate', 'skip'] as const;
export const REGISTRY_ON_FAILURE = ['abort_step', 'warn_continue', 'retry_once'] as const;

/** Form state: text fields as strings, as the legacy form holds them. */
export interface RegistryDraft {
  entry_id: string;
  control_ids: string;
  label: string;
  engine: string;
  get_command: string;
  set_command: string;
  idempotency: string;
  variables_required: string;
  variables_runtime: string;
  captures: string;
  layer_hint: string;
  sequence_hint: string;
  manual_only: boolean;
  on_failure: string;
  evidence_commands: string;
  verification: string;
  notes: string;
}

/** A value outside a legacy <select>'s options shows (and saves) as the first option. */
function option(value: string | undefined, options: readonly string[]): string {
  return value && options.includes(value) ? value : options[0];
}

export function entryToDraft(entry: RegistryEntry): RegistryDraft {
  return {
    entry_id: entry.entry_id,
    control_ids: (entry.control_ids || []).join(', '),
    label: entry.label || '',
    engine: option(entry.engine, REGISTRY_ENGINES),
    get_command: entry.get_command || '',
    set_command: entry.set_command || '',
    idempotency: option(entry.idempotency, REGISTRY_IDEMPOTENCY),
    variables_required: (entry.variables_required || []).join(', '),
    variables_runtime: (entry.variables_runtime || []).join(', '),
    captures: JSON.stringify(entry.captures || [], null, 2),
    layer_hint: String(entry.layer_hint || 0),
    sequence_hint: String(entry.sequence_hint || 0),
    manual_only: !!entry.manual_only,
    on_failure: option(entry.on_failure, REGISTRY_ON_FAILURE),
    evidence_commands: (entry.evidence_commands || []).join('\n'),
    verification: JSON.stringify(entry.verification || {}, null, 2),
    notes: entry.notes || '',
  };
}

function list(text: string, separator: string): string[] {
  return text
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s);
}

export type CollectResult = { entry: RegistryEntry } | { error: string };

/** Legacy collectRegistryFormData: same keys, same order, same undefined-for-empty rules, same JSON errors. */
export function collectRegistryEntry(d: RegistryDraft): CollectResult {
  const entry: RegistryEntry = { entry_id: d.entry_id.trim() };
  const controlIds = d.control_ids.trim();
  entry.control_ids = controlIds ? list(controlIds, ',') : [];
  entry.label = d.label.trim();
  entry.engine = d.engine;
  entry.get_command = d.get_command.trim() || undefined;
  entry.set_command = d.set_command.trim() || undefined;
  entry.idempotency = d.idempotency;
  const req = d.variables_required.trim();
  entry.variables_required = req ? list(req, ',') : undefined;
  const rt = d.variables_runtime.trim();
  entry.variables_runtime = rt ? list(rt, ',') : undefined;
  const captures = d.captures.trim();
  if (captures) {
    try {
      entry.captures = JSON.parse(captures);
    } catch {
      return { error: 'Invalid JSON in captures field' };
    }
  } else {
    entry.captures = undefined;
  }
  const layer = parseInt(d.layer_hint, 10);
  entry.layer_hint = Number.isNaN(layer) ? undefined : layer;
  const seq = parseInt(d.sequence_hint, 10);
  entry.sequence_hint = Number.isNaN(seq) ? undefined : seq;
  entry.manual_only = d.manual_only || undefined;
  entry.on_failure = d.on_failure || undefined;
  const evid = d.evidence_commands.trim();
  entry.evidence_commands = evid ? list(evid, '\n') : undefined;
  const verification = d.verification.trim();
  if (verification) {
    try {
      entry.verification = JSON.parse(verification);
    } catch {
      return { error: 'Invalid JSON in verification field' };
    }
  } else {
    entry.verification = undefined;
  }
  entry.notes = d.notes.trim() || undefined;
  return { entry };
}

/** Body of POST /api/registry/resolve's answer, as the screen passes it back. */
export interface CommandResolution {
  resolved: string;
  unresolved?: readonly string[];
}

/** Legacy resolve box text. */
export function resolveBoxText(which: 'get' | 'set', result: CommandResolution): string {
  let out = `# ${which.toUpperCase()} Command (Resolved)\n\n${result.resolved}`;
  if (result.unresolved && result.unresolved.length > 0) {
    out += '\n\n# Unresolved Variables:\n';
    for (const name of result.unresolved) out += `- {${name}}\n`;
  }
  return out;
}
