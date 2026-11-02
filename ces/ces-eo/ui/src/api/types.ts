// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Response shapes the screens read, declared here (API-5: the UI imports no server or core module).
// Only the fields the screens use are typed; every shape mirrors an EO route named beside it.

export type ControlStatus = 'met' | 'not_met' | 'partial' | 'not_assessed' | string;

/** GET /api/tenants (config-router.ts) */
export interface TenantSummary {
  slug: string;
  client_name: string;
  environment?: string;
  source?: string;
}

/** GET /api/ui/info (eo-ui-router.ts) */
export interface UiInfo {
  spaPath: string;
  spaBuilt: boolean;
  simulator: { active: boolean };
  twoPersonApproval: boolean;
  uploaderTokenIssuer: boolean;
}

/** GET /api/assessment (assessment-router.ts): the latest AssessmentSnapshot */
export interface AssessmentControl {
  control_id: string;
  nist_ref?: string;
  family?: string;
  practice?: string;
  status: ControlStatus;
  /** automated | nonstack | excluded (legacy family table "Approach" column) */
  classification?: string;
}
export interface AssessmentSnapshot {
  snapshotId: string;
  generatedAt: string;
  sprs_score: number;
  controls: AssessmentControl[];
}

/** GET /api/sprs */
export interface SprsDeduction {
  control_id: string;
  nist_ref: string;
  weight: number;
  status: ControlStatus;
}
export interface SprsResult {
  score: number;
  certificationPath: 'full' | 'conditional' | 'blocked' | string;
  controlsMet: number;
  controlsNotMet: number;
  poamEligible: boolean;
  poamCandidates: unknown[];
  poamBlockers: string[];
  deductions: SprsDeduction[];
}
export interface SprsHistoryPoint {
  snapshotId?: string;
  generatedAt?: string;
  timestamp?: string;
  score?: number;
  sprs_score?: number;
}

/** POST /api/ssp/generate, GET /api/ssp/latest (documents-router.ts) */
export interface SspControlImplementation {
  control_id: string;
  family: string;
  status: ControlStatus;
  weight?: number;
  practice?: string;
  implementationNarrative?: string;
  responsibleRole?: string;
  technologyUsed?: string[];
}
export interface SystemSecurityPlan {
  sspId: string;
  systemName: string;
  systemDescription?: string;
  generatedAt: string;
  version?: string;
  controlImplementations: SspControlImplementation[];
  hostingModel?: { model?: string; environment?: string };
  authorizationBoundary?: { description?: string };
  systemComponents?: { sections?: unknown[] };
  sourceArtifacts?: string[];
}

/** POST /api/poam/generate */
export interface PoamItem {
  control_id: string;
  nist_ref: string;
  practice?: string;
  weight: number;
  plannedCorrectiveAction?: string;
  responsibleParty?: string;
  status: string;
  /** R-POAM: false = tracked deficiency, not CMMC POA&M-eligible (32 CFR 170.21). */
  poamEligible?: boolean;
  eligibilityNote?: string;
}
export interface Poam {
  poamId: string;
  sprsScore: number;
  eligibility: { eligible: boolean; blockers: Array<{ control_id: string; nist_ref: string; weight: number; reason: string }> };
  items: PoamItem[];
  summary: { totalItems: number; openItems: number; totalWeightOnPoam: number; projectedScoreAfterPoam: number };
}

