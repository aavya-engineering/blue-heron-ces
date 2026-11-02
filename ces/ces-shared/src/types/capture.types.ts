// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export interface StampCaptureSubCommand {
  subId: string;
  engine: string;
  status: 'pass' | 'fail' | 'skip';
  commandExecuted?: string;
  getCommandExecuted?: string;
  preState?: unknown;
  postState?: unknown;
  evidenceOutputs?: string[];
  captures?: Record<string, string>;
}

export interface StampCaptureTask {
  taskId: string;
  label: string;
  controlIds: string[];
  status: 'pass' | 'fail' | 'skip';
  engine: string;
  subCommands: StampCaptureSubCommand[];
}

export interface StampCaptureEvent {
  eventId: string;
  planId: string;
  tenantId: string;
  executedAt: string;
  executedBy: string;
  dryRun: boolean;
  resolvedVariables: Record<string, string>;
  tasks: StampCaptureTask[];
}

export interface StampCaptureResult {
  accepted: boolean;
  runId: string;
  artifactsWritten: number;
  errors: string[];
}
