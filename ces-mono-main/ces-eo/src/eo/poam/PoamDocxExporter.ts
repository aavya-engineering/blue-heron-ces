// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { createRequire } from 'node:module';
import type { PlanOfActionMilestones, PoamEligibility, PoamBlocker, PoamItem } from 'ces-shared/types/poam';

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const docx: any = _require('docx');
const { Document, Packer, Paragraph, TextRun, Header, Footer, AlignmentType, NumberFormat, Table, TableRow, TableCell, PageBreak, WidthType, BorderStyle } = docx;

/**
 * DOCX exporter for Plan of Action & Milestones.
 * Generates a DOCX with CUI classification markings per 32 CFR 2002:
 *   - Cover page: "CUI // SP-POAM // CMMC L2" banner, tenant ID, date
 *   - Eligibility section: certification path with color coding, threshold flags, blockers table (if any)
 *   - POA&M items table: 8 columns per NIST SP 800-171 requirements
 *   - Header on all pages: "CUI" centered 10pt
 *   - Footer on all pages: "CUI // SP-POAM // CMMC L2" centered 8pt
 */
export class PoamDocxExporter {
  async export(poam: PlanOfActionMilestones): Promise<Buffer> {
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
          text: 'CUI // SP-POAM // CMMC L2',
          bold: true,
          size: 28, // 14pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: '' }));
    // Plan of Action & Milestones title
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'Plan of Action & Milestones',
          bold: true,
          size: 32, // 16pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));
    // Tenant ID
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Tenant: ${poam.tenantId}`,
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
          text: new Date(poam.generatedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          size: 20, // 10pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));
    // SPRS Score
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `SPRS Score: ${poam.sprsScore}`,
          size: 24, // 12pt
          bold: true,
        }),
      ],
    }));

    // PageBreak after cover page
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- Eligibility Section ---
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'CMMC Certification Eligibility',
          bold: true,
          size: 28, // 14pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));

    // Certification Path with color coding
    const pathColor = this.getCertificationPathColor(poam.eligibility.certificationPath);
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Certification Path: ',
          bold: true,
          size: 24,
        }),
        new TextRun({
          text: poam.eligibility.certificationPath.toUpperCase(),
          bold: true,
          size: 24,
          color: pathColor,
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));

    // Threshold flags
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Score Threshold Met (110+): ',
          bold: true,
          size: 24,
        }),
        new TextRun({
          text: poam.eligibility.scoreThresholdMet ? 'YES' : 'NO',
          size: 24,
        }),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Weight Rule Met (5-point controls): ',
          bold: true,
          size: 24,
        }),
        new TextRun({
          text: poam.eligibility.weightRuleMet ? 'YES' : 'NO',
          size: 24,
        }),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Prohibited Controls Met: ',
          bold: true,
          size: 24,
        }),
        new TextRun({
          text: poam.eligibility.prohibitedControlsMet ? 'YES' : 'NO',
          size: 24,
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));

    // Blockers table (if any)
    if (poam.eligibility.blockers.length > 0) {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: 'Certification Blockers',
            bold: true,
            size: 26, // 13pt
          }),
        ],
      }));
      children.push(new Paragraph({ text: '' }));
      children.push(this.renderBlockersTable(poam.eligibility.blockers));
      children.push(new Paragraph({ text: '' }));
    }

    // PageBreak before POA&M items
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // --- POA&M Items Section ---
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'POA&M Items',
          bold: true,
          size: 28, // 14pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));

    if (poam.items.length > 0) {
      children.push(this.renderPoamItemsTable(poam.items));
    } else {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: 'No POA&M items required. All controls met.',
            italics: true,
            size: 24,
          }),
        ],
      }));
    }
    children.push(new Paragraph({ text: '' }));

    // --- Summary Section ---
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Summary',
          bold: true,
          size: 28, // 14pt
        }),
      ],
    }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Total Items: ',
          bold: true,
          size: 24,
        }),
        new TextRun({
          text: String(poam.summary.totalItems),
          size: 24,
        }),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Open Items: ',
          bold: true,
          size: 24,
        }),
        new TextRun({
          text: String(poam.summary.openItems),
          size: 24,
        }),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Total Weight on POA&M: ',
          bold: true,
          size: 24,
        }),
        new TextRun({
          text: String(poam.summary.totalWeightOnPoam),
          size: 24,
        }),
      ],
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: 'Projected Score After POA&M: ',
          bold: true,
          size: 24,
        }),
        new TextRun({
          text: String(poam.summary.projectedScoreAfterPoam),
          size: 24,
        }),
      ],
    }));

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
                      text: 'CUI // SP-POAM // CMMC L2',
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

  private getCertificationPathColor(path: 'full' | 'conditional' | 'blocked'): string {
    switch (path) {
      case 'full':
        return '00B050'; // green
      case 'conditional':
        return 'FFC000'; // yellow
      case 'blocked':
        return 'FF0000'; // red
    }
  }

  private renderBlockersTable(blockers: PoamBlocker[]): any {
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

    const headers = ['Control ID', 'NIST Reference', 'Weight', 'Reason'];
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

    const dataRows = blockers.map((blocker: PoamBlocker) =>
      new TableRow({
        children: [
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: blocker.control_id, size: 24 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: blocker.nist_ref, size: 24 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: String(blocker.weight), size: 24 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: blocker.reason, size: 24 })],
            })],
          }),
        ],
      })
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    });
  }

  private renderPoamItemsTable(items: PoamItem[]): any {
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

    const headers = [
      'Control ID',
      'NIST Reference',
      'Deficiency Description',
      'Planned Corrective Action',
      'Responsible Party',
      'Estimated Completion Date',
      'Resources Required',
      'Status',
    ];
    const headerRow = new TableRow({
      children: headers.map((h: string) =>
        new TableCell({
          borders,
          width: { size: 0, type: WidthType.AUTO },
          children: [new Paragraph({
            children: [new TextRun({ text: h, bold: true, size: 20 })],
          })],
        })
      ),
    });

    const dataRows = items.map((item: PoamItem) =>
      new TableRow({
        children: [
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: item.control_id, size: 20 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: item.nist_ref, size: 20 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: item.deficiencyDescription, size: 20 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: item.plannedCorrectiveAction, size: 20 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: item.responsibleParty, size: 20 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: item.estimatedCompletionDate, size: 20 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: item.resourcesRequired, size: 20 })],
            })],
          }),
          new TableCell({
            borders,
            width: { size: 0, type: WidthType.AUTO },
            children: [new Paragraph({
              children: [new TextRun({ text: item.status, size: 20 })],
            })],
          }),
        ],
      })
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    });
  }
}
