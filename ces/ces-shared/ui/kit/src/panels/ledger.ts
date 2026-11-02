// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Resource Ledger data: filter and the three exports, ported from the legacy console
// (ces-stamper/public/index.html filterResourceLedger, generateMarkdownExport,
// generateJSONExport, generateCSVExport, computeSHA256, simpleHash). Pure; no DOM, no fetch.

export type LedgerCategory = 'discovered' | 'created';

/** One ledger row, same keys and key order as the legacy `resourceLedger` entries. */
export interface LedgerEntry {
  category: LedgerCategory;
  type: string;
  path: string;
  step: string;
  timestamp: string;
  cmdlet: string;
}

export interface LedgerFilter {
  discovered: boolean;
  created: boolean;
  /** Exact resource type, or '' for all. */
  type: string;
  /** Exact step (task id), or '' for all. */
  step: string;
  /** Space-separated terms; every term must match (case-insensitive). */
  search: string;
}

export const DEFAULT_LEDGER_FILTER: LedgerFilter = {
  discovered: true,
  created: true,
  type: '',
  step: '',
  search: '',
};

export type LedgerExportFormat = 'md' | 'json' | 'csv';

export interface LedgerExportMeta {
  planId: string;
  tenant: string;
  timestamp: string;
  operator: string;
}

export interface LedgerExportFile {
  content: string;
  mimeType: string;
  filename: string;
}

export function filterLedger(entries: readonly LedgerEntry[], filter: LedgerFilter): LedgerEntry[] {
  const terms = filter.search
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return entries.filter((entry) => {
    if (!filter.discovered && entry.category === 'discovered') return false;
    if (!filter.created && entry.category === 'created') return false;
    if (filter.type && entry.type !== filter.type) return false;
    if (filter.step && entry.step !== filter.step) return false;
    if (terms.length > 0) {
      const text = `${entry.type} ${entry.path} ${entry.step} ${entry.cmdlet}`.toLowerCase();
      for (const term of terms) if (text.indexOf(term) < 0) return false;
    }
    return true;
  });
}

function mdSection(title: string, rows: readonly LedgerEntry[], lines: string[]) {
  if (rows.length === 0) return;
  lines.push(`## ${title} (${rows.length})`);
  lines.push('| Type | Path | Step | Cmdlet | Timestamp |');
  lines.push('|------|------|------|--------|-----------|');
  for (const e of rows) {
    lines.push(`| ${e.type} | ${e.path} | ${e.step} | ${e.cmdlet.substring(0, 50)} | ${e.timestamp} |`);
  }
  lines.push('');
}

export function ledgerToMarkdown(entries: readonly LedgerEntry[], meta: LedgerExportMeta): string {
  const lines: string[] = [
    '# Resource Ledger',
    `**Plan ID:** ${meta.planId}`,
    `**Tenant:** ${meta.tenant}`,
    `**Timestamp:** ${meta.timestamp}`,
    `**Operator:** ${meta.operator}`,
    '',
  ];
  mdSection('Discovered Resources', entries.filter((e) => e.category === 'discovered'), lines);
  mdSection('Created Resources', entries.filter((e) => e.category === 'created'), lines);
  return lines.join('\n');
}

export function ledgerToCsv(entries: readonly LedgerEntry[]): string {
  const lines = ['Category,Type,Path,Step,Cmdlet,Timestamp'];
  for (const e of entries) {
    const cmdlet = e.cmdlet.replace(/"/g, '""');
    lines.push(`${e.category},"${e.type}","${e.path}","${e.step}","${cmdlet}",${e.timestamp}`);
  }
  return lines.join('\n');
}

export function ledgerToJson(entries: readonly LedgerEntry[], meta: LedgerExportMeta, sha256Hash: string): string {
  return JSON.stringify(
    {
      executionMetadata: {
        planId: meta.planId,
        tenant: meta.tenant,
        timestamp: meta.timestamp,
        operator: meta.operator,
        sha256Hash,
      },
      resources: entries,
    },
    null,
    2,
  );
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return `simple_${Math.abs(hash).toString(16)}`;
}

/** SHA-256 hex of `JSON.stringify(entries)`; the legacy `simple_` hash when Web Crypto is unavailable. */
export async function ledgerSha256(entries: readonly LedgerEntry[]): Promise<string> {
  const text = JSON.stringify(entries);
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return simpleHash(text);
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return simpleHash(text);
  }
}

/** Content, MIME type and filename of one export, as the legacy page downloads it. */
export async function buildLedgerExport(
  format: LedgerExportFormat,
  entries: readonly LedgerEntry[],
  meta: LedgerExportMeta,
): Promise<LedgerExportFile> {
  if (format === 'md') {
    return { content: ledgerToMarkdown(entries, meta), mimeType: 'text/markdown', filename: `resource-ledger-${meta.planId}.md` };
  }
  if (format === 'json') {
    const hash = await ledgerSha256(entries);
    return { content: ledgerToJson(entries, meta, hash), mimeType: 'application/json', filename: `resource-ledger-${meta.planId}.json` };
  }
  return { content: ledgerToCsv(entries), mimeType: 'text/csv', filename: `resource-ledger-${meta.planId}.csv` };
}
