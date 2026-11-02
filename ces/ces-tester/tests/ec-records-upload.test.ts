// Synthetic-customer W5 cycle 3 (P11): the E8.5 organisation-records upload mapping (src/flow/ec-records.ts).
// Fixtures are written to a fresh temp folder; the run package is not read.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadRecordsCatalog, recordUploadRequests, recordUploadsOk, recordsDir, uploadRecords, RECORDS_CATALOG_SCHEMA,
  type RecordsCatalog, type RecordUploadRequest,
} from '../src/flow/ec-records.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const FILES: Record<string, Buffer> = {
  'training-role-based.json': Buffer.from('{"schema":"ces-org-record/1","record_kind":"training_completion","rows":[{"date":"2026-08-04"}]}\n'),
  'physical-access-log.json': Buffer.from('{"schema":"ces-org-record/1","record_kind":"physical_access_log","rows":[{"date":"2026-09-30"}]}\n'),
};
function catalog(over: Partial<RecordsCatalog['items'][number]> = {}): RecordsCatalog {
  return {
    schema: RECORDS_CATALOG_SCHEMA,
    slug: 's1-mach',
    items: [
      { file: 'training-role-based.json', record_kind: 'training_completion', control_ids: ['AT.L2-3.2.2'], media_type: 'application/json', submitted_by_role: 'compliance_officer', collected_at: '2026-08-04T17:00:00.000Z', rows: 1, sha256: sha(FILES['training-role-based.json']), size_bytes: FILES['training-role-based.json'].length, ...over },
      { file: 'physical-access-log.json', record_kind: 'physical_access_log', control_ids: ['PE.L1-3.10.1', 'PE.L2-3.10.2', 'PE.L1-3.10.4'], media_type: 'application/json', submitted_by_role: 'compliance_officer', collected_at: '2026-09-30T17:00:00.000Z', rows: 1, sha256: sha(FILES['physical-access-log.json']), size_bytes: FILES['physical-access-log.json'].length },
    ],
  };
}
const read = (f: string) => FILES[f];

describe('E8.5 organisation records (P11)', () => {
  it('maps each catalog item to one EC ingest body: control tags, manual_upload, collectedAt, no catalog ids', () => {
    const reqs = recordUploadRequests(catalog(), 's1-mach', read);
    expect(reqs.map((r) => r.file)).toEqual(['training-role-based.json', 'physical-access-log.json']);
    expect(reqs[1].body).toEqual({
      tenantSlug: 's1-mach',
      controlIds: ['PE.L1-3.10.1', 'PE.L2-3.10.2', 'PE.L1-3.10.4'],
      source: 'manual_upload',
      filename: 'physical-access-log.json',
      mediaType: 'application/json',
      contentBase64: FILES['physical-access-log.json'].toString('base64'),
      submittedByRole: 'compliance_officer',
      collectedAt: '2026-09-30T17:00:00.000Z',
    });
    for (const r of reqs) {
      expect(r.body).not.toHaveProperty('form_id');
      expect(r.body).not.toHaveProperty('emx_ids');
      expect(Buffer.from(r.body.contentBase64, 'base64').equals(read(r.file))).toBe(true);
    }
  });

  it('a file whose bytes differ from the catalog hash, an untagged item or a path in the file name throws', () => {
    expect(() => recordUploadRequests(catalog({ sha256: 'f'.repeat(64) }), 's1-mach', read)).toThrow(/differs from the catalog/);
    expect(() => recordUploadRequests(catalog({ control_ids: [] }), 's1-mach', read)).toThrow(/no control_ids/);
    expect(() => recordUploadRequests(catalog({ file: '../x.json' }), 's1-mach', read)).toThrow(/bare file name/);
  });

  it('no records folder (muster-partial): no catalog; a catalog for another slug or schema is refused', () => {
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-records-'));
    try {
      expect(loadRecordsCatalog(pkg, 'muster-partial')).toBeNull();
      fs.mkdirSync(recordsDir(pkg, 's1-mach'), { recursive: true });
      fs.writeFileSync(path.join(recordsDir(pkg, 's1-mach'), 'catalog.json'), JSON.stringify(catalog()));
      expect(loadRecordsCatalog(pkg, 's1-mach')?.items.length).toBe(2);
      fs.mkdirSync(recordsDir(pkg, 'other'), { recursive: true });
      fs.writeFileSync(path.join(recordsDir(pkg, 'other'), 'catalog.json'), JSON.stringify(catalog()));
      expect(() => loadRecordsCatalog(pkg, 'other')).toThrow(/slug s1-mach, expected other/);
      fs.writeFileSync(path.join(recordsDir(pkg, 'other'), 'catalog.json'), JSON.stringify({ ...catalog(), slug: 'other', schema: 'x/1' }));
      expect(() => loadRecordsCatalog(pkg, 'other')).toThrow(/schema x\/1/);
    } finally {
      fs.rmSync(pkg, { recursive: true, force: true });
    }
  });

  it('uploads: 201 with the same sha256 passes; a 400, a different sha256 or a network error fails', async () => {
    const reqs: RecordUploadRequest[] = recordUploadRequests(catalog(), 's1-mach', read);
    const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
    const answer = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    const fake = (mode: 'ok' | 'bad-status' | 'bad-sha' | 'throw'): typeof fetch => (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(url), auth: String((init?.headers as Record<string, string>).Authorization), body });
      if (mode === 'throw') throw new Error('ECONNREFUSED');
      if (mode === 'bad-status') return answer(400, '{"error":"invalid_request"}');
      const content = Buffer.from(String(body.contentBase64), 'base64');
      return answer(201, { itemId: `eci-${calls.length}`, sha256: mode === 'bad-sha' ? '0'.repeat(64) : sha(content) });
    }) as typeof fetch;

    const ok = await uploadRecords('http://127.0.0.1:4001', 'sek', reqs, fake('ok'));
    expect(recordUploadsOk(ok)).toBe(true);
    expect(ok.map((r) => [r.file, r.http_status, r.item_id, r.sha256_match])).toEqual([
      ['training-role-based.json', 201, 'eci-1', true],
      ['physical-access-log.json', 201, 'eci-2', true],
    ]);
    expect(calls[0].url).toBe('http://127.0.0.1:4001/api/ingest');
    expect(calls[0].auth).toBe('Bearer sek');
    expect(ok[1].control_ids).toEqual(['PE.L1-3.10.1', 'PE.L2-3.10.2', 'PE.L1-3.10.4']);

    for (const mode of ['bad-status', 'bad-sha', 'throw'] as const) {
      const rows = await uploadRecords('http://127.0.0.1:4001', 'sek', reqs, fake(mode));
      expect(rows).toHaveLength(2);
      expect(recordUploadsOk(rows)).toBe(false);
    }
  });
});
