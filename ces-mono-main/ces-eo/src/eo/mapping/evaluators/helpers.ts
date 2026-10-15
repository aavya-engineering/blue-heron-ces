// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SignalResult } from 'ces-shared/types/signal';

export interface ValidationResult {
  valid: boolean;
  findings: string[];
  metadata?: Record<string, unknown>;
}

export function hasSuccessSignal(signals: SignalResult[], signalId: string): boolean {
  return signals.some(s => s.signalId === signalId && s.status === 'success' && s.rawData != null);
}

export function getSignalData(signals: SignalResult[], signalId: string): unknown | null {
  const sig = signals.find(s => s.signalId === signalId && s.status === 'success');
  return sig?.rawData ?? null;
}

export function hasValues(data: unknown): boolean {
  if (!data) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === 'object' && data !== null) {
    const val = (data as Record<string, unknown>).value;
    if (Array.isArray(val)) return val.length > 0;
    return Object.keys(data).length > 0;
  }
  return true;
}

export function validatePolicyState(
  policy: any,
  expectedState: 'enabled' | 'disabled'
): ValidationResult {
  const findings: string[] = [];
  const actualState = policy?.state ?? 'unknown';
  const valid = actualState === expectedState;
  findings.push(
    `Policy '${policy?.displayName ?? 'unknown'}' is ${actualState}, expected state: ${expectedState}`
  );
  return { valid, findings, metadata: { actualState, expectedState } };
}

export function validateGrantControls(
  policy: any,
  requiredControls: string[],
  operator: 'AND' | 'OR'
): ValidationResult {
  const findings: string[] = [];
  const builtInControls: string[] = policy?.grantControls?.builtInControls ?? [];
  const actualOperator: string = policy?.grantControls?.operator ?? 'unknown';

  let valid: boolean;
  if (operator === 'AND') {
    valid = requiredControls.every(c => builtInControls.includes(c)) && actualOperator === 'AND';
  } else {
    valid = requiredControls.some(c => builtInControls.includes(c));
  }

  findings.push(
    `Policy '${policy?.displayName ?? 'unknown'}' enforces [${builtInControls.join(', ')}], operator ${actualOperator}, required [${requiredControls.join(', ')}] with ${operator}`
  );
  return { valid, findings, metadata: { builtInControls, actualOperator, requiredControls, operator } };
}

export function validateDeviceCompliance(
  devices: any[],
  threshold: number
): ValidationResult {
  const findings: string[] = [];
  const totalCount = devices.length;
  const compliantCount = devices.filter(
    (d: any) => d.complianceState === 'compliant'
  ).length;
  const percentage = totalCount > 0 ? (compliantCount / totalCount) * 100 : 0;
  const valid = percentage >= threshold;

  findings.push(
    `Device compliance: ${compliantCount}/${totalCount} (${percentage.toFixed(1)}%) compliant, threshold: ${threshold}%`
  );
  return { valid, findings, metadata: { threshold, compliantCount, totalCount, percentage } };
}

export function validateEncryptionState(
  encryptionStates: any[],
  threshold: number
): ValidationResult {
  const findings: string[] = [];
  const totalCount = encryptionStates.length;
  const encryptedCount = encryptionStates.filter(
    (e: any) => e.encryptionState === 'encrypted'
  ).length;
  const percentage = totalCount > 0 ? (encryptedCount / totalCount) * 100 : 0;
  const valid = percentage >= threshold;

  findings.push(
    `Encryption state: ${encryptedCount}/${totalCount} (${percentage.toFixed(1)}%) encrypted, threshold: ${threshold}%`
  );
  return { valid, findings, metadata: { threshold, encryptedCount, totalCount, percentage } };
}
