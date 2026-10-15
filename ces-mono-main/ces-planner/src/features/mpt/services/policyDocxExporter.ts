// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Converts rendered Markdown policy documents to professional DOCX format.
 * Uses the `docx` package for pure-JS generation (offline-compatible).
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  TableOfContents,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Footer,
  PageNumber,
  NumberFormat,
} from 'docx';
import type { RenderedPolicyDocument } from './policyRenderer';
import type { PolicyTemplateContext } from './policyContextCompiler';

/** Parse simple Markdown into docx paragraphs (handles #, ##, ###, -, **, >) */
function markdownToParagraphs(md: string): Paragraph[] {
  const lines = md.split('\n');
  const paragraphs: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Skip empty lines
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ text: '' }));
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(4),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 },
        }),
      );
    } else if (line.startsWith('## ')) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(3),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 360, after: 120 },
        }),
      );
    } else if (line.startsWith('# ')) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(2),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 480, after: 240 },
        }),
      );
    }
    // Blockquotes
    else if (line.startsWith('> ')) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.slice(2),
              italics: true,
              color: '666666',
            }),
          ],
          indent: { left: 720 },
          spacing: { before: 120, after: 120 },
        }),
      );
    }
    // Bullet lists
    else if (line.match(/^[-*] /)) {
      const text = line.slice(2);
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(text),
          bullet: { level: 0 },
          spacing: { before: 40, after: 40 },
        }),
      );
    }
    // Numbered lists
    else if (line.match(/^\d+\. /)) {
      const text = line.replace(/^\d+\.\s*/, '');
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(text),
          numbering: { reference: 'default-numbering', level: 0 },
          spacing: { before: 40, after: 40 },
        }),
      );
    }
    // Horizontal rule
    else if (line.match(/^---+$/)) {
      paragraphs.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
          },
          spacing: { before: 240, after: 240 },
        }),
      );
    }
    // Regular paragraph
    else {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(line),
          spacing: { before: 60, after: 60 },
        }),
      );
    }
  }

  return paragraphs;
}

/** Parse **bold** and *italic* inline formatting */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Regex to match **bold**, *italic*, or plain text
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);

  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else if (part.startsWith('*') && part.endsWith('*')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true }));
    } else if (part) {
      runs.push(new TextRun({ text: part }));
    }
  }

  return runs;
}

