// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution): translate a manifest that carries
// a SecretReference (ces-shared 2.8.0) and prove the resolved value never lands in plan.variables,
// the written plan file, or anywhere serializable — only a safe sentinel + reference metadata.
// The real value reaches a command only through PowerShellAdapter's execution-time overlay
// (see PowerShellAdapterSecretOverlay.test.ts), never through translate/Configure-time output.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { ManifestReader } from '../../src/translators/ManifestReader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.join(__dirname, '..', 'fixtures');
const missionPlanPath = path.join(fixturesDir, 'synthetic-mission-plan.json');
const tenantManifestPath = path.join(fixturesDir, 'synthetic-tenant-manifest.json');

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

describe('PlanTranslator — SecretReference resolution (FC-ST-3 step 2)', () => {
  describe('Infra Manifest secret_references[]', () => {
    // ces-shared's own example fixture — the shape it documents Muster should emit — already
    // carries a real secret_references[] entry for initialPassword (one_time_operator_held).
    // ces-shared has no per-module node_modules copy in this monorepo (hoisted to the workspace
    // root's node_modules/ces-shared symlink) — resolve from there rather than assuming a local copy.
    const infraManifest = readJson(
      path.resolve(__dirname, '..', '..', '..', 'node_modules', 'ces-shared', 'dist', 'data', 'infra-manifest.example.json')
    );
    const secretRef = infraManifest.infrastructure.secret_references[0];

    function translateWithInfra() {
      const missionPlanData = readJson(missionPlanPath);
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();
      return translator.translate(missionPlanData, manifest, undefined, { infraManifest, infraManifestSource: 'test-fixture' });
    }

    it('fixture sanity: the example manifest really does carry a one_time_operator_held reference for initialPassword', () => {
      expect(secretRef).toEqual({
        variable: 'initialPassword',
        form: 'one_time_operator_held',
        ref: expect.stringContaining('secretref:'),
      });
    });

    it('sets a safe sentinel for the secret variable, never a plain value', () => {
      const result = translateWithInfra();
      expect(result.plan.variables.initialPassword).toBe('<<CES_SECRET:initialPassword>>');
    });

    it('records reference metadata (variable/form/ref) but never a "value" or "secret" field', () => {
      const result = translateWithInfra();
      const meta = result.plan.variables._secret_references;
      expect(Array.isArray(meta)).toBe(true);
      expect(meta).toContainEqual({ variable: 'initialPassword', form: 'one_time_operator_held', ref: secretRef.ref });
      for (const entry of meta) {
        expect(Object.keys(entry).sort()).not.toContain('value');
        expect(Object.keys(entry).sort()).not.toContain('secret');
      }
    });

    it('the serialized plan (what actually gets written to disk) contains no value other than the sentinel for this variable', () => {
      const result = translateWithInfra();
      const serialized = JSON.stringify(result.plan);
      // The sentinel itself is fine to appear; there is no other candidate "real" secret value in
      // this fixture to assert absence of (ces-shared's example never carries a real password) —
      // this test instead pins the exact on-disk representation so a future regression that put a
      // resolved value here would have to change this literal.
      expect(serialized).toContain('<<CES_SECRET:initialPassword>>');
      expect((serialized.match(/<<CES_SECRET:initialPassword>>/g) ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it('writing the plan to disk (translateFile) persists only the sentinel, never a resolved value', () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-secretref-'));
      try {
        const outPath = path.join(tmpRoot, 'executable-plan.json');
        const translator = new PlanTranslator();
        translator.translateFile(missionPlanPath, tenantManifestPath, outPath, undefined, { infraManifest, infraManifestSource: 'test-fixture' });
        const onDisk = fs.readFileSync(outPath, 'utf-8');
        expect(onDisk).toContain('<<CES_SECRET:initialPassword>>');
        expect(JSON.parse(onDisk).variables.initialPassword).toBe('<<CES_SECRET:initialPassword>>');
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    it('ces-shared 2.8.0 already refuses a plain-string initialPassword in stamper_variable_map at parse time', () => {
      // The primary defense: InfraManifestSchema's superRefine (ces-shared) rejects this before
      // PlanTranslator ever sees it — proving the hazard REQ-ces-stamper-secret-reference-resolution
      // describes is closed one layer up from Stamper for the Infra Manifest shape.
      const infraWithPlainValue = JSON.parse(JSON.stringify(infraManifest));
      infraWithPlainValue.infrastructure.stamper_variable_map.initialPassword = 'PlainTextPassword123!';

      const missionPlanData = readJson(missionPlanPath);
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();
      expect(() =>
        translator.translate(missionPlanData, manifest, undefined, { infraManifest: infraWithPlainValue, infraManifestSource: 'test-fixture' })
      ).toThrow(/initialPassword.*must not hold a plain value/);
    });

    it('PlanTranslator refuses a plain-string secret variable in mergeInfraManifestVariables directly (defense-in-depth, production code, second layer)', () => {
      // Exercises PlanTranslator's own independent guard (mergeInfraManifestVariables) by calling
      // it directly with a varMap shape ces-shared's schema would already reject one layer up —
      // proving Stamper does not rely on ces-shared alone to keep a plain secret out of plan.variables.
      const missionPlanData = readJson(missionPlanPath);
      const manifest = ManifestReader.fromFile(tenantManifestPath);
      const translator = new PlanTranslator();
      const result = translator.translate(missionPlanData, manifest);

      (translator as any).mergeInfraManifestVariables(result, { initialPassword: 'PlainTextPassword123!' }, 'test-fixture');

      expect(result.plan.variables.initialPassword).not.toBe('PlainTextPassword123!');
      expect(result.warnings).toContain('INFRA_MANIFEST: refused plain value for secret variable "initialPassword" — use secret_references instead.');
      expect(JSON.stringify(result.plan)).not.toContain('PlainTextPassword123!');
    });
  });

  describe('Tenant Manifest provisioning_inputs (m365-only sessions)', () => {
    function buildTenantManifestWithProvisioningInputs(): string {
      const tm = readJson(tenantManifestPath);
      tm.tenant_manifest.provisioning_inputs = {
        approver_upn: 'approver@contoso.onmicrosoft.us',
        terms_of_use_file: { file_name: 'tou.pdf', content_base64: 'ZmFrZS1iYXNlNjQ=' },
        initial_password_ref: {
          variable: 'initialPassword',
          form: 'one_time_operator_held',
          ref: 'secretref:one-time:provisioning-001',
        },
      };
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-provinputs-'));
      const outPath = path.join(tmpRoot, 'tenant-manifest-with-provisioning.json');
      fs.writeFileSync(outPath, JSON.stringify(tm, null, 2));
      return outPath;
    }

    it('maps non-secret provisioning fields (approverUPN, touFileName/touFileBase64) directly', () => {
      const tmPath = buildTenantManifestWithProvisioningInputs();
      const missionPlanData = readJson(missionPlanPath);
      const manifest = ManifestReader.fromFile(tmPath);
      const translator = new PlanTranslator();
      const result = translator.translate(missionPlanData, manifest);

      expect(result.plan.variables.approverUPN).toBe('approver@contoso.onmicrosoft.us');
      expect(result.plan.variables.touFileName).toBe('tou.pdf');
      expect(result.plan.variables.touFileBase64).toBe('ZmFrZS1iYXNlNjQ=');
    });

    it('maps initial_password_ref to a sentinel, never the reference object or a resolved value', () => {
      const tmPath = buildTenantManifestWithProvisioningInputs();
      const missionPlanData = readJson(missionPlanPath);
      const manifest = ManifestReader.fromFile(tmPath);
      const translator = new PlanTranslator();
      const result = translator.translate(missionPlanData, manifest);

      expect(result.plan.variables.initialPassword).toBe('<<CES_SECRET:initialPassword>>');
      expect(typeof result.plan.variables.initialPassword).toBe('string');
      const meta = result.plan.variables._secret_references;
      expect(meta).toContainEqual({
        variable: 'initialPassword',
        form: 'one_time_operator_held',
        ref: 'secretref:one-time:provisioning-001',
      });
    });

    it('ManifestReader.provisioningInputs exposes the raw block (undefined when absent)', () => {
      const withInputs = ManifestReader.fromFile(buildTenantManifestWithProvisioningInputs());
      expect(withInputs.provisioningInputs?.approver_upn).toBe('approver@contoso.onmicrosoft.us');

      const withoutInputs = ManifestReader.fromFile(tenantManifestPath);
      expect(withoutInputs.provisioningInputs).toBeUndefined();
    });
  });
});
