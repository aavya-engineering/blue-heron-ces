// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// btcGateNodes.ts — MG-09: the BTC bank questions Muster still asks. Only the
// questions no discovery read can evidence (btcEvidenceMap.json lists the
// eight that can: BTC.ID.001/002, BTC.DEV.001/002, BTC.LOG.001-004). Cluster
// boundary (the Boundary tab), mapped_requirements [] (score-leak safe),
// plan_input btc_confirmation (optional for the finish gate). The answer is the
// BTC answer (client_assertion) btcLite.ts feeds the gate evaluator.
import type { QuestionNode } from '@/features/interview/questionGraph';

export interface BtcNodeSpec {
  id: string;
  /** The bank prompt, verbatim. */
  text: string;
  /** The bank options, verbatim (boolean questions: Yes / No). */
  bankOptions: string[];
}

/** Transcribed from `primed BTC Question Bank.yaml`; guarded by the test. */
export const BTC_NODE_SPECS: BtcNodeSpec[] = [
  {
    id: 'BTC.ID.003',
    text: 'Are guest accounts present in the tenant? If yes, are they aligned to the declared boundary policy?',
    bankOptions: ['No guests', 'Guests present - aligned', 'Guests present - not aligned', 'Unknown'],
  },
  {
    id: 'BTC.ID.004',
    text: 'Are break-glass accounts configured, protected, and excluded appropriately (documented)?',
    bankOptions: ['Yes', 'Partially', 'No', 'Unknown'],
  },
  {
    id: 'BTC.DEV.003',
    text: 'Are privileged admin devices isolated/hardened (PAW/SAW) per declared model?',
    bankOptions: ['Yes', 'Partially', 'No', 'Unknown'],
  },
  {
    id: 'BTC.DEVOPS.001',
    text: 'Are any CUI repositories located in commercial environments or outside the declared boundary?',
    bankOptions: ['No', 'Yes', 'Unknown'],
  },
  {
    id: 'BTC.DEVOPS.002',
    text: 'Are CI/CD pipelines fully within the declared boundary (runners, artifacts, logs)?',
    bankOptions: ['Yes', 'Partially', 'No', 'Unknown'],
  },
  {
    id: 'BTC.DEVOPS.003',
    text: 'Are build artifacts stored inside the enclave with retention and access controls?',
    bankOptions: ['Yes', 'Partially', 'No', 'Unknown'],
  },
  {
    id: 'BTC.INT.001',
    text: 'Validate all external SaaS integrations that connect to in-scope data (list and confirm).',
    bankOptions: ['All identified and approved', 'Some identified but not approved', 'Unknown'],
  },
  {
    id: 'BTC.INT.002',
    text: 'Review API tokens/service principals: are they inventoried, least-privilege, and documented?',
    bankOptions: ['Yes', 'Partially', 'No', 'Unknown'],
  },
  {
    id: 'BTC.INT.003',
    text: 'Confirm email forwarding restrictions are enforced as declared.',
    bankOptions: ['Yes', 'Partially', 'No', 'Unknown'],
  },
  {
    id: 'BTC.INT.004',
    text: 'Verify backup storage locations and whether any backup falls outside the boundary.',
    bankOptions: ['All in scope', 'Some out of scope', 'Unknown'],
  },
  {
    id: 'BTC.GOV.001',
    text: 'Is there a documented exception register for boundary/control deviations?',
    bankOptions: ['Yes', 'No', 'Unknown'],
  },
  {
    id: 'BTC.GOV.002',
    text: 'Are compensating controls documented for each exception (with owners and due dates)?',
    bankOptions: ['Yes', 'Partially', 'No', 'Unknown'],
  },
  {
    id: 'BTC.GOV.003',
    text: 'Is risk acceptance formally recorded and approved when gaps remain?',
    bankOptions: ['Yes', 'Partially', 'No', 'Unknown'],
  },
  {
    id: 'BTC.GOV.004',
    text: 'Is change governance defined (approvals, rollback authority, change windows) and enforced?',
    bankOptions: ['Yes', 'Partially', 'No', 'Unknown'],
  },
];

/** A bank option as a node option value (lowercase words joined by _). */
export function btcOptionValue(bankOption: string): string {
  return bankOption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export const BTC_NODE_SPEC_BY_ID: Record<string, BtcNodeSpec> = Object.fromEntries(
  BTC_NODE_SPECS.map((s) => [s.id, s])
);

export const BTC_GATE_NODES: QuestionNode[] = BTC_NODE_SPECS.map((s) => ({
  id: s.id,
  text: s.text,
  options: s.bankOptions.map((o) => ({ label: o, value: btcOptionValue(o) })),
  cluster: 'boundary',
  mapped_requirements: [],
  plan_input: { contract: 'btc_confirmation', field: `answers.${s.id}` },
}));

/** The bank option a stored node answer names, or null when it names none. */
export function btcRawAnswer(questionId: string, stored: string): string | null {
  const spec = BTC_NODE_SPEC_BY_ID[questionId];
  if (!spec) return null;
  const v = stored.trim();
  return spec.bankOptions.find((o) => btcOptionValue(o) === v || o === v) ?? null;
}
