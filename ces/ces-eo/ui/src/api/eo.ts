// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The EO routes the screens call, one function per route, with the same query keys and bodies as
// the legacy console (public/index.html), so both consoles drive EO identically.

import { apiDownload, apiEventStream, apiRequest, apiUpload, type StreamFrame } from './http';
import type {
  AssessmentSnapshot, AssessorView, DocumentReview, EcFinding, EcIngestResult, EcRun, MintedToken,
  OffboardingRun, PackageBuildResult, PackageListing, PersonnelRecord, Poam, ReviewQueue,
  ReviewQueueControl, RiskEntry, RiskRegister, RolePopulationResponse, SprsHistoryPoint, SprsResult,
  SystemSecurityPlan, TenantSummary, TrainingCatalog, TrainingDetail, UiInfo,
  AnnualReviewState, EvidenceIndex, EvidenceItemContent, EvidenceVerifyResult, IngestionReport, LiveSignalResult,
  OneClickReviewResult, PersonnelArtifact, PersonnelConfig, PersonnelReadiness, PolicyDoc, RiskAssessmentConfig,
  RiskSnapshot, RiskSnapshotListing, ScreeningElementDef, ScreeningElementState, ScreeningReadiness, SprsWeight,
  Timeline, TimelineEvent,
} from './types';

export const PRINCIPAL_HEADER = 'x-ces-principal';
const principal = (token: string | null | undefined): Record<string, string> =>
  token && token.trim() ? { [PRINCIPAL_HEADER]: token.trim() } : {};
const enc = encodeURIComponent;

export interface UploadInput {
  tenant: string;
  file: File;
  controlIds: string;
  source: string;
  submittedByRole: string;
  formId?: string;
  emxIds?: string;
  /** The uploader's token, sent as x-ces-principal; EC records the uploader from it. */
  uploaderToken?: string | null;
}

export interface ReviewInput {
  tenant: string;
  controlId: string;
  objectiveId: string;
  artifactHash: string;
  verdict: 'met' | 'not_met';
  notes?: string;
  /** The minted approver token (x-ces-principal). */
  approverToken: string;
}

