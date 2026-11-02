/**
 * Synthetic-customer W5 cycle 3 (P11): the organisation operating records a synthetic customer carries
 * (`customers/<slug>/records/catalog.json`, written by the run package's scripts/build-customer-records.mjs)
 * and their Evidence Collector uploads at step E8.5. A scenario without a records folder (muster-partial)
 * has no catalog, and E8.5 makes only its one scenario upload, as before.
 *
 * Each catalog item becomes one EC `POST /api/ingest` body: the item's control tags as `controlIds`,
 * `source` manual_upload, and no `form_id` / `emx_ids` (the release-0 evidence catalog has no form for
 * these records, and EC rejects an unknown id). EC never assigns a verdict and EO appends EC items after
 * a status is computed, so these uploads change no status (verify V27).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const RECORDS_CATALOG_SCHEMA = 'ces-org-records-catalog/1';

export interface RecordsCatalogItem {
  file: string;
  record_kind: string;
  kind_label?: string;
  title?: string;
  control_ids: string[];
  closes?: string[];
  media_type: string;
  submitted_by_role: string;
  collected_at: string;
  rows: number;
  period?: { from: string; to: string };
  sha256: string;
  size_bytes: number;
}

export interface RecordsCatalog {
  schema: string;
  slug: string;
  items: RecordsCatalogItem[];
}

/** customers/<slug>/records under the run package. */
export function recordsDir(packageRoot: string, slug: string): string {
  return path.join(packageRoot, 'customers', slug, 'records');
}

/** The customer's records catalog, or null when the customer has no records folder (or no catalog in it). */
export function loadRecordsCatalog(packageRoot: string, slug: string): RecordsCatalog | null {
  const p = path.join(recordsDir(packageRoot, slug), 'catalog.json');
  if (!fs.existsSync(p)) return null;
  const c = JSON.parse(fs.readFileSync(p, 'utf8')) as RecordsCatalog;
  if (c.schema !== RECORDS_CATALOG_SCHEMA) throw new Error(`${p}: schema ${String(c.schema)}, expected ${RECORDS_CATALOG_SCHEMA}`);
  if (c.slug !== slug) throw new Error(`${p}: slug ${String(c.slug)}, expected ${slug}`);
  if (!Array.isArray(c.items)) throw new Error(`${p}: no items[]`);
  return c;
}

export interface EcIngestBody {
  tenantSlug: string;
  controlIds: string[];
  source: 'manual_upload';
  filename: string;
  mediaType: string;
  contentBase64: string;
  submittedByRole: string;
  collectedAt: string;
}

export interface RecordUploadRequest {
  file: string;
  recordKind: string;
  sha256: string;
  body: EcIngestBody;
}

/**
 * One EC ingest body per catalog item. Throws when a file is missing, its bytes do not hash to the catalog's
 * sha256, or an item has no control tag: a stale records folder must fail E8.5, not upload silently.
 */
export function recordUploadRequests(catalog: RecordsCatalog, slug: string, readFile: (file: string) => Buffer): RecordUploadRequest[] {
  return catalog.items.map((item) => {
    if (!item.control_ids?.length) throw new Error(`records catalog item ${item.file} has no control_ids`);
    if (path.basename(item.file) !== item.file) throw new Error(`records catalog item ${item.file} is not a bare file name`);
    const bytes = readFile(item.file);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== item.sha256) throw new Error(`records file ${item.file}: sha256 ${sha} differs from the catalog ${item.sha256} (re-run scripts/build-customer-records.mjs)`);
    return {
      file: item.file,
      recordKind: item.record_kind,
      sha256: item.sha256,
      body: {
        tenantSlug: slug,
        controlIds: [...item.control_ids],
        source: 'manual_upload',
        filename: item.file,
        mediaType: item.media_type,
        contentBase64: bytes.toString('base64'),
        submittedByRole: item.submitted_by_role,
        collectedAt: item.collected_at,
      },
    };
  });
}

export interface RecordUploadResult {
  file: string;
  record_kind: string;
  control_ids: string[];
  http_status: number | null;
  item_id: string | null;
  sha256: string;
  sha256_match: boolean;
  /** NS-4t: EC's recorded uploader UPN (uploadedBy.upn); present only when the upload carried a principal header. */
  uploaded_by?: string | null;
  error?: string;
}

/**
 * Posts each request to EC's /api/ingest; one result row per item (never throws). NS-4t: `principalHeaders` (the
 * uploader's signed `x-ces-principal`) go on every request, and each row then carries EC's `uploaded_by`.
 */
export async function uploadRecords(
  ecUrl: string,
  secret: string,
  requests: RecordUploadRequest[],
  fetchImpl: typeof fetch = fetch,
  principalHeaders: Record<string, string> = {},
): Promise<RecordUploadResult[]> {
  const withPrincipal = Object.keys(principalHeaders).length > 0;
  const out: RecordUploadResult[] = [];
  for (const r of requests) {
    const row: RecordUploadResult = { file: r.file, record_kind: r.recordKind, control_ids: r.body.controlIds, http_status: null, item_id: null, sha256: r.sha256, sha256_match: false, ...(withPrincipal ? { uploaded_by: null } : {}) };
    try {
      const resp = await fetchImpl(`${ecUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, ...principalHeaders },
        body: JSON.stringify(r.body),
        signal: AbortSignal.timeout(60000),
      });
      row.http_status = resp.status;
      const text = await resp.text();
      if (resp.status === 201) {
        const item = JSON.parse(text) as { itemId?: string; sha256?: string; uploadedBy?: { upn?: string } | null };
        row.item_id = item.itemId ?? null;
        row.sha256_match = item.sha256 === r.sha256;
        if (withPrincipal) row.uploaded_by = item.uploadedBy?.upn ?? null;
      } else row.error = text.slice(0, 300);
    } catch (err) {
      row.error = String(err);
    }
    out.push(row);
  }
  return out;
}

/** A records upload passes when every item answered 201 with an item id and EC's sha256 equals the catalog's. */
export function recordUploadsOk(rows: RecordUploadResult[]): boolean {
  return rows.every((r) => r.http_status === 201 && !!r.item_id && r.sha256_match);
}
