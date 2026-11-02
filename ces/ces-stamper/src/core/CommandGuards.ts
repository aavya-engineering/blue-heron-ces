// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-01: last-line guards applied to every resolved command before it is sent.
 *
 * A leftover `{name}` token means a placeholder was never filled. PowerShell script
 * blocks (`{ $_... }`), hashtables (`@{...}`) and format strings (`{0}`) do not match
 * the pattern, so they pass untouched.
 */
const UNRESOLVED_TOKEN_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function findUnresolvedTokens(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(UNRESOLVED_TOKEN_RE)) names.add(m[1]);
  return [...names];
}

export class UnresolvedVariableError extends Error {
  readonly variables: string[];
  constructor(variables: string[]) {
    super(`blocked: unresolved variable ${variables.join(', ')}`);
    this.name = 'UnresolvedVariableError';
    this.variables = variables;
  }
}

/** Throws UnresolvedVariableError when `text` still carries a `{name}` token. */
export function assertNoUnresolvedTokens(text: string): void {
  const leftover = findUnresolvedTokens(text);
  if (leftover.length > 0) throw new UnresolvedVariableError(leftover);
}

export interface DestructivePreviewDecision {
  populationCount: number;
  targets: unknown[];
  share: number;
  maxShare: number;
  refused: boolean;
  reason: string;
  rawPreview: string;
}

/**
 * FX-01 (c): judge a destructive preview. The preview command prints JSON
 * `{"populationCount": n, "targets": [...]}`. Refuse when the output cannot be read,
 * when the SET would change every member of the population, or more than `maxShare` of it.
 */
export function evaluateDestructivePreview(stdout: string, maxShare: number): DestructivePreviewDecision {
  const refuse = (reason: string, populationCount = 0, targets: unknown[] = []): DestructivePreviewDecision => ({
    populationCount, targets, share: populationCount > 0 ? targets.length / populationCount : 0,
    maxShare, refused: true, reason, rawPreview: stdout,
  });

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return refuse('blocked: destructive preview output is not JSON');
  }
  const populationCount = Number(parsed?.populationCount);
  if (!Number.isFinite(populationCount) || populationCount < 0) {
    return refuse('blocked: destructive preview has no populationCount');
  }
  const rawTargets = parsed?.targets;
  const targets: unknown[] = rawTargets === null || rawTargets === undefined
    ? []
    : Array.isArray(rawTargets) ? rawTargets : [rawTargets];
  const share = populationCount > 0 ? targets.length / populationCount : 0;

  if (populationCount > 0 && targets.length >= populationCount) {
    return refuse(`blocked: destructive preview would change all ${populationCount} account(s)`, populationCount, targets);
  }
  if (share > maxShare) {
    return refuse(
      `blocked: destructive preview would change ${targets.length} of ${populationCount} account(s), more than ${Math.round(maxShare * 100)}%`,
      populationCount, targets,
    );
  }
  return {
    populationCount, targets, share, maxShare, refused: false,
    reason: `preview: ${targets.length} of ${populationCount} account(s) would change`,
    rawPreview: stdout,
  };
}
