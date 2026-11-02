// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Abstract base class with shared DOCX primitives.
 * CUI header/footer pattern copied from SspDocxExporter.
 * Uses docx package directly via createRequire (ESM incompatibility workaround).
 */

import { createRequire } from 'node:module';
import type { RenderDirective, RenderResult, RenderContext, ResolverResponse, IRenderTemplate } from '../../../shared/types/render.types.js';

// EO-19: named `_require`, not `require` -- the plain name collides with the ambient `require`
// the CJS module wrapper already injects once this file is compiled to CommonJS (ts-jest's
// import.meta transform for tests, and Node's own CJS interop), causing
// "Identifier 'require' has already been declared". Matches the pattern already used elsewhere
// (SspDocxExporter.ts, PoamDocxExporter.ts, SprsCalculator.ts, etc.).
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const docx: any = _require('docx');
const {
  Document, Packer, Paragraph, TextRun, Header, Footer,
  AlignmentType, NumberFormat, Table, TableRow, TableCell,
  PageBreak, HeadingLevel, WidthType, BorderStyle,
} = docx;

export abstract class BaseDocxRenderer implements IRenderTemplate {
  abstract readonly directiveCodes: string[];

  abstract render(
    directive: RenderDirective,
    resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult>;

  /**
   * CUI header: "CUI" centered 10pt (matches SspDocxExporter pattern).
   */
  protected renderCuiHeader(): any {
    return new Header({
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
    });
  }

  /**
   * CUI footer: "CUI // SP-SSP // CMMC L2" centered 8pt (matches SspDocxExporter pattern).
   */
  protected renderCuiFooter(): any {
    return new Footer({
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
    });
  }

  /**
   * Render a table with header row and data rows.
   */
  protected renderTable(headers: string[], rows: string[][]): any {
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

  /**
   * Render a section heading with a following empty paragraph.
   */
  protected renderSection(title: string, level?: any): any[] {
    return [
      new Paragraph({
        heading: level ?? HeadingLevel.HEADING_1,
        children: [new TextRun({ text: title })],
      }),
      new Paragraph({ text: '' }),
    ];
  }

  /**
   * Create a DOCX buffer from an array of paragraph children with CUI markings.
   */
  protected async createDocxBuffer(children: any[]): Promise<Buffer> {
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
            default: this.renderCuiHeader(),
          },
          footers: {
            default: this.renderCuiFooter(),
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    return Buffer.from(buffer);
  }

  /**
   * Helper to create a text paragraph.
   */
  protected textParagraph(text: string, options?: { bold?: boolean; size?: number; italics?: boolean; color?: string }): any {
    return new Paragraph({
      children: [new TextRun({
        text,
        size: options?.size ?? 24,
        bold: options?.bold,
        italics: options?.italics,
        color: options?.color,
      })],
    });
  }

  /**
   * Helper to create a "Data unavailable" notice paragraph.
   */
  protected dataUnavailableNotice(source: string): any {
    return new Paragraph({
      children: [new TextRun({
        text: `Data unavailable: ${source}. This section requires manual input or data source integration.`,
        italics: true,
        color: 'FF0000',
        size: 24,
      })],
    });
  }

  /**
   * Helper: empty paragraph spacer.
   */
  protected emptyParagraph(): any {
    return new Paragraph({ text: '' });
  }

  /**
   * Helper: page break paragraph.
   */
  protected pageBreak(): any {
    return new Paragraph({ children: [new PageBreak()] });
  }
}
