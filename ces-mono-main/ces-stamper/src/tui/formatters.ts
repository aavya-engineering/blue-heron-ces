// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import chalk from 'chalk';
import { ExeTask } from '../types/schema.types.js';
import { ExecutionReport } from '../core/StamperEngine.js';

export function buildTaskTitle(task: ExeTask): string {
  const stepTitle = (task.action.args['_step_title'] as string | undefined) ?? task.type;
  const controls = task.controls.join(', ');
  return chalk.cyan('[' + task.id + ']') + ' ' + chalk.white(controls) + ' | ' + stepTitle + chalk.gray(' (' + task.action.engine + ')');
}

export function buildPromptMessage(task: ExeTask): string {
  const stepTitle = (task.action.args['_step_title'] as string | undefined) ?? task.type;
  const commandPreview = task.action.command.length > 120
    ? task.action.command.substring(0, 117) + '...'
    : task.action.command;
  const verificationSteps = task.action.args['_verification_steps'] as string[] | undefined;

  const lines = [
    '\u2500'.repeat(60),
    `Task:     ${chalk.cyan('[' + task.id + ']')} ${stepTitle}`,
    `Control:  ${chalk.white(task.controls.join(', '))}`,
    `Type:     ${task.type}`,
    `Engine:   ${task.action.engine}`,
    `Priority: ${task.priority}`,
    `Command:  ${commandPreview}`,
  ];

  if (verificationSteps && verificationSteps.length > 0) {
    lines.push(`Verify:   ${verificationSteps[0]}`);
    for (let i = 1; i < verificationSteps.length; i++) {
      lines.push(`          ${verificationSteps[i]}`);
    }
  }

  if (task.inputs && task.inputs.length > 0) {
    lines.push(`Inputs:   ${task.inputs[0]}`);
    for (let i = 1; i < Math.min(task.inputs.length, 3); i++) {
      lines.push(`          ${task.inputs[i]}`);
    }
  }

  lines.push('\u2500'.repeat(60));
  lines.push('Proceed with this task?');

  return lines.join('\n');
}

export function printSummaryTable(report: ExecutionReport): void {
  const { summary, status, duration_ms } = report;
  const durationSec = (duration_ms / 1000).toFixed(2);

  let statusLabel: string;
  if (status === 'completed') {
    statusLabel = chalk.green('completed');
  } else if (status === 'failed') {
    statusLabel = chalk.red('failed');
  } else {
    statusLabel = chalk.yellow('partial');
  }

  console.log('');
  console.log('\u2500'.repeat(50));
  console.log('  Execution Summary');
  console.log('\u2500'.repeat(50));
  console.log(`  ${chalk.green('PASS')}      ${summary.completed}`);
  console.log(`  ${chalk.blue('ACCOM')}     ${summary.accomplished}`);
  console.log(`  ${chalk.red('FAIL')}      ${summary.failed}`);
  console.log(`  ${chalk.yellow('SKIP')}      ${summary.skipped}`);
  console.log(`  Total     ${summary.total_tasks}`);
  console.log(`  Status    ${statusLabel}`);
  console.log(`  Duration  ${durationSec}s`);
  console.log('\u2500'.repeat(50));
  console.log('');
}
