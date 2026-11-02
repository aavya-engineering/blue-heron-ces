// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { z } from 'zod';

// ── Element Number ──

export const ScreeningElementNumberSchema = z.number().int().min(1).max(7);
export type ScreeningElementNumber = z.infer<typeof ScreeningElementNumberSchema>;

// ── Element Status ──

export const ScreeningElementStatusSchema = z.enum(['not_started', 'in_progress', 'completed']);
export type ScreeningElementStatus = z.infer<typeof ScreeningElementStatusSchema>;

// ── Element 1: Identity Verification ──

export const IdentityVerificationDataSchema = z.object({
  documentType: z.enum(['drivers_license', 'passport', 'state_id', 'military_id', 'other']),
  documentNumber: z.string().min(1),
  issuingAuthority: z.string().min(1),
  expirationDate: z.string().min(1),
  verifiedBy: z.string().min(1),
  verificationDate: z.string().min(1),
  notes: z.string().optional(),
});
export type IdentityVerificationData = z.infer<typeof IdentityVerificationDataSchema>;

// ── Element 2: Citizenship / Legal Work Authorization ──

export const CitizenshipDataSchema = z.object({
  citizenshipStatus: z.enum(['us_citizen', 'permanent_resident', 'work_visa', 'other']),
  documentType: z.string().min(1),
  documentNumber: z.string().min(1),
  expirationDate: z.string().optional(),
  verifiedBy: z.string().min(1),
  verificationDate: z.string().min(1),
  notes: z.string().optional(),
});
export type CitizenshipData = z.infer<typeof CitizenshipDataSchema>;

// ── Element 3: Verifiable Professional History (Reference Check) ──

export const ReferenceCheckDataSchema = z.object({
  referenceName: z.string().min(1),
  referenceTitle: z.string().min(1),
  referenceOrganization: z.string().min(1),
  referenceEmail: z.string().optional(),
  referencePhone: z.string().optional(),
  relationshipToSubject: z.string().min(1),
  yearsKnown: z.number().min(0),
  contactedDate: z.string().min(1),
  contactedBy: z.string().min(1),
  outcome: z.enum(['positive', 'negative', 'inconclusive', 'pending']),
  notes: z.string().optional(),
});
export type ReferenceCheckData = z.infer<typeof ReferenceCheckDataSchema>;

// ── Element 4: Direct-Knowledge Attestation ──

export const DirectKnowledgeAttestationDataSchema = z.object({
  attestor_name: z.string().min(1),
  attestor_role: z.string().min(1),
  attestor_email: z.string().min(1),
  attestationDate: z.string().min(1),
  signedText: z.string().min(1),
  notes: z.string().optional(),
});
export type DirectKnowledgeAttestationData = z.infer<typeof DirectKnowledgeAttestationDataSchema>;

// ── Element 5: Self-Attestation / Background-Check Consent ──

export const SelfAttestationDataSchema = z.object({
  person_name: z.string().min(1),
  consentDate: z.string().min(1),
  signedText: z.string().min(1),
  backgroundCheckVendor: z.string().optional(),
  backgroundCheckStatus: z.enum(['not_started', 'pending', 'completed', 'failed']).optional(),
  backgroundCheckDate: z.string().optional(),
  notes: z.string().optional(),
});
export type SelfAttestationData = z.infer<typeof SelfAttestationDataSchema>;

// ── Element 6: CUI Acknowledgment ──

export const CuiAcknowledgmentDataSchema = z.object({
  person_name: z.string().min(1),
  acknowledgmentDate: z.string().min(1),
  cui_source: z.string().min(1),
  signedText: z.string().min(1),
  notes: z.string().optional(),
});
export type CuiAcknowledgmentData = z.infer<typeof CuiAcknowledgmentDataSchema>;

// ── Element 7: AO Sign-Off ──

export const AoSignOffDataSchema = z.object({
  ao_name: z.string().min(1),
  ao_email: z.string().min(1),
  ao_role: z.string().min(1),
  determination: z.enum(['approve', 'deny']),
  signOffDate: z.string().min(1),
  signedText: z.string().min(1),
  notes: z.string().optional(),
});
export type AoSignOffData = z.infer<typeof AoSignOffDataSchema>;

// ── Union of all element data types ──

