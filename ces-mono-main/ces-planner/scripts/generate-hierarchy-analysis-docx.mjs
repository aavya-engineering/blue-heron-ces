// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  convertInchesToTwip, Footer, PageNumber, NumberFormat,
} from 'docx';
import * as fs from 'fs';
import * as path from 'path';

// ── Helpers ──

const BLUE = '1F4E79';
const LIGHT_BLUE = 'D6E4F0';
const DARK_GRAY = '333333';
const MED_GRAY = '666666';
const WHITE = 'FFFFFF';

const heading = (text, level = HeadingLevel.HEADING_1) =>
  new Paragraph({ heading: level, spacing: { before: 300, after: 120 }, children: [new TextRun({ text, bold: true, color: BLUE })] });

const body = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ text, size: 22, color: DARK_GRAY })],
  });

const bodyRuns = (runs, opts = {}) =>
  new Paragraph({ spacing: { after: 120 }, ...opts, children: runs });

const bold = (text, size = 22) => new TextRun({ text, bold: true, size, color: DARK_GRAY });
const normal = (text, size = 22) => new TextRun({ text, size, color: DARK_GRAY });
const italic = (text, size = 22) => new TextRun({ text, italics: true, size, color: MED_GRAY });
const mono = (text, size = 20) => new TextRun({ text, font: 'Consolas', size, color: DARK_GRAY });

const bullet = (runs) =>
  new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: runs });

const bullet2 = (runs) =>
  new Paragraph({ bullet: { level: 1 }, spacing: { after: 60 }, children: runs });

const spacer = () => new Paragraph({ spacing: { after: 80 }, children: [] });

// Table helpers
const cellShaded = (text, shade = LIGHT_BLUE) =>
  new TableCell({
    shading: { type: ShadingType.SOLID, color: shade },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20, color: BLUE })] })],
  });

const cell = (text) =>
  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, size: 20, color: DARK_GRAY })] })] });

const cellMono = (text) =>
  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, font: 'Consolas', size: 18, color: DARK_GRAY })] })] });

const noBorders = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };
const thinBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
  left: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
  right: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
};

