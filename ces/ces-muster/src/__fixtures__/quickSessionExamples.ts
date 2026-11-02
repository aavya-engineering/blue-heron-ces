/**
 * Quick Session training fixtures.
 *
 * Copy an answers map into the Quick Session form to run a practice export
 * before a real session. Each fixture represents a realistic advisor scenario
 * with pre-populated answers, allowing the advisor to click Export and verify
 * that the downloaded StatusPayload is well-formed before using the tool with
 * a live client.
 */
import type { EngagementKind } from '@/shared/types/engagement';

export interface QuickSessionFixture {
  label: string;
  kind: EngagementKind;
  partyName: string;
  uei?: string;
  cage?: string;
  onPremOt: 'yes' | 'no' | 'unsure';
  selectedServices: string[];
  answers: Record<string, string>;
}

export const QUICK_SESSION_EXAMPLES: QuickSessionFixture[] = [
  {
    label: 'Small Sub – Cloud Only, Mature',
    kind: 'individual_contractor',
    partyName: 'Apex Cloud Solutions LLC',
    uei: 'APEX123456789',
    cage: '7QAB2',
    onPremOt: 'no',
    selectedServices: ['m365_e3', 'microsoft_intune'],
    // 24 keys: universal (23) + ep-001 (Intune-gated)
    answers: {
      'iam-001': 'yes',
      'iam-002': 'yes',
      'iam-003': 'yes',
      'iam-004': 'yes',
      'iam-005': 'yes',
      'ep-001': 'yes',
      'ep-002': 'yes',
      'ep-003': 'yes',
      'ep-004': 'yes',
      'pol-001': 'yes',
      'pol-002': 'yes',
      'pol-003': 'yes',
      'pol-004': 'yes',
      'mon-001': 'yes',
      'mon-002': 'yes',
      'mon-003': 'yes',
      'dp-001': 'yes',
      'dp-002': 'yes',
      'dp-003': 'yes',
      'dp-004': 'yes',
      'ir-001': 'yes',
      'ir-002': 'yes',
      'ir-003': 'yes',
      'ir-004': 'yes',
    },
  },
  {
    label: 'Mid-size Sub – On-prem, Gap-heavy',
    kind: 'prime_and_subs',
    partyName: 'Ironclad Defense Systems Inc',
    uei: 'IRON987654321',
    cage: '3ZBF9',
    onPremOt: 'yes',
    selectedServices: ['on_prem_ad', 'microsoft_intune', 'microsoft_sentinel'],
    // 25 keys: universal (23) + ep-001 (Intune-gated) + mon-004 (Sentinel-gated)
    answers: {
      'iam-001': 'yes',
      'iam-002': 'yes',
      'iam-003': 'yes',
      'iam-004': 'yes',
      'iam-005': 'yes',
      'ep-001': 'yes',
      'ep-002': 'yes',
      'ep-003': 'yes',
      'ep-004': 'yes',
      'dp-001': 'yes',
      'dp-002': 'yes',
      'dp-003': 'yes',
      'dp-004': 'yes',
      'pol-001': 'unknown',
      'pol-002': 'unknown',
      'pol-003': 'unknown',
      'pol-004': 'unknown',
      'mon-001': 'no',
      'mon-002': 'no',
      'mon-003': 'no',
      'mon-004': 'no',
      'ir-001': 'no',
      'ir-002': 'no',
      'ir-003': 'no',
      'ir-004': 'no',
    },
  },
  {
    label: 'Individual Contractor – Minimal Posture',
    kind: 'individual_contractor',
    partyName: 'John R. Maddox Consulting',
    onPremOt: 'unsure',
    selectedServices: [],
    // 23 keys: universal only (no ep-001, no mon-004 — no services selected)
    answers: {
      'iam-001': 'unknown',
      'iam-002': 'unknown',
      'iam-003': 'unknown',
      'iam-004': 'unknown',
      'iam-005': 'unknown',
      'ep-002': 'unknown',
      'ep-003': 'unknown',
      'ep-004': 'unknown',
      'pol-001': 'unknown',
      'pol-002': 'unknown',
      'pol-003': 'unknown',
      'pol-004': 'unknown',
      'mon-001': 'unknown',
      'mon-002': 'unknown',
      'mon-003': 'unknown',
      'dp-001': 'unknown',
      'dp-002': 'unknown',
      'dp-003': 'unknown',
      'dp-004': 'unknown',
      'ir-001': 'unknown',
      'ir-002': 'unknown',
      'ir-003': 'unknown',
      'ir-004': 'unknown',
    },
  },
];
