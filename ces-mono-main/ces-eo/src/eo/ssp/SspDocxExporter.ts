// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SystemSecurityPlan } from 'ces-shared/types/ssp';
import type { SspQualityScorecard } from './SspQualityScorecard.js';

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const docx: any = _require('docx');
const { Document, Packer, Paragraph, TextRun, Header, Footer, AlignmentType, NumberFormat, Table, TableRow, TableCell, TableOfContents, PageBreak, HeadingLevel, WidthType, BorderStyle, ImageRun } = docx;

/**
 * Full 15-section DOCX exporter for System Security Plans.
 * Generates a DOCX with CUI classification markings per 32 CFR 2002:
 *   - Cover page: "CUI // SP-SSP // CMMC L2" banner, system name, version, date
 *   - Signature page: System Owner, ISSO, Authorizing Official
 *   - Revision history table
 *   - Table of Contents (auto-generated from H1/H2/H3)
 *   - 15 numbered sections with 110 controls grouped by 14 families
 *   - Header on all pages: "CUI" centered 10pt
 *   - Footer on all pages: "CUI // SP-SSP // CMMC L2" centered 8pt
 */
export class SspDocxExporter {
  private familyOverviews: Map<string, string>;
  private readonly qualityScorecard?: SspQualityScorecard;

  constructor(options?: { qualityScorecard?: SspQualityScorecard }) {
    this.qualityScorecard = options?.qualityScorecard;
    this.familyOverviews = new Map<string, string>();
    try {
      const __filename = fileURLToPath(import.meta.url).replace(/^\/([A-Z]:)/, '$1');
      const __dirname = path.dirname(__filename);
      // From dist/eo/ssp/ or src/eo/ssp/ -> project root -> src/shared/data/
      const projectRoot = path.resolve(__dirname, '..', '..', '..');
      const overviewsPath = path.join(projectRoot, 'src', 'shared', 'data', 'family-overviews.json');
      const overviewsData: Record<string, string> = JSON.parse(fs.readFileSync(overviewsPath, 'utf-8'));
      for (const [key, value] of Object.entries(overviewsData)) {
        this.familyOverviews.set(key, value);
      }
    } catch (err) {
      console.warn('Family overviews file not found. Section 8 will use placeholder text.', err);
    }
  }

