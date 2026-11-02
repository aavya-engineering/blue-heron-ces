// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SignalResult } from 'ces-shared/types/signal';
import { SIGNAL_REGISTRY } from '../../../src/eo/generation/SignalRegistry';
import { siEvaluators } from '../../../src/eo/mapping/evaluators/si-evaluators';

/**
 * G3 #3: NEW evidence coverage — pinned by fixture-based tests.
 *
 * Covers the additive SI-family signal transforms (`riskDetections`,
 * `vulnerabilities`) and the new posture evaluators that consume them
 * (`riskDetectionPostureEvaluator`, `vulnerabilityPostureEvaluator`).
 *
 * Fixture-based only — no live MS/GCC High tenant required. End-to-end
 * collection against a real tenant is a documented manual step (see
 * docs/G3-evidence-coverage.md).
 */

const now = new Date().toISOString();

function makeSignal(signalId: string, endpoint: string, data: unknown): SignalResult {
  return {
    signalId,
    source: 'graph',
    endpoint,
    timestamp: now,
    rawData: data,
    status: 'success',
  };
}

function transformFor(signalId: string) {
  const entry = SIGNAL_REGISTRY.find(e => e.signalId === signalId);
  if (!entry) throw new Error(`No transform registered for signalId '${signalId}'`);
  return entry.transform;
}

// --- Fixture factories for the new signals ---

function makeRiskDetections(detections: unknown[]) {
  return { value: detections };
}

function makeVulnerabilities(vulns: unknown[]) {
  return { value: vulns };
}

describe('G3 #3: riskDetections signal transform', () => {
  const transform = transformFor('riskDetections');

  test('extracts riskType / riskLevel / detectedDateTime fields', () => {
    const signal = makeSignal('riskDetections', '/identityProtection/riskDetections', makeRiskDetections([
      {
        riskType: 'anonymizedIPAddress',
        riskLevel: 'high',
        riskState: 'atRisk',
        detectedDateTime: '2026-06-01T10:00:00Z',
        userPrincipalName: 'alice@contoso.us',
      },
      {
        riskEventType: 'unfamiliarFeatures',
        riskLevel: 'low',
        riskState: 'remediated',
        activityDateTime: '2026-06-02T11:00:00Z',
      },
    ]));

    const ctx = transform(signal) as any;
    expect(ctx.riskDetectionsCount).toBe(2);
    expect(ctx.riskDetectionsAvailable).toBe(true);
    expect(ctx.highRiskDetectionsCount).toBe(1);
    expect(ctx.detections[0]).toMatchObject({
      riskType: 'anonymizedIPAddress',
      riskLevel: 'high',
      detectedDateTime: '2026-06-01T10:00:00Z',
      userPrincipalName: 'alice@contoso.us',
    });
    // falls back to riskEventType / activityDateTime
    expect(ctx.detections[1].riskType).toBe('unfamiliarFeatures');
    expect(ctx.detections[1].detectedDateTime).toBe('2026-06-02T11:00:00Z');
  });

  test('handles empty signal gracefully', () => {
    const ctx = transform(makeSignal('riskDetections', '/identityProtection/riskDetections', { value: [] })) as any;
    expect(ctx.riskDetectionsCount).toBe(0);
    expect(ctx.riskDetectionsAvailable).toBe(false);
  });
});

describe('G3 #3: vulnerabilities signal transform', () => {
  const transform = transformFor('vulnerabilities');

  test('extracts id / severity / cvss / remediation fields', () => {
    const signal = makeSignal('vulnerabilities', '/security/microsoft/vulnerabilities', makeVulnerabilities([
      {
        id: 'CVE-2026-0001',
        severity: 'critical',
        cvssV3: 9.8,
        remediation: 'Apply vendor patch KB123',
      },
      {
        id: 'CVE-2026-0002',
        severity: 'medium',
        cvssV2: 5.0,
        description: 'Upgrade component',
      },
    ]));

    const ctx = transform(signal) as any;
    expect(ctx.vulnerabilitiesCount).toBe(2);
    expect(ctx.vulnerabilitiesAvailable).toBe(true);
    expect(ctx.criticalOrHighCount).toBe(1);
    expect(ctx.vulnerabilities[0]).toMatchObject({
      id: 'CVE-2026-0001',
      severity: 'critical',
      cvss: 9.8,
      remediation: 'Apply vendor patch KB123',
    });
    // cvssV2 + description fallbacks
    expect(ctx.vulnerabilities[1].cvss).toBe(5.0);
    expect(ctx.vulnerabilities[1].remediation).toBe('Upgrade component');
  });

  test('handles empty signal gracefully', () => {
    const ctx = transform(makeSignal('vulnerabilities', '/security/microsoft/vulnerabilities', { value: [] })) as any;
    expect(ctx.vulnerabilitiesCount).toBe(0);
    expect(ctx.vulnerabilitiesAvailable).toBe(false);
  });
});

