// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { ExeTask, ExecutionResult } from '../types/schema.types.js';
import { IEngineAdapter } from './IEngineAdapter.js';
import { renderDollarPlaceholders } from '../utils/templateResolver.js';

export class APIAdapter implements IEngineAdapter {

  getName(): string {
    return 'api';
  }

  async validate(task: ExeTask): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!task.action.command) {
      errors.push('API endpoint is required in command field');
    }

    if (!task.action.args.method) {
      errors.push('HTTP method is required in args.method');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async execute(
    task: ExeTask,
    variables: Record<string, any>,
    dryRun: boolean
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    if (dryRun) {
      return {
        success: true,
        output: 'DRY RUN: API call skipped',
        stdout: `[dry-run] Would call API: ${task.action.args.method} ${task.action.command}`,
        duration_ms: Date.now() - startTime
      };
    }

    try {
      const endpoint = this.interpolateVariables(task.action.command, variables);
      const method = (task.action.args.method as string).toLowerCase();
      const headers = this.buildHeaders(task.action.args);
      const body = task.action.args.body;

      const requestConfig: AxiosRequestConfig = {
        method: method as any,
        url: endpoint,
        headers,
        data: body,
        timeout: 30000,
        validateStatus: () => true
      };

      const response: AxiosResponse = await axios(requestConfig);

      const success = response.status >= 200 && response.status < 300;

      return {
        success,
        output: response.data,
        stdout: JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data
        }, null, 2),
        exit_code: response.status,
        duration_ms: Date.now() - startTime,
        error: success ? undefined : `API call failed with status ${response.status}: ${response.statusText}`
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `API call failed: ${errorMsg}`,
        duration_ms: Date.now() - startTime
      };
    }
  }

  private buildHeaders(args: Record<string, any>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (args.headers && typeof args.headers === 'object') {
      Object.assign(headers, args.headers);
    }

    // Inject authorization if available in environment
    const bearerToken = process.env.API_BEARER_TOKEN;
    if (bearerToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    return headers;
  }

  private interpolateVariables(template: string, variables: Record<string, any>): string {
    // SEC-2: `${key}` placeholders only, as before. A value in the path or query (after the
    // origin) is URL-encoded; a value that forms the origin (scheme://host or a leading base URL)
    // is substituted as before.
    const origin = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/.exec(template);
    const pathStart = origin ? origin[0].length : 0;
    return renderDollarPlaceholders(template, variables, (value, ph) =>
      ph.start < pathStart || (ph.start === 0 && !origin) ? String(value) : encodeURIComponent(String(value)));
  }
}
