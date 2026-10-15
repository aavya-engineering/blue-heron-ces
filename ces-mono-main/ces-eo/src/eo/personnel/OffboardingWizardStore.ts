// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { randomUUID } from 'node:crypto';
import type {
  OffboardingStep,
  OffboardingRun,
  OffboardingProceduralOverlay,
} from './offboarding.types.js';
import { OFFBOARDING_STEPS } from './offboarding.types.js';
import { getCesRepository } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceReader } from '../adminops/AdminOpsEvidenceReader.js';
import type { AdminOpsEvidence } from 'ces-shared/types/adminops-evidence';

/** The person being offboarded, as AdminOps would name the command's target. */
export interface OffboardingTarget {
  upn?: string;
  objectId?: string;
}

/** Target identity carried by an AO row (contract 1.3.0 targetUPN / targetObjectId). */
function adminOpsTargetOf(ev: AdminOpsEvidence): { upn?: string; objectId?: string } {
  return {
    upn: ev.targetUPN?.trim().toLowerCase(),
    objectId: ev.targetObjectId?.trim().toLowerCase(),
  };
}

const AO_COMMAND_TO_STEP: Record<string, string> = {
  'A-02': 'disable-entra-account',
  'A-03': 'remove-group-memberships',
  'B-05': 'revoke-device-access',
};

// G2: offboarding runs persist in the unified SQLite repository, tenant-isolated by tenantSlug,
// replacing {storageRoot}/personnel/{tenantSlug}/_offboarding_{personnelId}.json. See ADR-002.
const OFFBOARDING_COLLECTION = 'eo_offboarding';

export class OffboardingWizardStore {
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  private get repo() {
    return getCesRepository();
  }

  /** Per-tenant key for an offboarding run (one in-flight run per personnel). */
  private runKey(tenantSlug: string, personnelId: string): string {
    return `${tenantSlug}:${personnelId}`;
  }

  private calculateSlaStatus(triggerTime: string): 'green' | 'yellow' | 'red' {
    const elapsed = Date.now() - new Date(triggerTime).getTime();
    const hours = elapsed / (1000 * 60 * 60);
    if (hours < 4) return 'green';
    if (hours < 8) return 'yellow';
    return 'red';
  }

  startRun(tenantSlug: string, personnelId: string, personnelName: string): OffboardingRun {
    const run: OffboardingRun = {
      runId: randomUUID(),
      personnelId,
      personnelName,
      tenantSlug,
      triggerTime: new Date().toISOString(),
      currentStepIndex: 0,
      steps: OFFBOARDING_STEPS.map(s => ({ ...s, completed: false })),
      slaStatus: 'green',
      state: 'in-progress',
    };

    this.repo.put(OFFBOARDING_COLLECTION, {
      id: this.runKey(tenantSlug, personnelId),
      ces: { tenantSlug },
      data: run,
    });
    return run;
  }

  saveRun(run: OffboardingRun): void {
    this.repo.put(OFFBOARDING_COLLECTION, {
      id: this.runKey(run.tenantSlug, run.personnelId),
      ces: { tenantSlug: run.tenantSlug },
      data: run,
    });
  }

  loadRun(tenantSlug: string, personnelId: string): OffboardingRun | null {
    const rec = this.repo.get<OffboardingRun>(OFFBOARDING_COLLECTION, this.runKey(tenantSlug, personnelId), { tenantSlug });
    if (!rec) return null;
    const run = rec.data;
    run.slaStatus = this.calculateSlaStatus(run.triggerTime);
    return run;
  }

  deleteRun(tenantSlug: string, personnelId: string): void {
    this.repo.delete(OFFBOARDING_COLLECTION, this.runKey(tenantSlug, personnelId), { tenantSlug });
  }

  listActiveRuns(tenantSlug: string): OffboardingRun[] {
    return this.repo
      .list<OffboardingRun>(OFFBOARDING_COLLECTION, { tenantSlug })
      .map((r) => {
        const run = r.data;
        run.slaStatus = this.calculateSlaStatus(run.triggerTime);
        return run;
      });
  }

  completeStep(
    run: OffboardingRun,
    stepId: string,
    attestor: string,
    notes?: string,
    evidenceArtifactId?: string,
  ): void {
    const stepIndex = run.steps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) throw new Error(`Unknown step: ${stepId}`);
    if (stepIndex !== run.currentStepIndex) throw new Error(`Step ${stepId} is not the current step`);

    const step = run.steps[stepIndex];
    step.completed = true;
    step.completedAt = new Date().toISOString();
    step.attestor = attestor;
    if (notes) step.notes = notes;
    if (evidenceArtifactId) step.evidenceArtifactId = evidenceArtifactId;

    run.currentStepIndex = stepIndex + 1;
    run.slaStatus = this.calculateSlaStatus(run.triggerTime);
  }

  /**
   * FX-EO4: mark wizard steps system-evidenced by a LIVE, EXECUTED AdminOps row whose TARGET
   * is the person being offboarded. The operator (requestorUPN / approverUPN) is never a
   * match — an admin who ran A-02 against someone else must not evidence this person's step.
   *
   * The target is the contract row's `targetUPN` / `targetObjectId` (AdminOps evidence
   * contract 1.3.0). Rows without a target never evidence a step (fail closed).
   *
   * Returns the number of steps newly evidenced.
   */
  applyAdminOpsEvidence(
    run: OffboardingRun,
    tenantId: string,
    target: OffboardingTarget,
    dbPath?: string,
  ): number {
    const wantUpn = target.upn?.trim().toLowerCase() || undefined;
    const wantObjectId = target.objectId?.trim().toLowerCase() || undefined;
    if (!wantUpn && !wantObjectId) return 0;

    let evidenced = 0;
    try {
      const result = new AdminOpsEvidenceReader(tenantId, dbPath).read();

      for (const { rowId, evidence: ev } of result.entries) {
        if (ev.mode !== 'live' || ev.outcome !== 'executed') continue;
        const t = adminOpsTargetOf(ev);
        const upnMatch = !!wantUpn && t.upn === wantUpn;
        const oidMatch = !!wantObjectId && t.objectId === wantObjectId;
        if (!upnMatch && !oidMatch) continue;

        const stepId = AO_COMMAND_TO_STEP[ev.commandId];
        if (!stepId) continue;

        const step = run.steps.find(s => s.id === stepId);
        if (step && !step.completed && !step.systemEvidenced) {
          step.systemEvidenced = true;
          step.adminOpsRowId = rowId;
          evidenced++;
        }
      }
    } catch {
      // AdminOps evidence unavailable — all steps remain attestation-only
    }
    return evidenced;
  }

  generateProceduralOverlay(
    run: OffboardingRun,
    aoAttestor: string,
  ): OffboardingProceduralOverlay {
    const elapsedHours = (Date.now() - new Date(run.triggerTime).getTime()) / (1000 * 60 * 60);
    const overlay: OffboardingProceduralOverlay = {
      artifactId: randomUUID(),
      runId: run.runId,
      personnelId: run.personnelId,
      personnelName: run.personnelName,
      triggerTime: run.triggerTime,
      completionTime: new Date().toISOString(),
      attestor: aoAttestor,
      steps: run.steps,
      slaStatus: elapsedHours <= 8 ? 'pass' : 'fail',
      generator: { tool: 'offboarding_wizard', version: '1.0.0' },
      metadata: {},
    };
    return overlay;
  }
}