  async export(ssp: SystemSecurityPlan): Promise<Buffer> {
    // --- Quality Gate (warn-and-continue) ---
    if (this.qualityScorecard) {
      try {
        const sspAny = ssp as any;
        const report = this.qualityScorecard.validate(
          ssp,
          sspAny._tenantManifest as Record<string, unknown> | undefined,
          sspAny._infraManifest as Record<string, unknown> | undefined,
          sspAny._poam,
        );
        // Save validation report
        try {
          const reportPath = this.qualityScorecard.saveValidationReport(report);
          console.log(`[SspDocxExporter] Validation report saved to: ${reportPath}`);
        } catch (saveErr) {
          console.warn('[SspDocxExporter] Failed to save validation report:', saveErr instanceof Error ? saveErr.message : String(saveErr));
        }
        // Log results (warn-and-continue, do not block export)
        if (report.overallPass) {
          console.log(`[SspDocxExporter] Quality scorecard: ALL ${report.metricsTotalCount} metrics passed`);
        } else {
          console.warn(`[SspDocxExporter] Quality scorecard: ${report.metricsPassedCount}/${report.metricsTotalCount} metrics passed`);
          for (const metric of report.metrics) {
            if (!metric.passed) {
              console.warn(`  FAIL: ${metric.metricName} (score: ${metric.score}, threshold: ${metric.threshold})`);
            }
          }
        }
      } catch (err) {
        console.warn('[SspDocxExporter] Quality scorecard validation failed:', err instanceof Error ? err.message : String(err));
      }
    }

    const children: any[] = [];

    // --- Cover Page ---
    // Spacer paragraphs to push content toward center
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));
    // CUI classification banner
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'CUI // SP-SSP // CMMC L2',
          bold: true,
          size: 28, // 14pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));
    // System name
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: ssp.systemName,
          bold: true,
          size: 32, // 16pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));
    // System Security Plan subtitle
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'System Security Plan',
          size: 28, // 14pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));
    // Version
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Version ${ssp.version}`,
          size: 24, // 12pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));
    // Date
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: new Date(ssp.generatedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          size: 20, // 10pt
        }),
      ],
    }));

    // Document ID
    if (ssp.documentId) {
      children.push(new Paragraph({ text: '' }));
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `Document ID: ${ssp.documentId}`, size: 20 }),
        ],
      }));
    }
    // Classification Level
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Classification: CUI Basic`,
          bold: true,
          size: 20,
        }),
      ],
    }));
    // Framework Reference
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'NIST SP 800-171 Rev 2 (110 Security Requirements)', size: 20 }),
      ],
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'Assessment Guide: NIST SP 800-171A', size: 20 }),
      ],
    }));

    // PageBreak after cover page
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Signature Page ---
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Signature Page' })],
    }));
    children.push(new Paragraph({ text: '' }));

    // Attestation statement
    children.push(new Paragraph({
      children: [new TextRun({
        text: 'ATTESTATION STATEMENT',
        bold: true,
        size: 26,
        underline: {},
      })],
    }));
    children.push(new Paragraph({ text: '' }));

    children.push(new Paragraph({
      children: [new TextRun({
        text: 'By signing this System Security Plan, the undersigned certify that:',
        size: 24,
      })],
    }));
    children.push(new Paragraph({ text: '' }));

    const attestations = [
      'The information contained in this SSP is accurate and complete to the best of our knowledge.',
      'All security controls documented herein are implemented or planned for implementation as described.',
      'This system processes, stores, or transmits Controlled Unclassified Information (CUI) in accordance with NIST SP 800-171 Rev 2 and CMMC Level 2 requirements.',
      'We understand that any material misrepresentation may result in suspension or revocation of authorization to operate.',
    ];

    for (const item of attestations) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: item, size: 24 })],
      }));
    }

    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));

    // System Owner signature block
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'System Owner: ', bold: true, size: 24 }),
        new TextRun({ text: '______________________________', size: 24 }),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Name: ', bold: true, size: 24 }),
        ...(ssp.preparedBy?.name
          ? [new TextRun({ text: ssp.preparedBy.name, size: 24 })]
          : [new TextRun({ text: '[MANUAL INPUT REQUIRED]', italics: true, color: 'FF0000', size: 24 })]),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Date: ', bold: true, size: 24 }),
        new TextRun({ text: '_______________', size: 24 }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));

    // ISSO signature block
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'ISSO: ', bold: true, size: 24 }),
        new TextRun({ text: '______________________________', size: 24 }),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Name: ', bold: true, size: 24 }),
        ...(ssp.isso?.name
          ? [new TextRun({ text: ssp.isso.name, size: 24 })]
          : [new TextRun({ text: '[MANUAL INPUT REQUIRED]', italics: true, color: 'FF0000', size: 24 })]),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Date: ', bold: true, size: 24 }),
        new TextRun({ text: '_______________', size: 24 }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));

    // Authorizing Official signature block
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Authorizing Official: ', bold: true, size: 24 }),
        new TextRun({ text: '______________________________', size: 24 }),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Name: ', bold: true, size: 24 }),
        ...(ssp.authorizingOfficial?.name
          ? [new TextRun({ text: ssp.authorizingOfficial.name, size: 24 })]
          : [new TextRun({ text: '[MANUAL INPUT REQUIRED]', italics: true, color: 'FF0000', size: 24 })]),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Date: ', bold: true, size: 24 }),
        new TextRun({ text: '_______________', size: 24 }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));

    // PageBreak after signature page
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Document Control ---
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Document Control' })],
    }));
    children.push(new Paragraph({ text: '' }));

    // Document Control table
    const docOwner = (ssp as any).documentOwner ?? ssp.preparedBy?.name ?? '[MANUAL INPUT REQUIRED]';
    const docApprover = (ssp as any).documentApprover ?? ssp.authorizingOfficial?.name ?? '[MANUAL INPUT REQUIRED]';
    const lastReviewed = (ssp as any).lastReviewDate ?? ssp.generatedAt;
    const nextReview = (ssp as any).nextReviewDate ?? '[MANUAL INPUT REQUIRED]';
    const reviewCadence = (ssp as any).reviewCadence ?? 'Annual';
    const distribution = (ssp as any).distribution ?? 'Internal use only. Distribution to C3PAO assessors and DCMA as required.';
    children.push(this.renderTable(
      ['Field', 'Value'],
      [
        ['Document Owner', docOwner],
        ['Document Approver', docApprover],
        ['Last Reviewed', lastReviewed],
        ['Next Scheduled Review', nextReview],
        ['Review Cadence', reviewCadence],
        ['Distribution', distribution],
      ]
    ));
    children.push(new Paragraph({ text: '' }));

    // --- Revision History ---
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Revision History' })],
    }));
    children.push(new Paragraph({ text: '' }));

    const revisionRows = (ssp.revisionHistory && ssp.revisionHistory.length > 0)
      ? ssp.revisionHistory.map(r => [r.version, r.date, r.author, r.description])
      : [['1.0', ssp.generatedAt, ssp.lastUpdatedBy, 'Initial version']];
    children.push(this.renderTable(['Version', 'Date', 'Author', 'Description'], revisionRows));
    children.push(new Paragraph({ text: '' }));

    // Approval Signatures sub-tables if available
    if (ssp.revisionHistory && ssp.revisionHistory.length > 0) {
      for (const rev of ssp.revisionHistory) {
        if (rev.approvalSignatures && rev.approvalSignatures.length > 0) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `Approval Signatures for Version ${rev.version}:`, bold: true, size: 24 })],
          }));
          children.push(this.renderTable(
            ['Name', 'Role', 'Date'],
            rev.approvalSignatures.map(s => [s.name, s.role, s.date])
          ));
          children.push(new Paragraph({ text: '' }));
        }
      }
    }

    // PageBreak after revision history
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Table of Contents ---
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Table of Contents' })],
    }));
    children.push(new Paragraph({ text: '' }));
    children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }));
    children.push(new Paragraph({ text: '' }));

    // PageBreak after TOC
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Executive Summary (unnumbered) ---
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Executive Summary' })],
    }));
    children.push(new Paragraph({ text: '' }));
    // Paragraph 1: Mission context
    children.push(new Paragraph({
      children: [new TextRun({
        text: ssp.systemDescription || 'This System Security Plan (SSP) documents the security posture of the information system and its compliance with NIST SP 800-171 Rev 2 requirements for the protection of Controlled Unclassified Information (CUI).',
        size: 24,
      })],
    }));
    children.push(new Paragraph({ text: '' }));
    // Paragraph 2: Architecture summary
    children.push(new Paragraph({
      children: [new TextRun({
        text: `The system operates on a ${ssp.hostingModel?.model ?? 'cloud'} hosting model (${ssp.hostingModel?.environment ?? 'Azure Government'}) with the authorization boundary encompassing ${ssp.authorizationBoundary?.zones?.length ?? 0} security zones. ${ssp.authorizationBoundary?.description ?? ''}`,
        size: 24,
      })],
    }));
    children.push(new Paragraph({ text: '' }));
    // Paragraph 3: Control summary
    {
      const metCount = ssp.controlImplementations.filter(c => c.status === 'met').length;
      const notMetCount = ssp.controlImplementations.filter(c => c.status === 'not_met').length;
      const notAssessedCtrlCount = ssp.controlImplementations.filter(c => c.status === 'not_assessed').length;
      const totalControls = ssp.controlImplementations.length;
      let controlSummary = `Of the ${totalControls} NIST SP 800-171 Rev 2 security requirements assessed, ${metCount} are fully implemented (MET), ${notMetCount} require remediation (NOT MET), and ${notAssessedCtrlCount} have not yet been assessed.`;
      if (ssp.poamSummary) {
        controlSummary += ` The Plan of Action and Milestones (POA&M) contains ${ssp.poamSummary.totalItems} items addressing ${ssp.poamSummary.totalWeightOnPoam} SPRS points, with a projected post-remediation score of ${ssp.poamSummary.projectedScoreAfterPoam}. Certification path: ${ssp.poamSummary.certificationPath.toUpperCase()}.`;
      }
      children.push(new Paragraph({
        children: [new TextRun({ text: controlSummary, size: 24 })],
      }));
    }
    children.push(new Paragraph({ text: '' }));
    // Paragraph 4: DFARS compliance statement boilerplate
    children.push(new Paragraph({
      children: [new TextRun({
        text: 'This SSP supports the organization\'s compliance with DFARS 252.204-7012 (Safeguarding Covered Defense Information and Cyber Incident Reporting) and DFARS 252.204-7021 (Cybersecurity Maturity Model Certification Requirements). The organization is pursuing CMMC Level 2 certification through assessment by an authorized C3PAO under 32 CFR Part 170.',
        size: 24,
      })],
    }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 1: System Identification ---
    children.push(...this.renderSection('1. System Identification', HeadingLevel.HEADING_1));
    children.push(...this.renderLabeledField('Organization Name', ssp.organizationName));
    children.push(...this.renderLabeledField('System Name', ssp.systemName));
    children.push(...this.renderLabeledField('System Description', ssp.systemDescription));
    children.push(...this.renderLabeledField('System Identifier', ssp.systemIdentifier));
    children.push(...this.renderLabeledField('CAGE Code', ssp.cageCode));
    children.push(...this.renderLabeledField('UEI Number', ssp.ueiNumber));
    children.push(...this.renderLabeledField('Tenant ID', ssp.tenantId));
    // System Type
    children.push(...this.renderLabeledField('System Type', ssp.systemType ?? '[MANUAL INPUT REQUIRED]'));
    // Operational Status
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Operational Status:', bold: true, size: 24 })],
    }));
    children.push(new Paragraph({
      children: [new TextRun({
        text: ssp.operationalStatus ?? '[MANUAL INPUT REQUIRED]',
        size: 24,
        ...(ssp.operationalStatus ? {} : { italics: true, color: 'FF0000' }),
      })],
    }));
    children.push(new Paragraph({ text: '' }));
    // CUI Categorization table
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'CUI Categorization' })],
    }));
    children.push(new Paragraph({ text: '' }));
    {
      const cuiRows = (ssp.cuiCategorization && ssp.cuiCategorization.length > 0)
        ? ssp.cuiCategorization.map(c => [c.type, c.category, c.marking, c.volume])
        : [['CTI', 'Controlled Technical Information', 'CUI//SP-CTI', '[MANUAL INPUT REQUIRED]']];
      children.push(this.renderTable(['Type', 'Category', 'Marking', 'Volume'], cuiRows));
    }
    children.push(new Paragraph({ text: '' }));
    // Responsible Parties table
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Responsible Parties' })],
    }));
    children.push(new Paragraph({ text: '' }));
    {
      const rpRows = (ssp.responsibleParties && ssp.responsibleParties.length > 0)
        ? ssp.responsibleParties.map(r => [r.role, r.name, r.title, r.contact])
        : [['System Owner', '[MANUAL INPUT REQUIRED]', '[MANUAL INPUT REQUIRED]', '[MANUAL INPUT REQUIRED]']];
      children.push(this.renderTable(['Role', 'Name', 'Title', 'Contact'], rpRows));
    }
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 2: System Environment and Architecture ---
    children.push(...this.renderSection('2. System Environment and Architecture', HeadingLevel.HEADING_1));
    // 2.1 Authorization Boundary (existing content)
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: '2.1 Authorization Boundary' })],
    }));
    children.push(new Paragraph({ text: '' }));
    children.push(...this.renderLabeledField('Boundary Description', ssp.authorizationBoundary?.description));
    // Bulleted list of zones
    if (ssp.authorizationBoundary?.zones && ssp.authorizationBoundary.zones.length > 0) {
      for (const zone of ssp.authorizationBoundary.zones) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: zone, size: 24 })],
        }));
      }
      children.push(new Paragraph({ text: '' }));
    }
    if (ssp.authorizationBoundary?.diagramPath) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Authorization Boundary Diagram:', bold: true, size: 24 })],
      }));
      children.push(new Paragraph({ text: '' }));
      children.push(...this.renderDiagram(ssp.authorizationBoundary.diagramPath));
    }
    // 2.2 CUI Data Flows
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: '2.2 CUI Data Flows' })],
    }));
    children.push(new Paragraph({ text: '' }));
    if (ssp.cuiDataFlows) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Ingress Paths:', bold: true, size: 24 })],
      }));
      for (const ingress of ssp.cuiDataFlows.ingress) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: ingress, size: 24 })],
        }));
      }
      children.push(new Paragraph({ text: '' }));
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Egress:', bold: true, size: 24 })],
      }));
      children.push(new Paragraph({
        children: [new TextRun({ text: ssp.cuiDataFlows.egress, size: 24 })],
      }));
      children.push(new Paragraph({ text: '' }));
      children.push(new Paragraph({
        children: [new TextRun({ text: ssp.cuiDataFlows.description, size: 24 })],
      }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text: '[MANUAL INPUT REQUIRED: Document CUI ingress, processing, storage, and egress paths.]', italics: true, color: 'FF0000', size: 24 })],
      }));
    }
    children.push(new Paragraph({ text: '' }));
    // 2.3 Shared Responsibility and Inheritance
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: '2.3 Shared Responsibility and Inheritance' })],
    }));
    children.push(new Paragraph({ text: '' }));
    if (ssp.sharedResponsibilityMatrix) {
      const crm = ssp.sharedResponsibilityMatrix;
      children.push(new Paragraph({
        children: [new TextRun({
          text: `Of the ${crm.totalControls} NIST SP 800-171 Rev 2 security requirements, ${crm.inherited} are fully inherited from the cloud service provider (CSP), ${crm.shared} are shared responsibility between the CSP and the organization, and ${crm.customer} are the sole responsibility of the organization.`,
          size: 24,
        })],
      }));
      children.push(new Paragraph({ text: '' }));
      // CRM table by family
      const crmRows = crm.byFamily.map(f => [f.family, String(f.inherited), String(f.shared), String(f.customer)]);
      crmRows.push(['TOTAL', String(crm.inherited), String(crm.shared), String(crm.customer)]);
      children.push(this.renderTable(['Control Family', 'Fully Inherited', 'Shared', 'Customer-Implemented'], crmRows));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text: '[MANUAL INPUT REQUIRED: Document shared responsibility matrix with CSP.]', italics: true, color: 'FF0000', size: 24 })],
      }));
    }
    children.push(new Paragraph({ text: '' }));

    // --- Section 2.4: FedRAMP Inherited Controls (if present) ---
    if ((ssp as any).inheritanceSection) {
      const inheritSec = (ssp as any).inheritanceSection;
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: '2.4 FedRAMP Inherited Controls' })],
      }));
      children.push(new Paragraph({ text: '' }));
      // Parent narrative
      const parentParagraphs = inheritSec.parentNarrative.split('\n\n');
      for (const para of parentParagraphs) {
        children.push(new Paragraph({
          children: [new TextRun({ text: para.trim(), size: 24 })],
        }));
      }
      children.push(new Paragraph({ text: '' }));
      // Per-control entries table
      const controlRows = inheritSec.controlEntries.map((c: any) => [
        c.control_id,
        c.status === 'met' ? 'Inherited' : 'Pending Review',
        c.implementationNarrative.substring(0, 200) + (c.implementationNarrative.length > 200 ? '...' : '')
      ]);
      children.push(this.renderTable(['Control ID', 'Status', 'Summary'], controlRows));
      children.push(new Paragraph({ text: '' }));
    }

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 3: System Components ---
    children.push(...this.renderSection('3. System Components', HeadingLevel.HEADING_1));
    if (ssp.systemComponents?.sections) {
      for (const section of ssp.systemComponents.sections) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: section.name })],
        }));
        children.push(new Paragraph({ text: '' }));
        if (section.components && section.components.length > 0) {
          for (const comp of section.components) {
            const compText = typeof comp === 'string' ? comp : (comp as any).name ?? String(comp);
            children.push(new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: compText, size: 24 })],
            }));
          }
          children.push(new Paragraph({ text: '' }));
        }
      }
    }
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 4: Network Topology ---
    children.push(...this.renderSection('4. Network Topology', HeadingLevel.HEADING_1));
    children.push(...this.renderLabeledField('Network Description', ssp.networkTopology?.description));
    if (ssp.networkTopology?.topology && ssp.networkTopology.topology.length > 0) {
      for (const item of ssp.networkTopology.topology) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: item, size: 24 })],
        }));
      }
      children.push(new Paragraph({ text: '' }));
    }
    if (ssp.networkTopology?.diagramPath) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Network Topology Diagram:', bold: true, size: 24 })],
      }));
      children.push(new Paragraph({ text: '' }));
      children.push(...this.renderDiagram(ssp.networkTopology.diagramPath));
    }
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 5: Interconnections ---
    children.push(...this.renderSection('5. Interconnections', HeadingLevel.HEADING_1));
    const interconnectionRows = (ssp.interconnections && ssp.interconnections.length > 0)
      ? ssp.interconnections.map(ic => [ic.name, ic.type, ic.description])
      : [['None', 'N/A', 'No interconnections defined']];
    children.push(this.renderTable(['Name', 'Type', 'Description'], interconnectionRows));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 6: Hosting Model ---
    children.push(...this.renderSection('6. Hosting Model', HeadingLevel.HEADING_1));
    children.push(...this.renderLabeledField('Model', ssp.hostingModel?.model));
    children.push(...this.renderLabeledField('Environment', ssp.hostingModel?.environment));
    children.push(...this.renderLabeledField('Tech Stack', ssp.hostingModel?.techStack));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 7: Roles and Responsibilities ---
    children.push(...this.renderSection('7. Roles and Responsibilities', HeadingLevel.HEADING_1));
    const roleRows = (ssp.rolesAndResponsibilities && ssp.rolesAndResponsibilities.length > 0)
      ? ssp.rolesAndResponsibilities.map(r => [
          r.role,
          r.responsibilities.join('; '),
          r.controlIds.join(', '),
        ])
      : [['None', 'N/A', 'N/A']];
    children.push(this.renderTable(['Role', 'Responsibilities', 'Control IDs'], roleRows));
    children.push(new Paragraph({ text: '' }));

    // PageBreak after Section 7
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 8: Security Controls Implementation ---
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: '8. Security Controls Implementation' })],
    }));
    children.push(new Paragraph({ text: '' }));

    const families = Array.from(new Set(ssp.controlImplementations.map((c: any) => c.family))).filter(Boolean).sort() as string[];

    for (const family of families) {
      // Family heading
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: `${family} Family` })],
      }));
      // Family overview paragraph
      const overviewText = this.familyOverviews.get(family);
      if (overviewText) {
        children.push(new Paragraph({
          children: [new TextRun({
            text: overviewText,
            size: 24,
          })],
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({
            text: `[MANUAL INPUT REQUIRED: Describe organizational approach to ${family} family controls]`,
            italics: true,
            color: 'FF0000',
            size: 24,
          })],
        }));
      }
      children.push(new Paragraph({ text: '' }));

      const familyControls = ssp.controlImplementations.filter((c: any) => c.family === family);

      for (const control of familyControls) {
        // Control heading (H3)
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: `${control.control_id} \u2014 ${control.nist_ref}` })],
        }));
        // Requirement (bold label)
        children.push(new Paragraph({
          children: [
            new TextRun({ text: 'Requirement: ', bold: true, size: 24 }),
            new TextRun({ text: control.practice, size: 24 }),
          ],
        }));
        children.push(new Paragraph({ text: '' }));
        // Status with Unicode checkboxes — directive-aware when sprsValue present
        {
          const ctrl = control as any;
          let statusText: string;
          let statusColor = '000000';

          if (ctrl.sprsValue) {
            // Directive-aware status rendering
            const directiveStatusMap: Record<string, string> = {
              'implement': ctrl.directiveMetadata?.enforcement_verified ? 'Implemented' : 'Not Yet Implemented \u2014 See POA&M',
              'validate': 'Implemented',
              'manual': ctrl.directiveMetadata?.platform_inherited ? 'Inherited from Microsoft FedRAMP High' : 'Implemented',
              'document-absence': 'Not Applicable to This Environment',
              'document-prohibition': ctrl.directiveMetadata?.enforcement_verified ? 'Implemented Through Prohibition' : 'Not Yet Implemented \u2014 See POA&M',
              'inherit-fedramp': ctrl.directiveMetadata?.readiness === 'met' ? 'Inherited from FedRAMP High CSP' : 'Pending FedRAMP Inheritance Review',
            };
            statusText = (ctrl.directive && directiveStatusMap[ctrl.directive]) || control.status;

            if (ctrl.sprsValue === 'MET') statusColor = '008000';
            else if (ctrl.sprsValue === 'NOT_MET') statusColor = 'FF0000';
            else if (ctrl.sprsValue === 'N/A') statusColor = 'FFA500';
          } else {
            // Fallback: legacy checkbox rendering
            const statusChecks: string[] = [];
            statusChecks.push(control.status === 'met' ? '\u2612 Implemented' : '\u2610 Implemented');
            statusChecks.push(control.status === 'not_met' ? '\u2612 Planned' : '\u2610 Planned');
            statusChecks.push(control.status === 'not_assessed' ? '\u2612 Not Applicable' : '\u2610 Not Applicable');
            statusText = statusChecks.join('  ');
            if (control.status === 'met') statusColor = '008000';
            else if (control.status === 'not_met') statusColor = 'FF0000';
            else if (control.status === 'not_assessed') statusColor = 'FFA500';
          }

          children.push(new Paragraph({
            children: [
              new TextRun({ text: 'Implementation Status: ', bold: true, size: 24 }),
              new TextRun({ text: statusText, size: 24, color: statusColor }),
            ],
          }));

          // SPRS determination line (when directive present)
          if (ctrl.sprsValue) {
            children.push(new Paragraph({
              children: [
                new TextRun({ text: 'SPRS Determination: ', bold: true, size: 24 }),
                new TextRun({ text: ctrl.sprsValue, size: 24, color: statusColor }),
              ],
            }));
            if (ctrl.sprsRationale) {
              children.push(new Paragraph({
                children: [
                  new TextRun({ text: 'Rationale: ', bold: true, size: 24 }),
                  new TextRun({ text: ctrl.sprsRationale, size: 24, italics: true }),
                ],
              }));
            }
          }
        }
        children.push(new Paragraph({ text: '' }));
        // Implementation (bold label, multi-paragraph support)
        children.push(new Paragraph({
          children: [new TextRun({ text: 'Implementation:', bold: true, size: 24 })],
        }));
        {
          const narrativeParagraphs = control.implementationNarrative.split('\n\n');
          for (const para of narrativeParagraphs) {
            children.push(new Paragraph({
              children: [new TextRun({ text: para.trim(), size: 24 })],
            }));
          }
        }
        children.push(new Paragraph({ text: '' }));
        // Responsible Role
        children.push(new Paragraph({
          children: [new TextRun({ text: `Responsible Role: ${control.responsibleRole}`, size: 24 })],
        }));
        children.push(new Paragraph({ text: '' }));
        // Evidence Artifacts (3-column table)
        children.push(new Paragraph({
          children: [new TextRun({ text: 'Evidence Artifacts:', bold: true, size: 24 })],
        }));
        children.push(this.renderEvidenceTable(control.evidenceReferences));
        children.push(new Paragraph({ text: '' }));
        // Related Policies
        if (control.relatedPolicies && control.relatedPolicies.length > 0) {
          children.push(new Paragraph({
            children: [new TextRun({ text: 'Related Policies:', bold: true, size: 24 })],
          }));
          for (const policy of control.relatedPolicies) {
            const policyTitle = typeof policy === 'string' ? policy : policy.title;
            children.push(new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: policyTitle, size: 24 })],
            }));
          }
          children.push(new Paragraph({ text: '' }));
        }
        // Classification
        const classLabel = control.classification === 'nonstack' ? 'Non-Technology Stack'
          : control.classification === 'manual' ? 'Manual' : 'Automated';
        children.push(new Paragraph({
          children: [new TextRun({ text: `Classification: ${classLabel}`, size: 24, italics: control.classification === 'nonstack' })],
        }));
        children.push(new Paragraph({ text: '' }));
        // Assessment Objectives
        if (control.assessmentObjectives && control.assessmentObjectives.length > 0) {
          children.push(new Paragraph({
            children: [new TextRun({ text: 'Assessment Objectives:', bold: true, size: 24 })],
          }));
          children.push(this.renderObjectivesTable(control.assessmentObjectives));
          children.push(new Paragraph({ text: '' }));
        }
      }
    }

    // PageBreak after Section 8
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 9: Organization-Defined Parameters ---
    children.push(...this.renderSection('9. Organization-Defined Parameters', HeadingLevel.HEADING_1));

    // Extract and deduplicate ODP values from all control implementations
    const odpMap = new Map<string, { parameter: string; value: string; source: string }>();
    for (const control of ssp.controlImplementations) {
      if (control.odpValues && control.odpValues.length > 0) {
        for (const odp of control.odpValues) {
          if (!odpMap.has(odp.parameter)) {
            odpMap.set(odp.parameter, {
              parameter: odp.parameter,
              value: odp.value,
              source: odp.source,
            });
          }
        }
      }
    }

    if (odpMap.size > 0) {
      const odpRows = Array.from(odpMap.values()).map(odp => [odp.parameter, odp.value, odp.source]);
      children.push(this.renderTable(['Parameter', 'Value', 'Source'], odpRows));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({
          text: 'No organization-defined parameters have been configured for this system.',
          italics: true,
          size: 24,
        })],
      }));
    }

    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 10: Assessment Objectives ---
    children.push(...this.renderSection('10. Assessment Objectives', HeadingLevel.HEADING_1));

    // Aggregate all assessment objectives from control implementations
    const allObjectives: Array<{ controlId: string; objectiveId: string; description: string; status: string }> = [];
    for (const control of ssp.controlImplementations) {
      if (control.assessmentObjectives && control.assessmentObjectives.length > 0) {
        for (const obj of control.assessmentObjectives) {
          allObjectives.push({
            controlId: control.control_id,
            objectiveId: obj.objectiveId,
            description: obj.description,
            status: obj.status,
          });
        }
      }
    }

    // Calculate summary stats
    const total = allObjectives.length;
    const satisfiedCount = allObjectives.filter(o => o.status === 'satisfied').length;
    const otherCount = allObjectives.filter(o => o.status === 'other_than_satisfied').length;
    const notAssessedCount = allObjectives.filter(o => o.status === 'not_assessed').length;

    // Summary paragraph
    children.push(new Paragraph({
      children: [new TextRun({
        text: `This section provides a consolidated view of all ${total} assessment objectives from NIST SP 800-171A Rev 2. Of these, ${satisfiedCount} are satisfied, ${otherCount} are other than satisfied, and ${notAssessedCount} are not assessed.`,
        size: 24,
      })],
    }));
    children.push(new Paragraph({ text: '' }));

    // Group objectives by family and render per-family tables
    const objectivesByFamily = new Map<string, Array<{ controlId: string; objectiveId: string; description: string; status: string }>>();
    for (const obj of allObjectives) {
      const family = obj.controlId.split('.')[0];
      if (!objectivesByFamily.has(family)) {
        objectivesByFamily.set(family, []);
      }
      objectivesByFamily.get(family)!.push(obj);
    }

    const sortedFamilies = Array.from(objectivesByFamily.keys()).sort();
    for (const family of sortedFamilies) {
      const familyObjectives = objectivesByFamily.get(family)!;
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: `${family} Family Assessment Objectives` })],
      }));
      children.push(new Paragraph({ text: '' }));
      children.push(this.renderAssessmentObjectivesSummaryTable(familyObjectives));
      children.push(new Paragraph({ text: '' }));
    }

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 11: Risk Assessment ---
    children.push(...this.renderSection('11. Risk Assessment', HeadingLevel.HEADING_1));
    if (ssp.riskAssessment) {
      children.push(...this.renderLabeledField('Summary', ssp.riskAssessment.summary));
      children.push(...this.renderLabeledField('Methodology', ssp.riskAssessment.methodology));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({
          text: '[MANUAL INPUT REQUIRED: Describe risk assessment methodology, identified threats, and mitigation strategies per NIST SP 800-30 Rev 1.]',
          italics: true,
          bold: true,
          color: 'FF0000',
          size: 24,
        })],
      }));
    }
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 12: Continuous Monitoring ---
    children.push(...this.renderSection('12. Continuous Monitoring', HeadingLevel.HEADING_1));
    if (ssp.continuousMonitoring) {
      children.push(...this.renderLabeledField('Strategy', ssp.continuousMonitoring.strategy));
      if (ssp.continuousMonitoring.tools.length > 0) {
        children.push(new Paragraph({
          children: [new TextRun({ text: 'Monitoring Tools:', bold: true, size: 24 })],
        }));
        for (const tool of ssp.continuousMonitoring.tools) {
          children.push(new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: tool, size: 24 })],
          }));
        }
        children.push(new Paragraph({ text: '' }));
      }
      children.push(...this.renderLabeledField('Frequency', ssp.continuousMonitoring.frequency));
      children.push(...this.renderLabeledField('Responsible Party', ssp.continuousMonitoring.responsibleParty));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({
          text: '[MANUAL INPUT REQUIRED: Describe continuous monitoring strategy, tools, frequency, and responsible parties.]',
          italics: true,
          bold: true,
          color: 'FF0000',
          size: 24,
        })],
      }));
    }
    children.push(new Paragraph({ text: '' }));

    // 12.1 Scope and Frequencies
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: '12.1 Scope and Frequencies' })],
    }));
    children.push(new Paragraph({ text: '' }));
    {
      const cmActivities = ssp.continuousMonitoringActivities ?? [
        { activity: 'Vulnerability Scanning', frequency: 'Monthly', owner: 'System Administrator', output: 'Vulnerability scan report' },
        { activity: 'Configuration Compliance Audit', frequency: 'Quarterly', owner: 'ISSO', output: 'Configuration compliance report' },
        { activity: 'SIEM Log Review', frequency: 'Daily', owner: 'Security Operations', output: 'Daily security event summary' },
        { activity: 'Access Review (Privileged)', frequency: 'Quarterly', owner: 'System Owner', output: 'Access review attestation' },
        { activity: 'Access Review (Standard)', frequency: 'Semi-annually', owner: 'System Owner', output: 'Access review attestation' },
        { activity: 'Phishing Simulation', frequency: 'Monthly', owner: 'ISSO', output: 'Phishing simulation report' },
        { activity: 'Security Awareness Training', frequency: 'Annually', owner: 'ISSO', output: 'Training completion records' },
        { activity: 'Incident Response Drill', frequency: 'Annually', owner: 'ISSO', output: 'After-action report' },
        { activity: 'Backup Verification', frequency: 'Monthly', owner: 'System Administrator', output: 'Backup verification log' },
        { activity: 'Patch Management Review', frequency: 'Monthly', owner: 'System Administrator', output: 'Patch compliance report' },
        { activity: 'DLP Policy Review', frequency: 'Quarterly', owner: 'CUI Program Manager', output: 'DLP effectiveness report' },
        { activity: 'Conditional Access Policy Review', frequency: 'Quarterly', owner: 'ISSO', output: 'Policy review documentation' },
        { activity: 'Sensitivity Label Audit', frequency: 'Quarterly', owner: 'CUI Program Manager', output: 'Label usage report' },
        { activity: 'SPRS Score Recalculation', frequency: 'Quarterly', owner: 'ISSO', output: 'Updated SPRS scorecard' },
        { activity: 'SSP Review and Update', frequency: 'Annually', owner: 'System Owner', output: 'Updated SSP document' },
      ];
      const activityRows = cmActivities.map(a => [a.activity, a.frequency, a.owner, a.output]);
      children.push(this.renderTable(['Activity', 'Frequency', 'Owner', 'Output'], activityRows));
    }
    children.push(new Paragraph({ text: '' }));

    // 12.2 Metrics and Reporting
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: '12.2 Metrics and Reporting' })],
    }));
    children.push(new Paragraph({ text: '' }));
    {
      const metricsText = ssp.continuousMonitoringMetrics ??
        'The organization tracks Key Performance Indicators (KPIs) for continuous monitoring effectiveness including vulnerability remediation rates, mean time to detect/respond, baseline compliance percentages, phishing simulation results, training completion rates, patch compliance, DLP violations, MFA enrollment, and SPRS score trends. These KPIs are reported to senior leadership quarterly.';
      const metricsParagraphs = metricsText.split('\n\n');
      for (const para of metricsParagraphs) {
        children.push(new Paragraph({
          children: [new TextRun({ text: para.trim(), size: 24 })],
        }));
      }
    }
    children.push(new Paragraph({ text: '' }));

    // 12.3 Change-Triggered Reassessment
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: '12.3 Change-Triggered Reassessment' })],
    }));
    children.push(new Paragraph({ text: '' }));
    {
      const reassessText = ssp.changeTriggeredReassessment ??
        'Per NIST SP 800-137 and organizational policy, significant changes to the system architecture, authorization boundary, threat environment, or regulatory requirements trigger a targeted reassessment of affected security controls within 30 days. Results are documented in the continuous monitoring log and the SSP is updated accordingly.';
      const reassessParagraphs = reassessText.split('\n\n');
      for (const para of reassessParagraphs) {
        children.push(new Paragraph({
          children: [new TextRun({ text: para.trim(), size: 24 })],
        }));
      }
    }
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 13: Incident Response ---
    children.push(...this.renderSection('13. Incident Response', HeadingLevel.HEADING_1));
    if (ssp.incidentResponse) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Procedures:', bold: true, size: 24 })],
      }));
      children.push(new Paragraph({
        children: [new TextRun({ text: ssp.incidentResponse.procedures, size: 24 })],
      }));
      children.push(new Paragraph({ text: '' }));

      if (ssp.incidentResponse.contacts.length > 0) {
        children.push(new Paragraph({
          children: [new TextRun({ text: 'Primary Contacts:', bold: true, size: 24 })],
        }));
        for (const contact of ssp.incidentResponse.contacts) {
          children.push(new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: `${contact.role}: ${contact.name} (${contact.email})`, size: 24 })],
          }));
        }
        children.push(new Paragraph({ text: '' }));
      }

      children.push(...this.renderLabeledField('Escalation Path', ssp.incidentResponse.escalationPath));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({
          text: '[MANUAL INPUT REQUIRED: Describe incident response procedures, escalation paths, and communication protocols per NIST SP 800-61 Rev 2.]',
          italics: true,
          bold: true,
          color: 'FF0000',
          size: 24,
        })],
      }));
    }
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 14: Plan of Action and Milestones ---
    children.push(...this.renderSection('14. Plan of Action and Milestones', HeadingLevel.HEADING_1));
    if (ssp.poamSummary) {
      children.push(new Paragraph({
        children: [new TextRun({
          text: `This system has ${ssp.poamSummary.totalItems} open POA&M items addressing ${ssp.poamSummary.totalWeightOnPoam} SPRS points. Projected SPRS score after POA&M remediation: ${ssp.poamSummary.projectedScoreAfterPoam}. Certification path: ${ssp.poamSummary.certificationPath.toUpperCase()}.`,
          size: 24,
        })],
      }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({
          text: '[MANUAL INPUT REQUIRED: POA&M summary not available. Generate POA&M document and pass to SSP generator to auto-populate this section.]',
          italics: true,
          color: 'FF0000',
          size: 24,
        })],
      }));
    }
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Section 15: Document Control ---
    children.push(...this.renderSection('15. Document Control', HeadingLevel.HEADING_1));
    children.push(...this.renderLabeledField('Document Owner', ssp.preparedBy?.name));
    children.push(...this.renderLabeledField('Last Updated', ssp.generatedAt));
    children.push(...this.renderLabeledField('Next Review Date', undefined));
    children.push(...this.renderLabeledField('Approval Authority', ssp.authorizingOfficial?.name));

    // PageBreak before Appendices
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Appendices ---
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Appendices' })],
    }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({
      children: [new TextRun({
        text: 'The following appendices are maintained as separate controlled documents and are referenced throughout this System Security Plan. Each appendix is subject to the same CUI handling and distribution requirements as this SSP.',
        size: 24,
      })],
    }));
    children.push(new Paragraph({ text: '' }));
    {
      const appendixList = ssp.appendices ?? [
        { id: 'A', documentId: '[MANUAL INPUT REQUIRED]', title: 'Network Architecture Diagram', summary: 'Visual representation of the network architecture including all in-scope segments and trust boundaries.' },
        { id: 'B', documentId: '[MANUAL INPUT REQUIRED]', title: 'Data Flow Diagrams', summary: 'CUI data flow diagrams showing ingress, processing, storage, and egress paths.' },
        { id: 'C', documentId: '[MANUAL INPUT REQUIRED]', title: 'System Authorization Boundary Diagram', summary: 'Visual representation of the authorization boundary with all in-scope components identified.' },
        { id: 'D', documentId: '[MANUAL INPUT REQUIRED]', title: 'Hardware and Software Inventory', summary: 'Complete inventory of in-scope hardware and software components with version information.' },
        { id: 'E', documentId: '[MANUAL INPUT REQUIRED]', title: 'Policy Library Index', summary: 'Index of all security policies referenced in this SSP with document IDs and revision dates.' },
        { id: 'F', documentId: '[MANUAL INPUT REQUIRED]', title: 'Interconnection Security Agreements', summary: 'ISAs governing data exchange with external systems and service providers.' },
        { id: 'G', documentId: '[MANUAL INPUT REQUIRED]', title: 'Incident Response Plan', summary: 'Standalone IR plan with DFARS 252.204-7012 reporting procedures and CIRT composition.' },
        { id: 'H', documentId: '[MANUAL INPUT REQUIRED]', title: 'Configuration Management Plan', summary: 'CM plan with baseline configurations, change control process, and patching SLAs.' },
        { id: 'I', documentId: '[MANUAL INPUT REQUIRED]', title: 'Continuous Monitoring Plan', summary: 'ISCM plan with assessment frequencies, reporting chain, and escalation procedures.' },
        { id: 'J', documentId: '[MANUAL INPUT REQUIRED]', title: 'Acceptable Use Policy', summary: 'User guide and acceptable use policy for CUI handling on organizational systems.' },
        { id: 'K', documentId: '[MANUAL INPUT REQUIRED]', title: 'Acronym and Abbreviation List', summary: 'Glossary of acronyms and abbreviations used throughout this SSP.' },
        { id: 'L', documentId: '[MANUAL INPUT REQUIRED]', title: 'References', summary: 'Standards, regulations, and contract clauses referenced in this SSP.' },
        { id: 'M', documentId: '[MANUAL INPUT REQUIRED]', title: 'Risk Register', summary: 'Organizational risk register with identified threats, vulnerabilities, and risk mitigation strategies.' },
      ];

      // Render each appendix with special handling for Mermaid diagrams
      for (const appendix of appendixList) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: `Appendix ${appendix.id}: ${appendix.title}` })],
        }));

        // Check for rendered SVG/PNG path in appendix metadata
        const svgPath = (appendix as any).svgPath as string | undefined;
        if (svgPath && fs.existsSync(svgPath)) {
          // Embed rendered diagram as image
          try {
            const imageBuffer = fs.readFileSync(svgPath);
            const ext = path.extname(svgPath).toLowerCase();
            if (['.png', '.jpg', '.jpeg'].includes(ext)) {
              children.push(new Paragraph({
                children: [
                  new ImageRun({
                    data: imageBuffer,
                    transformation: { width: 600, height: 400 },
                  }),
                ],
              }));
              children.push(new Paragraph({ text: '' }));
              continue;
            }
          } catch (imgErr) {
            console.warn(`[SspDocxExporter] Failed to embed diagram image ${svgPath}:`, imgErr instanceof Error ? imgErr.message : String(imgErr));
          }
          // Fall through to Mermaid/text rendering if image embedding failed
        }

        const content = appendix.summary;
        const isMermaid = content.startsWith('graph ') || content.startsWith('sequenceDiagram') || content.startsWith('flowchart ');

        if (isMermaid) {
          // Instruction paragraph for Mermaid diagrams
          children.push(new Paragraph({
            children: [new TextRun({
              text: 'The diagram below is in Mermaid syntax. Render using mermaid.live or VS Code Mermaid extension.',
              italics: true,
              size: 20,
            })],
            spacing: { after: 200 },
          }));
          // Code block with monospace font and gray background
          children.push(new Paragraph({
            children: [new TextRun({
              text: content,
              font: 'Courier New',
              size: 18,
            })],
            shading: { fill: 'F0F0F0' },
            spacing: { before: 100, after: 100 },
          }));
        } else if (content.startsWith('[')) {
          // Placeholder or error message
          children.push(new Paragraph({
            children: [new TextRun({ text: content, size: 22 })],
          }));
        } else {
          // Normal content (markdown tables, text)
          children.push(new Paragraph({
            children: [new TextRun({ text: content, size: 22 })],
          }));
        }

        children.push(new Paragraph({ text: '' }));
      }

      // Also render as summary table for quick reference
      const appendixRows = appendixList.map(a => [a.id, a.documentId, a.title, a.summary.substring(0, 80) + (a.summary.length > 80 ? '...' : '')]);
      children.push(this.renderTable(['Appendix', 'Document ID', 'Title', 'Summary'], appendixRows));
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              pageNumbers: {
                start: 1,
                formatType: NumberFormat.DECIMAL,
              },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: 'CUI',
                      size: 20, // 10pt
                    }),
                  ],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: 'CUI // SP-SSP // CMMC L2',
                      size: 16, // 8pt
                    }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    return Buffer.from(buffer);
  }

  private extractFirstComponentName(ssp: SystemSecurityPlan): string {
    const sections = ssp.systemComponents?.sections;
    if (!sections || sections.length === 0) return 'N/A';
    const first = sections[0];
    if (!first.components || first.components.length === 0) return 'N/A';
    const comp = first.components[0];
    // Handle both string components and object components with .name
    if (typeof comp === 'string') return comp;
    if (typeof comp === 'object' && comp !== null && 'name' in comp) {
      return (comp as { name: string }).name;
    }
    return 'N/A';
  }

  private renderDiagram(imagePath: string): any[] {
    try {
      if (!fs.existsSync(imagePath)) {
        console.warn(`Diagram file not found: ${imagePath}`);
        return [];
      }

      const imageBuffer = fs.readFileSync(imagePath);
      const ext = path.extname(imagePath).toLowerCase();

      if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
        console.warn(`Unsupported diagram format: ${ext}. Only PNG/JPG supported.`);
        return [];
      }

      return [
        new Paragraph({
          children: [
            new ImageRun({
              data: imageBuffer,
              transformation: {
                width: 600,
                height: 400,
              },
            }),
          ],
        }),
        new Paragraph({ text: '' }),
      ];
    } catch (err) {
      console.warn(`Failed to render diagram ${imagePath}:`, err);
      return [];
    }
  }

  private renderSection(title: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]): any[] {
    return [
      new Paragraph({
        heading: level,
        children: [new TextRun({ text: title })],
      }),
      new Paragraph({ text: '' }),
    ];
  }

  private renderLabeledField(label: string, value: string | undefined, missingPlaceholder = '[MANUAL INPUT REQUIRED]'): any[] {
    const valueRun = value
      ? new TextRun({ text: value, size: 24 })
      : new TextRun({ text: missingPlaceholder, italics: true, color: 'FF0000', size: 24 });
    return [
      new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 24 }),
          valueRun,
        ],
      }),
      new Paragraph({ text: '' }),
    ];
  }

  private renderTable(headers: string[], rows: string[][]): any {
    const borderStyle = {
      style: BorderStyle.SINGLE,
      size: 1,
      color: '000000',
    };
    const borders = {
      top: borderStyle,
      bottom: borderStyle,
      left: borderStyle,
      right: borderStyle,
    };

    const headerRow = new TableRow({
      children: headers.map((h: string) =>
        new TableCell({
          borders,
          width: { size: 0, type: WidthType.AUTO },
          children: [new Paragraph({
            children: [new TextRun({ text: h, bold: true, size: 24 })],
          })],
        })
      ),
    });

    const dataRows = rows.map((row: string[]) =>
      new TableRow({
        children: row.map((cell: string) =>
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: cell, size: 24 })],
            })],
          })
        ),
      })
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    });
  }

  private renderEvidenceTable(evidenceReferences: string[]): any {
    if (!evidenceReferences || evidenceReferences.length === 0) {
      return this.renderTable(
        ['Reference ID', 'Description', 'Source'],
        [['No evidence artifacts', '', '']],
      );
    }
    const rows = evidenceReferences.map((id: string) => [id, 'Evidence artifact', 'EO Assessment']);
    return this.renderTable(['Reference ID', 'Description', 'Source'], rows);
  }

  private renderObjectivesTable(objectives: Array<{ objectiveId: string; description: string; status: string; methods?: string[] }>): any {
    const borders = {
      top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    };

    const headerRow = new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 20, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: 'Objective ID', bold: true, size: 24 })],
          })],
        }),
        new TableCell({
          borders,
          width: { size: 45, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: 'Description', bold: true, size: 24 })],
          })],
        }),
        // ADDITIVE: NIST SP 800-171A assessment methods column (assessor guidance).
        new TableCell({
          borders,
          width: { size: 15, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: 'Methods', bold: true, size: 24 })],
          })],
        }),
        new TableCell({
          borders,
          width: { size: 20, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: 'Status', bold: true, size: 24 })],
          })],
        }),
      ],
    });

    const dataRows = objectives.map((obj) => {
      let statusColor = '808080';
      if (obj.status === 'satisfied') statusColor = '00B050';
      else if (obj.status === 'other_than_satisfied') statusColor = 'FF0000';

      const methodsText = obj.methods && obj.methods.length > 0
        ? obj.methods.join(', ')
        : 'examine';

      return new TableRow({
        children: [
          new TableCell({
            borders,
            width: { size: 20, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [new TextRun({ text: obj.objectiveId, size: 24 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 45, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [new TextRun({ text: obj.description, size: 24 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 15, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [new TextRun({ text: methodsText, size: 24 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 20, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [new TextRun({ text: obj.status, size: 24, color: statusColor })],
            })],
          }),
        ],
      });
    });

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    });
  }

  private renderAssessmentObjectivesSummaryTable(objectives: Array<{ controlId: string; objectiveId: string; description: string; status: string }>): any {
    const borders = {
      top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    };

    const headerRow = new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 15, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: 'Control ID', bold: true, size: 24 })],
          })],
        }),
        new TableCell({
          borders,
          width: { size: 20, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: 'Objective ID', bold: true, size: 24 })],
          })],
        }),
        new TableCell({
          borders,
          width: { size: 45, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: 'Description', bold: true, size: 24 })],
          })],
        }),
        new TableCell({
          borders,
          width: { size: 20, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: 'Status', bold: true, size: 24 })],
          })],
        }),
      ],
    });

    const dataRows = objectives.map((obj) => {
      let statusColor = '808080'; // gray for not_assessed
      if (obj.status === 'satisfied') statusColor = '00B050'; // green
      else if (obj.status === 'other_than_satisfied') statusColor = 'FF0000'; // red

      return new TableRow({
        children: [
          new TableCell({
            borders,
            width: { size: 15, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [new TextRun({ text: obj.controlId, size: 24 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 20, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [new TextRun({ text: obj.objectiveId, size: 24 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 45, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [new TextRun({ text: obj.description, size: 24 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 20, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [new TextRun({ text: obj.status, size: 24, color: statusColor })],
            })],
          }),
        ],
      });
    });

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    });
  }
}
