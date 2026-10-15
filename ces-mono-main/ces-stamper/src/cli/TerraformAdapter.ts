// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { ExeTask, ExecutionResult } from '../types/schema.types.js';
import { IEngineAdapter } from '../adapters/IEngineAdapter.js';

export class TerraformAdapter implements IEngineAdapter {
  getName(): string {
    return 'terraform';
  }

  async validate(_task: ExeTask): Promise<{ valid: boolean; errors: string[] }> {
    return {
      valid: true,
      errors: []
    };
  }

  async execute(
    _task: ExeTask,
    _variables: Record<string, any>,
    dryRun: boolean
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    if (dryRun) {
      return {
        success: true,
        output: 'DRY RUN: Terraform execution skipped',
        stdout: '[dry-run] Terraform plan would be executed (adapter Phase 4)',
        duration_ms: Date.now() - startTime
      };
    }

    return {
      success: false,
      error: 'Terraform adapter not yet implemented (Phase 4)',
      stdout: 'Terraform execution requires Phase 4 implementation',
      duration_ms: Date.now() - startTime
    };
  }
}
