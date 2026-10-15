// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Generate DOCX White Paper: CMMC Solo Consultant Cloud Options
 * Run: node scripts/generate-white-paper-docx.mjs
 * Output: docs/CMMC_Solo_Consultant_Cloud_Options.docx
 *
 * Federal Advisory theme (Option A): Berkeley Blue + Gold palette,
 * Arial typography, warm callouts, soft table styling.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Footer,
  Header,
  PageNumber,
  NumberFormat,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  PageBreak,
  TableOfContents,
  ShadingType,
} from 'docx';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = resolve(__dirname, '..', 'docs', 'CMMC_Solo_Consultant_Cloud_Options.md');
const OUTPUT_PATH = resolve(__dirname, '..', 'docs', 'CMMC_Solo_Consultant_Cloud_Options.docx');

// ── Color constants — Federal Advisory (Berkeley Blue + Gold) ──
const PRIMARY = '1B365D';       // Berkeley Blue — headings, cover, accents
const PRIMARY_LIGHT = '2C4A7C'; // Lighter blue for H2 borders
const GOLD = 'C8972A';          // Warm gold — callout borders, highlights
const BODY_TEXT = '1B1B1B';     // Near-black body text (softer than pure black)
const BODY_GRAY = '4A4A4A';     // Secondary text
const LIGHT_GRAY = 'F7F7F5';   // Warm off-white for alternating rows
const BORDER_GRAY = 'D9D9D9';  // Soft borders
const TABLE_HEADER = '7B8C9F';  // Slate gray — table headers
const CUI_RED = 'B71C1C';      // CUI banner
const FOOTER_GRAY = '8C8C8C';
const CALLOUT_BG = 'FFF8ED';   // Warm cream for callout boxes
const CALLOUT_BORDER = 'C8972A'; // Gold left border
const WHITE = 'FFFFFF';

// ── Font constants ──
const FONT_BODY = 'Arial';
const FONT_HEADING = 'Arial';

// ── Callout section titles (left navy border + light background) ──
const CALLOUT_SECTIONS = [
  'What CUI Looks Like in Construction Work',
  "What Happens If You Don't Comply",
  'How Compliance Changes Your Daily Work',
];

// ── Markdown parser ──

/** Parse **bold** and *italic* inline formatting into TextRun[] */
function parseInlineFormatting(text, baseOpts = {}) {
  const runs = [];
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);

  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(
        new TextRun({
          text: part.slice(2, -2),
          bold: true,
          font: FONT_BODY,
          size: 22,
          color: BODY_GRAY,
          ...baseOpts,
        }),
      );
    } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          italics: true,
          font: FONT_BODY,
          size: 22,
          color: BODY_GRAY,
          ...baseOpts,
        }),
      );
    } else if (part) {
      runs.push(
        new TextRun({
          text: part,
          font: FONT_BODY,
          size: 22,
          color: BODY_GRAY,
          ...baseOpts,
        }),
      );
    }
  }

  return runs;
}

