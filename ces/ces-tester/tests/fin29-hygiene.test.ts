// FIN-29 (finishing plan PH-2): SP-11 hygiene helpers (leak scan, live-folder guard) and the E6 state-wipe keep list.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RunSecrets, liveFolderViolations, runScanRoots, scanForSecrets, secretForms, SECRET_SCAN_SCHEMA } from '../src/flow/fin29-hygiene.js';
import { MUSTER_STATE_KEEP, perRunArtefacts, wipeKeeping } from '../src/flow/muster-e2e-run.js';
import { FIN29_FILES } from '../src/flow/fin29-common.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'fin29-hyg-'));

describe('leak scan (V101)', () => {
  it('counts raw, base64 and URL-encoded copies and never writes the value', () => {
    const d = tmp();
    const secret = 'fictional-secret-value-0123456789+/=';
    fs.mkdirSync(path.join(d, 'out', 'logs'), { recursive: true });
    fs.writeFileSync(path.join(d, 'out', 'a.json'), JSON.stringify({ x: secret }));
    fs.writeFileSync(path.join(d, 'out', 'logs', 'b.log'), `token=${Buffer.from(secret).toString('base64').replace(/=+$/, '')}\n${encodeURIComponent(secret)}`);
    fs.writeFileSync(path.join(d, 'out', 'clean.txt'), 'nothing here');
    const secrets = new RunSecrets();
    secrets.register('demo', secret);
    secrets.register('other', 'another-fictional-value-abcdef');
    secrets.register('empty', '');
    const rec = scanForSecrets({ secrets: secrets.map, roots: [{ name: 'out', dir: path.join(d, 'out') }, { name: 'missing', dir: path.join(d, 'nope') }], relTo: d, now: () => '2026-10-31T00:00:00.000Z' });
    expect(rec.schema).toBe(SECRET_SCAN_SCHEMA);
    expect(secrets.names()).toEqual(['demo', 'other']);
    const demo = rec.secrets.find((s) => s.name === 'demo')!;
    expect(demo.hits).toBe(3);
    expect(demo.files_with_hits).toBe(2);
    expect(demo.encodings.sort()).toEqual(['base64', 'raw', 'url']);
    expect(rec.secrets.find((s) => s.name === 'other')!.hits).toBe(0);
    expect(rec.hit_files).toEqual(['out/a.json', 'out/logs/b.log']);
    expect(rec.roots.find((r) => r.name === 'missing')).toMatchObject({ present: false, files: 0 });
    expect(JSON.stringify(rec)).not.toContain(secret);
    expect(JSON.stringify(rec)).not.toContain('another-fictional-value');
  });

  it('excludes files on request and skips files above the size cap', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'big.bin'), 'x'.repeat(100) + 'secret-for-size-cap-0001');
    fs.writeFileSync(path.join(d, 'own.json'), 'secret-for-size-cap-0001');
    const s = new RunSecrets();
    s.register('s', 'secret-for-size-cap-0001');
    const rec = scanForSecrets({ secrets: s.map, roots: [{ name: 'out', dir: d }], relTo: d, maxBytes: 50, exclude: (f) => f.endsWith('own.json') });
    expect(rec.roots[0]).toMatchObject({ files: 0, skipped_large: 1 });
    expect(rec.secrets[0].hits).toBe(0);
  });

  it('secretForms dedupes identical encodings', () => {
    const forms = secretForms('abcdefghijklmnop').map((f) => f.encoding);
    expect(forms).toContain('raw');
    expect(forms).toContain('base64');
    expect(new Set(forms).size).toBe(forms.length);
  });

  it('the run roots are out/, the EO evidence store, the EC store and Stamper evidence', () => {
    expect(runScanRoots({ out: 'W/out', pl: 'W/pl', slug: 's1' }).map((r) => r.name)).toEqual(['out', 'eo-evidence-store', 'ec-store', 'stamper-evidence']);
  });
});

