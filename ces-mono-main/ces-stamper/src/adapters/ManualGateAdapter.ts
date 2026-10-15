// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as readline from 'readline';
import { ExeTask, ExecutionResult } from '../types/schema.types.js';
import { IEngineAdapter } from './IEngineAdapter.js';

export class ManualGateAdapter implements IEngineAdapter {
  getName(): string {
    return 'manual_gate';
  }

  async validate(_task: ExeTask): Promise<{ valid: boolean; errors: string[] }> {
    return {
      valid: true,
      errors: []
    };
  }

  async execute(
    task: ExeTask,
    _variables: Record<string, any>,
    dryRun: boolean
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    if (dryRun) {
      return {
        success: true,
        output: 'DRY RUN: Manual gate approval skipped (auto-approved)',
        stdout: '[dry-run] Manual task would be presented to operator',
        duration_ms: Date.now() - startTime
      };
    }

    try {
      console.log('\n' + '='.repeat(80));
      console.log('MANUAL TASK GATE');
      console.log('='.repeat(80));
      console.log(`Task ID: ${task.id}`);
      console.log(`Type: ${task.type}`);
      console.log(`Priority: ${task.priority}`);
      console.log(`Controls: ${task.controls.join(', ')}`);
      console.log('');
      console.log(`Description: ${task.action.command}`);
      console.log('');

      if (task.action.args.what_to_do && Array.isArray(task.action.args.what_to_do)) {
        console.log('What to do:');
        for (const step of task.action.args.what_to_do) {
          console.log(`  - ${step}`);
        }
        console.log('');
      }

      if (task.action.args.how_to_verify && Array.isArray(task.action.args.how_to_verify)) {
        console.log('How to verify:');
        for (const step of task.action.args.how_to_verify) {
          console.log(`  - ${step}`);
        }
        console.log('');
      }

      if (task.evidence_emit && task.evidence_emit.length > 0) {
        console.log('Expected evidence artifacts:');
        for (const artifact of task.evidence_emit) {
          console.log(`  - ${artifact.artifact_id} (${artifact.artifact_type})`);
        }
        console.log('');
      }

      console.log('='.repeat(80));
      console.log('');

      // Auto-approve when running headless (GUI server — no TTY on stdin)
      if (!process.stdin.isTTY) {
        return {
          success: true,
          output: { approved: true, operator: 'gui-operator', timestamp: new Date().toISOString() },
          stdout: 'Manual task auto-approved (GUI mode)',
          duration_ms: Date.now() - startTime
        };
      }

      const approval = await this.promptForApproval();

      if (approval.approved) {
        return {
          success: true,
          output: {
            approved: true,
            operator: approval.operator,
            timestamp: new Date().toISOString(),
            notes: approval.notes
          },
          stdout: `Manual task approved by ${approval.operator}`,
          duration_ms: Date.now() - startTime
        };
      } else {
        return {
          success: false,
          error: `Manual task rejected by operator: ${approval.notes || 'No reason provided'}`,
          duration_ms: Date.now() - startTime
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Manual gate failed: ${errorMsg}`,
        duration_ms: Date.now() - startTime
      };
    }
  }

  private async promptForApproval(): Promise<{
    approved: boolean;
    operator: string;
    notes?: string;
  }> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer);
        });
      });
    };

    try {
      const operator = await question('Your name/ID: ');
      const decision = await question('Approve this task? (yes/no): ');
      const approved = decision.trim().toLowerCase() === 'yes' || decision.trim().toLowerCase() === 'y';

      let notes: string | undefined;
      if (!approved) {
        notes = await question('Reason for rejection (optional): ');
      } else {
        const hasNotes = await question('Add notes? (yes/no): ');
        if (hasNotes.trim().toLowerCase() === 'yes' || hasNotes.trim().toLowerCase() === 'y') {
          notes = await question('Notes: ');
        }
      }

      return {
        approved,
        operator: operator.trim() || 'unknown',
        notes: notes?.trim()
      };
    } finally {
      rl.close();
    }
  }
}