/** Parse the entire markdown file into structured elements */
function parseMarkdown(md) {
  const lines = md.split('\n');
  const elements = [];
  let i = 0;

  // Skip front matter metadata block (the table at the very top before the first ---)
  // The markdown starts with "# Title", then metadata paragraph, then a table, then ---

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Empty line
    if (!trimmed.trim()) {
      elements.push({ type: 'empty' });
      i++;
      continue;
    }

    // Horizontal rule
    if (trimmed.match(/^---+$/)) {
      elements.push({ type: 'hr' });
      i++;
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      elements.push({ type: 'h3', text: trimmed.slice(4) });
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push({ type: 'h2', text: trimmed.slice(3) });
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push({ type: 'h1', text: trimmed.slice(2) });
      i++;
      continue;
    }

    // Blockquote (may span multiple lines)
    if (trimmed.startsWith('> ')) {
      const blockLines = [];
      while (i < lines.length && (lines[i].trimEnd().startsWith('> ') || lines[i].trimEnd() === '>')) {
        const bLine = lines[i].trimEnd();
        blockLines.push(bLine === '>' ? '' : bLine.slice(2));
        i++;
      }
      elements.push({ type: 'blockquote', lines: blockLines });
      continue;
    }

    // Table detection: line starts with | and contains |
    if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
      const tableLines = [];
      while (i < lines.length && lines[i].trimEnd().startsWith('|')) {
        tableLines.push(lines[i].trimEnd());
        i++;
      }
      elements.push({ type: 'table', lines: tableLines });
      continue;
    }

    // Numbered list
    if (trimmed.match(/^\d+\.\s/)) {
      const items = [];
      while (i < lines.length && lines[i].trimEnd().match(/^\d+\.\s/)) {
        items.push(lines[i].trimEnd().replace(/^\d+\.\s*/, ''));
        i++;
      }
      elements.push({ type: 'numbered_list', items });
      continue;
    }

    // Bullet list (including nested)
    if (trimmed.match(/^[-*]\s/) || trimmed.match(/^\s+[-*]\s/)) {
      const items = [];
      while (
        i < lines.length &&
        (lines[i].trimEnd().match(/^[-*]\s/) || lines[i].trimEnd().match(/^\s+[-*]\s/))
      ) {
        const bLine = lines[i].trimEnd();
        const indent = bLine.match(/^(\s*)/)[1].length;
        const level = indent >= 2 ? 1 : 0;
        const text = bLine.replace(/^\s*[-*]\s*/, '');
        items.push({ level, text });
        i++;
      }
      elements.push({ type: 'bullet_list', items });
      continue;
    }

    // Italic-only paragraph (starts with *)
    // Regular paragraph
    elements.push({ type: 'paragraph', text: trimmed });
    i++;
  }

  return elements;
}

/** Parse a markdown table into header and rows */
function parseTable(tableLines) {
  const rows = [];
  for (const line of tableLines) {
    // Skip separator rows
    if (line.match(/^\|[\s-:|]+\|$/)) continue;

    const cells = line
      .split('|')
      .slice(1, -1) // Remove first and last empty splits
      .map((c) => c.trim());
    rows.push(cells);
  }
  return rows; // first row is header, rest are data
}

// ── DOCX builders ──

/** Build an H1 paragraph — Berkeley Blue text, gold underline, no background band */
function buildH1(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: FONT_HEADING,
        size: 36,
        bold: true,
        color: PRIMARY,
      }),
    ],
    heading: HeadingLevel.HEADING_1,
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD },
    },
    spacing: { before: 300, after: 160 },
  });
}

/** Build an H2 paragraph — Berkeley Blue text, subtle bottom border */
function buildH2(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: FONT_HEADING,
        size: 28,
        bold: true,
        color: PRIMARY,
      }),
    ],
    heading: HeadingLevel.HEADING_2,
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 2, color: PRIMARY_LIGHT },
    },
    spacing: { before: 240, after: 100 },
  });
}

/** Build an H3 paragraph — medium gray, semi-bold feel */
function buildH3(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: FONT_HEADING,
        size: 24,
        bold: true,
        color: '555555',
      }),
    ],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
  });
}

/** Build a body paragraph — 1.3 line spacing for readability */
function buildParagraph(text) {
  return new Paragraph({
    children: parseInlineFormatting(text),
    spacing: { before: 60, after: 80, line: 312 }, // ~1.3 line spacing
  });
}

/** Build a bullet list item */
function buildBullet(text, level = 0) {
  return new Paragraph({
    children: parseInlineFormatting(text),
    bullet: { level },
    spacing: { before: 24, after: 24, line: 264 },
  });
}

/** Build a numbered list item */
function buildNumbered(text, reference = 'wp-numbering') {
  return new Paragraph({
    children: parseInlineFormatting(text),
    numbering: { reference, level: 0 },
    spacing: { before: 24, after: 24, line: 264 },
  });
}

/** Build a horizontal rule */
function buildHR() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER_GRAY } },
    spacing: { before: 120, after: 120 },
  });
}

