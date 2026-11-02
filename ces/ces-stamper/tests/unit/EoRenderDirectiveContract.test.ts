// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-ST4 — Stamper's document-renderable evidence starts an EvidenceOps render.
//
// REQ-ces-stamper-eo-render-directive-shape (filed by ces-eo): Stamper wrote `code: '<control id>'`
// nested under `metadata`; EO reads `eo_render_directive` at the evidence file's top level and needs
// `directive_code`. This test drives Stamper's PRODUCTION builder + writer, then EO's PRODUCTION
// loader (StamperEvidenceLoader) and render orchestrator (RenderOrchestrator), imported read-only
// from the sibling ces-eo tree. Nothing is written outside a temp CES_PIPELINE_ROOT. Sim only.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-eo-render-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;

import { EO_RENDER_DIRECTIVES, buildDocumentRenderableEvidence } from '../../src/evidence/eoRenderDirective';
import { writeAndUploadEvidence } from '../../src/utils/structuredEvidence';
import { evidenceDirForTenant } from '../../src/core/EvidenceReadinessAnalyzer';
// EvidenceOps production code (read-only import from the sibling module).
import { StamperEvidenceLoader } from '../../../ces-eo/src/eo/evidence/StamperEvidenceLoader';
import { RenderOrchestrator } from '../../../ces-eo/src/eo/rendering/RenderOrchestrator';
import { RenderDirectiveSchema, DIRECTIVE_CODES } from '../../../ces-eo/src/shared/types/render.types';

const SLUG = 'w4st4-render';
const CONTROLS = Object.keys(EO_RENDER_DIRECTIVES);

describe('W4-ST4 Stamper eo_render_directive -> EO render', () => {
  beforeAll(async () => {
    const evidenceDir = evidenceDirForTenant(SLUG);
    fs.mkdirSync(evidenceDir, { recursive: true });
    for (const controlId of CONTROLS) {
      const evidence = buildDocumentRenderableEvidence({
        controlIds: [controlId],
        primaryControlId: controlId,
        readiness: 'met',
        justification: `Signal verified for ${controlId} — document rendering eligible`,
        executorIdentity: SLUG,
        directive: EO_RENDER_DIRECTIVES[controlId],
      });
      await writeAndUploadEvidence(evidenceDir, `renderable-${controlId}.json`, evidence, undefined);
    }
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('every directive code Stamper emits is an EO DIRECTIVE_CODES value', () => {
    const eoCodes = new Set<string>(Object.values(DIRECTIVE_CODES));
    for (const controlId of CONTROLS) {
      expect(eoCodes.has(EO_RENDER_DIRECTIVES[controlId].directive_code)).toBe(true);
    }
  });

  it('the written evidence files parse with EO RenderDirectiveSchema via StamperEvidenceLoader', () => {
    const evidence = new StamperEvidenceLoader(SLUG).loadEvidenceForTenant();
    expect(evidence).toHaveLength(CONTROLS.length);
    for (const controlId of CONTROLS) {
      const ev = evidence.find(e => e.controlIds[0] === controlId);
      expect(ev?.renderDirective).toBeDefined();
      expect(ev!.renderDirective!.directive_code).toBe(EO_RENDER_DIRECTIVES[controlId].directive_code);
      // Raw file shape: top-level block, no legacy `code` key.
      const raw = JSON.parse(fs.readFileSync(ev!.evidenceFilePath!, 'utf-8'));
      expect(RenderDirectiveSchema.safeParse(raw.eo_render_directive).success).toBe(true);
      expect(raw.eo_render_directive.code).toBeUndefined();
    }
  });

  it('EO RenderOrchestrator starts a render for every Stamper directive (template found, version accepted)', async () => {
    const evidence = new StamperEvidenceLoader(SLUG).loadEvidenceForTenant();
    const jobs = evidence
      .filter(ev => ev.renderDirective)
      .map(ev => ({ controlId: ev.controlIds[0], directive: ev.renderDirective!, evidenceFilePath: ev.evidenceFilePath }));
    expect(jobs).toHaveLength(CONTROLS.length);

    const events: Array<{ type: string; controlId: string; directiveCode: string }> = [];
    const results = await new RenderOrchestrator(path.join(tmpRoot, 'Stamper'), SLUG).orchestrateRenders(
      jobs,
      {
        tenantSlug: SLUG,
        tenantName: SLUG,
        complianceRepoPath: path.join(tmpRoot, 'compliance'),
        assessmentSnapshot: { tenant_id: SLUG, controls: [] },
        renderedArtifacts: new Map(),
        date: '2026-09-27',
      },
      (e) => events.push(e as any),
    );

    const started = events.filter(e => e.type === 'render_start').map(e => e.controlId).sort();
    expect(started).toEqual([...CONTROLS].sort());
    for (const controlId of CONTROLS) {
      const r = results.get(controlId);
      expect(r).toBeDefined();
      expect(r!.failure_reason ?? '').not.toMatch(/No template registered|version mismatch/);
    }
  });
});
