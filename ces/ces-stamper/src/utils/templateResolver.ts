// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { psContext, renderPs, psLiteralBody, psDoubleQuotedSafe, psToken, type PsPlaceholder, type PsTokenKind } from 'ces-shared/security';
import { SECRET_VARIABLE_NAMES } from 'ces-shared/types/mission-plan';
import { secretSentinel, isSecretSentinel } from '../core/secretSentinel.js';

/**
 * Template variable resolver
 * Replaces {variableName} placeholders with values from a variables object.
 * SEC-2: every value goes through the ces-shared PowerShell guard for its placeholder context.
 */

/** SEC-2: token kind for a bare (unquoted) placeholder, by variable name; others are 'generic'. */
export const PS_TOKEN_KINDS: Record<string, PsTokenKind> = {
  operatorUPN: 'upn',
  breakGlassUPN: 'upn',
  approverUPN: 'upn',
};

/**
 * SP-1 (R1, SECRETS-PLAN.md): a secret-class variable (ces-shared SECRET_VARIABLE_NAMES) is only
 * ever taken by reference. A plain value for one never reaches a rendered command: these helpers
 * swap it for its sentinel, so every rendered copy (display, stream, evidence) carries
 * `<<CES_SECRET:name>>`, and only PowerShellAdapter's overlay can supply a value at the spawn boundary.
 */
export function isSecretClassVariable(name: string): boolean {
  return (SECRET_VARIABLE_NAMES as readonly string[]).includes(name);
}

/** SP-1: the plain (non-sentinel, non-empty) string values held by secret-class variables. */
export function secretClassLiterals(variables: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of SECRET_VARIABLE_NAMES) {
    const v = variables?.[name];
    if (typeof v === 'string' && v !== '' && !isSecretSentinel(v)) out[name] = v;
  }
  return out;
}

/** SP-1: a copy of `variables` with every secret-class plain value replaced by its sentinel. */
export function maskSecretClassVariables<T extends Record<string, any>>(variables: T): T {
  const literals = secretClassLiterals(variables);
  if (Object.keys(literals).length === 0) return variables;
  const out: Record<string, any> = { ...variables };
  for (const name of Object.keys(literals)) out[name] = secretSentinel(name);
  return out as T;
}

/** SEC-2: the renderPs guard for one placeholder (single / here-single / double / bare). */
export function guardPsValue(ph: PsPlaceholder, value: unknown): string {
  if (ph.context === 'single') {
    if (ph.quote === 'here-single') {
      psLiteralBody(value, ph.name); // line-break / NUL check only; nothing is escaped in @'...'@
      return String(value);
    }
    return psLiteralBody(value, ph.name);
  }
  if (ph.context === 'double') return psDoubleQuotedSafe(value, ph.name);
  return psToken(value, PS_TOKEN_KINDS[ph.name] ?? 'generic', ph.name);
}

/**
 * SEC-2: substitute only the `${name}` placeholders (the CLI / API adapters' form), each through
 * `encode` when given, else the PowerShell guard for its context. Single pass by lexed position.
 */
export function renderDollarPlaceholders(
  template: string,
  variables: Record<string, any>,
  encode?: (value: unknown, ph: PsPlaceholder) => string,
): string {
  variables = maskSecretClassVariables(variables); // SP-1: no secret-class literal is rendered
  let out = '';
  let last = 0;
  for (const ph of psContext(template)) {
    if (ph.form !== 'dollar' || !Object.prototype.hasOwnProperty.call(variables, ph.name)) continue;
    const value = variables[ph.name];
    out += template.slice(last, ph.start) + (encode ? encode(value, ph) : guardPsValue(ph, value));
    last = ph.end;
  }
  return out + template.slice(last);
}

export interface TemplateResolverOptions {
  /**
   * If true, throws an error when a variable is referenced but not found.
   * If false (default), leaves unresolved placeholders as-is.
   */
  strict?: boolean;
}

/**
 * Resolves {variableName} placeholders in a template string.
 *
 * @param template - String containing {variableName} placeholders
 * @param variables - Record mapping variable names to values
 * @param options - Configuration options (strict mode, etc.)
 * @returns Resolved string with placeholders replaced
 *
 * @example
 * resolveTemplate('Hello {name}', { name: 'World' }) // => 'Hello World'
 * resolveTemplate('{count} items', { count: 42 }) // => '42 items'
 * resolveTemplate('{missing}', {}, { strict: true }) // => throws Error
 */
export function resolveTemplate(
  template: string,
  variables: Record<string, any>,
  options: TemplateResolverOptions = {}
): string {
  // SEC-2: placeholders are the ones the ces-shared lexer reports (`{name}` not preceded by `$` or
  // a word character, and `${name}`); each value goes through renderPs's guard for its context.
  // SP-1: a secret-class plain value renders as its sentinel, never as itself.
  variables = maskSecretClassVariables(variables);
  const scalars: Record<string, string | number | boolean> = {};
  for (const ph of psContext(template)) {
    if (ph.name in variables) {
      const value = variables[ph.name];
      // Only resolve scalar values (string, number, boolean); non-scalars are left unresolved
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        scalars[ph.name] = value;
      }
    } else if (options.strict) {
      throw new Error(`Missing variable: ${ph.name}`);
    }
  }
  return renderPs(template, scalars, { kinds: PS_TOKEN_KINDS });
}
