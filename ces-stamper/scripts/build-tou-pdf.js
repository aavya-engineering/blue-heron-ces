#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// build-tou-pdf.js — Generates a minimal valid PDF with CUI Terms of Use content.
// Zero external dependencies. Run: node scripts/build-tou-pdf.js
// Output: public/data/CUI-System-Access-Notice.pdf

const fs = require('fs');
const path = require('path');

const OUTPUT = path.resolve(__dirname, '..', 'public', 'data', 'CUI-System-Access-Notice.pdf');

// ── TOU Content ──────────────────────────────────────────────────────────────

const sections = [
  {
    title: '1.  AUTHORIZED USE ONLY',
    body: [
      'This information system processes, stores, and transmits Controlled',
      'Unclassified Information (CUI) and is designated for AUTHORIZED USE ONLY.',
      'Access is restricted to personnel who have been granted explicit',
      'authorization in accordance with 32 CFR Part 2002 and NIST SP 800-171.',
      'Unauthorized access, use, or modification is strictly prohibited and may',
      'result in disciplinary action, civil penalties, and/or criminal prosecution.',
    ],
  },
  {
    title: '2.  CUI HANDLING OBLIGATIONS',
    body: [
      'All users must comply with the following CUI handling requirements:',
      '',
      '  - Mark all CUI documents with the appropriate CUI banner and category.',
      '  - Store CUI only on authorized systems meeting NIST SP 800-171 controls.',
      '  - Transmit CUI only via encrypted channels (TLS 1.2+ or equivalent).',
      '  - Destroy CUI media in accordance with NIST SP 800-88 guidelines.',
      '  - Do not forward, copy, or share CUI with unauthorized individuals.',
    ],
  },
  {
    title: '3.  MONITORING AND CONSENT',
    body: [
      'By accessing this system you consent to the following:',
      '',
      '  - All activity on this system may be monitored, recorded, and audited.',
      '  - There is no expectation of privacy when using this system.',
      '  - Evidence of unauthorized activity may be provided to law enforcement.',
      '  - Monitoring includes but is not limited to: sign-in events, file access,',
      '    email and messaging content, and administrative actions.',
    ],
  },
  {
    title: '4.  INCIDENT REPORTING',
    body: [
      'Users must immediately report any suspected or confirmed security incident',
      'to the Information System Security Officer (ISSO). Reportable events include:',
      '',
      '  - Unauthorized access to CUI or CUI systems.',
      '  - Loss or theft of devices containing CUI.',
      '  - Suspected malware, phishing, or social engineering attempts.',
      '  - Any deviation from established CUI handling procedures.',
      '',
      'Failure to report incidents may itself constitute a violation.',
    ],
  },
  {
    title: '5.  ACKNOWLEDGMENT',
    body: [
      'By proceeding past this notice, I acknowledge that I have read, understand,',
      'and agree to comply with all terms stated above. I understand that violation',
      'of these terms may result in revocation of access, disciplinary action, and',
      'referral for criminal prosecution under applicable federal statutes.',
    ],
  },
];

// ── Minimal PDF Builder ──────────────────────────────────────────────────────
// Constructs a bare-bones PDF 1.4 with a single page of text using built-in
// Helvetica (no embedded fonts required).

function buildPdf() {
  const PAGE_W = 612; // letter width in points
  const PAGE_H = 792; // letter height
  const MARGIN = 60;
  const LINE_HEIGHT = 14;
  const TITLE_SIZE = 16;
  const SECTION_TITLE_SIZE = 11;
  const BODY_SIZE = 10;

  // Collect all text stream commands
  const lines = [];
  let y = PAGE_H - MARGIN;

  function addLine(text, fontSize, bold) {
    if (y < MARGIN + 20) return; // stop near bottom
    const font = bold ? '/F2' : '/F1';
    // Escape PDF special chars in text
    const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    lines.push(`BT ${font} ${fontSize} Tf ${MARGIN} ${y.toFixed(1)} Td (${escaped}) Tj ET`);
    y -= LINE_HEIGHT;
  }

  // Title
  addLine('CUI SYSTEM ACCESS NOTICE', TITLE_SIZE, true);
  addLine('Terms of Use Agreement', TITLE_SIZE, true);
  y -= LINE_HEIGHT; // blank line after title

  for (const section of sections) {
    if (y < MARGIN + 60) break; // need room for at least a heading + a few lines
    addLine(section.title, SECTION_TITLE_SIZE, true);
    y -= 2;
    for (const line of section.body) {
      if (line === '') {
        y -= LINE_HEIGHT * 0.5;
        continue;
      }
      addLine(line, BODY_SIZE, false);
    }
    y -= LINE_HEIGHT * 0.6; // gap between sections
  }

  const stream = lines.join('\n');
  const streamBytes = Buffer.from(stream, 'latin1');

  // Build PDF objects
  const objs = [];

  // obj 1: Catalog
  objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  // obj 2: Pages
  objs.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  // obj 3: Page
  objs.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
    `/Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj`
  );
  // obj 4: Stream
  objs.push(
    `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream\nendobj`
  );
  // obj 5: Font (Helvetica)
  objs.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  // obj 6: Font (Helvetica-Bold)
  objs.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');

  // Assemble
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += obj + '\n';
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n';
  pdf += `0 ${objs.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const off of offsets) {
    pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n';
  pdf += `<< /Size ${objs.length + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += xrefOffset + '\n';
  pdf += '%%EOF\n';

  return Buffer.from(pdf, 'latin1');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const buf = buildPdf();
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, buf);
console.log(`Generated ${OUTPUT} (${buf.length} bytes)`);
