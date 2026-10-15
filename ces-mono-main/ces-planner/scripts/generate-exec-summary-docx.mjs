// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Generate DOCX Executive Summary: CES CMMC Self-Assessment
 * Run: node scripts/generate-exec-summary-docx.mjs
 * Output: docs/CES_CMMC_Executive_Summary.docx
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Footer,
  PageNumber,
  NumberFormat,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '..', 'docs', 'CES_CMMC_Executive_Summary.docx');

// ── Color constants ──
const VFS_BLUE = '1B3A5C';
const VFS_GRAY = '4A4A4A';
const LIGHT_GRAY = 'F2F2F2';
const ACCENT_GREEN = '2E7D32';
const ACCENT_RED = 'C62828';
const BORDER_GRAY = 'CCCCCC';

// ── Helper: horizontal rule ──
function hr() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER_GRAY } },
    spacing: { before: 200, after: 200 },
  });
}

// ── Helper: bullet point ──
function bullet(text, opts = {}) {
  const runs = [];
  // Support bold prefix via **text** pattern
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, font: 'Calibri', size: 22, color: VFS_GRAY }));
    } else {
      runs.push(new TextRun({ text: part, font: 'Calibri', size: 22, color: VFS_GRAY }));
    }
  }
  return new Paragraph({
    children: runs,
    bullet: { level: opts.level || 0 },
    spacing: { before: 60, after: 60 },
  });
}

// ── Helper: body paragraph ──
function body(text) {
  const runs = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, font: 'Calibri', size: 22, color: VFS_GRAY }));
    } else {
      runs.push(new TextRun({ text: part, font: 'Calibri', size: 22, color: VFS_GRAY }));
    }
  }
  return new Paragraph({
    children: runs,
    spacing: { before: 120, after: 120 },
  });
}

// ── Helper: heading ──
function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    text,
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 360 : 240, after: 120 },
    color: VFS_BLUE,
  });
}

// ── Helper: callout box (verdict box) ──
function verdictBox(text) {
  return new Table({
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text, bold: true, font: 'Calibri', size: 24, color: ACCENT_GREEN }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 200, after: 200 },
              }),
            ],
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { fill: 'E8F5E9' },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 2, color: ACCENT_GREEN },
              bottom: { style: BorderStyle.SINGLE, size: 2, color: ACCENT_GREEN },
              left: { style: BorderStyle.SINGLE, size: 2, color: ACCENT_GREEN },
              right: { style: BorderStyle.SINGLE, size: 2, color: ACCENT_GREEN },
            },
          }),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ── Helper: key-value table ──