/** Build a cover page for the policy document */
function buildCoverPage(title: string, ctx: PolicyTemplateContext): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 4000 } }),
    new Paragraph({
      children: [
        new TextRun({
          text: ctx.org.legal_name || 'Organization',
          size: 48,
          bold: true,
          color: '1a365d',
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ spacing: { before: 600 } }),
    new Paragraph({
      children: [
        new TextRun({
          text: title,
          size: 36,
          color: '2d3748',
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ spacing: { before: 400 } }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Version 1.0 — ${ctx.governance.policy_effective_date || ctx.generated_on}`,
          size: 22,
          color: '718096',
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `CMMC ${ctx.si.target_cmmc_level || 'L2'} Compliance`,
          size: 22,
          color: '718096',
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ spacing: { before: 2000 } }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'CONTROLLED DOCUMENT — FOR AUTHORIZED USE ONLY',
          size: 18,
          bold: true,
          color: 'E53E3E',
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new PageBreak()],
    }),
  ];
}

/** Build a signature block table */
function buildSignatureBlock(ctx: PolicyTemplateContext): (Paragraph | Table)[] {
  const roles = [
    { label: 'Prepared By', role: 'isso' },
    { label: 'Reviewed By', role: 'compliance_officer' },
    { label: 'Approved By', role: 'system_owner' },
  ];

  const rows = roles.map(
    ({ label, role }) =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: label, spacing: { before: 60, after: 60 } })],
            width: { size: 2000, type: WidthType.DXA },
          }),
          new TableCell({
            children: [
              new Paragraph({
                text: ctx.personnel[role]?.name || '[Name]',
                spacing: { before: 60, after: 60 },
              }),
            ],
            width: { size: 3000, type: WidthType.DXA },
          }),
          new TableCell({
            children: [
              new Paragraph({
                text: ctx.personnel[role]?.title || '[Title]',
                spacing: { before: 60, after: 60 },
              }),
            ],
            width: { size: 2500, type: WidthType.DXA },
          }),
          new TableCell({
            children: [
              new Paragraph({
                text: '________________',
                spacing: { before: 60, after: 60 },
              }),
            ],
            width: { size: 2000, type: WidthType.DXA },
          }),
          new TableCell({
            children: [
              new Paragraph({
                text: '________',
                spacing: { before: 60, after: 60 },
              }),
            ],
            width: { size: 1500, type: WidthType.DXA },
          }),
        ],
      }),
  );

  return [
    new Paragraph({
      text: 'Approval Signatures',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 480, after: 240 },
    }),
    new Table({
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'Role', bold: true })],
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'Name', bold: true })],
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'Title', bold: true })],
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'Signature', bold: true })],
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'Date', bold: true })],
                }),
              ],
            }),
          ],
        }),
        ...rows,
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  ];
}

/** Build version history table */
function buildVersionHistory(ctx: PolicyTemplateContext): (Paragraph | Table)[] {
  return [
    new Paragraph({
      text: 'Document Revision History',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 480, after: 240 },
    }),
    new Table({
      rows: [
        new TableRow({
          children: ['Version', 'Date', 'Author', 'Description'].map(
            (header) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: header, bold: true })],
                  }),
                ],
              }),
          ),
        }),
        new TableRow({
          children: [
            '1.0',
            ctx.governance.policy_effective_date || ctx.generated_on,
            ctx.personnel['isso']?.name || 'CES Tool',
            'Initial policy generation via CES',
          ].map(
            (cell) =>
              new TableCell({
                children: [new Paragraph({ text: cell })],
              }),
          ),
        }),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  ];
}

/** Export a single policy document to DOCX Blob */
export async function exportPolicyToDocx(
  doc: RenderedPolicyDocument,
  ctx: PolicyTemplateContext,
): Promise<Blob> {
  const coverPage = buildCoverPage(doc.title, ctx);
  const bodyParagraphs = markdownToParagraphs(doc.markdown);
  const signatureBlock = buildSignatureBlock(ctx);
  const versionHistory = buildVersionHistory(ctx);

  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: NumberFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    features: {
      updateFields: true,
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        headers: {
          default: {
            options: {
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `${ctx.org.legal_name} — ${doc.title}`,
                      size: 16,
                      color: '999999',
                    }),
                  ],
                  alignment: AlignmentType.RIGHT,
                }),
              ],
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'CONTROLLED DOCUMENT — ',
                    size: 14,
                    color: '999999',
                  }),
                  new TextRun({
                    children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                    size: 14,
                    color: '999999',
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children: [
          ...coverPage,
          new Paragraph({
            children: [
              new TextRun({
                text: 'Table of Contents',
                bold: true,
                size: 28,
              }),
            ],
            spacing: { after: 240 },
          }),
          new TableOfContents('Table of Contents', {
            hyperlink: true,
            headingStyleRange: '1-3',
          }),
          new Paragraph({ children: [new PageBreak()] }),
          ...bodyParagraphs,
          new Paragraph({ children: [new PageBreak()] }),
          ...signatureBlock,
          ...versionHistory,
        ],
      },
    ],
  });

  return Packer.toBlob(document);
}

/** Export all policy documents as individual DOCX blobs */
export async function exportAllPoliciesToDocx(
  docs: RenderedPolicyDocument[],
  ctx: PolicyTemplateContext,
): Promise<Array<{ filename: string; blob: Blob }>> {
  const results: Array<{ filename: string; blob: Blob }> = [];

  for (const doc of docs) {
    const blob = await exportPolicyToDocx(doc, ctx);
    const filename = `${doc.template_id.replace(/_/g, '-')}.docx`;
    results.push({ filename, blob });
  }

  return results;
}