// ── Document ──

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22, color: DARK_GRAY } },
      heading1: { run: { font: 'Calibri', size: 32, bold: true, color: BLUE } },
      heading2: { run: { font: 'Calibri', size: 26, bold: true, color: BLUE } },
      heading3: { run: { font: 'Calibri', size: 24, bold: true, color: BLUE } },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) },
        pageNumbers: { start: 1 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'CES CMMC Hierarchy Analysis  |  Page ', size: 16, color: MED_GRAY }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MED_GRAY }),
          ],
        })],
      }),
    },
    children: [

      // ── Title ──
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: 'CES CMMC Control Hierarchy', size: 48, bold: true, color: BLUE })],
      }),
      new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: 'Cardinality, Relationships & Scope Analysis', size: 28, color: MED_GRAY })],
      }),
      new Paragraph({
        spacing: { after: 300 },
        children: [
          italic('Prepared: March 2026  |  Branch: postStamper  |  Repos: cse-fe-v2, stamper, eo'),
        ],
      }),

      // ══════════════════════════════════════════════════
      // Section 1: Hierarchy Overview
      // ══════════════════════════════════════════════════
      heading('1. Hierarchy Overview'),

      body('The CES platform models CMMC Level 2 compliance through a six-level hierarchy from abstract framework concepts down to vendor-specific implementation actions. Each level has a well-defined cardinality relationship with its parent.'),
      spacer(),

      // Hierarchy diagram as mono text
      new Paragraph({ spacing: { after: 40 }, children: [mono('CMMC Level          1 ──── has many ────► Domain')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('   (3 values)              (14 families)')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('                              │')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('Domain              1 ──── has many ────► Requirement / Control')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('   (14 families)           (varies by level)')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('                              │')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('Requirement         1 ──── has 0..1 ─────► Gap')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('   (110 for L2)            (only if not met)')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('                              │')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('Gap                 1 ──── has 1 ────────► Task')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('                           (exactly 1:1)')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('                              │')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('Task                1 ──── has many ─────► Action (StepAction)')] }),
      new Paragraph({ spacing: { after: 120 }, children: [mono('                           (1..N per task)')] }),

      // ══════════════════════════════════════════════════
      // Section 2: Cardinality Table
      // ══════════════════════════════════════════════════
      heading('2. Cardinality & Relationships'),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cellShaded('Relationship'), cellShaded('Cardinality'), cellShaded('Notes')],
          }),
          new TableRow({ children: [cell('Level → Domain'), cell('1 : many'), cell('L1 has 6 domains; L2/L3 have all 14. LEVEL_HIERARCHY accumulates (L2 includes L1).')] }),
          new TableRow({ children: [cell('Domain → Requirement'), cell('1 : many'), cell('AC=22, AT=3, AU=9, CM=9, IA=11, IR=3, MA=6, MP=9, PE=6, PS=2, RA=3, CA=4, SC=16, SI=7. Total: 110 for L2.')] }),
          new TableRow({ children: [cell('Requirement → Gap'), cell('1 : 0..1'), cell('Gap exists only if readiness status is not_met, partial, or unknown. Fully met controls produce no gap.')] }),
          new TableRow({ children: [cell('Gap → Task'), cell('1 : 1'), cell('Strictly enforced. One task per gap, no exceptions. No cross-control dependencies.')] }),
          new TableRow({ children: [cell('Task → Action'), cell('1 : N'), cell('Each task pulls actions from implementation patterns. Typical range: 1–6 actions per task.')] }),
          new TableRow({ children: [cell('Task → SubCommand'), cell('1 : N'), cell('Stamper only. Registry-backed executables. Typical range: 1–8 sub-commands per task.')] }),
        ],
      }),

      spacer(),

      // ══════════════════════════════════════════════════
      // Section 3: Domain Breakdown
      // ══════════════════════════════════════════════════
      heading('3. Domain Breakdown (L2 — 110 Controls)'),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cellShaded('Domain'), cellShaded('Full Name'), cellShaded('Controls')],
          }),
          new TableRow({ children: [cellMono('AC'), cell('Access Control'), cell('22')] }),
          new TableRow({ children: [cellMono('AT'), cell('Awareness and Training'), cell('3')] }),
          new TableRow({ children: [cellMono('AU'), cell('Audit and Accountability'), cell('9')] }),
          new TableRow({ children: [cellMono('CM'), cell('Configuration Management'), cell('9')] }),
          new TableRow({ children: [cellMono('IA'), cell('Identification and Authentication'), cell('11')] }),
          new TableRow({ children: [cellMono('IR'), cell('Incident Response'), cell('3')] }),
          new TableRow({ children: [cellMono('MA'), cell('Maintenance'), cell('6')] }),
          new TableRow({ children: [cellMono('MP'), cell('Media Protection'), cell('9')] }),
          new TableRow({ children: [cellMono('PE'), cell('Physical Protection'), cell('6')] }),
          new TableRow({ children: [cellMono('PS'), cell('Personnel Security'), cell('2')] }),
          new TableRow({ children: [cellMono('RA'), cell('Risk Assessment'), cell('3')] }),
          new TableRow({ children: [cellMono('CA'), cell('Security Assessment'), cell('4')] }),
          new TableRow({ children: [cellMono('SC'), cell('System and Communications Protection'), cell('16')] }),
          new TableRow({ children: [cellMono('SI'), cell('System and Information Integrity'), cell('7')] }),
        ],
      }),

      spacer(),

      // ══════════════════════════════════════════════════
      // Section 4: Tenant Stance Scoping
      // ══════════════════════════════════════════════════
      heading('4. Tenant Stance & Control Scoping'),

      body('The infrastructure model is captured by SIT question SIT-020 and stored as si_baseline.dependencies.infrastructure_model. Only the m365_only stance changes the control set — m365_sentinel and m365_azure service all 110 L2 controls.'),
      spacer(),

      heading('4.1 Infrastructure Model Impact', HeadingLevel.HEADING_2),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cellShaded('Stance'), cellShaded('Fully Covered'), cellShaded('Manual Alt.'), cellShaded('Infra Manifest')],
          }),
          new TableRow({ children: [cellMono('m365_only'), cell('101 / 110'), cell('9 controls'), cell('None (null)')] }),
          new TableRow({ children: [cellMono('m365_sentinel'), cell('110 / 110'), cell('0'), cell('Minimal (3 resources)')] }),
          new TableRow({ children: [cellMono('m365_azure'), cell('110 / 110'), cell('0'), cell('Full (~25+ resources)')] }),
        ],
      }),

      spacer(),

      heading('4.2 The 9 Manual Alternative Controls (m365_only)', HeadingLevel.HEADING_2),

      body('When infrastructure_model is m365_only, these 9 controls receive a manual_alternative gap classification. Their infrastructure_deployment steps are filtered from the plan, and M365-native alternative approaches are provided.'),
      spacer(),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cellShaded('Control ID'), cellShaded('Domain'), cellShaded('Azure Approach'), cellShaded('M365 Alternative')],
          }),
          new TableRow({ children: [cellMono('AU.L2-3.3.3'), cell('Audit'), cell('Sentinel retention + automated audit review'), cell('Purview Audit Premium + Defender XDR Advanced Hunting')] }),
          new TableRow({ children: [cellMono('AU.L2-3.3.4'), cell('Audit'), cell('Sentinel alerting on LAW heartbeat failure'), cell('Defender XDR custom detection + Power Automate alerts')] }),
          new TableRow({ children: [cellMono('SC.L1-3.13.1'), cell('Sys/Comms'), cell('NSG flow logs + Azure Firewall + Sentinel'), cell('Conditional Access as boundary + Defender for Cloud Apps')] }),
          new TableRow({ children: [cellMono('SC.L1-3.13.5'), cell('Sys/Comms'), cell('VNet segregation with dedicated subnet'), cell('SPO external sharing policies + CA named locations')] }),
          new TableRow({ children: [cellMono('SC.L2-3.13.2'), cell('Sys/Comms'), cell('Azure Advisor + Secure Score'), cell('Microsoft Secure Score + Compliance Manager CMMC template')] }),
          new TableRow({ children: [cellMono('SC.L2-3.13.6'), cell('Sys/Comms'), cell('NSG default deny rules'), cell('CA block-all-access baseline + Intune compliance')] }),
          new TableRow({ children: [cellMono('SC.L2-3.13.10'), cell('Sys/Comms'), cell('Azure Key Vault with HSM-backed keys'), cell('Entra ID CBA + Cloud PKI + customer-managed keys')] }),
          new TableRow({ children: [cellMono('SI.L2-3.14.7'), cell('Sys/Info'), cell('Sentinel UEBA + Entra sign-in analytics'), cell('Entra ID Identity Protection + Defender anomaly detection')] }),
          new TableRow({ children: [cellMono('IR.L2-3.6.2'), cell('Incident'), cell('Sentinel incident tracking'), cell('Defender XDR incident queue + ServiceNow/Jira integration')] }),
        ],
      }),

      spacer(),

      heading('4.3 License Tier Impact', HeadingLevel.HEADING_2),

      body('When license_tier is business_premium, 3 additional controls receive a control_not_available classification (these require Purview Audit Premium, Insider Risk Management, or Advanced eDiscovery):'),

      bullet([mono('AU.L2-3.3.1'), normal(' — Purview Audit Premium')]),
      bullet([mono('IR.L2-3.6.1'), normal(' — Insider Risk Management')]),
      bullet([mono('IR.L2-3.6.2'), normal(' — Advanced eDiscovery')]),

      spacer(),

      heading('4.4 Combined Coverage Matrix', HeadingLevel.HEADING_2),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cellShaded('Stance + License'), cellShaded('Fully Covered'), cellShaded('Manual Alt.'), cellShaded('Not Available')],
          }),
          new TableRow({ children: [cell('m365_only + business_premium'), cell('98'), cell('9'), cell('3')] }),
          new TableRow({ children: [cell('m365_only + g3 / g5'), cell('101'), cell('9'), cell('0')] }),
          new TableRow({ children: [cell('m365_sentinel + business_premium'), cell('107'), cell('0'), cell('3')] }),
          new TableRow({ children: [cell('m365_sentinel + g3 / g5'), cell('110'), cell('0'), cell('0')] }),
          new TableRow({ children: [cell('m365_azure + business_premium'), cell('107'), cell('0'), cell('3')] }),
          new TableRow({ children: [cell('m365_azure + g3 / g5'), cell('110'), cell('0'), cell('0')] }),
        ],
      }),

      spacer(),

      // ══════════════════════════════════════════════════
      // Section 5: Self-Containment
      // ══════════════════════════════════════════════════
      heading('5. Are Control Implementations Self-Contained?'),

      bodyRuns([bold('Yes, completely. '), normal('The mapping is strictly 1:1:1 — each CMMC requirement produces at most one Gap, which produces exactly one Task. There are no cross-control dependencies in CES-FE.')]),

      spacer(),
      heading('5.1 Key Evidence', HeadingLevel.HEADING_2),

      bullet([bold('Task Compiler: '), normal('Creates exactly one Task per Gap. The resolveTaskDependencies function has an explicit comment: "Cross-requirement: no automatic dependencies for now."')]),
      bullet([bold('Actions are scoped: '), normal('Each implementation pattern\'s actions are keyed to a single practice_id (CMMC requirement). Actions are not shared across controls.')]),
      bullet([bold('If you skip a control: '), normal('Its entire task and all its actions are skipped. Nothing leaks to other controls.')]),

      spacer(),
      heading('5.2 Stamper Nuance', HeadingLevel.HEADING_2),

      body('At the Stamper level, a single command registry entry can cover multiple controls. The PlanTranslator deduplicates — if registry entry X covers controls A and B, it executes only once (in whichever task comes first), but tracks both control IDs on that task. This means the execution is self-contained per entry, but the control coverage metadata spans multiple requirements.'),

      spacer(),

      // ══════════════════════════════════════════════════
      // Section 6: SPRS Scoring
      // ══════════════════════════════════════════════════
      heading('6. SPRS Scoring & Out-of-Scope Controls'),

      heading('6.1 SPRS Formula', HeadingLevel.HEADING_2),

      new Paragraph({ spacing: { after: 40 }, children: [mono('SPRS Score = 110 - Σ(weighted subtractors for unimplemented controls)')] }),
      spacer(),

      bullet([bold('Range: '), normal('-203 (nothing implemented) to +110 (full compliance)')]),
      bullet([bold('Weights: '), normal('1, 3, or 5 points per control (from DoD Assessment Methodology v1.2.1 Annex A)')]),
      bullet([bold('Passing: '), normal('88+ for CMMC L2 (conditional with POA&M); 110 for full certification')]),

      spacer(),
      heading('6.2 Out-of-Scope Handling per SPRS Rules', HeadingLevel.HEADING_2),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cellShaded('Status'), cellShaded('SPRS Treatment'), cellShaded('Deduction')],
          }),
          new TableRow({ children: [cell('Met / Implemented'), cell('No deduction'), cell('0')] }),
          new TableRow({ children: [cell('Not Applicable (justified)'), cell('Treated as implemented'), cell('0')] }),
          new TableRow({ children: [cell('Not Implemented'), cell('Full weight deducted'), cell('-1, -3, or -5')] }),
          new TableRow({ children: [cell('Not Assessed'), cell('Same as Not Implemented'), cell('-1, -3, or -5')] }),
          new TableRow({ children: [cell('Partial (no credit rule)'), cell('Full weight deducted'), cell('-1, -3, or -5')] }),
          new TableRow({ children: [cell('Partial (credit rule exists)'), cell('Reduced deduction'), cell('-(full - partial)')] }),
        ],
      }),

      spacer(),
      heading('6.3 Current Implementation Gap (EO)', HeadingLevel.HEADING_2),

      body('The SPRS scorer in ../eo (Evidence Ops) has no not_applicable status. The ControlStatus type only supports: met, not_met, partial, not_assessed. The StatusTranslator maps notApplicable to not_assessed, which triggers a full weight deduction — the opposite of SPRS rules.'),
      spacer(),
      bodyRuns([bold('Required fix: '), normal('Add not_applicable as a fifth ControlStatus value with zero deduction, and flow CES-FE scope metadata (manual_alternative, control_not_available, out_of_boundary) into the scoring pipeline as N/A justifications.')]),

      spacer(),

      // ══════════════════════════════════════════════════
      // Section 7: Terminology
      // ══════════════════════════════════════════════════
      heading('7. Terminology Reference'),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cellShaded('Term'), cellShaded('CES-FE Name'), cellShaded('Stamper Name'), cellShaded('Description')],
          }),
          new TableRow({ children: [cell('Level'), cell('CMMC Level'), cell('target_level'), cell('L1, L2, or L3')] }),
          new TableRow({ children: [cell('Domain'), cell('domain'), cell('(family)'), cell('14 CMMC practice families (AC, AU, SC...)')] }),
          new TableRow({ children: [cell('Requirement'), cell('requirement_id'), cell('controls[]'), cell('Individual CMMC practice (e.g., AC.L2-3.1.1)')] }),
          new TableRow({ children: [cell('Gap'), cell('Gap'), cell('(consumed)'), cell('Deficiency for a requirement')] }),
          new TableRow({ children: [cell('Task'), cell('Task / Step'), cell('ExeTask'), cell('Unit of remediation work')] }),
          new TableRow({ children: [cell('Action'), cell('StepAction'), cell('(embedded)'), cell('Vendor-specific implementation step')] }),
          new TableRow({ children: [cell('SubCommand'), cell('(N/A)'), cell('SubCommand'), cell('Registry-backed executable command')] }),
          new TableRow({ children: [cell('Milestone'), cell('Milestone'), cell('(N/A)'), cell('Time-phased grouping of tasks (MS-1, MS-2...)')] }),
          new TableRow({ children: [cell('Layer'), cell('(N/A)'), cell('Execution Layer'), cell('Parallelization ordering (L0–L8)')] }),
        ],
      }),

      spacer(),
      body('"Control" and "Requirement" are used interchangeably throughout all CES codebases.'),
      body('"Task" and "Step" refer to the same unit — "Task" in the compiler, "Step" in the generated plan, "ExeTask" in Stamper execution.'),

      spacer(),

      // ══════════════════════════════════════════════════
      // Section 8: SI Decisions & Control Scope Implications
      // ══════════════════════════════════════════════════
      heading('8. SI Decisions & Control Scope Implications'),

      body('Strategic Intent decisions captured during the SIT wizard have downstream implications for which CMMC controls must be implemented. Currently, only infrastructure_model and license_tier affect control scope. The following table maps SI decisions to the controls they should affect.'),
      spacer(),

      heading('8.1 What Exists Today', HeadingLevel.HEADING_2),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cellShaded('SI Decision'), cellShaded('Effect'), cellShaded('Where It Acts'), cellShaded('Controls Affected')],
          }),
          new TableRow({ children: [cellMono('infrastructure_model = m365_only'), cell('9 controls get manual_alternative'), cell('Gap compiler'), cell('AU.L2-3.3.3, AU.L2-3.3.4, SC.L1-3.13.1, SC.L1-3.13.5, SC.L2-3.13.2, SC.L2-3.13.6, SC.L2-3.13.10, SI.L2-3.14.7, IR.L2-3.6.2')] }),
          new TableRow({ children: [cellMono('license_tier = business_premium'), cell('3 controls get control_not_available'), cell('Gap compiler'), cell('AU.L2-3.3.1, IR.L2-3.6.1, IR.L2-3.6.2')] }),
          new TableRow({ children: [cellMono('byod_posture = not_allowed'), cell('RR questions excluded for 2 controls'), cell('RR generator only (does NOT propagate to gap/plan)'), cell('AC.L2-3.1.18, AC.L2-3.1.19')] }),
        ],
      }),

      spacer(),

      heading('8.2 What Should Exist (Proposed)', HeadingLevel.HEADING_2),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cellShaded('Policy Decision'), cellShaded('Proposed SI Question'), cellShaded('Controls Affected'), cellShaded('SPRS Weight Impact')],
          }),
          new TableRow({ children: [cell('No mobile devices in enclave'), cellMono('mobile_device_presence = no_mobile_devices'), cell('AC.L2-3.1.15, 3.1.16, 3.1.18, 3.1.19'), cell('10 pts')] }),
          new TableRow({ children: [cell('No wireless networks'), cellMono('wireless_posture = no_wireless'), cell('AC.L2-3.1.14, 3.1.16'), cell('6 pts')] }),
          new TableRow({ children: [cell('No removable media'), cellMono('removable_media_posture = blocked'), cell('MP.L2-3.8.5, 3.8.6 (+ simplifies 3.8.1, 3.8.2, 3.8.7)'), cell('18 pts')] }),
          new TableRow({ children: [cell('No remote access'), cellMono('remote_access_posture = no_remote'), cell('AC.L2-3.1.12, PE.L2-3.10.6 (+ simplifies 3.1.7, 3.1.11)'), cell('12 pts')] }),
          new TableRow({ children: [cell('No nonlocal maintenance'), cellMono('maintenance_posture = no_nonlocal'), cell('MA.L2-3.7.4 (+ simplifies 3.7.3)'), cell('2 pts')] }),
          new TableRow({ children: [cell('Cloud-only (no physical CUI)'), cellMono('deployment_posture (exists but unused)'), cell('MP.L2-3.8.x physical, PE.L2-3.10.x'), cell('24+ pts')] }),
        ],
      }),

      spacer(),

      heading('8.3 CMMC N/A Nuance', HeadingLevel.HEADING_2),

      body('CMMC assessors require that N/A justifications be specific and verifiable. \'No BYOD\' does not mean mobile device controls are N/A \u2014 only \'no mobile devices of any kind in the CUI enclave\' justifies N/A for mobile controls. Similarly, \'no wireless\' means no wireless networks exist in the enclave boundary, not just that wireless is restricted.'),

      spacer(),

      // ══════════════════════════════════════════════════
      // Section 9: Architecture Gaps
      // ══════════════════════════════════════════════════
      heading('9. Architecture Gaps'),

      bullet([bold('1. '), normal('No scoped_out or not_applicable GapClassification \u2014 the type system cannot express \'this control does not apply\'')]),
      bullet([bold('2. '), normal('RR exclusions don\'t propagate \u2014 the gap compiler\'s safety net catches excluded controls as \'unknown\' gaps')]),
      bullet([bold('3. '), normal('Missing SI questions \u2014 wireless, removable media, remote access, nonlocal maintenance are not asked')]),
      bullet([bold('4. '), normal('No SI-driven filtering in gap compiler \u2014 only infrastructure model and license tier are checked')]),
      bullet([bold('5. '), normal('Stamper and EO have no conditional execution \u2014 no gating mechanism based on SI scope decisions')]),

      spacer(),

      // ══════════════════════════════════════════════════
      // Section 10: Proposed Data Flow
      // ══════════════════════════════════════════════════
      heading('10. Proposed Scope Exclusion Data Flow'),

      new Paragraph({ spacing: { after: 40 }, children: [mono('SI Questions (SIT Wizard)')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u2502')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u25BC')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('SI Baseline (operations fields)')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u2502')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u25BC')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('Gap Compiler \u2192 buildScopeExclusions(siBaseline)')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u2502               \u2192 Map<requirement_id, justification>')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u2502')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u25BC')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('scope_exclusions[] added to Manual Mission Plan')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u2502')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u251C\u2500\u2500\u25BA Stamper PlanTranslator (skip excluded tasks)')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u251C\u2500\u2500\u25BA Stamper CmmcAnalyzer (classify as out_of_scope)')] }),
      new Paragraph({ spacing: { after: 40 }, children: [mono('    \u251C\u2500\u2500\u25BA EO SprsCalculator (not_applicable = 0 deduction)')] }),
      new Paragraph({ spacing: { after: 120 }, children: [mono('    \u2514\u2500\u2500\u25BA Assessor Package (N/A justification documentation)')] }),

      spacer(),

      body('Each scope exclusion carries a justification string tied to a specific SI decision, ensuring assessor transparency. Controls excluded from scope receive zero SPRS deduction and are not executed by Stamper, but may optionally be discovered for defense-in-depth reporting.'),

    ],
  }],
});

// ── Write to disk ──
const outPath = path.resolve('docs/CES_CMMC_Hierarchy_Analysis.docx');
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log('Written to', outPath);