export const eoApi = {
  // config-router.ts / eo-ui-router.ts
  health: () => apiRequest<{ status: string; service: string; version: string }>('GET', '/api/health'),
  uiInfo: () => apiRequest<UiInfo>('GET', '/api/ui/info'),
  tenants: () => apiRequest<TenantSummary[]>('GET', '/api/tenants'),

  // assessment-router.ts
  assess: (tenant: string, onEvent: (f: StreamFrame) => void, signal?: AbortSignal) =>
    apiEventStream('/api/assess', { tenant }, onEvent, signal),
  assessment: (tenant: string) => apiRequest<AssessmentSnapshot>('GET', '/api/assessment', { query: { tenant } }),
  sprs: (tenant: string) => apiRequest<SprsResult>('GET', '/api/sprs', { query: { tenant } }),
  sprsHistory: (tenant: string) => apiRequest<SprsHistoryPoint[]>('GET', '/api/sprs/history', { query: { tenant } }),
  assessorView: (tenant: string) => apiRequest<AssessorView>('GET', '/api/assessor-view', { query: { tenant } }),

  // documents-router.ts
  generateSsp: (tenant: string, assessmentId: string) =>
    apiRequest<SystemSecurityPlan>('POST', '/api/ssp/generate', { body: { tenantSlug: tenant, assessmentId } }),
  latestSsp: (tenant: string) => apiRequest<SystemSecurityPlan>('GET', '/api/ssp/latest', { query: { tenant } }),
  sspDocx: (tenant: string, sspId: string) => apiDownload(`/api/ssp/export/${enc(sspId)}`, { tenant }, `SSP-${sspId}.docx`),
  generatePoam: (tenant: string, assessmentId: string) =>
    apiRequest<Poam>('POST', '/api/poam/generate', { body: { tenantSlug: tenant, assessmentId } }),
  poamDocx: (tenant: string, poamId: string) => apiDownload(`/api/poam/export/${enc(poamId)}`, { tenant }, `POAM-${poamId}.docx`),

  // evidence-router.ts
  buildPackage: (tenant: string) => apiRequest<PackageBuildResult>('POST', '/api/package/build', { body: { tenant } }),
  packages: (tenant: string) => apiRequest<PackageListing[]>('GET', '/api/packages', { query: { tenant } }),
  downloadPackage: (tenant: string, filename: string) => apiDownload(`/api/package/download/${enc(filename)}`, { tenant }, filename),

  // personnel-router.ts
  personnel: (tenant: string) => apiRequest<PersonnelRecord[]>('GET', '/api/personnel', { query: { tenant } }),
  addPersonnel: (tenant: string, p: { displayName: string; email: string; role: string }) =>
    apiRequest<PersonnelRecord>('POST', '/api/personnel', { query: { tenant }, body: p }),
  updatePersonnel: (tenant: string, id: string, updates: Record<string, unknown>) =>
    apiRequest<PersonnelRecord>('PUT', `/api/personnel/${enc(id)}`, { query: { tenant }, body: updates }),
  training: (tenant: string, id: string) => apiRequest<TrainingDetail>('GET', `/api/personnel/${enc(id)}/training`, { query: { tenant } }),
  trainingCatalog: (tenant: string) => apiRequest<TrainingCatalog>('GET', '/api/training/catalog', { query: { tenant } }),
  completeCourse: (tenant: string, id: string, body: { courseId: string; completedDate: string; expiryDate?: string }) =>
    apiRequest<unknown>('POST', `/api/personnel/${enc(id)}/training/complete`, { query: { tenant }, body }),
  removeCompletion: (tenant: string, id: string, courseId: string) =>
    apiRequest<unknown>('DELETE', `/api/personnel/${enc(id)}/training/complete/${enc(courseId)}`, { query: { tenant } }),
  rolePopulation: (tenant: string) =>
    apiRequest<RolePopulationResponse>('GET', `/api/personnel/${enc(tenant)}/role-population`),
  saveRolePopulation: (tenant: string, roles: string[]) =>
    apiRequest<RolePopulationResponse>('PUT', `/api/personnel/${enc(tenant)}/role-population`, { body: { roles } }),
  offboarding: (tenant: string, id: string) => apiRequest<OffboardingRun>('GET', `/api/personnel/${enc(id)}/offboarding`, { query: { tenant } }),
  startOffboarding: (tenant: string, id: string) =>
    apiRequest<OffboardingRun>('POST', `/api/personnel/${enc(id)}/offboarding`, { query: { tenant }, body: {} }),
  completeOffboardingStep: (tenant: string, id: string, stepId: string, body: { attestor: string; notes?: string }) =>
    apiRequest<OffboardingRun>('PUT', `/api/personnel/${enc(id)}/offboarding/step/${enc(stepId)}`, { query: { tenant }, body }),
  finalizeOffboarding: (tenant: string, id: string, attestor: string) =>
    apiRequest<unknown>('POST', `/api/personnel/${enc(id)}/offboarding/complete`, { query: { tenant }, body: { attestor } }),
  cancelOffboarding: (tenant: string, id: string) =>
    apiRequest<unknown>('DELETE', `/api/personnel/${enc(id)}/offboarding`, { query: { tenant } }),

  // risk-assessment-router.ts
  riskRegister: (tenant: string) => apiRequest<RiskRegister>('GET', '/api/risk-assessment/register', { query: { tenant } }),
  saveRiskEntry: (tenant: string, id: string, body: Partial<RiskEntry>) =>
    apiRequest<RiskEntry>('PUT', `/api/risk-assessment/register/entries/${enc(id)}`, { query: { tenant }, body }),

  // ec-router.ts (EC through EO's proxy; no separate EC UI, FD-10)
  ecHealth: () => apiRequest<{ status: string; mode?: string; reasons?: string[] }>('GET', '/api/ec/health'),
  ecRuns: (tenant: string) => apiRequest<EcRun[]>('GET', '/api/ec/runs', { query: { tenant } }),
  ecFindings: (tenant: string) => apiRequest<EcFinding[]>('GET', '/api/ec/findings', { query: { tenant } }),
  upload: (u: UploadInput) => {
    const form = new FormData();
    form.set('tenantSlug', u.tenant);
    form.set('controlIds', u.controlIds);
    form.set('source', u.source);
    form.set('submittedByRole', u.submittedByRole);
    if (u.formId && u.formId.trim()) form.set('form_id', u.formId.trim());
    if (u.emxIds && u.emxIds.trim()) form.set('emx_ids', u.emxIds.trim());
    form.set('file', u.file);
    return apiUpload<EcIngestResult>('/api/ec/ingest', form, { headers: principal(u.uploaderToken) });
  },

  // review-router.ts / review-queue-router.ts (GD-b)
  reviewControls: () => apiRequest<{ controls: ReviewQueueControl[] }>('GET', '/api/review-queue/controls'),
  reviewQueue: (tenant: string, controlId: string) => apiRequest<ReviewQueue>('GET', '/api/review-queue', { query: { tenant, controlId } }),
  postReview: (r: ReviewInput) =>
    apiRequest<DocumentReview>('POST', '/api/reviews', {
      headers: principal(r.approverToken),
      body: {
        tenant: r.tenant, controlId: r.controlId, objectiveId: r.objectiveId, artifactHash: r.artifactHash, verdict: r.verdict,
        ...(r.notes && r.notes.trim() ? { notes: r.notes.trim() } : {}),
      },
    }),

  // approver-token-router.ts / uploader-token-router.ts (operator-gated issuers)
  issuerConfig: () => apiRequest<{ mode: string; defaultTtlSeconds: number; maxTtlSeconds: number }>('GET', '/api/approver-tokens/config'),
  uploaderIssuerConfig: () =>
    apiRequest<{ issuerConfigured: boolean; operatorAuth: string; defaultTtlSeconds: number; maxTtlSeconds: number }>('GET', '/api/uploader-tokens/config'),
  mintApproverToken: (tenant: string, operatorToken: string, approverUpn: string) =>
    apiRequest<MintedToken>('POST', '/api/approver-tokens', { query: { tenant }, headers: principal(operatorToken), body: { approverUpn } }),
  mintUploaderToken: (tenant: string, operatorToken: string, uploaderUpn: string) =>
    apiRequest<MintedToken>('POST', '/api/uploader-tokens', { query: { tenant }, headers: principal(operatorToken), body: { uploaderUpn } }),

  // ---- FIN-31b: legacy parity (the same routes, keys and bodies as public/index.html) ----

  // config-router.ts: the optional live Graph connect (server-sent events)
  connect: (tenant: string, onEvent: (f: StreamFrame) => void, signal?: AbortSignal) =>
    apiEventStream('/api/connect', { tenant }, onEvent, signal),

  // assessment-router.ts
  sprsWeights: () => apiRequest<SprsWeight[]>('GET', '/api/sprs/weights'),

  // timeline-router.ts
  timeline: (tenant: string) => apiRequest<Timeline>('GET', '/api/timeline', { query: { tenant } }),
  addTimelineEvent: (tenant: string, e: { title: string; date: string }) =>
    apiRequest<TimelineEvent>('POST', '/api/timeline/events', { query: { tenant }, body: { title: e.title, date: e.date, type: 'custom' } }),

  // policies-router.ts
  policies: (tenant: string) => apiRequest<PolicyDoc[]>('GET', '/api/policies', { query: { tenant } }),

  // evidence-router.ts (Evidence Explorer)
  evidenceIndex: (tenant: string) => apiRequest<EvidenceIndex>('GET', '/api/evidence-explorer/index', { query: { tenant } }),
  evidenceItem: (tenant: string, source: string, path: string) =>
    apiRequest<EvidenceItemContent>('GET', '/api/evidence-explorer/item', { query: { tenant, source, path } }),
  verifyEvidence: (tenant: string, source: string, path: string) =>
    apiRequest<EvidenceVerifyResult>('GET', '/api/evidence-explorer/verify', { query: { tenant, source, path } }),
  liveSignal: (tenant: string, signalId: string) =>
    apiRequest<LiveSignalResult>('POST', '/api/evidence-explorer/signal', { body: { tenant, signalId } }),

  // personnel-router.ts: readiness, config, delete, attachments
  personnelReadiness: (tenant: string) => apiRequest<PersonnelReadiness>('GET', '/api/personnel/readiness', { query: { tenant } }),
  personnelConfig: (tenant: string) => apiRequest<PersonnelConfig>('GET', '/api/personnel/config', { query: { tenant } }),
  savePersonnelConfig: (tenant: string, cfg: PersonnelConfig) =>
    apiRequest<PersonnelConfig>('PUT', '/api/personnel/config', { query: { tenant }, body: cfg }),
  deletePersonnel: (tenant: string, id: string) =>
    apiRequest<unknown>('DELETE', `/api/personnel/${enc(id)}/record`, { query: { tenant } }),
  uploadAttachment: (tenant: string, id: string, file: File, type: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    form.append('uploadedBy', 'user');
    return apiUpload<PersonnelArtifact>(`/api/personnel/${enc(id)}/attachments`, form, { query: { tenant } });
  },
  downloadAttachment: (tenant: string, id: string, artifactId: string, fallbackName: string) =>
    apiDownload(`/api/personnel/${enc(id)}/attachments/${enc(artifactId)}`, { tenant }, fallbackName),
  deleteAttachment: (tenant: string, id: string, artifactId: string) =>
    apiRequest<unknown>('DELETE', `/api/personnel/${enc(id)}/attachments/${enc(artifactId)}`, { query: { tenant } }),

  // personnel-router.ts: training assign, the simulated assignment email (FD-6), certificate, catalog
  assignTraining: (tenant: string, id: string, courseIds: string[]) =>
    apiRequest<unknown>('POST', `/api/personnel/${enc(id)}/training/assign`, { query: { tenant }, body: { courseIds } }),
  trainingEmail: (tenant: string, id: string, courseIds: string[]) =>
    apiRequest<{ emailText: string }>('POST', `/api/personnel/${enc(id)}/training/email`, { query: { tenant }, body: { courseIds } }),
  uploadCertificate: (tenant: string, id: string, courseId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('courseId', courseId);
    return apiUpload<PersonnelArtifact>(`/api/personnel/${enc(id)}/training/certificate`, form, { query: { tenant } });
  },
  saveTrainingCatalog: (tenant: string, catalog: TrainingCatalog) =>
    apiRequest<unknown>('PUT', '/api/training/catalog', { query: { tenant }, body: catalog }),

  // personnel-router.ts: the 7 screening elements (six evidence elements plus the AO sign-off)
  screeningDefinitions: () => apiRequest<ScreeningElementDef[]>('GET', '/api/screening/definitions'),
  screening: (tenant: string, id: string) =>
    apiRequest<{ personnelId: string; elements: ScreeningElementState[] }>('GET', `/api/personnel/${enc(id)}/screening`, { query: { tenant } }),
  screeningReadiness: (tenant: string, id: string) =>
    apiRequest<ScreeningReadiness>('GET', `/api/personnel/${enc(id)}/screening/readiness`, { query: { tenant } }),
  saveScreeningElement: (tenant: string, id: string, elementNum: number, status: string, data: Record<string, unknown>) =>
    apiRequest<unknown>('PUT', `/api/personnel/${enc(id)}/screening/${elementNum}`, { query: { tenant }, body: { status, data } }),
  screeningTemplate: (tenant: string, id: string, elementNum: number) =>
    apiRequest<{ elementNumber: number; templateText: string | null }>('GET', `/api/personnel/${enc(id)}/screening/template/${elementNum}`, { query: { tenant } }),
  uploadScreeningArtifact: (tenant: string, id: string, elementNum: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('uploadedBy', 'user');
    return apiUpload<PersonnelArtifact>(`/api/personnel/${enc(id)}/screening/${elementNum}/artifact`, form, { query: { tenant } });
  },
  cuiForm: (name: string) => apiDownload('/api/screening/element6-form', { name }, 'CUI-Acknowledgment.pdf'),

  // risk-assessment-router.ts: config, entries, ingestion, annual review, snapshots
  riskConfig: (tenant: string) => apiRequest<RiskAssessmentConfig>('GET', '/api/risk-assessment/config', { query: { tenant } }),
  saveRiskConfig: (tenant: string, partial: RiskAssessmentConfig) =>
    apiRequest<RiskAssessmentConfig>('PUT', '/api/risk-assessment/config', { query: { tenant }, body: partial }),
  riskEntry: (tenant: string, id: string) => apiRequest<RiskEntry>('GET', `/api/risk-assessment/register/entries/${enc(id)}`, { query: { tenant } }),
  deleteRiskEntry: (tenant: string, id: string) =>
    apiRequest<unknown>('DELETE', `/api/risk-assessment/register/entries/${enc(id)}`, { query: { tenant } }),
  ingest: (tenant: string) => apiRequest<IngestionReport>('POST', '/api/risk-assessment/ingest', { query: { tenant } }),
  ingestionRuns: (tenant: string) => apiRequest<IngestionReport[]>('GET', '/api/risk-assessment/ingestion-runs', { query: { tenant, limit: 20 } }),
  annualReviewState: (tenant: string) => apiRequest<AnnualReviewState>('GET', '/api/risk-assessment/annual-review/state', { query: { tenant } }),
  startAnnualReview: (tenant: string, startedBy: string) =>
    apiRequest<AnnualReviewState>('POST', '/api/risk-assessment/annual-review/start', { query: { tenant }, body: { startedBy } }),
  saveAnnualReviewStep: (tenant: string, step: number, data: Record<string, unknown>) =>
    apiRequest<AnnualReviewState>('PUT', `/api/risk-assessment/annual-review/step/${step}`, { query: { tenant }, body: data }),
  completeAnnualReview: (tenant: string, signedOffBy: string, reviewNotes: string) =>
    apiRequest<RiskSnapshot>('POST', '/api/risk-assessment/annual-review/complete', { query: { tenant }, body: { signedOffBy, reviewNotes } }),
  cancelAnnualReview: (tenant: string) => apiRequest<unknown>('DELETE', '/api/risk-assessment/annual-review/state', { query: { tenant } }),
  oneClickAnnualReview: (tenant: string, reviewedBy: string, signedOffBy: string) =>
    apiRequest<OneClickReviewResult>('POST', '/api/risk-assessment/annual-review/one-click', { query: { tenant }, body: { reviewedBy, signedOffBy } }),
  riskSnapshots: (tenant: string) => apiRequest<RiskSnapshotListing[]>('GET', '/api/risk-assessment/snapshots', { query: { tenant } }),
  riskSnapshot: (tenant: string, year: number) => apiRequest<RiskSnapshot>('GET', `/api/risk-assessment/snapshots/${year}`, { query: { tenant } }),
} as const;