/** Build a blockquote with left gold border and italic gray text */
function buildBlockquote(blockLines) {
  const paragraphs = [];
  for (const line of blockLines) {
    if (!line.trim()) {
      paragraphs.push(
        new Paragraph({
          text: '',
          indent: { left: 720 },
        }),
      );
      continue;
    }

    // Parse headings inside blockquotes
    if (line.startsWith('**') && line.endsWith('**')) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.slice(2, -2),
              bold: true,
              italics: true,
              font: FONT_BODY,
              size: 22,
              color: '555555',
            }),
          ],
          indent: { left: 720 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 12, color: GOLD },
          },
          shading: { type: ShadingType.CLEAR, fill: CALLOUT_BG },
          spacing: { before: 60, after: 24 },
        }),
      );
    } else {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(line, { italics: true, color: '555555' }),
          indent: { left: 720 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 12, color: GOLD },
          },
          shading: { type: ShadingType.CLEAR, fill: CALLOUT_BG },
          spacing: { before: 24, after: 24 },
        }),
      );
    }
  }
  return paragraphs;
}

/** Build a callout box paragraph (cream bg + left gold border) */
function buildCalloutParagraph(text) {
  return new Paragraph({
    children: parseInlineFormatting(text),
    shading: { type: ShadingType.CLEAR, fill: CALLOUT_BG },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: CALLOUT_BORDER },
    },
    spacing: { before: 40, after: 40, line: 312 },
  });
}

/** Build a callout bullet */
function buildCalloutBullet(text, level = 0) {
  return new Paragraph({
    children: parseInlineFormatting(text),
    bullet: { level },
    shading: { type: ShadingType.CLEAR, fill: CALLOUT_BG },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: CALLOUT_BORDER },
    },
    spacing: { before: 24, after: 24, line: 312 },
  });
}

