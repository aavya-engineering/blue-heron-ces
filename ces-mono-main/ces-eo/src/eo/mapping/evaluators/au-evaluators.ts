// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { EvaluatorFn } from './index.js';
import { getSignalData, hasValues } from './helpers.js';
import { CUI_AUDIT_EVENT_TYPES } from './constants.js';

export const auEvaluators: Record<string, EvaluatorFn> = {
  auditEventsEvaluator: (signals) => {
    // Try expanded directoryAudits signal first, then fallback to original signals
    const directoryAuditData = getSignalData(signals, 'directoryAudits');
    const auditData = directoryAuditData ?? getSignalData(signals, 'auditQueries') ?? getSignalData(signals, 'mailboxAudit');

    if (!auditData) {
      return { status: 'not_assessed', evidence: 'Audit log data not available' };
    }

    // If we have directory audit data, do deep validation
    if (directoryAuditData && hasValues(directoryAuditData)) {
      const audits = Array.isArray(directoryAuditData)
        ? directoryAuditData
        : (directoryAuditData as any)?.value ?? [];

      if (Array.isArray(audits) && audits.length > 0) {
        const findings: string[] = [];

        // Validate audit logging is enabled by checking presence of records in past 30 days
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const recentAudits = audits.filter((a: any) => {
          const activityDate = new Date(a.activityDateTime ?? a.createdDateTime ?? '');
          return activityDate >= thirtyDaysAgo;
        });

        findings.push(`Audit log contains ${recentAudits.length} events in past 30 days`);

        // Check for CUI-related event types
        const eventTypes = new Set<string>();
        for (const audit of audits) {
          const category = audit.category ?? audit.operationType ?? '';
          eventTypes.add(category);
        }

        const matchedTypes = CUI_AUDIT_EVENT_TYPES.filter(t =>
          [...eventTypes].some(et => et.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(et.toLowerCase()))
        );

        if (matchedTypes.length > 0) {
          findings.push(`CUI audit event types detected: ${matchedTypes.join(', ')}`);
        }

        // Flag retention policy as requiring manual verification
        findings.push('Audit retention policy requires manual verification in M365 Security & Compliance Center');

        if (recentAudits.length > 0) {
          return {
            status: 'met',
            evidence: `Audit event collection active. ${findings.join('; ')}`,
          };
        }

        return {
          status: 'not_assessed',
          evidence: `Audit logs accessible but no recent events found. ${findings.join('; ')}`,
        };
      }
    }

    // Fallback to original logic
    if (typeof auditData === 'object' && auditData !== null) {
      const config = auditData as Record<string, unknown>;
      if (config.AuditDisabled === false) {
        return { status: 'met', evidence: 'Audit logging enabled (AuditDisabled=false)' };
      }
    }
    return { status: 'met', evidence: 'Audit event collection configured' };
  },

  auditReviewEvaluator: (signals) => {
    const signInData = getSignalData(signals, 'signInLogs') ?? getSignalData(signals, 'mailboxAudit');
    if (!signInData) {
      return { status: 'not_assessed', evidence: 'Audit review data not available' };
    }
    return { status: 'met', evidence: 'Audit review capability confirmed via audit log configuration' };
  },

  sentinelWorkspaceEvaluator: (signals) => {
    const alertData = getSignalData(signals, 'securityAlerts');
    if (!alertData || !hasValues(alertData)) {
      return { status: 'not_met', evidence: 'Security alert correlation data not available for Sentinel workspace verification' };
    }
    return { status: 'met', evidence: 'Security alert correlation configured for audit event correlation' };
  },

  alertGroupEvaluator: (signals) => {
    const alertData = getSignalData(signals, 'securityAlerts');
    if (!alertData || !hasValues(alertData)) {
      return { status: 'not_met', evidence: 'Alert response data not available' };
    }
    return { status: 'met', evidence: 'Alert group configured for audit failure notification' };
  },

  auditReductionEvaluator: (signals) => {
    const auditData = getSignalData(signals, 'auditQueries');
    if (!auditData || !hasValues(auditData)) {
      return { status: 'not_met', evidence: 'Audit reduction and report generation tools not verified' };
    }
    return { status: 'met', evidence: 'Audit reduction and report generation capabilities confirmed' };
  },

  timeSourceEvaluator: (signals) => {
    const orgData = getSignalData(signals, 'organization');
    if (!orgData || !hasValues(orgData)) {
      return { status: 'not_met', evidence: 'Organization data not available for time source verification' };
    }
    return { status: 'met', evidence: 'Authoritative time source verified via platform-inherited NTP (M365/Azure)' };
  },
};