/** POST /api/package/build, GET /api/packages (evidence-router.ts) */
export interface PackageBuildResult {
  packageId: string;
  filename?: string;
  fileCount: number;
  sizeBytes: number;
}
export interface PackageListing {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

/** GET /api/personnel (personnel-router.ts) */
export interface PersonnelArtifact {
  id: string;
  type: string;
  filename: string;
  contentHash?: string;
  uploadedBy?: string;
  metadata?: { screeningElement?: number; [k: string]: unknown };
}
export interface PersonnelLifecycleEvent {
  timestamp: string;
  event: string;
  actor?: string;
  details?: string;
}
export interface PersonnelRecord {
  id: string;
  displayName: string;
  email: string;
  role: string;
  screeningState: string;
  lastScreenedDate?: string;
  nextReviewDate?: string;
  lifecycleEvents?: PersonnelLifecycleEvent[];
  evidenceArtifacts?: PersonnelArtifact[];
}
/** GET /api/personnel/readiness */
export interface PersonnelReadiness {
  cleared: number;
  total: number;
  expiringSoon: number;
  unscreened: number;
  offboarded?: number;
  ps_3_9_1?: string;
  ps_3_9_2?: string;
  screening_evidence_complete?: boolean;
  at_3_2_1?: string;
  at_3_2_2?: string;
  at_3_2_3?: string;
}
/** GET|PUT /api/personnel/config */
export interface PersonnelConfig {
  reviewCycleYears?: number;
  docRetentionYears?: number;
  defaultScreeningVendor?: string;
  cuiAcknowledgmentSource?: string;
  trainingGracePeriodDays?: number;
  trainingRefreshYears?: number;
  trainingEmailFrom?: string;
  trainingEmailSubject?: string;
  [k: string]: unknown;
}
/** GET /api/screening/definitions (shared/data/screening-element-definitions.json, fetched, not imported: API-5) */
export interface ScreeningFieldDef {
  name: string;
  label: string;
  type: 'text' | 'select' | 'textarea' | 'number' | 'date' | string;
  options?: string[];
}
export interface ScreeningElementDef {
  elementNumber: number;
  title: string;
  description?: string;
  artifactType?: string;
  hasTemplate?: boolean;
  fields?: ScreeningFieldDef[];
}
/** GET /api/personnel/:id/screening */
export interface ScreeningElementState {
  elementNumber: number;
  status: 'not_started' | 'in_progress' | 'completed' | string;
  data: Record<string, unknown> | null;
  completedDate?: string;
  updatedDate?: string;
}
/** GET /api/personnel/:id/screening/readiness */
export interface ScreeningReadiness {
  elementsComplete: number[];
  elementsIncomplete: number[];
  element7Status?: string;
  aoDetermination?: 'approve' | 'deny' | null;
  packageComplete: boolean;
}
/** GET /api/personnel/:id/training */
export interface TrainingDetail {
  status?: { completed: number; total: number; overdue: number };
  state?: {
    completions?: Array<{ courseId: string; completedDate: string; expiryDate?: string; certificateArtifactId?: string }>;
    lastAssignmentEmailDate?: string;
  };
  requiredCourses?: string[];
}
/** GET /api/training/catalog */
export interface TrainingCourse {
  id: string;
  title: string;
  provider?: string;
  duration?: string;
  launch_url?: string;
  targetRoles?: string[];
  required_for_roles?: string[];
  satisfies_controls?: string[];
  refresh_cycle_days?: number;
  [k: string]: unknown;
}
export interface TrainingCatalog {
  courses: TrainingCourse[];
  [k: string]: unknown;
}
/** GET|PUT /api/personnel/:slug/role-population (LOG-FIN-26b) */
export interface RolePopulationResponse {
  tenantSlug: string;
  population: { roles: string[]; source?: string; [k: string]: unknown } | null;
}
/** GET|POST|PUT /api/personnel/:id/offboarding */
export interface OffboardingRun {
  personnelName: string;
  slaStatus?: 'green' | 'yellow' | 'red' | string;
  triggerTime?: string;
  currentStepIndex: number;
  steps: Array<{ id: string; label: string; completed: boolean; completedAt?: string; attestor?: string; notes?: string }>;
}

/** GET /api/risk-assessment/register (risk-assessment-router.ts) */
export interface RiskEntry {
  id: string;
  threatEvent?: string;
  threatSource?: string;
  vulnerability?: { description?: string; [k: string]: unknown };
  likelihood?: string;
  impact?: string;
  compositeRisk?: string;
  affectedAssets?: string[];
  affectedOperations?: string[];
  treatmentStatus?: string;
  treatmentRecommendation?: string;
  treatmentReference?: string;
  notes?: string;
  firstIdentified?: string;
  lastReviewed?: string;
  nextReviewDue?: string;
  source?: { type: string; alertId?: string; controlName?: string; score?: number; controlId?: string; status?: string; [k: string]: unknown };
}
export interface RiskRegister {
  entries: RiskEntry[];
  lastFullReviewDate?: string;
  nextReviewDue?: string;
}

/** POST /api/ec/ingest (EC item, through ec-router.ts) */
export interface EcIngestResult {
  itemId?: string;
  sha256?: string;
  uploadedBy?: { upn: string; subjectId?: string } | null;
}
/** GET /api/ec/runs, GET /api/ec/findings */
export interface EcRun {
  runId?: string;
  startedAt: string;
  runType: string;
  status: string;
  artifactsWritten?: number;
}
export interface EcFinding {
  findingId?: string;
  checkId?: string;
  detectedAt: string;
  severity: string;
  status: string;
}

/** GET /api/review-queue/controls, GET /api/review-queue (review-queue-router.ts) */
export interface ReviewQueueControl {
  controlId: string;
  objectiveIds: string[];
}
export interface ReviewQueueItem {
  itemId: string;
  filename: string;
  sha256: string;
  controlIds: string[];
  source: string;
  submittedByRole?: string;
  collectedAt: string;
  uploadedBy: { upn: string; subjectId?: string } | null;
}
export interface DocumentReview {
  reviewId: string;
  controlId: string;
  objectiveId: string;
  artifactHash: string;
  verdict: 'met' | 'not_met';
  notes?: string;
  reviewer: { upn: string; displayName?: string };
  uploader: { upn: string };
  reviewedAt: string;
  supersedes?: string[];
}
export interface ReviewQueue {
  tenant: string;
  controlId: string;
  nonStack: boolean;
  objectiveIds: string[];
  items: ReviewQueueItem[];
  reviews: DocumentReview[];
}

/** POST /api/approver-tokens, POST /api/uploader-tokens */
export interface MintedToken {
  token: string;
  mintId: string;
  approverUpn?: string;
  uploaderUpn?: string;
  expiresAt: string;
  operatorAuth: string;
}

/** GET /api/assessor-view (viewer/AssessorViewComposer.ts AssessorView) */
export interface AssessorView {
  tenantId: string;
  generatedAt: string;
  sprs: { score: number; controlsMet: number; controlsNotMet: number; controlsPartial: number; controlsNotAssessed: number; pointsAtRisk: number };
  controls: Array<{
    controlId: string;
    family: string;
    status: ControlStatus;
    weight: number;
    certificationBlocker: boolean;
    pointsAtRisk: number;
    narrative?: string;
    evidence: Array<{ label: string; href?: string }>;
    objectiveIds: string[];
  }>;
  objectives: Array<{ objectiveId: string; controlId: string; status: string; source: string; rationale: string }>;
  summary: { objectivesTotal: number; objectivesSatisfied: number; deficiencies: number; certificationBlockers: number; openPoamItems: number };
}

// ---- FIN-31b additions (legacy parity) ----

/** GET /api/sprs/weights (assessment-router.ts) */
export interface SprsWeight {
  nist_ref: string;
  weight: number;
  poam_allowed?: boolean;
}

/** GET /api/timeline, POST /api/timeline/events (timeline-router.ts) */
export interface TimelineEvent {
  eventId?: string;
  type: 'assessment' | 'certification' | 'poam_deadline' | 'custom' | string;
  title: string;
  date: string;
  detail?: string;
}
export interface Timeline {
  tenantId?: string;
  events: TimelineEvent[];
}

/** GET /api/policies (policies-router.ts) */
export interface PolicyDoc {
  template_id: string;
  title: string;
  markdown?: string;
  completeness: number;
  domain: string;
  nist_controls?: string[];
  loadedAt: string;
}

/** The optional live connect (GET /api/connect, server-sent events, config-router.ts). */
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

/** GET /api/evidence-explorer/index (evidence-router.ts) */
export interface EvidenceIndexItem {
  id: string;
  source: 'stamper' | 'blob' | 'signal' | 'local' | 'adminops' | string;
  title: string;
  family?: string;
  controlIds: string[];
  timestamp: string;
  verdict?: string;
  path?: string;
  requiresConnection: boolean;
}
export interface EvidenceIndex {
  items: EvidenceIndexItem[];
  connectionState: 'connected' | 'disconnected' | string;
}
/** GET /api/evidence-explorer/item */
export interface EvidenceItemContent {
  content: unknown;
  metadata?: { sha256?: string; timestamp?: string; size?: number; [k: string]: unknown };
}
/** GET /api/evidence-explorer/verify */
export interface EvidenceVerifyResult {
  verified: boolean;
  expected?: string;
  actual?: string;
}
/** POST /api/evidence-explorer/signal */
export interface LiveSignalResult {
  signalResults: unknown[];
  timestamp: string;
}

/** GET|PUT /api/risk-assessment/config (RiskAssessmentConfig in src/shared/types, retyped here: API-5) */
export interface ThreatCatalogEntry {
  source: string;
  events: string[];
}
export interface ThreatCatalog {
  adversarial: ThreatCatalogEntry[];
  non_adversarial: ThreatCatalogEntry[];
}
export interface VulnerabilitySources {
  defender_for_cloud?: { enabled?: boolean; severity_threshold?: string; [k: string]: unknown };
  microsoft_secure_score?: { enabled?: boolean; [k: string]: unknown };
  plan_output_not_met?: { enabled?: boolean; [k: string]: unknown };
  sentinel_incidents?: { enabled?: boolean; [k: string]: unknown };
}
export interface AuthorizingOfficial {
  displayName: string;
  upn: string;
  role: string;
}
export interface RiskAssessmentConfig {
  scopeStatement?: string;
  frequencyMonths?: number;
  methodology?: string;
  threatCatalog?: Partial<ThreatCatalog>;
  vulnerabilitySources?: VulnerabilitySources;
  authorizingOfficial?: AuthorizingOfficial;
}
/** POST /api/risk-assessment/ingest, GET /api/risk-assessment/ingestion-runs (IngestionReport) */
export interface IngestionReport {
  timestamp: string;
  results?: Array<{ source: string; new: number; updated: number; skipped: number; errors: string[] }>;
  totalNew: number;
  totalUpdated: number;
  totalErrors: number;
  trigger?: string;
}
/** GET /api/risk-assessment/snapshots (list) and /snapshots/:year (detail) */
export interface RiskSnapshotListing {
  year: number;
  snapshotId: string;
  signedOffDate: string;
}
export interface RiskSnapshot {
  snapshotId: string;
  assessmentYear: number;
  reviewedDate?: string;
  reviewedBy?: string;
  signedOffBy?: string;
  signedOffDate?: string;
  registerSnapshot?: { entries?: RiskEntry[]; nextReviewDue?: string; lastFullReviewDate?: string };
  reviewNotes?: string;
}
/** GET /api/risk-assessment/annual-review/state, POST .../start, PUT .../step/:n */
export interface AnnualReviewState {
  currentStep: number;
  startedAt: string;
  startedBy: string;
  stepData: Record<string, Record<string, unknown>>;
}
/** POST /api/risk-assessment/annual-review/one-click */
export interface OneClickReviewResult {
  success: boolean;
  snapshot: RiskSnapshot;
  summary: { totalEntries: number; ingested: { new: number; updated: number; errors: number }; scored: number; nextReviewDue: string };
}
