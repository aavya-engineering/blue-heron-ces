// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { EvalRule, EvalResult } from './eval.types.js';

export interface CheckDefinition {
  checkId: string;
  controlIds: string[];
  label: string;
  engine: string;
  getCommand: string;
  evidenceCommands: string[];
  variablesRequired: string[];
  variablesRuntime: string[];
  evalRules: EvalRule[];
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface DriftFinding {
  findingId: string;
  detectedAt: string;
  runId: string;
  tenantId: string;
  checkId: string;
  controlIds: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  layer: 'setting' | 'control';
  settingPath: string;
  beforeValue: unknown;
  afterValue: unknown;
  evalResult?: EvalResult;
  status: 'open' | 'acknowledged' | 'remediated' | 'false_positive';
  notes?: string;
  resolvedAt?: string;
}

export interface DriftRun {
  runId: string;
  tenantId: string;
  startedAt: string;
  completedAt: string;
  runType: 'scheduled_poll' | 'nightly_reconciliation' | 'manual' | 'stamp_triggered';
  checksExecuted: number;
  checksCompliant: number;
  checksNonCompliant: number;
  findingsNew: number;
  findingsTotal: number;
  artifactsWritten: number;
  evidenceCommandsRun: number;
  status: 'success' | 'partial' | 'failed';
  errors: string[];
}
