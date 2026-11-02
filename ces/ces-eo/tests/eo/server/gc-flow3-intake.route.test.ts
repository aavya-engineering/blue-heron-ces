// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GC-FLOW-3: POST /api/intake/muster over HTTP with the real intake and policies routers, a real PolicyStore in a
 * temp ces.db and a temp storage root. A bundle shaped like muster-api's push (MP with hashed references, TM,
 * hand-off envelopes incl. the CUI Boundary and the policy-set manifest) plus the policy texts: hashes checked, files
 * stored, receipt hashes = the stored bytes, policies imported (two IR documents and an ORG one stay three records),
 * re-intake upserts. Bad hashes, unlisted or altered policies are 400s that store nothing. POST /api/policies/import
 * accepts a PolicyDocument (it answered 500 before: the schema stripped `domain`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { canonicalSha256 } from 'ces-shared/crypto';
import { createIntakeRouter, readIntakeCuiBoundary, policyDocumentFromMuster, INTAKE_RECEIPT_SCHEMA } from '../../../src/eo/server/routers/intake-router';
import { createPoliciesRouter } from '../../../src/eo/server/routers/policies-router';
import { PolicyStore } from '../../../src/eo/policies/PolicyStore';

const SLUG = 'gcflow3-tenant';
const GUID = '00000000-0000-4000-8000-0000000f1003';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function envelope(kind: string, artifactType: string, body: Record<string, unknown>) {
  const artifact = { ces: { artifact: artifactType, version: '1.0' }, ...body };
  return { cesId: 'ces-flow3', schema_id: `muster:${kind}`, artifact_id: `${kind}-ces-flow3`, version: '1.0', hash_sha256: canonicalSha256(artifact), artifact };
}

const POLICY_TEXT: Record<string, string> = {
  'policies/incident-response-policy.md': '# Incident Response Policy\n\nFamily 3.6: 3.6.1, 3.6.2 and 3.6.3.\n',
  'policies/incident-response-plan.md': '# Incident Response Plan\n\nFamily 3.6 plan (3.6.1).\n',
  'policies/acceptable-use-policy.md': '# Acceptable Use Policy\r\n\r\nApplies to all users.\r\n',
};

function bundle() {
  const cui = envelope('cui-boundary', 'cui_boundary_output', { cui_boundary: { cui_categories: ['CTI', 'Export controlled'], cui_user_count: 7, devops_in_scope: 'No' } });
  const psm = envelope('policy-set-manifest', 'policy_set_manifest', {
    documents: Object.entries(POLICY_TEXT).map(([name, text]) => ({ name, sha256: sha(text) })),
  });
  const tcp = envelope('tcp', 'tenant_config_profile', { settings: { a: 1 } });
  const ref = (e: ReturnType<typeof envelope>) => ({ artifact_id: e.artifact_id, hash_sha256: e.hash_sha256 });
  const missionPlan = { plan: 'flow3', inputs: { cui_boundary_ref: ref(cui), policy_set_manifest_ref: ref(psm), tcp_ref: ref(tcp), si_baseline_ref: { artifact_id: 'si-x', hash_sha256: 'a'.repeat(64) } } };
  const tenantManifest = { tenant_manifest: { tenant_identity: { display_name: 'Flow3 Sim' } } };
  return {
    tenant_slug: SLUG,
    missionPlan,
    tenantManifest,
    cui_boundary: cui,
    policy_set_manifest: psm,
    tcp,
    policies: Object.entries(POLICY_TEXT).map(([name, markdown]) => ({ name, markdown })),
    file_names: { mission_plan: 'manual-mission-plan-gcflow3-tenant-2026.json', cui_boundary: 'cui-boundary-gcflow3-tenant-2026.json' },
  };
}

describe('GC-FLOW-3: EO intake of the Muster push bundle', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let storageRoot: string;
  let policyStore: PolicyStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-flow3-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    const dir = path.join(stamperRoot, 'plan-data', SLUG);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SLUG}.json`), JSON.stringify({ tenant: { tenant_id: GUID } }));
    storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const config = { storageRoot, tenantSlug: SLUG } as any;
    policyStore = new PolicyStore(storageRoot);
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(createPoliciesRouter({ config, stamperRoot, policyStore }));
    app.use(createIntakeRouter({ config, stamperRoot, policyStore }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  const post = (p: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const intakeDirs = () => (fs.existsSync(path.join(storageRoot, 'intake', SLUG)) ? fs.readdirSync(path.join(storageRoot, 'intake', SLUG)) : []);

  it('rejects bad bundles with 400 and stores nothing', async () => {
    const b1 = bundle();
    b1.cui_boundary = { ...b1.cui_boundary, hash_sha256: 'b'.repeat(64) };
    const r1 = await post('/api/intake/muster', b1);
    expect(r1.status).toBe(400);
    expect((await r1.json()).details).toEqual(['cui_boundary: hash_sha256 does not match the artifact']);

    const b2 = bundle();
    b2.policies[0] = { ...b2.policies[0]!, markdown: b2.policies[0]!.markdown + 'tampered' };
    const r2 = await post('/api/intake/muster', b2);
    expect(r2.status).toBe(400);
    expect((await r2.json()).details).toEqual(['policies: policies/incident-response-policy.md sha256 does not match the policy-set manifest']);

    const b3 = bundle();
    b3.policies.push({ name: 'policies/not-listed.md', markdown: 'x' });
    expect((await (await post('/api/intake/muster', b3)).json()).details).toEqual(['policies: policies/not-listed.md is not in the policy-set manifest']);

    const b4 = bundle();
    (b4.missionPlan.inputs as Record<string, unknown>).tcp_ref = { artifact_id: 'other', hash_sha256: b4.tcp.hash_sha256 };
    expect((await (await post('/api/intake/muster', b4)).json()).details).toEqual(["tcp: does not match the Mission Plan's inputs.tcp_ref"]);

    const r5 = await post('/api/intake/muster', { tenant_slug: SLUG, tenantManifest: {} });
    expect(r5.status).toBe(400);
    expect((await r5.json()).details).toEqual(['missionPlan is required']);
    expect((await post('/api/intake/muster', { ...bundle(), tenant_slug: 'no-such-tenant' })).status).toBe(404);

    expect(intakeDirs()).toEqual([]);
    expect(policyStore.load(SLUG)).toEqual([]);
  });

  it('stores the bundle, returns a receipt whose hashes are the stored bytes, and imports the policies', async () => {
    const b = bundle();
    const r = await post('/api/intake/muster', b);
    expect(r.status).toBe(201);
    const receipt = await r.json();
    expect(receipt.schema).toBe(INTAKE_RECEIPT_SCHEMA);
    expect(receipt.tenant_slug).toBe(SLUG);
    expect(receipt.items.map((i: any) => i.kind)).toEqual(['mission_plan', 'tenant_manifest', 'tcp', 'policy_set_manifest', 'cui_boundary']);
    const dir = path.join(storageRoot, 'intake', SLUG, receipt.receipt_id);
    for (const item of receipt.items) {
      const bytes = fs.readFileSync(path.join(dir, item.stored_as));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256);
    }
    const byKind = Object.fromEntries(receipt.items.map((i: any) => [i.kind, i]));
    expect(byKind.mission_plan.sha256).toBe(sha(JSON.stringify(b.missionPlan, null, 2)));
    expect(byKind.mission_plan.file_name).toBe('manual-mission-plan-gcflow3-tenant-2026.json');
    expect(byKind.tenant_manifest.file_name).toBeNull();
    expect(byKind.cui_boundary).toMatchObject({ artifact_id: b.cui_boundary.artifact_id, hash_sha256: b.cui_boundary.hash_sha256, sha256: sha(JSON.stringify(b.cui_boundary, null, 2)) });
    expect(receipt.warnings).toEqual(['the Mission Plan references si_baseline (si-x) but the bundle did not carry it']);
    expect(receipt.policies).toMatchObject({ manifest_documents: 3, imported: 3, store_count: 3, missing: [] });
    expect(receipt.policies.documents.map((d: any) => [d.name, d.domain])).toEqual([
      ['policies/incident-response-policy.md', 'IR'], ['policies/incident-response-plan.md', 'IR'], ['policies/acceptable-use-policy.md', 'ORG'],
    ]);
    for (const d of receipt.policies.documents) expect(fs.readFileSync(path.join(dir, d.stored_as), 'utf8')).toBe(POLICY_TEXT[d.name]);

    const stored = policyStore.load(SLUG);
    expect(stored).toHaveLength(3);
    // The title round-trips to the manifest file name (the package and the evidence index match on it), text hash = manifest.
    for (const p of stored) {
      const name = `policies/${p.title.toLowerCase().replace(/\s+/g, '-')}.md`;
      expect(sha(p.markdown)).toBe(sha(POLICY_TEXT[name]!));
    }
    expect(stored.find(p => p.template_id === 'incident-response-policy')!.nist_controls).toEqual(['3.6.1', '3.6.2', '3.6.3']);

    // Re-intake: a new receipt, the store upserts in place (still 3).
    const again = await (await post('/api/intake/muster', bundle())).json();
    expect(again.policies.store_count).toBe(3);
    expect(intakeDirs()).toHaveLength(2);
  });

  it('readIntakeCuiBoundary returns the newest verified envelope; a Mission Plan with another hash gets none', () => {
    const b = bundle();
    const got = readIntakeCuiBoundary(storageRoot, SLUG, b.missionPlan);
    expect(got).toMatchObject({ artifactId: b.cui_boundary.artifact_id, hashSha256: b.cui_boundary.hash_sha256, cuiBoundary: b.cui_boundary.artifact.cui_boundary });
    expect(readIntakeCuiBoundary(storageRoot, SLUG)).toBeDefined();
    expect(readIntakeCuiBoundary(storageRoot, SLUG, { inputs: { cui_boundary_ref: { artifact_id: b.cui_boundary.artifact_id, hash_sha256: 'c'.repeat(64) } } })).toBeUndefined();
    expect(readIntakeCuiBoundary(storageRoot, 'other-tenant')).toBeUndefined();
    expect(readIntakeCuiBoundary(undefined, SLUG)).toBeUndefined();
  });

  it('POST /api/policies/import accepts PolicyDocuments (was a 500: the schema stripped domain); a bad body is 400', async () => {
    const doc = policyDocumentFromMuster('policies/maintenance-policy.md', '# Maintenance Policy\n\n3.7.1\n');
    expect(doc).toMatchObject({ template_id: 'maintenance-policy', title: 'Maintenance Policy', domain: 'MA', completeness: 0, nist_controls: ['3.7.1'] });
    const r = await post('/api/policies/import', { tenantSlug: SLUG, policies: [doc] });
    expect(r.status).toBe(201);
    expect((await r.json()).imported).toBe(1);
    expect(policyStore.load(SLUG).map(p => p.domain).sort()).toEqual(['IR', 'IR', 'MA', 'ORG']);
    const bad = await post('/api/policies/import', { tenantSlug: SLUG, policies: [{ title: 'x', content: 'y' }] });
    expect(bad.status).toBe(400);
  });
});