function kvTable(rows) {
  return new Table({
    rows: rows.map(([key, value], i) =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: key, bold: true, font: 'Calibri', size: 20, color: VFS_BLUE })],
              spacing: { before: 60, after: 60 },
            })],
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: { fill: i % 2 === 0 ? LIGHT_GRAY : 'FFFFFF' },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
              left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
              right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
            },
          }),
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: value, font: 'Calibri', size: 20, color: VFS_GRAY })],
              spacing: { before: 60, after: 60 },
            })],
            width: { size: 70, type: WidthType.PERCENTAGE },
            shading: { fill: i % 2 === 0 ? LIGHT_GRAY : 'FFFFFF' },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
              left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
              right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
            },
          }),
        ],
      })
    ),
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ── Build the document ──
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 22, color: VFS_GRAY },
      },
      heading1: {
        run: { font: 'Calibri', size: 32, bold: true, color: VFS_BLUE },
      },
      heading2: {
        run: { font: 'Calibri', size: 26, bold: true, color: VFS_BLUE },
      },
      heading3: {
        run: { font: 'Calibri', size: 22, bold: true, color: VFS_BLUE },
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: 'CES CMMC Self-Assessment  |  ', font: 'Calibri', size: 16, color: BORDER_GRAY }),
                new TextRun({ text: 'Page ', font: 'Calibri', size: 16, color: BORDER_GRAY }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 16, color: BORDER_GRAY }),
              ],
            }),
          ],
        }),
      },
      children: [
        // ── Cover / Title Block ──
        new Paragraph({ spacing: { before: 600 } }),
        new Paragraph({
          children: [
            new TextRun({ text: 'CMMC L2 SCOPING & SELF-ASSESSMENT', font: 'Calibri', size: 40, bold: true, color: VFS_BLUE }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Compliance Engineering Suite (CES)', font: 'Calibri', size: 30, color: VFS_GRAY }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        hr(),
        new Paragraph({
          children: [
            new TextRun({ text: 'EXECUTIVE SUMMARY', font: 'Calibri', size: 24, bold: true, color: VFS_BLUE, allCaps: true }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
        }),
        kvTable([
          ['Date', '2026-03-22'],
          ['Author', 'VFS Advisory \u2014 Compliance Engineering'],
          ['Classification', 'Internal Use Only \u2014 Not CUI'],
          ['Audience', 'VFS Executives, CMMC Advisors, Assessor-Facing Staff'],
          ['Full Report', 'docs/CES_CMMC_SELF_ASSESSMENT.md'],
        ]),
        new Paragraph({ spacing: { before: 200 } }),

        // ── Verdict ──
        verdictBox('VERDICT:  CES is OUT OF SCOPE for CMMC Level 2 Assessment'),
        new Paragraph({ spacing: { before: 200 } }),

        // ── 1. Scoping Determination ──
        heading('1. Scoping Determination'),
        body('CES-FE is an offline-first browser application used by VFS advisors to prepare DIB contractors for CMMC Level 2 certification. It runs entirely on the advisor\'s local workstation with no network connectivity to contractor environments.'),
        body('CMMC L2 assessment scoping identifies three categories of in-scope assets: **CUI Assets** (systems that process/store/transmit CUI), **Security Protection Assets** (systems that enforce security controls for CUI), and **Contractor Risk Managed Assets** (systems that could but are not intended to process CUI). CES-FE meets none of these definitions.'),
        bullet('CES does not process, store, or transmit Controlled Unclassified Information'),
        bullet('CES runs on the advisor\'s machine, not within the contractor\'s CMMC boundary'),
        bullet('Compliance metadata (gap scores, readiness postures, mission plans) is advisor work product, not CUI'),
        bullet('CES makes no network calls to external APIs, cloud services, or contractor tenants'),
        bullet('CUI must be explicitly marked per NIST SP 800-171 \u2014 CES data carries no CUI markings'),

        // ── 2. The CES Architectural Boundary ──
        heading('2. The CES Architectural Boundary'),
        body('The CES toolchain has four components. Only one is offline:'),
        bullet('**CES-FE / Planner (Out of Scope)** \u2014 Offline React SPA. Advisor answers question banks \u2192 generates JSON artifacts. All data stays in browser IndexedDB. **No GCC High connectivity.**'),
        bullet('**Stamper (Requires ESP Scoping)** \u2014 Used by BHD consultant to configure the tenant exactly to the agreed-upon plan. **Connects to GCC High.**'),
        bullet('**AdminOps (Requires ESP Scoping)** \u2014 Used by customer and BHD consultant to manage the tenant operationally. **Connects to GCC High.**'),
        bullet('**EvidenceOps (Requires ESP Scoping)** \u2014 Used by customer, BHD consultant, and assessor to generate assessment input. **Connects to GCC High.**'),
        body('The **CMMC assessment boundary begins at the tenant connection point** \u2014 where Stamper, AdminOps, or EvidenceOps authenticates to M365 GCC High or Azure Government. Everything upstream (CES-FE planning) is advisor-side activity.'),
        body('Mission plans crossing this boundary contain implementation instructions, not CUI. They are structured JSON authored by the advisor, not information derived from contractor CUI.'),

        // ── 3. Data Sensitivity ──
        heading('3. What CES Actually Stores'),
        body('CES persists data in an IndexedDB database named **CMMCComplianceTool** with 11 tables. None contain CUI:'),
        kvTable([
          ['Customer Records', 'Organization name, optional email/phone, target CMMC level. Basic PII, not CUI.'],
          ['SI Baselines', 'Strategic intent: target level, CUI type categories (not actual CUI), boundary strategy, user/endpoint counts, budget constraints.'],
          ['CUI Boundaries', 'Boundary topology declarations \u2014 describes boundary, does not contain CUI.'],
          ['Tenant Config Profiles', 'Tenant ID, primary domain, admin names, license details. Operationally sensitive but not CUI.'],
          ['Readiness Postures', 'Control-by-control status (met/partial/not_met), evidence references, gap scores. Compliance metadata.'],
          ['Mission Plans', 'Remediation roadmaps, proposals, manifests, policy documents. Advisor work product.'],
          ['Cache Tables', 'Cached YAML question banks and domain reference data. No customer data.'],
        ]),
        body('**Highest sensitivity:** Tenant Configuration Profiles (tenant IDs, admin account names). Not CUI, but operationally sensitive business information warranting standard protection.'),

        // ── 4. Architectural Assessment ──
        heading('4. Architectural Assessment'),

        heading('Strengths (If CES Were In Scope)', HeadingLevel.HEADING_2),
        bullet('**Offline-first, zero network surface** \u2014 No API calls, WebSocket connections, or external service dependencies. Eliminates MITM, session hijacking, CSRF attack vectors.'),
        bullet('**Immutable SI Baselines** \u2014 Once generated, baselines are locked (isImmutable: true). Downstream artifacts reference parent by ID. Prevents unauthorized modification of compliance foundation.'),
        bullet('**AJV schema validation** \u2014 Every artifact validated against JSON schemas before persistence. Malformed or tampered artifacts rejected at validation boundary.'),
        bullet('**Artifact provenance chain** \u2014 Each artifact carries metadata header with schema version, generation timestamp, and parent artifact references with SHA-256 hashes.'),
        bullet('**Scoped data isolation** \u2014 Compound IndexedDB indexes ([customerId+baselineId]) prevent cross-customer data leakage.'),

        heading('Weaknesses (Would Be Red Flags If In Scope)', HeadingLevel.HEADING_2),
        bullet('**No authentication** \u2014 No login, no user identity, no RBAC. File system access = full data access.'),
        bullet('**No encryption at rest** \u2014 IndexedDB stores plaintext JSON readable by any process.'),
        bullet('**No audit logging** \u2014 No record of who accessed, created, modified, or exported artifacts.'),
        bullet('**No DLP controls** \u2014 No scanning of input fields for CUI markings or classification banners.'),
        body('Because CES is out of scope, these are **not CMMC compliance gaps** \u2014 they are documented for completeness only.'),

        // ── 5. Risk: Advisor Misuse ──
        heading('5. Risk Scenario: Advisor Misuse'),
        body('The primary risk is an advisor pasting **actual marked CUI** (classified document excerpts, SSP content with CUI markings, controlled technical data) into CES input fields.'),
        bullet('**Impact:** CES would become a CUI Asset. The advisor\'s laptop would require all 110 NIST SP 800-171 controls.'),
        bullet('**Blast radius:** Limited to a single advisor\'s local machine. No cloud sync, no network transmission, no shared storage. CUI exposure contained to one device.'),
        bullet('**Mitigation 1 (Training, High ROI):** Advisor onboarding explicitly states CES is a planning tool, not a CUI repository.'),
        bullet('**Mitigation 2 (Policy, High ROI):** Written data handling policy: CES shall contain only compliance metadata, never contractor CUI.'),
        bullet('**Mitigation 3 (UI Warning, Low ROI):** Optional informational banners on free-text fields reminding advisors not to enter CUI.'),

        // ── 6. Recommendations ──
        heading('6. Recommendations'),

        heading('Immediate Actions (High ROI)', HeadingLevel.HEADING_2),
        bullet('Document CES scope exclusion in advisor training materials'),
        bullet('Enforce written data handling policy prohibiting CUI in CES'),
        bullet('Prepare advisors with assessor Q&A responses (see full report Section 11)'),
        bullet('Evaluate ESP scoping for **Stamper, AdminOps, and EvidenceOps** with each contractor\'s assessor \u2014 EvidenceOps warrants particular attention given assessor\'s direct use'),

        heading('Defer (Low ROI)', HeadingLevel.HEADING_2),
        bullet('**Do NOT** invest in CES authentication, encryption, or audit logging for CMMC purposes \u2014 no CMMC value since CES is out of scope'),
        bullet('Consider UI warnings on free-text fields as defense-in-depth (optional)'),
        bullet('Consider IndexedDB encryption for tenant config data (business security decision, not CMMC requirement)'),

        hr(),

        // ── 7. References ──
        heading('7. References'),
        bullet('**CMMC Assessment Guide \u2014 Level 2, Version 2.13** \u2014 DoD CIO. Defines CUI Asset, Security Protection Asset, and CRMA scoping categories. https://dodcio.defense.gov/Portals/0/Documents/CMMC/AssessmentGuideL2v2.pdf'),
        bullet('**CMMC Assessment Scope \u2014 Level 2, Version 2.0** \u2014 DoD CIO. Scoping methodology for identifying in-scope assets and boundaries. https://dodcio.defense.gov/Portals/0/Documents/CMMC/Scope_Level2_V2.0_FINAL_20211202_508.pdf'),
        bullet('**NIST SP 800-171 Rev 2** \u2014 Protecting CUI in Nonfederal Systems and Organizations. Defines the 110 security requirements for CMMC L2. https://csrc.nist.gov/publications/detail/sp/800-171/rev-2/final'),
        bullet('**32 CFR Part 2002** \u2014 CUI Registry and marking requirements. Defines what constitutes CUI and how it must be designated. https://www.ecfr.gov/current/title-32/subtitle-B/chapter-XX/part-2002'),
        bullet('**DFARS 252.204-7012** \u2014 Safeguarding Covered Defense Information and Cyber Incident Reporting. Contract flow-down clause requiring NIST SP 800-171 compliance.'),
        bullet('**CMMC Scoping for Level 2 Assessment** \u2014 Coalfire Federal. Practical guidance on scoping boundaries, ESP classification, and CRMA management. https://coalfirefederal.com/resource/cmmc-scoping-for-a-successful-level-2-assessment/'),
        bullet('**FCI vs. CUI Data in CMMC** \u2014 Huntress. Distinguishes Federal Contract Information from Controlled Unclassified Information in CMMC context. https://www.huntress.com/cmmc-compliance-guide/fci-vs-cui'),
        bullet('**CES CMMC Self-Assessment (Full Report)** \u2014 VFS Advisory. Complete 12-section analysis. docs/CES_CMMC_SELF_ASSESSMENT.md'),

        new Paragraph({ spacing: { before: 400 } }),
        hr(),
        new Paragraph({
          children: [
            new TextRun({ text: 'This document is an internal analytical work product of VFS Advisory \u2014 Compliance Engineering. ', font: 'Calibri', size: 18, italics: true, color: BORDER_GRAY }),
            new TextRun({ text: 'It does not constitute legal advice. CMMC scoping determinations should be confirmed with the contractor\'s C3PAO assessor.', font: 'Calibri', size: 18, italics: true, color: BORDER_GRAY }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 200 },
        }),
      ],
    },
  ],
});

// ── Generate and save ──
const buffer = await Packer.toBuffer(doc);
writeFileSync(OUTPUT_PATH, buffer);
console.log(`Executive summary written to: ${OUTPUT_PATH}`);
console.log(`Size: ${(buffer.length / 1024).toFixed(1)} KB`);