/** Build a styled table with slate gray header and warm alternating rows */
function buildTable(tableRows) {
  if (tableRows.length === 0) return [];

  const headerCells = tableRows[0];
  const dataCells = tableRows.slice(1);
  const colCount = headerCells.length;

  // Calculate column widths (distribute evenly)
  const colWidth = Math.floor(100 / colCount);

  const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY };
  const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

  // Header row
  const headerRow = new TableRow({
    children: headerCells.map(
      (cell) =>
        new TableCell({
          children: [
            new Paragraph({
              children: parseInlineFormatting(cell, { color: WHITE, bold: true }),
              spacing: { before: 60, after: 60 },
            }),
          ],
          width: { size: colWidth, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: TABLE_HEADER },
          borders: cellBorders,
        }),
    ),
  });

  // Data rows with alternating shading
  const dataRows = dataCells.map(
    (row, rowIdx) =>
      new TableRow({
        children: row.map(
          (cell, _colIdx) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: parseInlineFormatting(cell),
                  spacing: { before: 40, after: 40 },
                }),
              ],
              width: { size: colWidth, type: WidthType.PERCENTAGE },
              shading: {
                type: ShadingType.CLEAR,
                fill: rowIdx % 2 === 0 ? LIGHT_GRAY : WHITE,
              },
              borders: cellBorders,
            }),
        ),
      }),
  );

  return [
    new Table({
      rows: [headerRow, ...dataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  ];
}

/** Build the cover page — warm Federal Advisory style */
function buildCoverPage() {
  return [
    new Paragraph({ spacing: { before: 600 } }),
    // CUI Banner — muted red, not alarming
    new Paragraph({
      children: [
        new TextRun({
          text: 'CONTROLLED UNCLASSIFIED INFORMATION',
          font: FONT_HEADING,
          size: 18,
          bold: true,
          color: CUI_RED,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 200 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 2, color: CUI_RED },
        bottom: { style: BorderStyle.SINGLE, size: 2, color: CUI_RED },
      },
    }),
    new Paragraph({ spacing: { before: 500 } }),
    // Gold accent bar
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD } },
      spacing: { after: 200 },
    }),
    // Title — Berkeley Blue, no background band
    new Paragraph({
      children: [
        new TextRun({
          text: 'Microsoft Cloud Options',
          font: FONT_HEADING,
          size: 52,
          bold: true,
          color: PRIMARY,
        }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 0 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'for CMMC Compliance',
          font: FONT_HEADING,
          size: 52,
          bold: true,
          color: PRIMARY,
        }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 120 },
    }),
    // Subtitle — warm gray
    new Paragraph({
      children: [
        new TextRun({
          text: 'A Decision Guide for Small Federal Construction Contractors',
          font: FONT_BODY,
          size: 26,
          color: '6B7280',
        }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 100 },
    }),
    // Gold accent bar
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD } },
      spacing: { after: 400 },
    }),
    // Metadata table — clean, no heavy borders
    new Table({
      rows: [
        ['Date', 'April 2026'],
        ['Version', '3.0'],
        ['Prepared By', 'Blue Heron Defense'],
        ['Audience', 'Small federal construction contractors (1-3 users) expecting CUI within 1-2 years'],
        ['Scope', 'CMMC Level 2 via Microsoft 365 GCC G5; comparison with Commercial, GCC G3, GCC High G3/G5'],
      ].map(
        ([key, value], idx) =>
          new TableRow({
            children: [
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: key,
                        bold: true,
                        font: FONT_BODY,
                        size: 20,
                        color: PRIMARY,
                      }),
                    ],
                    spacing: { before: 60, after: 60 },
                  }),
                ],
                width: { size: 22, type: WidthType.PERCENTAGE },
                shading: {
                  type: ShadingType.CLEAR,
                  fill: idx % 2 === 0 ? LIGHT_GRAY : WHITE,
                },
                borders: {
                  top: { style: BorderStyle.NONE },
                  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
                  left: { style: BorderStyle.NONE },
                  right: { style: BorderStyle.NONE },
                },
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: value,
                        font: FONT_BODY,
                        size: 20,
                        color: BODY_TEXT,
                      }),
                    ],
                    spacing: { before: 60, after: 60 },
                  }),
                ],
                width: { size: 78, type: WidthType.PERCENTAGE },
                shading: {
                  type: ShadingType.CLEAR,
                  fill: idx % 2 === 0 ? LIGHT_GRAY : WHITE,
                },
                borders: {
                  top: { style: BorderStyle.NONE },
                  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
                  left: { style: BorderStyle.NONE },
                  right: { style: BorderStyle.NONE },
                },
              }),
            ],
          }),
      ),
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
    new Paragraph({ spacing: { before: 500 } }),
    // Branding footer
    new Paragraph({
      children: [
        new TextRun({
          text: 'Blue Heron Defense',
          font: FONT_HEADING,
          size: 24,
          bold: true,
          color: PRIMARY,
        }),
        new TextRun({
          text: '  \u2022  ',
          font: FONT_BODY,
          size: 24,
          color: GOLD,
        }),
        new TextRun({
          text: 'CMMC Compliance Advisory',
          font: FONT_BODY,
          size: 24,
          color: '6B7280',
        }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { before: 200, after: 100 },
    }),
    // Page break after cover
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

/** Convert parsed elements into docx Paragraph/Table children */
function buildBody(elements) {
  const children = [];
  let inCallout = false;
  let currentCalloutTitle = '';

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];

    // Check if we are entering/leaving a callout section
    if (el.type === 'h3' && CALLOUT_SECTIONS.includes(el.text)) {
      inCallout = true;
      currentCalloutTitle = el.text;
      // Build the H3 with callout styling
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: el.text,
              font: FONT_HEADING,
              size: 24,
              bold: true,
              color: PRIMARY,
            }),
          ],
          heading: HeadingLevel.HEADING_3,
          shading: { type: ShadingType.CLEAR, fill: CALLOUT_BG },
          border: {
            left: { style: BorderStyle.SINGLE, size: 18, color: CALLOUT_BORDER },
          },
          spacing: { before: 200, after: 80 },
        }),
      );
      continue;
    }

    // Exit callout on next H2 or H1 or HR
    if (inCallout && (el.type === 'h2' || el.type === 'h1' || el.type === 'hr')) {
      inCallout = false;
      currentCalloutTitle = '';
    }

    // Also exit callout on "Key takeaway" paragraphs
    if (inCallout && el.type === 'paragraph' && el.text.startsWith('**Key takeaway:')) {
      inCallout = false;
      currentCalloutTitle = '';
    }

    // Also exit on next h3 that is not a callout
    if (inCallout && el.type === 'h3' && !CALLOUT_SECTIONS.includes(el.text)) {
      inCallout = false;
      currentCalloutTitle = '';
    }

    switch (el.type) {
      case 'h1':
        // Page break before each H1 (except the very first content heading)
        children.push(new Paragraph({ children: [new PageBreak()] }));
        children.push(buildH1(el.text));
        break;

      case 'h2':
        children.push(new Paragraph({ children: [new PageBreak()] }));
        children.push(buildH2(el.text));
        break;

      case 'h3':
        children.push(buildH3(el.text));
        break;

      case 'paragraph':
        if (inCallout) {
          children.push(buildCalloutParagraph(el.text));
        } else {
          children.push(buildParagraph(el.text));
        }
        break;

      case 'bullet_list':
        for (const item of el.items) {
          if (inCallout) {
            children.push(buildCalloutBullet(item.text, item.level));
          } else {
            children.push(buildBullet(item.text, item.level));
          }
        }
        break;

      case 'numbered_list':
        for (const item of el.items) {
          children.push(buildNumbered(item));
        }
        break;

      case 'blockquote':
        children.push(...buildBlockquote(el.lines));
        break;

      case 'table': {
        const tableRows = parseTable(el.lines);
        children.push(...buildTable(tableRows));
        break;
      }

      case 'hr':
        children.push(buildHR());
        break;

      case 'empty':
        children.push(new Paragraph({ text: '', spacing: { before: 20, after: 20 } }));
        break;

      default:
        break;
    }
  }

  return children;
}

