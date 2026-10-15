// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { ContinuousMonitoringExtractor } from '../ContinuousMonitoringExtractor.js';
import type { ContinuousMonitoringActivity } from '../ContinuousMonitoringExtractor.js';

describe('ContinuousMonitoringExtractor', () => {
  describe('extractActivities', () => {
    it('should extract activities from fully populated infraManifest', () => {
      const infraManifest = {
        logging: {
          sentinelWorkspaceId: '/subscriptions/abc123/resourceGroups/rg-security/providers/Microsoft.OperationalInsights/workspaces/sentinel-prod',
          sentinelWorkspaceName: 'sentinel-prod',
          retentionDays: 730,
          logTypes: ['SecurityEvent', 'AuditLogs', 'SignInLogs'],
          logAnalyticsRegion: 'usgovvirginia',
          immutableStorageEnabled: true,
          archiveRetentionYears: 7,
        },
        vulnerabilityScanning: {
          tool: 'Microsoft Defender for Endpoint',
          scanFrequency: 'Weekly',
          scanScope: ['Servers', 'Workstations', 'Cloud VMs'],
          criticality: 'High',
        },
      };

      const extractor = new ContinuousMonitoringExtractor(infraManifest);
      const activities = extractor.extractActivities();

      // Should have logging, vuln scanning, and baseline activities
      expect(activities.length).toBeGreaterThanOrEqual(8);
      expect(activities.length).toBeLessThanOrEqual(12);

      // Check Sentinel workspace ID appears in evidence locations
      const siemActivity = activities.find(a => a.activity === 'SIEM Log Review');
      expect(siemActivity).toBeDefined();
      expect(siemActivity?.evidenceLocation).toContain('sentinel-prod');
      expect(siemActivity?.evidenceLocation).toContain('/subscriptions/abc123');
      expect(siemActivity?.evidenceLocation).toContain('730 days');

      // Check vulnerability scanner appears
      const vulnActivity = activities.find(a => a.activity === 'Vulnerability Scanning');
      expect(vulnActivity).toBeDefined();
      expect(vulnActivity?.evidenceLocation).toContain('Microsoft Defender for Endpoint');
      expect(vulnActivity?.frequency).toBe('Weekly');
    });

    it('should use default Stamper schedule when file unavailable', () => {
      const infraManifest = {
        logging: {
          sentinelWorkspaceId: 'ws-123',
          sentinelWorkspaceName: 'test-workspace',
          retentionDays: 365,
        },
      };

      // No Stamper schedule path provided
      const extractor = new ContinuousMonitoringExtractor(infraManifest);
      const activities = extractor.extractActivities();

      // Should use default frequencies for baseline activities
      const accessReview = activities.find(a => a.activity === 'Access Review (Privileged)');
      expect(accessReview).toBeDefined();
      expect(accessReview?.frequency).toBe('Quarterly');

      const backupVerification = activities.find(a => a.activity === 'Backup Verification');
      expect(backupVerification).toBeDefined();
      expect(backupVerification?.frequency).toBe('Monthly');
    });

    it('should use SoD tier roles (no "System Administrator")', () => {
      const infraManifest = {
        logging: {
          sentinelWorkspaceId: 'ws-123',
          sentinelWorkspaceName: 'test-workspace',
          retentionDays: 365,
        },
        vulnerabilityScanning: {
          tool: 'Qualys',
          scanFrequency: 'Monthly',
        },
      };

      const extractor = new ContinuousMonitoringExtractor(infraManifest);
      const activities = extractor.extractActivities();

      // Verify no generic "System Administrator" role
      const hasSystemAdmin = activities.some(a => a.responsibleRole === 'System Administrator');
      expect(hasSystemAdmin).toBe(false);

      // Verify SoD tier roles are used
      const tierRoles = [
        'Tier 1 Security Operations',
        'Tier 2 Configuration Manager',
        'Tier 3 Azure Infrastructure',
      ];

      const allRolesAreSod = activities.every(a => tierRoles.includes(a.responsibleRole));
      expect(allRolesAreSod).toBe(true);

      // Check specific role mappings
      const securityActivity = activities.find(a => a.activity === 'SIEM Log Review');
      expect(securityActivity?.responsibleRole).toBe('Tier 1 Security Operations');

      const configActivity = activities.find(a => a.activity === 'Configuration Compliance Audit');
      expect(configActivity?.responsibleRole).toBe('Tier 2 Configuration Manager');

      const infraActivity = activities.find(a => a.activity === 'Backup Verification');
      expect(infraActivity?.responsibleRole).toBe('Tier 3 Azure Infrastructure');
    });

    it('should include baseline activities even with empty infraManifest', () => {
      const infraManifest = {};

      const extractor = new ContinuousMonitoringExtractor(infraManifest);
      const activities = extractor.extractActivities();

      // Should have at least baseline activities (8 activities)
      expect(activities.length).toBeGreaterThanOrEqual(8);

      // Check baseline activities exist
      const baselineActivities = [
        'Access Review (Privileged)',
        'Access Review (Standard)',
        'Configuration Compliance Audit',
        'Incident Response Drill',
        'Backup Verification',
        'Conditional Access Policy Review',
        'DLP Policy Effectiveness Review',
        'Sensitivity Label Audit',
      ];

      for (const activityName of baselineActivities) {
        const activity = activities.find(a => a.activity === activityName);
        expect(activity).toBeDefined();
      }
    });

    it('should produce activity count in 8-12 range for typical configuration', () => {
      const infraManifest = {
        logging: {
          sentinelWorkspaceId: 'ws-123',
          sentinelWorkspaceName: 'test-workspace',
          retentionDays: 365,
          immutableStorageEnabled: false,
        },
        vulnerabilityScanning: {
          tool: 'Microsoft Defender',
          scanFrequency: 'Monthly',
        },
      };

      const extractor = new ContinuousMonitoringExtractor(infraManifest);
      const activities = extractor.extractActivities();

      // Typical configuration: logging (2-3) + vuln (2) + baseline (8) = 12-13 activities
      expect(activities.length).toBeGreaterThanOrEqual(8);
      expect(activities.length).toBeLessThanOrEqual(12);
    });

    it('should handle legacy array-based logging format', () => {
      const infraManifest = {
        logging: [
          {
            resource_type: 'sentinel_onboarding',
            name: 'sentinel-workspace',
            properties: {
              workspace_id: '/subscriptions/xyz/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/ws-sentinel',
            },
          },
          {
            resource_type: 'log_analytics_workspace',
            name: 'log-analytics-ws',
            properties: {
              retention_days: 90,
              location: 'usgovvirginia',
            },
          },
        ],
      };

      const extractor = new ContinuousMonitoringExtractor(infraManifest);
      const activities = extractor.extractActivities();

      const siemActivity = activities.find(a => a.activity === 'SIEM Log Review');
      expect(siemActivity).toBeDefined();
      expect(siemActivity?.evidenceLocation).toContain('sentinel-workspace');
      expect(siemActivity?.evidenceLocation).toContain('90 days');
    });
  });

  describe('formatAsMarkdownTable', () => {
    it('should format activities as markdown table with 4 columns', () => {
      const infraManifest = {
        logging: {
          sentinelWorkspaceId: 'ws-123',
          sentinelWorkspaceName: 'test-workspace',
          retentionDays: 365,
        },
      };

      const extractor = new ContinuousMonitoringExtractor(infraManifest);
      const table = extractor.formatAsMarkdownTable();

      // Check table structure
      const lines = table.split('\n');
      expect(lines.length).toBeGreaterThan(2); // Header + separator + at least 1 row

      // Check header
      expect(lines[0]).toContain('Activity');
      expect(lines[0]).toContain('Frequency');
      expect(lines[0]).toContain('Responsible Role');
      expect(lines[0]).toContain('Evidence Location');

      // Check separator
      expect(lines[1]).toContain('---');

      // Check data rows use pipe delimiters
      for (let i = 2; i < lines.length; i++) {
        expect(lines[i]).toMatch(/^\|.*\|.*\|.*\|.*\|$/);
      }

      // Verify Sentinel workspace ID appears in table
      expect(table).toContain('ws-123');
      expect(table).toContain('test-workspace');
    });

    it('should include Sentinel workspace ID in table if configured', () => {
      const infraManifest = {
        logging: {
          sentinelWorkspaceId: '/subscriptions/abc-def-123/resourceGroups/rg-prod/providers/Microsoft.OperationalInsights/workspaces/sentinel-prod',
          sentinelWorkspaceName: 'sentinel-prod',
          retentionDays: 730,
        },
      };

      const extractor = new ContinuousMonitoringExtractor(infraManifest);
      const table = extractor.formatAsMarkdownTable();

      // Workspace ID should appear in evidence location column
      expect(table).toContain('/subscriptions/abc-def-123');
      expect(table).toContain('sentinel-prod');
      expect(table).toContain('730 days');
    });

    it('should include vulnerability scanner tool and frequency if configured', () => {
      const infraManifest = {
        vulnerabilityScanning: {
          tool: 'Tenable Nessus',
          scanFrequency: 'Weekly',
          scanScope: ['Production Servers'],
          criticality: 'Critical',
        },
      };

      const extractor = new ContinuousMonitoringExtractor(infraManifest);
      const table = extractor.formatAsMarkdownTable();

      expect(table).toContain('Tenable Nessus');
      expect(table).toContain('Weekly');
      expect(table).toContain('Critical');
    });
  });
});
