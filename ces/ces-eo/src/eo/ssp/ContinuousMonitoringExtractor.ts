// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';

/**
 * Represents a single continuous monitoring activity with SoD tier assignment.
 */
export interface ContinuousMonitoringActivity {
  activity: string;
  frequency: string;
  responsibleRole: string;
  evidenceLocation: string;
}

/**
 * Infrastructure manifest logging configuration.
 */
interface LoggingConfig {
  sentinelWorkspaceId?: string;
  sentinelWorkspaceName?: string;
  retentionDays?: number;
  logTypes?: string[];
  logAnalyticsRegion?: string;
  immutableStorageEnabled?: boolean;
  archiveRetentionYears?: number;
}

/**
 * Infrastructure manifest vulnerability scanning configuration.
 */
interface VulnerabilityScanningConfig {
  tool?: string;
  scanFrequency?: string;
  scanScope?: string[];
  criticality?: string;
}

/**
 * Stamper execution schedule entry.
 */
interface StamperScheduleEntry {
  evidenceType: string;
  frequency: string;
  lastExecution?: string;
}

/**
 * ContinuousMonitoringExtractor generates data-driven continuous monitoring
 * activities from infrastructure manifest, Stamper schedules, and AdminOps
 * Separation of Duties (SoD) tier assignments.
 */
export class ContinuousMonitoringExtractor {
  private readonly infraManifest: Record<string, unknown>;
  private readonly stamperSchedule?: StamperScheduleEntry[];

  constructor(
    infraManifest: Record<string, unknown>,
    stamperSchedulePath?: string
  ) {
    this.infraManifest = infraManifest;

    // Load Stamper schedule if path provided and file exists
    if (stamperSchedulePath && fs.existsSync(stamperSchedulePath)) {
      try {
        const content = fs.readFileSync(stamperSchedulePath, 'utf-8');
        this.stamperSchedule = JSON.parse(content) as StamperScheduleEntry[];
      } catch (error) {
        console.warn(
          `[ContinuousMonitoringExtractor] Failed to load Stamper schedule from ${stamperSchedulePath}: ${error instanceof Error ? error.message : String(error)}`
        );
        this.stamperSchedule = undefined;
      }
    }
  }

  /**
   * Extract continuous monitoring activities from data sources.
   * Returns 8-12 activities with SoD tier role assignments.
   */
  extractActivities(): ContinuousMonitoringActivity[] {
    const activities: ContinuousMonitoringActivity[] = [];

    // Extract logging/monitoring activities from infraManifest
    activities.push(...this.extractLoggingActivities());

    // Extract vulnerability scanning activities from infraManifest
    activities.push(...this.extractVulnerabilityScanningActivities());

    // Add baseline activities with SoD tier assignments
    activities.push(...this.extractBaselineActivities());

    return activities;
  }

  /**
   * Format activities as SSP-ready markdown table.
   */
  formatAsMarkdownTable(): string {
    const activities = this.extractActivities();

    const header = '| Activity | Frequency | Responsible Role | Evidence Location |';
    const separator = '|----------|-----------|------------------|-------------------|';

    const rows = activities.map(a =>
      `| ${a.activity} | ${a.frequency} | ${a.responsibleRole} | ${a.evidenceLocation} |`
    );

    return [header, separator, ...rows].join('\n');
  }