describe('G3 #3: riskDetectionPostureEvaluator', () => {
  test('empty/missing signal -> not_met', () => {
    expect(siEvaluators.riskDetectionPostureEvaluator([]).status).toBe('not_met');
  });

  test('signal present with no detections -> met', () => {
    const signals = [makeSignal('riskDetections', '/identityProtection/riskDetections', { value: [] })];
    expect(siEvaluators.riskDetectionPostureEvaluator(signals).status).toBe('met');
  });

  test('unremediated high/critical detection -> not_met', () => {
    const signals = [makeSignal('riskDetections', '/identityProtection/riskDetections', makeRiskDetections([
      { riskType: 'leakedCredentials', riskLevel: 'high', riskState: 'atRisk' },
    ]))];
    expect(siEvaluators.riskDetectionPostureEvaluator(signals).status).toBe('not_met');
  });

  test('all high/critical detections remediated -> met', () => {
    const signals = [makeSignal('riskDetections', '/identityProtection/riskDetections', makeRiskDetections([
      { riskType: 'leakedCredentials', riskLevel: 'high', riskState: 'remediated' },
      { riskType: 'unfamiliarFeatures', riskLevel: 'low', riskState: 'atRisk' },
    ]))];
    expect(siEvaluators.riskDetectionPostureEvaluator(signals).status).toBe('met');
  });
});

describe('G3 #3: vulnerabilityPostureEvaluator', () => {
  test('empty/missing signal -> not_met', () => {
    expect(siEvaluators.vulnerabilityPostureEvaluator([]).status).toBe('not_met');
  });

  test('signal present with no vulnerabilities -> met', () => {
    const signals = [makeSignal('vulnerabilities', '/security/microsoft/vulnerabilities', { value: [] })];
    expect(siEvaluators.vulnerabilityPostureEvaluator(signals).status).toBe('met');
  });

  test('unremediated critical/high vulnerability -> not_met', () => {
    const signals = [makeSignal('vulnerabilities', '/security/microsoft/vulnerabilities', makeVulnerabilities([
      { id: 'CVE-2026-0001', severity: 'critical', cvssV3: 9.8 },
    ]))];
    expect(siEvaluators.vulnerabilityPostureEvaluator(signals).status).toBe('not_met');
  });

  test('all critical/high vulnerabilities remediated -> met', () => {
    const signals = [makeSignal('vulnerabilities', '/security/microsoft/vulnerabilities', makeVulnerabilities([
      { id: 'CVE-2026-0001', severity: 'critical', cvssV3: 9.8, status: 'resolved' },
      { id: 'CVE-2026-0009', severity: 'low' },
    ]))];
    expect(siEvaluators.vulnerabilityPostureEvaluator(signals).status).toBe('met');
  });

  test('falls back to vulnerabilitiesExpanded signalId', () => {
    const signals = [makeSignal('vulnerabilitiesExpanded', '/security/microsoft/vulnerabilities', makeVulnerabilities([
      { id: 'CVE-2026-1000', severity: 'high', cvssV3: 7.5, remediationStatus: 'remediated' },
    ]))];
    expect(siEvaluators.vulnerabilityPostureEvaluator(signals).status).toBe('met');
  });
});

describe('G3 #3: new evaluators registered & additive', () => {
  test('new evaluators are exported in siEvaluators', () => {
    expect(typeof siEvaluators.riskDetectionPostureEvaluator).toBe('function');
    expect(typeof siEvaluators.vulnerabilityPostureEvaluator).toBe('function');
  });

  test('new evaluators never throw on empty/garbage signals', () => {
    for (const fn of [siEvaluators.riskDetectionPostureEvaluator, siEvaluators.vulnerabilityPostureEvaluator]) {
      expect(() => fn([])).not.toThrow();
      expect(() => fn([makeSignal('riskDetections', '/x', null)])).not.toThrow();
      expect(() => fn([makeSignal('vulnerabilities', '/x', 'garbage')])).not.toThrow();
    }
  });
});
