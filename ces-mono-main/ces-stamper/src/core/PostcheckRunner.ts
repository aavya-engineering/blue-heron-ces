// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as https from 'https';
import { Check } from '../types/schema.types.js';
import { StateManager } from '../state/StateManager.js';
import { EvidenceCollector } from '../evidence/EvidenceCollector.js';
import { StamperConfig } from '../config/StamperConfig.js';

export interface CheckResult {
  check_id: string;
  passed: boolean;
  actual?: string;
  error?: string;
  dry_run?: boolean;
  skipped?: boolean;
}

export class PostcheckRunner {
  private stateManager: StateManager;
  private evidenceCollector: EvidenceCollector;
  private config?: StamperConfig;

  constructor(stateManager: StateManager, evidenceCollector: EvidenceCollector, config?: StamperConfig) {
    this.stateManager = stateManager;
    this.evidenceCollector = evidenceCollector;
    this.config = config;
  }

  async runPostchecks(
    postchecks: Check[],
    planId: string,
    dryRun: boolean
  ): Promise<{
    passed: boolean;
    results: CheckResult[];
  }> {
    const results: CheckResult[] = [];

    for (const check of postchecks) {
      const result = await this.runCheck(check, planId, dryRun);
      results.push(result);
    }

    const passed = results.every(r => r.passed);

    return {
      passed,
      results
    };
  }

  // Phase 6.1: Replace keyword dispatch with check.method switch.
  public async runCheck(check: Check, planId: string, dryRun: boolean): Promise<CheckResult> {
    switch (check.method) {
      case 'api_query':
        return this.runApiQuery(check, dryRun);
      case 'config_export':
        return this.runConfigExport(check, planId, dryRun);
      case 'log_query':
        return this.runLogQuery(check, dryRun);
      case 'manual':
        return this.runManualGate(check);
      default:
        return {
          check_id: check.id,
          passed: false,
          error: `Unknown method: ${(check as Check).method}`
        };
    }
  }

  // Phase 6.2: runApiQuery issues a GET against the Graph endpoint.
  // In dry-run, returns a skipped stub — not a fabricated pass.
  private async runApiQuery(check: Check, dryRun: boolean): Promise<CheckResult> {
    if (dryRun) {
      return {
        check_id: check.id,
        passed: true,
        dry_run: true,
        skipped: true,
        actual: '[dry-run] api_query postcheck skipped'
      };
    }

    const graphBase = this.config?.graphEndpoint ?? 'https://graph.microsoft.us';
    const target = check.target ?? '/v1.0/organization';
    const url = `${graphBase}${target}`;

    try {
      const responseBody = await this.httpGet(url);
      const response = JSON.parse(responseBody) as Record<string, unknown>;

      // Compare expected_field if specified
      if (check.expected_field) {
        const fieldValue = response[check.expected_field];
        const actual = String(fieldValue ?? '');
        const passed = actual === check.expected;
        return {
          check_id: check.id,
          passed,
          actual,
          error: passed ? undefined : check.on_fail
        };
      }

      // Default: treat a 200 OK with a body as passing
      return {
        check_id: check.id,
        passed: true,
        actual: `GET ${url} returned OK`
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (check.on_fail === 'halt') {
        throw new Error(`Postcheck ${check.id} failed: ${errorMsg}`);
      }
      return {
        check_id: check.id,
        passed: false,
        error: errorMsg
      };
    }
  }

  private runConfigExport(check: Check, planId: string, dryRun: boolean): CheckResult {
    if (dryRun) {
      return {
        check_id: check.id,
        passed: true,
        dry_run: true,
        skipped: true,
        actual: '[dry-run] config_export postcheck skipped'
      };
    }

    const artifacts = this.evidenceCollector.getPlanEvidence(planId);

    if (artifacts.length === 0) {
      return {
        check_id: check.id,
        passed: false,
        actual: 'No evidence artifacts collected',
        error: 'Expected evidence artifacts but none were collected'
      };
    }

    return {
      check_id: check.id,
      passed: true,
      actual: `${artifacts.length} evidence artifact(s) collected`
    };
  }

  private runLogQuery(check: Check, dryRun: boolean): CheckResult {
    if (dryRun) {
      return {
        check_id: check.id,
        passed: true,
        dry_run: true,
        skipped: true,
        actual: '[dry-run] log_query postcheck skipped'
      };
    }

    // Verify task completion as a proxy for log query in MVP
    const summary = this.stateManager.getSummary();
    const passed = summary.failed === 0;

    return {
      check_id: check.id,
      passed,
      actual: passed
        ? `All ${summary.total} tasks completed successfully`
        : `${summary.failed} task(s) failed`,
      error: passed ? undefined : check.on_fail
    };
  }

  private runManualGate(check: Check): CheckResult {
    // Manual review postchecks always require human review.
    // In all modes (including dry-run), we cannot fabricate a pass.
    return {
      check_id: check.id,
      passed: false,
      actual: 'Manual review required — human review pending',
      error: check.on_fail
    };
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }).on('error', reject);
    });
  }
}