  /**
   * Extract logging and monitoring activities from infraManifest.logging.
   */
  private extractLoggingActivities(): ContinuousMonitoringActivity[] {
    const activities: ContinuousMonitoringActivity[] = [];

    const loggingConfig = this.getLoggingConfig();

    if (!loggingConfig) {
      return activities;
    }

    // Sentinel workspace monitoring (consolidated SIEM and correlation)
    if (loggingConfig.sentinelWorkspaceId && loggingConfig.sentinelWorkspaceName) {
      activities.push({
        activity: 'SIEM Log Review',
        frequency: 'Daily',
        responsibleRole: 'Tier 1 Security Operations',
        evidenceLocation: `Microsoft Sentinel workspace ${loggingConfig.sentinelWorkspaceName} (${loggingConfig.sentinelWorkspaceId}), retention: ${loggingConfig.retentionDays ?? 365} days`,
      });
    }

    // Audit log retention compliance (includes immutable storage if enabled)
    if (loggingConfig.retentionDays || loggingConfig.immutableStorageEnabled) {
      const retentionInfo = loggingConfig.retentionDays
        ? `retention policy: ${loggingConfig.retentionDays} days${loggingConfig.archiveRetentionYears ? `, archive: ${loggingConfig.archiveRetentionYears} years` : ''}`
        : 'retention policy verification';

      const immutableInfo = loggingConfig.immutableStorageEnabled
        ? `, immutable storage enabled (${loggingConfig.logAnalyticsRegion ?? 'N/A'})`
        : '';

      activities.push({
        activity: 'Audit Log Retention Verification',
        frequency: 'Quarterly',
        responsibleRole: 'Tier 2 Configuration Manager',
        evidenceLocation: `Log Analytics workspace configuration, ${retentionInfo}${immutableInfo}`,
      });
    }

    return activities;
  }

  /**
   * Extract vulnerability scanning activities from infraManifest.vulnerabilityScanning.
   */
  private extractVulnerabilityScanningActivities(): ContinuousMonitoringActivity[] {
    const activities: ContinuousMonitoringActivity[] = [];

    const vulnConfig = this.getVulnerabilityScanningConfig();

    if (!vulnConfig || !vulnConfig.tool) {
      return activities;
    }

    const frequency = vulnConfig.scanFrequency ?? 'Monthly';
    const tool = vulnConfig.tool;
    const scope = vulnConfig.scanScope ? ` (scope: ${vulnConfig.scanScope.join(', ')})` : '';

    // Consolidated scanning and remediation tracking
    activities.push({
      activity: 'Vulnerability Scanning',
      frequency: this.normalizeFrequency(frequency),
      responsibleRole: 'Tier 1 Security Operations',
      evidenceLocation: `${tool} scan reports${scope}, criticality: ${vulnConfig.criticality ?? 'high'}, remediation SLA: critical 15d/high 30d/medium 90d`,
    });

    return activities;
  }

  /**
   * Extract baseline continuous monitoring activities.
   * Uses Stamper schedule when available, falls back to defaults.
   */
  private extractBaselineActivities(): ContinuousMonitoringActivity[] {
    const activities: ContinuousMonitoringActivity[] = [];

    // Access reviews
    activities.push({
      activity: 'Access Review (Privileged)',
      frequency: this.getFrequencyFromStamper('privileged_access_review', 'Quarterly'),
      responsibleRole: 'Tier 2 Configuration Manager',
      evidenceLocation: 'Entra ID Privileged Access Review reports, Azure PIM access reviews',
    });

    activities.push({
      activity: 'Access Review (Standard)',
      frequency: this.getFrequencyFromStamper('standard_access_review', 'Semi-annually'),
      responsibleRole: 'Tier 2 Configuration Manager',
      evidenceLocation: 'Entra ID Access Review logs, user entitlement attestations',
    });

    // Configuration management
    activities.push({
      activity: 'Configuration Compliance Audit',
      frequency: this.getFrequencyFromStamper('config_compliance_audit', 'Quarterly'),
      responsibleRole: 'Tier 2 Configuration Manager',
      evidenceLocation: 'Azure Policy compliance reports, Intune configuration baselines',
    });

    // Incident response readiness
    activities.push({
      activity: 'Incident Response Drill',
      frequency: this.getFrequencyFromStamper('ir_drill', 'Annually'),
      responsibleRole: 'Tier 1 Security Operations',
      evidenceLocation: 'IR drill after-action reports, tabletop exercise documentation',
    });

    // Backup verification
    activities.push({
      activity: 'Backup Verification',
      frequency: this.getFrequencyFromStamper('backup_verification', 'Monthly'),
      responsibleRole: 'Tier 3 Azure Infrastructure',
      evidenceLocation: 'Azure Backup reports, restore test logs',
    });

    // Conditional Access policy review
    activities.push({
      activity: 'Conditional Access Policy Review',
      frequency: this.getFrequencyFromStamper('ca_policy_review', 'Quarterly'),
      responsibleRole: 'Tier 2 Configuration Manager',
      evidenceLocation: 'Entra ID Conditional Access policy audit logs, sign-in analytics',
    });

    // DLP and sensitivity labels (CUI protection)
    activities.push({
      activity: 'DLP Policy Effectiveness Review',
      frequency: this.getFrequencyFromStamper('dlp_review', 'Quarterly'),
      responsibleRole: 'Tier 2 Configuration Manager',
      evidenceLocation: 'Microsoft 365 DLP policy reports, incident logs',
    });

    activities.push({
      activity: 'Sensitivity Label Audit',
      frequency: this.getFrequencyFromStamper('sensitivity_label_audit', 'Quarterly'),
      responsibleRole: 'Tier 2 Configuration Manager',
      evidenceLocation: 'Microsoft 365 sensitivity label usage reports, classification analytics',
    });

    return activities;
  }

