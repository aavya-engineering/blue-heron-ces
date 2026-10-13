// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

/**
 * backlog-S5 (BACKLOG.md § S5): deterministic fault injection at the sim's
 * HTTP transport layer. One mechanism covers every consumer surface —
 * POST /resolve (the fake PowerShell modules) and the /v1.0|/beta Graph
 * REST facade both consult the injector before resolution.
 *
 * Determinism contract: a rule faults its first `times` MATCHING calls,
 * then passes through (times: 'always' never passes). Counters are
 * per-rule, in call order — never random. Replacing the rule set (POST
 * /_faults, or a fresh serve) resets all counters.
 *
 * Configured via either knob:
 *  - scenario JSON `faultInjection: FaultRule[]` -> persisted to
 *    `<tenantRoot>/faults.json` by ScenarioEngine, auto-loaded by serve
 *  - `POST /_faults` on a running server (body: FaultRule[]; [] clears)
 */

export type FaultKind = 'throttle' | 'transient' | 'malformed';

export interface FaultRule {
  /**
   * What to fault: an exact cmdlet name (case-insensitive, e.g.
   * "Get-MgUser") or a URI path prefix matched against the normalized
   * request path (e.g. "/v1.0/identity/conditionalAccess/policies").
   */
  target: string;
  kind: FaultKind;
  /** Fault the first N matching calls, then pass through. Default 1. 'always' never passes. */
  times?: number | 'always';
}

export interface FaultDirective {
  kind: FaultKind;
  target: string;
}

export interface FaultCall {
  cmdlet?: string;
  uri?: string;
}

function normalizeUriPath(uri: string): string {
  return uri.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
}

export function validateFaultRules(value: unknown): FaultRule[] {
  if (!Array.isArray(value)) {
    throw new Error('FaultInjector: rules must be an array of {target, kind, times?}');
  }
  for (const rule of value as Partial<FaultRule>[]) {
    if (!rule || typeof rule.target !== 'string' || rule.target.length === 0) {
      throw new Error(`FaultInjector: rule missing "target": ${JSON.stringify(rule)}`);
    }
    if (rule.kind !== 'throttle' && rule.kind !== 'transient' && rule.kind !== 'malformed') {
      throw new Error(`FaultInjector: rule "${rule.target}" has unknown kind "${String(rule.kind)}"`);
    }
    if (rule.times !== undefined && rule.times !== 'always' && (typeof rule.times !== 'number' || rule.times < 1)) {
      throw new Error(`FaultInjector: rule "${rule.target}" times must be a positive number or 'always'`);
    }
  }
  return value as FaultRule[];
}

export class FaultInjector {
  private rules: FaultRule[] = [];
  private fired: number[] = [];

  setRules(rules: FaultRule[]): void {
    this.rules = validateFaultRules(rules);
    this.fired = this.rules.map(() => 0);
  }

  getRules(): FaultRule[] {
    return [...this.rules];
  }

  /** Consult (and advance) the table for one call. Returns a directive iff this call must fault. */
  check(call: FaultCall): FaultDirective | undefined {
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if (!this.matches(rule, call)) continue;
      const budget = rule.times ?? 1;
      if (budget !== 'always' && this.fired[i] >= budget) continue;
      this.fired[i]++;
      return { kind: rule.kind, target: rule.target };
    }
    return undefined;
  }

  private matches(rule: FaultRule, call: FaultCall): boolean {
    if (call.cmdlet) {
      return rule.target.toLowerCase() === call.cmdlet.toLowerCase();
    }
    if (call.uri) {
      return normalizeUriPath(call.uri).toLowerCase().startsWith(rule.target.toLowerCase());
    }
    return false;
  }
}

/** HTTP response bodies per fault kind (Graph-shaped errors; malformed = unparseable on purpose). */
export function faultHttpResponse(directive: FaultDirective): {
  status: number;
  headers: Record<string, string>;
  body: string;
} {
  switch (directive.kind) {
    case 'throttle':
      return {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
        body: JSON.stringify({
          error: { code: 'TooManyRequests', message: `stacksim fault injection: throttled (${directive.target})` },
        }),
      };
    case 'transient':
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: 'ServiceUnavailable',
            message: `stacksim fault injection: transient failure (${directive.target})`,
          },
        }),
      };
    case 'malformed':
      // 200 with a deliberately truncated JSON body — parsers must choke.
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: `{"value": [{"id": "stacksim-malformed-${directive.target}", "truncated`,
      };
  }
}