// ── Main ──

// Read and parse the markdown source
const markdown = readFileSync(INPUT_PATH, 'utf-8');
const elements = parseMarkdown(markdown);

// Build cover page
const coverPage = buildCoverPage();

// Build table of contents
const tocSection = [
  new Paragraph({
    children: [
      new TextRun({
        text: 'Table of Contents',
        font: FONT_HEADING,
        size: 28,
        bold: true,
        color: PRIMARY,
      }),
    ],
    spacing: { before: 200, after: 240 },
  }),
  new TableOfContents('Table of Contents', {
    hyperlink: true,
    headingStyleRange: '1-3',
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

// Build body content
const bodyContent = buildBody(elements);

// Assemble the document
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT_BODY, size: 22, color: BODY_TEXT },
      },
      heading1: {
        run: { font: FONT_HEADING, size: 36, bold: true, color: PRIMARY },
      },
      heading2: {
        run: { font: FONT_HEADING, size: 28, bold: true, color: PRIMARY },
      },
      heading3: {
        run: { font: FONT_HEADING, size: 24, bold: true, color: '555555' },
      },
    },
  },
  numbering: {
    config: [
      {
        reference: 'wp-numbering',
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
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Blue Heron Defense',
                  font: FONT_HEADING,
                  size: 14,
                  bold: true,
                  color: PRIMARY,
                }),
                new TextRun({
                  text: '  \u2022  ',
                  font: FONT_BODY,
                  size: 14,
                  color: GOLD,
                }),
                new TextRun({
                  text: 'CMMC Compliance Advisory',
                  font: FONT_BODY,
                  size: 14,
                  color: FOOTER_GRAY,
                }),
              ],
              alignment: AlignmentType.CENTER,
              border: {
                bottom: { style: BorderStyle.SINGLE, size: 1, color: PRIMARY },
              },
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Controlled Unclassified Information  |  Page ',
                  font: FONT_BODY,
                  size: 16,
                  color: FOOTER_GRAY,
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  font: FONT_BODY,
                  size: 16,
                  color: FOOTER_GRAY,
                }),
              ],
              alignment: AlignmentType.CENTER,
              border: {
                top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY },
              },
            }),
          ],
        }),
      },
      children: [...coverPage, ...tocSection, ...bodyContent],
    },
  ],
});

// Generate and save
const buffer = await Packer.toBuffer(doc);
writeFileSync(OUTPUT_PATH, buffer);
console.log(`White paper written to: ${OUTPUT_PATH}`);
console.log(`Size: ${(buffer.length / 1024).toFixed(1)} KB`);