  /**
   * Get logging configuration from infraManifest.
   */
  private getLoggingConfig(): LoggingConfig | null {
    const logging = this.infraManifest.logging;

    if (!logging || typeof logging !== 'object') {
      return null;
    }

    // If logging is an array of resources (legacy format)
    if (Array.isArray(logging)) {
      const config: LoggingConfig = {};

      for (const resource of logging as Array<{ resource_type: string; name: string; properties?: Record<string, unknown> }>) {
        if (resource.resource_type === 'sentinel_onboarding') {
          config.sentinelWorkspaceName = resource.name;
          config.sentinelWorkspaceId = resource.properties?.workspace_id as string | undefined;
        } else if (resource.resource_type === 'log_analytics_workspace') {
          config.sentinelWorkspaceName = config.sentinelWorkspaceName ?? resource.name;
          config.retentionDays = resource.properties?.retention_days as number | undefined;
          config.logAnalyticsRegion = resource.properties?.location as string | undefined;
        }
      }

      return Object.keys(config).length > 0 ? config : null;
    }

    // If logging is a structured config object
    return logging as LoggingConfig;
  }

  /**
   * Get vulnerability scanning configuration from infraManifest.
   */
  private getVulnerabilityScanningConfig(): VulnerabilityScanningConfig | null {
    const vulnScanning = this.infraManifest.vulnerabilityScanning;

    if (!vulnScanning || typeof vulnScanning !== 'object') {
      return null;
    }

    return vulnScanning as VulnerabilityScanningConfig;
  }

  /**
   * Get frequency from Stamper schedule, with fallback to default.
   */
  private getFrequencyFromStamper(evidenceType: string, defaultFrequency: string): string {
    if (!this.stamperSchedule) {
      return defaultFrequency;
    }

    const entry = this.stamperSchedule.find(e => e.evidenceType === evidenceType);

    return entry ? this.normalizeFrequency(entry.frequency) : defaultFrequency;
  }

  /**
   * Normalize frequency strings to consistent format.
   */
  private normalizeFrequency(frequency: string): string {
    const lower = frequency.toLowerCase();

    if (lower.includes('daily') || lower.includes('day')) return 'Daily';
    if (lower.includes('weekly') || lower.includes('week')) return 'Weekly';
    if (lower.includes('monthly') || lower.includes('month')) return 'Monthly';
    if (lower.includes('quarterly') || lower.includes('quarter')) return 'Quarterly';
    if (lower.includes('semi-annual') || lower.includes('semiannual') || lower.includes('6 month')) return 'Semi-annually';
    if (lower.includes('annual') || lower.includes('year')) return 'Annually';
    if (lower.includes('continuous') || lower.includes('real-time')) return 'Continuous';

    // Return as-is if no match
    return frequency;
  }
}