export const ScreeningElementDataSchema = z.discriminatedUnion('_elementType', [
  IdentityVerificationDataSchema.extend({ _elementType: z.literal('identity_verification') }),
  CitizenshipDataSchema.extend({ _elementType: z.literal('citizenship') }),
  ReferenceCheckDataSchema.extend({ _elementType: z.literal('reference_check') }),
  DirectKnowledgeAttestationDataSchema.extend({ _elementType: z.literal('direct_knowledge_attestation') }),
  SelfAttestationDataSchema.extend({ _elementType: z.literal('self_attestation') }),
  CuiAcknowledgmentDataSchema.extend({ _elementType: z.literal('cui_acknowledgment') }),
  AoSignOffDataSchema.extend({ _elementType: z.literal('ao_sign_off') }),
]);
export type ScreeningElementData = z.infer<typeof ScreeningElementDataSchema>;

// ── Per-element state envelope ──

export const ScreeningElementStateSchema = z.object({
  elementNumber: ScreeningElementNumberSchema,
  status: ScreeningElementStatusSchema,
  data: ScreeningElementDataSchema.nullable().default(null),
  completedDate: z.string().optional(),
  updatedDate: z.string().optional(),
});
export type ScreeningElementState = z.infer<typeof ScreeningElementStateSchema>;

// ── Readiness Summary ──

export interface ScreeningReadiness {
  elementsComplete: number[];
  elementsIncomplete: number[];
  element7Status: ScreeningElementStatus;
  aoDetermination: 'approve' | 'deny' | null;
  packageComplete: boolean;
}

// ── Element-to-artifact-type mapping ──

export const ELEMENT_ARTIFACT_TYPE_MAP: Record<number, string> = {
  1: 'id-verification',
  2: 'citizenship-doc',
  3: 'reference-check',
  4: 'direct-knowledge-attestation',
  5: 'background-check',
  6: 'cui-acknowledgment',
  7: 'authorization',
};

// ── Element type discriminant mapping ──

export const ELEMENT_TYPE_DISCRIMINANT: Record<number, string> = {
  1: 'identity_verification',
  2: 'citizenship',
  3: 'reference_check',
  4: 'direct_knowledge_attestation',
  5: 'self_attestation',
  6: 'cui_acknowledgment',
  7: 'ao_sign_off',
};

// ── Template Text Constants ──

export const SCREENING_TEMPLATE_TEXT: Record<number, string> = {
  4: 'I, {attestor_name}, in my capacity as {attestor_role}, hereby attest that I have direct knowledge of {person_name}\'s character, work ethic, and suitability for access to Controlled Unclassified Information (CUI). I affirm that {person_name} demonstrates the integrity, reliability, and trustworthiness required for handling sensitive government information. This attestation is made voluntarily and to the best of my knowledge.',
  5: 'I, {person_name}, hereby acknowledge that my employer requires a personnel screening as part of compliance with CMMC Level 2 controls (PS.L2-3.9.1). I consent to a background check covering criminal history, employment verification, and education verification. I understand that the results will be used solely for the purpose of determining my suitability for access to Controlled Unclassified Information (CUI). I affirm that all information I have provided during this screening process is true and accurate to the best of my knowledge.',
  6: 'I, {person_name}, acknowledge that I have been briefed on the requirements for handling Controlled Unclassified Information (CUI) as defined by 32 CFR Part 2002 and the CUI Registry maintained by NARA ({cui_source}). I understand my responsibilities for properly marking, safeguarding, decontrolling, and destroying CUI. I agree to comply with all organizational policies governing CUI handling.',
  7: 'As the designated Authorizing Official for {tenant_name}, I have reviewed the personnel screening package for {person_name} consisting of the following elements: (1) Identity Verification, (2) Citizenship/Legal Work Authorization, (3) Verifiable Professional History, (4) Direct-Knowledge Attestation, (5) Self-Attestation/Background-Check Consent, (6) CUI Acknowledgment. Based on my review, I {determination} {person_name} for access to CUI-scoped systems and information within the {tenant_name} enclave.',
};

// ── Element Titles ──

export const SCREENING_ELEMENT_TITLES: Record<number, string> = {
  1: 'Identity Verification',
  2: 'Citizenship / Legal Work Authorization',
  3: 'Verifiable Professional History',
  4: 'Direct-Knowledge Attestation',
  5: 'Self-Attestation / Background-Check Consent',
  6: 'CUI Acknowledgment',
  7: 'Authorizing Official Sign-Off',
};
