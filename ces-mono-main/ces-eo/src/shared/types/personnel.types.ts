// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { z } from 'zod';

// --- Screening State ---

export const ScreeningStateSchema = z.enum([
  'unscreened',
  'in-progress',
  'cleared',
  'expiring-soon',
  'expired',
  'offboarding-in-progress',
  'offboarded',
]);

export type ScreeningState = z.infer<typeof ScreeningStateSchema>;

// --- Lifecycle Event ---

export const LifecycleEventSchema = z.object({
  timestamp: z.string(),
  event: z.string(),
  actor: z.string(),
  details: z.string().optional(),
});

export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>;

// --- Evidence Artifact ---

export const PersonnelEvidenceArtifactSchema = z.object({
  id: z.string(),
  type: z.enum([
    'background-check',
    'id-verification',
    'reference-check',
    'cui-acknowledgment',
    'authorization',
    'citizenship-doc',
    'direct-knowledge-attestation',
    'linkedin-profile',
    'professional-credential',
    'offboarding-procedural-overlay',
    'training-certificate',
    'other',
  ]),
  filename: z.string(),
  uploadDate: z.string(),
  uploadedBy: z.string(),
  contentHash: z.string(),
  storagePath: z.string(),
  metadata: z.record(z.unknown()).default({}),
});

export type PersonnelEvidenceArtifact = z.infer<typeof PersonnelEvidenceArtifactSchema>;

// --- Personnel Record ---

export const PersonnelRecordSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
  entraObjectId: z.string().optional(),
  role: z.string(),
  screeningState: ScreeningStateSchema,
  createdDate: z.string(),
  lastScreenedDate: z.string().optional(),
  nextReviewDate: z.string().optional(),
  offboardedDate: z.string().optional(),
  evidenceArtifacts: z.array(PersonnelEvidenceArtifactSchema).default([]),
  lifecycleEvents: z.array(LifecycleEventSchema).default([]),
  notes: z.string().optional(),
});

export type PersonnelRecord = z.infer<typeof PersonnelRecordSchema>;

// --- Vendor Config ---

export const VendorConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  package: z.string(),
  priceRange: z.string().nullable().default(null),
  turnaround: z.string().nullable().default(null),
});

export type VendorConfig = z.infer<typeof VendorConfigSchema>;

// --- Personnel Config ---

export const PersonnelConfigSchema = z.object({
  reviewCycleYears: z.number().default(5),
  docRetentionYears: z.number().default(6),
  screeningTriggerGroups: z.array(z.string()).default(['*']),
  defaultScreeningVendor: z.string().default('checkr'),
  cuiAcknowledgmentSource: z.string().default('https://www.archives.gov/cui'),
  vendors: z.array(VendorConfigSchema).default([
    {
      id: 'checkr',
      name: 'Checkr',
      url: 'https://checkr.com',
      package: 'Basic+',
      priceRange: '$35-55',
      turnaround: '1-2 days',
    },
    {
      id: 'sterling',
      name: 'Sterling',
      url: 'https://www.sterlingcheck.com',
      package: 'standard',
      priceRange: null,
      turnaround: null,
    },
    {
      id: 'goodhire',
      name: 'GoodHire',
      url: 'https://www.goodhire.com',
      package: 'basic',
      priceRange: '~$30',
      turnaround: 'immediate',
    },
  ]),
  trainingGracePeriodDays: z.number().default(30),
  trainingRefreshYears: z.number().default(1),
  trainingEmailFrom: z.string().default('training@vfs.local'),
  trainingEmailSubject: z.string().default('Required Training Assignment'),
});

export type PersonnelConfig = z.infer<typeof PersonnelConfigSchema>;

// --- Readiness Status ---

export interface PersonnelReadiness {
  cleared: number;
  total: number;
  expiringSoon: number;
  unscreened: number;
  offboarded: number;
  ps_3_9_1: 'met' | 'not_met';
  ps_3_9_2: 'met' | 'not_met';
  screening_evidence_complete?: boolean;
  at_3_2_1?: 'met' | 'not_met';
  at_3_2_2?: 'met' | 'not_met';
  at_3_2_3?: 'met' | 'not_met';
}

// --- API Request Schemas ---

export const PersonnelCreateRequestSchema = z.object({
  displayName: z.string().min(1),
  email: z.string().min(1),
  role: z.string().min(1),
  entraObjectId: z.string().optional(),
});

export const PersonnelUpdateRequestSchema = z.object({
  displayName: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  screeningState: ScreeningStateSchema.optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
  lastScreenedDate: z.string().optional(),
  nextReviewDate: z.string().optional(),
  offboardedDate: z.string().optional(),
});

export const LifecycleEventCreateSchema = z.object({
  event: z.string().min(1),
  actor: z.string().min(1),
  details: z.string().optional(),
});

// --- Training Types ---

export const TrainingCourseSchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string(),
  url: z.string().optional(),
  source_url: z.string().optional(),
  launch_url: z.string().optional(),
  duration: z.string(),
  description: z.string().optional(),
  targetRoles: z.array(z.string()),
  required_for_roles: z.array(z.string()),
  satisfies_controls: z.array(z.string()),
  refresh_cycle_days: z.number(),
  certificate_note: z.string().optional(),
  cost: z.string().optional(),
});

export type TrainingCourse = z.infer<typeof TrainingCourseSchema>;

export const TrainingCompletionSchema = z.object({
  courseId: z.string(),
  completedDate: z.string(),
  certificateArtifactId: z.string().optional(),
  expiryDate: z.string().optional(),
});

export type TrainingCompletion = z.infer<typeof TrainingCompletionSchema>;

export const PersonnelTrainingStateSchema = z.object({
  personnelId: z.string(),
  requiredCourses: z.array(z.string()),
  completions: z.array(TrainingCompletionSchema).default([]),
  lastAssignmentEmailDate: z.string().optional(),
});

export type PersonnelTrainingState = z.infer<typeof PersonnelTrainingStateSchema>;

export const TrainingCatalogSchema = z.object({
  courses: z.array(TrainingCourseSchema),
});

export type TrainingCatalog = z.infer<typeof TrainingCatalogSchema>;