describe('live-folder guard (SP-11)', () => {
  it('passes a run-owned tenant root that CES_TENANT_ROOT names', () => {
    const home = tmp();
    const root = path.join(tmp(), 'tenants');
    expect(liveFolderViolations({ tenantRoot: root, env: { CES_TENANT_ROOT: root }, home })).toEqual([]);
  });
  it('refuses the machine registry, an unset env, a mismatched env and a live record', () => {
    const home = tmp();
    const def = path.join(home, '.ces', 'tenants');
    expect(liveFolderViolations({ tenantRoot: def, env: { CES_TENANT_ROOT: def }, home }).join(' ')).toMatch(/machine registry/);
    expect(liveFolderViolations({ tenantRoot: path.join(def, 'sim'), env: { CES_TENANT_ROOT: path.join(def, 'sim') }, home }).join(' ')).toMatch(/machine registry/);
    const root = path.join(tmp(), 'tenants');
    expect(liveFolderViolations({ tenantRoot: root, env: {}, home }).join(' ')).toMatch(/unset/);
    expect(liveFolderViolations({ tenantRoot: root, env: { CES_TENANT_ROOT: path.join(root, 'x') }, home }).join(' ')).toMatch(/is not the run's tenant root/);
    fs.mkdirSync(path.join(root, 'live'), { recursive: true });
    fs.writeFileSync(path.join(root, 'live', 'acme.json'), '{}');
    expect(liveFolderViolations({ tenantRoot: root, env: { CES_TENANT_ROOT: root }, home }).join(' ')).toMatch(/live\/ record/);
  });
  it('R-F2: the reserved dev placeholder (slug dev, all-zero tenant id) is not counted; a real dev.json is', () => {
    const home = tmp();
    const root = path.join(tmp(), 'tenants');
    fs.mkdirSync(path.join(root, 'live'), { recursive: true });
    const placeholder = { kind: 'live', client: { slug: 'dev' }, tenant: { tenant_id: '00000000-0000-0000-0000-000000000000' } };
    fs.writeFileSync(path.join(root, 'live', 'dev.json'), JSON.stringify(placeholder));
    expect(liveFolderViolations({ tenantRoot: root, env: { CES_TENANT_ROOT: root }, home })).toEqual([]);
    fs.writeFileSync(path.join(root, 'live', 'dev.json'), JSON.stringify({ ...placeholder, tenant: { tenant_id: '11111111-2222-3333-4444-555555555555' } }));
    expect(liveFolderViolations({ tenantRoot: root, env: { CES_TENANT_ROOT: root }, home }).join(' ')).toMatch(/live\/ record/);
  });
});

describe('E6 keeps muster-api\'s call record (LOG-FIN-19 open item 1)', () => {
  it('wipeKeeping removes everything but the named top-level files', () => {
    const d = tmp();
    for (const f of [...MUSTER_STATE_KEEP, 'execution-report-x.json', 'state.json']) fs.writeFileSync(path.join(d, f), '{}');
    fs.mkdirSync(path.join(d, 'sub'));
    const removed = wipeKeeping(d, MUSTER_STATE_KEEP);
    expect(removed.sort()).toEqual(['execution-report-x.json', 'state.json', 'sub']);
    expect(fs.readdirSync(d).sort()).toEqual([...MUSTER_STATE_KEEP].sort());
    expect(wipeKeeping(path.join(d, 'absent'), MUSTER_STATE_KEEP)).toEqual([]);
  });
  it('the E6 source wipes state/ through wipeKeeping for the pipeline tenant folder', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    expect(src).toMatch(/wipeKeeping\(path\.join\(base, sub\), MUSTER_STATE_KEEP\)/);
  });
});

describe('per-run cleanup covers the FIN-29 records', () => {
  it('lists every FIN29_FILES record and private root', () => {
    const d = tmp();
    const out = path.join(d, 'out');
    fs.mkdirSync(out, { recursive: true });
    for (const f of Object.values(FIN29_FILES)) fs.writeFileSync(path.join(out, f), '{}');
    for (const dir of ['e0', 'e8r', 'e8t', 'ao-sweep']) fs.mkdirSync(path.join(out, dir));
    const found = perRunArtefacts(out, path.join(d, 'pl'), 's1').map((p) => path.basename(p)).sort();
    for (const f of Object.values(FIN29_FILES)) expect(found).toContain(f);
    for (const dir of ['e0', 'e8r', 'e8t', 'ao-sweep']) expect(found).toContain(dir);
  });
});

describe('SP-11 R6: the muster-api token never rides on argv', () => {
  it('E3 passes MUSTER_API_TOKEN in the child env and no --token', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    expect(src).not.toMatch(/'--token'/);
    expect(src).toMatch(/MUSTER_API_TOKEN: musterToken/);
  });
});
