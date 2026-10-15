// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

export interface CuiAcknowledgmentOptions {
  personName?: string;
  organizationName?: string;
}

export async function generateCuiAcknowledgmentPdf(opts: CuiAcknowledgmentOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Letter size
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  let y = height - 50;

  // Header
  page.drawText('CUI HANDLING ACKNOWLEDGMENT', {
    x: 50, y, size: 16, font: fontBold, color: rgb(0, 0, 0),
  });
  y -= 20;
  page.drawText('Personnel Screening — Element 6', {
    x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3),
  });
  y -= 30;

  // Divider
  page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= 25;

  // Form fields
  const form = doc.getForm();

  // --- Person Name ---
  page.drawText('Full Name:', { x: 50, y, size: 11, font: fontBold });
  const nameField = form.createTextField('person_name');
  nameField.addToPage(page, { x: 150, y: y - 4, width: 350, height: 18 });
  if (opts.personName) nameField.setText(opts.personName);
  y -= 30;

  // --- Organization ---
  page.drawText('Organization:', { x: 50, y, size: 11, font: fontBold });
  const orgField = form.createTextField('organization');
  orgField.addToPage(page, { x: 150, y: y - 4, width: 350, height: 18 });
  if (opts.organizationName) orgField.setText(opts.organizationName);
  y -= 30;

  // --- Title / Role ---
  page.drawText('Title / Role:', { x: 50, y, size: 11, font: fontBold });
  const titleField = form.createTextField('title_role');
  titleField.addToPage(page, { x: 150, y: y - 4, width: 350, height: 18 });
  y -= 30;

  // --- Date ---
  page.drawText('Date:', { x: 50, y, size: 11, font: fontBold });
  const dateField = form.createTextField('acknowledgment_date');
  dateField.addToPage(page, { x: 150, y: y - 4, width: 200, height: 18 });
  y -= 40;

  // Section: Acknowledgment Body
  page.drawText('ACKNOWLEDGMENT OF CUI HANDLING OBLIGATIONS', {
    x: 50, y, size: 12, font: fontBold,
  });
  y -= 20;

  const paragraphs = [
    'I, the undersigned, acknowledge that in the performance of my duties I may have access to Controlled Unclassified Information (CUI) as defined by 32 CFR Part 2002 and Executive Order 13556.',
    '',
    'I understand and agree to the following:',
  ];

  for (const para of paragraphs) {
    if (para === '') { y -= 10; continue; }
    const lines = wrapText(para, font, 11, width - 100);
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 11, font });
      y -= 15;
    }
    y -= 5;
  }

  y -= 5;

  const obligations = [
    '1. NIST SP 800-171 Compliance — I will handle CUI in accordance with the security requirements specified in NIST SP 800-171 Rev. 2 and any organizational policies derived therefrom.',
    '2. Marking Requirements — I will properly mark all CUI materials with the appropriate CUI designation indicators, category markings, and dissemination controls as required by 32 CFR 2002.20.',
    '3. Access Controls — I will only access CUI for which I have a lawful government purpose and will not share CUI with unauthorized individuals, including those lacking a legitimate need-to-know.',
    '4. Storage and Transmission — I will store CUI only in authorized information systems and transmit CUI only through approved encrypted channels.',
    '5. Incident Reporting — I will immediately report any known or suspected loss, compromise, or unauthorized disclosure of CUI to the designated Incident Response authority.',
    '6. Disciplinary Consequences — I understand that violation of these obligations may result in disciplinary action, termination of access, termination of employment, civil penalties, or criminal prosecution as applicable.',
    '7. Continuing Obligation — I understand these obligations remain in effect for the duration of my access to CUI and survive the termination of my employment or contract.',
  ];

  for (const item of obligations) {
    const lines = wrapText(item, font, 10, width - 110);
    for (const line of lines) {
      page.drawText(line, { x: 60, y, size: 10, font });
      y -= 14;
    }
    y -= 8;
  }

  y -= 15;

  // Checkbox
  page.drawText('I have read, understand, and agree to comply with the above obligations:', {
    x: 50, y, size: 11, font: fontBold,
  });
  const checkbox = form.createCheckBox('agree_checkbox');
  checkbox.addToPage(page, { x: 52, y: y - 22, width: 14, height: 14 });
  page.drawText('I AGREE', { x: 72, y: y - 20, size: 11, font: fontBold });
  y -= 50;

  // Signature field
  page.drawText('Signature:', { x: 50, y, size: 11, font: fontBold });
  const sigField = form.createTextField('signature');
  sigField.addToPage(page, { x: 50, y: y - 40, width: 250, height: 35 });
  y -= 50;

  page.drawText('Date Signed:', { x: 320, y: y + 10, size: 11, font: fontBold });
  const dateSigField = form.createTextField('date_signed');
  dateSigField.addToPage(page, { x: 320, y: y - 40 + 10, width: 180, height: 18 });

  // Footer
  page.drawText('This form satisfies CMMC Level 2 screening Element 6 (CUI Acknowledgment).', {
    x: 50, y: 40, size: 8, font, color: rgb(0.4, 0.4, 0.4),
  });
  page.drawText('Generated by VFS Evidence Ops', {
    x: 50, y: 28, size: 8, font, color: rgb(0.4, 0.4, 0.4),
  });

  return await doc.save();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    const w = font.widthOfTextAtSize(test, size);
    if (w > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
